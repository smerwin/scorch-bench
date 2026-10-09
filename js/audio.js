'use strict';

// All sound is synthesized with WebAudio — no asset files.
const Sound = {
  ctx: null,
  master: null,
  noiseBuf: null,
  enabled: store.get('sound', true),

  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setEnabled(on) {
    this.enabled = on;
    store.set('sound', on);
  },

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  },

  tone(freq, dur, { type = 'square', vol = 0.15, slide = null, delay = 0, attack = 0.005 } = {}) {
    if (!this.ready()) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur, { vol = 0.3, freq = 1000, freqEnd = null, type = 'lowpass', delay = 0, q = 0.7 } = {}) {
    if (!this.ready()) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  },

  fire(heavy) {
    this.noise(0.25, { vol: heavy ? 0.6 : 0.4, freq: 1800, freqEnd: 150 });
    this.tone(heavy ? 90 : 150, 0.18, { type: 'sawtooth', vol: 0.18, slide: 40 });
  },
  explode(r) {
    const s = clamp(r / 40, 0.25, 2.2);
    this.noise(0.35 + s * 0.6, { vol: 0.35 + s * 0.25, freq: 2500, freqEnd: 60 });
    this.tone(70, 0.25 + s * 0.4, { type: 'sine', vol: 0.3, slide: 25 });
  },
  nuke() {
    this.noise(2.2, { vol: 0.8, freq: 3000, freqEnd: 40 });
    this.tone(55, 1.8, { type: 'sine', vol: 0.5, slide: 18 });
  },
  dirt() {
    this.noise(0.4, { vol: 0.3, freq: 500, freqEnd: 120 });
  },
  laser() {
    this.tone(1800, 0.5, { type: 'sawtooth', vol: 0.12, slide: 200 });
    this.tone(2400, 0.5, { type: 'square', vol: 0.06, slide: 300 });
  },
  plasma() {
    this.tone(200, 0.6, { type: 'sawtooth', vol: 0.2, slide: 1600 });
    this.noise(0.6, { vol: 0.2, freq: 4000, freqEnd: 800, type: 'bandpass' });
  },
  sizzle() {
    this.noise(0.5, { vol: 0.12, freq: 5000, type: 'highpass' });
  },
  bounce() {
    this.tone(400, 0.12, { type: 'triangle', vol: 0.2, slide: 900 });
  },
  shieldHit() {
    this.tone(900, 0.2, { type: 'sine', vol: 0.18, slide: 300 });
  },
  dig() {
    this.noise(0.15, { vol: 0.12, freq: 300 });
  },
  click() {
    this.tone(880, 0.04, { type: 'square', vol: 0.05 });
  },
  buy() {
    this.tone(660, 0.07, { type: 'square', vol: 0.08 });
    this.tone(990, 0.09, { type: 'square', vol: 0.08, delay: 0.06 });
  },
  denied() {
    this.tone(160, 0.15, { type: 'square', vol: 0.08 });
  },
  turn() {
    this.tone(520, 0.06, { type: 'triangle', vol: 0.1 });
    this.tone(780, 0.08, { type: 'triangle', vol: 0.1, delay: 0.07 });
  },
  thud() {
    this.tone(90, 0.15, { type: 'sine', vol: 0.25, slide: 40 });
  },
  chute() {
    this.noise(0.3, { vol: 0.1, freq: 900, type: 'bandpass' });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'square', vol: 0.08, delay: i * 0.12 }));
  },
};
