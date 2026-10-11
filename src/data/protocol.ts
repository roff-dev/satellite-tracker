import type { ObjectType } from '../orbit/brightness';
import type { OrbitClass, OrbitNumbers } from '../orbit/describe';

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
  | PickRequest
  | DescribeRequest
  /** Look an object up by its catalogue number, for links that name one. */
  | { type: 'find'; id: number; norad: number }
  /** Objects whose name, catalogue number or international designator matches, best first. */
  | { type: 'search'; id: number; query: string }
  /** How many objects in a group have a position at the anchor time. */
  | { type: 'count'; id: number; filter: number }
  /** Mark every object from one launch (2026-045), or none. */
  | { type: 'highlight'; id: number; launch: string | null };

export interface SearchResult extends Candidate {
  cospar: string;
  country: string;
  orbitClass: OrbitClass;
}

/** Everything the panel shows about one object, at one moment. */
export interface DescribeRequest {
  type: 'describe';
  id: number;
  slot: number;
  /** Sim time (ms). */
  time: number;
  /** Also trace its orbit and ground track, which takes a few milliseconds. */
  paths: boolean;
}

export interface ObjectDetails {
  norad: number;
  name: string;
  /** International designator, e.g. 1998-067A. */
  cospar: string;
  type: ObjectType;
  station: boolean;
  /** Owner code as the catalogue gives it (US, PRC, CIS…), or empty. */
  country: string;
  launchDate: string;
  /** Launch site code, when the catalogue of working satellites has one. */
  site: string;
  /** When the orbit was measured (ms). */
  epoch: number;
  magnitude: number | null;
  giant: boolean;
  /** For payloads: whether it still works, once that's known. */
  working: boolean | null;
  orbit: OrbitNumbers;
}

export interface Whereabouts {
  altitudeKm: number;
  speedKms: number;
  sunlit: boolean;
  /** Scene units, in space (not turning with the Earth). */
  position: [number, number, number];
}

export interface DescribedMessage {
  type: 'described';
  id: number;
  details: ObjectDetails;
  /** Null when its orbit can't be worked out for this moment. */
  now: Whereabouts | null;
  paths: {
    /** One orbit centred on the moment asked, scene units in space, xyz per point. */
    orbit: Float32Array;
    /** Half an orbit back to a whole orbit ahead, on the turning Earth, xyz per point. */
    track: Float32Array;
    /** Index of the track point nearest the moment asked: before it is the past. */
    trackNow: number;
  } | null;
  /** The highlighted launch group strung together in order along the orbit, when one is highlighted. */
  train: Float32Array | null;
}

export interface SearchedMessage {
  type: 'searched';
  id: number;
  results: SearchResult[];
}

export interface CountedMessage {
  type: 'counted';
  id: number;
  count: number;
}

export interface FoundMessage {
  type: 'found';
  id: number;
  candidate: Candidate | null;
}

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

export type CatalogEvent = ElementsMessage | ProgressMessage | PickedMessage | DescribedMessage | FoundMessage | SearchedMessage | CountedMessage;
