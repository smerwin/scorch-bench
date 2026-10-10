'use strict';

// Several models in the same match. Each player is its own arena agent; one
// creates a seeded lobby, the rest join in a fixed order, and every seat is
// played concurrently through the same decision loop as the bot suite.
//
// Seating: a seed fixes where each seat's tank starts, so seats are not equal.
// With rotations "all", each seed is played once per player with the seating
// cyclically shifted, so every player sits in every seat on every map.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { playSeat, api } = require('./agent');
const { agentKey } = require('./keys');
const { assertSandboxed } = require('./sandbox');
const { wilson } = require('../report');
const { version } = require('../package.json');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

// A short, unique, human-readable label per player config.
function labelPlayers(configs, describes) {
  const labels = configs.map((c, i) => {
    if (c.name) return c.name;
    const d = describes[i];
    let l = d.model;
    if (d.effort) l += `@${d.effort}`;
    if ((c.track || 'reasoning') === 'tools') l += '+tools';
    return l;
  });
  const seen = {};
  return labels.map((l) => {
    seen[l] = (seen[l] || 0) + 1;
    return seen[l] > 1 ? `${l}#${seen[l]}` : l;
  });
}

// Arena agent names: <= 24 chars of [\w .-], unique within the run.
function agentNames(labels) {
  const used = new Set();
  return labels.map((l, i) => {
    let n = `arena-${slug(l)}`.slice(0, 24).replace(/-$/, '');
    if (used.has(n)) n = `${n.slice(0, 21)}-${i}`;
    used.add(n);
    return n;
  });
}

// Rated: `rated` unseeded matches instead of the suite's seeds. The server
// rates them, so they count on the public leaderboard; the seating still
// rotates so no player keeps one start position.
function arenaScenarios({ seeds, players, rotations, rated = 0 }) {
  const n = players;
  const list = [];
  if (rated) {
    for (let i = 0; i < rated; i++) list.push({ id: `rated-${i}`, seed: null, rotation: i % n, order: Array.from({ length: n }, (_, k) => (k + i) % n) });
    return list;
  }
  const rots = rotations === 'all' ? n : 1;
  for (const seed of seeds) {
    for (let r = 0; r < rots; r++) {
      // order[k] = index of the player who takes the k-th model seat.
      list.push({ id: `s${seed}-r${r}`, seed, rotation: r, order: Array.from({ length: n }, (_, k) => (k + r) % n) });
    }
  }
  return list;
}

async function playArenaMatch({ server, players, scenario, bots, settings }) {
  const order = scenario.order.map((i) => players[i]);
  const [host, ...guests] = order;
  const created = await api(server, host.key, 'POST', '/api/matches', { bots, openSeats: guests.length, ...(scenario.seed == null ? {} : { seed: scenario.seed }), settings });
  const matchId = created.match;
  const seats = [{ p: host, seat: created.seat }];
  try {
    // Joins fill open seats in order, so joining one at a time fixes seating.
    for (const g of guests) {
      const j = await api(server, g.key, 'POST', `/api/matches/${matchId}/join`);
      seats.push({ p: g, seat: j.seat });
    }
  } catch (err) {
    err.message = `joining ${matchId}: ${err.message}`;
    throw err;
  }
  const settled = await Promise.allSettled(
    seats.map(({ p, seat }) => playSeat({ base: server, key: p.key, provider: p.provider, track: p.track, matchId, seat, opponents: 'models' })),
  );
  const seatRecords = settled.map((s, i) => {
    const { p, seat } = seats[i];
    if (s.status === 'fulfilled') {
      const { match, standings, ...rest } = s.value;
      return { player: p.label, ...rest, seat };
    }
    return { player: p.label, seat, clean: false, error: String((s.reason && s.reason.stack) || s.reason).slice(0, 2000) };
  });
  const standings = (settled.find((s) => s.status === 'fulfilled' && s.value.standings) || {}).value?.standings || null;
  return {
    type: 'arena-match',
    scenario: scenario.id,
    seed: scenario.seed,
    rotation: scenario.rotation,
    bots,
    match: matchId,
    standings,
    seats: seatRecords,
    clean: !!standings && seatRecords.every((r) => r.clean),
  };
}

// A killed run leaves its matches live, and they hold every player's seats
// against the arena's 3-active-matches-per-agent cap until they time out.
// Their results were never recorded, so resign them before starting.
async function resignLeftovers({ server, players, names, log }) {
  const live = (await api(server, null, 'GET', '/api/matches?status=live')).matches;
  for (const m of live) {
    const seated = new Set(m.seats.map((s) => s.name));
    for (let i = 0; i < players.length; i++) {
      if (!seated.has(names[i])) continue;
      try {
        await api(server, players[i].key, 'POST', `/api/matches/${m.id}/resign`);
        log(`resigned leftover match ${m.id} for ${players[i].label}`);
      } catch {}
    }
  }
}

