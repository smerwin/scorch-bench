'use strict';

// A Player persists for the whole game (cash, score, inventory); the
// round-scoped tank state is reset by startRound().
class Player {
  constructor({ name, type, color, index }) {
    this.name = name;
    this.type = type; // 'human' or an AI_TYPES key
    this.color = color;
    this.rgb = hexToRgb(color);
    this.index = index;
    this.cash = 0;
    this.score = 0;
    this.kills = 0;
    this.wins = 0;
    this.inventory = {};
    this.memory = {};
    this.resetStats();
  }

  get isHuman() {
    return this.type === 'human';
  }

  get ai() {
    return AI_TYPES[this.type];
  }

  get isAI() {
    return !!AI_TYPES[this.type];
  }

  // Controlled over the network by an external agent.
  get isRemote() {
    return this.type === 'remote';
  }

  get label() {
    return this.isAI ? this.ai.name : this.isRemote ? 'Agent' : 'Human';
  }

  resetStats() {
    this.roundCash = 0;
    this.roundKills = 0;
    this.grudges = {};
  }

  count(id) {
    if (WEAPON[id] && WEAPON[id].infinite) return Infinity;
    return this.inventory[id] || 0;
  }

  add(id, n) {
    this.inventory[id] = (this.inventory[id] || 0) + n;
  }

  use(id) {
    if (WEAPON[id] && WEAPON[id].infinite) return true;
    if (!this.inventory[id]) return false;
    this.inventory[id]--;
    return true;
  }

  startRound(x, y) {
    this.x = x;
    this.y = y; // first solid row under the tank
    this.angle = x < PHYS.W / 2 ? 60 : 120;
    this.power = 450;
    this.health = 100;
    this.alive = true;
    this.dead = false;
    this.shield = null;
    this.falling = false;
    this.fallVy = 0;
    this.fallFrom = y;
    this.chute = false;
    this.useChutes = true;
    this.fuel = 0;
    this.lastHitBy = null;
    this.burn = 0;
    this.armedGuidance = null;
    this.trigger = false;
    this.target = null;
    this.weapon = 'baby_missile';
    this.driveDir = 0;
    this.pending = null;
    this.memory = {};
    this.resetStats();
    if (!this.count(this.weapon)) this.weapon = 'baby_missile';
  }

  get cx() {
    return this.x;
  }

  get cy() {
    return this.y - 4;
  }

  get maxPower() {
    return Math.max(0, Math.round(this.health * 10));
  }

  muzzle() {
    const a = this.angle * DEG;
    return { x: this.x + Math.cos(a) * PHYS.barrel, y: this.y - 7 - Math.sin(a) * PHYS.barrel };
  }

  ownedWeapons() {
    return WEAPONS.filter((w) => this.count(w.id) > 0);
  }

  ownedItems() {
    return ITEMS.filter((i) => this.count(i.id) > 0);
  }
}
