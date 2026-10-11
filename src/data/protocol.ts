import type { ObjectType } from '../orbit/brightness';

/** Object kinds as stored in the element buffer and read by the shader. */
export const Kind = { Active: 0, Dead: 1, Rocket: 2, Debris: 3 } as const;

export type Dataset = 'bright' | 'payloads' | 'debris';

export type CatalogRequest =
  /** Re-anchor every orbit at this sim time (ms). */
  | { type: 'anchor'; time: number }
  /** A buffer the renderer has finished with, handed back to be refilled. */
  | { type: 'recycle'; buffer: ArrayBuffer }
  /** Try again for any dataset that couldn't be fetched. */
  | { type: 'retry' }
  | PickRequest;

/** Find the objects drawn near a point on screen, as they were at a given moment. */
export interface PickRequest {
  type: 'pick';
  id: number;
  /** Point and search radius, in CSS pixels from the canvas's top left. */
  x: number;
  y: number;
  radius: number;
  width: number;
  height: number;
  /** Camera projection × view, column-major, and the camera's position, both in scene units. */
  viewProjection: number[];
  camera: [number, number, number];
  /** Sim time (ms) to place the objects at: when the finger went down, so playback can't move them away. */
  time: number;
}

export interface Candidate {
  /** Index in the element buffer, which is also the vertex the shader draws it as. */
  slot: number;
  norad: number;
  name: string;
  type: ObjectType;
  station: boolean;
  /** Distance from the pick point on screen, CSS pixels. */
  distance: number;
}

export interface PickedMessage {
  type: 'picked';
  id: number;
  /** Best first: up to eight, ranked by screen distance with a head start for stations, bright and working objects. */
  candidates: Candidate[];
}

export interface ElementsMessage {
  type: 'elements';
  /** Sim time (ms) the orbits are anchored at. */
  time: number;
  count: number;
  el: Float32Array;
  /** Objects with a position at the anchor time (launched, and SGP4 succeeded). */
  positioned: number;
  /** Of those, how many are in sunlight. */
  sunlit: number;
  /** True when this answers an anchor request; false when new objects arrived. */
  anchored: boolean;
}

export interface ProgressMessage {
  type: 'progress';
  count: number;
  /** Datasets fully read so far. */
  loaded: Dataset[];
  /** Datasets that couldn't be fetched from anywhere. */
  failed: Dataset[];
  /** When the oldest dataset in use was fetched from its source (ISO), if known. */
  fetchedAt: string | null;
  /** Some data came from the build-time snapshot because the live Worker didn't answer. */
  stale: boolean;
  done: boolean;
}

export type CatalogEvent = ElementsMessage | ProgressMessage | PickedMessage;
