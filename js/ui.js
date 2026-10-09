'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const OPTION_DEFS = [
  { key: 'rounds', label: 'Rounds', options: [1, 3, 5, 10, 15, 20, 30].map((n) => [n, String(n)]) },
  { key: 'startCash', label: 'Starting cash', options: [0, 10000, 25000, 50000, 100000, 1000000].map((n) => [n, fmtMoney(n)]) },
  { key: 'interest', label: 'Interest per round', options: [0, 5, 10, 20].map((n) => [n, n + '%']) },
  { key: 'armsLevel', label: 'Arms level', options: [[0, '0 — pea shooters'], [1, '1'], [2, '2'], [3, '3'], [4, '4 — everything']] },
  { key: 'gravity', label: 'Gravity', options: [[0.5, 'Moon (0.5×)'], [0.75, 'Light (0.75×)'], [1, 'Normal'], [1.5, 'Heavy (1.5×)'], [2, 'Jupiter (2×)']] },
  { key: 'wind', label: 'Max wind', options: [[0, 'None'], [25, 'Breezy'], [60, 'Normal'], [120, 'Strong'], [200, 'Hurricane']] },
  { key: 'turnMode', label: 'Turns', options: [['sequential', 'Take turns'], ['simultaneous', 'Simultaneous']] },
  { key: 'gusts', label: 'Wind gusts after firing', options: [[0, 'Off'], [0.15, 'Light'], [0.3, 'Strong']] },
  { key: 'walls', label: 'Walls', options: ['random', ...WALL_TYPES].map((w) => [w, WALL_LABELS[w]]) },
  { key: 'terrain', label: 'Terrain', options: [['random', 'Random'], ...TERRAIN_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)])] },
  { key: 'theme', label: 'Scenery', options: [['random', 'Random'], ...THEMES.map((t) => [t.name, t.name])] },
  { key: 'speed', label: 'Game speed', options: [[1, 'Normal'], [2, 'Fast']] },
  { key: 'changingWind', label: 'Wind changes each turn', check: true },
  { key: 'fallingDirt', label: 'Animated falling dirt', check: true },
  { key: 'talking', label: 'Talking tanks', check: true },
  { key: 'hpBars', label: 'Health bars over tanks', check: true },
];

