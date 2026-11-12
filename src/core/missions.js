// The four missions, each with its weather, its clock and its score. A port of DRONE VR's Mission.cs and
// Rescue.cs.
//   LIPAD   the flight school: fly through the rings and land on the pad (FlightSchool)
//   BANTAY  environmental safety: photograph the hazards after the earthquake (HazardPatrol)
//   SAGIP   search and rescue: find the people stranded by the flood, so the boats can reach them (SearchRescue)
//   HATID   logistics: carry what four places asked for, and drop it on the mark (ReliefFlights)
// The rules do not care who flies: the autopilot, the pilot, or both. They watch the drone, keep the time, change
// the battery on the pad, send a spare drone when one is lost, follow the packages that fall, and give the result.
import { ground, Compass, dist3, flat, missionPlan, onPad, GATES, HAZARDS, SURVIVORS, SITES, STAGING, supply } from './world.js';
import { Town, Weather, SPEC, CRASH, Cargo, Package, stepPackage } from './rules.js';
import { ROUTES } from './routes.js';
import { clock } from './text.js';

/** Something to tell the operator: a key of the texts and what goes in its blanks. kind: info, good, bad, warn. */
export const event = (kind, key, ...args) => ({ kind, key, args });

/** Where the camera is and the way it looks (dir is made one metre long). */
export function aim(from, dir) {
  const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  return { from, dir: l > 1e-9 ? { x: dir.x / l, y: dir.y / l, z: dir.z / l } : { x: 0, y: -1, z: 0 } };
}
/** Degrees between the way the camera looks and the way to a point. */
export function angleTo(a, p) {
  const tx = p.x - a.from.x, ty = p.y - a.from.y, tz = p.z - a.from.z, l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (l < 1e-6) return 0;
  const c = (a.dir.x * tx + a.dir.y * ty + a.dir.z * tz) / l;
  return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c) * 180 / Math.PI;
}
/** The camera of a drone on autopilot: it turns to whatever it is asked to look at. */
export const aimAt = (d, p) => aim(d.position, { x: p.x - d.x, y: p.y - d.y, z: p.z - d.z });

