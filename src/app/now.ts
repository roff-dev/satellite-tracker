import { clock } from '../time/clock';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let flyBack = 0;

/** Ends a fly-back that's under way, when the clock is taken in hand some other way. */
export function stopFlyBack() {
  cancelAnimationFrame(flyBack);
  flyBack = 0;
}

/** Races the clock back to the present rather than cutting to it; without motion, it cuts. */
export function backToNow() {
  stopFlyBack();
  if (reducedMotion) return clock.now();
  const from = clock.time;
  const start = performance.now();
  clock.setPaused(true);
  const step = () => {
    const t = Math.min((performance.now() - start) / 900, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    clock.set(from + (Date.now() - from) * e);
    if (t < 1) flyBack = requestAnimationFrame(step);
    else {
      flyBack = 0;
      clock.now();
    }
  };
  flyBack = requestAnimationFrame(step);
}
