export interface Icosphere {
  /** Unit vectors, xyz per vertex. */
  positions: Float32Array;
  /** Three vertex indices per face. */
  faces: Uint32Array;
}

/**
 * An icosahedron subdivided `levels` times by edge midpoints: 20·4^levels faces, 10·4^levels + 2 vertices.
 * The vertex order is deterministic, so per-vertex data prepared ahead of time lines up with it.
 */
export function icosphere(levels: number): Icosphere {
  const t = (1 + Math.sqrt(5)) / 2;
  const points: number[] = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  for (let i = 0; i < 12; i++) normalise(points, i);
  let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

  for (let level = 0; level < levels; level++) {
    const midpoints = new Map<number, number>();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? a * 0x200000 + b : b * 0x200000 + a;
      let index = midpoints.get(key);
      if (index === undefined) {
        index = points.length / 3;
        points.push((points[a * 3]! + points[b * 3]!) / 2, (points[a * 3 + 1]! + points[b * 3 + 1]!) / 2, (points[a * 3 + 2]! + points[b * 3 + 2]!) / 2);
        normalise(points, index);
        midpoints.set(key, index);
      }
      return index;
    };
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f]!, b = faces[f + 1]!, c = faces[f + 2]!;
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { positions: new Float32Array(points), faces: new Uint32Array(faces) };
}

function normalise(points: number[], i: number) {
  const x = points[i * 3]!, y = points[i * 3 + 1]!, z = points[i * 3 + 2]!;
  const length = Math.hypot(x, y, z);
  points[i * 3] = x / length;
  points[i * 3 + 1] = y / length;
  points[i * 3 + 2] = z / length;
}

/** Latitude and longitude (degrees) of a unit vector, in the globe's axes: +Y north, longitude 0 on +X, east towards −Z. */
export function latLon(x: number, y: number, z: number): [lat: number, lon: number] {
  return [(Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI, (Math.atan2(-z, x) * 180) / Math.PI];
}