/** Rounds as C# does (halves to even), so the scores are DRONE VR's. */
export function roundEven(v) {
  const f = Math.floor(v), r = v - f;
  if (r > 0.5) return f + 1;
  if (r < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const SHARES = { task: 0.70, safety: 0.18, pace: 0.12 };
export const SPARE_SECONDS = 5;
export const MISSION_IDS = ['lipad', 'bantay', 'sagip', 'hatid'];

export class Mission {
  constructor(id) {
    this.id = id; this.plan = missionPlan(id); this.town = Town.forPlan(this.plan); this.weather = new Weather(this.plan);
    this.cargo = new Cargo(); this.packages = []; this.events = [];
    this.time = 0; this.crashes = 0; this.strikes = 0; this.ended = false; this.finishedAt = null;
    this.onPadFor = 0; this.sinceCrash = 0; this.lowTold = false; this.criticalTold = false;
  }

  get seconds() { return this.plan.minutes * 60; }
  get remaining() { return Math.max(0, this.seconds - this.time); }
  get over() { return this.ended || this.finishedAt != null; }
  get allDone() { return this.count >= this.total; }
  /** The supplies this mission's loading dock offers. */
  get offers() { return []; }

  tell(kind, key, ...args) { this.events.push(event(kind, key, ...args)); }
  end() { this.ended = true; }

  /** One step of SPEC.dt seconds, after the drone has moved. auto: the autopilot has the sticks. */
  tick(d, auto) {
    if (this.over) return;
    const dt = SPEC.dt;
    this.time += dt;
    // the packages in the air
    for (const p of this.packages) {
      if (!p.falling) continue;
      const [wx, wz] = this.weather.windAt(this.time, p.y - ground(p.x, p.z));
      if (stepPackage(p, this.town, wx, wz, this.weather.level(this.time))) this.packageLanded(p);
    }
    // a lost drone: a spare one takes its place on the pad, with nothing on its hooks
    if (d.crashed) {
      if (this.sinceCrash === 0) {
        this.crashes++;
        this.tell('bad', d.crash === CRASH.water ? 'crash.water' : d.crash === CRASH.hard ? 'crash.hard' : 'crash.' + d.hitBy);
        this.cargo.items.length = 0;
      }
      this.sinceCrash += dt;
      if (this.sinceCrash >= SPARE_SECONDS) {
        d.resetOnPad(); this.sinceCrash = 0; this.onPadFor = 0; this.lowTold = this.criticalTold = false; this.tell('info', 'crash.spare');
      }
    } else {
      d.payloadKg = this.cargo.kg;
      // on the pad the battery is changed
      const home = d.landed && onPad(d.x, d.z);
      this.onPadFor = home ? this.onPadFor + dt : 0;
      if (home && d.battery < 0.999 && this.onPadFor >= SPEC.swapSeconds) { d.battery = 1; this.lowTold = this.criticalTold = false; this.tell('good', 'battery.swapped'); }
      if (!d.landed && !this.lowTold && d.battery < SPEC.lowBattery) { this.lowTold = true; this.tell('warn', 'battery.low'); }
      if (!d.landed && !this.criticalTold && d.battery < SPEC.criticalBattery) { this.criticalTold = true; this.tell('bad', 'battery.critical'); }
      this.watch(d, auto);
      if (this.allDone && home && this.finishedAt == null) { this.finishedAt = this.time; this.tell('good', 'mission.complete'); }
    }
    if (this.time >= this.seconds && !this.over) { this.ended = true; this.tell('warn', 'mission.timeup'); }
  }

  watch() {}
  /** The camera's button: a photograph, a mark on a survivor. Returns false when there was nothing to do. */
  primary() { return false; }
  /** How far each thing to do has come: 0 open, 1 found, 2 done. */
  stateOf() { return 0; }

  // ---------- loading and dropping ----------

  /** Supplies can be changed only while the drone stands on the pad. */
  canLoad(d) { return !this.over && d.landed && !d.crashed && onPad(d.x, d.z); }

  load(item, d) {
    if (!this.canLoad(d)) { this.tell('warn', 'load.pad'); return false; }
    const why = this.cargo.whyNot(item);
    if (why) { this.tell('warn', why); return false; }
    this.cargo.add(item); d.payloadKg = this.cargo.kg;
    return true;
  }

  unload(item, d) {
    if (!this.canLoad(d) || !this.cargo.remove(item)) return false;
    d.payloadKg = this.cargo.kg;
    return true;
  }

  /** Which package to let go here: by default the first one loaded. */
  choose() { return this.cargo.items[0]; }

  /** Lets one package go. Returns it, or null if there is none, or the drone is on the ground. */
  release(d) {
    if (this.over || d.crashed) return null;
    if (this.cargo.items.length === 0) { this.tell('warn', 'drop.empty'); return null; }
    if (d.landed) { this.tell('warn', 'drop.landed'); return null; }
    const item = this.choose(d);
    this.cargo.remove(item); d.payloadKg = this.cargo.kg;
    const p = new Package(item);
    Object.assign(p, { x: d.x, y: d.y - 0.3, z: d.z, vx: d.vx, vy: Math.min(0, d.vy), vz: d.vz });
    this.packages.push(p);
    return p;
  }

  packageLanded(p) {
    if (p.fate === 'sunk') this.tell('bad', 'drop.sunk', 'supply.' + p.item);
    else if (p.fate === 'broken') this.tell('bad', 'drop.broken', 'supply.' + p.item);
  }

  // ---------- the result ----------

  result(d) {
    const r = { stars: 0, score: 0, tasks: 0, safety: 0, pace: 0, lines: [] };
    const home = d.landed && !d.crashed && onPad(d.x, d.z);
    r.tasks = clamp01(this.taskScore(d));
    r.safety = clamp01(1 - 0.34 * this.crashes - 0.15 * this.strikes - (home ? 0 : 0.3));
    // finished with time to spare: full marks up to six tenths of the time, less after
    const used = (this.finishedAt ?? this.seconds) / this.seconds;
    r.pace = this.finishedAt == null ? 0 : clamp01(used <= 0.6 ? 1 : 1 - (used - 0.6) / 0.4 * 0.7);
    r.score = roundEven(100 * (SHARES.task * r.tasks + SHARES.safety * r.safety + SHARES.pace * r.pace));
    r.stars = r.score >= 85 ? 3 : r.score >= 60 ? 2 : r.score >= 35 ? 1 : 0;
    this.describe(r, d);
    if (this.crashes > 0) r.lines.push(event('bad', 'end.crashes', this.crashes));
    if (this.strikes > 0) r.lines.push(event('warn', 'end.strikes', this.strikes));
    r.lines.push(event(home ? 'good' : 'warn', home ? 'end.home' : 'end.nothome'));
    if (this.finishedAt != null) r.lines.push(event('info', 'end.time', clock(this.finishedAt), clock(this.seconds)));
    else r.lines.push(event('warn', 'end.unfinished'));
    return r;
  }
}

const distance = (d, p) => dist3(d.position, p);

// ---------------------------------------------------------------------------------------------------------

/** LIPAD, the flight school: take off, fly through the rings in order, and land on the pad. */
export class FlightSchool extends Mission {
  constructor() { super('lipad'); this.passed = 0; this.landedHome = false; this.tookOff = false; }
  get total() { return GATES.length + 1; }
  get count() { return this.passed + (this.landedHome ? 1 : 0); }
  stateOf(i) { return i < this.passed ? 2 : 0; }
  watch(d) {
    if (!d.landed) this.tookOff = true;
    if (this.passed < GATES.length) {
      const g = GATES[this.passed];
      if (distance(d, g.center()) <= g.r) {
        this.passed++;
        this.tell('good', this.passed < GATES.length ? 'lipad.gate' : 'lipad.gates.done', this.passed, GATES.length);
      }
    } else if (!this.landedHome && this.tookOff && d.landed && onPad(d.x, d.z)) this.landedHome = true;
  }
  taskScore() { return (this.passed + (this.landedHome ? 2 : 0)) / (GATES.length + 2); }
  describe(r) { r.lines.push(event('info', 'end.lipad.gates', this.passed, GATES.length)); }
}

// ---------------------------------------------------------------------------------------------------------

/**
 * BANTAY, the hazard patrol. After the earthquake the residents report dangers. The drone goes to look, and
 * brings back a photograph of each, taken from a safe distance, sharp enough for the barangay to act on.
 */
export const PATROL = { range: 45, sharp0: 12, sharp1: 28, cone: 14, steady: 2, blur: 8, enough: 0.5, fine: 0.8, autoFraming: 0.7 };

export class HazardPatrol extends Mission {
  constructor() { super('bantay'); this.quality = HAZARDS.map(() => 0); this.tooClose = HAZARDS.map(() => false); this.photos = 0; }
  get total() { return this.quality.length; }
  get count() { return this.quality.filter((q) => q >= PATROL.enough).length; }
  stateOf(i) { return this.quality[i] >= PATROL.enough ? 2 : this.quality[i] > 0 ? 1 : 0; }

  /** How good a photograph of a hazard would be from here: 0 if it cannot be taken. */
  static qualityOf(h, d, angle) {
    const P = PATROL, dist = distance(d, h.point());
    if (dist > P.range || angle > P.cone) return 0;
    const far = dist <= P.sharp1 ? 1 : 1 - 0.6 * (dist - P.sharp1) / (P.range - P.sharp1);
    const near = dist >= P.sharp0 ? 1 : dist < h.near ? 0.5 : 0.8;
    const aimQ = 1 - 0.5 * angle / P.cone;
    const v = Math.sqrt(d.vx * d.vx + d.vy * d.vy + d.vz * d.vz);
    const steady = v <= P.steady ? 1 : v >= P.blur ? 0.4 : 1 - 0.6 * (v - P.steady) / (P.blur - P.steady);
    return far * near * aimQ * steady;
  }

  primary(d, a) {
    if (this.over || d.crashed) return false;
    this.photos++;
    let best = -1, bq = 0;
    HAZARDS.forEach((h, i) => { const q = HazardPatrol.qualityOf(h, d, angleTo(a, h.point())); if (q > bq) { bq = q; best = i; } });
    if (best < 0) { this.tell('info', 'photo.nothing'); return false; }
    this.keep(best, bq);
    return true;
  }

  keep(i, q) {
    const had = this.quality[i] >= PATROL.enough, h = HAZARDS[i];
    if (q <= this.quality[i]) { this.tell('info', 'photo.nobetter', 'hazard.' + h.id); return; }
    this.quality[i] = q;
    const P = PATROL;
    this.tell(q >= P.fine ? 'good' : q >= P.enough ? 'info' : 'warn', q >= P.fine ? 'photo.fine' : q >= P.enough ? 'photo.enough' : 'photo.poor', 'hazard.' + h.id, Math.round(q * 100));
    if (!had && q >= P.enough && this.allDone) this.tell('good', 'bantay.alldone');
  }

  watch(d, auto) {
    HAZARDS.forEach((h, i) => {
      const dist = distance(d, h.point());
      if (!this.tooClose[i] && !d.landed && dist < h.near) { this.tooClose[i] = true; this.strikes++; this.tell('bad', 'bantay.tooclose', 'hazard.' + h.id); }
      // on autopilot the camera looks for hazards by itself and keeps its best picture
      if (auto && !d.landed && dist <= PATROL.range) {
        const q = HazardPatrol.qualityOf(h, d, 0) * PATROL.autoFraming;
        if (q > this.quality[i] + 0.05 && (q >= PATROL.enough || this.quality[i] === 0)) { this.photos++; this.keep(i, q); }
      }
    });
  }

  taskScore() {
    const P = PATROL;
    return this.quality.reduce((s, q) => s + (q >= P.enough ? 0.6 + 0.4 * Math.min(1, (q - P.enough) / (P.fine - P.enough)) : 0), 0) / this.quality.length;
  }

  describe(r) {
    r.lines.push(event('info', 'end.bantay.count', this.count, this.total, this.photos));
    this.quality.forEach((q, i) => { if (q < PATROL.enough) r.lines.push(event('warn', 'end.bantay.missed', 'hazard.' + HAZARDS[i].id)); });
  }
}

// ---------------------------------------------------------------------------------------------------------

/**
 * HATID, the relief flights. The typhoon has passed, the wind is still strong and the bridge is out. Four places
 * have asked for supplies. The drone carries them, a few at a time, and drops each on its mark.
 */
export class ReliefFlights extends Mission {
  constructor() {
    super('hatid');
    this.got = SITES.map((s) => s.needs.map(() => false));
    this.accuracy = SITES.map((s) => s.needs.map(() => 0));
    this.lost = 0;
  }
  get offers() { return ['water', 'food', 'medicine', 'firstaid', 'radio']; }
  get total() { return SITES.reduce((n, s) => n + s.needs.length, 0); }
  get count() { return this.got.reduce((n, g) => n + g.filter(Boolean).length, 0); }
  stateOf(i) { const n = this.got[i].filter(Boolean).length; return n === this.got[i].length ? 2 : n > 0 ? 1 : 0; }

  /** What a site still needs. */
  stillNeeds(site) { return SITES[site].needs.filter((_, k) => !this.got[site][k]); }

  /** The site the drone is over (within twice its radius), or -1. */
  static siteUnder(x, z) { return SITES.findIndex((s) => flat(s.x, s.z, x, z) <= s.r * 2); }

  /** Over a site, the drone lets go of something that site asked for, if it carries it. */
  choose(d) {
    const site = ReliefFlights.siteUnder(d.x, d.z);
    if (site >= 0) for (const need of this.stillNeeds(site)) if (this.cargo.items.includes(need)) return need;
    return this.cargo.items[0];
  }

  primary(d) { return this.release(d) != null; }

  packageLanded(p) {
    if (p.fate !== 'missed') { this.lost++; super.packageLanded(p); return; }
    // which site did it land in, if any? On the roof means on the roof, not in the water beside the house.
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i], off = flat(s.x, s.z, p.x, p.z);
      if (off > s.r || Math.abs(p.y - s.point().y) > 1.5) continue;
      p.target = i; p.off = off;
      let k = s.needs.indexOf(p.item);
      while (k >= 0 && this.got[i][k]) k = s.needs.indexOf(p.item, k + 1);
      if (k < 0) { p.fate = 'notneeded'; this.lost++; this.tell('warn', 'drop.notneeded', 'supply.' + p.item, 'site.' + s.id); return; }
      this.got[i][k] = true; this.accuracy[i][k] = 1 - 0.5 * off / s.r;
      p.fate = 'delivered';
      this.tell('good', 'drop.delivered', 'supply.' + p.item, 'site.' + s.id, off.toFixed(1));
      if (this.allDone) this.tell('good', 'hatid.alldone');
      return;
    }
    this.lost++;
    this.tell('bad', 'drop.missed', 'supply.' + p.item);
  }

  taskScore() {
    let s = 0;
    this.got.forEach((g, i) => g.forEach((b, k) => { if (b) s += 0.5 + 0.5 * this.accuracy[i][k]; }));
    return Math.max(0, s / this.total - 0.05 * this.lost);
  }

  describe(r) {
    r.lines.push(event('info', 'end.hatid.count', this.count, this.total));
    SITES.forEach((s, i) => { const left = this.stillNeeds(i); if (left.length) r.lines.push(event('warn', 'end.hatid.waiting', 'site.' + s.id, left.length)); });
    if (this.lost > 0) r.lines.push(event('warn', 'end.hatid.lost', this.lost));
  }
}

