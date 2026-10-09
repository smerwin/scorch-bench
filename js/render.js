'use strict';

// Draws a Game onto a canvas whose backing store is exactly world-sized; CSS
// scales it up with pixelated sampling for the chunky DOS look.
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.skyFor = null;
    this.sky = null;
    this.aim = null; // drag-aim preview from the UI
  }

  resize(W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  buildSky(game) {
    const { W, H, theme } = game;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const bands = 28;
    for (let i = 0; i < bands; i++) {
      x.fillStyle = rgbStr(gradientAt(theme.sky, i / (bands - 1)));
      x.fillRect(0, Math.floor((i * H) / bands), W, Math.ceil(H / bands) + 1);
    }
    if (theme.stars) {
      for (let i = 0; i < 140; i++) {
        const b = vrand(120, 255);
        x.fillStyle = rgbStr([b, b, b + vrand(-20, 0)]);
        x.fillRect(Math.floor(vrand(W)), Math.floor(vrand(H * 0.7)), 1, 1);
      }
      x.fillStyle = 'rgba(255,255,230,0.9)';
      x.beginPath();
      x.arc(vrand(W * 0.1, W * 0.9), vrand(H * 0.08, H * 0.2), vrand(8, 14), 0, TAU);
      x.fill();
    }
    this.sky = c;
    this.skyFor = game.terrain;
  }

  // Blit the terrain buffer's dirty rectangle into an offscreen canvas.
  syncTerrain(t) {
    if (this.terrainFor !== t) {
      this.terrainFor = t;
      this.tcanvas = document.createElement('canvas');
      this.tcanvas.width = t.W;
      this.tcanvas.height = t.H;
      this.tctx = this.tcanvas.getContext('2d');
      this.timg = new ImageData(new Uint8ClampedArray(t.buf.buffer), t.W, t.H);
      t.markDirty(0, 0, t.W, t.H);
    }
    const d = t.dirty;
    if (!d) return;
    this.tctx.putImageData(this.timg, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    t.dirty = null;
  }

  draw(game, ui) {
    const ctx = this.ctx;
    const { W, H } = game;
    this.resize(W, H);
    if (this.skyFor !== game.terrain) this.buildSky(game);
    this.syncTerrain(game.terrain);

    ctx.save();
    if (game.shake > 0.3) ctx.translate(Math.round(vrand(-game.shake, game.shake) * 0.5), Math.round(vrand(-game.shake, game.shake) * 0.5));
    ctx.drawImage(this.sky, 0, 0);
    ctx.drawImage(this.tcanvas, 0, 0);

    this.drawTracers(game);
    this.drawFluids(game);
    for (const p of game.players) if (p.alive) this.drawTank(game, p);
    this.drawProjectiles(game);
    this.drawExplosions(game);
    this.drawEffects(game);
    this.drawParticles(game);
    this.drawTexts(game);
    this.drawOverlays(game, ui);
    ctx.restore();

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,240,${Math.min(1, game.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawTank(game, p) {
    const ctx = this.ctx;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const [r, g, b] = p.rgb;
    const dark = rgbStr([r * 0.45, g * 0.45, b * 0.45]);
    const mid = rgbStr([r * 0.75, g * 0.75, b * 0.75]);

    if (p.chute) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 7);
      ctx.lineTo(x - 11, y - 22);
      ctx.moveTo(x + 6, y - 7);
      ctx.lineTo(x + 11, y - 22);
      ctx.stroke();
      ctx.fillStyle = '#f4f4f4';
      ctx.beginPath();
      ctx.arc(x, y - 22, 12, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 2, y - 33, 4, 11);
    }

    // turret
    const a = p.angle * DEG;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + Math.cos(a) * PHYS.barrel, y - 7 - Math.sin(a) * PHYS.barrel);
    ctx.stroke();
    // treads
    ctx.fillStyle = dark;
    ctx.fillRect(x - 7, y - 3, 14, 3);
    ctx.fillStyle = '#222';
    for (let i = -6; i <= 5; i += 3) ctx.fillRect(x + i, y - 2, 1, 1);
    // hull + dome
    ctx.fillStyle = mid;
    ctx.fillRect(x - 6, y - 5, 12, 2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y - 5, 4.5, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x - 2, y - 9, 2, 1);

    if (p.shield) {
      const sc = hexToRgb(p.shield.color);
      const k = p.shield.hp / p.shield.max;
      ctx.strokeStyle = rgbStr(sc, 0.35 + 0.5 * k);
      ctx.fillStyle = rgbStr(sc, 0.08 + 0.08 * Math.sin(game.time * 5));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, PHYS.shieldR, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (p.shield.mag) {
        ctx.setLineDash([2, 3]);
        ctx.lineDashOffset = -game.time * 20;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, PHYS.shieldR + 4, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (game.settings.hpBars) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 8, y - 15 - (p.shield ? 6 : 0), 16, 3);
      ctx.fillStyle = p.health > 50 ? '#4f4' : p.health > 25 ? '#fd3' : '#f43';
      ctx.fillRect(x - 7, y - 14 - (p.shield ? 6 : 0), Math.max(1, Math.round((p.health / 100) * 14)), 1);
    }

    if (game.current === p && (game.phase === 'aim' || game.phase === 'start')) {
      const bob = Math.round(Math.sin(game.time * 6) * 2);
      const ty = y - 24 - (p.shield ? 8 : 0) + bob;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(x, ty + 5);
      ctx.lineTo(x - 4, ty);
      ctx.lineTo(x + 4, ty);
      ctx.fill();
    }
  }

  drawProjectiles(game) {
    const ctx = this.ctx;
    for (const p of game.projectiles) {
      if (p.mode === 'fly' && p.trail.length >= 4) {
        ctx.strokeStyle = p.kind === 'tracer' ? rgbStr(p.owner.rgb, 0.9) : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = p.kind === 'tracer' && p.w.smoke ? 2 : 1;
        ctx.beginPath();
        const start = p.kind === 'tracer' ? 0 : Math.max(0, p.trail.length - 30);
        let pen = false;
        for (let i = start; i < p.trail.length; i += 2) {
          const x = p.trail[i];
          if (Number.isNaN(x)) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(x, p.trail[i + 1]);
          else ctx.moveTo(x, p.trail[i + 1]);
          pen = true;
        }
        ctx.stroke();
      }
      if (p.mode === 'dig') {
        ctx.fillStyle = '#fc6';
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
        continue;
      }
      if (p.y < 0) {
        // Off the top of the screen: show where it is.
        ctx.fillStyle = p.color;
        const x = clamp(Math.round(p.x), 2, game.W - 3);
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x - 3, 6);
        ctx.lineTo(x + 3, 6);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = p.color;
      const s = p.mode === 'roll' ? 4 : p.r >= 35 || p.w.nuke ? 3 : 2;
      if (p.mode === 'roll') {
        ctx.beginPath();
        ctx.arc(p.x, p.y - 2, 2.5, 0, TAU);
        ctx.fill();
      } else ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
  }

  drawTracers(game) {
    const ctx = this.ctx;
    for (const t of game.tracers) {
      ctx.strokeStyle = rgbStr(t.color, t.smoke ? 0.8 : 0.6);
      ctx.lineWidth = t.smoke ? 2 : 1;
      if (!t.smoke) ctx.setLineDash([2, 3]);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < t.pts.length; i += 2) {
        const x = t.pts[i];
        if (Number.isNaN(x)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x, t.pts[i + 1]);
        else ctx.moveTo(x, t.pts[i + 1]);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawFluids(game) {
    if (!game.fluids.length) return;
    const ctx = this.ctx;
    const tick = Math.floor(game.time * 20);
    for (const f of game.fluids) {
      if (f.kind === 'dirt') {
        ctx.fillStyle = '#7a4a22';
        ctx.fillRect(f.x, f.y, 1, 1);
        continue;
      }
      const flick = (f.x * 7 + f.y * 13 + tick) % 4;
      ctx.fillStyle = flick === 0 ? '#ffee66' : flick === 1 ? (f.hot ? '#ffffff' : '#ff9922') : flick === 2 ? '#ff5511' : '#dd2200';
      ctx.fillRect(f.x, f.y - (flick === 0 ? 1 : 0), 1, flick === 0 ? 2 : 1);
    }
  }

  drawExplosions(game) {
    const ctx = this.ctx;
    for (const e of game.explosions) {
      const grow = Math.min(1, e.t / e.grow);
      const fade = e.t > e.grow ? 1 - (e.t - e.grow) / e.fade : 1;
      const r = e.r * (e.t > e.grow ? 1 : Math.sqrt(grow));
      if (r < 0.5) continue;
      let palette;
      if (e.kind === 'dirt') palette = [[120, 70, 30], [160, 100, 50], [100, 60, 25]];
      else if (e.kind === 'riot') palette = [[120, 180, 255], [200, 230, 255], [80, 120, 255]];
      else if (e.kind === 'plasma') palette = [[255, 80, 255], [255, 200, 255], [140, 60, 255]];
      else palette = [[255, 255, 200], [255, 220, 60], [255, 140, 20], [220, 40, 10]];
      // Classic concentric rings that cycle colour as they expand.
      const rings = Math.max(2, Math.min(7, Math.round(r / 5)));
      const shift = Math.floor(e.t * 18 + e.seed);
      for (let i = rings; i >= 1; i--) {
        ctx.fillStyle = rgbStr(palette[(i + shift) % palette.length], fade);
        ctx.beginPath();
        ctx.arc(e.x, e.y, (r * i) / rings, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawEffects(game) {
    const ctx = this.ctx;
    for (const e of game.effects) {
      const k = 1 - e.t / e.life;
      if (e.type === 'beam') {
        ctx.strokeStyle = `rgba(255,60,60,${k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(e.x0, e.y0);
        ctx.lineTo(e.x1, e.y1);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${k})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (e.type === 'ring') {
        ctx.strokeStyle = rgbStr(e.color, k);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (1 + (1 - k) * 0.6), 0, TAU);
        ctx.stroke();
      } else if (e.type === 'sector') {
        ctx.fillStyle = rgbStr(e.color, 0.6 * k);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.range * (0.4 + 0.6 * (1 - k)), -e.a - e.spread, -e.a + e.spread);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawParticles(game) {
    const ctx = this.ctx;
    for (const p of game.particles) {
      ctx.fillStyle = rgbStr(p.color, Math.min(1, p.life * 2));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }

  drawTexts(game) {
    if (!game.texts.length) return;
    const ctx = this.ctx;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (const t of game.texts) {
      const a = Math.min(1, (t.life - t.t) * 2);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    }
  }

  drawOverlays(game, ui) {
    const ctx = this.ctx;
    const p = game.current;
    if (!p || game.phase !== 'aim' || !p.isHuman) return;
    // Guidance target reticle.
    const t = p.target && p.target.alive ? p.target : null;
    if (t) {
      ctx.strokeStyle = 'rgba(255,60,60,0.9)';
      ctx.lineWidth = 1;
      const r = 13 + Math.sin(game.time * 6);
      ctx.beginPath();
      ctx.arc(t.cx, t.cy, r, 0, TAU);
      ctx.moveTo(t.cx - r - 4, t.cy);
      ctx.lineTo(t.cx - r + 4, t.cy);
      ctx.moveTo(t.cx + r - 4, t.cy);
      ctx.lineTo(t.cx + r + 4, t.cy);
      ctx.moveTo(t.cx, t.cy - r - 4);
      ctx.lineTo(t.cx, t.cy - r + 4);
      ctx.stroke();
    }
    if (ui && ui.dragging) {
      // Aim line: direction = angle, length = power.
      const a = p.angle * DEG;
      const len = 20 + (p.power / PHYS.maxPower) * 90;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x + Math.cos(a) * len, p.y - 7 - Math.sin(a) * len);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