async function runArena({ server, configs, suite, suiteText, seeds, bots = [], rotations = 'all', rated = 0, concurrency = 3, out, log = console.log, makeProvider, keysFile }) {
  if (configs.length < 2) throw new Error('an arena needs at least 2 players');
  if (configs.length + bots.length > 10) throw new Error('at most 10 seats per match (players + bots)');
  const providers = configs.map((c) => makeProvider(c));
  const describes = providers.map((p) => p.describe);
  const labels = labelPlayers(configs, describes);
  const names = agentNames(labels);
  const tracks = configs.map((c) => c.track || 'reasoning');
  for (const t of tracks) if (!['reasoning', 'tools'].includes(t)) throw new Error(`track must be reasoning or tools (got ${t})`);
  if (tracks.includes('tools')) await assertSandboxed();

  const info = await api(server, null, 'GET', '/api');
  const settings = suite.settings;
  const todo = arenaScenarios({ seeds, players: configs.length, rotations, rated });
  const meta = {
    type: 'arena-meta',
    harness: version,
    suite: { name: suite.name, version: suite.version, hash: crypto.createHash('sha256').update(suiteText).digest('hex').slice(0, 12) },
    engine: info.engine,
    server,
    bots,
    rotations,
    rated: rated ? true : undefined,
    players: labels.map((label, i) => ({ label, track: tracks[i], ...describes[i] })),
    startedAt: new Date().toISOString(),
  };

  // Resume: keep clean results from an earlier run with the same setup.
  const done = new Set();
  if (fs.existsSync(out)) {
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const prev = lines.find((l) => l.type === 'arena-meta');
    for (const k of ['harness', 'engine', 'players', 'bots', 'rotations', 'rated']) {
      if (prev && JSON.stringify(prev[k]) !== JSON.stringify(meta[k])) throw new Error(`${out} was produced with different ${k}; use --out for a new file`);
    }
    if (prev && prev.suite.hash !== meta.suite.hash) throw new Error(`${out} was produced with a different suite; use --out for a new file`);
    for (const l of lines) if (l.type === 'arena-match' && l.clean) done.add(l.scenario);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(meta) + '\n');
  }

  const players = [];
  for (let i = 0; i < configs.length; i++) {
    players.push({ label: labels[i], provider: providers[i], track: tracks[i], key: await agentKey(server, names[i], keysFile) });
  }
  await resignLeftovers({ server, players, names, log });
  const queue = todo.filter((s) => !done.has(s.id));
  log(`arena: ${labels.join(' vs ')}${bots.length ? ' (+ bots ' + bots.join(', ') + ')' : ''}; ${queue.length} of ${todo.length}${rated ? ' rated' : ''} matches to play, engine ${info.engine}`);

  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < queue.length) {
      const scenario = queue[next++];
      try {
        const r = await playArenaMatch({ server, players, scenario, bots, settings });
        fs.appendFileSync(out, JSON.stringify(r) + '\n');
        const line = r.seats
          .slice()
          .sort((a, b) => (a.rank || 99) - (b.rank || 99))
          .map((s) => `${s.player} #${s.rank ?? '?'}${s.shots ? ` (${s.shots.hits}/${s.shots.count} hits)` : ' (error)'}`)
          .join(', ');
        log(`${scenario.id.padEnd(12)} ${r.match}  ${line}${r.clean ? '' : '  (unclean: will rerun)'}`);
      } catch (err) {
        failures++;
        log(`${scenario.id}: ${err.stack || err}`);
      }
    }
  };
  // Every player sits in every match, so the arena's per-agent cap of 3
  // active matches bounds concurrency.
  const n = Math.max(1, Math.min(3, Number(concurrency) || 3));
  await Promise.all(Array.from({ length: n }, worker));
  return { out, failures };
}

// ------------------------------------------------------------------ report

function loadArena(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = lines.find((l) => l.type === 'arena-meta');
  const byScenario = new Map();
  let unclean = 0;
  for (const l of lines) {
    if (l.type !== 'arena-match') continue;
    if (l.clean) byScenario.set(l.scenario, l);
    else unclean++;
  }
  return { meta, matches: [...byScenario.values()], unclean };
}

