// One mission being flown: the drone, the autopilot, the mission's rules and its weather, stepped together. The
// game gives it the sticks and the time that has passed; it does the rest. A port of DRONE VR's Flight.cs.
//
// The three ways to fly (mode):
//   'desk'    Command Desk: plan on the map, load the hooks, launch. The autopilot flies.
//   'pilot'   FPV Pilot: fly the drone yourself, from take-off to landing. No autopilot.
//   'hybrid'  the route is flown as on the desk, and the player takes the sticks at any moment, then hands them
//             back: the autopilot goes on from where the drone is.
import { ground, inside, flat, GATES, SURVIVORS, SITES, supply } from './world.js';
import { SPEC, DroneState, stepDrone } from './rules.js';
import { Autopilot, Waypoint, estimateRoute } from './autopilot.js';
import { createMission, ReliefFlights, SearchRescue, HazardPatrol, FlightSchool, MISSION_IDS } from './missions.js';

export const FLIGHT = { maxWaypoints: 24, gateSnap: 12, ringAside: 3.6 };

export class Flight {
  constructor(mission, mode) {
    this.mission = createMission(mission);
    this.mode = mode;
    this.drone = new DroneState();
    this.auto = new Autopilot();
    /** The player has the sticks. */
    this.manual = mode === 'pilot';
    /** The thermal camera is on. */
    this.thermal = false;
    /** The height given to the next waypoint put on the map, in metres above the ground. */
    this.waypointAlt = 30;
    this.accum = 0;
  }

  get canPlan() { return this.mode !== 'pilot'; }
  get canFly() { return this.mode !== 'desk'; }
  get time() { return this.mission.time; }

  // ---------- the map ----------

  /**
   * Puts a waypoint on the route at a point of the map. What the drone does there depends on the place: over a
   * site that asked for supplies it comes down and drops; on a hazard patrol it stops to look; near a ring of the
   * flight school it flies through the ring; beside the man in the fast water it drops the life ring. Returns null
   * if it cannot be added.
   */
  addWaypoint(x, z) {
    const m = this.mission;
    if (!this.canPlan || m.over || this.auto.route.length >= FLIGHT.maxWaypoints || !inside(x, z)) return null;
    const w = new Waypoint(x, z, this.waypointAlt);
    if (m instanceof ReliefFlights) {
      const site = ReliefFlights.siteUnder(x, z);
      if (site >= 0) { w.x = SITES[site].x; w.z = SITES[site].z; w.kind = 'drop'; }
    } else if (m instanceof SearchRescue) {
      SURVIVORS.forEach((s, i) => {
        // a life ring is dropped beside the person, clear of the tree he holds on to
        if (s.ring && m.found(i) && flat(s.x, s.z, x, z) < 12) { w.x = s.x; w.z = s.z - FLIGHT.ringAside; w.kind = 'drop'; }
      });
    } else if (m instanceof HazardPatrol) w.kind = 'hover';
    else if (m instanceof FlightSchool) {
      for (const g of GATES) if (flat(g.x, g.z, x, z) < FLIGHT.gateSnap) { w.x = g.x; w.z = g.z; w.alt = g.y; }
    }
    this.auto.add(w);
    return w;
  }

  undoWaypoint() { return this.canPlan && this.auto.undo(); }
  clearRoute() { if (this.canPlan) this.auto.clearAhead(this.drone); }

  /** The waypoints still to fly. */
  ahead() { return this.auto.route.slice(this.auto.active ? this.auto.next : 0); }

  /** What the route will cost, from the pad and back, with what is on the hooks. */
  estimate() {
    const kg = this.mission.cargo.items.map((i) => supply(i).kg);
    return estimateRoute(this.ahead(), this.mission.cargo.kg, kg, this.mission.weather.meanSpeed, this.mission.plan.windFrom);
  }

  /** Sends the drone on its route (desk and hybrid). */
  launch() {
    if (!this.canPlan || this.mission.over || this.drone.crashed || this.auto.route.length === 0) return false;
    if (this.auto.active && !this.manual) return false;
    if (this.auto.active) this.auto.resume(this.drone); else this.auto.launch();
    this.manual = false;
    return true;
  }

