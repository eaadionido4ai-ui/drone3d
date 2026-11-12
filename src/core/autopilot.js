// The autopilot: it flies a route drawn on the map, one waypoint after the other, then comes home and lands.
// It works the same sticks as a pilot does, so the drone flies by the same rules either way, in the same wind.
// A port of DRONE VR's Autopilot.cs.
//
// A waypoint is a point on the map and a height above the ground there. The drone climbs first, flies level,
// and comes down only when it is near. At a waypoint it can fly on, hover a few seconds (to look), or come down
// low and drop what it carries. It does not see obstacles, and drops from straight above the mark: for a small
// target on a windy day, the pilot takes the sticks (Hybrid).
import { ground, Compass, PAD_X, PAD_Y, PAD_Z, onPad } from './world.js';
import { SPEC, NO_INPUT, drainFactor, atHeight } from './rules.js';

export const AUTO = {
  cruise: 10, hoverSeconds: 3, dropHeight: 3.5, returnAlt: 30, minClimb: 10, reach: 3, reachHigh: 2.5,
  descendWithin: 15, reserve: 0.08, altitudes: [10, 15, 20, 30, 45, 60],
};

export class Waypoint {
  /** kind: 'fly' through it, 'hover' over it for a few seconds, or 'drop' a package on it. */
  constructor(x, z, alt, kind = 'fly') { this.x = x; this.z = z; this.alt = alt; this.kind = kind; }
  /** The height to fly at, above the river's normal level. */
  get y() { return ground(this.x, this.z) + this.alt; }
}

/** The sticks that take the drone towards a point at a height, no faster than a speed. */
export function flyTowards(d, tx, tz, ty, speed, turn) {
  const dx = tx - d.x, dz = tz - d.z, dist = Math.sqrt(dx * dx + dz * dz);
  const v = Math.min(speed, dist * 0.9);
  const vx = dist > 1e-6 ? dx / dist * v : 0, vz = dist > 1e-6 ? dz / dist * v : 0;
  const max = d.maxSpeedNow;
  const input = {
    forward: (vx * Compass.forwardX(d.heading) + vz * Compass.forwardZ(d.heading)) / max,
    right: (vx * Compass.rightX(d.heading) + vz * Compass.rightZ(d.heading)) / max,
    up: 0, yaw: 0,
  };
  const e = ty - d.y;
  input.up = e >= 0 ? Math.min(1, e * 0.8 / d.maxClimbNow) : Math.max(-1, e * 0.8 / SPEC.maxDescent);
  if (turn && dist > 6) input.yaw = Math.max(-1, Math.min(1, Compass.turn(d.heading, Compass.towards(d.x, d.z, tx, tz)) / 30));
  return input;
}

export class Autopilot {
  constructor() {
    this.route = [];
    /** The waypoint the drone is flying to. */
    this.next = 0;
    /** 'idle', 'climb', 'cruise', 'hold', 'descend', 'settle', 'release', 'climbBack', 'land' or 'done'. */
    this.phase = 'idle';
    this.returning = false; this.lowBatteryReturn = false; this.releaseNow = false; this.waiting = false;
    this.legY = 0; this.timer = 0; this.still = 0; this.holdX = 0; this.holdZ = 0; this.legStarted = false;
  }

  get active() { return this.phase !== 'idle' && this.phase !== 'done'; }
  get target() { return !this.returning && this.next < this.route.length ? this.route[this.next] : null; }

  /** Starts the route from the beginning. */
  launch() {
    this.next = 0; this.returning = false; this.lowBatteryReturn = false; this.waiting = false; this.legStarted = false;
    this.phase = this.route.length > 0 ? 'climb' : 'idle';
  }

  /** Come home now. */
  goHome(d) {
    if (d.landed && onPad(d.x, d.z)) return;
    this.returning = true; this.waiting = false; this.legStarted = false; this.phase = 'climb';
  }

  /** Stops flying the route (the drone crashed, or the mission is over). */
  abort() { this.phase = 'idle'; this.returning = false; this.waiting = false; this.legStarted = false; this.releaseNow = false; }

  /** Takes the waypoints not yet reached off the route. In the air, the drone hovers where it is. */
  clearAhead(d) {
    if (this.next < this.route.length) this.route.splice(this.next);
    if (this.returning || d.landed) return;
    this.waiting = true; this.holdX = d.x; this.holdZ = d.z; this.phase = 'hold';
  }

