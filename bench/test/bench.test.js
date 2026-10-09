'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../../server/src/store');
const { createServer } = require('../../server/src/server');
const { playMatch } = require('../src/agent');
const { shotsFor, placing } = require('../src/metrics');
const { runJavascript, assertSandboxed } = require('../src/sandbox');
const { scriptedProvider } = require('../src/providers/scripted');
const { anthropicProvider } = require('../src/providers/anthropic');
const sdk = require('@anthropic-ai/sdk');

const Anthropic = sdk.default || sdk;
const SETTINGS = { ...require('../suite.json').settings, rounds: 1 };

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorch-bench-'));
  const server = createServer({ store: new Store(path.join(dir, 'test.db')), log: { error: () => {} } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const reg = await (await fetch(base + '/api/agents', { method: 'POST', body: JSON.stringify({ name: 'bench-test' }) })).json();
    await fn(base, reg.key);
  } finally {
    for (const m of server.matches.values()) clearInterval(m.timer);
    server.close();
    server.closeAllConnections();
  }
}

test('sandbox runs code against STATE and is cut off from the host', async () => {
  await assertSandboxed();
  assert.deepStrictEqual(await runJavascript('console.log(STATE.tanks.length * 2)', { tanks: [1, 2] }), { text: '4', isError: false });
  const escape = await runJavascript('const p = STATE.constructor.constructor("return process")(); p.getBuiltinModule("fs").readFileSync("/etc/hosts")', {});
  assert.ok(escape.isError);
  assert.match(escape.text, /ERR_ACCESS_DENIED|Access to this API has been restricted/);
});

test('shot damage is the score change across a volley, net of kill and win bonuses', () => {
  const snap = (s0, k0) => ({ players: [{ score: s0, roundKills: k0 }, { score: 0, roundKills: 0 }] });
  const log = [
    { t: 'volley', round: 1, snap: snap(0, 0), actions: [{ seat: 0, weapon: 'missile', angle: 50, power: 400 }] },
    { t: 'volley', round: 1, snap: snap(30, 0), actions: [{ seat: 0, weapon: 'pass' }] },
    { t: 'volley', round: 1, snap: snap(30, 0), actions: [{ seat: 0, weapon: 'nuke', angle: 60, power: 500 }] },
    { t: 'roundEnd', round: 1, winner: 0, rows: [{ seat: 0, score: 30 + 70 + 250 + 500, kills: 1 }] },
  ];
  assert.deepStrictEqual(
    shotsFor(log, 0).map((s) => [s.weapon, s.damage, s.kills]),
    [['missile', 30, 0], ['nuke', 70, 1]],
  );
  assert.deepStrictEqual(placing([{ seat: 0, score: 9 }, { seat: 1, score: 5 }], 0), { rank: 1, points: 1 });
  assert.deepStrictEqual(placing([{ seat: 1, score: 9 }, { seat: 0, score: 9 }], 0), { rank: 1, points: 0.5 });
  assert.deepStrictEqual(placing([{ seat: 1, score: 9 }, { seat: 0, score: 5 }], 0), { rank: 2, points: 0 });
});

test('a seeded scenario plays to the same result twice', { timeout: 240_000 }, async () => {
  await withServer(async (base, key) => {
    const scenario = { id: 'duel-shooter-17', kind: 'duel', bots: ['shooter'], seed: 17 };
    const run = () => playMatch({ base, key, provider: scriptedProvider(), track: 'reasoning', scenario, settings: SETTINGS });
    const a = await run();
    const b = await run();
    assert.strictEqual(a.status, 'done');
    assert.ok(a.clean);
    assert.ok(a.shots.count > 0);
    assert.strictEqual(a.decisions.acted, a.decisions.total);
    assert.deepStrictEqual(b.shotLog, a.shotLog);
    assert.deepStrictEqual(b.standings, a.standings);
  });
});

