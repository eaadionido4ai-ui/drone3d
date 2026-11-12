// The pilot's two sticks, under the thumbs (mode 2, as on most drone controllers):
//   left stick   up and down: climb and descend; left and right: turn
//   right stick  up and down: forward and back; left and right: sideways
// A stick appears where the thumb touches the lower part of its half of the screen, and springs back to the
// middle when the thumb lets go: the drone then hovers. A drag anywhere else tilts the camera. On a computer the
// keys do the same: W S forward and back, A D sideways, Q E turn, R F up and down, Shift for small moves.
import { input } from '../core/rules.js';

const RADIUS = 56;
const KEYS = { KeyW: ['f', 1], KeyS: ['f', -1], ArrowUp: ['f', 1], ArrowDown: ['f', -1], KeyD: ['r', 1], KeyA: ['r', -1], KeyE: ['y', 1], KeyQ: ['y', -1], ArrowRight: ['y', 1], ArrowLeft: ['y', -1], KeyR: ['u', 1], KeyF: ['u', -1] };

/** A gentler response near the middle, for small corrections. */
const curve = (v) => v * (0.35 + 0.65 * v * v);

export class Sticks {
  /**
   * pad: the element under the instruments that takes the touches; left, right: the two stick elements;
   * onTilt(degrees): a drag outside the sticks.
   */
  constructor(pad, left, right, onTilt, onBlocked) {
    this.pad = pad; this.onTilt = onTilt; this.onBlocked = onBlocked;
    this.sticks = { left: { el: left, knob: left.querySelector('.knob'), id: null, x: 0, y: 0, cx: 0, cy: 0 }, right: { el: right, knob: right.querySelector('.knob'), id: null, x: 0, y: 0, cx: 0, cy: 0 } };
    this.tilts = new Map();
    this.keys = new Set();
    this.enabled = true;
    pad.addEventListener('pointerdown', (e) => this.down(e));
    pad.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, (e) => this.up(e));
    window.addEventListener('keydown', (e) => { if (KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.release(); });
    this.place();
  }

  /** Puts the sticks back where they wait for the thumbs. */
  place() {
    const w = window.innerWidth, h = window.innerHeight;
    const s = this.sticks;
    s.left.cx = Math.max(100, w * 0.13); s.left.cy = h - Math.max(95, h * 0.27);
    s.right.cx = w - Math.max(100, w * 0.13) - 70; s.right.cy = s.left.cy;
    for (const k of ['left', 'right']) if (s[k].id == null) this.draw(s[k], s[k].cx, s[k].cy, 0, 0);
  }

  draw(s, cx, cy, x, y) {
    s.el.style.left = cx + 'px'; s.el.style.top = cy + 'px';
    s.knob.style.transform = `translate(${x * RADIUS}px, ${y * RADIUS}px)`;
    s.el.classList.toggle('on', s.id != null);
  }

  /** The sticks are shown and work only while the player has the drone; a drag still tilts the camera. */
  enable(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.release();
    for (const s of Object.values(this.sticks)) s.el.hidden = !on;
  }

  down(e) {
    const w = window.innerWidth, h = window.innerHeight, low = e.clientY > h * 0.36;
    const side = e.clientX < w / 2 ? 'left' : 'right', s = this.sticks[side];
    if (!this.enabled && low && this.onBlocked) this.onBlocked();
    if (this.enabled && low && s.id == null) {
      s.id = e.pointerId; s.ox = e.clientX; s.oy = e.clientY; s.x = 0; s.y = 0;
      this.draw(s, s.ox, s.oy, 0, 0);
    } else this.tilts.set(e.pointerId, e.clientY);
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* capture is not essential */ }
    e.preventDefault();
  }

  move(e) {
    for (const s of Object.values(this.sticks)) {
      if (s.id !== e.pointerId) continue;
      let x = (e.clientX - s.ox) / RADIUS, y = (e.clientY - s.oy) / RADIUS;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      s.x = x; s.y = y;
      this.draw(s, s.ox, s.oy, x, y);
      return;
    }
    if (this.tilts.has(e.pointerId)) {
      const last = this.tilts.get(e.pointerId);
      this.onTilt((last - e.clientY) * 0.3);
      this.tilts.set(e.pointerId, e.clientY);
    }
  }

  up(e) {
    for (const s of Object.values(this.sticks)) {
      if (s.id !== e.pointerId) continue;
      s.id = null; s.x = s.y = 0;
      this.draw(s, s.cx, s.cy, 0, 0);
    }
    this.tilts.delete(e.pointerId);
  }

  release() {
    for (const s of Object.values(this.sticks)) { s.id = null; s.x = s.y = 0; this.draw(s, s.cx, s.cy, 0, 0); }
    this.tilts.clear();
  }

  /** What the pilot holds now: the sticks on the screen and the keys, together. */
  value() {
    const L = this.sticks.left, R = this.sticks.right;
    let f = -curve(R.y), r = curve(R.x), u = -curve(L.y), y = curve(L.x);
    if (this.keys.size) {
      const k = { f: 0, r: 0, u: 0, y: 0 };
      for (const code of this.keys) { const m = KEYS[code]; if (m) k[m[0]] += m[1]; }
      const gentle = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.35 : 1;
      f += k.f * gentle; r += k.r * gentle; u += k.u * gentle; y += k.y * gentle;
    }
    const c = (v) => Math.max(-1, Math.min(1, v));
    return input(c(f), c(r), c(u), c(y));
  }

  /** True while a thumb is on a stick or a key is held. */
  get busy() { return this.sticks.left.id != null || this.sticks.right.id != null || this.keys.size > 0; }
}
