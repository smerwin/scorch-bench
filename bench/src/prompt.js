'use strict';

// Everything the model is told. Identical for every provider so results are
// comparable; any change here is a new harness version.
const fs = require('node:fs');
const path = require('node:path');

const RULES = fs.readFileSync(path.join(__dirname, '..', '..', 'AGENTS.md'), 'utf8');

function systemPrompt(track) {
  const tools =
    track === 'tools'
      ? 'You also have `run_javascript`, which runs JavaScript in a sandbox with no network or file access. The state you were last shown is available there as the global `STATE`. Each call starts from scratch, may run for up to 10 seconds, and returns whatever you print with console.log.'
      : 'You have no code execution. Work out your shots yourself.';
  return `You are playing Scorch, a turn-based artillery game, as one tank in a match against built-in bots. You are being evaluated on how well you play: finish the match with the highest score you can.

A harness handles the HTTP API for you. Whenever you need to act, you will be shown your current view of the match: the same state object the API returns, described in the rules below. Act by calling one action tool:
- \`shop\` when \`needs\` is "shop" (before each round),
- \`fire\` when \`needs\` is "move" (once per turn).
They take the same fields as the request bodies for POST /api/matches/:id/shop and POST /api/matches/:id/move. If the server rejects an action, you will see the error and can try again.

${tools}

Each round starts a fresh conversation; you will be told the scores so far.

<rules>
${RULES}
</rules>`;
}

const FIRE = {
  name: 'fire',
  description: 'Take your turn (POST /move). Call exactly once when needs is "move". Use weapon "pass" to skip.',
  input_schema: {
    type: 'object',
    properties: {
      weapon: { type: 'string', description: 'Weapon id from your inventory; "baby_missile" is unlimited; "pass" skips the turn.' },
      angle: { type: 'number', description: 'Degrees: 0 = right, 90 = straight up, 180 = left.' },
      power: { type: 'number', description: '0-1000, capped at your maxPower.' },
      items: { type: 'array', items: { type: 'string' }, description: 'Batteries / shields to use before firing, in order.' },
      drive: { type: 'integer', description: 'Pixels to drive before firing (needs fuel). Negative is left.' },
      guidance: { type: 'string', description: 'Guidance item to spend on this shot.' },
      target: { type: 'integer', description: 'Seat to aim guidance or Lazy Boy at.' },
      trigger: { type: 'boolean', description: 'Spend a contact trigger.' },
      parachutes: { type: 'boolean', description: 'Auto-deploy parachutes when falling.' },
    },
    required: ['weapon', 'angle', 'power'],
    additionalProperties: false,
  },
};

const SHOP = {
  name: 'shop',
  description: 'Buy and sell before the round (POST /shop). Quantities are bundles. Call with {} to buy nothing.',
  input_schema: {
    type: 'object',
    properties: {
      buy: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Item or weapon id -> number of bundles to buy.' },
      sell: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Item or weapon id -> number of bundles to sell.' },
    },
    additionalProperties: false,
  },
};

const RUN_JS = {
  name: 'run_javascript',
  description: 'Run JavaScript in a sandbox (no network, no files, 10 s limit). The latest state is the global STATE. Returns console.log output.',
  input_schema: {
    type: 'object',
    properties: { code: { type: 'string', description: 'A script; print results with console.log.' } },
    required: ['code'],
    additionalProperties: false,
  },
};

function toolsFor(track) {
  return track === 'tools' ? [FIRE, SHOP, RUN_JS] : [FIRE, SHOP];
}

function stateMessage(state, { scores } = {}) {
  const head = [];
  if (scores) head.push(`Scores so far: ${scores}.`);
  if (state.needs === 'shop') head.push(`Shopping before round ${state.round + 1} of ${state.rounds}. Call \`shop\`.`);
  else head.push(`Round ${state.round} of ${state.rounds}, turn ${state.turn}. Call \`fire\`.`);
  return `${head.join(' ')}\n\n${JSON.stringify(state)}`;
}

const NUDGE = 'You did not call an action tool. Call `fire` (or `shop` while shopping) now.';

module.exports = { systemPrompt, toolsFor, stateMessage, NUDGE };
