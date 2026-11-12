// The 3D world of DRONE 3D, drawn with three.js: the barangay (baked into a few meshes), the sky and the water
// of each mission, what the mission is about (the rings, the reported hazards, the people waiting, the places
// that asked for supplies), the rescue boats, the falling packages, the drone itself, and the route drawn on
// the map. The game (app.js) moves the camera; this module keeps everything else in step with the rules.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import * as P from '../core/plan.js';
import { ground, DEG, Compass, X0, X1, Z0, Z1, GATES, HAZARDS, SURVIVORS, SITES, PAD_X, PAD_Y, PAD_Z, missionPlan } from '../core/world.js';
import { SPEC, Weather } from '../core/rules.js';
import { AUTO } from '../core/autopilot.js';
import { FlightSchool, HazardPatrol, SearchRescue, ReliefFlights, SEARCH } from '../core/missions.js';
import { buildTown } from './town.js';
import { bake, bakedMaterial } from './bake.js';
import { buildProps, copy, PEOPLE } from './props.js';

/** Each mission's sky, light and water (DRONE VR's MissionScene). */
export const LOOKS = {
  lipad: { sky: 0xa9cfe8, top: 0x5d9ad6, near: 160, far: 900, water: 0x3f7fb5, sun: 2.4, hemi: 1.45 },
  bantay: { sky: 0xc9bfa8, top: 0x8a9db0, near: 90, far: 600, water: 0x4d7896, sun: 1.9, hemi: 1.35 },
  sagip: { sky: 0x8e9aa3, top: 0x5c6870, near: 60, far: 480, water: 0x857152, sun: 0.9, hemi: 1.55, rain: true },
  hatid: { sky: 0xa3b4c2, top: 0x6c88a3, near: 160, far: 900, water: 0x7f7258, sun: 1.8, hemi: 1.4 },
};
const THERMAL = { sky: 0x1a1e25, top: 0x0e1116, near: 30, far: 260, sun: 1.2, hemi: 1.1 };
const COLD = new THREE.Color().setRGB(0.3, 0.34, 0.42, THREE.SRGBColorSpace);
const HOT = new THREE.Color().setRGB(1, 0.93, 0.62, THREE.SRGBColorSpace);

const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
const STICK = new THREE.CylinderGeometry(0.18, 0.18, 1, 6).translate(0, 0.5, 0);
const HEAD = new THREE.OctahedronGeometry(1, 0);
const KIND_COLOR = { fly: 0xffffff, hover: 0xffd23f, drop: 0xff7a1a };
/** Where the map first looks in each mission: the middle of what matters, and how far away. */
const MAP_START = { lipad: [-112, -118, 170], bantay: [-20, -25, 330], sagip: [10, 30, 320], hatid: [60, 5, 330] };

