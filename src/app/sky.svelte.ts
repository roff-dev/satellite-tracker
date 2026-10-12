import type { SkyCounts } from '../globe';
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
  show: (place: SkyPlace) => void;
  hide: () => void;
  watch: (norad: number, start: number) => void;
}>({ place: null, counts: null, passes: null, choosing: false, show: () => {}, hide: () => {}, watch: () => {} });
