'use strict';

const crypto = require('node:crypto');
const { createEngine } = require('./engine');

const ASPECT = 2; // fixed 800x400 battlefield for agent matches
const MAX_SIM_TICKS = 60 * 60 * 5; // sim-seconds without input before a round is called a stalemate
const LOBBY_TTL = 15 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const int = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

function sanitizeSettings(E, raw = {}) {
  const D = E.DEFAULT_SETTINGS;
  return {
    ...D,
    rounds: int(raw.rounds, 1, 10, 3),
    turnMode: oneOf(raw.turnMode, ['sequential', 'simultaneous'], 'simultaneous'),
    gusts: num(raw.gusts, 0, 0.5, 0.25),
    wind: int(raw.wind, 0, 200, 60),
    changingWind: raw.changingWind === true,
    walls: oneOf(raw.walls, ['random', ...E.WALL_TYPES], 'random'),
    terrain: oneOf(raw.terrain, ['random', ...E.TERRAIN_TYPES], 'random'),
    theme: 'random',
    gravity: num(raw.gravity, 0.5, 2, 1),
    startCash: int(raw.startCash, 0, 200000, 25000),
    interest: int(raw.interest, 0, 20, 5),
    armsLevel: int(raw.armsLevel, 0, 4, 4),
    stalemate: int(raw.stalemate, 0, 50, 8),
    talking: true,
    fallingDirt: true,
    turnTimeout: int(raw.turnTimeout, 10, 600, 90),
    shopTimeout: int(raw.shopTimeout, 10, 600, 60),
  };
}

class Match {
  constructor({ store, creator, bots = [], openSeats = 0, settings, seed, onEnd }) {
    this.id = crypto.randomBytes(5).toString('hex');
    this.store = store;
    this.E = createEngine();
    this.settings = sanitizeSettings(this.E, settings);
    this.seed = seed === undefined ? crypto.randomBytes(4).readUInt32LE() : seed >>> 0;
    // A chosen seed makes the bots and terrain predictable, so it could be
    // replayed offline for a guaranteed win; those matches don't move Elo.
    this.rated = seed === undefined;
    this.createdAt = Date.now();
    this.status = 'lobby'; // lobby -> live -> done | expired
    this.stage = null; // shop | play
    this.version = 0;
    this.waiters = new Set();
    this.log = [];
    this.onEnd = onEnd;
    this.seats = [{ kind: 'agent', agentId: creator.id, name: creator.name }];
    for (const type of bots) {
      const ai = this.E.AI_TYPES[type];
      if (!ai) throw new HttpError(400, `unknown bot "${type}" (one of ${this.E.AI_KEYS.join(', ')})`);
      const row = store.botAgent(type, ai.name);
      const same = this.seats.filter((x) => x.botType === type).length;
      this.seats.push({ kind: 'bot', botType: type, agentId: row.id, name: ai.name + (same ? ' ' + (same + 1) : '') });
    }
    for (let i = 0; i < openSeats; i++) this.seats.push({ kind: 'open' });
    if (this.seats.length < 2) throw new HttpError(400, 'a match needs at least 2 seats (add bots or openSeats)');
    if (this.seats.length > 10) throw new HttpError(400, 'at most 10 seats');
    this.seats.forEach((s, i) => {
      s.index = i;
      s.timeouts = 0;
    });
    if (!this.openCount) this.start();
  }

  get openCount() {
    return this.seats.filter((s) => s.kind === 'open').length;
  }

  seatOf(agentId) {
    return this.seats.find((s) => s.kind === 'agent' && s.agentId === agentId) || null;
  }

  join(agent) {
    if (this.status !== 'lobby') throw new HttpError(409, 'match already started');
    if (this.seatOf(agent.id)) throw new HttpError(409, 'already seated in this match');
    const seat = this.seats.find((s) => s.kind === 'open');
    Object.assign(seat, { kind: 'agent', agentId: agent.id, name: agent.name });
    this.bump();
    if (!this.openCount) this.start();
    return seat;
  }

  // ------------------------------------------------------------- lifecycle
  start() {
    const E = this.E;
    this.status = 'live';
    this.players = this.seats.map((s, i) => new E.Player({ name: s.name, type: s.kind === 'bot' ? s.botType : 'remote', color: E.PLAYER_COLORS[i], index: i }));
    this.game = new E.Game(this.settings, this.players, {
      beforeTurn: () => this.freshEntropy(),
      beforeVolley: (list) => this.logVolley(list),
      onFire: () => {
        const last = this.log[this.log.length - 1];
        if (last && last.t === 'volley') last.windActual = this.game.wind;
      },
      onRoundEnd: () => {},
    }, this.seed);
    this.game.fastAI = true;
    this.push({ t: 'start', seed: this.rated ? undefined : this.seed, settings: this.settings, seats: this.publicSeats() });
    this.timer = setInterval(() => this.checkTimeouts(), 1000);
    if (this.timer.unref) this.timer.unref();
    this.beginShop();
  }