// ---------------------------------------------------------------------------------------------------------

/**
 * The barangay's rescue boats. Each waits at its landing, takes the job it can reach soonest, follows the flooded
 * streets to the group (ROUTES, worked out once from the plan), takes the people aboard and brings them back.
 */
export const BOATS = { speed: 6, loadSeconds: 6, unloadSeconds: 4, homes: [0, 0, 1] };

export class RescueFleet {
  constructor() {
    this.boats = BOATS.homes.map((home) => ({ home, x: STAGING[home][0], z: STAGING[home][1], heading: 0, phase: 'waiting', survivor: -1, freeAt: 0, jobs: [], route: null, leg: 0, timer: 0 }));
    this.aboardAt = SURVIVORS.map(() => NaN);
    this.ashoreAt = SURVIVORS.map(() => NaN);
    this.now = 0;
  }

  /** The length of the way from a landing to a group, in metres. */
  static way(home, survivor) {
    const r = ROUTES[home][survivor];
    let len = 0;
    for (let k = 1; k < r.length; k++) len += flat(r[k][0], r[k][1], r[k - 1][0], r[k - 1][1]);
    return len;
  }

  /** A group can be reached: the boat that can be there soonest is given the job. Returns [boat, the second it arrives]. */
  send(survivor) {
    let best = 0, eta = Infinity;
    this.boats.forEach((b, i) => {
      const t = Math.max(this.now, b.freeAt) + RescueFleet.way(b.home, survivor) / BOATS.speed;
      if (t < eta - 1e-9) { eta = t; best = i; }
    });
    const boat = this.boats[best];
    boat.freeAt = Math.max(this.now, boat.freeAt) + 2 * RescueFleet.way(boat.home, survivor) / BOATS.speed + BOATS.loadSeconds + BOATS.unloadSeconds;
    boat.jobs.push(survivor);
    return [best, eta];
  }

