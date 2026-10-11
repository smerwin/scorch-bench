'use strict';

// Spectator for agent-arena matches: pulls the server's match log and
// replays it with the same engine. Each volley entry carries a full snapshot
// taken just before it launched, so the view re-syncs every shot even if this
// browser's floating point drifts from the server's.
//
// With `play` set, this browser also holds a seat: it registers as an arena
// agent like any other, long-polls its state, and turns the HUD, shop and
// FIRE button into calls to the same /shop and /move endpoints agents use.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Watch = {
  active: false,
  play: null,
  apiBase() {
    const q = new URLSearchParams(location.search).get('api');
    if (q) return q.replace(/\/$/, '');
    return location.protocol.startsWith('http') ? '' : null;
  },

  origin() {
    return this.apiBase() || location.origin;
  },

  async fetchJson(path, opts) {
    const base = this.apiBase();
    if (base === null) throw new Error('no API');
    const res = await fetch(base + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.status + ' ' + path), { status: res.status });
    // Server clock, to turn its deadlines into local countdowns.
    const date = Date.parse(res.headers.get('date'));
    this.clockSkew = Number.isFinite(date) ? date - Date.now() : 0;
    return data;
  },

  // ------------------------------------------------------------- identity
  agent() {
    return store.get('arenaAgent', null);
  },

  agentApi(method, path, body) {
    const me = this.agent();
    return this.fetchJson(path, {
      method,
      headers: { authorization: 'Bearer ' + (me && me.key), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async ensureAgent(name) {
    const have = this.agent();
    if (have) return have;
    const r = await this.fetchJson('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const me = { id: r.id, name: r.name, key: r.key };
    store.set('arenaAgent', me);
    return me;
  },

  start(id, play = null) {
    this.stop();
    this.active = true;
    this.id = id;
    this.entries = [];
    this.next = 0;
    this.cursor = 0;
    this.hold = 0;
    this.status = 'live';
    this.game = null;
    this.lobbyId = null;
    this.play = play && { seat: play.seat, catchUp: !!play.catchUp, need: null, acting: null, done: null, state: null };
    document.body.classList.add('watching');
    document.body.classList.toggle('playing', !!play);
    if (play) history.replaceState(null, '', '?play=' + encodeURIComponent(id) + this.apiParam());
    UI.game = null;
    UI.lockControls();
    UI.clearBubbles();
    $$('.modal').forEach((m) => m.classList.remove('show'));
    UI.show(null);
    UI.banner('Loading match…', 1500);
    this.poll();
    if (play) this.statePoll();
  },

  stop() {
    this.active = false;
    this.play = null;
    clearTimeout(this.pollTimer);
    document.body.classList.remove('watching', 'playing');
    if (new URLSearchParams(location.search).has('play')) history.replaceState(null, '', location.pathname + this.apiParam().replace('&', '?'));
  },

  apiParam() {
    const q = new URLSearchParams(location.search).get('api');
    return q ? '&api=' + encodeURIComponent(q) : '';
  },

  async poll() {
    if (!this.active) return;
    const id = this.id;
    await this.fetchLog();
    if (this.active && this.id === id && this.status !== 'done' && this.status !== 'expired') this.pollTimer = setTimeout(() => this.poll(), this.play ? 1000 : 1500);
  },

  // One log fetch at a time; callers that need fresh entries await it.
  fetchLog() {
    if (this.fetching) return this.fetching.then(() => this.fetchLog());
    const id = this.id;
    this.fetching = (async () => {
      try {
        const r = await this.fetchJson(`/api/matches/${encodeURIComponent(id)}/log?since=${this.next}`);
        if (!this.active || this.id !== id) return;
        this.entries.push(...r.entries);
        this.next = r.next;
        this.status = r.status;
      } catch {
        UI.banner('Could not load match ' + escapeHtml(id), 3000);
      }
    })().finally(() => (this.fetching = null));
    return this.fetching;
  },

  // Called every frame by the main loop.
  tick(dt) {
    if (!this.active) return;
    const g = this.game;
    const pl = this.play;
    if (pl && pl.need && this.stale(pl.need)) this.dropNeed('Out of time — the match moved on');
    if (g && g.phase !== 'idle') return;
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    // Back after a reload: skip straight to the current round.
    if (pl && pl.catchUp && this.entries.length) {
      pl.catchUp = false;
      this.apply(this.entries[0]);
      this.cursor = Math.max(1, this.entries.map((e) => e.t).lastIndexOf('round'));
    }
    if (this.cursor < this.entries.length) return this.apply(this.entries[this.cursor++]);
    if (pl && pl.need && !pl.acting && g) this.act(pl.need);
  },

  apply(e) {
    switch (e.t) {
      case 'start': {
        const players = e.seats.map((s, i) => new Player({
          name: s.name || 'Seat ' + i,
          type: s.kind === 'bot' ? s.bot : this.play && this.play.seat === i ? 'human' : 'remote',
          color: PLAYER_COLORS[i],
          index: i,
        }));
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
        UI.banner(w ? `<span style="color:${w.color}">${escapeHtml(w.name)}</span> wins the round` : e.reason === 'stalemate' ? 'Stalemate — round drawn' : 'Round over — no winner', 2500);
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

  // ---------------------------------------------------------------- playing
  // Long-polls this seat's state. A `need` (shop or move) waits here until the
  // replay has caught up to it, then act() hands it to the player.
  async statePoll() {
    const pl = this.play;
    const id = this.id;
    let since = -1;
    while (this.active && this.play === pl) {
      if (pl.need) {
        await sleep(400);
        continue;
      }
      let s;
      try {
        s = await this.agentApi('GET', `/api/matches/${encodeURIComponent(id)}/state?wait=25&since=${since}&terrain=runs`);
      } catch (e) {
        if (e.status === 401 || e.status === 403 || e.status === 404) return;
        await sleep(3000);
        continue;
      }
      if (this.play !== pl) return;
      since = s.version;
      pl.state = s;
      if (s.status === 'done' || s.status === 'expired') return;
      if (!s.needs) continue;
      const key = s.needs === 'shop' ? `shop:${s.round}` : `move:${s.round}:${s.turn}`;
      if (key === pl.done) {
        await sleep(1000);
        continue;
      }
      // Every log entry from before this state is needed before acting on it.
      await this.fetchLog();
      if (this.play !== pl) return;
      pl.need = { key, s, logAt: this.entries.length, deadline: Date.parse(s.deadline) - this.clockSkew };
    }
  },

  // Anything but a shop entry after the state was read means its turn or shop phase is over.
  stale(need) {
    for (let i = need.logAt; i < this.entries.length; i++) if (this.entries[i].t !== 'shop') return true;
    return false;
  },

  dropNeed(msg) {
    const pl = this.play;
    const g = this.game;
    if (pl.acting === 'move' && g && g.phase === 'aim') {
      g.phase = 'idle';
      g.current = null;
      UI.onFire();
    }
    if (pl.acting === 'shop') {
      UI.shopDone = null;
      UI.show(null);
    }
    if (pl.acting && msg) UI.banner(msg, 2200);
    pl.acting = null;
    pl.need = null;
  },

  act(need) {
    const pl = this.play;
    const g = this.game;
    const s = need.s;
    const me = g.players[pl.seat];
    me.cash = s.self.cash;
    me.inventory = { ...s.self.inventory };
    if (s.needs === 'shop') {
      pl.acting = 'shop';
      UI.openShop(me, () => this.finishShop(need));
      return;
    }
    if (!g.terrain) return;
    pl.acting = 'move';
    this.sync(s);
    me.pending = null;
    me.driveDir = 0;
    g.volley = [me];
    g.current = me;
    g.phase = 'aim';
    pl.aim = { x: me.x, items: [] };
    Sound.turn();
    UI.banner('Your turn', 1000);
  },

  // Make the local world match the server's before the player aims.
  sync(s) {
    const g = this.game;
    g.wind = s.world.wind;
    if (s.world.terrainRuns && s.world.height === g.H) g.terrain.fromRuns(s.world.terrainRuns);
    for (const t of s.tanks) {
      const p = g.players[t.seat];
      Object.assign(p, { x: t.x, y: t.y, health: t.health, alive: t.alive, dead: !t.alive, angle: t.angle, falling: false });
      const it = t.shield && ITEM[t.shield.type];
      p.shield = it ? { id: it.id, hp: t.shield.hp, max: it.hp, mag: it.mag || 0, deflect: !!it.deflect, color: SHIELD_COLORS[it.id] } : null;
    }
    const me = g.players[this.play.seat];
    me.power = Math.min(s.tanks[me.index].power, me.maxPower);
    me.fuel = s.self.fuel - (s.self.inventory.fuel_tank || 0) * 10;
    me.useChutes = s.self.parachutes;
  },

  // Called from UI when a battery or shield is used while aiming.
  usedItem(id) {
    if (this.play && this.play.aim) this.play.aim.items.push(id);
  },

  async fire() {
    const pl = this.play;
    const g = this.game;
    const p = g && g.current;
    if (!pl || pl.acting !== 'move' || !p || !g.canAct()) return;
    const body = { weapon: p.weapon, angle: Math.round(p.angle), power: Math.round(p.power), parachutes: !!p.useChutes, trigger: !!p.trigger };
    if (pl.aim.items.length) body.items = pl.aim.items;
    const drove = Math.round(p.x - pl.aim.x);
    if (drove) body.drive = drove;
    if (p.armedGuidance) body.guidance = p.armedGuidance;
    if (p.target && p.target.alive) body.target = p.target.index;
    const need = pl.need;
    p.armedGuidance = null;
    pl.aim = null;
    g.phase = 'idle';
    g.current = null;
    UI.onFire();
    try {
      await this.agentApi('POST', `/api/matches/${encodeURIComponent(this.id)}/move`, body);
      if (pl.need !== need) return;
      pl.done = need.key;
      UI.banner('Locked in', 900);
    } catch (e) {
      if (pl.need !== need) return;
      // A rejected move leaves the turn open: drop the need and re-read the state.
      UI.banner(e.status === 409 ? 'Too late — the turn moved on' : escapeHtml(e.message), 2500);
    }
    pl.need = null;
    pl.acting = null;
  },

  async trade(t, kind) {
    const pl = this.play;
    const p = UI.shopPlayer;
    try {
      const r = await this.agentApi('POST', `/api/matches/${encodeURIComponent(this.id)}/shop`, { [kind]: { [t.id]: 1 }, done: false });
      p.cash = r.cash;
      p.inventory = r.inventory;
      if (kind === 'buy') Sound.buy();
      else Sound.click();
    } catch (e) {
      Sound.denied();
      UI.banner(escapeHtml(e.message), 2000);
    }
    if (this.play === pl && pl.acting === 'shop') UI.renderShop();
  },

  async finishShop(need) {
    const pl = this.play;
    UI.show(null);
    try {
      await this.agentApi('POST', `/api/matches/${encodeURIComponent(this.id)}/shop`, {});
    } catch {
      /* shop already closed */
    }
    if (this.play !== pl || pl.need !== need) return;
    pl.done = need.key;
    pl.need = null;
    pl.acting = null;
  },

  async resign() {
    if (!this.play || !confirm('Resign this match?')) return;
    UI.closeModal('menu');
    try {
      await this.agentApi('POST', `/api/matches/${encodeURIComponent(this.id)}/resign`);
    } catch (e) {
      UI.banner(escapeHtml(e.message), 2000);
    }
  },

  // HUD suffix: time left to fire, or who the match is waiting on.
  statusText() {
    const pl = this.play;
    if (!pl || this.status === 'done') return '';
    if (pl.acting === 'move') return ` · ⏱ ${Math.max(0, Math.ceil((pl.need.deadline - Date.now()) / 1000))}s`;
    const g = this.game;
    if (pl.acting || !g || g.phase !== 'idle' || this.cursor < this.entries.length || this.hold > 0) return '';
    return ' · waiting for opponents';
  },

  // ---------------------------------------------------------------- lobby
  async host() {
    try {
      await this.ensureAgent($('#play-name').value.trim());
      const settings = { rounds: Number($('#play-rounds').value), turnMode: $('#play-turns').value, turnTimeout: Number($('#play-time').value), shopTimeout: 120 };
      const r = await this.agentApi('POST', '/api/matches', { openSeats: 1, settings });
      this.lobby(r.match, true);
    } catch (e) {
      this.arenaError(e.message);
    }
  },

  async join(id) {
    try {
      await this.ensureAgent($('#play-name').value.trim());
      const r = await this.agentApi('POST', `/api/matches/${encodeURIComponent(id)}/join`);
      if (r.status === 'live') this.start(id, { seat: r.seat });
      else this.lobby(id, false);
    } catch (e) {
      this.arenaError(e.message);
    }
  },

  arenaError(msg) {
    const el = $('#play-error');
    if (el) el.textContent = msg;
  },

  // Waits in the lobby until every seat is filled, then starts playing.
  async lobby(id, hosting) {
    UI.show('arena');
    this.lobbyId = id;
    history.replaceState(null, '', '?play=' + encodeURIComponent(id) + this.apiParam());
    const url = this.origin();
    const prompt = `Read ${url}/llms.txt. Register an agent there if you don't have one, then join Scorch match ${id} with POST ${url}/api/matches/${id}/join and play it to the end. Your opponent is me, a human, playing in a browser.`;
    $('#arena-body').innerHTML = `
      <h3>${hosting ? 'Waiting for your agent' : 'Waiting for the other seats'}</h3>
      ${hosting ? '<p>Give your agent this prompt:</p>' : ''}
      ${hosting ? `<textarea id="lobby-prompt" rows="4" readonly>${escapeHtml(prompt)}</textarea>` : ''}
      <div class="row">
        ${hosting ? '<button class="btn" id="lobby-copy">Copy prompt</button>' : ''}
        <button class="btn danger" id="lobby-cancel">${hosting ? 'Cancel match' : 'Leave'}</button>
      </div>
      <p class="small">Match <b>${escapeHtml(id)}</b>. It starts as soon as every seat is taken; lobbies expire after 15 minutes. Keep this tab open while you play: three missed moves forfeit the match.</p>
      <p class="small" id="lobby-status"></p>`;
    const copy = $('#lobby-copy');
    if (copy) {
      copy.addEventListener('click', () => {
        $('#lobby-prompt').select();
        Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(prompt)).then(() => (copy.textContent = 'Copied'), () => {});
      });
    }
    $('#lobby-cancel').addEventListener('click', async () => {
      this.lobbyId = null;
      await this.agentApi('POST', `/api/matches/${encodeURIComponent(id)}/resign`).catch(() => {});
      history.replaceState(null, '', location.pathname + this.apiParam().replace('&', '?'));
      this.openArena();
    });
    let since = -1;
    while (this.lobbyId === id) {
      let s;
      try {
        s = await this.agentApi('GET', `/api/matches/${encodeURIComponent(id)}/state?wait=25&since=${since}`);
      } catch (e) {
        if (this.lobbyId !== id) return;
        $('#lobby-status').textContent = e.status === 404 ? 'That match is gone.' : e.message;
        if (e.status === 404 || e.status === 403 || e.status === 401) return;
        await sleep(3000);
        continue;
      }
      if (this.lobbyId !== id) return;
      since = s.version;
      if (s.status === 'live') return this.start(id, { seat: s.you });
      if (s.status === 'done') return this.start(id);
      if (s.status === 'expired') {
        this.lobbyId = null;
        $('#lobby-status').textContent = 'The lobby expired before every seat was taken.';
        return;
      }
      const taken = s.seats.filter((x) => x.kind !== 'open').map((x) => escapeHtml(x.name));
      $('#lobby-status').innerHTML = `Seated: ${taken.join(', ')} · ${s.openSeats} open`;
    }
  },

  // ?play=<id>: pick a seat back up after a reload.
  async resume(id) {
    if (!this.agent()) return this.openArena();
    try {
      const s = await this.agentApi('GET', `/api/matches/${encodeURIComponent(id)}/state`);
      if (s.status === 'lobby') return this.lobby(id, s.you === 0);
      if (s.status === 'live') return this.start(id, { seat: s.you, catchUp: true });
    } catch {
      /* not seated, or gone */
    }
    return this.start(id);
  },
  // ?watch=live: the newest live match, else the most recent finished one.
  async startLive() {
    try {
      const live = await this.fetchJson('/api/matches?status=live');
      const m = live.matches.find((x) => x.status === 'live');
      if (m) return this.start(m.id);
      const done = await this.fetchJson('/api/matches?status=done');
      if (done.matches.length) return this.start(done.matches[0].id);
    } catch {
      /* fall through to the lobby */
    }
    return this.openArena();
  },

  async openArena() {
    UI.show('arena');
    const body = $('#arena-body');
    body.innerHTML = '<p class="small">Loading…</p>';
    try {
      const [live, lobbies, done, lb] = await Promise.all([
        this.fetchJson('/api/matches?status=live'),
        this.fetchJson('/api/matches?status=open'),
        this.fetchJson('/api/matches?status=done'),
        this.fetchJson('/api/leaderboard'),
      ]);
      const row = (m) => {
        const names = m.seats.map((s) => escapeHtml(s.name || 'open seat')).join(' · ');
        const extra = m.status === 'done' && m.standings ? `winner: ${escapeHtml(m.standings[0].name)}` : `round ${m.round}/${m.rounds}`;
        return `<button class="btn arena-match" data-id="${escapeHtml(m.id)}"><span>${names}</span><span class="small">${extra}</span></button>`;
      };
      const playing = live.matches;
      const open = lobbies.matches;
      const me = this.agent();
      body.innerHTML = `
        <h3>Play against your agent</h3>
        <p class="small">Host a match, hand your agent the prompt it shows, and fight it here. Or join an open lobby below.</p>
        <div class="options">
          <label>Your name${me ? `<input id="play-name" value="${escapeHtml(me.name)}" disabled>` : '<input id="play-name" maxlength="24" placeholder="2-24 letters or digits">'}</label>
          <label>Rounds<select id="play-rounds"><option>1</option><option selected>3</option><option>5</option></select></label>
          <label>Turns<select id="play-turns"><option value="simultaneous">Simultaneous</option><option value="sequential">Take turns</option></select></label>
          <label>Time per move<select id="play-time"><option value="90">90 s</option><option value="180" selected>3 min</option><option value="600">10 min</option></select></label>
        </div>
        <div class="row"><button class="btn fire" id="play-host">Host a match</button><span class="small" id="play-error"></span></div>
        ${open.length ? `<h3>Open lobbies</h3>${open.map((m) => `<button class="btn arena-match arena-join" data-id="${escapeHtml(m.id)}"><span>${m.seats.map((s) => escapeHtml(s.name || 'open seat')).join(' · ')}</span><span class="small">join</span></button>`).join('')}` : ''}
        ${playing.length || done.matches.length ? `<h3>Watch</h3><button class="btn big" id="arena-watch-now">${playing.length ? 'Watch a live match' : 'Watch the latest match'}</button>` : ''}
        <h3>Live</h3>${playing.length ? playing.map(row).join('') : '<p class="small">No matches right now.</p>'}
        <h3>Recent</h3>${done.matches.length ? done.matches.map(row).join('') : '<p class="small">None yet.</p>'}
        <h3>Leaderboard</h3>
        <table class="standings arena-lb"><tr><th>#</th><th>Name</th><th class="num">Rating</th><th class="num">Games</th><th class="num">Wins</th></tr>
        ${lb.leaderboard.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="num">${r.rating}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td></tr>`).join('') || '<tr><td colspan="5">No rated games yet.</td></tr>'}
        </table>`;
      $$('.arena-match:not(.arena-join)', body).forEach((b) => b.addEventListener('click', () => this.start(b.dataset.id)));
      $$('.arena-join', body).forEach((b) => b.addEventListener('click', () => this.join(b.dataset.id)));
      $('#play-host', body).addEventListener('click', () => this.host());
      const now = $('#arena-watch-now', body);
      if (now) now.addEventListener('click', () => this.startLive());
    } catch (err) {
      console.error(err);
      body.innerHTML = '<p>The arena server isn’t reachable from here.</p>';
    }
  },

  async probe() {
    try {
      await this.fetchJson('/api');
      $('#btn-arena').style.display = '';
      const live = await this.fetchJson('/api/matches?status=live');
      const n = live.matches.filter((m) => m.status === 'live').length;
      if (n) $('#btn-arena').textContent = `AI Arena · ${n} live`;
    } catch {
      /* offline / file:// — single-player only */
    }
  },
};
