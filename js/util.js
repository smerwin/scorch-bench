'use strict';

// Shared helpers. Every file is a classic script, so top-level declarations are
// visible to the scripts loaded after this one.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Game logic draws from this seeded generator (sfc32) so a match is fully
// reproducible from its seed + the actions taken. Purely cosmetic code
// (sky, screen shake) uses `vrand` instead so it never disturbs the stream.
const RNG = {
  s: [0x9e3779b9, 0x243f6a88, 0xb7e15162, 1],
  seed(n) {
    n = (n >>> 0) || 1;
    this.s = [0x9e3779b9 ^ n, 0x243f6a88, 0xb7e15162 ^ Math.imul(n, 0x85ebca6b), n];
    for (let i = 0; i < 15; i++) this.next();
  },
  next() {
    let [a, b, c, d] = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a, b, c, d];
    return (t >>> 0) / 4294967296;
  },
  get state() {
    return this.s.slice();
  },
  set state(s) {
    this.s = s.slice();
  },
};
RNG.seed((Math.random() * 4294967296) >>> 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => (b === undefined ? RNG.next() * a : a + RNG.next() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(RNG.next() * arr.length)];
const chance = (p) => RNG.next() < p;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const vrand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));

function gauss() {
  let u = 0;
  let v = 0;
  while (!u) u = RNG.next();
  while (!v) v = RNG.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(RNG.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ImageData is RGBA bytes; viewed as Uint32 on little-endian hardware that's ABGR.
function packRGB(r, g, b) {
  return ((255 << 24) | (clamp(b | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(r | 0, 0, 255)) >>> 0;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbStr(c, a = 1) {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Sample a multi-stop gradient (array of [r,g,b]) at t in [0,1].
function gradientAt(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mixRgb(stops[i], stops[i + 1], t - i);
}

// Cheap deterministic per-pixel noise in [-1,1] for dirt texture.
function hashNoise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) & 1023) / 511.5) - 1;
}

function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('scorch.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('scorch.' + key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};