  get busy() { return this.boats.some((b) => b.phase !== 'waiting' || b.jobs.length > 0); }

  step(dt) {
    this.now += dt;
    for (const b of this.boats) {
      switch (b.phase) {
        case 'waiting':
          if (!b.jobs.length) break;
          b.survivor = b.jobs.shift(); b.route = ROUTES[b.home][b.survivor]; b.leg = 1; b.phase = 'out';
          break;
        case 'out':
          if (sail(b, dt, 1)) { b.phase = 'loading'; b.timer = 0; }
          break;
        case 'loading':
          b.timer += dt;
          if (b.timer >= BOATS.loadSeconds) { this.aboardAt[b.survivor] = this.now; b.phase = 'back'; b.leg = b.route.length - 2; }
          break;
        case 'back':
          if (sail(b, dt, -1)) { b.phase = 'unloading'; b.timer = 0; }
          break;
        case 'unloading':
          b.timer += dt;
          if (b.timer >= BOATS.unloadSeconds) { this.ashoreAt[b.survivor] = this.now; b.survivor = -1; b.phase = 'waiting'; }
          break;
      }
    }
  }

  /** Lets the boats finish every job they have. */
  finish() { for (let guard = 0; this.busy && guard < 200000; guard++) this.step(0.1); }
}

