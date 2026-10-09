'use strict';

// SQLite (node:sqlite, no npm deps) for agents, ratings and finished matches.
// Live matches only exist in memory; a restart drops them.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind TEXT NOT NULL DEFAULT 'agent',
        key_hash TEXT UNIQUE,
        rating REAL NOT NULL DEFAULT 1200,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        summary TEXT NOT NULL,
        log BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS matches_finished ON matches (finished_at DESC);
    `);
  }

  createAgent(name) {
    const id = 'ag_' + crypto.randomBytes(6).toString('hex');
    const key = 'sk_' + crypto.randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO agents (id, name, kind, key_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, 'agent', hashKey(key), Date.now());
    return { id, name, key };
  }

  nameTaken(name) {
    return !!this.db.prepare('SELECT 1 FROM agents WHERE name = ?').get(name);
  }

  agentByKey(key) {
    if (!key) return null;
    return this.db.prepare('SELECT id, name, kind, rating, games, wins FROM agents WHERE key_hash = ?').get(hashKey(key)) || null;
  }

  // Built-in AIs get a leaderboard row too, so agents can see where they stand.
  botAgent(type, label) {
    const id = 'bot_' + type;
    const row = this.db.prepare('SELECT id, name, kind, rating FROM agents WHERE id = ?').get(id);
    if (row) return row;
    this.db.prepare('INSERT INTO agents (id, name, kind, created_at) VALUES (?, ?, ?, ?)').run(id, label + ' (bot)', 'bot', Date.now());
    return this.db.prepare('SELECT id, name, kind, rating FROM agents WHERE id = ?').get(id);
  }

  // Pairwise Elo over the final standings. `ranked` is best-first; entries
  // that share a `place` count as draws.
  applyResult(ranked) {
    const rows = ranked.map((r) => ({ ...r, rating: this.db.prepare('SELECT rating FROM agents WHERE id = ?').get(r.agentId).rating }));
    const n = rows.length;
    if (n < 2) return;
    const K = 32 / (n - 1);
    const delta = rows.map(() => 0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ei = 1 / (1 + 10 ** ((rows[j].rating - rows[i].rating) / 400));
        const si = rows[i].place === rows[j].place ? 0.5 : rows[i].place < rows[j].place ? 1 : 0;
        delta[i] += K * (si - ei);
        delta[j] -= K * (si - ei);
      }
    }
    const upd = this.db.prepare('UPDATE agents SET rating = rating + ?, games = games + 1, wins = wins + ? WHERE id = ?');
    rows.forEach((r, i) => upd.run(delta[i], r.place === 1 ? 1 : 0, r.agentId));
  }

  leaderboard(limit = 50) {
    return this.db
      .prepare('SELECT name, kind, ROUND(rating) AS rating, games, wins FROM agents WHERE games > 0 ORDER BY rating DESC LIMIT ?')
      .all(limit);
  }

  saveMatch(id, createdAt, summary, log) {
    const blob = zlib.gzipSync(Buffer.from(JSON.stringify(log)));
    this.db
      .prepare('INSERT OR REPLACE INTO matches (id, created_at, finished_at, summary, log) VALUES (?, ?, ?, ?, ?)')
      .run(id, createdAt, Date.now(), JSON.stringify(summary), blob);
  }

  matchSummary(id) {
    const row = this.db.prepare('SELECT summary FROM matches WHERE id = ?').get(id);
    return row ? JSON.parse(row.summary) : null;
  }

  matchLog(id) {
    const row = this.db.prepare('SELECT log FROM matches WHERE id = ?').get(id);
    return row ? JSON.parse(zlib.gunzipSync(row.log).toString()) : null;
  }

  recentMatches(limit = 20) {
    return this.db.prepare('SELECT summary FROM matches ORDER BY finished_at DESC LIMIT ?').all(limit).map((r) => JSON.parse(r.summary));
  }
}

module.exports = { Store };
