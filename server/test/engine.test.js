'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../src/engine');

// Play a whole all-bot game, recording every committed action plus the
// snapshot taken right before each volley.
function playRecorded(seed, settings) {
  const E = createEngine();
  const types = ['cyborg', 'spoiler', 'tosser', 'moron'];
  const players = types.map((t, i) => new E.Player({ name: t, type: t, color: E.PLAYER_COLORS[i], index: i }));
  const volleys = [];
  let roundOver = false;
  const g = new E.Game({ ...E.DEFAULT_SETTINGS, ...settings }, players, {
    beforeVolley: (list) => volleys.push({ snap: g.snapshot(), actions: list.map((p) => ({ i: p.index, a: { ...p.pending, target: p.pending.target ? p.pending.target.index : -1 } })) }),
    onRoundEnd: () => (roundOver = true),
  }, seed);
  g.fastAI = true;
  for (let r = 0; r < settings.rounds; r++) {
    for (const p of players) E.AI.shop(p, g.settings);
    roundOver = false;
    g.startRound(2);
    for (let i = 0; i < 60 * 60 * 30 && !roundOver; i++) g.update(E.PHYS.tick);
  }
  return { E, g, volleys, final: players.map((p) => [p.score, p.cash, p.kills]) };
}

test('same seed replays to the same result', () => {
  const s = { rounds: 2, startCash: 30000, turnMode: 'simultaneous', gusts: 0.25 };
  const a = playRecorded(1234, s);
  const b = playRecorded(1234, s);
  assert.strictEqual(JSON.stringify(a.final), JSON.stringify(b.final));
  assert.ok(a.volleys.length > 3);
});

test('restoring a pre-volley snapshot and replaying actions reproduces the next snapshot', () => {
  const { volleys } = playRecorded(99, { rounds: 1, startCash: 30000, turnMode: 'sequential', gusts: 0.2 });
  const E = createEngine();
  const snap0 = volleys[0].snap;
  const players = snap0.players.map((q) => new E.Player({ name: q.name, type: 'remote', color: q.color, index: q.index }));
  const g = new E.Game({ ...E.DEFAULT_SETTINGS, rounds: 1, startCash: 30000, turnMode: 'sequential', gusts: 0.2 }, players, {}, 1);
  g.replay = true;
  let checked = 0;
  for (let v = 0; v + 1 < volleys.length; v++) {
    const next = volleys[v + 1].snap;
    if (next.round !== volleys[v].snap.round) continue;
    g.restore(volleys[v].snap);
    for (const { i, a } of volleys[v].actions) g.players[i].pending = { ...a, target: a.target >= 0 ? g.players[a.target] : null };
    g.launchVolley(volleys[v].actions.map(({ i }) => g.players[i]));
    for (let t = 0; t < 60 * 120 && g.phase !== 'idle'; t++) g.update(E.PHYS.tick);
    const mine = g.snapshot();
    // The next snapshot is taken after the next shooter's pre-turn prep
    // (batteries, shields), so health may only have gone up since.
    assert.strictEqual(mine.wind, next.wind, `volley ${v} wind`);
    const badCols = mine.terrain.map((c, x) => x).filter((x) => JSON.stringify(mine.terrain[x]) !== JSON.stringify(next.terrain[x]));
    assert.strictEqual(badCols.length, 0, `volley ${v} terrain cols ${badCols.slice(0, 5)} ${JSON.stringify(badCols.slice(0, 2).map((x) => [mine.terrain[x], next.terrain[x]]))} weapons ${volleys[v].actions.map((a) => a.a.weapon)}`);
    assert.strictEqual(JSON.stringify(mine.players.map((p) => [p.x, p.y, p.alive])), JSON.stringify(next.players.map((p) => [p.x, p.y, p.alive])), `volley ${v}`);
    mine.players.forEach((p, i) => assert.ok(p.health <= next.players[i].health, `volley ${v} health`));
    checked++;
  }
  assert.ok(checked > 3, 'checked ' + checked);
});

// Two remote tanks that only pass: nobody can take damage, so the round must
// be drawn after `stalemate` full turns, and otherwise run to the turn cap.
function playPasses(settings) {
  const E = createEngine();
  const players = [0, 1].map((i) => new E.Player({ name: 'p' + i, type: 'remote', color: E.PLAYER_COLORS[i], index: i }));
  let summary = null;
  const g = new E.Game({ ...E.DEFAULT_SETTINGS, rounds: 1, turnMode: 'simultaneous', ...settings }, players, { onRoundEnd: (s) => (summary = s) }, 7);
  g.startRound(2);
  for (let i = 0; i < 60 * 60 * 30 && !summary; i++) {
    for (const p of g.waitingFor()) g.commit(p, { weapon: 'pass', angle: 90, power: 0, guidance: null, target: null, trigger: false });
    g.update(E.PHYS.tick);
  }
  return { g, summary };
}

test('a round with no damage is drawn after the stalemate turn count', () => {
  const { g, summary } = playPasses({ stalemate: 3 });
  assert.strictEqual(summary.reason, 'stalemate');
  assert.strictEqual(summary.winner, null);
  assert.strictEqual(g.turnCount, 6); // 3 full turns of 2 tanks
  assert.ok(g.players.every((p) => p.alive));
  assert.strictEqual(g.snapshot().lastDamageTurn, 0);
});

test('stalemate 0 keeps the old per-player turn cap', () => {
  const { g, summary } = playPasses({ stalemate: 0 });
  assert.strictEqual(summary.reason, 'limit');
  assert.strictEqual(g.turnCount, 60);
});
