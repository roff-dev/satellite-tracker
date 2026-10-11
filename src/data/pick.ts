import { KIND, STRIDE, keplerPosition } from '../orbit/elements';
import type { ObjectType } from '../orbit/brightness';
import { ALL_KINDS, type Candidate, type PickRequest } from './protocol';

/** Lists an object came in on, as bit flags. */
export const STATION = 1;
export const VISUAL = 2;

export interface Pickable {
  norad: number;
  name: string;
  type: ObjectType;
  lists: number;
  /** Days since 1970 when it launched; it can't be picked before then. */
  launchDay: number;
}

const KM = 1 / 6371;
const DAY_MS = 86_400_000;
const position = new Float64Array(3);

/**
 * Screen-space nearest, using the shader's own orbit maths so a point is found exactly where it is drawn.
 * Objects behind the Earth don't count, nor do kinds that are switched off (`kinds`, one bit per kind). Stations,
 * the brightest and working objects get a few pixels' head start, because at globe scale dozens of objects sit
 * under a fingertip. Ties go to the nearer object.
 */
export function findNearby(
  elements: Float32Array,
  objects: Pickable[],
  anchorTime: number,
  { x, y, radius, width, height, viewProjection: m, camera, time }: Omit<PickRequest, 'type' | 'id'>,
  limit = 8,
  kinds = ALL_KINDS,
): Candidate[] {
  const [cx, cy, cz] = camera;
  const outside = cx * cx + cy * cy + cz * cz - 1;
  const dt = (time - anchorTime) / 1000;
  const day = time / DAY_MS;
  const found: (Candidate & { score: number; depth: number })[] = [];
  for (let slot = 0; slot < objects.length; slot++) {
    const o = slot * STRIDE;
    const info = objects[slot]!;
    if (!(elements[o]! > 0) || info.launchDay > day || !((kinds >> elements[o + KIND]!) & 1)) continue;
    keplerPosition(elements, o, dt, position);
    // TEME km to scene units: (x, z, −y)
    const px = position[0]! * KM, py = position[2]! * KM, pz = -position[1]! * KM;
    const w = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!;
    if (w <= 0) continue;
    const sx = (((m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / w + 1) / 2) * width;
    const sy = ((1 - (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / w) / 2) * height;
    const distance = Math.hypot(sx - x, sy - y);
    if (distance > radius) continue;
    // Hidden if the ray from the camera meets the Earth before it reaches the object
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const length = Math.hypot(dx, dy, dz);
    const b = (cx * dx + cy * dy + cz * dz) / length;
    const disc = b * b - outside;
    if (disc > 0) {
      const hit = -b - Math.sqrt(disc);
      if (hit > 0 && hit < length) continue;
    }
    const station = (info.lists & STATION) !== 0;
    const score = distance - (station ? 6 : 0) - (info.lists & VISUAL ? 4 : 0) - (info.type === 'payload' ? 2 : 0);
    found.push({ slot, norad: info.norad, name: info.name, type: info.type, station, distance, score, depth: length });
  }
  found.sort((a, b) => a.score - b.score || a.depth - b.depth);
  return found.slice(0, limit).map(({ slot, norad, name, type, station, distance }) => ({ slot, norad, name, type, station, distance }));
}