/** Moves a boat along its way, forwards (+1) or back (-1). Returns true at the end of the way. */
function sail(b, dt, dir) {
  let go = BOATS.speed * dt;
  const points = b.route.length;
  while (go > 0 && b.leg >= 0 && b.leg < points) {
    const [tx, tz] = b.route[b.leg];
    const dx = tx - b.x, dz = tz - b.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-6) b.heading = Compass.towards(b.x, b.z, tx, tz);
    if (go >= d) { b.x = tx; b.z = tz; go -= d; b.leg += dir; }
    else { b.x += dx / d * go; b.z += dz / d * go; go = 0; }
  }
  return b.leg < 0 || b.leg >= points;
}

/**
 * SAGIP, the search and rescue. The river is over its banks and still rising. People are on roofs, in a tree, on
 * a stranded jeepney; some cannot be seen from the sky at all. The drone finds them; the boats go and get them.
 * One man is in fast water: a boat can pull him in only once the drone has dropped him a life ring.
 */
export const SEARCH = { seeRange: 70, thermalRange: 30, cone: 9, autoSwath: 0.9, autoMax: 45, autoThermalAlt: 26, autoThermalRange: 18, ringReach: 6 };

export class SearchRescue extends Mission {
  constructor() {
    super('sagip');
    this.fleet = new RescueFleet();
    this.foundAt = SURVIVORS.map(() => NaN); this.ringAt = SURVIVORS.map(() => NaN); this.boatDue = SURVIVORS.map(() => NaN);
    this.lateTold = SURVIVORS.map(() => false);
  }
  get offers() { return ['ring']; }
  get total() { return SURVIVORS.length; }
  get count() { return this.foundAt.filter((t) => !Number.isNaN(t)).length; }
  found(i) { return !Number.isNaN(this.foundAt[i]); }
  aboard(i) { return !Number.isNaN(this.fleet.aboardAt[i]); }
  ringed(i) { return !Number.isNaN(this.ringAt[i]); }
  boatSent(i) { return !Number.isNaN(this.boatDue[i]); }
  needsRing(i) { return SURVIVORS[i].ring && !this.ringed(i) && !this.aboard(i); }
  stateOf(i) { return this.aboard(i) ? 2 : this.found(i) ? 1 : 0; }
  deadline(i) { return SURVIVORS[i].limitMinutes * 60; }
  inTime(i) {
    if (!this.found(i) || !this.boatSent(i)) return false;
    return (this.aboard(i) ? this.fleet.aboardAt[i] : this.boatDue[i]) <= this.deadline(i);
  }
  canSee(i, d, thermal) {
    const s = SURVIVORS[i], dist = distance(d, s.point());
    return s.hidden ? thermal && dist <= SEARCH.thermalRange : dist <= SEARCH.seeRange;
  }

