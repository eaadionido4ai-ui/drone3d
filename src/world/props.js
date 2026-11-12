// The things that move, built once and copied: the drone (its body, a propeller, where its four rotors, its hooks
// and its camera are), the six kinds of supplies, the people, the rescue boat and the ring of the flight school.
// DRONE VR's props (Tools/world-export/src/props.js), standing on y = 0 at the origin, facing north (-z).
import * as THREE from 'three';
import { makeKit } from './kit.js';
import { bake, bakedMaterial } from './bake.js';
import { SUPPLIES, GATES } from '../core/world.js';

const DARK = 0x2c2f33, STEEL = 0x8f979e, WHITE = 0xf4f4f0, ORANGE = 0xff7a1a, RED = 0xc62f22, GREEN = 0x3fbf5a, NAVY = 0x16303f;
const SKIN = [0xc68a55, 0xd69a63, 0xb87a48, 0xe0aa78];

/** The people: the shirt (bright, to be seen from the air), the skin, the trousers, and whether they sit. */
export const PEOPLE = [
  ['person_red', 0xe2382b, SKIN[0], 0x35506b, false],
  ['person_yellow', 0xf2b300, SKIN[1], 0x3d3127, false],
  ['person_blue', 0x2f74d0, SKIN[2], 0x4a3b6b, false],
  ['person_pink', 0xe2588a, SKIN[3], 0x35506b, false],
  ['person_sit', 0x4caf50, SKIN[1], 0x2f3f4f, true],
];

function geometryOf(build) {
  const root = new THREE.Group();
  root.userData.group = 'prop';
  build(root);
  const { meshes } = bake(root);
  return meshes.get('prop').geometry;
}

function drone(K, root) {
  K.box(root, 0.34, 0.12, 0.46, 0xf2760c, 0, 0.36, 0); K.box(root, 0.26, 0.07, 0.3, DARK, 0, 0.45, 0.02); K.box(root, 0.3, 0.1, 0.1, DARK, 0, 0.36, -0.26);
  // red lights at the nose, green at the tail, as on most drones
  K.box(root, 0.05, 0.03, 0.03, RED, -0.1, 0.37, -0.315); K.box(root, 0.05, 0.03, 0.03, RED, 0.1, 0.37, -0.315);
  K.box(root, 0.05, 0.03, 0.03, GREEN, -0.1, 0.37, 0.235); K.box(root, 0.05, 0.03, 0.03, GREEN, 0.1, 0.37, 0.235);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ax = sx * 0.39, az = sz * 0.39;
    K.box(root, 0.6, 0.045, 0.06, DARK, ax / 2, 0.38, az / 2, 0, -Math.atan2(az, ax), 0);
    K.cyl(root, 0.045, 0.05, 0.1, STEEL, ax, 0.4, az, 8);
  }
  for (const sx of [-1, 1]) {
    K.box(root, 0.03, 0.03, 0.6, DARK, sx * 0.2, 0.015, 0);
    for (const dz of [-0.18, 0.18]) K.box(root, 0.025, 0.31, 0.025, DARK, sx * 0.185, 0.165, dz, 0, 0, sx * 0.1);
  }
  K.box(root, 0.08, 0.08, 0.05, STEEL, 0, 0.27, -0.2); K.ball(root, 0.055, DARK, 0, 0.2, -0.22, 1); K.cyl(root, 0.025, 0.025, 0.03, 0x6fa8dc, 0, 0.2, -0.275, 8, Math.PI / 2);
  for (const dx of [-0.1, 0, 0.1]) K.box(root, 0.02, 0.07, 0.02, STEEL, dx, 0.27, 0.06);
}

function propeller(K, root) {
  K.box(root, 0.5, 0.012, 0.045, WHITE, 0, 0, 0); K.cyl(root, 0.025, 0.025, 0.03, DARK, 0, 0.005, 0, 6);
}

function supply(K, g, id) {
  const c = SUPPLIES.find((s) => s.id === id).color;
  const loop = (y) => K.ring(g, 0.05, 0.012, STEEL, 0, y, 0, 4, 10, 0, 0, 0);
  switch (id) {
    case 'water': K.box(g, 0.24, 0.32, 0.16, c, 0, 0.16, 0); K.box(g, 0.1, 0.04, 0.03, c, -0.02, 0.35, 0); K.cyl(g, 0.03, 0.03, 0.05, WHITE, 0.08, 0.34, 0, 8); K.box(g, 0.2, 0.1, 0.005, WHITE, 0, 0.18, 0.083); loop(0.41); break;
    case 'food': K.box(g, 0.34, 0.24, 0.26, c, 0, 0.12, 0); K.box(g, 0.35, 0.03, 0.06, WHITE, 0, 0.24, 0); K.box(g, 0.2, 0.12, 0.005, WHITE, 0, 0.12, 0.133); loop(0.3); break;
    case 'medicine': K.box(g, 0.24, 0.18, 0.18, WHITE, 0, 0.09, 0); K.box(g, 0.25, 0.04, 0.19, c, 0, 0.2, 0); K.box(g, 0.1, 0.03, 0.005, c, 0, 0.1, 0.093); K.box(g, 0.03, 0.1, 0.005, c, 0, 0.1, 0.093); loop(0.27); break;
    case 'firstaid': K.box(g, 0.32, 0.2, 0.2, c, 0, 0.1, 0); K.box(g, 0.33, 0.03, 0.21, 0x0e6a43, 0, 0.19, 0); K.box(g, 0.1, 0.03, 0.005, WHITE, 0, 0.1, 0.103); K.box(g, 0.03, 0.1, 0.005, WHITE, 0, 0.1, 0.103); loop(0.26); break;
    case 'radio': K.box(g, 0.2, 0.14, 0.16, c, 0, 0.07, 0); K.box(g, 0.07, 0.16, 0.04, DARK, -0.03, 0.2, 0); K.cyl(g, 0.006, 0.006, 0.16, DARK, -0.05, 0.36, 0, 4); K.box(g, 0.04, 0.03, 0.005, 0x9fe89f, -0.03, 0.23, 0.023); loop(0.2).position.x = 0.06; break;
    case 'ring': K.ring(g, 0.24, 0.06, c, 0, 0.06, 0, 6, 16); for (const a of [0, 1.57, 3.14, 4.71]) K.box(g, 0.13, 0.13, 0.07, WHITE, Math.cos(a) * 0.24, 0.06, Math.sin(a) * 0.24, 0, -a, 0); loop(0.16); break;
  }
}

