// The game's sounds, made by the phone while it plays (WebAudio): the hum of the motors, the wind, the rain,
// and short signals for what happens. Nothing is downloaded. A phone only lets a page make sound after a tap,
// so unlock() is called from the first one.
import { store } from './store.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = store.get('sound') !== false;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.9 : 0; this.master.connect(ctx.destination);
    this.fx = ctx.createGain(); this.fx.gain.value = 0.8; this.fx.connect(this.master);
    // two seconds of noise, for the wind, the rain, the camera's shutter and the crashes
    const buf = this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // the motors: two saws a little apart, through a low-pass filter
    const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 900; mf.Q.value = 2;
    const mg = this.motorGain = ctx.createGain(); mg.gain.value = 0;
    this.motorOsc = [0, 7].map((detune) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 150; o.detune.value = detune * 10; o.connect(mf); o.start(); return o; });
    mf.connect(mg); mg.connect(this.master); this.motorFilter = mf;
    // the wind and the rain: noise through filters
    this.windGain = this.loopNoise('bandpass', 420, 0.7);
    this.rainGain = this.loopNoise('highpass', 2500, 0.4);
  }

  loopNoise(type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return g;
  }

  setOn(on) {
    this.on = on; store.set('sound', on);
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  /** The sounds that go on: motor 0..1 (how hard the motors work, 0 when they stop), near 0..1, wind m/s, rain. */
  loop({ motor = 0, near = 1, wind = 0, rain = false }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.motorGain.gain.setTargetAtTime(motor > 0 ? (0.05 + 0.07 * motor) * near : 0, now, 0.12);
    for (const o of this.motorOsc) o.frequency.setTargetAtTime(120 + 110 * motor, now, 0.15);
    this.motorFilter.frequency.setTargetAtTime(500 + 900 * motor, now, 0.2);
    this.windGain.gain.setTargetAtTime(Math.min(0.22, wind * 0.018), now, 0.4);
    this.rainGain.gain.setTargetAtTime(rain ? 0.07 : 0, now, 0.4);
  }

  /** Stops what goes on (the menus). */
  quiet() { this.loop({}); }

  tone(freq, at, dur, { type = 'sine', vol = 0.18, to = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(this.fx); o.start(at); o.stop(at + dur + 0.05);
  }

  hiss(at, dur, { vol = 0.2, type = 'highpass', freq = 3000 } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f); f.connect(g); g.connect(this.fx); src.start(at, Math.random()); src.stop(at + dur + 0.05);
  }

  /** A short signal. */
  play(name) {
    if (!this.ctx || !this.on) return;
    const n = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'tap': this.tone(700, n, 0.06, { vol: 0.08 }); break;
      case 'add': this.tone(820, n, 0.07, { vol: 0.12, to: 1150 }); break;
      case 'undo': this.tone(700, n, 0.08, { vol: 0.1, to: 480 }); break;
      case 'launch': this.tone(220, n, 0.5, { type: 'sawtooth', vol: 0.06, to: 660 }); this.tone(440, n + 0.1, 0.4, { vol: 0.08, to: 880 }); break;
      case 'photo': this.hiss(n, 0.05, { vol: 0.35 }); this.hiss(n + 0.09, 0.07, { vol: 0.25, freq: 1800 }); break;
      case 'mark': this.tone(880, n, 0.09, { vol: 0.14 }); this.tone(1320, n + 0.1, 0.12, { vol: 0.14 }); break;
      case 'drop': this.tone(620, n, 0.22, { type: 'triangle', vol: 0.16, to: 260 }); break;
      case 'gate': this.tone(660, n, 0.1, { vol: 0.14 }); this.tone(990, n + 0.08, 0.16, { vol: 0.14 }); break;
      case 'good': [523, 659, 784].forEach((f, i) => this.tone(f, n + i * 0.08, 0.14, { vol: 0.13 })); break;
      case 'complete': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, n + i * 0.12, i === 3 ? 0.6 : 0.16, { type: 'triangle', vol: 0.18 })); break;
      case 'warn': this.tone(990, n, 0.08, { type: 'square', vol: 0.05 }); this.tone(990, n + 0.14, 0.08, { type: 'square', vol: 0.05 }); break;
      case 'bad': this.tone(196, n, 0.18, { type: 'square', vol: 0.06 }); this.tone(147, n + 0.2, 0.3, { type: 'square', vol: 0.06 }); break;
      case 'crash': this.hiss(n, 0.7, { vol: 0.5, type: 'lowpass', freq: 900 }); this.tone(90, n, 0.5, { vol: 0.3, to: 40 }); break;
      case 'radio': this.hiss(n, 0.09, { vol: 0.06, type: 'bandpass', freq: 2200 }); break;
      case 'on': this.tone(500, n, 0.06, { vol: 0.1 }); this.tone(750, n + 0.06, 0.08, { vol: 0.1 }); break;
      case 'off': this.tone(750, n, 0.06, { vol: 0.1 }); this.tone(500, n + 0.06, 0.08, { vol: 0.1 }); break;
    }
  }
}

/** A short shake of the phone, where phones can (not on iPhones). */
export function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* no vibration */ }
}