const glass = (color, opacity = 0.22) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.12, 2600);
    this.camera.rotation.order = 'YXZ';
    this.hemi = new THREE.HemisphereLight(0xeef5ff, 0x5b5040, 1.45);
    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.4);
    this.sun.position.set(-45, 100, 30);
    scene.add(this.hemi, this.sun);
    scene.fog = new THREE.Fog(0xa9cfe8, 160, 900);
    this.sky = this.makeSky(); scene.add(this.sky);
    this.glow = glowTexture();

    // ---- the barangay, baked: a dozen meshes, and the painted signs ----
    const { root } = buildTown(THREE);
    const { meshes, signs } = bake(root);
    this.town = new THREE.Group(); scene.add(this.town);
    this.townMeshes = []; this.sets = new Map(); this.pickable = []; this.signs = signs;
    for (const [name, m] of meshes) {
      this.town.add(m); this.townMeshes.push(m);
      if (name.startsWith('SET:')) this.sets.set(name.slice(4), m);
      if (name !== 'far') this.pickable.push(m);
    }
    for (const s of signs) this.town.add(s);
    this.coldMat = new THREE.MeshLambertMaterial({ color: COLD, flatShading: true });
    this.hotMat = new THREE.MeshBasicMaterial({ color: HOT });

    // ---- the river, and the flood ----
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x3f7fb5, transparent: true, opacity: 0.86 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800).rotateX(-Math.PI / 2), this.waterMat);
    scene.add(this.water);

    // ---- the drone: its body, four propellers, what hangs on its hooks, and its shadow ----
    this.props = buildProps();
    for (const g of Object.values(this.props.supply)) g.computeBoundingBox();
    this.drone = new THREE.Group();
    this.tilt = new THREE.Group(); this.drone.add(this.tilt);
    const body = copy(this.props.drone); body.position.y = -SPEC.gear; this.tilt.add(body);
    this.rotors = this.props.rotors.map((p) => {
      const m = copy(this.props.propeller); m.position.set(p.x, p.y - SPEC.gear, p.z); this.tilt.add(m); return m;
    });
    this.hanging = new THREE.Group(); this.tilt.add(this.hanging); this.hangingKey = '';
    scene.add(this.drone);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    scene.add(this.shadow);
    this.tiltF = 0; this.tiltR = 0; this.lastV = { x: 0, z: 0 };

    // ---- the route on the map ----
    this.routeGroup = new THREE.Group(); scene.add(this.routeGroup);
    this.lineMat = new LineMaterial({ color: 0xffffff, linewidth: 3.5, worldUnits: false, depthTest: false, transparent: true, opacity: 0.95 });
    this.routeLine = null; this.routeKey = '';

    // ---- rain, for the typhoon's flood ----
    this.rain = this.makeRain(); scene.add(this.rain);

    // ---- what each mission adds: built by start() ----
    this.stage = new THREE.Group(); scene.add(this.stage);
    this.flight = null; this.thermal = false; this.lookId = 'lipad'; this.time = 0;
    this.ray = new THREE.Raycaster();
    this.controls = new MapControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minDistance: 25, maxDistance: 520, maxPolarAngle: 1.22, zoomSpeed: 1.1 });
    this.controls.enabled = false;
    this.mapView = null;
    this.look('lipad');
  }

  // ---------- the sky ----------

  makeSky() {
    const g = new THREE.SphereGeometry(2000, 24, 12);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
  }

  paintSky(horizon, top) {
    const g = this.sky.geometry, p = g.attributes.position, c = g.attributes.color;
    const h = new THREE.Color(horizon), t = new THREE.Color(top), k = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 2000;
      k.copy(h).lerp(t, clamp(y * 1.7, 0, 1));
      c.setXYZ(i, k.r, k.g, k.b);
    }
    c.needsUpdate = true;
    this.scene.background = h;
  }

  makeRain() {
    const n = 900, pos = new Float32Array(n * 6);
    this.drops = [];
    for (let i = 0; i < n; i++) this.drops.push([Math.random() * 60 - 30, Math.random() * 40 - 12, Math.random() * 60 - 30, 14 + Math.random() * 6]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d3dc, transparent: true, opacity: 0.45 }));
    lines.frustumCulled = false; lines.visible = false;
    return lines;
  }

  // ---------- a mission's scene ----------

  /** Dresses the barangay for a mission: its sets, its sky, its water. */
  look(id) {
    const plan = missionPlan(id);
    for (const [name, m] of this.sets) m.visible = plan.sets.includes(name);
    this.lookId = id;
    this.water.position.y = Weather.levelOf(plan, 0);
    this.rain.visible = !!LOOKS[id].rain;
    this.applyLook();
  }

  /** The map is looked at from high up: its haze starts farther away. */
  setMapHaze(map) {
    if (this.mapHaze === map) return;
    this.mapHaze = map;
    this.applyLook();
  }

  applyLook() {
    const thermal = this.thermal, L = thermal ? THERMAL : LOOKS[this.lookId];
    this.scene.fog.color.setHex(L.sky);
    this.scene.fog.near = this.mapHaze ? Math.max(L.near, 380) : L.near; this.scene.fog.far = this.mapHaze ? Math.max(L.far, 1500) : L.far;
    this.paintSky(L.sky, L.top);
    this.hemi.intensity = L.hemi; this.sun.intensity = L.sun;
    this.waterMat.color.setHex(thermal ? 0x10151c : LOOKS[this.lookId].water);
    for (const m of this.townMeshes) m.material = thermal ? this.coldMat : bakedMaterial;
    for (const s of this.signs) s.visible = !thermal;
    this.rain.visible = !thermal && !!LOOKS[this.lookId].rain;
    if (this.people) for (const g of this.people) for (const m of g.children) m.material = thermal ? this.hotMat : bakedMaterial;
    if (this.boats) for (const b of this.boats) b.material = thermal ? this.coldMat : bakedMaterial;
  }

  setThermal(on) {
    if (this.thermal === on) return;
    this.thermal = on;
    this.applyLook();
  }

  clearStage() {
    for (const o of [...this.stage.children]) {
      this.stage.remove(o);
      o.traverse((q) => { if (q.material && q.material !== bakedMaterial && q.material !== this.hotMat && q.material !== this.coldMat) q.material.dispose?.(); });
    }
    this.gates = this.reports = this.people = this.beacons = this.heat = this.boats = this.sites = null;
    this.packages = new Map();
    this.clearRoute();
  }

  /** Shows the barangay with nothing going on (the title and the board). */
  idle(id = 'lipad') {
    this.flight = null; this.mapHaze = false; this.controls.enabled = false; this.setThermal(false); this.look(id); this.clearStage();
    this.drone.visible = true; this.shadow.visible = true;
    this.drone.position.set(PAD_X, PAD_Y + SPEC.gear, PAD_Z); this.drone.rotation.y = -90 * DEG;
    this.tilt.rotation.set(0, 0, 0); this.setHanging([]);
  }

  /** Builds what a mission is about. */
  start(flight) {
    this.flight = flight;
    const m = flight.mission;
    this.setThermal(false);
    this.look(m.id);
    this.clearStage();
    if (m instanceof FlightSchool) this.buildGates();
    else if (m instanceof HazardPatrol) this.buildReports();
    else if (m instanceof SearchRescue) { this.buildPeople(); this.buildBoats(m.fleet); }
    else if (m instanceof ReliefFlights) this.buildSites();
    this.mapView = null;
    this.applyLook();
  }

  buildGates() {
    this.gateMats = {
      next: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xff8a2a, emissive: 0x5a2400, flatShading: true }),
      done: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x45c86a, flatShading: true }),
      later: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff, flatShading: true }),
    };
    this.gates = GATES.map((g, i) => {
      const from = i ? GATES[i - 1] : { x: PAD_X, z: PAD_Z };
      const m = new THREE.Mesh(this.props.gate, this.gateMats.later);
      const c = g.center();
      m.position.set(c.x, c.y, c.z); m.rotation.y = Math.atan2(g.x - from.x, g.z - from.z);
      this.stage.add(m);
      return m;
    });
  }

  buildReports() {
    this.reportMats = [glass(0xff7a1a, 0.2), glass(0xffc53d, 0.24), glass(0x45c86a, 0.3)];
    this.reports = HAZARDS.map((h) => {
      const m = new THREE.Mesh(COLUMN, this.reportMats[0]);
      m.renderOrder = 2; this.stage.add(m);
      m.userData.h = h;
      return m;
    });
  }

  buildPeople() {
    this.people = []; this.beacons = []; this.heat = [];
    this.beaconMats = { found: glass(0x3fd0ff, 0.28), ring: glass(0xff7a1a, 0.32), aboard: glass(0x45c86a, 0.22) };
    const standing = PEOPLE.filter((p) => !p[4]).map((p) => p[0]);
    SURVIVORS.forEach((s, i) => {
      const plan = P.SURVIVORS.find((q) => q.id === s.id), on = plan.on ? P.BUILDINGS.find((b) => b.id === plan.on) : null;
      const g = new THREE.Group();
      const p = s.point();
      g.position.set(p.x, p.y - 0.05, p.z);
      const sit = s.where === 'raft' || s.where === 'bleachers' || s.where === 'jeepney';
      const ridgeX = on && on.roof === 'gable' ? on.w >= on.d : null;
      for (let k = 0; k < s.people; k++) {
        const name = sit && k % 2 === 0 ? 'person_sit' : standing[(i + k) % standing.length];
        const m = copy(this.props.person[name]);
        const o = (k - (s.people - 1) / 2) * 0.75;
        if (ridgeX === true) m.position.set(o, 0, 0);
        else if (ridgeX === false) m.position.set(0, 0, o);
        else { const a = k / s.people * Math.PI * 2; m.position.set(s.people > 1 ? Math.cos(a) * 0.6 : 0, 0, s.people > 1 ? Math.sin(a) * 0.6 : 0); }
        m.userData.phase = i * 1.7 + k;
        g.add(m);
      }
      this.stage.add(g); this.people.push(g);
      const b = new THREE.Mesh(COLUMN, this.beaconMats.found);
      b.position.set(p.x, p.y, p.z); b.scale.set(1.4, 70, 1.4); b.visible = false; b.renderOrder = 2;
      this.stage.add(b); this.beacons.push(b);
      const heat = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: HOT, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
      heat.position.set(p.x, p.y + 0.8, p.z); heat.scale.set(3.2, 3.2, 1); heat.visible = false; heat.renderOrder = 5;
      this.stage.add(heat); this.heat.push(heat);
    });
  }

  buildBoats(fleet) {
    this.boats = fleet.boats.map(() => { const m = copy(this.props.boat); this.stage.add(m); return m; });
  }

  buildSites() {
    this.siteMats = [glass(0xff7a1a, 0.22), glass(0xffc53d, 0.24), glass(0x45c86a, 0.22)];
    this.sites = SITES.map((s) => {
      const m = new THREE.Mesh(COLUMN, this.siteMats[0]);
      const p = s.point();
      m.position.set(s.x, p.y, s.z); m.scale.set(s.r, 45, s.r); m.renderOrder = 2;
      this.stage.add(m);
      return m;
    });
  }

  // ---------- the route, on the map ----------

  clearRoute() {
    for (const o of [...this.routeGroup.children]) { this.routeGroup.remove(o); if (o.material && o.material !== this.lineMat) o.material.dispose(); if (o.geometry && o.geometry !== STICK && o.geometry !== HEAD) o.geometry.dispose(); }
    this.routeLine = null; this.routeKey = ''; this.heads = [];
  }

  /** Draws the waypoints still to fly and the line the autopilot will follow, home to the pad at the end. */
  drawRoute(flight) {
    const ahead = flight.ahead(), d = flight.drone, flying = flight.auto.active && !flight.manual;
    const key = ahead.map((w) => `${w.x.toFixed(1)},${w.z.toFixed(1)},${w.alt},${w.kind}`).join(';') + (flying ? `|${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.z)}` : '|pad');
    if (key === this.routeKey) return;
    this.clearRoute();
    this.routeKey = key;
    if (!ahead.length) return;
    const pts = [];
    if (flying) pts.push(d.x, d.y, d.z); else pts.push(PAD_X, PAD_Y + 0.5, PAD_Z, PAD_X, PAD_Y + Math.max(AUTO.minClimb, ahead[0].alt), PAD_Z);
    this.heads = [];
    for (const w of ahead) {
      const y = w.y, g = ground(w.x, w.z);
      pts.push(w.x, y, w.z);
      if (w.kind === 'drop') pts.push(w.x, g + AUTO.dropHeight + (w.y - g - w.alt), w.z, w.x, y, w.z);
      const mat = new THREE.MeshBasicMaterial({ color: KIND_COLOR[w.kind], depthTest: false, transparent: true });
      const stick = new THREE.Mesh(STICK, mat); stick.position.set(w.x, g, w.z); stick.scale.set(1, Math.max(0.1, y - g), 1); stick.renderOrder = 9;
      const head = new THREE.Mesh(HEAD, mat); head.position.set(w.x, y, w.z); head.renderOrder = 9;
      this.routeGroup.add(stick, head); this.heads.push(head);
    }
    const last = ahead[ahead.length - 1];
    pts.push(PAD_X, Math.max(PAD_Y + AUTO.returnAlt, last.y), PAD_Z, PAD_X, PAD_Y + 0.5, PAD_Z);
    const geo = new LineGeometry(); geo.setPositions(pts);
    this.routeLine = new Line2(geo, this.lineMat); this.routeLine.renderOrder = 8;
    this.routeGroup.add(this.routeLine);
  }

  // ---------- each frame ----------

  /**
   * Keeps the scene in step with the flight. view: 'map', 'fpv' or 'chase'; sticks: what the pilot holds
   * (for the drone's lean); dt: seconds since the last frame.
   */
  update(dt, view) {
    this.time += dt;
    const f = this.flight;
    if (!f) return;
    const m = f.mission, d = f.drone, t = m.time;
    const level = m.weather.level(t);
    this.water.position.y = level;

    // the drone
    const fpv = view === 'fpv';
    this.drone.visible = !fpv;
    this.drone.position.set(d.x, d.y, d.z);
    this.drone.rotation.y = -d.heading * DEG;
    const ax = (d.vx - this.lastV.x) / Math.max(dt, 1e-3), az = (d.vz - this.lastV.z) / Math.max(dt, 1e-3);
    this.lastV.x = d.vx; this.lastV.z = d.vz;
    const lx = clamp(ax / 9.81 * 0.8 + d.airVx * 0.03, -0.45, 0.45), lz = clamp(az / 9.81 * 0.8 + d.airVz * 0.03, -0.45, 0.45);
    const fw = lx * Compass.forwardX(d.heading) + lz * Compass.forwardZ(d.heading), rt = lx * Compass.rightX(d.heading) + lz * Compass.rightZ(d.heading);
    const k = ease(dt, 6);
    this.tiltF += ((d.landed ? 0 : fw) - this.tiltF) * k; this.tiltR += ((d.landed ? 0 : rt) - this.tiltR) * k;
    if (d.crashed) this.tilt.rotation.set(0.2, 0, 1.1);
    else this.tilt.rotation.set(-this.tiltF, 0, -this.tiltR);
    const spin = d.crashed || d.landed ? 0 : 70 + 25 * Math.abs(d.vy);
    this.rotors.forEach((r, i) => { r.rotation.y += (i % 2 ? 1 : -1) * spin * dt; });
    if (d.crashed && d.crash === 3) this.drone.position.y = Math.min(d.y, level - 0.6);
    this.setHanging(m.cargo.items);
    // in the map, the drone is drawn larger so it can be found
    const zoom = view === 'map' ? clamp(this.camera.position.distanceTo(this.drone.position) / 40, 1, 9) : 1;
    this.drone.scale.setScalar(zoom);

    // its shadow, on what is under it
    const under = Math.max(m.town.surfaceBelow(d.x, d.y, d.z), level);
    const high = d.y - under;
    this.shadow.visible = !d.crashed && high < 60;
    this.shadow.position.set(d.x, under + 0.05, d.z);
    this.shadow.scale.setScalar((1 + high * 0.02) * zoom);
    this.shadow.material.opacity = 0.38 * clamp(1 - high / 60, 0, 1);

    this.updateStage(dt, m, d, level);
    this.updatePackages(dt, m, level);
    this.routeGroup.visible = view === 'map';
    if (view === 'map') {
      this.drawRoute(f);
      const s = clamp(this.camera.position.distanceTo(this.controls.target) / 90, 0.6, 5);
      for (const h of this.heads) h.scale.setScalar(s);
    }
    this.updateRain(dt, m);
  }

  /** The supplies hanging under the drone: rebuilt when what is on the hooks changes. */
  setHanging(items) {
    const key = items.join(',');
    if (key === this.hangingKey) return;
    this.hangingKey = key;
    for (const o of [...this.hanging.children]) this.hanging.remove(o);
    items.forEach((id, i) => {
      const g = this.props.supply[id], top = g.boundingBox.max.y;
      const s = copy(g); s.scale.setScalar(0.85);
      s.position.set((i - (items.length - 1) / 2) * 0.24, this.props.hook.y - SPEC.gear - top * 0.85 - 0.05, this.props.hook.z);
      this.hanging.add(s);
    });
  }

  updateStage(dt, m, d, level) {
    const t = this.time;
    if (this.gates) this.gates.forEach((g, i) => { g.material = i < m.passed ? this.gateMats.done : i === m.passed ? this.gateMats.next : this.gateMats.later; });
    if (this.reports) this.reports.forEach((r, i) => {
      const h = r.userData.h, s = m.stateOf(i);
      if (s === 2) { r.position.set(h.x, ground(h.x, h.z), h.z); r.scale.set(2.2, 40, 2.2); }
      else { r.position.set(h.reportX, ground(h.reportX, h.reportZ), h.reportZ); r.scale.set(7, 40, 7); }
      r.material = this.reportMats[s];
    });
    if (this.sites) this.sites.forEach((s, i) => { s.material = this.siteMats[m.stateOf(i)]; });
    if (this.people) {
      SURVIVORS.forEach((s, i) => {
        const g = this.people[i], aboard = m.aboard(i);
        g.visible = !aboard;
        const near = Math.hypot(d.x - s.x, d.z - s.z) < 90;
        for (const p of g.children) {
          // the people turn to the drone when it comes, and jump to be seen until they are marked
          if (near) {
            const want = -Compass.towards(g.position.x + p.position.x, g.position.z + p.position.z, d.x, d.z) * DEG;
            p.rotation.y += Math.atan2(Math.sin(want - p.rotation.y), Math.cos(want - p.rotation.y)) * ease(dt, 3);
          }
          p.position.y = near && !m.found(i) ? Math.max(0, Math.sin(t * 7 + p.userData.phase)) * 0.12 : 0;
        }
        const b = this.beacons[i];
        b.visible = m.found(i);
        b.material = aboard ? this.beaconMats.aboard : m.needsRing(i) ? this.beaconMats.ring : this.beaconMats.found;
        const hp = this.heat[i], dist = Math.hypot(d.x - s.x, d.y - s.point().y, d.z - s.z);
        hp.visible = this.thermal && !aboard && dist < SEARCH.thermalRange * 1.6;
        if (hp.visible) hp.material.opacity = clamp(1.6 - dist / SEARCH.thermalRange, 0.15, 1) * (0.75 + 0.25 * Math.sin(t * 5 + i));
      });
    }
    if (this.boats) m.fleet.boats.forEach((b, i) => {
      const o = this.boats[i];
      o.position.set(b.x, Math.max(level, ground(b.x, b.z)) + 0.02 + Math.sin(t * 1.7 + i) * 0.05, b.z);
      o.rotation.set(0, -b.heading * DEG, Math.sin(t * 1.3 + i * 2) * 0.04);
    });
  }

  updatePackages(dt, m, level) {
    for (const p of m.packages) {
      let o = this.packages.get(p);
      if (!o) {
        o = copy(this.props.supply[p.item]); o.userData.spin = (Math.random() - 0.5) * 4; o.userData.sink = 0;
        this.stage.add(o); this.packages.set(p, o);
      }
      o.position.set(p.x, p.y, p.z);
      if (p.falling) { o.rotation.y += o.userData.spin * dt; o.rotation.x = Math.sin(this.time * 3) * 0.2; }
      else {
        o.rotation.x = 0;
        if (p.fate === 'sunk') { o.userData.sink += dt; o.position.y = Math.min(p.y, level) - o.userData.sink * 0.4; o.visible = o.userData.sink < 4; }
        if (p.fate === 'broken') o.rotation.z = 1.2;
      }
    }
  }

  updateRain(dt, m) {
    if (!this.rain.visible) return;
    const pos = this.rain.geometry.attributes.position.array, c = this.camera.position;
    const [wx, wz] = m.weather.windAt(m.time, 20);
    for (let i = 0; i < this.drops.length; i++) {
      const q = this.drops[i];
      q[1] -= q[3] * dt; q[0] += wx * dt * 0.6; q[2] += wz * dt * 0.6;
      if (q[1] < -12) { q[1] += 40; q[0] = Math.random() * 60 - 30; q[2] = Math.random() * 60 - 30; }
      if (q[0] < -30) q[0] += 60; else if (q[0] > 30) q[0] -= 60;
      if (q[2] < -30) q[2] += 60; else if (q[2] > 30) q[2] -= 60;
      const x = c.x + q[0], y = c.y + q[1], z = c.z + q[2], s = 0.045;
      pos.set([x, y, z, x - wx * s, y + q[3] * s, z - wz * s], i * 6);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- the cameras ----------

  /** Where the drone's camera is, and the way it looks: its heading, tilted by the gimbal (degrees, down < 0). */
  droneCamera(d, gimbal) {
    // the camera sits under the nose: -c.z metres ahead of the middle of the drone
    const c = this.props.cam, h = d.heading;
    const from = { x: d.x - Compass.forwardX(h) * c.z, y: d.y + c.y - SPEC.gear, z: d.z - Compass.forwardZ(h) * c.z };
    const cp = Math.cos(gimbal * DEG);
    const dir = { x: Compass.forwardX(h) * cp, y: Math.sin(gimbal * DEG), z: Compass.forwardZ(h) * cp };
    return { from, dir };
  }

  /** The camera looks through the drone's camera. */
  viewFpv(d, gimbal) {
    const a = this.droneCamera(d, gimbal);
    this.camera.position.set(a.from.x, a.from.y, a.from.z);
    this.camera.rotation.set(gimbal * DEG, -d.heading * DEG, 0);
    this.chase = null;
  }

  /** The camera follows the drone from behind and above, looking where the drone's camera looks. */
  viewChase(d, gimbal, dt) {
    const pitch = clamp(gimbal * 0.75 - 12, -80, 5);
    let c = this.chase;
    if (!c) c = this.chase = { heading: d.heading, pitch, x: d.x, y: d.y, z: d.z };
    const k = ease(dt, 4.5);
    c.heading = Compass.wrap(c.heading + Compass.turn(c.heading, d.heading) * k);
    c.pitch += (pitch - c.pitch) * k;
    c.x += (d.x - c.x) * ease(dt, 10); c.y += (d.y - c.y) * ease(dt, 10); c.z += (d.z - c.z) * ease(dt, 10);
    const dist = 6.5, cp = Math.cos(c.pitch * DEG);
    let x = c.x - Compass.forwardX(c.heading) * cp * dist, y = c.y - Math.sin(c.pitch * DEG) * dist + 0.9, z = c.z - Compass.forwardZ(c.heading) * cp * dist;
    if (this.flight) y = Math.max(y, Math.max(this.flight.mission.town.surfaceBelow(x, y + 50, z), this.water.position.y) + 0.6);
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(c.pitch * DEG, -c.heading * DEG, 0);
  }

  /** The slow turn around the barangay behind the title and the menus. */
  viewOrbit(t) {
    const a = t * 0.035 + 2.2, r = 250;
    this.camera.position.set(Math.cos(a) * r - 20, 95, Math.sin(a) * r - 10);
    this.camera.lookAt(-20, 4, -10);
    this.chase = null;
  }

  /** Starts the map: from where it was left, or above the pad looking over the barangay. */
  enterMap() {
    const c = this.controls;
    if (this.mapView) { this.camera.position.copy(this.mapView.pos); c.target.copy(this.mapView.target); }
    else {
      // the first look takes in where the mission happens
      const [x, z, far] = MAP_START[this.lookId] || [PAD_X + 70, PAD_Z + 25, 220];
      c.target.set(x, 0, z);
      this.camera.position.set(x, far * 0.78, z + far * 0.62);
    }
    c.enabled = true; c.update();
    this.chase = null;
    this.setMapHaze(true);
  }

  leaveMap() {
    const c = this.controls;
    this.mapView = { pos: this.camera.position.clone(), target: c.target.clone() };
    c.enabled = false;
    this.setMapHaze(false);
  }

  updateMap() {
    const c = this.controls;
    c.update();
    // keep the map over the barangay
    const tx = clamp(c.target.x, X0, X1), tz = clamp(c.target.z, Z0, Z1);
    if (tx !== c.target.x || tz !== c.target.z) { this.camera.position.x += tx - c.target.x; this.camera.position.z += tz - c.target.z; c.target.x = tx; c.target.z = tz; }
  }

  // ---------- helpers for the screen ----------

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w >= h ? 55 : 72;
    this.camera.updateProjectionMatrix();
    this.lineMat.resolution.set(w, h);
    this.width = w; this.height = h;
  }

  /** The point of the barangay under a point of the screen, or null. */
  pick(px, py) {
    const ndc = new THREE.Vector2(px / this.width * 2 - 1, -py / this.height * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const objs = this.pickable.filter((m) => m.visible);
    objs.push(this.water);
    const hit = this.ray.intersectObjects(objs, false)[0];
    return hit ? hit.point : null;
  }

  /** Where a point of the world is on the screen: { x, y } in pixels, or null when it is behind the camera. */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
  }

  /** Where the drone's camera looks: the first point of the ground or the water along its line, or null. */
  aimPoint(d, gimbal) {
    const a = this.droneCamera(d, gimbal), level = this.water.position.y;
    let x = a.from.x, y = a.from.y, z = a.from.z;
    for (let s = 0; s < 240; s++) {
      const step = 0.5 + s * 0.05;
      x += a.dir.x * step; y += a.dir.y * step; z += a.dir.z * step;
      if (y <= Math.max(ground(x, z), level)) return { x, y, z };
    }
    return null;
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
