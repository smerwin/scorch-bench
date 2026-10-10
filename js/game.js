'use strict';

const ROLL_HIT_KINDS = new Set(['roller', 'digger', 'sandhog', 'leapfrog']);

// Simulation for one game: rounds, turns, shells, explosions, fluids. Has no
// DOM/canvas knowledge besides the terrain bitmap; the UI talks to it through
// `hooks`.
class Game {
  constructor(settings, players, hooks = {}, seed) {
    this.settings = { ...settings };
    this.players = players;
    this.hooks = hooks;
    this.round = 0;
    this.phase = 'idle';
    this.seed = seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed >>> 0;
    RNG.seed(this.seed);
    for (const p of players) p.cash = settings.startCash;
  }

  get simultaneous() {
    return this.settings.turnMode === 'simultaneous';
  }

  // ---------------------------------------------------------------- rounds
  startRound(aspect) {
    this.round++;
    const W = PHYS.W;
    const H = clamp(Math.round(W / (aspect || 2)), 320, 600);
    this.W = W;
    this.H = H;
    const s = this.settings;
    this.theme = s.theme === 'random' ? pick(THEMES) : THEMES.find((t) => t.name === s.theme) || THEMES[0];
    this.terrainType = s.terrain === 'random' ? pick(TERRAIN_TYPES) : s.terrain;
    this.walls = s.walls === 'random' ? pick(WALL_TYPES) : s.walls;
    this.terrain = new Terrain(W, H, this.theme);
    this.terrain.generate(this.terrainType);
    this.g = PHYS.gravity * s.gravity;
    this.maxWind = s.wind;
    this.wind = s.wind ? Math.round(gauss() * s.wind * 0.45) : 0;
    this.wind = clamp(this.wind, -s.wind, s.wind);

    this.projectiles = [];
    this.explosions = [];
    this.effects = [];
    this.particles = [];
    this.texts = [];
    this.tracers = [];
    this.fluids = [];
    this.streams = [];
    this.timers = [];
    this.occ = new Uint8Array(W * H);
    this.shake = 0;
    this.flash = 0;
    this.time = 0;
    this.turnCount = 0;
    this.lastDamageTurn = 0;
    this.current = null;
    this.aiState = null;
    this.summary = null;

    this.placeTanks();
    for (const p of this.players) {
      if (p.forfeit) {
        p.alive = false;
        p.dead = true;
      }
    }
    this.order = shuffle(this.players.slice());
    this.turnIdx = -1;
    this.phase = 'start';
    this.phaseTimer = 0.8;
  }

  placeTanks() {
    const { W, terrain } = this;
    const n = this.players.length;
    const margin = 24;
    const slot = (W - margin * 2) / n;
    const slots = shuffle([...Array(n).keys()]);
    this.players.forEach((p, i) => {
      const x = Math.round(margin + slot * (slots[i] + 0.5) + rand(-slot * 0.22, slot * 0.22));
      // Flatten a pad at the average surface height under the tank.
      let sum = 0;
      for (let dx = -8; dx <= 8; dx++) sum += terrain.surface(x + dx);
      const level = Math.round(sum / 17);
      for (let dx = -9; dx <= 9; dx++) {
        const cx = x + dx;
        for (let y = 0; y < level; y++) terrain.buf[y * W + cx] = 0;
        for (let y = level; y < this.H; y++) if (!terrain.buf[y * W + cx]) terrain.buf[y * W + cx] = terrain.dirtColor(cx, y, level);
      }
      p.startRound(x, level);
    });
    terrain.markDirty(0, 0, W, this.H);
  }

  get alive() {
    return this.players.filter((p) => p.alive);
  }

  get windAcc() {
    return this.wind * PHYS.windScale;
  }

  nextTurn() {
    if (this.replay) {
      this.phase = 'idle';
      return;
    }
    const alive = this.alive;
    if (alive.length <= 1) return this.endRound();
    if (this.turnCount >= this.players.length * 30) return this.endRound('limit');
    // A round nobody can win (tanks out of each other's reach) is drawn after
    // `stalemate` full turns in which no tank or shield took any damage.
    const stale = this.settings.stalemate;
    if (stale > 0 && this.turnCount - this.lastDamageTurn >= stale * alive.length) return this.endRound('stalemate');
    if (this.hooks.beforeTurn) this.hooks.beforeTurn();
    if (this.settings.changingWind && this.maxWind && this.turnCount > 0) {
      this.wind = clamp(this.wind + Math.round(gauss() * this.maxWind * 0.15), -this.maxWind, this.maxWind);
    }
    this.phase = 'aim';
    this.aiState = null;
    if (this.simultaneous) {
      // Everyone aims at once; shots launch together once all have committed.
      this.turnCount += alive.length;
      this.volley = this.order.filter((p) => p.alive);
      for (const p of this.volley) this.prepTurn(p);
      for (const p of this.volley) if (p.isAI) p.pending = this.planAction(p);
      this.current = this.volley.find((p) => !p.pending) || null;
      if (!this.current) return this.launchVolley(this.volley);
      if (this.hooks.onTurn) this.hooks.onTurn(this.current);
      return;
    }
    let p;
    do {
      this.turnIdx = (this.turnIdx + 1) % this.order.length;
      p = this.order[this.turnIdx];
    } while (!p.alive);
    this.turnCount++;
    this.current = p;
    this.volley = [p];
    this.prepTurn(p);
    if (p.isAI) {
      const plan = this.planAction(p);
      if (this.fastAI) {
        p.pending = plan;
        return this.launchVolley([p]);
      }
      this.aiState = { plan, wait: 0.35 + rand(0.3) };
    }
    if (this.hooks.onTurn) this.hooks.onTurn(p);
  }

  prepTurn(p) {
    p.pending = null;
    p.power = Math.min(p.power, p.maxPower);
    if (!p.count(p.weapon)) p.weapon = 'baby_missile';
    if (p.target && !p.target.alive) p.target = null;
  }

  planAction(p) {
    const plan = AI.plan(this, p);
    return { weapon: plan.weapon, angle: plan.angle, power: plan.power, guidance: plan.guidance || null, target: plan.target || null, trigger: false };
  }

