import { Vector3 } from 'three';
import { gstime, jday, sunPos } from 'satellite.js';

export const EARTH_RADIUS_KM = 6371;
export const KM = 1 / EARTH_RADIUS_KM;

/**
 * Scene axes: +Y is the Earth's spin axis. TEME (x, y, z) maps to scene (x, z, -y),
 * a proper rotation, so a rotation about TEME +z by θ is a rotation about scene +Y by θ.
 */
export function temeToScene(x: number, y: number, z: number, out = new Vector3()) {
  return out.set(x * KM, z * KM, -y * KM);
}

export function gmst(time: number) {
  return gstime(new Date(time));
}

/** Unit vector towards the Sun in scene space. */
export function sunDirection(time: number, out = new Vector3()) {
  const { x, y, z } = sunPos(jday(new Date(time))).rsun;
  return temeToScene(x, y, z, out).normalize();
}
