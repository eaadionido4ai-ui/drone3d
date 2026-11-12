// Checks of the four missions, flown the three ways: from the map (the autopilot), by a pilot (here a small
// program that works the sticks), and both. Also the rescue boats, the score and the texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ground, PAD_X, PAD_Y, PAD_Z, onPad, GATES, HAZARDS, SURVIVORS, SITES, STAGING } from '../src/core/world.js';
import { SPEC, NO_INPUT, input } from '../src/core/rules.js';
import { flyTowards } from '../src/core/autopilot.js';
import { Flight, Operation } from '../src/core/flight.js';
import { HazardPatrol, RescueFleet, aim, aimAt, PATROL } from '../src/core/missions.js';
import { STRINGS, has, say } from '../src/core/text.js';

const run = (f, seconds, until) => { const n = Math.round(seconds / SPEC.dt); for (let i = 0; i < n && !f.mission.over; i++) { f.step(NO_INPUT); if (until && until()) return; } };
const home = (f) => f.drone.landed && onPad(f.drone.x, f.drone.z);
/** Flies to a point and stops there, as a careful pilot does (climbing first). */
function goTo(f, x, y, z, within = 1.5, seconds = 120, speed = 12) {
  for (let i = 0; i < seconds / SPEC.dt && !f.mission.over && !f.drone.crashed; i++) {
    const d = f.drone, flatD = Math.hypot(x - d.x, z - d.z);
    if (flatD < within && Math.abs(y - d.y) < within && d.speed < 1.5) return true;
    const low = d.y < y - 3 && flatD > 8;
    f.step(flyTowards(d, low ? d.x : x, low ? d.z : z, y, speed, flatD > 6));
  }
  return false;
}
const comeDownOver = (f, x, y, z) => goTo(f, x, Math.max(y + 20, PAD_Y + 30), z, 1.5, 150) && goTo(f, x, y, z, 1.0, 60, 3);
const hold = (f, x, y, z, s) => { for (let i = 0; i < s / SPEC.dt && !f.mission.over; i++) f.step(flyTowards(f.drone, x, z, y, 3, false)); };

test('LIPAD from the map: the autopilot flies the rings and lands for three stars', () => {
  const f = new Flight('lipad', 'desk');
  for (const g of GATES) { const w = f.addWaypoint(g.x + 5, g.z - 6); assert.equal(w.x, g.x, 'a waypoint near a ring goes through its middle'); }
  assert.ok(f.estimate().battery < 0.5);
  assert.ok(f.launch());
  run(f, 300);
  assert.equal(f.mission.passed, GATES.length); assert.ok(f.mission.landedHome);
  const r = f.result();
  assert.equal(r.stars, 3); assert.equal(r.score, 100);
});

test('LIPAD by a pilot: the rings count in order, and only once the drone lands is it over', () => {
  const f = new Flight('lipad', 'pilot');
  assert.ok(f.manual);
  const second = GATES[1].center();
  assert.ok(goTo(f, second.x, second.y, second.z));
  assert.equal(f.mission.passed, 0, 'the second ring first does not count');
  for (const g of GATES) { const c = g.center(); assert.ok(goTo(f, c.x, c.y, c.z)); }
  assert.equal(f.mission.passed, 6); assert.equal(f.mission.finishedAt, null);
  assert.ok(goTo(f, PAD_X, PAD_Y + 12, PAD_Z, 1.2));
  for (let i = 0; i < 2000 && !f.drone.landed; i++) { const s = flyTowards(f.drone, PAD_X, PAD_Z, f.drone.y, 3, false); s.up = -0.5; f.step(s); }
  run(f, 0.1);
  assert.ok(f.mission.finishedAt != null); assert.ok(f.result().stars >= 2);
});

