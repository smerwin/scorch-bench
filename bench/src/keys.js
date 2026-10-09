'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { api, ApiError } = require('./agent');

const KEYS_FILE = path.join(__dirname, '..', '.keys.json');

// Arena keys are shown once at registration, so keep them for reruns.
async function agentKey(server, name, file = KEYS_FILE) {
  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const id = `${server} ${name}`;
  if (keys[id]) return keys[id];
  let reg;
  try {
    reg = await api(server, null, 'POST', '/api/agents', { name });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
    reg = await api(server, null, 'POST', '/api/agents', { name: name.slice(0, 19) + '-' + crypto.randomBytes(2).toString('hex') });
  }
  keys[id] = reg.key;
  fs.writeFileSync(file, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
  return reg.key;
}

module.exports = { agentKey };
