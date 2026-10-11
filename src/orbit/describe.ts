import type { SatRec } from 'satellite.js';

/** SGP4's own Earth radius (WGS 72), which its orbit sizes are measured in. */
const SGP4_EARTH_KM = 6378.135;
const DAY_MS = 86_400_000;

export type OrbitClass = 'leo' | 'meo' | 'geo' | 'heo';

export interface OrbitNumbers {
  orbitClass: OrbitClass;
  sunSynchronous: boolean;
  periodMinutes: number;
  inclinationDeg: number;
  /** Highest and lowest points above the surface, km. */
  apogeeKm: number;
  perigeeKm: number;
}

/**
 * Low Earth orbit is anything round the planet in under 128 minutes; geosynchronous is a day long, give or take;
 * highly elliptical is any orbit with eccentricity of 0.25 or more, wherever it goes; medium is the rest.
 * Sun-synchronous orbits are the low, near-polar ones (96–100°) whose plane keeps pace with the Sun.
 */
export function orbitNumbers(rec: SatRec): OrbitNumbers {
  const periodMinutes = (2 * Math.PI) / rec.no;
  const inclinationDeg = (rec.inclo * 180) / Math.PI;
  const orbitClass: OrbitClass = rec.ecco >= 0.25 ? 'heo' : periodMinutes < 128 ? 'leo' : periodMinutes >= 1380 && periodMinutes <= 1500 ? 'geo' : 'meo';
  return {
    orbitClass,
    sunSynchronous: orbitClass === 'leo' && inclinationDeg > 96 && inclinationDeg < 100,
    periodMinutes,
    inclinationDeg,
    apogeeKm: rec.alta * SGP4_EARTH_KM,
    perigeeKm: rec.altp * SGP4_EARTH_KM,
  };
}

export type Grade = 'live' | 'good' | 'approximate' | 'low';

/** How far to trust a position, from the time between the orbit's measurement and the moment shown. */
export function accuracyGrade(epoch: number, time: number): Grade {
  const days = Math.abs(time - epoch) / DAY_MS;
  return days <= 1 ? 'live' : days <= 3 ? 'good' : days <= 7 ? 'approximate' : 'low';
}