  /** Takes the last waypoint off the route, if the drone has not flown past it. */
  undo() {
    if (this.route.length === 0 || this.route.length - 1 < this.next) return false;
    if (this.route.length - 1 === this.next && this.active && this.phase !== 'climb' && this.phase !== 'cruise') return false;
    this.route.pop();
    return true;
  }

  add(w) {
    this.route.push(w);
    if (this.waiting) { this.waiting = false; this.legStarted = false; this.phase = 'climb'; }
  }

  /** The pilot hands the sticks back: go on with the route from where the drone is now. */
  resume(d) {
    this.legStarted = false; this.releaseNow = false;
    if (this.phase === 'idle' || this.phase === 'done') return;
    if (!this.returning && this.next >= this.route.length) this.returning = true;
    this.phase = d.landed && this.returning && onPad(d.x, d.z) ? 'done' : 'climb';
  }

  /** The pilot dropped a package by hand near the next drop waypoint: that waypoint is done. */
  droppedByHand(x, z) {
    const w = this.target;
    if (w && w.kind === 'drop' && Math.sqrt((w.x - x) ** 2 + (w.z - z) ** 2) < 20) { this.next++; this.legStarted = false; }
  }

  /** The share of the battery needed to come home from here, with what the drone carries. */
  static batteryToReturn(d) {
    const dx = PAD_X - d.x, dz = PAD_Z - d.z;
    const climb = Math.max(0, PAD_Y + AUTO.returnAlt - d.y);
    const seconds = Math.sqrt(dx * dx + dz * dz) / AUTO.cruise + climb / d.maxClimbNow + AUTO.returnAlt / 1.8 + 6;
    return seconds * drainFactor(d.payloadKg, AUTO.cruise * 1.3) / SPEC.hoverSeconds;
  }

  advance() { this.next++; this.legStarted = false; this.phase = 'climb'; this.timer = 0; }

  /** One step: what the sticks should say now. level is the flood's level: a drop is made from above the water. */
  step(d, town, level = 0) {
    const dt = SPEC.dt;
    this.releaseNow = false;
    if (this.phase === 'idle' || this.phase === 'done' || d.crashed) return NO_INPUT;

    if (!this.returning && !d.landed && d.battery < Autopilot.batteryToReturn(d) + AUTO.reserve) {
      this.returning = true; this.lowBatteryReturn = true; this.waiting = false; this.legStarted = false; this.phase = 'climb';
    }
    if (!this.returning && !this.waiting && this.next >= this.route.length) { this.returning = true; this.legStarted = false; this.phase = 'climb'; }

    let tx, tz, ty;
    const w = this.target;
    if (this.waiting) { tx = this.holdX; tz = this.holdZ; ty = d.y; }
    else if (w) { tx = w.x; tz = w.z; ty = w.y; }
    else { tx = PAD_X; tz = PAD_Z; ty = PAD_Y + AUTO.returnAlt; }
    if (!this.legStarted) {
      this.legStarted = true; this.timer = 0;
      // from the ground, always clear of the pad's surroundings first
      this.legY = Math.max(d.landed ? d.y + AUTO.minClimb : d.y, ty);
    }
    const dist = Math.sqrt((tx - d.x) ** 2 + (tz - d.z) ** 2);

    switch (this.phase) {
      case 'climb':
        // straight up to the height of the leg, before going anywhere
        if (d.y >= this.legY - 0.6 || this.waiting) this.phase = this.waiting ? 'hold' : 'cruise';
        return flyTowards(d, d.x, d.z, this.legY, 0, false);
      case 'cruise': {
        const y = dist > AUTO.descendWithin ? this.legY : ty;
        if (dist < AUTO.reach && Math.abs(d.y - ty) < AUTO.reachHigh) {
          this.timer = 0;
          if (!w) this.phase = 'land';
          else if (w.kind === 'fly') this.advance();
          else if (w.kind === 'hover') this.phase = 'hold';
          else this.phase = 'descend';
        }
        return flyTowards(d, tx, tz, y, AUTO.cruise, true);
      }
      case 'hold':
        if (!this.waiting) { this.timer += dt; if (this.timer >= AUTO.hoverSeconds) this.advance(); }
        return flyTowards(d, tx, tz, ty, 3, false);
      case 'descend': {
        const low = Math.max(town.surfaceBelow(tx, d.y, tz), level) + AUTO.dropHeight;
        if (d.y <= low + 0.4) { this.phase = 'settle'; this.timer = 0; this.still = 0; }
        return flyTowards(d, tx, tz, low, 3, false);
      }
      case 'settle': {
        // wait until the drone hangs still over the mark, but not for ever: a gusty wind never lets it
        const low = Math.max(town.surfaceBelow(tx, d.y, tz), level) + AUTO.dropHeight;
        this.timer += dt;
        this.still = dist < 1.2 && d.speed < 0.8 ? this.still + dt : 0;
        if (this.still >= 1 || this.timer >= 8) { this.phase = 'release'; this.timer = 0; this.releaseNow = true; }
        return flyTowards(d, tx, tz, low, 3, false);
      }
      case 'release':
        this.timer += dt;
        if (this.timer >= 0.6) this.phase = 'climbBack';
        return flyTowards(d, tx, tz, d.y, 3, false);
      case 'climbBack':
        if (d.y >= ty - 0.6) this.advance();
        return flyTowards(d, tx, tz, ty, 3, false);
      case 'land': {
        if (d.landed) { this.phase = 'done'; return NO_INPUT; }
        // fast at first, gently for the last metres
        const above = d.y - (PAD_Y + SPEC.gear);
        const input = flyTowards(d, tx, tz, d.y, 3, false);
        input.up = above > 4 ? -1 : -0.42;
        return input;
      }
    }
    return NO_INPUT;
  }
}

