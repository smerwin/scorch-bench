'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/store');
const { createServer } = require('../src/server');
const { createEngine } = require('../src/engine');
const { api } = require('../bots/example-bot');

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorch-'));
  const store = new Store(path.join(dir, 'test.db'));
  const server = createServer({ store, log: { error: () => {} } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, server);
  } finally {
    for (const m of server.matches.values()) clearInterval(m.timer);
    server.close();
    server.closeAllConnections();
  }
}

// What a cheating agent would do: take the newest snapshot in the public log,
// run the open-source engine forward exactly as the server does, and read off
// the RNG state at its own decision point (which fixes the coming gust).
function predictRng(entries, settings) {
  const E = createEngine();
  const start = entries.find((e) => e.t === 'start');
  const players = start.seats.map((s, i) => new E.Player({ name: s.name, type: s.kind === 'bot' ? s.bot : 'remote', color: E.PLAYER_COLORS[i], index: i }));
  const g = new E.Game(settings, players, {}, start.seed);
  g.fastAI = true;
  const last = entries.filter((e) => e.t === 'round' || e.t === 'volley').pop();
  g.restore(last.snap);
  if (last.t === 'round') {
    g.phase = 'start';
    g.phaseTimer = 0.8;
  } else {
    for (const a of last.actions) g.players[a.seat].pending = { ...a, target: a.target === null ? null : g.players[a.target] };
    g.launchVolley(last.actions.map((a) => g.players[a.seat]));
  }
  for (let i = 0; i < 60 * 600 && !g.waitingFor().length && g.phase !== 'over'; i++) g.update(E.PHYS.tick);
  return E.RNG.state;
}

// Play `turns` decisions as a log-reading agent; at each one compare the
// predicted RNG state with the server's real one. The agent can die early,
// so it starts new matches until it has had enough turns.
async function attack(base, server, body, turns) {
  const reg = await api(base, null, 'POST', '/api/agents', { name: 'peeker' + Math.floor(Math.random() * 1e6) });
  const results = [];
  for (let tries = 0; results.length < turns && tries < 10; tries++) {
    const m = await api(base, reg.key, 'POST', '/api/matches', body);
    const match = server.matches.get(m.match);
    let since = -1;
    while (results.length < turns) {
      const s = await api(base, reg.key, 'GET', `/api/matches/${m.match}/state?wait=10&since=${since}`);
      since = s.version;
      if (s.status === 'done') break;
      if (s.needs === 'shop') await api(base, reg.key, 'POST', `/api/matches/${m.match}/shop`, {});
      if (s.needs !== 'move') continue;
      const log = await api(base, null, 'GET', `/api/matches/${m.match}/log?since=0`);
      const predicted = predictRng(log.entries, match.settings);
      results.push({ hit: JSON.stringify(predicted) === JSON.stringify(match.E.RNG.state), log: log.entries });
      await api(base, reg.key, 'POST', `/api/matches/${m.match}/move`, { weapon: 'baby_missile', angle: 60 + s.turn, power: 420 });
    }
  }
  return results;
}

const body = { bots: ['shooter', 'moron'], settings: { rounds: 2, turnMode: 'simultaneous', gusts: 0.3 } };

test('a seeded match is predictable from its log (so the attack below is sound)', { timeout: 120_000 }, async () => {
  await withServer(async (base, server) => {
    const r = await attack(base, server, { ...body, seed: 4242 }, 6);
    assert.strictEqual(r.length, 6, 'turns played');
    assert.deepStrictEqual(r.map((x) => x.hit), r.map(() => true));
  });
});

test('a seated agent cannot recover the RNG state of a rated match from the live log', { timeout: 120_000 }, async () => {
  await withServer(async (base, server) => {
    for (const turnMode of ['simultaneous', 'sequential']) {
      const r = await attack(base, server, { ...body, settings: { ...body.settings, turnMode } }, 6);
      assert.strictEqual(r.length, 6, `${turnMode}: turns played`);
      assert.deepStrictEqual(r.map((x) => x.hit), r.map(() => false), turnMode);
      const start = r[r.length - 1].log[0];
      assert.strictEqual(start.t, 'start');
      assert.strictEqual(start.seed, undefined, `${turnMode}: rated log exposes its seed`);
    }
  });
});

