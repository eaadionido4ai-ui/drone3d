// The rules of DRONE 3D: what a drone hits and lands on, the weather, how the drone flies, and how a package
// falls. A line-for-line port of DRONE VR's DroneVR.Core (Town.cs, Weather.cs, Drone.cs, Cargo.cs), checked
// against the same recorded flights of the Python reference (test/data/flight_golden.json).
import { ground, X0, X1, Z0, Z1, Compass, BUILDINGS, SLABS, TOWERS, TREES, POLES, PAD_X, PAD_Y, PAD_Z, onPad, supply } from './world.js';

// ---------- the town, as one mission shows it ----------

export class Town {
  constructor(sets) {
    const on = new Set(sets || []);
    this.buildings = BUILDINGS.filter((b) => b.set == null || on.has(b.set));
    this.slabs = SLABS.filter((s) => s.set == null || on.has(s.set));
    this.bare = false;
  }

  static forPlan(plan) { return new Town(plan.sets); }

  /** Nothing but the ground and the pad: the open country the reference model flies over. */
  static bare() { const t = new Town([]); t.buildings = []; t.slabs = []; t.bare = true; return t; }

  /**
   * The highest thing to stand on at (x, z) that is not above y: the ground, the pad, a roof, the bridge.
   * A little above y still counts (half a metre), so that a drone skimming a roof finds it.
   */
  surfaceBelow(x, y, z) {
    let s = ground(x, z);
    if (onPad(x, z)) s = Math.max(s, PAD_Y);
    for (const b of this.buildings) {
      if (!b.covers(x, z, 0)) continue;
      const top = b.top;
      if (top <= y + 0.5 && top > s) s = top;
    }
    for (const d of this.slabs) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      if (d.y1 <= y + 0.5 && d.y1 > s) s = d.y1;
    }
    return s;
  }

  /** The highest surface at (x, z), seen from the sky. */
  surfaceFromAbove(x, z) { return this.surfaceBelow(x, 1e9, z); }

  /** What a ball of this radius at this point is touching: 'building', 'roof', 'bridge', 'tower', 'tree', 'pole' or null. */
  hit(x, y, z, radius) {
    if (this.bare) return null;
    for (const b of this.buildings) {
      if (!b.covers(x, z, radius)) continue;
      const low = b.roof === 'open' ? b.base + b.h : b.base - 3;
      if (y > low - radius && y < b.top - 0.3) return b.roof === 'open' ? 'roof' : 'building';
    }
    for (const d of this.slabs) {
      if (x < d.x0 - radius || x > d.x1 + radius || z < d.z0 - radius || z > d.z1 + radius) continue;
      if (y > d.y0 - radius && y < d.y1 - 0.3) return 'bridge';
    }
    for (const t of TOWERS) {
      const dx = x - t.x, dz = z - t.z, r = t.r + radius;
      if (dx * dx + dz * dz < r * r && y < ground(t.x, t.z) + t.h + radius) return 'tower';
    }
    for (const t of TREES) {
      const dx = x - t.x, dz = z - t.z, r = t.r * 0.8 + radius;
      if (dx * dx + dz * dz >= r * r) continue;
      const g = ground(t.x, t.z);
      if (y > g + t.h - t.r - 0.5 && y < g + t.h + 1) return 'tree';
    }
    for (const p of POLES) {
      const dx = x - p.x, dz = z - p.z, r = 0.4 + radius;
      if (dx * dx + dz * dz < r * r && y < ground(p.x, p.z) + p.h + radius) return 'pole';
    }
    return null;
  }
}

// ---------- the weather ----------

export const WIND = {
  gustPeriodA: 11, gustPeriodB: 4.3, gustShareA: 0.6, gustShareB: 0.4, gustPhaseB: 1.3,
  swingPeriod: 23, swingDegrees: 15, lowShare: 0.6, fullHeight: 60,
};

