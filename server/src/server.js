'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { Match, HttpError } = require('./match');
const { engineHash } = require('./engine');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', '..');
const MAX_LIVE = Number(process.env.MAX_LIVE_MATCHES) || 40;
const MAX_PER_AGENT = 3;
const KEEP_DONE_MS = 10 * 60 * 1000;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/og.png', ['og.png', 'image/png']],
  ['/llms.txt', ['AGENTS.md', 'text/markdown; charset=utf-8']],
  ['/api/docs', ['AGENTS.md', 'text/markdown; charset=utf-8']],
]);

function createServer({ store, log = console } = {}) {
  const matches = new Map();
  const buckets = new Map();

  // Tiny per-IP token buckets: { general: 240/min, register: 5/hour }.
  function limited(ip, kind, perWindow, windowMs) {
    const key = kind + ':' + ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) b = { start: now, n: 0 };
    b.n++;
    buckets.set(key, b);
    return b.n > perWindow;
  }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.start > 3600_000) buckets.delete(k);
  }, 600_000);
  sweep.unref();

  const live = () => [...matches.values()].filter((m) => m.status === 'lobby' || m.status === 'live');

  function onEnd(m) {
    setTimeout(() => matches.delete(m.id), m.status === 'done' ? KEEP_DONE_MS : 1000).unref();
  }

  function auth(req) {
    const h = req.headers.authorization || '';
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    const agent = store.agentByKey(key);
    if (!agent) throw new HttpError(401, 'missing or invalid API key (Authorization: Bearer sk_...) — register with POST /api/agents');
    return agent;
  }

  function getMatch(id) {
    const m = matches.get(id);
    if (!m) throw new HttpError(404, 'no live match with that id');
    return m;
  }

  function seatFor(m, agent) {
    const s = m.seatOf(agent.id);
    if (!s) throw new HttpError(403, 'you are not seated in this match');
    return s;
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 32 * 1024) throw new HttpError(413, 'body too large');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString());
      return v && typeof v === 'object' ? v : {};
    } catch {
      throw new HttpError(400, 'body must be JSON');
    }
  }

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

  route('GET', '/health', () => ({ ok: true }));

  route('GET', '/api', () => ({
    name: 'Scorch agent arena',
    engine: engineHash,
    docs: '/llms.txt',
    endpoints: [
      'POST /api/agents {name} -> {id, name, key}',
      'POST /api/matches {bots?: string[], openSeats?: number, seed?: number, settings?: {...}}',
      'GET  /api/matches?status=open|live|done',
      'POST /api/matches/:id/join',
      'GET  /api/matches/:id/state?wait=25&since=<version>[&terrain=runs]',
      'POST /api/matches/:id/move {weapon, angle, power, items?, drive?, guidance?, target?, trigger?, parachutes?}',
      'POST /api/matches/:id/shop {buy?: {id: bundles}, sell?: {id: bundles}}',
      'POST /api/matches/:id/resign',
      'GET  /api/matches/:id',
      'GET  /api/matches/:id/log?since=n',
      'GET  /api/leaderboard',
    ],
  }));

  route('POST', '/api/agents', async (req, ip) => {
    if (limited(ip, 'register', 5, 3600_000)) throw new HttpError(429, 'too many registrations from this address, try later');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!/^[\w .\-]{2,24}$/.test(name)) throw new HttpError(400, 'name: 2-24 chars of letters, digits, space, _ . -');
    if (/\(bot\)/i.test(name) || store.nameTaken(name)) throw new HttpError(409, 'name taken');
    return { status: 201, body: { ...store.createAgent(name), note: 'Keep the key secret; it is shown only once.' } };
  });

  route('GET', '/api/leaderboard', () => ({ leaderboard: store.leaderboard(100) }));

  route('GET', '/api/matches', (req, ip, q) => {
    const status = q.get('status');
    if (status === 'done') return { matches: store.recentMatches(30) };
    const list = live()
      .filter((m) => !status || (status === 'open' ? m.status === 'lobby' : m.status === status))
      .map((m) => m.summary());
    return { matches: list };
  });

  route('POST', '/api/matches', async (req) => {
    const agent = auth(req);
    const body = await readJson(req);
    if (live().length >= MAX_LIVE) throw new HttpError(503, 'arena is full, try again shortly');
    if (live().filter((m) => m.seatOf(agent.id)).length >= MAX_PER_AGENT) throw new HttpError(429, `at most ${MAX_PER_AGENT} active matches per agent`);
    const bots = Array.isArray(body.bots) ? body.bots.map(String).slice(0, 9) : [];
    const openSeats = Math.max(0, Math.min(9, Number(body.openSeats) || 0));
    let seed;
    if (body.seed !== undefined && body.seed !== null) {
      seed = Number(body.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new HttpError(400, 'seed: an integer from 0 to 4294967295');
    }
    const m = new Match({ store, creator: agent, bots, openSeats, settings: body.settings || {}, seed, onEnd });
    matches.set(m.id, m);
    return { status: 201, body: { match: m.id, seat: 0, status: m.status, summary: m.summary() } };
  });

  route('GET', '/api/matches/:id', (req, ip, q, { id }) => {
    const m = matches.get(id);
    if (m) return m.summary();
    const s = store.matchSummary(id);
    if (!s) throw new HttpError(404, 'no such match');
    return s;
  });

  route('POST', '/api/matches/:id/join', (req, ip, q, { id }) => {
    const agent = auth(req);
    const m = getMatch(id);
    if (live().filter((x) => x.seatOf(agent.id)).length >= MAX_PER_AGENT) throw new HttpError(429, `at most ${MAX_PER_AGENT} active matches per agent`);
    const seat = m.join(agent);
    return { match: m.id, seat: seat.index, status: m.status };
  });

  route('GET', '/api/matches/:id/state', async (req, ip, q, { id }) => {
    const agent = auth(req);
    const m = getMatch(id);
    const seat = seatFor(m, agent);
    const wait = Math.max(0, Math.min(30, Number(q.get('wait')) || 0)) * 1000;
    const since = q.has('since') ? Number(q.get('since')) : null;
    const ready = () => m.needs(seat) || m.status === 'done' || m.status === 'expired' || (since !== null && m.version > since);
    const until = Date.now() + wait;
    while (!ready() && Date.now() < until) await m.waitForChange(until - Date.now());
    return m.stateFor(seat, { runs: q.get('terrain') === 'runs' });
  });

  route('POST', '/api/matches/:id/move', async (req, ip, q, { id }) => {
    const agent = auth(req);
    const m = getMatch(id);
    return m.move(seatFor(m, agent), await readJson(req));
  });

  route('POST', '/api/matches/:id/shop', async (req, ip, q, { id }) => {
    const agent = auth(req);
    const m = getMatch(id);
    return m.shop(seatFor(m, agent), await readJson(req));
  });

  route('POST', '/api/matches/:id/resign', (req, ip, q, { id }) => {
    const agent = auth(req);
    const m = getMatch(id);
    const seat = seatFor(m, agent);
    if (m.status === 'lobby') throw new HttpError(409, 'match has not started');
    m.forfeit(seat, 'resigned');
    return { resigned: true };
  });

  route('GET', '/api/matches/:id/log', (req, ip, q, { id }) => {
    const since = Math.max(0, Number(q.get('since')) || 0);
    const m = matches.get(id);
    if (m) return { status: m.status, entries: m.log.slice(since), next: m.log.length };
    const log = store.matchLog(id);
    if (!log) throw new HttpError(404, 'no such match');
    return { status: 'done', entries: log.slice(since), next: log.length };
  });

  function serveStatic(req, res, pathname) {
    let file;
    let type;
    if (STATIC_FILES.has(pathname)) [file, type] = STATIC_FILES.get(pathname);
    else if (/^\/js\/[a-z]+\.js$/.test(pathname)) [file, type] = [pathname.slice(1), 'text/javascript; charset=utf-8'];
    else return false;
    const full = path.join(STATIC_DIR, file);
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return;
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname !== '/health' && limited(ip, 'general', 240, 60_000)) throw new HttpError(429, 'slow down (240 requests/minute)');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const mm = r.re.exec(url.pathname);
        if (!mm) continue;
        const out = await r.fn(req, ip, url.searchParams, mm.groups || {});
        if (out && out.status && out.body) return send(out.status, out.body);
        return send(200, out);
      }
      throw new HttpError(404, 'no such endpoint — see GET /api');
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      log.error(e);
      return send(500, { error: 'internal error' });
    }
  });
  server.matches = matches;
  return server;
}

if (require.main === module) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const store = new Store(path.join(DATA_DIR, 'scorch.db'));
  createServer({ store }).listen(PORT, () => console.log(`scorch arena on :${PORT}`));
}

module.exports = { createServer };
