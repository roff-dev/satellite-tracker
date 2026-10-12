import type { SkyCounts, SkyShowing } from '../globe';
import type { SkyPlace } from '../location/location';
import type { Pass } from '../sky/passes';

export interface StationPass {
  norad: number;
  name: string;
  pass: Pass;
}

/** My sky: the place shown, what's above it, and the space stations' next passes; with the actions to change it. */
export const sky = $state<{
  /** The place the sky is shown from, while My sky is on. */
  place: SkyPlace | null;
  counts: SkyCounts | null;
  /** Each station's next visible pass, soonest first; null while it's still being worked out. */
  passes: StationPass[] | null;
  /** The place chooser is open. */
  choosing: boolean;
  /** What the globe shows: only what's inside the dome until asked for everything, or for what's seen by eye. */
  showing: SkyShowing;
  show: (place: SkyPlace) => void;
  hide: () => void;
  setShowing: (showing: SkyShowing) => void;
  watch: (norad: number, start: number) => void;
}>({ place: null, counts: null, passes: null, choosing: false, showing: 'dome', show: () => {}, hide: () => {}, setShowing: () => {}, watch: () => {} });
