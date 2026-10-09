'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/store');
const { createServer } = require('../src/server');
const { playMatch, api } = require('../bots/example-bot');

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

test('agent registers, plays a full match against bots, lands on the leaderboard', { timeout: 240_000 }, async () => {
  await withServer(async (base) => {
    const reg = await api(base, null, 'POST', '/api/agents', { name: 'tester' });
    assert.match(reg.key, /^sk_/);
    await assert.rejects(api(base, null, 'POST', '/api/agents', { name: 'TESTER' }), /409/);
    await assert.rejects(api(base, 'sk_nope', 'POST', '/api/matches', { bots: ['moron'] }), /401/);

    const m = await api(base, reg.key, 'POST', '/api/matches', { bots: ['moron', 'shooter'], settings: { rounds: 2, turnMode: 'simultaneous' } });
    assert.strictEqual(m.status, 'live');
    const end = await playMatch({ base, key: reg.key, match: m.match, quiet: true });
    assert.strictEqual(end.status, 'done');
    assert.strictEqual(end.standings.length, 3);

    const lb = await api(base, null, 'GET', '/api/leaderboard');
    assert.ok(lb.leaderboard.some((r) => r.name === 'tester' && r.games === 1));
    assert.ok(lb.leaderboard.some((r) => r.name === 'Moron (bot)'));

    const log = await api(base, null, 'GET', `/api/matches/${m.match}/log?since=0`);
    assert.strictEqual(log.entries[0].t, 'start');
    assert.ok(log.entries.some((e) => e.t === 'volley'));
    assert.strictEqual(log.entries[log.entries.length - 1].t, 'end');
  });
});

test('two agents meet in a lobby; out-of-turn and invalid moves are rejected', { timeout: 240_000 }, async () => {
  await withServer(async (base) => {
    const a = await api(base, null, 'POST', '/api/agents', { name: 'alpha' });
    const b = await api(base, null, 'POST', '/api/agents', { name: 'bravo' });
    const m = await api(base, a.key, 'POST', '/api/matches', { openSeats: 1, settings: { rounds: 1, turnMode: 'sequential', startCash: 0 } });
    assert.strictEqual(m.status, 'lobby');
    const open = await api(base, null, 'GET', '/api/matches?status=open');
    assert.ok(open.matches.some((x) => x.id === m.match));
    await assert.rejects(api(base, a.key, 'POST', `/api/matches/${m.match}/join`), /409/);
    await api(base, b.key, 'POST', `/api/matches/${m.match}/join`);

    // Exactly one of the two is up first in sequential mode.
    const [sa, sb] = await Promise.all([a, b].map((x) => api(base, x.key, 'GET', `/api/matches/${m.match}/state?wait=10`)));
    const [mover, waiter] = sa.needs === 'move' ? [a, b] : [b, a];
    assert.ok((sa.needs === 'move') !== (sb.needs === 'move'));
    await assert.rejects(api(base, waiter.key, 'POST', `/api/matches/${m.match}/move`, { weapon: 'baby_missile', angle: 45, power: 300 }), /409/);
    await assert.rejects(api(base, mover.key, 'POST', `/api/matches/${m.match}/move`, { weapon: 'nuke', angle: 45, power: 300 }), /no nuke/);
    await assert.rejects(api(base, mover.key, 'POST', `/api/matches/${m.match}/move`, { weapon: 'baby_missile', items: ['tracer'] }), /400/);

    const results = await Promise.all([a, b].map((x) => playMatch({ base, key: x.key, match: m.match, quiet: true })));
    assert.ok(results.every((r) => r.status === 'done'));
  });
});
