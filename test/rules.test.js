// Checks of the ground, the town, the weather, the drone's flight and the falling packages: the JavaScript rules
// must fly as DRONE VR's C# and the Python reference do, step for step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ground, depth, Compass, BUILDINGS, TREES, TOWERS, POLES, PAD_X, PAD_Z, PAD_Y, GATES, HAZARDS, SURVIVORS, SITES, MISSIONS, missionPlan } from '../src/core/world.js';
import { Town, Weather, windSpeed, atHeight, SPEC, CRASH, DroneState, stepDrone, input, NO_INPUT, Package, stepPackage, Cargo } from '../src/core/rules.js';

const data = (f) => JSON.parse(readFileSync(new URL('./data/' + f, import.meta.url)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not within ${tol} of ${b}`);

test('the ground is the plan\'s ground, as DRONE VR recorded it', () => {
  for (const [x, z, h] of data('ground_samples.json')) near(ground(x, z), h, 1e-9, `at ${x}, ${z}`);
  assert.ok(ground(0, 120) < -2, 'the middle of the river');
  const highest = Math.max(...MISSIONS.flatMap((m) => m.floodLevels));
  assert.ok(ground(PAD_X, PAD_Z) > highest + 1, 'the pad stays dry in every mission');
  assert.equal(depth(60, -100, 2.2), 0, 'the north is dry when the search begins');
});

test('headings turn the short way', () => {
  near(Compass.turn(350, 10), 20, 1e-9, 'right'); near(Compass.turn(10, 350), -20, 1e-9, 'left');
  near(Compass.towards(0, 0, 10, 0), 90, 1e-9, 'east'); near(Compass.towards(0, 0, 0, -10), 0, 1e-9, 'north is -z');
  assert.equal(Compass.point(315), 'NW');
});

test('the drone flies as the reference model does, step for step', () => {
  const gold = data('flight_golden.json');
  for (const run of gold.runs) {
    const weather = new Weather({ wind: run.wind, gust: run.gust, windFrom: run.from, floodMinutes: [0], floodLevels: [run.level], minutes: 10 });
    const town = Town.bare();
    const d = new DroneState(); d.payloadKg = run.payload;
    let step = 0, row = 0;
    for (const [n, f, r, u, y] of run.sticks) {
      for (let k = 0; k < n; k++) {
        const t = step * SPEC.dt;
        const [wx, wz] = weather.windAt(t, d.aboveGround), [sx, sz] = weather.steadyAt(t, d.aboveGround);
        stepDrone(d, input(f, r, u, y), town, wx, wz, sx, sz, run.level);
        step++;
        if (row < run.rows.length && step === run.rows[row][0]) {
          const g = run.rows[row++], at = `${run.name}, step ${step}`;
          near(d.x, g[1], 1e-7, at + ': x'); near(d.y, g[2], 1e-7, at + ': y'); near(d.z, g[3], 1e-7, at + ': z');
          near(d.vx, g[4], 1e-7, at + ': vx'); near(d.vy, g[5], 1e-7, at + ': vy'); near(d.vz, g[6], 1e-7, at + ': vz');
          near(d.heading, g[7], 1e-7, at + ': heading'); near(d.battery, g[8], 1e-9, at + ': battery');
          assert.equal(d.landed, g[9] === 1, at + ': landed'); assert.equal(d.crash, g[10], at + ': crash');
        }
      }
    }
    assert.equal(row, run.rows.length, run.name + ': every row was checked');
  }
});

test('the houses that fall are rubble after the earthquake, and the bridge is out after the typhoon', () => {
  const calm = Town.forPlan(missionPlan('lipad')), quake = Town.forPlan(missionPlan('bantay'));
  const fallen = BUILDINGS.filter((b) => b.set === 'normal');
  assert.equal(fallen.length, 3);
  for (const b of fallen) {
    assert.equal(calm.hit(b.x, b.base + 2.5, b.z, 0.5), 'building', b.id + ' stands in calm weather');
    assert.equal(quake.hit(b.x, b.base + 2.5, b.z, 0.5), null, b.id + ' has fallen');
    assert.equal(quake.hit(b.x, b.base + 0.8, b.z, 0.5), 'building', 'its rubble lies there');
  }
  const search = Town.forPlan(missionPlan('sagip')), relief = Town.forPlan(missionPlan('hatid'));
  near(search.surfaceFromAbove(20, 120), 3.4, 1e-9, 'the deck');
  assert.ok(relief.surfaceFromAbove(20, 120) < 0, 'only the river');
  near(calm.surfaceFromAbove(PAD_X, PAD_Z), PAD_Y, 1e-9, 'the pad');
  const court = BUILDINGS.find((b) => b.id === 'court');
  assert.equal(calm.hit(court.x, court.base + 3, court.z, 0.6), null, 'there is room under the covered court\'s roof');
  const palm = TREES.find((t) => t.palm), cell = TOWERS.find((t) => t.id === 'celltower');
  assert.equal(calm.hit(palm.x, ground(palm.x, palm.z) + palm.h - 1, palm.z, 0.6), 'tree');
  assert.equal(calm.hit(cell.x + 1, ground(cell.x, cell.z) + 30, cell.z, 0.6), 'tower');
  assert.equal(calm.hit(POLES[0].x, ground(POLES[0].x, POLES[0].z) + 5, POLES[0].z, 0.6), 'pole');
});

test('everything a mission looks for is where a drone can reach it', () => {
  const school = Town.forPlan(missionPlan('lipad'));
  for (const g of GATES) assert.equal(school.hit(g.x, g.center().y, g.z, g.r), null, 'a ring with something in it');
  const top = Math.max(...missionPlan('sagip').floodLevels);
  for (const s of SURVIVORS) assert.ok(s.point().y > top - 0.9, s.id + ' would be under water');
  const wind = Town.forPlan(missionPlan('hatid'));
  for (const s of SITES) near(wind.surfaceFromAbove(s.x, s.z), s.point().y, 0.3, 'the place to drop into at ' + s.id);
  assert.equal(HAZARDS.length, 7);
});

test('the wind gusts around its mean, and is weaker near the ground', () => {
  let sum = 0, n = 0, hi = 0, lo = 1e9;
  for (let t = 0; t < 473; t += 0.1) { const s = windSpeed(9, 0.5, t); sum += s; n++; hi = Math.max(hi, s); lo = Math.min(lo, s); }
  near(sum / n, 9, 0.15, 'the mean'); assert.ok(hi > 12.5 && hi < 13.6); assert.ok(lo < 5.5 && lo > 4.4);
  near(atHeight(0), 0.6, 1e-9, 'at the ground'); near(atHeight(60), 1, 1e-9, 'at 60 m');
  near(Weather.levelOf(missionPlan('sagip'), 180), 2.5, 1e-9, 'the flood half way up');
});

test('the drone hovers where it is left, lands gently, and breaks if it comes down hard', () => {
  const open = Town.bare();
  const fly = (d, s, sticks, level = 0) => { for (let i = 0; i < Math.round(s / SPEC.dt); i++) stepDrone(d, sticks, open, 0, 0, 0, 0, level); };
  const d = new DroneState();
  fly(d, 2, NO_INPUT); assert.ok(d.landed, 'it stays on the pad until told to go up');
  fly(d, 4, input(0, 0, 1, 0)); assert.ok(!d.landed);
  const x = d.x; fly(d, 10, NO_INPUT); near(d.x, x, 1e-6, 'it hovers');
  const a = new DroneState(); a.x = -100; a.z = -150; a.y = ground(-100, -150) + 20; a.landed = false;
  fly(a, 10, input(0, 0, -1, 0)); assert.equal(a.crash, CRASH.hard, '3.5 m/s down is too fast');
  const b = new DroneState(); b.x = 0; b.z = 60; b.y = 6; b.landed = false;
  fly(b, 6, input(0, 0, -0.5, 0), 2.2); assert.equal(b.crash, CRASH.water);
});

test('the drone lifts 8 kg on three hooks, and a package breaks if it falls from too high', () => {
  const c = new Cargo();
  assert.ok(c.add('water')); assert.ok(c.add('food'));
  assert.equal(c.whyNot('firstaid'), 'load.heavy'); assert.ok(c.add('radio')); assert.equal(c.whyNot('medicine'), 'load.hooks');
  const drop = (h, item = 'food', level = 0, x = -100, z = -150) => {
    const p = new Package(item); p.x = x; p.z = z; p.y = ground(x, z) + h;
    for (let i = 0; i < 2000 && p.falling; i++) stepPackage(p, Town.bare(), 0, 0, level);
    return p;
  };
  assert.equal(drop(3.5).fate, 'missed', 'from the autopilot\'s height it lands whole');
  assert.equal(drop(5).fate, 'broken');
  assert.equal(drop(30, 'ring').fate, 'missed', 'a life ring does not break');
  assert.equal(drop(5, 'water', 2.2, 0, 60).fate, 'sunk');
});
