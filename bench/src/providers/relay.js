'use strict';

// Relays each model call through files so an outside agent (for example a
// Claude Code subagent) can play as the model. The harness, prompt, tools and
// scoring are unchanged; only the transport differs.
//
// Layout under `dir`, one folder per conversation (one per round):
//   <conv>/meta.json         {label, system, tools}
//   <conv>/req-0001.json     what the model is sent (tool results and/or text)
//   <conv>/res-0001.json     the model's reply: {calls: [{name, input}], text?}
//   <conv>/closed            the round is over
// `node relay-cli.js` is the model's side of this protocol.
const fs = require('node:fs');
const path = require('node:path');

const pad = (n) => String(n).padStart(4, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function relayProvider({ model, dir, timeoutMs = 400_000 }) {
  if (!dir) throw new Error('--relay-dir is required');
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    describe: { provider: 'relay', model },
    createConversation({ system, tools, label }) {
      const conv = path.join(dir, (label || `conv-${Date.now()}`).replace(/[^\w.-]+/g, '_'));
      fs.rmSync(conv, { recursive: true, force: true });
      fs.mkdirSync(conv, { recursive: true });
      fs.writeFileSync(path.join(conv, 'meta.json'), JSON.stringify({ label, system, tools }));
      let seq = 0;
      return {
        async send({ toolResults = [], text }) {
          const k = pad(++seq);
          const resFile = path.join(conv, `res-${k}.json`);
          fs.writeFileSync(path.join(conv, `req-${k}.json`), JSON.stringify({ seq, toolResults, text: text || null, at: Date.now() }));
          const t0 = Date.now();
          let res = null;
          while (Date.now() - t0 < timeoutMs) {
            try {
              res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
              break;
            } catch {}
            await sleep(250);
          }
          // No reply in time counts as a turn with no action; the harness nudges, then passes.
          const calls = (res?.calls || []).map((c) => ({ id: `call_${++n}`, name: c.name, input: c.input ?? null }));
          return { calls, stop: calls.length ? 'tool_use' : 'end_turn', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: Date.now() - t0 };
        },
        close() {
          fs.writeFileSync(path.join(conv, 'closed'), '');
        },
      };
    },
  };
}

module.exports = { relayProvider };
