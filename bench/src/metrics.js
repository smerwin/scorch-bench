'use strict';

// Shot outcomes from a finished match's public log. A tank's score rises by
// exactly the damage it deals to others plus killScore per kill, and the
// round winner gets winScore at the end, so the score change across a volley
// is that volley's damage by `seat`. In simultaneous mode only our own shot
// can raise our score; kill credit goes to whoever hit the dead tank last.
const KILL_SCORE = 250;
const WIN_SCORE = 500;

function shotsFor(log, seat) {
  const shots = [];
  log.forEach((e, i) => {
    if (e.t !== 'volley') return;
    const a = e.actions.find((x) => x.seat === seat);
    if (!a || a.weapon === 'pass') return;
    const next = log.slice(i + 1).find((x) => x.round === e.round && (x.t === 'volley' || x.t === 'roundEnd'));
    if (!next) return;
    const before = e.snap.players[seat];
    let score;
    let kills;
    if (next.t === 'volley') {
      score = next.snap.players[seat].score;
      kills = next.snap.players[seat].roundKills;
    } else {
      const row = next.rows.find((r) => r.seat === seat);
      score = row.score - (next.winner === seat ? WIN_SCORE : 0);
      kills = row.kills;
    }
    const k = kills - before.roundKills;
    shots.push({ round: e.round, weapon: a.weapon, angle: a.angle, power: a.power, damage: Math.round(score - before.score - KILL_SCORE * k), kills: k });
  });
  return shots;
}

function summarizeShots(shots) {
  return {
    count: shots.length,
    hits: shots.filter((s) => s.damage > 0 || s.kills > 0).length,
    damage: shots.reduce((n, s) => n + s.damage, 0),
    kills: shots.reduce((n, s) => n + s.kills, 0),
  };
}

// 1 for an outright win, 0.5 for a share of first place, else 0.
function placing(standings, seat) {
  const mine = standings.find((r) => r.seat === seat).score;
  const better = standings.filter((r) => r.score > mine).length;
  const tied = standings.filter((r) => r.score === mine).length - 1;
  return { rank: better + 1, points: better ? 0 : tied ? 0.5 : 1 };
}

module.exports = { shotsFor, summarizeShots, placing };