  // Players whose shots must come from outside (UI or network).
  waitingFor() {
    if (this.phase !== 'aim') return [];
    return (this.volley || []).filter((p) => p.alive && !p.pending && !p.isAI);
  }

  // Lock in a shot. action: {weapon, angle, power, guidance, target, trigger}.
  commit(p, action) {
    if (this.phase !== 'aim' || !p.alive || p.pending || !(this.volley || []).includes(p)) return false;
    p.pending = { ...action };
    p.driveDir = 0;
    p.angle = clamp(Number(action.angle) || 0, 0, 180);
    p.power = clamp(Number(action.power) || 0, 0, p.maxPower);
    if (action.weapon && action.weapon !== 'pass' && p.count(action.weapon)) p.weapon = action.weapon;
    if (this.hooks.onCommit) this.hooks.onCommit(p);
    const next = this.volley.find((q) => q.alive && !q.pending);
    if (next) {
      this.current = next;
      if (this.hooks.onTurn) this.hooks.onTurn(next);
      return true;
    }
    this.launchVolley(this.volley);
    return true;
  }

  launchVolley(list) {
    list = list.filter((p) => p.alive && p.pending);
    if (this.hooks.beforeVolley) this.hooks.beforeVolley(list);
    if (this.settings.gusts && this.maxWind) {
      this.forecast = this.wind;
      this.wind = clamp(Math.round(this.wind + gauss() * this.maxWind * this.settings.gusts), -this.maxWind, this.maxWind);
    }
    this.phase = 'busy';
    this.lastVolley = list.map((p) => ({ p, action: p.pending }));
    for (const p of list) {
      const a = p.pending;
      p.pending = null;
      this.fireShot(p, a);
    }
    if (this.hooks.onFire) this.hooks.onFire(list);
  }

  // ------------------------------------------------------- snapshot/restore
  // Everything needed to resume the simulation exactly (given the same code):
  // used for agent state, match logs and the browser spectator.
  snapshot() {
    const idx = (p) => (p ? p.index : -1);
    return {
      round: this.round,
      W: this.W,
      H: this.H,
      theme: this.theme.name,
      terrainType: this.terrainType,
      walls: this.walls,
      gravity: this.g,
      wind: this.wind,
      maxWind: this.maxWind,
      turnCount: this.turnCount,
      lastDamageTurn: this.lastDamageTurn,
      turnIdx: this.turnIdx,
      order: this.order.map(idx),
      rng: RNG.state,
      terrain: this.terrain.toRuns(),
      players: this.players.map((p) => ({
        index: p.index, name: p.name, type: p.type, color: p.color,
        x: p.x, y: p.y, angle: p.angle, power: p.power, health: p.health, alive: p.alive,
        shield: p.shield ? { ...p.shield } : null,
        inventory: { ...p.inventory }, cash: p.cash, score: p.score, kills: p.kills, wins: p.wins,
        roundCash: p.roundCash, roundKills: p.roundKills,
        useChutes: p.useChutes, fuel: p.fuel, trigger: p.trigger, weapon: p.weapon,
        lastHitBy: idx(p.lastHitBy), target: idx(p.target), grudges: { ...p.grudges }, forfeit: !!p.forfeit, burn: p.burn,
      })),
    };
  }

  restore(snap) {
    this.round = snap.round;
    this.W = snap.W;
    this.H = snap.H;
    const theme = THEMES.find((t) => t.name === snap.theme) || THEMES[0];
    if (!this.terrain || this.terrain.W !== snap.W || this.terrain.H !== snap.H || this.theme !== theme) {
      this.terrain = new Terrain(snap.W, snap.H, theme);
    }
    this.theme = theme;
    this.terrain.fromRuns(snap.terrain);
    this.terrainType = snap.terrainType;
    this.walls = snap.walls;
    this.g = snap.gravity;
    this.wind = snap.wind;
    this.maxWind = snap.maxWind;
    this.turnCount = snap.turnCount;
    this.lastDamageTurn = snap.lastDamageTurn || 0;
    this.turnIdx = snap.turnIdx;
    const byIdx = (i) => (i >= 0 ? this.players[i] : null);
    for (const q of snap.players) {
      const p = this.players[q.index];
      Object.assign(p, {
        x: q.x, y: q.y, angle: q.angle, power: q.power, health: q.health, alive: q.alive, dead: !q.alive,
        shield: q.shield ? { ...q.shield } : null, inventory: { ...q.inventory },
        cash: q.cash, score: q.score, kills: q.kills, wins: q.wins, roundCash: q.roundCash, roundKills: q.roundKills,
        useChutes: q.useChutes, fuel: q.fuel, trigger: q.trigger, weapon: q.weapon, grudges: { ...q.grudges }, forfeit: q.forfeit,
        falling: false, chute: false, burn: q.burn || 0, pending: null, driveDir: 0,
      });
    }
    for (const q of snap.players) {
      const p = this.players[q.index];
      p.lastHitBy = byIdx(q.lastHitBy);
      p.target = byIdx(q.target);
    }
    this.order = snap.order.map(byIdx);
    if (!this.occ || this.occ.length !== snap.W * snap.H) this.occ = new Uint8Array(snap.W * snap.H);
    else this.occ.fill(0);
    this.projectiles = [];
    this.explosions = [];
    this.effects = [];
    this.particles = [];
    this.texts = [];
    this.fluids = [];
    this.streams = [];
    this.timers = [];
    if (!this.tracers) this.tracers = [];
    this.shake = this.flash = 0;
    this.time = this.time || 0;
    this.current = null;
    this.aiState = null;
    this.phase = 'idle';
    RNG.state = snap.rng;
  }

