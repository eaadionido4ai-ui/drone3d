// The small round map in the corner while flying: the barangay seen from above, turned so that the way the drone
// faces is up, with the pad, what the mission is about, and the boats. The picture of the barangay is drawn once
// per mission from the plan (and again when the flood has risen), in 2D.
import * as P from '../core/plan.js';
import { ground, X0, X1, Z0, Z1, DEG, Compass } from '../core/world.js';

const SCALE = 2; // pixels per metre in the picture
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** The barangay from above, as the mission shows it. */
export function drawPlan(plan, level) {
  const W = (X1 - X0) * SCALE, H = (Z1 - Z0) * SCALE;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  // the ground, cell by cell: grass that pales as it rises, sand on the banks, and water where it is flooded
  const cell = 3;
  for (let z = Z0; z < Z1; z += cell) {
    for (let x = X0; x < X1; x += cell) {
      const g = ground(x + cell / 2, z + cell / 2);
      let col;
      if (g < level) col = level - g > 0.6 ? '#3d6f93' : '#5a87a5';
      else if (z + 1 > P.TERRAIN.riverNorth && z < P.TERRAIN.riverSouth) col = '#cdbb8a';
      else col = g < 1 ? '#86ab62' : g < 2.5 ? '#92b56b' : g < 4 ? '#9dbb72' : '#a9c17b';
      c.fillStyle = col; c.fillRect((x - X0) * SCALE, (z - Z0) * SCALE, cell * SCALE + 0.5, cell * SCALE + 0.5);
    }
  }
  const px = (x) => (x - X0) * SCALE, pz = (z) => (z - Z0) * SCALE;
  // the streets
  c.lineCap = 'butt'; c.strokeStyle = '#5b5e63';
  for (const r of P.ROADS) { c.lineWidth = r.w * SCALE; c.beginPath(); c.moveTo(px(r.x0), pz(r.z0)); c.lineTo(px(r.x1), pz(r.z1)); c.stroke(); }
  // the bridge: its middle only when it stands
  const B = P.BRIDGE;
  c.fillStyle = '#9a9d9f';
  c.fillRect(px(B.x - B.w / 2), pz(B.z0), B.w * SCALE, (B.spanZ0 - B.z0) * SCALE);
  c.fillRect(px(B.x - B.w / 2), pz(B.spanZ1), B.w * SCALE, (B.z1 - B.spanZ1) * SCALE);
  if (plan.sets.includes('bridge_ok')) c.fillRect(px(B.x - B.w / 2), pz(B.spanZ0), B.w * SCALE, (B.spanZ1 - B.spanZ0) * SCALE);
  // the houses and the halls: their roofs; the rubble of the fallen ones after the earthquake
  const quake = plan.sets.includes('quake');
  for (const b of P.BUILDINGS) {
    if (b.set === 'normal' && quake) continue;
    c.fillStyle = hex(b.top); c.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.strokeRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
  }
  if (quake) for (const r of P.RUBBLE) { c.fillStyle = '#8d877b'; c.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * SCALE, r.d * SCALE); }
  // the trees
  c.fillStyle = '#3f8f4a';
  for (const t of P.TREES) { c.beginPath(); c.arc(px(t.x), pz(t.z), Math.max(1.5, t.r * SCALE * 0.8), 0, Math.PI * 2); c.fill(); }
  // the pad
  c.fillStyle = '#ffc53d'; c.fillRect(px(P.PAD.x - P.PAD.size / 2), pz(P.PAD.z - P.PAD.size / 2), P.PAD.size * SCALE, P.PAD.size * SCALE);
  return cv;
}

/** Draws the round map: centered on the drone, the way it faces up. marks: [{ x, z, color, label, edge }]. */
export function drawMinimap(c, size, picture, d, marks) {
  const r = size / 2, k = 0.55 * (size / 118); // pixels per metre on the minimap
  c.clearRect(0, 0, size, size);
  c.save();
  c.beginPath(); c.arc(r, r, r, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#7fa35d'; c.fillRect(0, 0, size, size);
  c.translate(r, r); c.rotate(-d.heading * DEG); c.scale(k / SCALE, k / SCALE);
  c.drawImage(picture, (X0 - d.x) * SCALE, (Z0 - d.z) * SCALE);
  c.restore();
  // what to find, turned the same way; at the edge when it is farther than the map shows
  const cs = Math.cos(-d.heading * DEG), sn = Math.sin(-d.heading * DEG);
  for (const m of marks) {
    const dx = (m.x - d.x) * k, dz = (m.z - d.z) * k;
    let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
    const l = Math.hypot(sx, sy), max = r - 8;
    if (l > max) { if (!m.edge) continue; sx *= max / l; sy *= max / l; }
    c.beginPath(); c.arc(r + sx, r + sy, m.label ? 6.5 : 4, 0, Math.PI * 2);
    c.fillStyle = m.color; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#0d1c25'; c.stroke();
    if (m.label) { c.fillStyle = '#0d1c25'; c.font = '900 9px Nunito, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(m.label, r + sx, r + sy + 0.5); }
  }
  // the drone, in the middle
  c.fillStyle = '#ff7a1a'; c.strokeStyle = '#fff'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(r, r - 9); c.lineTo(r + 6.5, r + 7); c.lineTo(r, r + 3.5); c.lineTo(r - 6.5, r + 7); c.closePath(); c.fill(); c.stroke();
  // north
  const nx = r + Math.sin(-d.heading * DEG) * (r - 9), ny = r - Math.cos(-d.heading * DEG) * (r - 9);
  c.fillStyle = '#fff'; c.font = '900 11px Nunito, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('N', nx, ny);
}

/** The strip at the top: the compass, with the pad and what to fly to next. marks: [{ heading, color, label }]. */
export function drawCompass(c, w, h, heading, marks) {
  c.clearRect(0, 0, w, h);
  const span = 120, px = w / span;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let a = Math.floor((heading - span / 2) / 15) * 15; a <= heading + span / 2; a += 15) {
    const x = w / 2 + Compass.turn(heading, a) * px, n = Compass.wrap(a);
    if (n % 45 === 0) {
      c.fillStyle = n % 90 === 0 ? '#fff' : '#b9c6cf';
      c.font = (n % 90 === 0 ? '900 13px' : '800 10px') + ' Nunito, sans-serif';
      c.fillText(Compass.point(n), x, h / 2 + 1);
    } else { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(x - 0.5, h - 7, 1, 5); }
  }
  for (const m of marks) {
    const off = Compass.turn(heading, m.heading), x = w / 2 + Math.max(-span / 2 + 4, Math.min(span / 2 - 4, off)) * px;
    c.fillStyle = m.color; c.beginPath(); c.moveTo(x, h - 1); c.lineTo(x - 6, h - 9); c.lineTo(x + 6, h - 9); c.closePath(); c.fill();
    if (m.label) { c.font = '900 9px Nunito, sans-serif'; c.fillText(m.label, x, 7); }
  }
  c.fillStyle = '#ff7a1a'; c.fillRect(w / 2 - 1, 0, 2, 6);
}