/** The wind's speed at fullHeight, t seconds into the mission, for this mean speed and gustiness. */
export function windSpeed(mean, gust, t) {
  const W = WIND;
  const wave = W.gustShareA * Math.sin(2 * Math.PI * t / W.gustPeriodA) + W.gustShareB * Math.sin(2 * Math.PI * t / W.gustPeriodB + W.gustPhaseB);
  return Math.max(0, mean * (1 + gust * wave));
}
/** Where the wind blows from (degrees), t seconds into the mission. */
export const windFrom = (from, t) => from + WIND.swingDegrees * Math.sin(2 * Math.PI * t / WIND.swingPeriod);
/** The share of the wind felt this high above the ground. */
export function atHeight(aboveGround) {
  const k = aboveGround / WIND.fullHeight;
  return WIND.lowShare + (1 - WIND.lowShare) * (k < 0 ? 0 : k > 1 ? 1 : k);
}
/** The Beaufort name of a wind, as a key of the texts. */
export const windName = (s) => s < 1.6 ? 'wind.calm' : s < 5.5 ? 'wind.light' : s < 8 ? 'wind.moderate' : s < 10.8 ? 'wind.fresh' : s < 13.9 ? 'wind.strong' : 'wind.gale';

export class Weather {
  constructor(plan) { this.plan = plan; this.windScale = 1; }
  get meanSpeed() { return this.plan.wind * this.windScale; }
  speedAt(t) { return windSpeed(this.plan.wind * this.windScale, this.plan.gust, t); }
  fromAt(t) { return windFrom(this.plan.windFrom, t); }
  /** The wind at a height above the ground, t seconds into the mission: [east, south] in m/s. */
  windAt(t, aboveGround) {
    const s = this.speedAt(t) * atHeight(aboveGround), from = this.fromAt(t);
    return [-Compass.forwardX(from) * s, -Compass.forwardZ(from) * s];
  }
  /** The steady part of the wind, which a drone's flight controller leans into by itself. */
  steadyAt(t, aboveGround) {
    const s = this.meanSpeed * atHeight(aboveGround), from = this.plan.windFrom;
    return [-Compass.forwardX(from) * s, -Compass.forwardZ(from) * s];
  }
  level(t) { return Weather.levelOf(this.plan, t); }
  static levelOf(plan, t) {
    const m = t / 60, min = plan.floodMinutes, lev = plan.floodLevels;
    if (m <= min[0]) return lev[0];
    for (let k = 1; k < min.length; k++) if (m <= min[k]) return lev[k - 1] + (lev[k] - lev[k - 1]) * (m - min[k - 1]) / (min[k] - min[k - 1]);
    return lev[lev.length - 1];
  }
}

// ---------- the drone ----------

export const SPEC = {
  dt: 0.02, maxSpeed: 14, maxAirSpeed: 18, maxClimb: 5, maxDescent: 3.5, yawRate: 100, tauH: 0.7, tauV: 0.4,
  gustHold: 0.65, radius: 0.6, gear: 0.25, ceiling: 120, maxPayloadKg: 8, hooks: 3, loadSlow: 0.25, loadClimbSlow: 0.3,
  hoverSeconds: 420, payloadDrain: 0.06, speedDrain: 0.35, climbDrain: 0.25, landSpeed: 2.5, landSlide: 3, crashSpeed: 4,
  lowBattery: 0.30, criticalBattery: 0.12, swapSeconds: 4,
};

/** What went wrong: the numbers are the reference model's (flight.py). */
export const CRASH = { none: 0, obstacle: 1, hard: 2, water: 3 };

export const input = (forward = 0, right = 0, up = 0, yaw = 0) => ({ forward, right, up, yaw });
export const NO_INPUT = Object.freeze(input());

export class DroneState {
  constructor() { this.resetOnPad(); }
  /** A fresh drone standing on the pad, facing east. */
  resetOnPad() {
    this.x = PAD_X; this.z = PAD_Z; this.y = PAD_Y + SPEC.gear;
    this.vx = this.vy = this.vz = 0; this.airVx = this.airVz = 0; this.heading = 90; this.battery = 1; this.payloadKg = 0;
    this.landed = true; this.crash = CRASH.none; this.hitBy = null; this.flown = 0; this.aloft = 0;
  }
  get crashed() { return this.crash !== CRASH.none; }
  get speed() { return Math.sqrt(this.vx * this.vx + this.vz * this.vz); }
  get airSpeed() { return Math.sqrt(this.airVx * this.airVx + this.airVz * this.airVz); }
  get position() { return { x: this.x, y: this.y, z: this.z }; }
  /** Its height above the ground under it (not above roofs). */
  get aboveGround() { return this.y - ground(this.x, this.z); }
  get loadShare() { return Math.min(1, this.payloadKg / SPEC.maxPayloadKg); }
  get maxSpeedNow() { return SPEC.maxSpeed * (1 - SPEC.loadSlow * this.loadShare); }
  get maxClimbNow() { return SPEC.maxClimb * (1 - SPEC.loadClimbSlow * this.loadShare); }
}

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : Number.isNaN(v) ? 0 : v);

