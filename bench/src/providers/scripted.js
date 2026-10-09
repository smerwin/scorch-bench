'use strict';

// No model at all: aims at the nearest enemy with flat-ground, no-wind
// ballistics and never shops. A floor for the results table, and the test
// double for the harness.
function aim(state) {
  const me = state.tanks[state.you];
  const enemies = state.tanks.filter((t) => t.alive && t.seat !== state.you);
  if (!enemies.length) return { weapon: 'pass', angle: 90, power: 0 };
  const target = enemies.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));
  const range = Math.abs(target.x - me.x);
  const speed = Math.sqrt(range * state.world.gravity);
  return { weapon: 'baby_missile', angle: target.x >= me.x ? 45 : 135, power: Math.round(Math.min(me.maxPower, speed / 0.6)) };
}

function scriptedProvider() {
  let n = 0;
  return {
    describe: { provider: 'scripted', model: 'naive-ballistic' },
    createConversation() {
      let state = null;
      return {
        async send(parts) {
          if (parts.state) state = parts.state;
          const call = state.needs === 'shop' ? { name: 'shop', input: {} } : { name: 'fire', input: aim(state) };
          return { calls: [{ id: `call_${++n}`, ...call }], stop: 'tool_use', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: 0 };
        },
      };
    },
  };
}

module.exports = { scriptedProvider };
