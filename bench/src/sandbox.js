'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const CHILD = path.join(__dirname, 'sandbox-child.js');
const KILL_MS = 15_000;
const MAX_OUTPUT = 20_000;

function runChild(payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--permission', '--max-old-space-size=256', CHILD], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_MS);
    child.stdout.on('data', (c) => {
      if (stdout.length < 4 * MAX_OUTPUT) stdout += c;
    });
    child.stderr.on('data', (c) => {
      if (stderr.length < 4000) stderr += c;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ out: '', error: signal ? 'killed: took too long or used too much memory' : `sandbox exited (${code}): ${stderr.slice(0, 500)}` });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

// Returns { text, isError } ready to hand back to the model.
async function runJavascript(code, state) {
  if (typeof code !== 'string' || !code.trim()) return { text: 'code must be a non-empty string', isError: true };
  const r = await runChild({ code, state });
  let text = r.out || '';
  if (r.error) text += (text ? '\n' : '') + r.error;
  if (!text) text = '(no output — print results with console.log)';
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + `\n… (output truncated at ${MAX_OUTPUT} chars)`;
  return { text, isError: !!r.error };
}

// The tools track is only fair if model code really is cut off from the
// network and the host; refuse to run on a Node without that guarantee.
async function assertSandboxed() {
  const r = await runChild({ selftest: true });
  const leaked = (r.env || []).filter((k) => k !== '__CF_USER_TEXT_ENCODING'); // macOS sets this on every process
  if (!r.locked || leaked.length) throw new Error(`code sandbox is not locked down on Node ${process.version} (needs Node >= 25 for network restrictions)`);
}

module.exports = { runJavascript, assertSandboxed };