function stop(d) { d.vx = d.vy = d.vz = 0; d.airVx = d.airVz = 0; }

/**
 * One step of SPEC.dt seconds. (wx, wz) is the wind where the drone is, (sx, sz) its steady part, level the
 * flood's level. The drone holds its place when the sticks are let go, leans into the steady wind, is pushed by
 * a share of each gust, flies no faster through the air than its motors allow, and breaks on a hard hit.
 */
export function stepDrone(d, sticks, town, wx, wz, sx, sz, level) {
  if (d.crashed) return;
  const dt = SPEC.dt;
  const dead = d.battery <= 0;
  let fwd = clamp1(sticks.forward), right = clamp1(sticks.right), up = clamp1(sticks.up), yaw = clamp1(sticks.yaw);
  // an empty battery: the motors only manage a steady way down
  if (dead) { fwd = 0; right = 0; yaw = 0; up = -0.6; }

  d.heading = Compass.wrap(d.heading + yaw * SPEC.yawRate * dt);
  if (d.landed) {
    d.vx = d.vy = d.vz = 0; d.airVx = d.airVz = 0;
    if (up > 0.1 && !dead) d.landed = false; else return;
  }

  // the speed over the ground that the sticks ask for
  const len = Math.sqrt(fwd * fwd + right * right);
  if (len > 1) { fwd /= len; right /= len; }
  const max = d.maxSpeedNow;
  const cx = (Compass.forwardX(d.heading) * fwd + Compass.rightX(d.heading) * right) * max;
  const cz = (Compass.forwardZ(d.heading) * fwd + Compass.rightZ(d.heading) * right) * max;
  // to get it, the drone must fly this fast through the air, against the steady wind; no faster than it can
  let ax = cx - sx, az = cz - sz;
  const air = Math.sqrt(ax * ax + az * az);
  if (air > SPEC.maxAirSpeed) { ax *= SPEC.maxAirSpeed / air; az *= SPEC.maxAirSpeed / air; }
  // what it really gets: the steady wind is leaned into, a share of each gust is not
  const gx = ax + sx + (1 - SPEC.gustHold) * (wx - sx);
  const gz = az + sz + (1 - SPEC.gustHold) * (wz - sz);
  const kh = Math.min(1, dt / SPEC.tauH), kv = Math.min(1, dt / SPEC.tauV);
  d.vx += (gx - d.vx) * kh;
  d.vz += (gz - d.vz) * kh;
  const cy = up >= 0 ? up * d.maxClimbNow : up * SPEC.maxDescent;
  d.vy += (cy - d.vy) * kv;
  d.airVx = d.vx - wx; d.airVz = d.vz - wz;

  let nx = d.x + d.vx * dt, ny = d.y + d.vy * dt, nz = d.z + d.vz * dt;
  // the edge of the barangay and the ceiling: the drone will not go past them
  if (nx < X0 + 2) { nx = X0 + 2; d.vx = Math.max(0, d.vx); }
  if (nx > X1 - 2) { nx = X1 - 2; d.vx = Math.min(0, d.vx); }
  if (nz < Z0 + 2) { nz = Z0 + 2; d.vz = Math.max(0, d.vz); }
  if (nz > Z1 - 2) { nz = Z1 - 2; d.vz = Math.min(0, d.vz); }
  const top = PAD_Y + SPEC.ceiling;
  if (ny > top) { ny = top; d.vy = Math.min(0, d.vy); }

  const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy + d.vz * d.vz);
  // coming down on something: the ground, a roof, the pad, or the water
  const surface = town.surfaceBelow(nx, d.y, nz);
  if (ny <= Math.max(surface, level) + SPEC.gear) {
    d.x = nx; d.z = nz;
    if (level > surface + 0.05) { d.y = level; stop(d); d.crash = CRASH.water; return; }
    d.y = surface + SPEC.gear;
    const hard = -d.vy > SPEC.landSpeed || d.speed > SPEC.landSlide;
    stop(d);
    if (hard) d.crash = CRASH.hard; else d.landed = true;
    return;
  }
  // running into something
  const hit = town.hit(nx, ny, nz, SPEC.radius);
  if (hit) {
    if (speed > SPEC.crashSpeed) { d.crash = CRASH.obstacle; d.hitBy = hit; stop(d); return; }
    // slowly: it bumps and stays where it was
    stop(d);
    nx = d.x; ny = d.y; nz = d.z;
  }
  const moved = Math.sqrt((nx - d.x) * (nx - d.x) + (nz - d.z) * (nz - d.z));
  d.x = nx; d.y = ny; d.z = nz;
  d.flown += moved; d.aloft += dt;

  // the battery
  if (!dead) {
    const a = d.airSpeed / SPEC.maxAirSpeed;
    const load = 1 + SPEC.payloadDrain * d.payloadKg + SPEC.speedDrain * a * a + SPEC.climbDrain * Math.max(0, d.vy) / SPEC.maxClimb;
    d.battery = Math.max(0, d.battery - dt * load / SPEC.hoverSeconds);
  }
}

