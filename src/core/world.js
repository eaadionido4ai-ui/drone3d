// The barangay as the rules see it: the ground, what stands on it, the missions' weather, and what each mission
// looks for. These are DRONE VR's lists (DroneVR.Core, TownPlan.g.cs), made the same way from the same plan,
// with numbers rounded the same way, so the two games fly in the same barangay.
//
// Coordinates: metres, x to the east, z to the south, y up; the middle of the barangay is (0, 0) and the river's
// normal level is y = 0. A heading is in degrees: 0 faces north (-z), 90 faces east (+x).
import * as P from './plan.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export const ground = P.ground;
export const X0 = P.WORLD.x0, X1 = P.WORLD.x1, Z0 = P.WORLD.z0, Z1 = P.WORLD.z1;
export const inside = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
/** How deep the water is at a point when the flood stands at this level (0 where the ground is dry). */
export const depth = (x, z, level) => Math.max(0, level - ground(x, z));

export const DEG = Math.PI / 180;
export const Compass = {
  wrap(d) { d %= 360; return d < 0 ? d + 360 : d; },
  /** The smallest turn from one heading to another, from -180 to 180 (positive to the right). */
  turn(from, to) { const d = Compass.wrap(to - from); return d > 180 ? d - 360 : d; },
  /** The heading that goes from one point towards another. */
  towards(x0, z0, x1, z1) { return Compass.wrap(Math.atan2(x1 - x0, -(z1 - z0)) / DEG); },
  forwardX: (h) => Math.sin(h * DEG),
  forwardZ: (h) => -Math.cos(h * DEG),
  rightX: (h) => Math.cos(h * DEG),
  rightZ: (h) => Math.sin(h * DEG),
  /** N, NE, E... for a heading. */
  point(h) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(Compass.wrap(h + 22.5) / 45) % 8]; },
};

export const dist3 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
export const flat = (ax, az, bx, bz) => Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);

// ---------- what stands in the barangay ----------

class Building {
  constructor(id, kind, x, z, w, d, h, roof, roofH, base, set) {
    Object.assign(this, { id, kind, x: r3(x), z: r3(z), w: r3(w), d: r3(d), h: r3(h), roof, roofH: r3(roofH), base: r3(base), set });
  }
  /** The height of its highest point: the ridge, or the flat roof. */
  get top() { return this.base + this.h + this.roofH; }
  covers(x, z, m) { return Math.abs(x - this.x) <= this.w / 2 + m && Math.abs(z - this.z) <= this.d / 2 + m; }
}

export const BUILDINGS = P.BUILDINGS.map((b) => new Building(b.id, b.kind, b.x, b.z, b.w, b.d, b.h, b.roof, b.roofH, b.base, b.set))
  .concat(P.RUBBLE.map((q) => new Building(q.id, 'rubble', q.x, q.z, q.w, q.d, q.h, 'flat', 0, q.base, 'quake')));

const B = P.BRIDGE;
/** Flat pieces in the air: the deck of the bridge (its middle falls in the typhoon). */
export const SLABS = [
  { id: 'bridge_north', x0: B.x - B.w / 2, x1: B.x + B.w / 2, z0: B.z0, z1: B.spanZ0, y0: r3(B.deck - B.thick), y1: B.deck, set: null },
  { id: 'bridge_span', x0: B.x - B.w / 2, x1: B.x + B.w / 2, z0: B.spanZ0, z1: B.spanZ1, y0: r3(B.deck - B.thick), y1: B.deck, set: 'bridge_ok' },
  { id: 'bridge_south', x0: B.x - B.w / 2, x1: B.x + B.w / 2, z0: B.spanZ1, z1: B.z1, y0: r3(B.deck - B.thick), y1: B.deck, set: null },
];
export const TOWERS = P.TOWERS.map((t) => ({ id: t.id, x: t.x, z: t.z, r: t.r, h: t.h }));
export const TREES = P.TREES.map((t) => ({ x: r3(t.x), z: r3(t.z), h: r3(t.h), r: r3(t.r), palm: t.kind === 'palm' }));
export const POLES = P.POLES.map((p) => ({ x: p.x, z: p.z, h: p.h }));

export const PAD_X = P.PAD.x, PAD_Z = P.PAD.z, PAD_SIZE = P.PAD.size;
/** The top of the pad the drones take off from. */
export const PAD_Y = ground(PAD_X, PAD_Z) + 0.2;
export const onPad = (x, z) => Math.abs(x - PAD_X) <= PAD_SIZE / 2 && Math.abs(z - PAD_Z) <= PAD_SIZE / 2;

// ---------- the missions and what they look for ----------

export const MISSIONS = P.MISSIONS.map((m) => ({
  id: m.id, sets: m.sets, wind: m.wind, gust: m.gust, windFrom: m.windFrom,
  floodMinutes: m.flood.map((f) => f[0]), floodLevels: m.flood.map((f) => f[1]), minutes: m.minutes,
}));
export const missionPlan = (id) => { const m = MISSIONS.find((q) => q.id === id); if (!m) throw new Error('no mission ' + id); return m; };

const above = (o) => () => ({ x: o.x, y: ground(o.x, o.z) + o.y, z: o.z });
export const GATES = P.GATES.map((g) => { const o = { x: g.x, z: g.z, y: g.y, r: g.r }; o.center = above(o); return o; });
export const HAZARDS = P.HAZARDS.map((h) => {
  const o = { id: h.id, x: r3(h.x), z: r3(h.z), y: h.y, near: h.near, reportX: r3(h.x + h.report[0]), reportZ: r3(h.z + h.report[1]) };
  o.point = above(o); return o;
});
export const SURVIVORS = P.SURVIVORS.map((s) => {
  const o = { id: s.id, where: s.where, x: r3(s.x), z: r3(s.z), y: r3(s.y), people: s.people, hidden: s.hidden, limitMinutes: s.limit, ring: s.ring };
  o.point = above(o); return o;
});
export const SITES = P.SITES.map((s) => { const o = { id: s.id, x: r3(s.x), z: r3(s.z), y: r3(s.y), r: s.r, needs: s.needs }; o.point = above(o); return o; });
export const SUPPLIES = P.SUPPLIES.map((s) => ({ id: s.id, kg: s.kg, color: s.color }));
export const supply = (id) => { const s = SUPPLIES.find((q) => q.id === id); if (!s) throw new Error('no supply ' + id); return s; };
/** Where the rescue boats wait, and where they bring people. */
export const STAGING = P.STAGING.map((s) => [s.x, s.z]);