  mark(i, byClass) {
    if (this.found(i)) return;
    this.foundAt[i] = this.time;
    const s = SURVIVORS[i];
    if (this.needsRing(i)) this.tell('warn', 'sagip.needsring', 'survivor.' + s.id);
    else {
      const eta = this.sendBoat(i);
      if (!byClass) this.tell('good', 'sagip.found', 'survivor.' + s.id, s.people, clock(Math.max(0, eta - this.time)));
    }
    if (byClass) this.tell('info', 'sagip.found.class', 'survivor.' + s.id);
    if (this.allDone) this.tell('good', 'sagip.alldone');
  }

  sendBoat(i) {
    const [, eta] = this.fleet.send(i);
    this.boatDue[i] = eta + BOATS.loadSeconds;
    return eta;
  }

  primary(d, a, thermal) {
    if (this.over || d.crashed) return false;
    let best = -1, ba = SEARCH.cone, hiddenNear = false;
    SURVIVORS.forEach((s, i) => {
      if (this.found(i)) return;
      const angle = angleTo(a, s.point());
      if (angle > SEARCH.cone) return;
      if (!this.canSee(i, d, thermal)) { if (s.hidden && !thermal && distance(d, s.point()) <= SEARCH.thermalRange) hiddenNear = true; return; }
      if (angle <= ba) { ba = angle; best = i; }
    });
    if (best < 0) { this.tell('info', hiddenNear ? 'sagip.trythermal' : 'sagip.nothing'); return false; }
    this.mark(best, false);
    return true;
  }

