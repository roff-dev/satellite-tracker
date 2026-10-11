/// <reference lib="webworker" />
import { icosphere } from '../globe/icosphere';

export interface EarthMesh {
  /** Three unshared vertices per facet, so each facet has its own flat normal and colour. */
  position: Float32Array;
  normal: Float32Array;
  /** sRGB palette colour per vertex. */
  colour: Uint8Array;
  /** Per vertex: city-light level, and 255 for sea. */
  surface: Uint8Array;
}

/** Land stands this far proud of the sea, so coastlines read as edges. */
const LIFT = 0.005;
/** 6,400 m of relief drawn at this height: about 20× true scale, enough for ranges to catch the light. */
const RELIEF = 0.02;
/** Random height per vertex, so even the sea and the plains break into facets that catch the light. */
const SEA_JITTER = 0.0028;
const LAND_JITTER = 0.002;

/** Repeatable noise in [0, 1) for a vertex index. */
function hash(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * earth.bin: "LPE1" | subdivision levels | palette size | palette (sRGB) | sea classes |
 * a land height per vertex (0 = sea) | per facet, colour class << 4 | city lights (0–15).
 */
function build(buffer: ArrayBuffer): EarthMesh {
  const bytes = new Uint8Array(buffer);
  let o = 4;
  const levels = bytes[o++]!;
  const paletteSize = bytes[o++]!;
  const palette = bytes.slice(o, (o += paletteSize * 3));
  const seaClasses = bytes[o++]!;
  // The two sea tones drawn closer and lifted, so the coastal shelf doesn't outline every coast
  for (let j = 0; j < 3; j++) {
    const mean = (palette[j]! + palette[3 + j]!) / 2;
    for (let c = 0; c < seaClasses; c++) palette[c * 3 + j] = Math.min(255, (palette[c * 3 + j]! * 0.6 + mean * 0.4) * 1.3);
  }
  const { positions: unit, faces } = icosphere(levels);
  const vertexCount = unit.length / 3;
  const faceCount = faces.length / 3;
  const height = bytes.subarray(o, (o += vertexCount));
  const faceData = bytes.subarray(o, o + faceCount);

  const radius = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const jitter = (hash(i) - 0.5) * (height[i] ? LAND_JITTER : SEA_JITTER);
    radius[i] = (height[i] ? 1 + LIFT + (height[i]! / 255) * RELIEF : 1) + jitter;
  }

  const position = new Float32Array(faceCount * 9);
  const normal = new Float32Array(faceCount * 9);
  const colour = new Uint8Array(faceCount * 9);
  const surface = new Uint8Array(faceCount * 6);
  for (let f = 0; f < faceCount; f++) {
    const cls = faceData[f]! >> 4;
    const glow = ((faceData[f]! & 15) / 15) * 255;
    const sea = cls < seaClasses ? 255 : 0;
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k]!;
      for (let j = 0; j < 3; j++) {
        position[f * 9 + k * 3 + j] = unit[v * 3 + j]! * radius[v]!;
        colour[f * 9 + k * 3 + j] = palette[cls * 3 + j]!;
      }
      surface[f * 6 + k * 2] = glow;
      surface[f * 6 + k * 2 + 1] = sea;
    }
    // Flat normal from the facet's two edges
    const p = f * 9;
    const ux = position[p + 3]! - position[p]!, uy = position[p + 4]! - position[p + 1]!, uz = position[p + 5]! - position[p + 2]!;
    const vx = position[p + 6]! - position[p]!, vy = position[p + 7]! - position[p + 1]!, vz = position[p + 8]! - position[p + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (let k = 0; k < 3; k++) normal.set([nx, ny, nz], p + k * 3);
  }
  return { position, normal, colour, surface };
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

fetch('/earth.bin')
  .then((response) => {
    if (!response.ok) throw new Error(`earth.bin: ${response.status}`);
    return response.arrayBuffer();
  })
  .then((buffer) => {
    const mesh = build(buffer);
    scope.postMessage(mesh, [mesh.position.buffer, mesh.normal.buffer, mesh.colour.buffer, mesh.surface.buffer]);
  })
  .catch((error: unknown) => scope.postMessage({ error: String(error) }));
