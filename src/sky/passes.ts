import { ecfToLookAngles, eciToEcf, gstime, jday, propagate, shadowFraction, sunPos, type SatRec } from 'satellite.js';

const AU_KM = 149_597_870.7;
const RAD = Math.PI / 180;
/** Seen by eye: clear of buildings and haze near the horizon, lit by the Sun, against a sky past civil twilight. */
const MIN_ELEVATION = 10 * RAD;
const SUN_LIMIT = -6 * RAD;
/** Coarse enough to be quick, fine enough not to miss the shortest pass over the edge of the sky. */
const STEP_MS = 20_000;
const PRECISION_MS = 250;

/** One visible pass. Times in ms; directions are compass bearings and elevations, in degrees. */
export interface Pass {
  start: number;
  peak: number;
  end: number;
  startAzimuth: number;
  peakAzimuth: number;
  endAzimuth: number;
  peakElevation: number;
}

interface Look {
  elevation: number;
  azimuth: number;
  visible: boolean;
}

/** Where an object is in a place's sky at a moment, and whether it can be seen there. */
function look(rec: SatRec, where: { latitude: number; longitude: number; height: number }, time: number): Look | null {
  const date = new Date(time);
  const state = propagate(rec, date);
  if (!state || typeof state.position !== 'object') return null;
  const gmst = gstime(date);
  const seen = ecfToLookAngles(where, eciToEcf(state.position, gmst));
  const sun = sunPos(jday(date)).rsun;
  const sunSeen = ecfToLookAngles(where, eciToEcf({ x: sun.x * AU_KM, y: sun.y * AU_KM, z: sun.z * AU_KM }, gmst));
  const lit = shadowFraction(sun, state.position) < 0.5;
  return { elevation: seen.elevation, azimuth: seen.azimuth, visible: seen.elevation >= MIN_ELEVATION && lit && sunSeen.elevation <= SUN_LIMIT };
}

/**
 * Every visible pass of an object over a place between two moments: a scan every 20 s finds when it becomes visible
 * and stops being visible, bisection pins each edge to a quarter of a second, and a golden-section search finds the
 * highest point. A pass already under way at the start counts from there.
 */
export function findPasses(rec: SatRec, latDeg: number, lonDeg: number, from: number, to: number, limit = Infinity): Pass[] {
  const where = { latitude: latDeg * RAD, longitude: lonDeg * RAD, height: 0 };
  const seenAt = (t: number) => look(rec, where, t)?.visible ?? false;
  const edge = (a: number, b: number) => {
    const before = seenAt(a);
    while (b - a > PRECISION_MS) {
      const m = (a + b) / 2;
      if (seenAt(m) === before) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const highest = (a: number, b: number) => {
    const g = (Math.sqrt(5) - 1) / 2;
    const height = (t: number) => look(rec, where, t)?.elevation ?? -Infinity;
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    while (b - a > PRECISION_MS) {
      if (height(c) > height(d)) b = d;
      else a = c;
      c = b - g * (b - a);
      d = a + g * (b - a);
    }
    return (a + b) / 2;
  };
  const degrees = (t: number) => {
    const l = look(rec, where, t)!;
    return { azimuth: l.azimuth / RAD, elevation: l.elevation / RAD };
  };

  const passes: Pass[] = [];
  let was = seenAt(from);
  let start: number | null = was ? from : null;
  for (let t = from + STEP_MS; t <= to && passes.length < limit; t += STEP_MS) {
    const is = seenAt(t);
    if (is && !was) start = edge(t - STEP_MS, t);
    if (!is && was && start !== null) {
      const end = edge(t - STEP_MS, t);
      const peak = highest(start, end);
      const top = degrees(peak);
      passes.push({ start, peak, end, startAzimuth: degrees(start).azimuth, peakAzimuth: top.azimuth, endAzimuth: degrees(end).azimuth, peakElevation: top.elevation });
      start = null;
    }
    was = is;
  }
  return passes;
}

const POINTS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** The 16-point compass name of a bearing in degrees. */
export const compass16 = (bearing: number) => POINTS_16[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]!;
