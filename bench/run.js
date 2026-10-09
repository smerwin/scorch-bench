#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { playMatch, api } = require('./src/agent');
const { agentKey } = require('./src/keys');
const { assertSandboxed } = require('./src/sandbox');
const { makeProvider } = require('./src/providers');
const { report } = require('./report');
const { version } = require('./package.json');

const USAGE = `Usage: node run.js --provider <anthropic|openai|scripted> --model <id> [options]

  --track reasoning|tools   no code execution (default), or a sandboxed run_javascript tool
  --effort <level>          anthropic: output_config.effort
  --thinking adaptive|off   anthropic: adaptive thinking (default) or omit the parameter
  --base-url <url>          openai: API base (default https://api.openai.com/v1)
  --api-key-env <NAME>      openai: env var holding the key (default OPENAI_API_KEY)
  --extra '<json>'          openai: merged into every request body
  --server <url>            Scorch server (default http://localhost:3000)
  --suite <file>            default suite.json
  --seeds <n>               use only the first n seeds of the suite
  --only <text>             only scenarios whose id contains text (e.g. duel-cyborg)
  --concurrency <n>         matches in parallel, 1-3 (default 3)
  --out <file>              results file (default results/<model>-<track>[-<effort>].jsonl)
  --name <agent>            arena agent name (default derived from the model)`;

const { values: opt } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    track: { type: 'string', default: 'reasoning' },
    effort: { type: 'string' },
    thinking: { type: 'string', default: 'adaptive' },
    'base-url': { type: 'string' },
    'api-key-env': { type: 'string' },
    extra: { type: 'string' },
    server: { type: 'string', default: 'http://localhost:3000' },
    suite: { type: 'string', default: path.join(__dirname, 'suite.json') },
    seeds: { type: 'string' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    out: { type: 'string' },
    name: { type: 'string' },
    help: { type: 'boolean' },
  },
});

function fail(msg) {
  console.error(msg + '\n\n' + USAGE);
  process.exit(2);
}

function loadProvider() {
  try {
    return makeProvider({ provider: opt.provider, model: opt.model, effort: opt.effort, thinking: opt.thinking, baseUrl: opt['base-url'], apiKeyEnv: opt['api-key-env'], extra: opt.extra ? JSON.parse(opt.extra) : {} });
  } catch (err) {
    fail(err.message);
  }
}

function scenarios(suite) {
  const seeds = opt.seeds ? suite.seeds.slice(0, Number(opt.seeds)) : suite.seeds;
  const list = [];
  for (const seed of seeds) {
    for (const bot of suite.duels) list.push({ id: `duel-${bot}-${seed}`, kind: 'duel', bots: [bot], seed });
    suite.ffa.forEach((bots, i) => list.push({ id: `ffa${i + 1}-${seed}`, kind: 'ffa', bots, seed }));
  }
  return opt.only ? list.filter((s) => s.id.includes(opt.only)) : list;
}

async function main() {
  if (opt.help) return console.log(USAGE);
  if (!['reasoning', 'tools'].includes(opt.track)) fail('--track must be reasoning or tools');
  const provider = loadProvider();
  const suiteText = fs.readFileSync(opt.suite, 'utf8');
  const suite = JSON.parse(suiteText);
  const todo = scenarios(suite);
  if (!todo.length) fail('no scenarios match');
  const info = await api(opt.server, null, 'GET', '/api');
  if (opt.track === 'tools') await assertSandboxed();

  const slug = provider.describe.model.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const out = opt.out || path.join(__dirname, 'results', `${slug}-${opt.track}${opt.effort ? '-' + opt.effort : ''}.jsonl`);
  const meta = {
    type: 'meta',
    harness: version,
    suite: { name: suite.name, version: suite.version, hash: crypto.createHash('sha256').update(suiteText).digest('hex').slice(0, 12) },
    engine: info.engine,
    server: opt.server,
    track: opt.track,
    ...provider.describe,
    startedAt: new Date().toISOString(),
  };

  // Resume: keep clean results from an earlier run with the same setup.
  const done = new Set();
  if (fs.existsSync(out)) {
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const prev = lines.find((l) => l.type === 'meta');
    for (const k of ['harness', 'engine', 'track', 'provider', 'model', 'effort', 'thinking', 'baseUrl', 'extra']) {
      if (prev && JSON.stringify(prev[k]) !== JSON.stringify(meta[k])) throw new Error(`${out} was produced with a different ${k} (${JSON.stringify(prev[k])}); use --out for a new file`);
    }
    if (prev && prev.suite.hash !== meta.suite.hash) throw new Error(`${out} was produced with a different suite; use --out for a new file`);
    for (const l of lines) if (l.type === 'match' && l.clean) done.add(l.scenario);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(meta) + '\n');
  }
  const queue = todo.filter((s) => !done.has(s.id));
  console.log(`${meta.model} (${opt.track}): ${queue.length} of ${todo.length} scenarios to play, engine ${info.engine}, writing ${path.relative(process.cwd(), out)}`);

  const key = await agentKey(opt.server, opt.name || `bench-${slug}`.slice(0, 24).replace(/-$/, ''));
  const settings = suite.settings;
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < queue.length) {
      const scenario = queue[next++];
      try {
        const r = await playMatch({ base: opt.server, key, provider, track: opt.track, scenario, settings });
        fs.appendFileSync(out, JSON.stringify(r) + '\n');
        const d = r.decisions;
        console.log(`${scenario.id.padEnd(22)} rank ${r.rank}/${r.bots.length + 1}  ${r.points === 1 ? 'WIN ' : r.points ? 'TIE ' : 'loss'}  hits ${r.shots.hits}/${r.shots.count}  dmg ${r.shots.damage}  passes ${d.noAction + d.refused + d.late}${r.clean ? '' : '  (unclean: will rerun)'}`);
      } catch (err) {
        failures++;
        console.error(`${scenario.id}: ${err.stack || err}`);
      }
    }
  };
  const n = Math.max(1, Math.min(3, Number(opt.concurrency) || 3));
  await Promise.all(Array.from({ length: n }, worker));
  console.log('\n' + report([out]));
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
