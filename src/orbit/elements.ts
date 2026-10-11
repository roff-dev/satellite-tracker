import type { SatRec } from 'satellite.js';

export const MU = 398600.4418;

/**
 * Floats per object in the interleaved buffer the GPU reads:
 * a e M0 ṁ | Px Py Pz ω̇ | Qx Qy Qz Ω̇ | t2 kind glint launchDay | groups
 * The group mask is a float holding up to 24 bits exactly.
 */
export const STRIDE = 17;
export const KIND = 13;
export const GLINT = 14;
export const LAUNCH_DAY = 15;
export const GROUPS = 16;

/**
 * Turns an SGP4 state vector (TEME km, km/s) at the reference time into an orbit the vertex shader
 * can advance on its own. The ellipse is osculating at the reference and moves with SGP4's own
 * secular rates (mean motion, perigee and node drift, drag), which keeps it within a couple of km
 * of SGP4 for a minute and tens of km for a day.
 */
export function writeElements(out: Float32Array, o: number, r: ArrayLike<number>, v: ArrayLike<number>, i: number, rec: SatRec) {
  const rx = r[i]!, ry = r[i + 1]!, rz = r[i + 2]!;
  const vx = v[i]!, vy = v[i + 1]!, vz = v[i + 2]!;
  const rm = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  const rv = rx * vx + ry * vy + rz * vz;
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
  const hm = Math.hypot(hx, hy, hz);
  const k = v2 - MU / rm;
  const ex = (k * rx - rv * vx) / MU, ey = (k * ry - rv * vy) / MU, ez = (k * rz - rv * vz) / MU;
  const e = Math.hypot(ex, ey, ez);
  const a = 1 / (2 / rm - v2 / MU);
  const wx = hx / hm, wy = hy / hm, wz = hz / hm;
  // P towards perigee; for a near-circular orbit any in-plane axis will do, so use the position
  const circular = e < 1e-7;
  const px = circular ? rx / rm : ex / e, py = circular ? ry / rm : ey / e, pz = circular ? rz / rm : ez / e;
  const qx = wy * pz - wz * py, qy = wz * px - wx * pz, qz = wx * py - wy * px;
  const nu = Math.atan2(rx * qx + ry * qy + rz * qz, rx * px + ry * py + rz * pz);
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  // Deep-space orbits get their resonance terms from SDP4 itself; plain two-body is closer between anchors
  const deep = rec.method === 'd';
  out[o] = a;
  out[o + 1] = e;
  out[o + 2] = E - e * Math.sin(E);
  out[o + 3] = deep ? Math.sqrt(MU / (a * a * a)) : rec.mdot / 60;
  out[o + 4] = px;
  out[o + 5] = py;
  out[o + 6] = pz;
  out[o + 7] = deep ? 0 : rec.argpdot / 60;
  out[o + 8] = qx;
  out[o + 9] = qy;
  out[o + 10] = qz;
  out[o + 11] = deep ? 0 : rec.nodedot / 60;
  out[o + 12] = deep ? 0 : (rec.t2cof * rec.no) / 3600;
}

/** The vertex shader's orbit maths in JS, so picking finds a point exactly where it is drawn. TEME km. */
export function keplerPosition(el: ArrayLike<number>, o: number, dt: number, out: Float32Array | Float64Array, oo = 0) {
  const a = el[o]!, e = el[o + 1]!;
  const M = (el[o + 2]! + el[o + 3]! * dt + el[o + 12]! * dt * dt) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let n = 0; n < 5; n++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const dw = el[o + 7]! * dt, dO = el[o + 11]! * dt;
  const u = x * Math.cos(dw) - y * Math.sin(dw);
  const w = x * Math.sin(dw) + y * Math.cos(dw);
  const X = u * el[o + 4]! + w * el[o + 8]!;
  const Y = u * el[o + 5]! + w * el[o + 9]!;
  const Z = u * el[o + 6]! + w * el[o + 10]!;
  out[oo] = Math.cos(dO) * X - Math.sin(dO) * Y;
  out[oo + 1] = Math.sin(dO) * X + Math.cos(dO) * Y;
  out[oo + 2] = Z;
}