const UI = {
  game: null,
  renderer: null,
  paused: false,
  dragging: false,
  drag: null,
  bubbles: [],
  cache: {},
  shopTab: 'weapons',
  rotateDismissed: false,

  init() {
    this.renderer = new Renderer($('#cv'));
    this.settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
    this.setupPlayers = store.get('players', DEFAULT_PLAYERS).map((p) => ({ ...p }));
    this.bindControls();
    this.bindCanvas();
    this.bindKeys();
    this.bindMenus();
    this.drawTitleArt();
    this.show('title');
    window.addEventListener('resize', () => this.fit());
    document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });
  },

  // ------------------------------------------------------------ screens
  show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
    document.body.classList.toggle('in-round', !id);
    if (!id) this.fit();
  },

  openModal(id) {
    $('#' + id).classList.add('show');
  },

  closeModal(id) {
    $('#' + id).classList.remove('show');
    if (id === 'menu') this.paused = false;
  },

  anyModal() {
    return $$('.modal').some((m) => m.classList.contains('show'));
  },

  banner(html, ms = 1600) {
    const b = $('#banner');
    b.innerHTML = html;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  },

  fit() {
    const g = this.game;
    const cv = $('#cv');
    const stage = $('#stage');
    const W = g && g.W ? g.W : cv.width;
    const H = g && g.H ? g.H : cv.height;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;
    const s = Math.min(sw / W, sh / H);
    cv.style.width = Math.floor(W * s) + 'px';
    cv.style.height = Math.floor(H * s) + 'px';
    const portrait = window.innerHeight > window.innerWidth;
    $('#rotate-hint').style.display = portrait && g && !this.rotateDismissed && document.body.classList.contains('in-round') ? 'flex' : 'none';
  },

  stageAspect() {
    const stage = $('#stage');
    return stage.clientWidth / Math.max(1, stage.clientHeight);
  },

  // ------------------------------------------------------------ title
  drawTitleArt() {
    const c = $('#title-art');
    const x = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(255,255,255,${vrand(0.3, 1)})`;
      x.fillRect(Math.floor(vrand(W)), Math.floor(vrand(40)), 1, 1);
    }
    const ground = (px) => 62 + Math.sin(px * 0.03) * 8 + Math.sin(px * 0.011 + 2) * 10;
    for (let px = 0; px < W; px++) {
      const top = Math.round(ground(px));
      for (let py = top; py < H; py++) {
        const c2 = gradientAt(THEMES[1].ground, (py - 40) / 50);
        x.fillStyle = rgbStr(c2);
        x.fillRect(px, py, 1, 1);
      }
    }
    const tank = (tx, col, ang) => {
      const ty = Math.round(ground(tx));
      x.fillStyle = col;
      x.fillRect(tx - 6, ty - 4, 12, 3);
      x.beginPath();
      x.arc(tx, ty - 4, 4, Math.PI, 0);
      x.fill();
      x.strokeStyle = '#ddd';
      x.beginPath();
      x.moveTo(tx, ty - 6);
      x.lineTo(tx + Math.cos(ang) * 9, ty - 6 - Math.sin(ang) * 9);
      x.stroke();
    };
    tank(50, '#ff4b3e', 0.9);
    tank(265, '#3e8bff', 2.3);
    x.strokeStyle = 'rgba(255,255,255,0.6)';
    x.setLineDash([2, 3]);
    x.beginPath();
    for (let t = 0; t <= 1; t += 0.02) {
      const px = 57 + t * 150;
      const py = 50 - Math.sin(t * Math.PI) * 42 + t * t * 18;
      if (t === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.stroke();
    x.setLineDash([]);
    [[255, 255, 200], [255, 210, 60], [255, 120, 20]].reverse().forEach((col, i) => {
      x.fillStyle = rgbStr(col);
      x.beginPath();
      x.arc(220, 58, 14 - i * 4, 0, TAU);
      x.fill();
    });
  },

  // ------------------------------------------------------------ setup
  openSetup() {
    this.renderSetup();
    this.show('setup');
  },

  renderSetup() {
    const list = $('#player-list');
    list.innerHTML = '';
    const types = [['human', 'Human'], ...AI_KEYS.map((k) => [k, 'CPU: ' + AI_TYPES[k].name]), ['unknown', 'CPU: Unknown']];
    this.setupPlayers.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <span class="swatch" style="background:${PLAYER_COLORS[i]}"></span>
        <input type="text" maxlength="14" value="${escapeHtml(p.name)}" aria-label="Name">
        <select aria-label="Type">${types.map(([v, l]) => `<option value="${v}"${v === p.type ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" aria-label="Remove"${this.setupPlayers.length <= 2 ? ' disabled' : ''}>✕</button>`;
      $('input', row).addEventListener('input', (e) => (p.name = e.target.value));
      $('select', row).addEventListener('change', (e) => {
        const was = p.type;
        p.type = e.target.value;
        if (p.type === 'human' && was !== 'human' && CPU_NAMES.includes(p.name)) {
          p.name = 'Player ' + (i + 1);
          this.renderSetup();
        }
      });
      $('button', row).addEventListener('click', () => {
        this.setupPlayers.splice(i, 1);
        this.renderSetup();
      });
      list.appendChild(row);
    });
    $('#player-count').textContent = `(${this.setupPlayers.length}/10)`;
    $('#add-player').disabled = this.setupPlayers.length >= 10;

    const opts = $('#options');
    opts.innerHTML = '';
    for (const def of OPTION_DEFS) {
      const label = document.createElement('label');
      if (def.check) {
        label.className = 'check';
        label.innerHTML = `<input type="checkbox"${this.settings[def.key] ? ' checked' : ''}> ${def.label}`;
        $('input', label).addEventListener('change', (e) => (this.settings[def.key] = e.target.checked));
      } else {
        label.innerHTML = `${def.label}<select>${def.options
          .map(([v, l]) => `<option value="${v}"${String(v) === String(this.settings[def.key]) ? ' selected' : ''}>${l}</option>`)
          .join('')}</select>`;
        $('select', label).addEventListener('change', (e) => {
          const raw = e.target.value;
          this.settings[def.key] = typeof def.options[0][0] === 'number' ? Number(raw) : raw;
        });
      }
      opts.appendChild(label);
    }
  },

  addPlayer() {
    if (this.setupPlayers.length >= 10) return;
    const used = new Set(this.setupPlayers.map((p) => p.name));
    const name = CPU_NAMES.find((n) => !used.has(n)) || 'CPU ' + (this.setupPlayers.length + 1);
    this.setupPlayers.push({ name, type: pick(['shooter', 'poolshark', 'tosser', 'chooser']) });
    this.renderSetup();
  },

  startFromSetup() {
    store.set('settings', this.settings);
    store.set('players', this.setupPlayers);
    this.newGame(this.settings, this.setupPlayers);
  },

  quickBattle() {
    const names = shuffle(CPU_NAMES.slice());
    const players = [
      { name: 'You', type: 'human' },
      { name: names[0], type: 'shooter' },
      { name: names[1], type: 'poolshark' },
      { name: names[2], type: 'chooser' },
    ];
    this.newGame({ ...DEFAULT_SETTINGS, ...this.settings, rounds: 5, startCash: 25000, armsLevel: 4 }, players);
  },

  newGame(settings, configs) {
    this.lastSetup = { settings, configs };
    const players = configs.map((c, i) => new Player({
      name: (c.name || '').trim() || (c.type === 'human' ? 'Player ' + (i + 1) : CPU_NAMES[i]),
      type: c.type === 'unknown' ? pick(AI_KEYS) : c.type,
      color: PLAYER_COLORS[i],
      index: i,
    }));
    this.game = new Game(settings, players, {
      onTurn: (p) => this.onTurn(p),
      onRoundEnd: (s) => this.onRoundEnd(s),
      say: (p, text) => this.say(p, text),
      onFire: () => this.onFire(),
    });
    this.clearBubbles();
    this.shopThenRound();
  },

  // ------------------------------------------------------------ round flow
  shopThenRound() {
    const g = this.game;
    for (const p of g.players) if (p.isAI) AI.shop(p, g.settings);
    const humans = g.players.filter((p) => p.isHuman);
    const hasCash = humans.some((p) => p.cash >= 10);
    if (!hasCash) return this.startRound();
    let i = 0;
    const next = () => {
      if (i >= humans.length) return this.startRound();
      this.openShop(humans[i++], next);
    };
    next();
  },

  startRound() {
    this.show(null);
    this.clearBubbles();
    document.body.classList.remove('driving');
    const g = this.game;
    g.startRound(this.stageAspect());
    this.fit();
    const terr = g.terrainType[0].toUpperCase() + g.terrainType.slice(1);
    this.banner(`Round ${g.round} of ${g.settings.rounds}<small>${terr} · ${WALL_LABELS[g.walls]} walls · ${g.theme.name}</small>`, 2200);
  },

  onTurn(p) {
    document.body.classList.remove('driving');
    if (p.isHuman) {
      Sound.turn();
      const humans = this.game.players.filter((q) => q.isHuman).length;
      if (humans > 1 || this.game.turnCount === 1) this.banner(`<span style="color:${p.color}">${escapeHtml(p.name)}</span>'s turn`, 1200);
    }
  },

  onFire() {
    document.body.classList.remove('driving');
    this.closeModal('picker');
    this.closeModal('items');
  },

  onRoundEnd(summary) {
    setTimeout(() => this.showSummary(summary), 1400);
  },

  showSummary(summary) {
    const g = this.game;
    const { winner } = summary;
    const rows = summary.rows.slice().sort((a, b) => b.p.score - a.p.score);
    const title = winner ? `<span style="color:${winner.color}">${escapeHtml(winner.name)}</span> wins round ${g.round}!` : `Round ${g.round}: ${g.alive.length ? 'stalemate' : 'nobody survived'}`;
    $('#summary-body').innerHTML = `
      <h2 class="summary-title">${title}</h2>
      <table class="standings">
        <tr><th>Player</th><th class="num">Kills</th><th class="num">Earned</th><th class="num">Cash</th><th class="num">Score</th></tr>
        ${rows.map((r) => `<tr class="${r.alive ? '' : 'dead'}"><td><span class="dot" style="background:${r.p.color}"></span> ${escapeHtml(r.p.name)}${r.alive ? '' : ' ☠'}</td>
          <td class="num">${r.kills}</td><td class="num">${fmtMoney(r.earned + r.interest)}</td><td class="num">${fmtMoney(r.p.cash)}</td><td class="num">${Math.round(r.p.score)}</td></tr>`).join('')}
      </table>
      ${g.settings.interest ? `<p class="small">Includes ${g.settings.interest}% interest on cash.</p>` : ''}`;
    const actions = $('#summary-actions');
    actions.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn fire big';
    btn.textContent = g.gameOver ? 'Final Results' : 'Continue';
    btn.onclick = () => {
      this.closeModal('summary');
      if (g.gameOver) this.showFinal();
      else this.shopThenRound();
    };
    actions.appendChild(btn);
    this.openModal('summary');
    if (winner && winner.isHuman) Sound.fanfare();
  },

  showFinal(watching = false) {
    const g = this.game;
    const rows = g.players.slice().sort((a, b) => b.score - a.score);
    const champ = rows[0];
    $('#summary-body').innerHTML = `
      <h2 class="summary-title">🏆 <span style="color:${champ.color}">${escapeHtml(champ.name)}</span> is the champion!</h2>
      <table class="standings">
        <tr><th>#</th><th>Player</th><th class="num">Wins</th><th class="num">Kills</th><th class="num">Score</th></tr>
        ${rows.map((p, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="background:${p.color}"></span> ${escapeHtml(p.name)} <span class="small">${p.isHuman ? '' : p.label}</span></td>
          <td class="num">${p.wins}</td><td class="num">${p.kills}</td><td class="num">${Math.round(p.score)}</td></tr>`).join('')}
      </table>`;
    const actions = $('#summary-actions');
    actions.innerHTML = '';
    const again = document.createElement('button');
    again.className = 'btn fire big';
    again.textContent = watching ? 'More Matches' : 'Play Again';
    again.onclick = () => {
      this.closeModal('summary');
      if (watching) {
        this.quit();
        Watch.openArena();
      } else this.newGame(this.lastSetup.settings, this.lastSetup.configs);
    };
    const title = document.createElement('button');
    title.className = 'btn big';
    title.textContent = 'Title';
    title.onclick = () => this.quit();
    actions.append(title, again);
    this.openModal('summary');
    Sound.fanfare();
  },

  quit() {
    Watch.stop();
    $$('.modal').forEach((m) => m.classList.remove('show'));
    this.paused = false;
    this.game = null;
    this.clearBubbles();
    this.show('title');
  },

  // ------------------------------------------------------------ shop
  openShop(p, done) {
    this.shopPlayer = p;
    this.shopDone = done;
    $('#shop .dot').style.background = p.color;
    $('#shop-name').textContent = p.name;
    const g = this.game;
    $('#shop-sub').textContent = g.round === 0 ? 'Stock up before the first round.' : `Round ${g.round + 1} of ${g.settings.rounds} is next.`;
    this.renderShop();
    this.show('shop');
    $('#shop').scrollTop = 0;
  },

  renderShop() {
    const p = this.shopPlayer;
    const g = this.game;
    $('#shop-cash').textContent = fmtMoney(p.cash);
    $$('#shop .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.shopTab));
    const things = (this.shopTab === 'weapons' ? WEAPONS : ITEMS).filter((x) => x.tier <= g.settings.armsLevel && !x.infinite);
    const list = $('#shop-list');
    list.innerHTML = '';
    for (const t of things) {
      const owned = p.count(t.id);
      const row = document.createElement('div');
      row.className = 'shop-item' + (p.cash < t.price ? ' cant' : '');
      const info = t.info || (t.kind === 'missile' && t.id !== 'missile' ? '' : WEAPON_INFO[t.kind]) || '';
      row.innerHTML = `
        <div><div class="nm">${t.color ? `<span class="swatch" style="background:${t.color}"></span>` : ''}${escapeHtml(t.name)}</div><div class="info">${escapeHtml(info)}</div></div>
        <div><div class="price">${fmtMoney(t.price)} / ${t.qty}</div><div class="own">own ${owned}</div></div>
        <div class="btns"><button class="btn sell"${owned ? '' : ' disabled'}>Sell</button><button class="btn buy"${p.cash >= t.price ? '' : ' disabled'}>Buy</button></div>`;
      $('.buy', row).addEventListener('click', () => {
        if (p.cash < t.price) return Sound.denied();
        p.cash -= t.price;
        p.add(t.id, t.qty);
        Sound.buy();
        this.renderShop();
      });
      $('.sell', row).addEventListener('click', () => {
        const n = Math.min(p.count(t.id), t.qty);
        if (!n) return;
        p.inventory[t.id] -= n;
        p.cash += Math.floor((t.price / t.qty) * n * ECON.sellRate);
        Sound.click();
        this.renderShop();
      });
      list.appendChild(row);
    }
  },

  // ------------------------------------------------------------ in-round panels
  openPicker() {
    const g = this.game;
    if (!g || !g.canAct()) return;
    const p = g.current;
    const list = $('#picker-list');
    list.innerHTML = '';
    for (const w of p.ownedWeapons()) {
      const b = document.createElement('button');
      b.className = 'btn' + (p.weapon === w.id ? ' sel' : '');
      const n = p.count(w.id);
      b.innerHTML = `<span>${escapeHtml(w.name)}</span><span class="n">${n === Infinity ? '∞' : n}</span>`;
      b.addEventListener('click', () => {
        p.weapon = w.id;
        Sound.click();
        this.closeModal('picker');
      });
      list.appendChild(b);
    }
    this.openModal('picker');
  },

  openItems() {
    const g = this.game;
    if (!g || !g.canAct()) return;
    this.renderItems();
    this.openModal('items');
  },

  renderItems() {
    const g = this.game;
    const p = g.current;
    const list = $('#items-list');
    list.innerHTML = '';
    const row = (name, info, buttons) => {
      const r = document.createElement('div');
      r.className = 'item-row';
      r.innerHTML = `<div><b>${escapeHtml(name)}</b><div class="info">${escapeHtml(info)}</div></div><div></div><div class="btns"></div>`;
      for (const [label, fn, opts = {}] of buttons) {
        const b = document.createElement('button');
        b.className = 'btn' + (opts.on ? ' on' : '');
        b.textContent = label;
        b.disabled = !!opts.disabled;
        b.addEventListener('click', () => {
          fn();
          Sound.click();
          this.renderItems();
        });
        $('.btns', r).appendChild(b);
      }
      list.appendChild(r);
    };
    if (p.shield) {
      const s = ITEM[p.shield.id];
      row(`Active: ${s.name}`, `${Math.round(p.shield.hp)} / ${p.shield.max} strength`, []);
    }
    const owned = p.ownedItems();
    if (!owned.length && !p.fuel) {
      list.insertAdjacentHTML('beforeend', '<p>No accessories yet — buy them in the shop between rounds.</p>');
    }
    for (const it of owned) {
      const n = p.count(it.id);
      const label = `${it.name} ×${n}`;
      switch (it.kind) {
        case 'shield':
          row(label, it.info, [['Raise', () => g.useItem(p, it.id), { disabled: p.shield && p.shield.id === it.id && p.shield.hp >= it.hp }]]);
          break;
        case 'battery':
          row(label, `Health ${p.health}/100`, [['Use', () => g.useItem(p, it.id), { disabled: p.health >= 100 }]]);
          break;
        case 'parachute':
          row(label, it.info, [[p.useChutes ? 'Auto: ON' : 'Auto: OFF', () => (p.useChutes = !p.useChutes), { on: p.useChutes }]]);
          break;
        case 'trigger':
          row(label, it.info, [[p.trigger ? 'ON' : 'OFF', () => (p.trigger = !p.trigger), { on: p.trigger }]]);
          break;
        case 'guidance':
          row(label, it.info + (it.mode !== 'ballistic' ? ' Tap an enemy to pick the target.' : ''), [[
            p.armedGuidance === it.id ? 'Armed' : 'Arm',
            () => (p.armedGuidance = p.armedGuidance === it.id ? null : it.id),
            { on: p.armedGuidance === it.id },
          ]]);
          break;
        case 'fuel':
          break;
      }
    }
    if (p.count('fuel_tank') > 0 || p.fuel > 0) {
      row(`Fuel: ${p.fuel + p.count('fuel_tank') * 10} px`, 'Drive your tank left or right.', [['Drive', () => {
        this.closeModal('items');
        document.body.classList.add('driving');
      }]]);
    }
  },

  // ------------------------------------------------------------ speech
  say(p, text) {
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    $('#bubbles').appendChild(el);
    // One bubble per tank at a time.
    this.bubbles = this.bubbles.filter((b) => {
      if (b.p === p) {
        b.el.remove();
        return false;
      }
      return true;
    });
    this.bubbles.push({ el, p, x: p.x, y: p.y, until: performance.now() + 2300 });
  },

  clearBubbles() {
    for (const b of this.bubbles) b.el.remove();
    this.bubbles = [];
  },

  worldToStage(x, y) {
    const cv = $('#cv');
    const r = cv.getBoundingClientRect();
    const s = $('#stage').getBoundingClientRect();
    const k = r.width / cv.width;
    return { x: r.left - s.left + x * k, y: r.top - s.top + y * k };
  },

  toWorld(e) {
    const cv = $('#cv');
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
  },

  // ------------------------------------------------------------ per-frame HUD
  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  },

  updateHud() {
    const g = this.game;
    if (!g || !g.terrain) return;
    const p = g.current || g.players[0];
    const now = performance.now();

    this.set('pdot', $('#hud-player .dot').style, 'background', p.color);
    this.set('pname', $('#hud-player .name'), 'textContent', p.name + (p.isHuman ? '' : ` (${p.label})`));
    const hp = $('#hud-player .hp i');
    this.set('php', hp.style, 'width', p.health + '%');
    this.set('phpc', hp.style, 'background', p.health > 50 ? '#4f4' : p.health > 25 ? '#fd3' : '#f43');
    const extra = [`${p.health}`];
    if (p.shield) extra.push(`⛨${Math.round(p.shield.hp)}`);
    if (p.armedGuidance) extra.push('⌖');
    this.set('pextra', $('#hud-player .extra'), 'textContent', extra.join(' '));

    const w = g.wind;
    const arrows = w === 0 ? '' : '▸'.repeat(clamp(Math.ceil(Math.abs(w) / 35), 1, 4));
    const windTxt = w === 0 ? 'No wind' : w < 0 ? `${arrows.replace(/▸/g, '◂')} ${Math.abs(w)}` : `${Math.abs(w)} ${arrows}`;
    this.set('wind', $('#hud-wind'), 'textContent', 'Wind ' + windTxt + (g.settings.gusts && w !== 0 ? ' ~' : g.settings.gusts ? ' (gusty)' : ''));
    this.set('round', $('#hud-round'), 'textContent', `R${g.round}/${g.settings.rounds} · ${WALL_LABELS[g.walls]}`);

    const can = g.canAct() && !this.paused;
    const wpn = WEAPON[p.weapon] || WEAPON.baby_missile;
    const cnt = p.count(wpn.id);
    this.set('wname', $('#btn-weapon .wname'), 'textContent', wpn.name);
    this.set('wcount', $('#btn-weapon .wcount'), 'textContent', cnt === Infinity ? '∞' : String(cnt));
    this.set('angle', $('#angle-spin b'), 'textContent', String(Math.round(p.angle)));
    this.set('power', $('#power-spin b'), 'innerHTML', `${Math.round(p.power)}${p.maxPower < 1000 ? `<small>/${p.maxPower}</small>` : ''}`);
    this.set('fuel', $('#fuel-val'), 'textContent', String(p.fuel + p.count('fuel_tank') * 10));
    if (this.cache.can !== can) {
      this.cache.can = can;
      $$('#controls .btn').forEach((b) => {
        if (b.id !== 'btn-menu') b.disabled = !can;
      });
      $$('#drivebar .btn').forEach((b) => (b.disabled = !can));
    }

    // Speech bubbles follow their tank.
    if (this.bubbles.length) {
      this.bubbles = this.bubbles.filter((b) => {
        if (now > b.until) {
          b.el.remove();
          return false;
        }
        if (b.p.alive) {
          b.x = b.p.x;
          b.y = b.p.y;
        }
        const s = this.worldToStage(b.x, b.y - 18);
        b.el.style.left = s.x + 'px';
        b.el.style.top = s.y + 'px';
        return true;
      });
    }
  },

  // ------------------------------------------------------------ input
  holdRepeat(btn, fn, onStop) {
    let timer = null;
    let n = 0;
    const stop = () => {
      if (timer === null && !btn.classList.contains('held')) return;
      clearTimeout(timer);
      timer = null;
      btn.classList.remove('held');
      if (onStop) onStop();
    };
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      n = 0;
      btn.classList.add('held');
      fn(1);
      const loop = () => {
        n++;
        fn(n < 8 ? 1 : n < 20 ? 3 : 10);
        timer = setTimeout(loop, n < 8 ? 90 : 55);
      };
      timer = setTimeout(loop, 350);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  adjust(kind, d) {
    const g = this.game;
    if (!g || !g.canAct()) return;
    const p = g.current;
    if (kind === 'angle') p.angle = clamp(Math.round(p.angle) + d, 0, 180);
    else p.power = clamp(Math.round(p.power) + d, 0, p.maxPower);
  },

  bindControls() {
    $$('#angle-spin .btn').forEach((b) => this.holdRepeat(b, (k) => this.adjust('angle', Number(b.dataset.d) * k)));
    $$('#power-spin .btn').forEach((b) => this.holdRepeat(b, (k) => this.adjust('power', Number(b.dataset.d) * (k === 1 ? 1 : k === 3 ? 5 : 25))));
    $('#btn-fire').addEventListener('click', () => this.fire());
    $('#btn-weapon').addEventListener('click', () => this.openPicker());
    $('#btn-items').addEventListener('click', () => this.openItems());
    $('#btn-menu').addEventListener('click', () => this.openMenu());
    $$('#drivebar .drive').forEach((b) =>
      this.holdRepeat(
        b,
        () => {
          const g = this.game;
          if (g && g.canAct()) g.current.driveDir = Number(b.dataset.d);
        },
        () => {
          if (this.game && this.game.current) this.game.current.driveDir = 0;
        },
      ),
    );
    $('#drive-done').addEventListener('click', () => document.body.classList.remove('driving'));
  },

  fire() {
    const g = this.game;
    if (!g || !g.canAct() || this.paused) return;
    g.fire();
  },

  bindCanvas() {
    const cv = $('#cv');
    cv.addEventListener('pointerdown', (e) => {
      const g = this.game;
      if (!g || !g.canAct() || this.paused) return;
      e.preventDefault();
      this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w: this.toWorld(e), moved: false };
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.moved = true;
      this.dragging = true;
      this.aimAt(this.toWorld(e));
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      this.dragging = false;
      const g = this.game;
      if (!d.moved && g && g.canAct()) {
        const p = g.current;
        const hit = g.players.find((t) => t.alive && t !== p && dist(d.w.x, d.w.y, t.cx, t.cy) < 18);
        if (hit) {
          p.target = p.target === hit ? null : hit;
          Sound.click();
        }
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  },

  aimAt(w) {
    const g = this.game;
    if (!g || !g.canAct()) return;
    const p = g.current;
    const dx = w.x - p.x;
    const dy = p.y - 7 - w.y;
    let a = Math.atan2(dy, dx) / DEG;
    if (a < 0) a = dx >= 0 ? 0 : 180;
    p.angle = Math.round(clamp(a, 0, 180));
    // Power by on-screen drag length so it feels the same at any canvas scale.
    const cssW = $('#cv').getBoundingClientRect().width;
    const k = cssW / $('#cv').width;
    const full = Math.max(130, cssW * 0.22);
    p.power = Math.round(clamp((Math.hypot(dx, dy) * k * PHYS.maxPower) / full, 0, p.maxPower));
  },

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const g = this.game;
      if (e.key === 'Escape') {
        if (this.anyModal()) $$('.modal.show').forEach((m) => this.closeModal(m.id));
        else if (g && document.body.classList.contains('in-round')) this.openMenu();
        return;
      }
      if (!g || !g.canAct() || this.anyModal() || e.target.tagName === 'INPUT') return;
      const k = e.shiftKey ? 10 : 1;
      const p = g.current;
      switch (e.key) {
        case 'ArrowLeft':
          this.adjust('angle', k);
          break;
        case 'ArrowRight':
          this.adjust('angle', -k);
          break;
        case 'ArrowUp':
          this.adjust('power', k * 5);
          break;
        case 'ArrowDown':
          this.adjust('power', -k * 5);
          break;
        case ' ':
        case 'Enter':
          this.fire();
          break;
        case 'Tab': {
          const owned = p.ownedWeapons();
          const i = owned.findIndex((w) => w.id === p.weapon);
          p.weapon = owned[(i + (e.shiftKey ? owned.length - 1 : 1)) % owned.length].id;
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    });
  },

  openMenu() {
    if (!this.game) return;
    this.paused = true;
    this.refreshMenu();
    this.openModal('menu');
  },

  refreshMenu() {
    $('#menu-sound').textContent = 'Sound: ' + (Sound.enabled ? 'On' : 'Off');
    $('#menu-speed').textContent = 'Speed: ' + (this.game && this.game.settings.speed > 1 ? 'Fast' : 'Normal');
  },

  bindMenus() {
    $('#btn-play').addEventListener('click', () => this.openSetup());
    $('#btn-quick').addEventListener('click', () => this.quickBattle());
    $('#btn-howto').addEventListener('click', () => this.openModal('help'));
    $('#btn-arena').addEventListener('click', () => Watch.openArena());
    $('#arena-back').addEventListener('click', () => this.show('title'));
    $('#add-player').addEventListener('click', () => this.addPlayer());
    $('#setup-back').addEventListener('click', () => this.show('title'));
    $('#setup-start').addEventListener('click', () => this.startFromSetup());
    $$('#shop .tab').forEach((t) =>
      t.addEventListener('click', () => {
        this.shopTab = t.dataset.tab;
        this.renderShop();
      }),
    );
    $('#shop-done').addEventListener('click', () => {
      const done = this.shopDone;
      this.shopDone = null;
      if (done) done();
    });
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeModal(b.closest('.modal').id)));
    $$('.modal').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target === m && m.id !== 'summary') this.closeModal(m.id);
      }),
    );
    $('#menu-sound').addEventListener('click', () => {
      Sound.setEnabled(!Sound.enabled);
      this.refreshMenu();
    });
    $('#menu-speed').addEventListener('click', () => {
      const g = this.game;
      g.settings.speed = g.settings.speed > 1 ? 1 : 2;
      this.settings.speed = g.settings.speed;
      store.set('settings', this.settings);
      this.refreshMenu();
    });
    $('#menu-fullscreen').addEventListener('click', () => {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (req) {
        Promise.resolve(req.call(el))
          .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
          .catch(() => {});
      }
      this.closeModal('menu');
    });
    $('#menu-help').addEventListener('click', () => this.openModal('help'));
    $('#menu-skip').addEventListener('click', () => {
      this.closeModal('menu');
      const g = this.game;
      if (g && g.phase !== 'over') g.forceEndRound();
    });
    $('#menu-quit').addEventListener('click', () => this.quit());
    $('#rotate-hint button').addEventListener('click', () => {
      this.rotateDismissed = true;
      this.fit();
    });
  },
};
