// The space stations' visible passes over a place, a week ahead. Its own worker, so the search never holds up the
// catalogue worker re-anchoring the orbits.
import type { SatRec } from 'satellite.js';
import { findPasses, type Pass } from '../sky/passes';

export interface PassesRequest {
  id: number;
  lat: number;
  lon: number;
  from: number;
  to: number;
  orbits: { norad: number; name: string; satrec: SatRec }[];
}

export interface PassesReply {
  id: number;
  /** Each station's next visible pass, if it has one in the window. */
  next: { norad: number; name: string; pass: Pass }[];
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = ({ data }: MessageEvent<PassesRequest>) => {
  const next: PassesReply['next'] = [];
  for (const { norad, name, satrec } of data.orbits) {
    const [pass] = findPasses(satrec, data.lat, data.lon, data.from, data.to, 1);
    if (pass) next.push({ norad, name, pass });
  }
  next.sort((a, b) => a.pass.start - b.pass.start);
  const reply: PassesReply = { id: data.id, next };
  scope.postMessage(reply);
};