test('a model that stalls or sends bad moves is nudged, corrected, then passed', { timeout: 240_000 }, async () => {
  await withServer(async (base, key) => {
    // Turn 1: no tool call, then a weapon it doesn't own, then a good shot.
    // Every later turn: three bad weapons in a row, so the harness passes.
    let turn = 0;
    const replies = [];
    const provider = {
      createConversation: () => ({
        async send(parts) {
          if (parts.state) {
            turn++;
            if (parts.state.needs === 'shop') replies.push({ name: 'shop', input: {} });
            else if (turn === 1) replies.push(null, { name: 'fire', input: { weapon: 'nuke', angle: 45, power: 400 } }, { name: 'fire', input: { weapon: 'baby_missile', angle: 45, power: 400 } });
            else replies.push(...Array(3).fill({ name: 'fire', input: { weapon: 'laser', angle: 45, power: 400 } }));
          }
          const next = replies.shift();
          return { calls: next ? [{ id: `c${turn}-${replies.length}`, ...next }] : [], stop: next ? 'tool_use' : 'end_turn', usage: { input: 1, output: 1 }, ms: 0 };
        },
      }),
    };
    const r = await playMatch({ base, key, provider, track: 'reasoning', scenario: { id: 't', kind: 'duel', bots: ['shooter'], seed: 5 }, settings: { ...SETTINGS, startCash: 0 } });
    const [first, ...rest] = r.decisionLog.filter((d) => d.needs === 'move');
    assert.deepStrictEqual([first.outcome, first.nudges, first.rejects, first.steps], ['acted', 1, 1, 3]);
    assert.ok(rest.length > 0);
    assert.ok(rest.every((d) => d.outcome === 'no_action' && d.rejects === 3));
    assert.strictEqual(r.shots.count, 1);
  });
});

test('the Claude adapter sends adaptive thinking, effort and caching, and threads tool results', async () => {
  const bodies = [];
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const fakeFetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const stream = sse([
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${bodies.length}`, name: 'fire', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"weapon":"baby_missile","angle":45,"power":500}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]);
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const client = new Anthropic({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
  const conv = anthropicProvider({ model: 'claude-opus-5-5', effort: 'high', client }).createConversation({ system: 'SYS', tools: [{ name: 'fire', description: 'd', input_schema: { type: 'object' } }] });

  const r1 = await conv.send({ text: 'state 1' });
  assert.deepStrictEqual(r1.calls, [{ id: 'toolu_1', name: 'fire', input: { weapon: 'baby_missile', angle: 45, power: 500 } }]);
  assert.strictEqual(r1.stop, 'tool_use');
  assert.deepStrictEqual(r1.usage, { input: 10, output: 20, cacheRead: 4, cacheWrite: 0 });
  await conv.send({ toolResults: [{ id: 'toolu_1', text: '{"accepted":true}' }], text: 'state 2' });

  const b = bodies[1];
  assert.strictEqual(b.model, 'claude-opus-5-5');
  assert.deepStrictEqual(b.thinking, { type: 'adaptive' });
  assert.deepStrictEqual(b.output_config, { effort: 'high' });
  assert.deepStrictEqual(b.cache_control, { type: 'ephemeral' });
  assert.strictEqual(b.tools[0].eager_input_streaming, true);
  assert.ok(!('fallbacks' in b));
  assert.deepStrictEqual(b.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepStrictEqual(b.messages[2].content, [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"accepted":true}' },
    { type: 'text', text: 'state 2' },
  ]);
});

test('in the tools track the model can run code before acting and sees its output', { timeout: 240_000 }, async () => {
  await withServer(async (base, key) => {
    const seen = [];
    let n = 0;
    const provider = {
      createConversation: () => ({
        async send(parts) {
          for (const r of parts.toolResults || []) seen.push(r.text);
          const call = parts.state
            ? parts.state.needs === 'shop'
              ? { name: 'shop', input: {} }
              : { name: 'run_javascript', input: { code: 'console.log("seat", STATE.you)' } }
            : { name: 'fire', input: { weapon: 'baby_missile', angle: 60, power: 450 } };
          return { calls: [{ id: `c${++n}`, ...call }], stop: 'tool_use', usage: {}, ms: 0 };
        },
      }),
    };
    const r = await playMatch({ base, key, provider, track: 'tools', scenario: { id: 't', kind: 'duel', bots: ['shooter'], seed: 9 }, settings: { ...SETTINGS, startCash: 0 } });
    const moves = r.decisionLog.filter((d) => d.needs === 'move');
    assert.ok(moves.length > 0 && moves.every((d) => d.outcome === 'acted' && d.jsRuns === 1));
    assert.strictEqual(seen[0], 'seat 0');
  });
});