  /** Calls the drone home (desk and hybrid): the autopilot flies it back to the pad. */
  goHome() {
    if (!this.canPlan || this.mission.over || this.drone.crashed) return false;
    if (!this.auto.active) this.auto.launch();
    this.auto.goHome(this.drone);
    this.manual = false;
    return true;
  }

  // ---------- the sticks ----------

  /** The player takes the sticks (hybrid). The autopilot waits. */
  takeControl() {
    if (this.mode !== 'hybrid' || this.mission.over || this.drone.crashed) return false;
    this.manual = true;
    return true;
  }

  /** The player hands the sticks back (hybrid): the autopilot goes on with the route, or comes home. */
  handBack() {
    if (this.mode !== 'hybrid' || !this.manual) return false;
    this.manual = false;
    if (this.auto.active) this.auto.resume(this.drone);
    else if (this.auto.route.length > 0) this.auto.launch();
    else if (!this.drone.landed) { this.auto.launch(); this.auto.goHome(this.drone); }
    return true;
  }

  /** The camera's button, pressed by the pilot. */
  primary(a) {
    if (!this.manual) return false;
    const done = this.mission.primary(this.drone, a, this.thermal);
    if (done && this.mission instanceof ReliefFlights) this.auto.droppedByHand(this.drone.x, this.drone.z);
    return done;
  }

  /** Lets one package go, by the pilot's hand. */
  release() {
    if (!this.manual) return null;
    const p = this.mission.release(this.drone);
    if (p) this.auto.droppedByHand(this.drone.x, this.drone.z);
    return p;
  }

  // ---------- time ----------

  /** One step of SPEC.dt seconds. */
  step(sticks) {
    const m = this.mission, d = this.drone;
    if (m.over) return;
    const auto = !this.manual && this.auto.active;
    const level = m.weather.level(m.time);
    const input = { ...(this.manual ? sticks : this.auto.step(d, m.town, level)) };
    // a battery almost empty: the drone starts down by itself; the pilot can still steer it to a dry spot
    if (this.manual && !d.landed && d.battery < SPEC.criticalBattery) input.up = Math.min(input.up, -0.6);
    const high = d.aboveGround;
    const [wx, wz] = m.weather.windAt(m.time, high);
    const [sx, sz] = m.weather.steadyAt(m.time, high);
    stepDrone(d, input, m.town, wx, wz, sx, sz, level);
    if (auto && this.auto.releaseNow) m.release(d);
    m.tick(d, auto);
    if (d.crashed && (this.auto.active || this.auto.route.length > 0)) { this.auto.abort(); this.auto.route.length = 0; }
    // home again: the route is flown, the map is free for the next one
    if (this.auto.phase === 'done') { this.auto.abort(); this.auto.route.length = 0; }
  }

  /** Lets this many seconds pass, in whole steps. Returns how many steps were made. */
  advance(seconds, sticks) {
    this.accum += seconds;
    let n = 0;
    while (this.accum >= SPEC.dt && n < 25) { this.step(sticks); this.accum -= SPEC.dt; n++; }
    if (this.accum > SPEC.dt * 5) this.accum = 0; // a long hitch: do not try to catch up
    return n;
  }

  result() { return this.mission.result(this.drone); }
}

/** The player's record: each mission's best result, kept on the phone. */
export class Operation {
  constructor() { this.best = {}; this.flown = 0; }
  record(mission, mode, r) {
    this.flown++;
    const old = this.best[mission];
    if (old && old.score >= r.score) return false;
    this.best[mission] = { stars: r.stars, score: r.score, mode };
    return true;
  }
  stars(mission) { return this.best[mission] ? this.best[mission].stars : -1; }
  get totalStars() { return Object.values(this.best).reduce((n, r) => n + r.stars, 0); }
  /** True once the three uses of drones (BANTAY, SAGIP, HATID) have each been flown. */
  get allFlown() { return ['bantay', 'sagip', 'hatid'].every((id) => this.best[id]); }
  toJSON() { return { best: this.best, flown: this.flown }; }
  static from(o) { const op = new Operation(); if (o && o.best) { op.best = o.best; op.flown = o.flown || 0; } return op; }
}

export { MISSION_IDS, ground };