test('BANTAY: a sharp photograph is taken still, from 12 to 28 m, with the hazard in the middle; too close is a strike', () => {
  const f = new Flight('bantay', 'pilot');
  const h = HAZARDS.find((q) => q.id === 'slide');
  assert.ok(goTo(f, h.x - 16, h.point().y + 12, h.z));
  hold(f, h.x - 16, h.point().y + 12, h.z, 2);
  assert.equal(f.primary(aim(f.drone.position, { x: 0, y: 0, z: 1 })), false, 'looking away');
  assert.ok(f.primary(aimAt(f.drone, h.point())));
  const i = HAZARDS.indexOf(h);
  assert.ok(f.mission.quality[i] > 0.9, 'a clear photograph: ' + f.mission.quality[i]);
  const g = new Flight('bantay', 'pilot'), spill = HAZARDS.find((q) => q.id === 'spill');
  assert.ok(comeDownOver(g, spill.x + 3, spill.point().y + 5, spill.z));
  assert.equal(g.mission.strikes, 1);
  assert.ok(HazardPatrol.qualityOf(h, f.drone, PATROL.cone + 1) === 0, 'out of the picture');
});

test('SAGIP: the boats bring everyone back, and the man in fast water needs a life ring first', () => {
  const fleet = new RescueFleet();
  const etas = SURVIVORS.map((_, i) => fleet.send(i)[1]);
  fleet.finish();
  SURVIVORS.forEach((s, i) => {
    assert.ok(!Number.isNaN(fleet.ashoreAt[i]), s.id + ' is ashore');
    assert.ok(Math.abs(fleet.aboardAt[i] - (etas[i] + 6)) < 1.5, s.id + ': aboard when the boat said it would be there');
  });
  const tree = SURVIVORS.findIndex((s) => s.id === 'tree'), s = SURVIVORS[tree];
  const f = new Flight('sagip', 'pilot');
  assert.ok(f.mission.load('ring', f.drone));
  assert.ok(goTo(f, s.x + 20, s.point().y + 30, s.z - 20, 1.5, 150));
  assert.ok(f.primary(aimAt(f.drone, s.point())));
  assert.ok(f.mission.found(tree)); assert.ok(!f.mission.fleet.busy, 'no boat yet');
  const water = f.mission.weather.level(f.time);
  assert.ok(comeDownOver(f, s.x, water + 4, s.z - 4));
  assert.ok(f.release());
  hold(f, s.x, water + 4, s.z - 4, 3);
  assert.equal(f.mission.packages[0].fate, 'reached');
  assert.ok(f.mission.fleet.busy, 'now a boat goes'); assert.ok(f.mission.inTime(tree));
});

test('SAGIP from the map: a high sweep finds those in the open, but not the hidden', () => {
  const f = new Flight('sagip', 'desk');
  f.waypointAlt = 45;
  for (const [x, z] of [[-130, -20], [200, -20], [200, 40], [-130, 40], [-130, 95], [200, 95], [200, 165], [-130, 165]]) f.addWaypoint(x, z);
  f.launch();
  run(f, 500, () => f.drone.landed && f.drone.flown > 50 && !f.auto.active);
  assert.ok(!f.drone.crashed, 'the sweep hit ' + f.drone.hitBy);
  for (const id of ['roof1', 'market', 'roof2', 'tree', 'jeep', 'sitio']) assert.ok(f.mission.found(SURVIVORS.findIndex((s) => s.id === id)), id);
  for (const id of ['grove', 'gym']) assert.ok(!f.mission.found(SURVIVORS.findIndex((s) => s.id === id)), id + ' is hidden');
  assert.ok(f.result().stars < 3, 'people were left behind');
});

test('HATID from the map: three flights deliver what the four places asked for', () => {
  const f = new Flight('hatid', 'desk');
  const site = (id) => SITES.find((s) => s.id === id);
  for (const trip of [['evac:food', 'evac:water'], ['sitio:water', 'sitio:medicine'], ['health:firstaid', 'health:radio', 'roof:food']]) {
    for (const stop of trip) {
      const [where, what] = stop.split(':');
      assert.ok(f.mission.load(what, f.drone), 'loading ' + stop);
      assert.equal(f.addWaypoint(site(where).x, site(where).z).kind, 'drop');
    }
    assert.ok(f.estimate().battery < 0.85);
    assert.ok(f.launch());
    run(f, 400, () => f.drone.landed && f.drone.flown > 50 && !f.auto.active);
    assert.ok(!f.drone.crashed); assert.ok(home(f));
    run(f, SPEC.swapSeconds + 0.5);
  }
  assert.ok(f.mission.count >= 5, 'needs met: ' + f.mission.count);
  assert.ok(f.result().stars >= 2);
});