function person(K, g, shirt, skin, pants, sitting) {
  const hip = sitting ? 0.45 : 0.82;
  if (sitting) { K.box(g, 0.3, 0.14, 0.42, pants, 0, 0.43, -0.2); K.box(g, 0.3, 0.42, 0.14, pants, 0, 0.21, -0.38); }
  else for (const sx of [-1, 1]) K.box(g, 0.13, 0.8, 0.15, pants, sx * 0.085, 0.4, 0);
  K.box(g, 0.34, 0.5, 0.2, shirt, 0, hip + 0.27, 0);
  K.ball(g, 0.13, skin, 0, hip + 0.68, 0, 1); K.box(g, 0.24, 0.08, 0.24, DARK, 0, hip + 0.79, 0.01);
  K.box(g, 0.09, 0.48, 0.1, skin, -0.23, hip + 0.3, 0, 0, 0, -0.12);
  K.box(g, 0.09, 0.5, 0.1, skin, 0.27, hip + 0.72, 0, 0, 0, -0.45);
  K.box(g, 0.12, 0.2, 0.12, shirt, 0.21, hip + 0.46, 0, 0, 0, -0.45);
}

function boat(K, g) {
  K.box(g, 1.5, 0.22, 3.6, 0x4a4f55, 0, 0.16, 0);
  for (const sx of [-1, 1]) K.cyl(g, 0.24, 0.24, 3.8, ORANGE, sx * 0.78, 0.36, 0.05, 8, Math.PI / 2);
  K.cyl(g, 0.24, 0.24, 1.6, ORANGE, 0, 0.36, -1.85, 8, 0, 0, Math.PI / 2); K.ball(g, 0.3, ORANGE, -0.72, 0.36, -1.82, 1); K.ball(g, 0.3, ORANGE, 0.72, 0.36, -1.82, 1);
  K.box(g, 1.3, 0.06, 0.3, WHITE, 0, 0.5, 0.4); K.box(g, 0.24, 0.5, 0.22, DARK, 0, 0.6, 1.95); K.box(g, 0.1, 0.5, 0.1, DARK, 0, 0.1, 2.05);
  for (const [x, z] of [[-0.25, -0.5], [0.25, 0.9]]) {
    K.box(g, 0.3, 0.42, 0.2, ORANGE, x, 0.78, z); K.ball(g, 0.12, SKIN[1], x, 1.13, z, 1); K.box(g, 0.24, 0.08, 0.24, WHITE, x, 1.22, z); K.box(g, 0.28, 0.14, 0.34, NAVY, x, 0.5, z + 0.05);
  }
  K.box(g, 0.5, 0.3, 0.02, WHITE, 0, 0.75, -1.3); K.box(g, 0.3, 0.07, 0.025, RED, 0, 0.75, -1.3); K.box(g, 0.07, 0.24, 0.025, RED, 0, 0.75, -1.3);
}

/** Builds every prop once. Copies are new meshes sharing these geometries and the baked material. */
export function buildProps() {
  const K = makeKit(THREE);
  const props = {
    drone: geometryOf((r) => drone(K, r)),
    propeller: geometryOf((r) => propeller(K, r)),
    rotors: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * 0.39, 0.46, sz * 0.39)),
    hook: new THREE.Vector3(0, 0.22, 0.06),
    cam: new THREE.Vector3(0, 0.2, -0.3),
    supply: {}, person: {},
    boat: geometryOf((r) => boat(K, r)),
    gate: geometryOf((r) => K.ring(r, GATES[0].r, 0.22, WHITE, 0, 0, 0, 5, 24, 0, 0, 0)),
  };
  for (const s of SUPPLIES) props.supply[s.id] = geometryOf((r) => supply(K, r, s.id));
  for (const [name, shirt, skin, pants, sitting] of PEOPLE) props.person[name] = geometryOf((r) => person(K, r, shirt, skin, pants, sitting));
  return props;
}

/** A copy of a prop: a mesh with the shared geometry and material. */
export const copy = (geometry, material = bakedMaterial) => new THREE.Mesh(geometry, material);