  beginShop() {
    const g = this.game;
    this.freshEntropy();
    for (const p of this.players) if (p.isAI) this.E.AI.shop(p, g.settings);
    this.shoppers = new Set(this.seats.filter((s) => s.kind === 'agent' && !this.players[s.index].forfeit && this.players[s.index].cash >= 10).map((s) => s.index));
    if (!this.shoppers.size) return this.startRound();
    this.stage = 'shop';
    this.deadline = Date.now() + this.settings.shopTimeout * 1000;
    this.bump();
  }

  startRound() {
    this.stage = 'play';
    this.game.startRound(ASPECT);
    this.simTicks = 0;
    this.push({ t: 'round', round: this.game.round, snap: this.game.snapshot() });
    this.turnKey = null;
    this.schedule();
  }

  schedule() {
    if (this.scheduled || this.status !== 'live') return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.step();
    });
  }

  // Run the simulation until it needs input, yielding every ~20ms so one
  // match can't starve the event loop.
  step() {
    if (this.status !== 'live' || this.stage !== 'play') return;
    const g = this.game;
    const t0 = Date.now();
    while (Date.now() - t0 < 20) {
      if (g.phase === 'over') return this.afterRound();
      const waiting = g.waitingFor();
      if (waiting.length) return this.awaitMoves();
      g.update(this.E.PHYS.tick);
      if (++this.simTicks > MAX_SIM_TICKS) g.forceEndRound();
    }
    this.schedule();
  }

  awaitMoves() {
    const key = this.game.round + ':' + this.game.turnCount;
    if (this.turnKey !== key) {
      this.turnKey = key;
      this.deadline = Date.now() + this.settings.turnTimeout * 1000;
      this.bump();
    }
  }

  afterRound() {
    const g = this.game;
    const s = g.summary;
    this.push({
      t: 'roundEnd',
      round: g.round,
      winner: s.winner ? s.winner.index : -1,
      reason: s.reason || null,
      rows: s.rows.map((r) => ({ seat: r.p.index, earned: r.earned, interest: r.interest, kills: r.kills, alive: r.alive, cash: r.p.cash, score: Math.round(r.p.score) })),
    });
    g.phase = 'idle';
    if (g.gameOver || this.seats.filter((s) => !this.players[s.index].forfeit).length < 2) return this.finish();
    this.beginShop();
  }

  finish() {
    this.status = 'done';
    this.stage = null;
    clearInterval(this.timer);
    const standings = this.standings();
    this.push({ t: 'end', standings });
    // Ties in score share a place.
    let place = 0;
    let prev = null;
    const seen = new Set();
    const ranked = [];
    standings.forEach((r, i) => {
      if (r.score !== prev) place = i + 1;
      prev = r.score;
      // Duplicate bots of one type share a rating row; rate only the best copy.
      const agentId = this.seats[r.seat].agentId;
      if (!seen.has(agentId)) ranked.push({ agentId, place });
      seen.add(agentId);
    });
    try {
      if (this.rated) this.store.applyResult(ranked);
      this.store.saveMatch(this.id, this.createdAt, this.summary(), this.log);
    } catch (e) {
      console.error('saving match', this.id, e);
    }
    this.bump();
    if (this.onEnd) this.onEnd(this);
  }

  expire() {
    this.status = 'expired';
    clearInterval(this.timer);
    this.bump();
    if (this.onEnd) this.onEnd(this);
  }

  standings() {
    return this.players
      .map((p) => ({ seat: p.index, name: p.name, score: Math.round(p.score), wins: p.wins, kills: p.kills, cash: p.cash, forfeit: !!p.forfeit }))
      .sort((a, b) => b.score - a.score);
  }

  checkTimeouts() {
    const now = Date.now();
    if (this.status === 'lobby' && now - this.createdAt > LOBBY_TTL) return this.expire();
    if (this.status !== 'live' || now < this.deadline) return;
    if (this.stage === 'shop') {
      this.shoppers.clear();
      return this.startRound();
    }
    if (this.stage === 'play') {
      for (const p of this.game.waitingFor()) {
        const seat = this.seats[p.index];
        seat.timeouts++;
        if (seat.timeouts >= 3) this.forfeit(seat, 'timed out 3 turns in a row');
        else this.game.commit(p, { weapon: 'pass' });
      }
      this.schedule();
    }
  }

  forfeit(seat, why) {
    const p = this.players && this.players[seat.index];
    if (!p) return;
    p.forfeit = true;
    seat.forfeitReason = why;
    if (p.alive) p.health = 0;
    if (this.stage === 'play' && this.game.waitingFor().includes(p)) this.game.commit(p, { weapon: 'pass' });
    if (this.shoppers) this.shoppers.delete(seat.index);
    if (this.stage === 'shop' && !this.shoppers.size) this.startRound();
    this.bump();
    this.schedule();
  }

  // ------------------------------------------------------------- agent input
  needs(seat) {
    if (this.status !== 'live') return null;
    if (this.stage === 'shop') return this.shoppers.has(seat.index) ? 'shop' : null;
    if (this.stage === 'play' && this.game.waitingFor().includes(this.players[seat.index])) return 'move';
    return null;
  }

  move(seat, body = {}) {
    if (this.needs(seat) !== 'move') throw new HttpError(409, 'not waiting for a move from you right now');
    const g = this.game;
    const E = this.E;
    const p = this.players[seat.index];
    seat.timeouts = 0;

    // Pre-shot prep, in order: parachute toggle, items, driving.
    if (typeof body.parachutes === 'boolean') p.useChutes = body.parachutes;
    const used = [];
    for (const id of (Array.isArray(body.items) ? body.items : []).slice(0, 12)) {
      const it = E.ITEM[id];
      if (!it || (it.kind !== 'battery' && it.kind !== 'shield')) throw new HttpError(400, `items: "${id}" is not a battery or shield`);
      if (g.useItem(p, id)) used.push(id);
    }
    let drove = 0;
    const want = int(body.drive, -300, 300, 0);
    for (let i = 0; i < Math.abs(want); i++) {
      if (!g.drive(p, Math.sign(want))) break;
      drove += Math.sign(want);
    }

    const weapon = body.weapon === 'pass' ? 'pass' : body.weapon || 'baby_missile';
    if (weapon !== 'pass' && !E.WEAPON[weapon]) throw new HttpError(400, `unknown weapon "${weapon}"`);
    if (weapon !== 'pass' && !p.count(weapon)) throw new HttpError(400, `you have no ${weapon}`);
    const action = {
      weapon,
      angle: num(body.angle, 0, 180, p.angle),
      power: num(body.power, 0, 1000, p.power),
      guidance: null,
      target: null,
      trigger: body.trigger === true,
    };
    if (body.guidance) {
      const it = E.ITEM[body.guidance];
      if (!it || it.kind !== 'guidance') throw new HttpError(400, `guidance: "${body.guidance}" is not a guidance item`);
      if (!p.count(body.guidance)) throw new HttpError(400, `you have no ${body.guidance}`);
      action.guidance = body.guidance;
    }
    if (body.target !== undefined && body.target !== null) {
      const t = this.players[int(body.target, 0, 9, -1)];
      if (!t || t === p) throw new HttpError(400, 'target must be another seat index');
      action.target = t;
    }
    g.commit(p, action);
    this.simTicks = 0;
    this.bump();
    this.schedule();
    return { accepted: true, used, drove, power: Math.min(action.power, p.maxPower) };
  }

  shop(seat, body = {}) {
    if (this.needs(seat) !== 'shop') throw new HttpError(409, 'not shopping right now');
    const E = this.E;
    const p = this.players[seat.index];
    const level = this.settings.armsLevel;
    const lookup = (id) => {
      const t = E.WEAPON[id] || E.ITEM[id];
      if (!t || t.infinite || t.tier > level) throw new HttpError(400, `"${id}" is not for sale`);
      return t;
    };
    const bought = [];
    const sold = [];
    for (const [id, n] of Object.entries(body.sell || {})) {
      const t = lookup(id);
      const units = Math.min(p.count(id), int(n, 0, 1000, 0) * t.qty);
      if (!units) continue;
      p.inventory[id] -= units;
      p.cash += Math.floor((t.price / t.qty) * units * E.ECON.sellRate);
      sold.push({ id, units });
    }
    for (const [id, n] of Object.entries(body.buy || {})) {
      const t = lookup(id);
      for (let i = 0; i < int(n, 0, 50, 0) && p.cash >= t.price; i++) {
        p.cash -= t.price;
        p.add(id, t.qty);
        bought.push(id);
      }
    }
    seat.timeouts = 0;
    if (body.done !== false) this.shoppers.delete(seat.index);
    this.push({ t: 'shop', seat: seat.index, bought, sold });
    if (!this.shoppers.size) this.startRound();
    else this.bump();
    return { cash: p.cash, inventory: { ...p.inventory }, bought, sold };
  }

  // Snapshots in the public log carry RNG state so the spectator can replay
  // volleys exactly. A rated match swaps in secret state before anything
  // agents must not foresee is drawn (terrain, bot aim, gusts), and a volley's
  // state is published only once all its shots are committed.
  freshEntropy() {
    if (!this.rated) return;
    const b = crypto.randomBytes(16);
    this.E.RNG.state = [0, 4, 8, 12].map((o) => b.readInt32LE(o));
  }

  // ------------------------------------------------------------- views
  logVolley(list) {
    const g = this.game;
    this.freshEntropy();
    this.push({
      t: 'volley',
      round: g.round,
      forecast: g.wind,
      snap: g.snapshot(),
      actions: list.map((p) => {
        const a = p.pending;
        return { seat: p.index, weapon: a.weapon, angle: a.angle, power: a.power, guidance: a.guidance || null, target: a.target ? a.target.index : null, trigger: !!a.trigger };
      }),
    });
  }

  push(entry) {
    entry.n = this.log.length;
    this.log.push(entry);
    this.bump();
  }

  bump() {
    this.version++;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  waitForChange(ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  publicSeats() {
    return this.seats.map((s) => ({ seat: s.index, name: s.name || null, kind: s.kind, bot: s.botType || null }));
  }

  summary() {
    const g = this.game;
    return {
      id: this.id,
      status: this.status,
      stage: this.stage,
      createdAt: this.createdAt,
      seed: this.rated ? undefined : this.seed,
      rated: this.rated,
      round: g ? g.round : 0,
      rounds: this.settings.rounds,
      settings: { turnMode: this.settings.turnMode, gusts: this.settings.gusts, wind: this.settings.wind, rounds: this.settings.rounds, startCash: this.settings.startCash, armsLevel: this.settings.armsLevel },
      seats: this.seats.map((s) => {
        const p = this.players && this.players[s.index];
        return { seat: s.index, name: s.name || null, kind: s.kind, bot: s.botType || null, score: p ? Math.round(p.score) : 0, alive: p ? p.alive : null, health: p ? p.health : null };
      }),
      standings: this.status === 'done' ? this.standings() : undefined,
    };
  }

  // Everything an agent needs to decide its move.
  stateFor(seat, { runs = false } = {}) {
    const base = { match: this.id, status: this.status, you: seat.index, version: this.version, needs: this.needs(seat) };
    if (this.status === 'lobby') return { ...base, seats: this.publicSeats(), openSeats: this.openCount };
    if (this.status === 'done' || this.status === 'expired') return { ...base, standings: this.standings() };
    const g = this.game;
    const E = this.E;
    const me = this.players[seat.index];
    const out = {
      ...base,
      deadline: base.needs ? new Date(this.deadline).toISOString() : null,
      stage: this.stage,
      round: g.round,
      rounds: this.settings.rounds,
      turnMode: this.settings.turnMode,
      turn: g.turnCount,
    };
    if (g.terrain) {
      out.world = {
        width: g.W,
        height: g.H,
        walls: g.walls,
        gravity: g.g,
        wind: g.wind,
        windAccel: g.wind * E.PHYS.windScale,
        maxWind: g.maxWind,
        gusts: this.settings.gusts,
        surface: g.terrain.heights(),
      };
      if (runs) out.world.terrainRuns = g.terrain.toRuns();
    }
    out.tanks = this.players.map((p) => ({
      seat: p.index,
      name: p.name,
      kind: this.seats[p.index].kind,
      alive: !!p.alive,
      x: p.x,
      y: p.y,
      health: p.health,
      maxPower: p.maxPower,
      angle: Math.round(p.angle * 10) / 10,
      power: Math.round(p.power),
      shield: p.shield ? { type: p.shield.id, hp: Math.round(p.shield.hp) } : null,
      score: Math.round(p.score),
      committed: !!p.pending,
    }));
    out.self = {
      cash: me.cash,
      health: me.health,
      maxPower: me.maxPower,
      fuel: me.fuel + me.count('fuel_tank') * 10,
      parachutes: me.useChutes,
      inventory: Object.fromEntries(Object.entries(me.inventory).filter(([, n]) => n > 0)),
    };
    const lastVolley = [...this.log].reverse().find((e) => e.t === 'volley' && e.round === g.round);
    if (lastVolley) {
      out.lastVolley = {
        actions: lastVolley.actions,
        forecastWind: lastVolley.forecast,
        actualWind: lastVolley.windActual,
        healthBefore: lastVolley.snap.players.map((p) => p.health),
      };
    }
    if (out.needs === 'shop') {
      out.catalog = [...E.WEAPONS, ...E.ITEMS]
        .filter((t) => !t.infinite && t.tier <= this.settings.armsLevel)
        .map((t) => ({ id: t.id, name: t.name, kind: t.kind, price: t.price, qty: t.qty, ...(t.radius ? { radius: t.radius } : {}), ...(t.damage ? { damage: t.damage } : {}) }));
    }
    return out;
  }
}

module.exports = { Match, HttpError, sanitizeSettings };
