#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHORT = { moron: 'Moron', shooter: 'Shooter', poolshark: 'Poolshark', tosser: 'Tosser', chooser: 'Chooser', spoiler: 'Spoiler', cyborg: 'Cyborg' };

function load(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = lines.find((l) => l.type === 'meta');
  // The last clean result per scenario counts; unclean ones are reruns-in-waiting.
  const byScenario = new Map();
  let unclean = 0;
  for (const l of lines) {
    if (l.type !== 'match') continue;
    if (l.clean) byScenario.set(l.scenario, l);
    else unclean++;
  }
  return { file, meta, matches: [...byScenario.values()], unclean };
}

// Wilson score interval; a tie counts as half a win.
function wilson(points, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = points / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const pct = (x) => `${Math.round(x * 100)}%`;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

function summarize(run) {
  const m = run.matches;
  const points = sum(m, (x) => x.points);
  const duels = {};
  for (const x of m.filter((x) => x.kind === 'duel')) {
    const d = (duels[x.bots[0]] ||= { points: 0, n: 0 });
    d.points += x.points;
    d.n++;
  }
  const ffa = m.filter((x) => x.kind === 'ffa');
  const shots = sum(m, (x) => x.shots.count);
  const decisions = sum(m, (x) => x.decisions.total);
  const forced = sum(m, (x) => x.decisions.noAction + x.decisions.refused + x.decisions.late);
  return {
    model: run.meta.model,
    provider: run.meta.provider,
    track: run.meta.track,
    effort: run.meta.effort || null,
    engine: run.meta.engine,
    suite: run.meta.suite,
    matches: m.length,
    unclean: run.unclean,
    winRate: m.length ? points / m.length : 0,
    ci: wilson(points, m.length),
    duels: Object.fromEntries(Object.entries(duels).map(([k, d]) => [k, d.points / d.n])),
    ffaRank: ffa.length ? sum(ffa, (x) => x.rank) / ffa.length : null,
    hitRate: shots ? sum(m, (x) => x.shots.hits) / shots : 0,
    damagePerShot: shots ? sum(m, (x) => x.shots.damage) / shots : 0,
    forcedPassRate: decisions ? forced / decisions : 0,
    outputTokensPerDecision: decisions ? sum(m, (x) => x.usage.output || 0) / decisions : 0,
    secondsPerDecision: decisions ? sum(m, (x) => x.modelMs) / decisions / 1000 : 0,
  };
}

function report(files, { json = false } = {}) {
  const rows = files.map(load).map(summarize).sort((a, b) => b.winRate - a.winRate);
  if (json) return JSON.stringify(rows, null, 2);
  const bots = Object.keys(SHORT).filter((b) => rows.some((r) => b in r.duels));
  const head = ['Model', 'Track', 'Matches', 'Win rate (95% CI)', ...bots.map((b) => `vs ${SHORT[b]}`), 'FFA rank', 'Hit rate', 'Dmg/shot', 'Forced passes', 'Out tok/turn', 's/turn'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) {
    const name = r.effort ? `${r.model} (${r.effort})` : r.model;
    lines.push(
      `| ${[
        name,
        r.track,
        r.matches + (r.unclean ? ` (+${r.unclean} unclean)` : ''),
        `${pct(r.winRate)} (${pct(r.ci[0])}–${pct(r.ci[1])})`,
        ...bots.map((b) => (b in r.duels ? pct(r.duels[b]) : '–')),
        r.ffaRank === null ? '–' : r.ffaRank.toFixed(1),
        pct(r.hitRate),
        r.damagePerShot.toFixed(1),
        pct(r.forcedPassRate),
        Math.round(r.outputTokensPerDecision),
        r.secondsPerDecision.toFixed(1),
      ].join(' | ')} |`,
    );
  }
  const engines = new Set(rows.map((r) => r.engine));
  const suites = new Set(rows.map((r) => `${r.suite.name} v${r.suite.version} ${r.suite.hash}`));
  const notes = [`Engine ${[...engines].join(', ')}; suite ${[...suites].join(', ')}.`];
  if (engines.size > 1 || suites.size > 1) notes.push('**Warning:** these runs used different engines or suites and are not directly comparable.');
  return lines.join('\n') + '\n\n' + notes.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    const dir = path.join(__dirname, 'results');
    files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)) : [];
  }
  if (!files.length) {
    console.error('No results files. Run `node run.js ...` first, or pass files.');
    process.exit(2);
  }
  console.log(report(files, { json }));
}

module.exports = { report, summarize, load, wilson };
