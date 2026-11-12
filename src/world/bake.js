// Turns a three.js group built of many small flat-colored pieces into a few meshes a phone draws quickly: the
// pieces of each group ('terrain', 'buildings', 'SET:quake'...) are moved to where they stand, their color is
// written into each corner (vertex colors), and they are joined into one geometry. Painted signs stay meshes of
// their own, with their picture.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The group of a mesh: the nearest 'group' written on it or on what it belongs to. */
function groupOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData && p.userData.group) return p.userData.group;
  return 'other';
}

/** One shared material for every baked piece: the color is in the vertices, and the faces are flat. */
export const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Bakes a built group. Returns { meshes: Map(group name -> Mesh), signs: [Mesh] }. The signs keep their
 * picture (a MeshBasicMaterial with a map) and are moved to where they stand.
 */
export function bake(root, material = bakedMaterial) {
  root.updateMatrixWorld(true);
  const buckets = new Map(), signs = [];
  const color = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat.map) {
      const s = new THREE.Mesh(o.geometry, mat);
      o.matrixWorld.decompose(s.position, s.quaternion, s.scale);
      signs.push(s);
      return;
    }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) flipWinding(g);
    color.copy(mat.color);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[3 * i] = color.r; c[3 * i + 1] = color.g; c[3 * i + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const key = groupOf(o);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  });
  const meshes = new Map();
  for (const [key, list] of buckets) {
    const g = mergeGeometries(list, false);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = key;
    m.matrixAutoUpdate = false;
    meshes.set(key, m);
  }
  return { meshes, signs };
}

function flipWinding(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1));
    p.setXYZ(i + 1, x, y, z);
  }
}