  endRound(reason = null) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const alive = this.alive;
    let winner = null;
    if (alive.length === 1) {
      winner = alive[0];
      winner.wins++;
      winner.score += ECON.winScore;
      this.earn(winner, ECON.winCash);
    }
    for (const p of alive) this.earn(p, ECON.surviveCash);
    const rows = this.players.map((p) => {
      const interest = Math.round(Math.max(0, p.cash) * this.settings.interest / 100);
      p.cash += interest;
      return { p, earned: p.roundCash, interest, kills: p.roundKills, alive: p.alive };
    });
    this.summary = { winner, rows, reason };
    if (this.hooks.onRoundEnd) this.hooks.onRoundEnd(this.summary);
  }

  forceEndRound() {
    this.projectiles = [];
    this.fluids = [];
    this.streams = [];
    this.timers = [];
    this.endRound();
  }

  get gameOver() {
    return this.round >= this.settings.rounds;
  }

  earn(p, amount) {
    p.cash += amount;
    p.roundCash += amount;
  }

  later(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  say(p, list, prob = 1) {
    if (!this.settings.talking || !p || !chance(prob)) return;
    if (this.hooks.say) this.hooks.say(p, list[Math.floor(vrand(list.length))]);
  }

  // ------------------------------------------------------------- player acts
  canAct() {
    return this.phase === 'aim' && !!this.current && this.current.isHuman && !this.current.pending;
  }

  nearestEnemy(p, x = p.x, y = p.cy) {
    let best = null;
    let bd = Infinity;
    for (const t of this.players) {
      if (t === p || !t.alive) continue;
      const d = dist(x, y, t.cx, t.cy);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  useItem(p, id) {
    const item = ITEM[id];
    if (!item || p.count(id) <= 0 || !p.alive) return false;
    if (item.kind === 'battery') {
      if (p.health >= 100) return false;
      p.use(id);
      p.health = Math.min(100, p.health + 10);
      Sound.buy();
      return true;
    }
    if (item.kind === 'shield') {
      if (p.shield && p.shield.id === id && p.shield.hp >= item.hp) return false;
      p.use(id);
      p.shield = { id, hp: item.hp, max: item.hp, mag: item.mag || 0, deflect: !!item.deflect, color: SHIELD_COLORS[id] };
      Sound.shieldHit();
      return true;
    }
    return false;
  }

  drive(p, dir) {
    if (p.falling || !p.alive) return false;
    if (p.fuel <= 0) {
      if (p.count('fuel_tank') <= 0) return false;
      p.use('fuel_tank');
      p.fuel += 10;
    }
    const nx = p.x + dir;
    if (nx < 8 || nx > this.W - 9) return false;
    for (let c = 0; c <= 3; c++) {
      if (this.bodyClear(nx, p.y - c)) {
        p.x = nx;
        p.y -= c;
        p.fuel--;
        return true;
      }
    }
    return false;
  }

  bodyClear(x, y) {
    for (let yy = y - 7; yy < y; yy++) {
      for (let xx = x - 6; xx <= x + 6; xx++) if (this.terrain.solid(xx, yy)) return false;
    }
    return true;
  }

  // UI: fire the current human's shot as currently aimed.
  fire() {
    const p = this.current;
    if (!this.canAct()) return;
    this.commit(p, { weapon: p.weapon, angle: Math.round(p.angle), power: Math.round(p.power), guidance: p.armedGuidance, target: p.target, trigger: p.trigger });
    p.armedGuidance = null;
  }

  fireShot(p, action) {
    if (!action || action.weapon === 'pass') return;
    let w = WEAPON[action.weapon] || WEAPON.baby_missile;
    if (!p.use(w.id)) w = WEAPON.baby_missile;
    p.weapon = p.count(w.id) ? w.id : 'baby_missile';
    p.power = clamp(Math.round(Number(action.power) || 0), 0, p.maxPower);
    p.angle = clamp(Number(action.angle) || 0, 0, 180);

    const target = action.target && action.target.alive && action.target !== p ? action.target : this.nearestEnemy(p);
    let guidance = null;
    const gid = action.guidance;
    if (gid && ITEM[gid] && ITEM[gid].kind === 'guidance' && p.count(gid) > 0) {
      p.use(gid);
      guidance = ITEM[gid].mode;
    }
    if (guidance === 'lazyboy' && target && !DIRECT_KINDS.has(w.kind)) {
      const sol = AI.solve(this, p, target, true, true);
      if (sol) {
        p.angle = sol.angle;
        p.power = Math.min(sol.power, p.maxPower);
      }
      guidance = null;
    }
    let trigger = false;
    if (action.trigger && ROLL_HIT_KINDS.has(w.kind) && p.count('contact_trigger') > 0) {
      p.use('contact_trigger');
      trigger = true;
    }

    this.tracers = this.tracers.filter((t) => t.owner !== p);
    this.say(p, FIRE_QUOTES, 0.22);

    const a = p.angle * DEG;
    const m = p.muzzle();
    switch (w.kind) {
      case 'riotcharge':
        this.terrain.carveSector(p.x, p.y - 7, a, w.spread * DEG, w.range);
        this.effects.push({ type: 'sector', x: p.x, y: p.y - 7, a, spread: w.spread * DEG, range: w.range, t: 0, life: 0.4, color: [150, 200, 255] });
        Sound.dirt();
        return;
      case 'dirtcharge':
        this.terrain.fillSector(p.x, p.y - 7, a, w.spread * DEG, w.range, 14, (x, y) => this.insideTank(x, y));
        this.effects.push({ type: 'sector', x: p.x, y: p.y - 7, a, spread: w.spread * DEG, range: w.range, t: 0, life: 0.4, color: [160, 100, 50] });
        Sound.dirt();
        return;
      case 'plasma': {
        const r = 18 + p.power * 0.065;
        const dmg = 25 + p.power * 0.07;
        this.explode(p.x, p.cy, r, dmg, p, { kind: 'plasma', exclude: p });
        Sound.plasma();
        return;
      }
      case 'laser':
        this.fireLaser(p, m, a);
        return;
    }

    const speed = p.power * PHYS.powerScale;
    this.spawn(p, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed, w, { guidance, target, trigger });
    Sound.fire(w.nuke || w.id === 'deaths_head');
  }

  insideTank(x, y) {
    for (const t of this.players) if (t.alive && Math.abs(x - t.x) <= 8 && y >= t.y - 9 && y < t.y) return true;
    return false;
  }

  fireLaser(p, m, a) {
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    let x = m.x;
    let y = m.y;
    const hit = new Set();
    const dmg = 30 + p.power * 0.045;
    for (let i = 0; i < 2000; i++) {
      x += dx;
      y += dy;
      if (x < 0 || x >= this.W || y >= this.H || y < -400) break;
      if (i % 2 === 0) this.terrain.carveCircle(x, y, 2.5);
      for (const t of this.players) {
        if (t === p || !t.alive || hit.has(t)) continue;
        if (dist(x, y, t.cx, t.cy) < PHYS.tankR) {
          hit.add(t);
          this.hurt(t, dmg, p, false, true);
        }
      }
    }
    this.effects.push({ type: 'beam', x0: m.x, y0: m.y, x1: x, y1: y, t: 0, life: 0.6 });
    this.shake = Math.max(this.shake, 3);
    Sound.laser();
  }

  spawn(owner, x, y, vx, vy, w, extra = {}) {
    const p = {
      x, y, vx, vy, px: x, py: y,
      w, kind: w.kind, owner,
      r: w.radius, dmg: w.damage,
      age: 0, armed: false, mode: 'fly', bounce: 0,
      trail: [], color: w.color || '#fff',
      gravScale: 1, noWind: false,
      ...extra,
    };
    if (p.guidance === 'ballistic') p.noWind = true;
    this.projectiles.push(p);
    return p;
  }

  // -------------------------------------------------------------- simulation
  update(dt) {
    this.time += dt;
    this.updateTimers(dt);
    this.updateProjectiles(dt);
    this.updateExplosions(dt);
    this.updateFluids(dt);
    this.updateEffects(dt);
    this.updateTerrain();
    this.updateTanks(dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    switch (this.phase) {
      case 'start':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.nextTurn();
        break;
      case 'aim':
        this.updateAim(dt);
        break;
      case 'busy':
        if (this.quiet()) {
          this.phase = 'resolve';
          this.phaseTimer = 0.25;
        }
        break;
      case 'resolve':
        if (!this.quiet()) {
          this.phase = 'busy';
          break;
        }
        this.phaseTimer -= dt;
        if (this.phaseTimer > 0) break;
        if (this.resolveDeaths()) {
          this.phase = 'busy';
        } else {
          this.phase = 'between';
          this.phaseTimer = 0.35;
        }
        break;
      case 'between':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.nextTurn();
        break;
    }
  }

  quiet() {
    return !this.projectiles.length && !this.explosions.length && !this.fluids.length && !this.streams.length &&
      !this.timers.length && !this.effects.some((e) => e.blocking !== false && e.type !== 'ring') &&
      !this.terrain.unsettledCount && !this.players.some((p) => p.alive && p.falling);
  }

  updateAim(dt) {
    const p = this.current;
    if (!p) return;
    if (!p.isAI) {
      if (p.driveDir) {
        p.driveAcc = (p.driveAcc || 0) + dt * 30;
        while (p.driveAcc >= 1) {
          p.driveAcc--;
          if (!this.drive(p, p.driveDir)) {
            p.driveDir = 0;
            break;
          }
        }
      }
      return;
    }
    const s = this.aiState;
    if (!s) return;
    const { plan } = s;
    const da = plan.angle - p.angle;
    p.angle += clamp(da, -110 * dt, 110 * dt);
    const dp = plan.power - p.power;
    p.power += clamp(dp, -900 * dt, 900 * dt);
    p.weapon = plan.weapon;
    if (Math.abs(da) < 0.01 && Math.abs(dp) < 0.5) {
      s.wait -= dt;
      if (s.wait <= 0) {
        this.aiState = null;
        this.commit(p, plan);
      }
    }
  }

  updateTimers(dt) {
    if (!this.timers.length) return;
    const due = [];
    for (const t of this.timers) {
      t.t -= dt;
      if (t.t <= 0) due.push(t);
    }
    if (due.length) {
      this.timers = this.timers.filter((t) => t.t > 0);
      for (const t of due) t.fn();
    }
  }

  updateTerrain() {
    if (!this.terrain.unsettledCount) return;
    if (this.settings.fallingDirt) this.terrain.settleStep(3);
    else this.terrain.settleInstant();
  }

  // ------------------------------------------------------------ projectiles
  updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    for (const p of this.projectiles.slice()) {
      if (p.dead) continue;
      if (p.mode === 'fly') this.tickFlight(p, dt);
      else if (p.mode === 'roll') this.tickRoll(p, dt);
      else if (p.mode === 'dig') this.tickDig(p, dt);
      p.age += dt;
      if (p.age > 25) p.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  tickFlight(p, dt) {
    const { W, H } = this;
    const lastVy = p.vy;
    if (p.guidance) this.guide(p, dt);
    if (!p.noWind) p.vx += this.windAcc * dt;
    p.vy += this.g * p.gravScale * dt;
    this.magField(p, dt);

    if (p.kind === 'mirv' && !p.split && lastVy < 0 && p.vy >= 0) {
      this.splitMirv(p);
      return;
    }

    const owner = p.owner;
    const speed = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.ceil((speed * dt) / 1.5));
    for (let i = 0; i < steps; i++) {
      p.x += (p.vx * dt) / steps;
      p.y += (p.vy * dt) / steps;
      if (p.x < 0 || p.x >= W) {
        if (!this.hitWall(p)) return;
      }
      if (p.y >= H) {
        p.y = H - 1;
        return this.impact(p, null);
      }
      if (!p.armed) {
        const armR = owner.shield ? PHYS.shieldR + 2 : PHYS.tankR + 3;
        if (dist(p.x, p.y, owner.cx, owner.cy) > armR) p.armed = true;
      }
      const hit = this.tankHit(p);
      if (hit) {
        if (hit.shield && hit.t.shield.deflect) {
          this.deflect(p, hit.t);
          continue;
        }
        return this.impact(p, hit.t);
      }
      if (this.terrain.solid(p.x, p.y)) return this.impact(p, null);
      p.px = p.x;
      p.py = p.y;
    }
    p.trail.push(p.x, p.y);
    if (p.trail.length > 400) p.trail.splice(0, 2);
    if (p.y < -6000) p.dead = true;
  }

  tankHit(p) {
    for (const t of this.players) {
      if (!t.alive) continue;
      if (t === p.owner && !p.armed) continue;
      const d = dist(p.x, p.y, t.cx, t.cy);
      if (t.shield && d < PHYS.shieldR) return { t, shield: true };
      if (d < PHYS.tankR) return { t, shield: false };
    }
    return null;
  }

  deflect(p, t) {
    const nx = (p.x - t.cx) / (dist(p.x, p.y, t.cx, t.cy) || 1);
    const ny = (p.y - t.cy) / (dist(p.x, p.y, t.cx, t.cy) || 1);
    const dot = p.vx * nx + p.vy * ny;
    if (dot < 0) {
      p.vx -= 2 * dot * nx;
      p.vy -= 2 * dot * ny;
    }
    p.x = t.cx + nx * (PHYS.shieldR + 1);
    p.y = t.cy + ny * (PHYS.shieldR + 1);
    p.px = p.x;
    p.py = p.y;
    t.shield.hp -= 10;
    this.effects.push({ type: 'ring', x: t.cx, y: t.cy, r: PHYS.shieldR, t: 0, life: 0.25, color: hexToRgb(t.shield.color), blocking: false });
    if (t.shield.hp <= 0) this.breakShield(t);
    Sound.shieldHit();
  }

  breakShield(t) {
    if (!t.shield) return;
    this.effects.push({ type: 'ring', x: t.cx, y: t.cy, r: PHYS.shieldR + 6, t: 0, life: 0.4, color: hexToRgb(t.shield.color), blocking: false });
    t.shield = null;
  }

  hitWall(p) {
    const W = this.W;
    switch (this.walls) {
      case 'wrap':
        p.x = (p.x + W) % W;
        p.px = p.x;
        p.trail.push(NaN, NaN);
        return true;
      case 'concrete':
        p.x = clamp(p.x, 0, W - 1);
        p.px = p.x;
        this.impact(p, null);
        return false;
      case 'rubber':
      case 'spring':
      case 'padded': {
        p.x = p.x < 0 ? -p.x : 2 * (W - 1) - p.x;
        p.px = p.x;
        const k = this.walls === 'rubber' ? 1 : this.walls === 'spring' ? 1.35 : 0.3;
        p.vx = clamp(-p.vx * k, -900, 900);
        if (this.walls === 'padded') p.vy *= 0.6;
        Sound.bounce();
        return true;
      }
      default:
        p.dead = true;
        return false;
    }
  }

  guide(p, dt) {
    const t = p.target;
    if (!t || !t.alive) return;
    const speed = Math.hypot(p.vx, p.vy);
    if (p.guidance === 'heat') {
      const d = dist(p.x, p.y, t.cx, t.cy);
      if (d < 140) {
        const want = Math.atan2(t.cy - p.y, t.cx - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        let diff = want - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const a = cur + clamp(diff, -5 * dt, 5 * dt);
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed;
      }
    } else if (p.guidance === 'horizontal' && !p.gmode) {
      if (p.vy > 0 && p.y >= t.cy - 2 && p.y < t.cy + 30) {
        p.gmode = 'h';
        p.gravScale = 0;
        p.noWind = true;
        p.vy = 0;
        p.vx = Math.sign(t.cx - p.x) * Math.max(260, Math.abs(p.vx));
        Sound.bounce();
      }
    } else if (p.guidance === 'vertical' && !p.gmode) {
      const side = Math.sign(p.x - t.cx);
      if (p.lastSide !== undefined && side !== p.lastSide && p.y < t.cy) {
        p.gmode = 'v';
        p.gravScale = 0;
        p.noWind = true;
        p.x = t.cx;
        p.vx = 0;
        p.vy = Math.max(320, speed);
        Sound.bounce();
      }
      p.lastSide = side;
    }
  }

  magField(p, dt) {
    for (const t of this.players) {
      if (!t.alive || !t.shield || !t.shield.mag || t === p.owner) continue;
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      const d = Math.hypot(dx, dy);
      const R = 60 + 30 * t.shield.mag;
      if (d < R && d > 1) {
        const a = t.shield.mag * 1400 * (1 - d / R);
        p.vx += (dx / d) * a * dt;
        p.vy += (dy / d) * a * dt;
      }
    }
  }

  splitMirv(p) {
    const w = p.w;
    p.dead = true;
    for (let i = 0; i < w.count; i++) {
      const off = (i - (w.count - 1) / 2) * w.spread;
      this.spawn(p.owner, p.x, p.y, p.vx + off, p.vy, WEAPON.missile, {
        r: w.radius, dmg: w.damage, armed: true, color: w.color, split: true, trail: [],
      });
    }
    this.effects.push({ type: 'ring', x: p.x, y: p.y, r: 10, t: 0, life: 0.3, color: [255, 255, 255], blocking: false });
    Sound.bounce();
  }

  impact(p, tank) {
    p.dead = true;
    const x = p.px;
    const y = p.py;
    const o = p.owner;
    switch (p.kind) {
      case 'missile':
      case 'mirv':
        this.explode(x, y, p.r, p.dmg, o, { nuke: p.w.nuke });
        break;
      case 'tracer':
        this.tracers.push({ owner: o, pts: p.trail.concat([x, y]), smoke: !!p.w.smoke, color: o.rgb });
        this.effects.push({ type: 'ring', x, y, r: 4, t: 0, life: 0.3, color: [255, 255, 255], blocking: false });
        break;
      case 'leapfrog':
        this.explode(x, y, p.r, p.dmg, o);
        if (p.bounce < p.w.bounces - 1 && !p.trigger) {
          this.later(0.25, () => {
            this.spawn(o, x, y - 3, p.vx * 0.8, -Math.max(150, Math.abs(p.vy) * 0.6), p.w, {
              bounce: p.bounce + 1, armed: true, r: Math.round(p.r * 0.9), dmg: p.dmg * 0.9,
            });
          });
        }
        break;
      case 'funky': {
        this.explode(x, y, p.r, p.dmg, o);
        const w = p.w;
        this.later(0.2, () => {
          for (let i = 0; i < w.count; i++) {
            const col = `hsl(${randInt(0, 359)},100%,60%)`;
            this.spawn(o, x, y - 4, rand(-200, 200), rand(-360, -140), WEAPON.missile, {
              r: w.childRadius, dmg: w.childDamage, armed: true, color: col, funky: col,
            });
          }
        });
        break;
      }
      case 'napalm':
        this.spawnNapalm(x, y, p.w.particles, p.w.life, p.w.dps, o, !!p.w.hot);
        Sound.sizzle();
        break;
      case 'roller':
        if (tank || p.trigger) {
          this.explode(x, y, p.r, p.dmg, o);
          break;
        }
        this.startRoll(p);
        break;
      case 'riotbomb':
        this.explode(x, y, p.w.radius, 0, o, { kind: 'riot' });
        break;
      case 'digger':
      case 'sandhog':
        if (tank || p.trigger) {
          if (p.kind === 'sandhog') this.explode(x, y, p.w.radius, p.w.damage, o);
          else this.explode(x, y, p.w.width * 2, 15, o);
          break;
        }
        this.startDig(p);
        break;
      case 'dirt':
        this.explode(x, y, p.w.radius, 0, o, { kind: 'dirt' });
        break;
      case 'liquiddirt':
        this.streams.push({ x, y: y - 1, left: p.w.amount, owner: o });
        Sound.dirt();
        break;
      case 'disrupter':
        this.terrain.settleEverything();
        this.effects.push({ type: 'ring', x, y, r: 60, t: 0, life: 0.6, color: [0, 255, 255] });
        Sound.plasma();
        break;
      default:
        this.explode(x, y, 15, 30, o);
    }
  }

  startRoll(p) {
    p.dead = false;
    p.mode = 'roll';
    p.x = Math.round(p.px);
    p.y = Math.round(p.py);
    while (p.y > 0 && this.terrain.solid(p.x, p.y)) p.y--;
    const hl = this.terrain.surface(p.x - 5, p.y - 20);
    const hr = this.terrain.surface(p.x + 5, p.y - 20);
    p.dir = hr > hl ? 1 : hl > hr ? -1 : Math.sign(p.vx) || 1;
    p.steps = 0;
    p.acc = 0;
  }

  tickRoll(p, dt) {
    const T = this.terrain;
    p.acc += dt * 110;
    while (p.acc >= 1) {
      p.acc--;
      p.steps++;
      if (p.steps > 1200) return this.rollBoom(p);
      // Fall freely while unsupported.
      let fell = 0;
      while (!T.solid(p.x, p.y + 1) && fell < 4) {
        p.y++;
        fell++;
      }
      if (p.y >= this.H - 1) return this.rollBoom(p);
      if (fell) continue;
      let nx = p.x + p.dir;
      if (nx < 0 || nx >= this.W) {
        if (this.walls === 'wrap') nx = (nx + this.W) % this.W;
        else if (this.walls === 'none') {
          p.dead = true;
          return;
        } else if (this.walls === 'concrete') return this.rollBoom(p);
        else {
          p.dir = -p.dir;
          Sound.bounce();
          continue;
        }
      }
      if (T.solid(nx, p.y)) return this.rollBoom(p);
      p.x = nx;
      for (const t of this.players) {
        if (!t.alive || (t === p.owner && p.steps < 12)) continue;
        if (dist(p.x, p.y - 2, t.cx, t.cy) < (t.shield ? PHYS.shieldR : PHYS.tankR + 1)) return this.rollBoom(p);
      }
      p.px = p.x;
      p.py = p.y;
    }
    p.trail.push(p.x, p.y);
    if (p.trail.length > 60) p.trail.splice(0, 2);
  }

  rollBoom(p) {
    p.dead = true;
    this.explode(p.x, p.y - 2, p.r, p.dmg, p.owner);
  }

  startDig(p) {
    const w = p.w;
    const base = Math.atan2(Math.max(p.vy, Math.abs(p.vx) * 0.4), p.vx);
    const n = w.count;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.2;
      this.projectiles.push({
        ...p,
        dead: false,
        mode: 'dig',
        x: p.px, y: p.py,
        heading: base + off,
        len: w.length * rand(0.85, 1.1),
        width: w.width || 5,
        trail: [],
        acc: 0,
        wob: rand(TAU),
      });
    }
    Sound.dig();
  }

  tickDig(p, dt) {
    const T = this.terrain;
    p.acc += dt * 90;
    while (p.acc >= 1) {
      p.acc--;
      const h = p.heading + Math.sin(p.age * 9 + p.wob) * 0.35;
      p.x += Math.cos(h) * 1.2;
      p.y += Math.sin(h) * 1.2;
      p.len -= 1.2;
      T.carveCircle(p.x, p.y, (p.width || 5) / 2, false);
      let hitTank = false;
      for (const t of this.players) if (t.alive && t !== p.owner && dist(p.x, p.y, t.cx, t.cy) < PHYS.tankR) hitTank = true;
      if (p.len <= 0 || hitTank || p.x < 1 || p.x >= this.W - 1 || p.y >= this.H - 2) {
        p.dead = true;
        if (p.kind === 'sandhog') this.explode(p.x, p.y, p.w.radius, p.w.damage, p.owner);
        return;
      }
    }
    if (chance(0.08)) Sound.dig();
  }

  // ------------------------------------------------------------ explosions
  explode(x, y, r, dmg, owner, opts = {}) {
    const kind = opts.kind || 'blast';
    const e = { x, y, r, dmg, owner, kind, t: 0, grow: 0.16 + r / 160, fade: 0.25, applied: false, nuke: opts.nuke, exclude: opts.exclude, seed: rand(100) };
    if (opts.nuke) {
      e.grow += 0.3;
      e.fade = 0.5;
      this.flash = Math.max(this.flash, r >= 60 ? 1 : 0.6);
      Sound.nuke();
    } else if (kind === 'dirt') Sound.dirt();
    else if (kind !== 'plasma') Sound.explode(r);
    this.shake = Math.max(this.shake, Math.min(14, r / 6));
    this.explosions.push(e);
    return e;
  }

  updateExplosions(dt) {
    if (!this.explosions.length) return;
    for (const e of this.explosions) {
      e.t += dt;
      if (!e.applied && e.t >= e.grow) {
        e.applied = true;
        this.applyExplosion(e);
      }
    }
    this.explosions = this.explosions.filter((e) => e.t < e.grow + e.fade);
  }

  applyExplosion(e) {
    const T = this.terrain;
    switch (e.kind) {
      case 'blast':
      case 'death':
        T.carveCircle(e.x, e.y, e.r);
        this.damageArea(e.x, e.y, e.r, e.dmg, e.owner, e.exclude);
        this.debris(e.x, e.y, e.r);
        break;
      case 'riot':
        T.carveCircle(e.x, e.y, e.r);
        this.debris(e.x, e.y, e.r * 0.6);
        break;
      case 'dirt':
        T.fillCircle(e.x, e.y, e.r);
        break;
      case 'plasma':
        this.damageArea(e.x, e.y, e.r, e.dmg, e.owner, e.exclude);
        break;
    }
  }

  debris(x, y, r) {
    const n = Math.min(40, 4 + r);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const s = rand(60, 120 + r * 4);
      const c = this.terrain.palette[clamp(Math.round(y), 0, this.H - 1)];
      this.particles.push({
        x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.5,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80,
        life: rand(0.4, 1.1), color: chance(0.5) ? c : [255, rand(120, 220), 40], size: chance(0.3) ? 2 : 1,
      });
    }
  }

  damageArea(x, y, r, dmg, owner, exclude) {
    for (const t of this.players) {
      if (!t.alive || t === exclude) continue;
      const d = Math.max(0, dist(x, y, t.cx, t.cy) - 5);
      if (owner && owner !== t && d < r + 25) t.lastHitBy = owner;
      if (d >= r || !dmg) continue;
      const f = 1 - d / r;
      this.hurt(t, dmg * (0.25 + 0.75 * f), owner);
    }
  }

  hurt(t, amount, owner, bypassShield = false, quiet = false) {
    if (!t.alive || t.health <= 0) return;
    let amt = amount;
    if (t.shield && !bypassShield) {
      const a = Math.min(t.shield.hp, amt);
      t.shield.hp -= a;
      if (a > 0) this.lastDamageTurn = this.turnCount;
      amt -= a;
      if (t.shield.hp <= 0) this.breakShield(t);
    }
    amt = Math.round(amt);
    if (amt <= 0) return;
    amt = Math.min(amt, t.health);
    t.health -= amt;
    this.lastDamageTurn = this.turnCount;
    if (owner && owner !== t) {
      t.lastHitBy = owner;
      owner.score += amt;
      this.earn(owner, amt * ECON.damageCash);
      t.grudges[owner.index] = (t.grudges[owner.index] || 0) + amt;
    }
    this.texts.push({ x: t.x, y: t.y - 14, text: '-' + amt, t: 0, life: 1.1, color: t.color });
    if (t.health > 0 && !quiet) this.say(t, HIT_QUOTES, 0.12);
  }

  resolveDeaths() {
    const dying = this.players.filter((p) => p.alive && p.health <= 0);
    if (!dying.length) return false;
    dying.forEach((t, i) => {
      t.alive = false;
      t.dead = true;
      const k = t.lastHitBy;
      if (k && k !== t) {
        k.kills++;
        k.roundKills++;
        k.score += ECON.killScore;
        this.earn(k, ECON.killCash);
      }
      this.later(0.05 + i * 0.4, () => this.deathBlast(t));
    });
    return true;
  }

  deathBlast(t) {
    this.say(t, DEATH_QUOTES, 0.9);
    const killer = t.lastHitBy && t.lastHitBy !== t ? t.lastHitBy : t;
    const style = rand();
    const x = t.x;
    const y = t.cy;
    if (style < 0.55) this.explode(x, y, 26, 40, killer, { kind: 'death' });
    else if (style < 0.75) this.explode(x, y, 42, 60, killer, { kind: 'death' });
    else if (style < 0.9) {
      this.explode(x, y, 20, 35, killer, { kind: 'death' });
      for (let i = 0; i < 6; i++) {
        const col = `hsl(${randInt(0, 359)},100%,60%)`;
        this.spawn(killer, x, y - 12, rand(-170, 170), rand(-330, -150), WEAPON.missile, { r: 14, dmg: 30, armed: true, color: col, funky: col });
      }
    } else {
      this.explode(x, y, 18, 30, killer, { kind: 'death' });
      this.spawnNapalm(x, y - 6, 50, 3.5, 0.9, killer, false);
    }
  }

  // ----------------------------------------------------------------- fluids
  spawnNapalm(x, y, n, life, dps, owner, hot) {
    let sy = Math.round(y);
    while (sy > 0 && this.terrain.solid(x, sy)) sy--;
    for (let i = 0; i < n; i++) {
      this.fluids.push({
        kind: 'napalm', x: Math.round(x + rand(-5, 5)), y: sy - randInt(0, 6), dir: chance(0.5) ? 1 : -1,
        life: life * rand(0.7, 1.2), dps, owner, hot, settled: false, run: 0, stuck: 0,
      });
    }
  }

  blocked(x, y) {
    if (x < 0 || x >= this.W) return true;
    if (y >= this.H) return true;
    if (y < 0) return false;
    return this.terrain.buf[y * this.W + x] !== 0 || this.occ[y * this.W + x] !== 0;
  }

  updateFluids(dt) {
    for (const s of this.streams) {
      const n = Math.min(s.left, 30);
      s.left -= n;
      let sy = Math.round(s.y);
      while (sy > 0 && this.terrain.solid(s.x, sy)) sy--;
      for (let i = 0; i < n; i++) {
        this.fluids.push({ kind: 'dirt', x: Math.round(s.x + rand(-3, 3)), y: sy - randInt(0, 3), dir: chance(0.5) ? 1 : -1, settled: false, run: 0, stuck: 0, life: 99 });
      }
    }
    this.streams = this.streams.filter((s) => s.left > 0);
    if (!this.fluids.length) return;

    const { W, occ, terrain } = this;
    const out = [];
    for (const f of this.fluids) {
      if (f.kind === 'napalm') {
        f.life -= dt;
        if (f.life <= 0) {
          if (f.settled) occ[f.y * W + f.x] = 0;
          if (chance(0.5)) terrain.scorch(f.x, f.y + 1);
          continue;
        }
        if (f.settled && !this.blocked(f.x, f.y + 1)) {
          occ[f.y * W + f.x] = 0;
          f.settled = false;
          f.stuck = 0;
        }
      }
      if (!f.settled) {
        for (let s = 0; s < 4 && !f.settled; s++) {
          if (f.y >= this.H) break;
          if (!this.blocked(f.x, f.y + 1)) {
            f.y++;
            f.run = 0;
          } else if (!this.blocked(f.x + f.dir, f.y + 1)) {
            f.x += f.dir;
            f.y++;
            f.run = 0;
          } else if (!this.blocked(f.x - f.dir, f.y + 1)) {
            f.dir = -f.dir;
            f.x += f.dir;
            f.y++;
            f.run = 0;
          } else if (!this.blocked(f.x + f.dir, f.y) && f.run < 25) {
            f.x += f.dir;
            f.run++;
          } else if (!this.blocked(f.x - f.dir, f.y) && f.run < 25) {
            f.dir = -f.dir;
            f.x += f.dir;
            f.run++;
          } else {
            f.stuck++;
            if (f.stuck > 1 || f.run >= 25) f.settled = true;
          }
        }
        if (f.x < 0 || f.x >= W || f.y >= this.H) continue;
        if (f.settled) {
          if (f.kind === 'dirt') {
            if (f.y >= 0 && !this.blocked(f.x, f.y)) terrain.setPixel(f.x, f.y);
            continue;
          }
          if (f.y >= 0) occ[f.y * W + f.x] = 1;
        }
      }
      out.push(f);
    }
    this.fluids = out;

    // Napalm burns any tank it touches.
    for (const t of this.players) {
      if (!t.alive) continue;
      let heat = 0;
      let owner = null;
      for (const f of this.fluids) {
        if (f.kind !== 'napalm') continue;
        if (Math.abs(f.x - t.x) < 10 && Math.abs(f.y - t.cy) < 9) {
          heat += f.dps;
          owner = f.owner;
        }
      }
      if (heat) {
        t.burn += Math.min(heat, 30) * dt;
        if (t.burn >= 1) {
          const n = Math.floor(t.burn);
          t.burn -= n;
          this.hurt(t, n, owner, false, true);
        }
      }
    }
  }

  // ----------------------------------------------------------- tanks, misc
  supported(t) {
    if (t.y >= this.H) return true;
    for (let x = t.x - 6; x <= t.x + 6; x++) if (this.terrain.solid(x, t.y)) return true;
    return false;
  }

  updateTanks(dt) {
    for (const t of this.players) {
      if (!t.alive) continue;
      if (!t.falling) {
        if (!this.supported(t)) {
          t.falling = true;
          t.fallFrom = t.y;
          t.fallVy = 0;
          t.fallAcc = 0;
        }
        continue;
      }
      if (!t.chute && t.useChutes && t.y - t.fallFrom > 10 && t.count('parachute') > 0) {
        t.use('parachute');
        t.chute = true;
        Sound.chute();
      }
      t.fallVy = t.chute ? Math.min(t.fallVy + this.g * dt, 45) : t.fallVy + this.g * dt;
      t.fallAcc += t.fallVy * dt;
      while (t.fallAcc >= 1) {
        t.fallAcc--;
        if (this.supported(t)) break;
        t.y++;
      }
      if (this.supported(t)) {
        t.falling = false;
        const fell = t.y - t.fallFrom;
        if (!t.chute && fell > 8) {
          this.hurt(t, (fell - 8) * 0.5, t.lastHitBy, true);
          Sound.thud();
        }
        t.chute = false;
      }
    }
  }

  updateEffects(dt) {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.life);
    for (const p of this.particles) {
      p.vy += this.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.t += dt;
      t.y -= dt * 18;
    }
    this.texts = this.texts.filter((t) => t.t < t.life);
  }

  // Ballistic trajectory used by the AI and Lazy Boy. Mirrors tickFlight
  // minus guidance and mag fields.
  simulate(shooter, angleDeg, power, useWind) {
    const { W, H, terrain } = this;
    const a = angleDeg * DEG;
    let x = shooter.x + Math.cos(a) * PHYS.barrel;
    let y = shooter.y - 7 - Math.sin(a) * PHYS.barrel;
    const speed0 = power * PHYS.powerScale;
    let vx = Math.cos(a) * speed0;
    let vy = -Math.sin(a) * speed0;
    const wind = useWind ? this.windAcc : 0;
    const dt = PHYS.tick;
    const g = this.g;
    let armed = false;
    const armR = shooter.shield ? PHYS.shieldR + 2 : PHYS.tankR + 3;
    for (let tick = 0; tick < 720; tick++) {
      vx += wind * dt;
      vy += g * dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 2));
      for (let i = 0; i < steps; i++) {
        x += (vx * dt) / steps;
        y += (vy * dt) / steps;
        if (x < 0 || x >= W) {
          const wl = this.walls;
          if (wl === 'wrap') x = (x + W) % W;
          else if (wl === 'none') return { x, y, lost: true };
          else if (wl === 'concrete') return { x: clamp(x, 0, W - 1), y };
          else {
            x = x < 0 ? -x : 2 * (W - 1) - x;
            vx = -vx * (wl === 'rubber' ? 1 : wl === 'spring' ? 1.35 : 0.3);
            if (wl === 'padded') vy *= 0.6;
          }
        }
        if (y >= H) return { x, y: H - 1 };
        if (!armed && dist(x, y, shooter.cx, shooter.cy) > armR) armed = true;
        for (const t of this.players) {
          if (!t.alive || (t === shooter && !armed)) continue;
          const r = t.shield && t !== shooter ? PHYS.shieldR : PHYS.tankR;
          if (dist(x, y, t.cx, t.cy) < r) return { x, y, tank: t };
        }
        if (y >= 0 && terrain.solid(x, y)) return { x, y };
      }
      if (y < -5000) break;
    }
    return { x, y, lost: true };
  }
}
