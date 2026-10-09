'use strict';

const { systemPrompt, toolsFor, stateMessage, NUDGE } = require('./prompt');
const { runJavascript } = require('./sandbox');
const { shotsFor, summarizeShots, placing } = require('./metrics');

// Model calls allowed per decision, counting nudges, rejected actions and
// sandbox runs. Running out (or 3 rejected actions) forfeits the turn.
const MAX_STEPS = { reasoning: 4, tools: 16 };
const MAX_REJECTS = 3;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The arena allows 240 requests/minute per IP; stay under it across all
// concurrent matches rather than burning retries.
const MIN_GAP_MS = 300;
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
}

async function api(base, key, method, path, body) {
  const headers = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (body) headers['content-type'] = 'application/json';
  for (let attempt = 0; ; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    // Backoff totals about a minute, one full rate-limit window.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new ApiError(res.status, `${res.status} ${json.error || res.statusText}`);
  }
}

const addUsage = (a, b) => {
  for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k];
};

// One decision (a shop or a move). Returns tool results the model hasn't seen
// yet; they lead the next message in this conversation.
async function decide({ base, key, matchId, conv, state, track, pending, scores }) {
  const expected = state.needs === 'shop' ? 'shop' : 'fire';
  const endpoint = `/api/matches/${matchId}/${state.needs === 'shop' ? 'shop' : 'move'}`;
  const rec = { round: state.round, turn: state.turn, needs: state.needs, outcome: null, steps: 0, rejects: 0, nudges: 0, jsRuns: 0, usage: {}, ms: 0 };
  let parts = { toolResults: pending, text: stateMessage(state, { scores }), state };

  for (let step = 0; step < MAX_STEPS[track] && !rec.outcome; step++) {
    let r;
    try {
      r = await conv.send(parts);
    } catch (err) {
      rec.outcome = 'api_error';
      rec.error = String(err.message || err).slice(0, 500);
      parts = { toolResults: [] };
      break;
    }
    rec.steps++;
    addUsage(rec.usage, r.usage);
    rec.ms += r.ms;
    const results = [];
    for (const call of r.calls) {
      const reply = (text, isError = true) => results.push({ id: call.id, text, isError });
      if (r.stop === 'max_tokens' || r.stop === 'refusal') reply(`Not run: the response stopped early (${r.stop}).`);
      else if (call.error) {
        rec.rejects++;
        reply(call.error);
      } else if (call.name === 'run_javascript' && track === 'tools') {
        rec.jsRuns++;
        const out = await runJavascript(call.input && call.input.code, state);
        reply(out.text, out.isError);
      } else if (call.name === expected && !rec.outcome) {
        try {
          const resp = await api(base, key, 'POST', endpoint, call.input || {});
          rec.outcome = 'acted';
          rec.action = call.input;
          reply(JSON.stringify(resp), false);
        } catch (err) {
          if (err.status === 409) rec.outcome = 'late';
          else if (err.status === 400) rec.rejects++;
          else throw err;
          reply(err.message);
        }
      } else reply(call.name === expected ? 'You already acted this turn.' : `\`${call.name}\` is not available now; call \`${expected}\`.`);
    }
    parts = { toolResults: results };
    if (rec.outcome) break;
    if (r.stop === 'refusal') {
      rec.outcome = 'refused';
      break;
    }
    if (rec.rejects >= MAX_REJECTS) break;
    if (!r.calls.length) {
      rec.nudges++;
      parts.text = NUDGE;
    }
  }

  if (!rec.outcome) rec.outcome = 'no_action';
  if (rec.outcome !== 'acted' && rec.outcome !== 'late') {
    try {
      await api(base, key, 'POST', endpoint, state.needs === 'shop' ? {} : { weapon: 'pass' });
    } catch (err) {
      if (err.status !== 409) throw err;
    }
  }
  return { rec, pending: parts.toolResults };
}

// Play one seat of a match that already exists, until it ends. Several seats
// of one match can be played at once, each by its own provider.
async function playSeat({ base, key, provider, track, matchId, seat, opponents }) {
  const system = systemPrompt(track, opponents);
  const tools = toolsFor(track);
  const startedAt = new Date().toISOString();
  const decisions = [];
  let conv = null;
  let convRound = null;
  let pending = [];
  let since = -1;
  let final;
  try {
    for (;;) {
      const s = await api(base, key, 'GET', `/api/matches/${matchId}/state?wait=25&since=${since}`);
      since = s.version;
      if (s.status === 'done' || s.status === 'expired') {
        final = s;
        break;
      }
      if (!s.needs) continue;
      // Each round (its shop phase plus its turns) is one conversation.
      const round = s.needs === 'shop' ? s.round + 1 : s.round;
      let scores = null;
      if (convRound !== round) {
        conv = provider.createConversation({ system, tools });
        convRound = round;
        pending = [];
        scores = s.tanks.map((t) => `${t.name} ${t.score}`).join(', ');
      }
      const d = await decide({ base, key, matchId, conv, state: s, track, pending, scores });
      decisions.push(d.rec);
      pending = d.pending;
    }
  } catch (err) {
    await api(base, key, 'POST', `/api/matches/${matchId}/resign`).catch(() => {});
    throw err;
  }

  const log = (await api(base, null, 'GET', `/api/matches/${matchId}/log?since=0`)).entries;
  const shots = shotsFor(log, seat);
  const count = (o) => decisions.filter((d) => d.outcome === o).length;
  const usage = {};
  for (const d of decisions) addUsage(usage, d.usage);
  return {
    match: matchId,
    seat,
    status: final.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(final.status === 'done' ? placing(final.standings, seat) : { rank: null, points: 0 }),
    standings: final.standings || null,
    shots: summarizeShots(shots),
    decisions: {
      total: decisions.length,
      acted: count('acted'),
      late: count('late'),
      noAction: count('no_action'),
      refused: count('refused'),
      apiErrors: count('api_error'),
      rejects: decisions.reduce((n, d) => n + d.rejects, 0),
      nudges: decisions.reduce((n, d) => n + d.nudges, 0),
      jsRuns: decisions.reduce((n, d) => n + d.jsRuns, 0),
    },
    usage,
    modelMs: decisions.reduce((n, d) => n + d.ms, 0),
    // A provider outage says nothing about the model; such matches are rerun.
    clean: final.status === 'done' && !count('api_error'),
    shotLog: shots,
    decisionLog: decisions,
  };
}

// One model against the suite's bots.
async function playMatch({ base, key, provider, track, scenario, settings }) {
  const created = await api(base, key, 'POST', '/api/matches', { bots: scenario.bots, seed: scenario.seed, settings });
  const r = await playSeat({ base, key, provider, track, matchId: created.match, seat: created.seat, opponents: 'bots' });
  const { match, seat, ...rest } = r;
  return { type: 'match', scenario: scenario.id, kind: scenario.kind, bots: scenario.bots, seed: scenario.seed, match, ...rest };
}

module.exports = { playMatch, playSeat, api, ApiError, MAX_STEPS };
