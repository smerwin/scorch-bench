'use strict';

// How much an AI wants to fire each weapon, and how far the target must be
// before it's safe to use it.
const AI_WEAPON_VALUE = {
  baby_missile: [1, 25], missile: [3, 35], baby_nuke: [7, 60], nuke: [12, 100],
  leapfrog: [5, 50], funky_bomb: [8, 90], mirv: [9, 110], deaths_head: [14, 150],
  napalm: [6, 60], hot_napalm: [10, 80], baby_roller: [2, 30], roller: [4, 40], heavy_roller: [8, 60],
  baby_sandhog: [4, 35], sandhog: [7, 50], heavy_sandhog: [10, 60], laser: [6, 0], plasma_blast: [6, 0],
};

const AI = {
  plan(game, p) {
    const prof = p.ai;
    // Defensive housekeeping first.
    while (p.health <= 80 && p.count('battery') > 0 && game.useItem(p, 'battery'));
    if (!p.shield) {
      const best = SHIELD_IDS.slice().reverse().find((id) => p.count(id) > 0);
      if (best && (prof.smart || chance(0.6))) game.useItem(p, best);
    }

    const target = this.pickTarget(game, p, prof);
    if (!target) return { angle: p.angle, power: p.power, weapon: 'baby_missile', target: null };
    const d = Math.abs(target.x - p.x);

    if (this.buried(game, p)) {
      const dig = ['riot_blast', 'riot_charge', 'heavy_riot_bomb', 'riot_bomb', 'baby_digger'].find((id) => p.count(id) > 0);
      if (dig) {
        const up = WEAPON[dig].kind === 'riotcharge' ? (target.x > p.x ? 65 : 115) : 90;
        return { angle: up, power: Math.min(p.maxPower, 200), weapon: dig, target };
      }
    }

    const weapon = this.chooseWeapon(game, p, target, d, prof);
    const w = WEAPON[weapon];

    if (w.kind === 'plasma') return { angle: 90, power: p.maxPower, weapon, target };
    if (w.kind === 'laser') {
      const a = Math.atan2(p.y - 7 - target.cy, target.cx - p.x) / DEG;
      return { angle: clamp(a + gauss() * prof.errA * 0.3, 0, 180), power: p.maxPower, weapon, target };
    }

    if (p.type === 'moron' && chance(0.4)) {
      return { angle: rand(15, 165), power: rand(150, p.maxPower), weapon, target };
    }

    const sol = this.solve(game, p, target, prof.wind, false) || { angle: target.x > p.x ? 45 : 135, power: p.maxPower * 0.6 };
    let scale = 1;
    if (prof.learn) {
      const k = target.index;
      const shots = (p.memory[k] = (p.memory[k] || 0) + 1);
      scale = Math.max(0.12, 1 / (1 + (shots - 1) * 0.9));
    }
    let guidance = null;
    if (prof.smart && chance(0.5)) {
      guidance = ['horz_guidance', 'vert_guidance', 'heat_guidance', 'ballistic_guidance'].find((id) => p.count(id) > 0) || null;
    }
    return {
      angle: clamp(sol.angle + gauss() * prof.errA * scale, 0, 180),
      power: clamp(sol.power + gauss() * prof.errP * scale, 30, p.maxPower),
      weapon,
      target,
      guidance,
    };
  },

  pickTarget(game, p, prof) {
    const enemies = game.players.filter((t) => t.alive && t !== p);
    if (!enemies.length) return null;
    if (p.type === 'moron' || p.type === 'shooter') return pick(enemies);
    if (prof.vindictive) {
      // Go after whoever hurt us most this round, otherwise the leader.
      let best = null;
      let bv = 0;
      for (const t of enemies) {
        const v = p.grudges[t.index] || 0;
        if (v > bv) {
          bv = v;
          best = t;
        }
      }
      if (best) return best;
      return enemies.reduce((a, b) => (b.score > a.score ? b : a));
    }
    if (prof.smart) {
      // Prefer weak tanks, then close ones.
      return enemies.reduce((a, b) => (b.health + Math.abs(b.x - p.x) * 0.15 < a.health + Math.abs(a.x - p.x) * 0.15 ? b : a));
    }
    if (p.target && p.target.alive && chance(0.7)) return p.target;
    return enemies.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a));
  },

  buried(game, p) {
    const m = p.muzzle();
    let solid = 0;
    for (const [dx, dy] of [[0, -12], [-6, -12], [6, -12], [0, -18]]) if (game.terrain.solid(p.x + dx, p.y + dy)) solid++;
    return solid >= 2 || game.terrain.solid(m.x, m.y);
  },

  chooseWeapon(game, p, target, d, prof) {
    const options = Object.keys(AI_WEAPON_VALUE).filter((id) => p.count(id) > 0);
    const safe = options.filter((id) => {
      const [, minD] = AI_WEAPON_VALUE[id];
      const kind = WEAPON[id].kind;
      if (kind === 'plasma') return d < 60;
      if (kind === 'laser') return this.lineOfSight(game, p, target);
      return d > minD;
    });
    if (!safe.length) return 'baby_missile';
    if (p.type === 'moron') return pick(safe);
    safe.sort((a, b) => AI_WEAPON_VALUE[b][0] - AI_WEAPON_VALUE[a][0]);
    // Smart AIs go big; others hold their best toys back some of the time.
    if (prof.smart) return chance(0.8) ? safe[0] : pick(safe.slice(0, 3));
    return chance(0.5) ? safe[0] : pick(safe);
  },

  lineOfSight(game, p, t) {
    const x0 = p.x;
    const y0 = p.y - 7;
    const n = Math.ceil(dist(x0, y0, t.cx, t.cy));
    for (let i = 14; i < n - 6; i += 2) {
      const x = lerp(x0, t.cx, i / n);
      const y = lerp(y0, t.cy, i / n);
      if (game.terrain.solid(x, y)) return false;
    }
    return true;
  },

  // Search angle/power for the shot that lands closest to `target`.
  solve(game, p, target, useWind, precise) {
    const right = target.x > p.x || (game.walls === 'wrap' && Math.abs(target.x - p.x) > game.W / 2 && target.x < p.x);
    const maxP = p.maxPower;
    if (maxP < 30) return null;
    const score = (r) => {
      if (r.tank === target) return 0;
      if (r.lost) return 1e5;
      if (r.tank === p || dist(r.x, r.y, p.cx, p.cy) < 30) return 1e6;
      const d = dist(r.x, r.y, target.cx, target.cy);
      return r.tank ? d * 0.5 : d;
    };
    const candidates = [];
    const aStep = precise ? 2 : 3;
    for (let a = 8; a <= 86; a += aStep) {
      const ang = right ? a : 180 - a;
      for (let pw = 80; pw <= maxP; pw += 45) {
        const s = score(game.simulate(p, ang, pw, useWind));
        candidates.push({ angle: ang, power: pw, s });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.s - b.s);
    // Refine a few of the best arcs so the AI doesn't always pick the same one.
    const seeds = candidates.slice(0, precise ? 5 : 2);
    let best = null;
    for (const c of seeds) {
      for (let da = -2; da <= 2; da += 0.5) {
        for (let dp = -42; dp <= 42; dp += 6) {
          const ang = clamp(c.angle + da, 0, 180);
          const pw = clamp(c.power + dp, 10, maxP);
          const s = score(game.simulate(p, ang, pw, useWind));
          if (!best || s < best.s || (s === best.s && chance(0.3))) best = { angle: ang, power: pw, s };
        }
      }
    }
    return best;
  },

  shop(p, settings) {
    const prof = p.ai;
    const avail = (x) => x.tier <= settings.armsLevel;
    let budget = p.cash * prof.buy;
    const buy = (thing) => {
      if (!thing || !avail(thing) || thing.price > budget || thing.price > p.cash) return false;
      p.cash -= thing.price;
      budget -= thing.price;
      p.add(thing.id, thing.qty);
      return true;
    };
    if (p.type !== 'moron') {
      if (p.count('parachute') < 2) buy(ITEM.parachute);
      if (p.count('battery') < 3) buy(ITEM.battery);
      if (!SHIELD_IDS.some((id) => p.count(id) > 0)) {
        const sh = ['heavy_shield', 'force_shield', 'shield'].map((id) => ITEM[id]).find((i) => avail(i) && i.price <= budget * 0.5);
        buy(sh);
      }
      if (prof.smart && p.count('heat_guidance') < 2 && budget > 60000) buy(ITEM.heat_guidance);
    }
    const attack = Object.keys(AI_WEAPON_VALUE).map((id) => WEAPON[id]).filter((w) => avail(w) && !w.infinite);
    for (let i = 0; i < 12; i++) {
      const afford = attack.filter((w) => w.price <= budget);
      if (!afford.length) break;
      let w;
      if (p.type === 'moron') w = pick(afford);
      else {
        afford.sort((a, b) => AI_WEAPON_VALUE[b.id][0] / Math.sqrt(b.price) - AI_WEAPON_VALUE[a.id][0] / Math.sqrt(a.price));
        w = chance(0.6) ? afford[0] : pick(afford);
      }
      buy(w);
    }
    if (p.count('riot_charge') < 2 && p.type !== 'moron') buy(WEAPON.riot_charge);
  },
};
