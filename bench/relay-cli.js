#!/usr/bin/env node
'use strict';

// The model's side of the relay provider (src/providers/relay.js).
//   node relay-cli.js start  <convDir>          system prompt, tools and the first message
//   node relay-cli.js answer <convDir> '<json>' send {"name":"fire","input":{...}} (or {"calls":[...]}),
//                                               then wait for and print the next message
//   node relay-cli.js history <convDir>         the whole conversation so far (to take over a round)
const fs = require('node:fs');
const path = require('node:path');

const [cmd, conv, arg] = process.argv.slice(2);
if (!cmd || !conv) {
  console.error('usage: relay-cli.js start|answer|history <convDir> [json]');
  process.exit(2);
}
const pad = (n) => String(n).padStart(4, '0');
const read = (f) => JSON.parse(fs.readFileSync(path.join(conv, f), 'utf8'));
const exists = (f) => fs.existsSync(path.join(conv, f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastReq = () => fs.readdirSync(conv).filter((f) => /^req-\d+\.json$/.test(f)).sort().pop();

function render(req) {
  const out = [];
  for (const r of req.toolResults) out.push(`[tool result]${r.isError ? ' ERROR:' : ''} ${r.text}`);
  if (req.text) out.push(req.text);
  return `=== MESSAGE ${req.seq} ===\n${out.join('\n\n')}`;
}

// Waits for the request after `seq`; returns it, or a note that the round ended.
async function next(seq, limitMs = 500_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (exists(`req-${pad(seq + 1)}.json`)) return render(read(`req-${pad(seq + 1)}.json`));
    if (exists('closed')) return '=== ROUND OVER === This conversation has ended. You are done; stop now.';
    await sleep(300);
  }
  return `=== STILL WAITING === No new message yet. Run: node relay-cli.js wait ${conv} ${seq}`;
}

(async () => {
  if (cmd === 'start') {
    const meta = read('meta.json');
    console.log(`=== SYSTEM PROMPT ===\n${meta.system}\n\n=== TOOLS (reply with one of these) ===\n${JSON.stringify(meta.tools, null, 1)}\n`);
    console.log(await next(0));
  } else if (cmd === 'wait') {
    console.log(await next(Number(arg)));
  } else if (cmd === 'answer') {
    const last = lastReq();
    if (!last) throw new Error('nothing to answer yet; run start');
    const seq = read(last).seq;
    if (exists(`res-${pad(seq)}.json`)) return console.log(`Message ${seq} was already answered.\n` + (await next(seq)));
    let body;
    try {
      body = JSON.parse(arg);
    } catch (e) {
      return console.log(`Your reply was not valid JSON (${e.message}); nothing was sent. Try again.`);
    }
    const calls = body.calls || (body.name ? [{ name: body.name, input: body.input ?? {} }] : []);
    fs.writeFileSync(path.join(conv, `res-${pad(seq)}.json`), JSON.stringify({ calls, at: Date.now() }));
    console.log(await next(seq));
  } else if (cmd === 'history') {
    const meta = read('meta.json');
    console.log(`=== SYSTEM PROMPT ===\n${meta.system}\n\n=== TOOLS ===\n${JSON.stringify(meta.tools, null, 1)}\n`);
    for (let s = 1; exists(`req-${pad(s)}.json`); s++) {
      console.log(render(read(`req-${pad(s)}.json`)));
      if (exists(`res-${pad(s)}.json`)) console.log(`=== YOUR REPLY ${s} ===\n${JSON.stringify(read(`res-${pad(s)}.json`).calls)}`);
    }
    if (exists('closed')) console.log('=== ROUND OVER ===');
  } else throw new Error(`unknown command ${cmd}`);
})();