// Bradley-Terry strengths from pairwise results (MM algorithm), on an Elo
// scale centred at 1500. Every pair also gets one virtual draw, so a clean
// sweep stays finite and tiny samples shrink toward the middle.
function bradleyTerry(names, wins, games) {
  const n = names.length;
  const W = names.map((_, i) => names.reduce((s, _, j) => s + (i === j ? 0 : wins[i][j] + 0.5), 0));
  let p = names.map(() => 1);
  for (let it = 0; it < 500; it++) {
    const q = p.map((pi, i) => {
      let d = 0;
      for (let j = 0; j < n; j++) if (j !== i) d += (games[i][j] + 1) / (pi + p[j]);
      return W[i] / d;
    });
    const g = Math.exp(q.reduce((s, x) => s + Math.log(x), 0) / n);
    p = q.map((x) => x / g);
  }
  return p.map((x) => 1500 + 400 * Math.log10(x));
}

function arenaReport(file) {
  const { meta, matches, unclean } = loadArena(file);
  const names = meta.players.map((p) => p.label);
  const idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const n = names.length;
  const wins = names.map(() => names.map(() => 0));
  const games = names.map(() => names.map(() => 0));
  const per = names.map(() => ({ matches: 0, points: 0, rank: 0, shots: 0, hits: 0, damage: 0, decisions: 0, forced: 0, out: 0, ms: 0 }));

  for (const m of matches) {
    const score = Object.fromEntries(m.standings.map((s) => [s.seat, s.score]));
    for (const s of m.seats) {
      const a = per[idx[s.player]];
      a.matches++;
      a.points += s.points;
      a.rank += s.rank;
      a.shots += s.shots.count;
      a.hits += s.shots.hits;
      a.damage += s.shots.damage;
      a.decisions += s.decisions.total;
      a.forced += s.decisions.noAction + s.decisions.refused + s.decisions.late;
      a.out += s.usage.output || 0;
      a.ms += s.modelMs;
    }
    // Every pair of model seats in the match is one head-to-head game.
    for (const x of m.seats) {
      for (const y of m.seats) {
        if (x === y) continue;
        const i = idx[x.player];
        const j = idx[y.player];
        games[i][j]++;
        wins[i][j] += score[x.seat] > score[y.seat] ? 1 : score[x.seat] === score[y.seat] ? 0.5 : 0;
      }
    }
  }

  const elo = bradleyTerry(names, wins, games);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const order = names.map((_, i) => i).sort((a, b) => elo[b] - elo[a]);
  const out = [];
  const head = ['Player', 'Track', 'Rating', 'Matches', 'Win rate (95% CI)', 'Mean rank', 'Hit rate', 'Dmg/shot', 'Forced passes', 'Out tok/turn', 's/turn'];
  out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
  for (const i of order) {
    const a = per[i];
    const ci = wilson(a.points, a.matches);
    out.push(
      `| ${[
        names[i],
        meta.players[i].track,
        Math.round(elo[i]),
        a.matches,
        a.matches ? `${pct(a.points / a.matches)} (${pct(ci[0])}–${pct(ci[1])})` : '–',
        a.matches ? (a.rank / a.matches).toFixed(2) : '–',
        a.shots ? pct(a.hits / a.shots) : '–',
        a.shots ? (a.damage / a.shots).toFixed(1) : '–',
        a.decisions ? pct(a.forced / a.decisions) : '–',
        a.decisions ? Math.round(a.out / a.decisions) : '–',
        a.decisions ? (a.ms / a.decisions / 1000).toFixed(1) : '–',
      ].join(' | ')} |`,
    );
  }
  out.push('', 'Head to head (row beat column; ties count half):', '');
  const h2h = ['', ...order.map((i) => names[i])];
  out.push(`| ${h2h.join(' | ')} |`, `|${h2h.map(() => '---').join('|')}|`);
  for (const i of order) {
    out.push(`| ${[names[i], ...order.map((j) => (i === j ? '—' : games[i][j] ? `${pct(wins[i][j] / games[i][j])} (${games[i][j]})` : '–'))].join(' | ')} |`);
  }
  const notes = [
    '',
    `Engine ${meta.engine}; suite ${meta.suite.name} v${meta.suite.version} ${meta.suite.hash}; ${meta.rated ? 'rated (unseeded) matches, seating rotated' : `seating rotations: ${meta.rotations}`}${meta.bots.length ? `; bots in every match: ${meta.bots.join(', ')}` : ''}.`,
    'Rating: Bradley-Terry over every pairwise result, Elo scale (1500 = average), one virtual draw per pair.',
  ];
  if (unclean) notes.push(`${unclean} unclean match result(s) not counted; rerun the same command to replay them.`);
  if (n > 2 && matches.length && matches.some((m) => m.seats.length < n)) notes.push('**Warning:** some matches are missing players.');
  return out.concat(notes).join('\n');
}

module.exports = { runArena, arenaReport, arenaScenarios, labelPlayers, agentNames, bradleyTerry, loadArena };