  watch(d, auto) {
    this.fleet.step(SPEC.dt);
    SURVIVORS.forEach((s, i) => {
      // on autopilot the camera recognises people by itself
      if (auto && !d.landed && !this.found(i)) {
        const f = flat(d.x, d.z, s.x, s.z), high = d.y - s.point().y;
        const seen = s.hidden ? high <= SEARCH.autoThermalAlt && f <= SEARCH.autoThermalRange : f <= Math.min(SEARCH.autoMax, SEARCH.autoSwath * high);
        if (seen && high > 0) this.mark(i, false);
      }
      if (!this.lateTold[i] && !this.aboard(i) && this.time > this.deadline(i)) { this.lateTold[i] = true; this.tell('bad', 'sagip.late', 'survivor.' + s.id); }
    });
  }

  choose() { return this.cargo.items.includes('ring') ? 'ring' : this.cargo.items[0]; }

  packageLanded(p) {
    if (p.item !== 'ring') { super.packageLanded(p); return; }
    for (let i = 0; i < SURVIVORS.length; i++) {
      const s = SURVIVORS[i];
      if (!s.ring || this.ringed(i)) continue;
      const off = flat(s.x, s.z, p.x, p.z);
      if (off > SEARCH.ringReach) continue;
      this.ringAt[i] = this.time; p.fate = 'reached'; p.target = i; p.off = off;
      // now a boat can pull him in: it is sent if he has been marked, or as soon as he is
      if (this.found(i) && !this.boatSent(i)) this.tell('good', 'sagip.ring', 'survivor.' + s.id, clock(Math.max(0, this.sendBoat(i) - this.time)));
      else this.tell('good', 'sagip.ring.unmarked', 'survivor.' + s.id);
      return;
    }
    this.tell('warn', 'sagip.ring.missed');
  }

  taskScore() {
    this.fleet.finish();
    let s = 0, all = 0;
    SURVIVORS.forEach((v, i) => { all += v.people; if (this.found(i)) s += v.people * (this.inTime(i) ? 1 : 0.4); });
    return s / all;
  }

  describe(r) {
    this.fleet.finish();
    let people = 0, saved = 0;
    SURVIVORS.forEach((s, i) => {
      people += s.people;
      if (!this.found(i)) { r.lines.push(event('warn', 'end.sagip.missed', 'survivor.' + s.id, s.people)); return; }
      if (this.inTime(i)) saved += s.people;
      else r.lines.push(event('warn', this.needsRing(i) ? 'end.sagip.noring' : 'end.sagip.late', 'survivor.' + s.id));
    });
    r.lines.unshift(event('info', 'end.sagip.count', this.count, this.total, saved, people));
  }
}

export function createMission(id) {
  switch (id) {
    case 'lipad': return new FlightSchool();
    case 'bantay': return new HazardPatrol();
    case 'sagip': return new SearchRescue();
    case 'hatid': return new ReliefFlights();
  }
  throw new Error('no mission ' + id);
}

export { supply };