// Mirrors js/watch.js: one Game built from the `start` entry, restored from
// each snapshot, with a `say` hook like the browser's. `onVolley` sees each
// volley's entry, the gust the spectator drew, and the state it ends in.
function spectate(entries, onVolley) {
  const E = createEngine();
  let g;
  let says = 0;
  for (const e of entries) {
    if (e.t === 'start') {
      const players = e.seats.map((s, i) => new E.Player({ name: s.name, type: s.kind === 'bot' ? s.bot : 'remote', color: E.PLAYER_COLORS[i], index: i }));
      g = new E.Game(e.settings, players, { say: () => says++ }, e.seed);
      g.replay = true;
    } else if (e.t === 'round') {
      g.restore(e.snap);
    } else if (e.t === 'volley') {
      g.restore(e.snap);
      for (const a of e.actions) g.players[a.seat].pending = { ...a, target: a.target === null ? null : g.players[a.target] };
      g.launchVolley(e.actions.map((a) => g.players[a.seat]));
      const wind = g.wind;
      for (let t = 0; t < 60 * 120 && g.phase !== 'idle'; t++) g.update(E.PHYS.tick);
      onVolley(e, wind, { snap: g.snapshot(), rng: E.RNG.state });
    }
  }
  return says;
}

// Through JSON because each engine lives in its own vm realm.
const outcome = (snap, rng) => JSON.parse(JSON.stringify({ terrain: snap.terrain, tanks: snap.players.map((p) => [p.x, p.y, p.health, p.alive]), rng }));

// Play one rated match firing scatter weapons, recording the server's own
// state the moment each volley settles (before the next turn injects fresh
// entropy), then replay its log as the spectator and compare.
async function spectateOne(base, server, key) {
  const m = await api(base, key, 'POST', '/api/matches', { bots: ['shooter', 'poolshark'], settings: { rounds: 2, startCash: 80000, turnMode: 'simultaneous', gusts: 0.3 } });
  const match = server.matches.get(m.match);
  const g = match.game;
  const truth = new Map();
  let flying = null;
  const settle = () => {
    if (flying !== null) truth.set(flying, outcome(g.snapshot(), match.E.RNG.state));
    flying = null;
  };
  const { beforeTurn, beforeVolley, onRoundEnd } = g.hooks;
  Object.assign(g.hooks, {
    beforeTurn: () => (settle(), beforeTurn()),
    beforeVolley: (list) => (beforeVolley(list), (flying = match.log.length - 1)),
    onRoundEnd: (s) => (settle(), onRoundEnd(s)),
  });

  const order = ['napalm', 'funky_bomb', 'mirv', 'hot_napalm', 'dirt_ball'];
  let since = -1;
  for (;;) {
    const s = await api(base, key, 'GET', `/api/matches/${m.match}/state?wait=10&since=${since}`);
    since = s.version;
    if (s.status === 'done') break;
    if (s.needs === 'shop') await api(base, key, 'POST', `/api/matches/${m.match}/shop`, { buy: { napalm: 1, funky_bomb: 1, mirv: 1, hot_napalm: 1, dirt_ball: 1 } });
    if (s.needs !== 'move') continue;
    const me = s.tanks[s.you];
    const foe = s.tanks.filter((t) => t.alive && t.seat !== s.you).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
    const weapon = order.find((w) => s.self.inventory[w]) || 'baby_missile';
    await api(base, key, 'POST', `/api/matches/${m.match}/move`, { weapon, angle: foe.x > me.x ? 55 : 125, power: 300 + Math.abs(foe.x - me.x) * 0.5 });
  }
  const { entries } = await api(base, null, 'GET', `/api/matches/${m.match}/log?since=0`);

  const seen = { checked: 0, gusts: 0, napalm: entries.some((e) => e.t === 'volley' && e.actions.some((a) => a.weapon === 'napalm')) };
  seen.says = spectate(entries, (e, wind, end) => {
    assert.ok(wind === e.windActual, `volley ${e.n} gust ${wind} vs ${e.windActual}`);
    if (e.windActual !== e.forecast) seen.gusts++;
    if (!truth.has(e.n)) return;
    assert.deepStrictEqual(outcome(end.snap, end.rng), truth.get(e.n), `volley ${e.n} (${e.actions.map((a) => a.weapon)})`);
    seen.checked++;
  });
  assert.strictEqual(seen.checked, truth.size, 'volleys checked');
  return seen;
}

// Matches can end in a couple of volleys, so play until the replay has been
// exercised on enough of them, including napalm, taunts and real gusts.
test('the spectator replays a rated match log exactly', { timeout: 240_000 }, async () => {
  await withServer(async (base, server) => {
    const reg = await api(base, null, 'POST', '/api/agents', { name: 'showoff' });
    const total = { checked: 0, gusts: 0, says: 0, napalm: false };
    for (let tries = 0; tries < 10 && !(total.checked >= 8 && total.gusts && total.says && total.napalm); tries++) {
      const seen = await spectateOne(base, server, reg.key);
      for (const k of ['checked', 'gusts', 'says']) total[k] += seen[k];
      total.napalm ||= seen.napalm;
    }
    assert.ok(total.checked >= 8 && total.gusts && total.says && total.napalm, JSON.stringify(total));
  });
});