test('Hybrid: the pilot takes the sticks for the drop on the roof, then hands them back', () => {
  const f = new Flight('hatid', 'hybrid');
  const roof = SITES.find((s) => s.id === 'roof'), evac = SITES.find((s) => s.id === 'evac');
  f.mission.load('food', f.drone); f.mission.load('food', f.drone);
  f.addWaypoint(roof.x, roof.z); f.addWaypoint(evac.x, evac.z);
  f.launch();
  run(f, 200, () => f.auto.phase === 'descend');
  assert.ok(f.takeControl());
  const [wx, wz] = f.mission.weather.steadyAt(0, 6), len = Math.hypot(wx, wz);
  const ax = roof.x - wx / len * 2, az = roof.z - wz / len * 2;
  assert.ok(goTo(f, ax, roof.point().y + 3.5, az, 1.0, 60, 3));
  hold(f, ax, roof.point().y + 3.5, az, 1.5);
  assert.ok(f.release());
  hold(f, ax, roof.point().y + 3.5, az, 3);
  assert.equal(f.mission.packages[0].fate, 'delivered');
  assert.equal(f.auto.next, 1, 'that drop is done: the autopilot will not go back to it');
  assert.ok(f.handBack());
  run(f, 300, () => f.drone.landed && !f.auto.active);
  assert.equal(f.mission.packages[1].fate, 'delivered', 'the autopilot made the second drop');
  assert.ok(home(f));
});

test('each way of flying allows what it should, and the record keeps the best', () => {
  const desk = new Flight('lipad', 'desk');
  assert.ok(!desk.takeControl()); desk.step(input(0, 0, 1, 0)); assert.ok(desk.drone.landed, 'the sticks do nothing on the desk');
  const pilot = new Flight('lipad', 'pilot');
  assert.equal(pilot.addWaypoint(0, 0), null); assert.ok(!pilot.launch());
  const op = new Operation();
  op.record('sagip', 'desk', { stars: 1, score: 40 }); op.record('sagip', 'hybrid', { stars: 3, score: 90 }); op.record('sagip', 'pilot', { stars: 2, score: 70 });
  assert.equal(op.stars('sagip'), 3); assert.equal(op.best.sagip.mode, 'hybrid');
  assert.ok(!op.allFlown);
  const again = Operation.from(JSON.parse(JSON.stringify(op)));
  assert.equal(again.stars('sagip'), 3, 'kept on the phone and read back');
});

test('every text is in both languages with the same blanks, and every text the game asks for exists', () => {
  for (const [key, [en, fil]] of Object.entries(STRINGS)) {
    assert.ok(en && fil, key);
    for (let k = 0; k < 5; k++) assert.equal(en.includes(`{${k}}`), fil.includes(`{${k}}`), key + ': blank ' + k);
  }
  // the texts named in the code
  const used = new Set();
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && e.name !== 'text.js') {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/\b(?:t|format|tell|event|say|toast)\(\s*(?:'[a-z]+',\s*)?'([a-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);
    }
  });
  walk(new URL('../src', import.meta.url).pathname);
  const missing = [...used].filter((k) => !has(k) && !['info', 'good', 'bad', 'warn', 'hint'].includes(k)); // the kinds of message
  assert.deepEqual(missing, []);
  for (const id of ['lipad', 'bantay', 'sagip', 'hatid']) for (const part of ['name', 'title', 'brief', 'task', 'tip']) assert.ok(has(`mission.${id}.${part}`));
  for (const h of HAZARDS) assert.ok(has('hazard.' + h.id));
  for (const s of SURVIVORS) assert.ok(has('survivor.' + s.id));
  for (const s of SITES) assert.ok(has('site.' + s.id));
  // what a mission says can be said
  const f = new Flight('sagip', 'pilot');
  f.mission.load('ring', f.drone); goTo(f, -100, PAD_Y + 20, -140); f.primary(aim(f.drone.position, { x: 0, y: -1, z: 0 })); f.release(); run(f, 3); f.mission.end();
  for (const e of f.mission.events.concat(f.result().lines)) for (const lang of ['en', 'fil']) assert.ok(!say(e, lang).includes('{'), e.key);
  assert.equal(STAGING.length, 2); void ground;
});
