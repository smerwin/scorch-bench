'use strict';

// The battlefield is a bitmap: every non-zero pixel in `buf` is dirt, and its
// value is that pixel's colour. Craters, falling dirt and burial all happen by
// editing this one buffer, which is also what gets drawn.
class Terrain {
  constructor(W, H, theme) {
    this.W = W;
    this.H = H;
    this.theme = theme;
    // RGBA bytes viewed as one uint32 per pixel; the renderer wraps the same
    // memory in an ImageData, so there's no canvas dependency here.
    this.buf = new Uint32Array(W * H);
    this.unsettled = new Uint8Array(W);
    this.unsettledCount = 0;
    this.dirty = null;
    this.charcoal = packRGB(34, 26, 22);
    this.palette = [];
    for (let y = 0; y < H; y++) this.palette.push(gradientAt(theme.ground, Math.pow(y / H, 0.9)));
  }

  dirtColor(x, y, top = 1e9) {
    const c = this.palette[clamp(y | 0, 0, this.H - 1)];
    const n = hashNoise(x, y) * 10;
    if (this.theme.grass && y - top < 3) {
      const g = this.theme.grass;
      return packRGB(g[0] + n, g[1] + n, g[2] + n);
    }
    return packRGB(c[0] + n, c[1] + n, c[2] + n);
  }

  generate(type) {
    const { W, H } = this;
    const h = new Float32Array(W);
    const lo = H * 0.28;
    const hi = H * 0.9;
    if (type === 'mountains' || type === 'rugged') {
      // Midpoint displacement over a power-of-two span, then resampled to W.
      const n = 1024;
      const pts = new Float32Array(n + 1);
      pts[0] = rand(0.3, 0.8);
      pts[n] = rand(0.3, 0.8);
      let step = n;
      let amp = type === 'rugged' ? 0.55 : 0.45;
      const rough = type === 'rugged' ? 0.62 : 0.52;
      while (step > 1) {
        const half = step >> 1;
        for (let i = half; i < n; i += step) pts[i] = (pts[i - half] + pts[i + half]) / 2 + rand(-amp, amp);
        amp *= rough;
        step = half;
      }
      let mn = Infinity;
      let mx = -Infinity;
      for (const v of pts) {
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }
      for (let x = 0; x < W; x++) {
        const v = pts[Math.floor((x / W) * n)];
        h[x] = lerp(lo, hi, (v - mn) / (mx - mn || 1));
      }
    } else if (type === 'canyons') {
      const base = H * rand(0.4, 0.5);
      const cuts = randInt(2, 4);
      const centers = [];
      for (let i = 0; i < cuts; i++) centers.push({ x: rand(0.1, 0.9) * W, w: rand(25, 70), d: rand(0.25, 0.4) * H });
      for (let x = 0; x < W; x++) {
        let y = base + Math.sin(x * 0.01 + 1) * 12 + Math.sin(x * 0.043) * 4;
        for (const c of centers) {
          const t = Math.abs(x - c.x) / c.w;
          if (t < 1) y += c.d * (1 - t * t * t * t);
        }
        h[x] = y;
      }
    } else {
      const flat = type === 'plains';
      const base = H * (flat ? rand(0.6, 0.72) : rand(0.5, 0.62));
      const waves = [];
      const count = flat ? 3 : 5;
      for (let i = 0; i < count; i++) {
        waves.push({ f: rand(0.4, 1.4) * (i + 1) * 0.004, a: (flat ? 0.05 : 0.17) * H / (i * 0.9 + 1), p: rand(TAU) });
      }
      for (let x = 0; x < W; x++) {
        let y = base;
        for (const w of waves) y += Math.sin(x * w.f + w.p) * w.a;
        h[x] = y;
      }
    }
    for (let x = 0; x < W; x++) h[x] = clamp(h[x], H * 0.18, H - 12);

    this.buf.fill(0);
    for (let x = 0; x < W; x++) {
      const top = h[x] | 0;
      for (let y = top; y < H; y++) this.buf[y * W + x] = this.dirtColor(x, y, top);
    }
    this.markDirty(0, 0, W, H);
  }

  solid(x, y) {
    x |= 0;
    y |= 0;
    if (y >= this.H) return true;
    if (y < 0 || x < 0 || x >= this.W) return false;
    return this.buf[y * this.W + x] !== 0;
  }

  // First solid row in column x (H if the column is empty).
  surface(x, from = 0) {
    x = clamp(x | 0, 0, this.W - 1);
    const { W, H, buf } = this;
    for (let y = Math.max(0, from | 0); y < H; y++) if (buf[y * W + x]) return y;
    return H;
  }

  markDirty(x0, y0, x1, y1) {
    x0 = clamp(Math.floor(x0), 0, this.W);
    y0 = clamp(Math.floor(y0), 0, this.H);
    x1 = clamp(Math.ceil(x1), 0, this.W);
    y1 = clamp(Math.ceil(y1), 0, this.H);
    if (x1 <= x0 || y1 <= y0) return;
    const d = this.dirty;
    if (!d) this.dirty = { x0, y0, x1, y1 };
    else {
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }

  markUnsettled(x0, x1) {
    x0 = clamp(Math.floor(x0), 0, this.W - 1);
    x1 = clamp(Math.ceil(x1), 0, this.W - 1);
    for (let x = x0; x <= x1; x++) {
      if (!this.unsettled[x]) {
        this.unsettled[x] = 1;
        this.unsettledCount++;
      }
    }
  }

  // Run fn(x,y) for every pixel in a circle.
  eachInCircle(cx, cy, r, fn) {
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const span = Math.sqrt(Math.max(0, r * r - dy * dy));
      const x0 = Math.max(0, Math.ceil(cx - span));
      const x1 = Math.min(this.W - 1, Math.floor(cx + span));
      for (let x = x0; x <= x1; x++) fn(x, y);
    }
  }

