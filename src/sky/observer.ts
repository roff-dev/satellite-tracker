/** WGS 84, the ellipsoid GPS and satellite.js use: equatorial radius (km) and flattening. */
const A = 6378.137;
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
const EARTH_RADIUS_KM = 6371;

/** The dome over a place: everything at least this high above the horizon… */
export const DOME_ELEVATION_DEG = 10;
/** …and no more than this far above the surface. */
export const DOME_TOP_KM = 2000;
const SIN_DOME = Math.sin((DOME_ELEVATION_DEG * Math.PI) / 180);

export interface Observer {
  /** On the ellipsoid, Earth-fixed km: x towards 0° longitude on the equator, z towards the north pole. */
  position: [number, number, number];
  /** Straight up: the ellipsoid's normal, which elevation is measured from (it leans from the centre by up to 0.2°). */
  up: [number, number, number];
}

export function observerAt(latDeg: number, lonDeg: number, heightKm = 0): Observer {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const s = Math.sin(lat);
  const c = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return {
    position: [(n + heightKm) * c * Math.cos(lon), (n + heightKm) * c * Math.sin(lon), (n * (1 - E2) + heightKm) * s],
    up: [c * Math.cos(lon), c * Math.sin(lon), s],
  };
}

/** From the inertial (TEME) frame to Earth-fixed, turning by Greenwich sidereal time; polar motion is ignored. */
export function toEarthFixed(p: ArrayLike<number>, gmst: number, out: number[] | Float64Array = [0, 0, 0]) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  out[0] = p[0]! * c + p[1]! * s;
  out[1] = -p[0]! * s + p[1]! * c;
  out[2] = p[2]!;
  return out;
}

/** Sine of a point's elevation above the observer's horizon, both Earth-fixed km. */
export function elevationSine({ position: o, up }: Observer, p: ArrayLike<number>) {
  const dx = p[0]! - o[0];
  const dy = p[1]! - o[1];
  const dz = p[2]! - o[2];
  return (dx * up[0] + dy * up[1] + dz * up[2]) / Math.hypot(dx, dy, dz);
}

/** Elevation in degrees. */
export const elevation = (observer: Observer, p: ArrayLike<number>) => (Math.asin(elevationSine(observer, p)) * 180) / Math.PI;

/** Inside the dome: at least 10° up and within 2,000 km of the surface (the same test the shader draws rings with). */
export function inDome(observer: Observer, p: ArrayLike<number>) {
  return elevationSine(observer, p) >= SIN_DOME && Math.hypot(p[0]!, p[1]!, p[2]!) <= EARTH_RADIUS_KM + DOME_TOP_KM;
}