/** How much faster than a hover the battery drains, flying level at this air speed with this load. */
export function drainFactor(payloadKg, airSpeed) {
  const a = Math.min(1, airSpeed / SPEC.maxAirSpeed);
  return 1 + SPEC.payloadDrain * payloadKg + SPEC.speedDrain * a * a;
}

// ---------- what the drone carries, and how a package falls ----------

export const FALL = { gravity: 9.81, windPull: 0.9, airDrag: 0.12, breakSpeed: 9.2 };

export class Package {
  constructor(item) {
    this.item = item; this.x = this.y = this.z = this.vx = this.vy = this.vz = 0;
    /** 'falling', 'delivered', 'missed', 'broken', 'sunk', 'notneeded' or 'reached'. */
    this.fate = 'falling'; this.impact = 0; this.target = -1; this.off = 0;
  }
  get falling() { return this.fate === 'falling'; }
}

/** One step of a falling package. Returns true when it has just landed. */
export function stepPackage(p, town, wx, wz, level) {
  if (!p.falling) return false;
  const dt = SPEC.dt;
  p.vx += (wx - p.vx) * FALL.windPull * dt;
  p.vz += (wz - p.vz) * FALL.windPull * dt;
  p.vy -= (FALL.gravity + FALL.airDrag * p.vy) * dt;
  const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
  const surface = town.surfaceBelow(nx, p.y, nz);
  if (ny > Math.max(surface, level)) { p.x = nx; p.y = ny; p.z = nz; return false; }
  p.x = nx; p.z = nz; p.impact = -p.vy;
  const water = level > surface + 0.05;
  p.y = water ? level : surface;
  p.vx = p.vy = p.vz = 0;
  p.fate = water && p.item !== 'ring' ? 'sunk' : p.impact > FALL.breakSpeed && p.item !== 'ring' ? 'broken' : 'missed';
  return true;
}

/** What hangs from the drone's hooks: at most 8 kg on three hooks. */
export class Cargo {
  constructor() { this.items = []; }
  get kg() { return this.items.reduce((s, i) => s + supply(i).kg, 0); }
  get freeHooks() { return SPEC.hooks - this.items.length; }
  /** Why this cannot be loaded, as a key of the texts; null if it can. */
  whyNot(item) {
    if (this.items.length >= SPEC.hooks) return 'load.hooks';
    if (this.kg + supply(item).kg > SPEC.maxPayloadKg + 1e-9) return 'load.heavy';
    return null;
  }
  add(item) { if (this.whyNot(item)) return false; this.items.push(item); return true; }
  remove(item) { const k = this.items.indexOf(item); if (k < 0) return false; this.items.splice(k, 1); return true; }
}
