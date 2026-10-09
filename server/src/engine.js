'use strict';

// Runs the browser game's own scripts (../../js) headless. Each match gets a
// fresh VM context because the engine keeps its RNG in a global, and
// interleaved matches must not share one random stream.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILES = ['util.js', 'data.js', 'terrain.js', 'player.js', 'ai.js', 'game.js'];
const EXPORTS = [
  'RNG', 'Game', 'Player', 'AI', 'WEAPONS', 'WEAPON', 'ITEMS', 'ITEM', 'AI_TYPES', 'AI_KEYS', 'SHIELD_IDS',
  'DEFAULT_SETTINGS', 'PHYS', 'ECON', 'PLAYER_COLORS', 'WALL_TYPES', 'THEMES', 'TERRAIN_TYPES', 'DIRECT_KINDS',
];

const jsDir = process.env.SCORCH_JS_DIR || path.join(__dirname, '..', '..', 'js');
const source = FILES.map((f) => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n;\n') + `\n;({ ${EXPORTS.join(', ')} })`;
const script = new vm.Script(source, { filename: 'scorch-engine.js' });

const noop = () => {};
const silent = new Proxy({}, { get: (_, k) => (k === 'enabled' ? false : noop) });

function createEngine() {
  const ctx = vm.createContext({ Sound: silent, console });
  return script.runInContext(ctx);
}

module.exports = { createEngine };
