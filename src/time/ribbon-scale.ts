const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The hour either side of now takes this share of each half of the ribbon, so fine control is easy there. */
const NEAR_SHARE = 0.3;

/**
 * Maps a time offset from now to a position across the ribbon, −1 (the start of the range) to 1 (the end),
 * and back. Linear within an hour of now; logarithmic beyond, out to the edge of the range.
 */
export function createRibbonScale(reachDays: number) {
  const far = Math.log((reachDays * DAY_MS) / HOUR_MS);
  return {
    toPosition(offsetMs: number) {
      const hours = Math.abs(offsetMs) / HOUR_MS;
      const reach = (reachDays * DAY_MS) / HOUR_MS;
      const x = hours <= 1 ? hours * NEAR_SHARE : NEAR_SHARE + ((1 - NEAR_SHARE) * Math.log(Math.min(hours, reach))) / far;
      return Math.sign(offsetMs) * x;
    },
    toOffset(position: number) {
      const x = Math.min(Math.abs(position), 1);
      const hours = x <= NEAR_SHARE ? x / NEAR_SHARE : Math.exp(((x - NEAR_SHARE) / (1 - NEAR_SHARE)) * far);
      return Math.sign(position) * hours * HOUR_MS;
    },
  };
}
