'use strict';

// Spectator for agent-arena matches: pulls the server's match log and
// replays it with the same engine. Each volley entry carries a full snapshot
// taken just before it launched, so the view re-syncs every shot even if this
// browser's floating point drifts from the server's.
const Watch = {
  active: false,
  apiBase() {
    const q = new URLSearchParams(location.search).get('api');
    if (q) return q.replace(/\/$/, '');
    return location.protocol.startsWith('http') ? '' : null;
  },

  async fetchJson(path) {
    const base = this.apiBase();
    if (base === null) throw new Error('no API');
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(res.status + ' ' + path);
    return res.json();
  },

  start(id) {
    this.stop();
    this.active = true;
    this.id = id;
    this.entries = [];
    this.next = 0;
    this.cursor = 0;
    this.hold = 0;
    this.status = 'live';
    this.game = null;
    document.body.classList.add('watching');
    UI.game = null;
    UI.clearBubbles();
    $$('.modal').forEach((m) => m.classList.remove('show'));
    UI.show(null);
    UI.banner('Loading match…', 1500);
    this.poll();
  },

  stop() {
    this.active = false;
    clearTimeout(this.pollTimer);
    document.body.classList.remove('watching');
  },

  async poll() {
    if (!this.active) return;
    try {
      const r = await this.fetchJson(`/api/matches/${encodeURIComponent(this.id)}/log?since=${this.next}`);
      if (!this.active) return;
      this.entries.push(...r.entries);
      this.next = r.next;
      this.status = r.status;
    } catch {
      UI.banner('Could not load match ' + escapeHtml(this.id), 3000);
    }
    if (this.active && this.status !== 'done' && this.status !== 'expired') this.pollTimer = setTimeout(() => this.poll(), 1500);
  },

  // Called every frame by the main loop.
  tick(dt) {
    if (!this.active) return;
    const g = this.game;
    if (g && g.phase !== 'idle') return;
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    if (this.cursor < this.entries.length) this.apply(this.entries[this.cursor++]);
  },

  apply(e) {
    switch (e.t) {
      case 'start': {
        const players = e.seats.map((s, i) => new Player({ name: s.name || 'Seat ' + i, type: s.kind === 'bot' ? s.bot : 'remote', color: PLAYER_COLORS[i], index: i }));
        this.game = new Game(e.settings, players, { say: (p, text) => UI.say(p, text) }, e.seed);
        this.game.replay = true;
        UI.game = this.game;
        break;
      }
      case 'round':
        this.game.restore(e.snap);
        this.game.tracers = [];
        UI.show(null);
        UI.fit();
        UI.banner(`Round ${e.round} of ${this.game.settings.rounds}<small>${WALL_LABELS[this.game.walls]} walls · ${this.game.settings.turnMode === 'simultaneous' ? 'simultaneous fire' : 'taking turns'}</small>`, 2000);
        this.hold = 1.6;
        break;
      case 'volley': {
        const g = this.game;
        g.restore(e.snap);
        for (const a of e.actions) {
          g.players[a.seat].pending = { ...a, target: a.target === null || a.target === undefined ? null : g.players[a.target] };
        }
        const list = e.actions.map((a) => g.players[a.seat]);
        g.current = list.length === 1 ? list[0] : null;
        g.launchVolley(list);
        this.hold = 0.5;
        break;
      }
      case 'roundEnd': {
        const w = e.winner >= 0 ? this.game.players[e.winner] : null;
        UI.banner(w ? `<span style="color:${w.color}">${escapeHtml(w.name)}</span> wins the round` : 'Round over — no winner', 2500);
        this.hold = 2.5;
        break;
      }
      case 'end':
        for (const r of e.standings) {
          const p = this.game.players[r.seat];
          Object.assign(p, { score: r.score, wins: r.wins, kills: r.kills });
        }
        UI.showFinal(true);
        break;
    }
  },

  // ---------------------------------------------------------------- lobby
  async openArena() {
    UI.show('arena');
    const body = $('#arena-body');
    body.innerHTML = '<p class="small">Loading…</p>';
    try {
      const [live, done, lb] = await Promise.all([
        this.fetchJson('/api/matches?status=live'),
        this.fetchJson('/api/matches?status=done'),
        this.fetchJson('/api/leaderboard'),
      ]);
      const row = (m) => {
        const names = m.seats.map((s) => escapeHtml(s.name || 'open seat')).join(' · ');
        const extra = m.status === 'done' && m.standings ? `winner: ${escapeHtml(m.standings[0].name)}` : `round ${m.round}/${m.rounds}`;
        return `<button class="btn arena-match" data-id="${escapeHtml(m.id)}"><span>${names}</span><span class="small">${extra}</span></button>`;
      };
      body.innerHTML = `
        <h3>Live</h3>${live.matches.length ? live.matches.map(row).join('') : '<p class="small">No matches right now.</p>'}
        <h3>Recent</h3>${done.matches.length ? done.matches.map(row).join('') : '<p class="small">None yet.</p>'}
        <h3>Leaderboard</h3>
        <table class="standings arena-lb"><tr><th>#</th><th>Name</th><th class="num">Rating</th><th class="num">Games</th><th class="num">Wins</th></tr>
        ${lb.leaderboard.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="num">${r.rating}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td></tr>`).join('') || '<tr><td colspan="5">No rated games yet.</td></tr>'}
        </table>`;
      $$('.arena-match', body).forEach((b) => b.addEventListener('click', () => this.start(b.dataset.id)));
    } catch {
      body.innerHTML = '<p>The arena server isn’t reachable from here.</p>';
    }
  },

  async probe() {
    try {
      await this.fetchJson('/api');
      $('#btn-arena').style.display = '';
    } catch {
      /* offline / file:// — single-player only */
    }
  },
};
