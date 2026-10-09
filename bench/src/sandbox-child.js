'use strict';

// Runs one snippet of model-written code. Started by sandbox.js under
// `node --permission` with an empty environment, so it has no file, network,
// child-process or worker access and no API keys to find.
const util = require('node:util');
const vm = require('node:vm');

const TIMEOUT_MS = 10_000;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const { code, state, selftest } = JSON.parse(input);
  if (selftest) {
    const p = process.permission;
    const locked = !!p && !p.has('net') && !p.has('fs.read') && !p.has('fs.write') && !p.has('child') && !p.has('worker');
    process.stdout.write(JSON.stringify({ locked, env: Object.keys(process.env) }));
    return;
  }
  const out = [];
  const fmt = (v) => (typeof v === 'string' ? v : util.inspect(v, { depth: 4, maxArrayLength: 100, breakLength: 120 }));
  const log = (...args) => out.push(args.map(fmt).join(' '));
  const context = vm.createContext({ STATE: state, console: { log, info: log, warn: log, error: log } });
  let error = null;
  try {
    const result = vm.runInContext(code, context, { timeout: TIMEOUT_MS, filename: 'snippet.js' });
    if (result !== undefined && !out.length) out.push(fmt(result));
  } catch (e) {
    error = e && e.stack ? String(e.stack).split('\n').filter((l, i) => i === 0 || !/^\s+at /.test(l) || l.includes('snippet.js')).slice(0, 6).join('\n') : String(e);
  }
  process.stdout.write(JSON.stringify({ out: out.join('\n'), error }));
});
