'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../../server/src/store');
const { createServer } = require('../../server/src/server');
const { runArena, arenaReport, arenaScenarios, bradleyTerry } = require('../src/arena');
const { makeProvider, parsePlayerSpec } = require('../src/providers');

const suiteText = fs.readFileSync(path.join(__dirname, '..', 'suite.json'), 'utf8');
const SUITE = JSON.parse(suiteText);
const SETTINGS = { ...SUITE.settings, rounds: 1, startCash: 0 };

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorch-arena-'));
  const server = createServer({ store: new Store(path.join(dir, 'test.db')), log: { error: () => {} } });
  await new Promise((r) => server.listen(0, r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`, dir);
  } finally {
    for (const m of server.matches.values()) clearInterval(m.timer);
    server.close();
    server.closeAllConnections();
  }
}

test('player specs parse provider, model and query-string options', () => {
  assert.deepStrictEqual(parsePlayerSpec('anthropic:claude-opus-5-5?effort=high&track=tools'), { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', track: 'tools' });
  assert.deepStrictEqual(parsePlayerSpec('openai:vendor/model:free?base-url=https://x.test/v1&api-key-env=K'), { provider: 'openai', model: 'vendor/model:free', baseUrl: 'https://x.test/v1', apiKeyEnv: 'K' });
  assert.deepStrictEqual(parsePlayerSpec('openai:gpt-5?extra={"reasoning_effort":"high"}'), { provider: 'openai', model: 'gpt-5', extra: { reasoning_effort: 'high' } });
});

test('rotations put every player in every model seat once per seed', () => {
  const list = arenaScenarios({ seeds: [1, 2], players: 3, rotations: 'all' });
  assert.strictEqual(list.length, 6);
  for (const seed of [1, 2]) {
    const orders = list.filter((s) => s.seed === seed).map((s) => s.order);
    for (let k = 0; k < 3; k++) assert.deepStrictEqual(orders.map((o) => o[k]).sort(), [0, 1, 2]);
  }
  assert.strictEqual(arenaScenarios({ seeds: [1, 2], players: 3, rotations: '1' }).length, 2);
});

test('rated scenarios are unseeded and rotate the seating', () => {
  const list = arenaScenarios({ seeds: [1, 2], players: 3, rotations: 'all', rated: 4 });
  assert.strictEqual(list.length, 4);
  assert.ok(list.every((s) => s.seed === null));
  assert.deepStrictEqual(list.map((s) => s.order), [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 1, 2]]);
});

test('Bradley-Terry ranks a sweep above its victim and stays finite', () => {
  const [a, b] = bradleyTerry(['a', 'b'], [[0, 4], [0, 0]], [[0, 4], [4, 0]]);
  assert.ok(a > 1500 && b < 1500 && Number.isFinite(a));
});

test('two models share seeded matches, swap seats, and get a head-to-head report', { timeout: 300_000 }, async () => {
  await withServer(async (base, dir) => {
    // A player that always passes, so the scripted shooter should come out ahead.
    const prompts = [];
    const passer = {
      describe: { provider: 'test', model: 'passer' },
      createConversation({ system }) {
        prompts.push(system);
        let n = 0;
        return {
          async send(parts) {
            const call = parts.state && parts.state.needs === 'shop' ? { name: 'shop', input: {} } : { name: 'fire', input: { weapon: 'pass', angle: 90, power: 0 } };
            return { calls: [{ id: `p${++n}`, ...call }], stop: 'tool_use', usage: { input: 1, output: 1 }, ms: 0 };
          },
        };
      },
    };
    const make = (c) => (c.provider === 'test' ? passer : makeProvider(c));
    const out = path.join(dir, 'arena.jsonl');
    const suite = { ...SUITE, settings: SETTINGS };
    const keysFile = path.join(dir, 'keys.json');
    const args = { server: base, configs: [{ provider: 'scripted' }, { provider: 'test' }], suite, suiteText, seeds: [17], rotations: 'all', out, log: () => {}, makeProvider: make, keysFile };
    const r = await runArena(args);
    assert.strictEqual(r.failures, 0);

    const lines = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const matches = lines.filter((l) => l.type === 'arena-match');
    assert.strictEqual(matches.length, 2);
    assert.ok(matches.every((m) => m.clean && m.seats.length === 2));
    // Each player hosted (seat 0) exactly once.
    assert.deepStrictEqual(matches.map((m) => m.seats.find((s) => s.seat === 0).player).sort(), ['naive-ballistic', 'passer']);
    assert.ok(prompts.length && prompts.every((p) => p.includes('AI models like you')));

    const report = arenaReport(out);
    assert.match(report, /\| naive-ballistic \| reasoning \| \d+ \| 2 \|/);
    assert.match(report, /Head to head/);
    const rating = (name) => Number(report.split('\n').find((l) => l.startsWith(`| ${name} |`)).split('|')[3]);
    assert.ok(rating('naive-ballistic') > rating('passer'), report);

    // A match left live by a killed run would hold the player's seats; the
    // rerun resigns it, then resumes with nothing left to play.
    const key = Object.values(JSON.parse(fs.readFileSync(keysFile, 'utf8')))[0];
    const stale = await (await fetch(base + '/api/matches', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ bots: ['moron'], settings: SETTINGS }) })).json();
    assert.strictEqual(stale.status, 'live');
    await runArena(args);
    assert.strictEqual(fs.readFileSync(out, 'utf8').trim().split('\n').length, lines.length);
    const live = await (await fetch(base + '/api/matches?status=live')).json();
    assert.ok(!live.matches.some((m) => m.id === stale.match));
  });
});
