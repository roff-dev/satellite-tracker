/** Object kinds as stored in the element buffer and read by the shader. */
export const Kind = { Active: 0, Dead: 1, Rocket: 2, Debris: 3 } as const;

export type Dataset = 'bright' | 'payloads' | 'debris';

export type CatalogRequest =
  /** Re-anchor every orbit at this sim time (ms). */
  | { type: 'anchor'; time: number }
  /** A buffer the renderer has finished with, handed back to be refilled. */
  | { type: 'recycle'; buffer: ArrayBuffer };

export interface ElementsMessage {
  type: 'elements';
  /** Sim time (ms) the orbits are anchored at. */
  time: number;
  count: number;
  el: Float32Array;
  /** Objects in sunlight at the anchor time. */
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
  done: boolean;
}

export type CatalogEvent = ElementsMessage | ProgressMessage;