/**
 * What a route will cost, worked out before the drone flies it: metres, seconds and the share of a battery. For a
 * route flown from the pad and back, carrying payloadKg at the start (each drop leaves one package: dropKg is the
 * weight of each in turn), in a steady wind (meanWind m/s at 60 m, from windFrom).
 */
export function estimateRoute(route, payloadKg, dropKg, meanWind, windFrom) {
  const e = { metres: 0, seconds: 0, battery: 0 };
  let x = PAD_X, z = PAD_Z, y = PAD_Y, kg = payloadKg, drop = 0;
  for (let i = 0; i <= route.length; i++) {
    const home = i === route.length;
    const tx = home ? PAD_X : route[i].x, tz = home ? PAD_Z : route[i].z;
    const ty = home ? PAD_Y + AUTO.returnAlt : route[i].y;
    const share = Math.min(1, kg / SPEC.maxPayloadKg);
    const climbRate = SPEC.maxClimb * (1 - SPEC.loadClimbSlow * share);
    const climb = Math.max(0, ty - y), d = Math.sqrt((tx - x) ** 2 + (tz - z) ** 2);
    // the climb, then the leg: over the ground at cruise speed, through the air faster or slower with the wind
    const tClimb = climb > 0.5 ? climb / climbRate + 1.5 : 0;
    const s = meanWind * atHeight(Math.max(0, ty - ground(tx, tz)));
    const wx = -Compass.forwardX(windFrom) * s, wz = -Compass.forwardZ(windFrom) * s;
    const ux = d > 1e-6 ? (tx - x) / d : 0, uz = d > 1e-6 ? (tz - z) / d : 0;
    const ax = ux * AUTO.cruise - wx, az = uz * AUTO.cruise - wz;
    const air = Math.sqrt(ax * ax + az * az);
    const tLeg = d / AUTO.cruise + 1.5;
    e.seconds += tClimb + tLeg;
    e.battery += (tClimb * (drainFactor(kg, s) + SPEC.climbDrain * 0.8) + tLeg * drainFactor(kg, air)) / SPEC.hoverSeconds;
    e.metres += d;
    x = tx; z = tz; y = Math.max(y, ty);
    let wait = 0;
    if (home) wait = (AUTO.returnAlt - 4) / SPEC.maxDescent + 4 / 1.47 + 1.5;
    else if (route[i].kind === 'hover') wait = AUTO.hoverSeconds;
    else if (route[i].kind === 'drop') {
      wait = route[i].alt / 3.2 + route[i].alt / climbRate + 4;
      if (dropKg && drop < dropKg.length) kg = Math.max(0, kg - dropKg[drop]);
      drop++;
    }
    if (!home) y = ty;
    e.seconds += wait;
    e.battery += wait * drainFactor(kg, s) / SPEC.hoverSeconds;
  }
  return e;
}
