#!/usr/bin/env node
'use strict';

// Minimal Scorch agent: no dependencies, Node 18+.
//
//   SCORCH_URL=https://scorch.smerwin.com node example-bot.js            # register + play 3 bots
//   SCORCH_KEY=sk_... node example-bot.js --join <matchId>               # join someone's lobby
//
// Strategy: aim at the nearest enemy by simulating shots against the
// terrain surface with the published physics, using the forecast wind.

const BASE = process.env.SCORCH_URL || 'http://localhost:3000';

async function api(base, key, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.error}`);
  return data;
}

// Mirrors the engine: semi-implicit Euler at 60 Hz, y grows downward.
function simulate(state, me, angle, power, wind) {
  const { width: W, height: H, gravity: g, surface, walls } = state.world;
  const a = (angle * Math.PI) / 180;
  let x = me.x + Math.cos(a) * 11;
  let y = me.y - 7 - Math.sin(a) * 11;
  let vx = Math.cos(a) * power * 0.6;
  let vy = -Math.sin(a) * power * 0.6;
  const ax = wind * 0.55;
  const dt = 1 / 60;
  for (let t = 0; t < 720; t++) {
    vx += ax * dt;
    vy += g * dt;
    const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 2));
    for (let i = 0; i < steps; i++) {
      x += (vx * dt) / steps;
      y += (vy * dt) / steps;
      if (x < 0 || x >= W) {
        if (walls === 'wrap') x = (x + W) % W;
        else if (walls === 'none') return null;
        else if (walls === 'concrete') return { x: Math.max(0, Math.min(W - 1, x)), y };
        else {
          x = x < 0 ? -x : 2 * (W - 1) - x;
          vx = -vx * (walls === 'rubber' ? 1 : walls === 'spring' ? 1.35 : 0.3);
          if (walls === 'padded') vy *= 0.6;
        }
      }
      if (y >= H || (y >= 0 && y >= surface[Math.floor(x)])) return { x, y };
      for (const t2 of state.tanks) {
        if (t2.alive && t2.seat !== me.seat && Math.hypot(x - t2.x, y - (t2.y - 4)) < 8) return { x, y, seat: t2.seat };
      }
    }
  }
  return null;
}

function aim(state) {
  const me = state.tanks[state.you];
  const enemies = state.tanks.filter((t) => t.alive && t.seat !== state.you);
  const target = enemies.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));
  const right = target.x > me.x;
  let best = { angle: right ? 45 : 135, power: 500, miss: Infinity };
  for (let a = 15; a <= 85; a += 2) {
    const angle = right ? a : 180 - a;
    for (let power = 100; power <= state.self.maxPower; power += 20) {
      const hit = simulate(state, me, angle, power, state.world.wind);
      if (!hit) continue;
      const miss = hit.seat === target.seat ? 0 : Math.hypot(hit.x - target.x, hit.y - target.y);
      const tooClose = Math.hypot(hit.x - me.x, hit.y - me.y) < 30;
      if (!tooClose && miss < best.miss) best = { angle, power, miss };
    }
  }
  return { target, ...best };
}

function chooseWeapon(state, distance) {
  const inv = state.self.inventory;
  for (const [id, minDist] of [['nuke', 120], ['baby_nuke', 70], ['mirv', 110], ['missile', 40]]) {
    if (inv[id] && distance > minDist) return id;
  }
  return 'baby_missile';
}

async function playMatch({ base = BASE, key, match, quiet = false }) {
  const say = (...a) => quiet || console.log(...a);
  let since = -1;
  for (;;) {
    const s = await api(base, key, 'GET', `/api/matches/${match}/state?wait=25&since=${since}`);
    since = s.version;
    if (s.status === 'done' || s.status === 'expired') {
      say('match over', s.standings);
      return s;
    }
    if (s.needs === 'shop') {
      const buy = {};
      if (s.self.cash >= 20000 && !s.self.inventory.shield) buy.shield = 1;
      if (s.self.cash >= 10000) buy.parachute = 1;
      buy.missile = 2;
      const r = await api(base, key, 'POST', `/api/matches/${match}/shop`, { buy });
      say(`round ${s.round + 1}: bought ${r.bought.join(', ') || 'nothing'}, cash ${r.cash}`);
    } else if (s.needs === 'move') {
      const shot = aim(s);
      const me = s.tanks[s.you];
      const items = [];
      if (!me.shield && s.self.inventory.shield) items.push('shield');
      for (let h = s.self.health; h <= 80 && (s.self.inventory.battery || 0) > items.filter((i) => i === 'battery').length; h += 10) items.push('battery');
      const weapon = chooseWeapon(s, Math.abs(shot.target.x - me.x));
      await api(base, key, 'POST', `/api/matches/${match}/move`, { weapon, angle: shot.angle, power: shot.power, items, target: shot.target.seat });
      say(`round ${s.round} turn ${s.turn}: ${weapon} at ${shot.target.name} (angle ${shot.angle}, power ${shot.power}, est. miss ${Math.round(shot.miss)}px, wind ${s.world.wind})`);
    }
  }
}

async function main() {
  let key = process.env.SCORCH_KEY;
  if (!key) {
    const name = process.env.SCORCH_NAME || 'example-bot-' + Math.random().toString(36).slice(2, 6);
    const reg = await api(BASE, null, 'POST', '/api/agents', { name });
    key = reg.key;
    console.log(`registered ${reg.name}; key ${key}`);
  }
  const joinAt = process.argv.indexOf('--join');
  let match;
  if (joinAt > 0) {
    match = process.argv[joinAt + 1];
    await api(BASE, key, 'POST', `/api/matches/${match}/join`);
  } else {
    const m = await api(BASE, key, 'POST', '/api/matches', { bots: ['shooter', 'poolshark', 'chooser'], settings: { rounds: 3 } });
    match = m.match;
  }
  console.log(`playing ${match} — watch at ${BASE}/?watch=${match}`);
  await playMatch({ key, match });
}

if (require.main === module) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

module.exports = { playMatch, simulate, api };
