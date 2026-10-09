#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { runArena, arenaReport } = require('./src/arena');
const { makeProvider, parsePlayerSpec } = require('./src/providers');

const USAGE = `Usage: node arena.js --player <spec> --player <spec> [...] [options]
       node arena.js --report results/arena-<name>.jsonl

Pits 2-10 models against each other in the same seeded matches.

  --player <spec>        provider:model?option=value&...  (repeat; 2 or more)
                           anthropic:claude-opus-5-5?effort=high
                           anthropic:claude-sonnet-5-5?effort=medium&track=tools
                           openai:gpt-5?extra={"reasoning_effort":"high"}
                           openai:vendor/model?base-url=https://openrouter.ai/api/v1&api-key-env=OPENROUTER_API_KEY
                           relay:my-agent?relay-dir=relay/my-agent   (an outside agent answers via files)
                           scripted                      (no-LLM baseline)
                         options: effort, thinking, track, base-url, api-key-env, relay-dir, extra, name
  --players <file>       JSON array of player configs instead of --player
                         ({provider, model, effort, thinking, track, baseUrl, apiKeyEnv, relayDir, extra, name})
  --bots <list>          built-in bots added to every match, e.g. cyborg,spoiler
  --rotations all|1      all (default): play each seed once per player with seating
                         rotated, so everyone gets every start position; 1: once per seed
  --seeds <n>            use only the first n seeds of the suite
  --server <url>         Scorch server (default http://localhost:3000)
  --suite <file>         settings and seeds (default suite.json)
  --concurrency <n>      matches in parallel, 1-3 (default 3)
  --out <file>           results file (default results/arena-<players>.jsonl)`;

const { values: opt } = parseArgs({
  options: {
    player: { type: 'string', multiple: true },
    players: { type: 'string' },
    bots: { type: 'string' },
    rotations: { type: 'string', default: 'all' },
    seeds: { type: 'string' },
    server: { type: 'string', default: 'http://localhost:3000' },
    suite: { type: 'string', default: path.join(__dirname, 'suite.json') },
    concurrency: { type: 'string', default: '3' },
    out: { type: 'string' },
    report: { type: 'string' },
    help: { type: 'boolean' },
  },
});

function fail(msg) {
  console.error(msg + '\n\n' + USAGE);
  process.exit(2);
}

async function main() {
  if (opt.help) return console.log(USAGE);
  if (opt.report) return console.log(arenaReport(opt.report));
  let configs;
  try {
    configs = opt.players ? JSON.parse(fs.readFileSync(opt.players, 'utf8')) : (opt.player || []).map(parsePlayerSpec);
    configs.forEach((c) => makeProvider(c)); // validate before touching the server
  } catch (err) {
    fail(err.message);
  }
  if (!Array.isArray(configs) || configs.length < 2) fail('give at least two players');
  if (!['all', '1'].includes(opt.rotations)) fail('--rotations must be all or 1');
  const suiteText = fs.readFileSync(opt.suite, 'utf8');
  const suite = JSON.parse(suiteText);
  const seeds = opt.seeds ? suite.seeds.slice(0, Number(opt.seeds)) : suite.seeds;
  const bots = opt.bots ? opt.bots.split(',').map((b) => b.trim()).filter(Boolean) : [];
  const tag = configs.map((c) => c.name || c.model || c.provider).join('-vs-').toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(0, 100);
  const out = opt.out || path.join(__dirname, 'results', `arena-${tag}${bots.length ? '+bots' : ''}.jsonl`);

  const { failures } = await runArena({ server: opt.server, configs, suite, suiteText, seeds, bots, rotations: opt.rotations, concurrency: opt.concurrency, out, makeProvider });
  console.log('\n' + arenaReport(out));
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