  // settle=false leaves the dirt above hanging (digger tunnels).
  carveCircle(cx, cy, r, settle = true) {
    const { buf, W } = this;
    this.eachInCircle(cx, cy, r, (x, y) => {
      buf[y * W + x] = 0;
    });
    this.markDirty(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2);
    if (settle) this.markUnsettled(cx - r - 1, cx + r + 1);
  }

  fillCircle(cx, cy, r) {
    const { buf, W } = this;
    this.eachInCircle(cx, cy, r, (x, y) => {
      if (!buf[y * W + x]) buf[y * W + x] = this.dirtColor(x, y);
    });
    this.markDirty(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2);
  }

  // Wedge from (cx,cy) pointing along `angle` (radians, 0 = right, CCW up).
  eachInSector(cx, cy, angle, spread, range, fn) {
    this.eachInCircle(cx, cy, range, (x, y) => {
      const a = Math.atan2(cy - y, x - cx);
      let d = Math.abs(a - angle) % TAU;
      if (d > Math.PI) d = TAU - d;
      if (d <= spread) fn(x, y);
    });
  }

  carveSector(cx, cy, angle, spread, range) {
    const { buf, W } = this;
    this.eachInSector(cx, cy, angle, spread, range, (x, y) => {
      buf[y * W + x] = 0;
    });
    this.markDirty(cx - range - 1, 0, cx + range + 2, cy + range + 2);
    this.markUnsettled(cx - range - 1, cx + range + 1);
  }

  fillSector(cx, cy, angle, spread, range, minR, skip) {
    const { buf, W } = this;
    this.eachInSector(cx, cy, angle, spread, range, (x, y) => {
      if (Math.hypot(x - cx, y - cy) < minR || (skip && skip(x, y))) return;
      if (!buf[y * W + x]) buf[y * W + x] = this.dirtColor(x, y);
    });
    this.markDirty(cx - range - 1, cy - range - 1, cx + range + 2, cy + range + 2);
  }

  setPixel(x, y, color) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.buf[y * this.W + x] = color === undefined ? this.dirtColor(x, y) : color;
    this.markDirty(x, y, x + 1, y + 1);
  }

  scorch(x, y) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    if (this.buf[y * this.W + x]) {
      this.buf[y * this.W + x] = this.charcoal;
      this.markDirty(x, y, x + 1, y + 1);
    }
  }

  settleEverything() {
    this.markUnsettled(0, this.W - 1);
  }

  // Drop floating dirt by `passes` pixels in each unsettled column. Returns
  // true while anything is still moving.
  settleStep(passes) {
    if (!this.unsettledCount) return false;
    const { buf, W, H } = this;
    let minY = H;
    for (let x = 0; x < W; x++) {
      if (!this.unsettled[x]) continue;
      let moved = false;
      for (let p = 0; p < passes; p++) {
        let movedThisPass = false;
        for (let y = H - 2; y >= 0; y--) {
          const i = y * W + x;
          if (buf[i] && !buf[i + W]) {
            buf[i + W] = buf[i];
            buf[i] = 0;
            movedThisPass = true;
            if (y < minY) minY = y;
          }
        }
        if (!movedThisPass) break;
        moved = true;
      }
      if (moved) {
        this.markDirty(x, minY, x + 1, H);
      } else {
        this.unsettled[x] = 0;
        this.unsettledCount--;
      }
    }
    return this.unsettledCount > 0;
  }

  settleInstant() {
    const { buf, W, H } = this;
    for (let x = 0; x < W; x++) {
      if (!this.unsettled[x]) continue;
      let write = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * W + x;
        if (buf[i]) {
          const c = buf[i];
          buf[i] = 0;
          buf[write * W + x] = c;
          write--;
        }
      }
      this.unsettled[x] = 0;
      this.markDirty(x, 0, x + 1, H);
    }
    this.unsettledCount = 0;
  }

  // Compact serialisation: for each column, [start, end) pairs of solid rows.
  toRuns() {
    const { W, H, buf } = this;
    const cols = new Array(W);
    for (let x = 0; x < W; x++) {
      const runs = [];
      let inRun = false;
      for (let y = 0; y < H; y++) {
        const solid = buf[y * W + x] !== 0;
        if (solid !== inRun) {
          runs.push(y);
          inRun = solid;
        }
      }
      if (inRun) runs.push(H);
      cols[x] = runs;
    }
    return cols;
  }

  fromRuns(cols) {
    const { W, H, buf } = this;
    buf.fill(0);
    for (let x = 0; x < W && x < cols.length; x++) {
      const runs = cols[x];
      for (let i = 0; i + 1 < runs.length; i += 2) {
        const top = runs[i];
        for (let y = Math.max(0, top); y < Math.min(H, runs[i + 1]); y++) buf[y * W + x] = this.dirtColor(x, y, top);
      }
    }
    this.unsettled.fill(0);
    this.unsettledCount = 0;
    this.markDirty(0, 0, W, H);
  }

  // Topmost solid row per column.
  heights() {
    const out = new Array(this.W);
    for (let x = 0; x < this.W; x++) out[x] = this.surface(x);
    return out;
  }
}
