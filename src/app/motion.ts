import { cubicIn } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The site's spring as an easing: a damped spring's step response with a damping ratio of 0.8, like the sheet's
 * Spring. It overshoots by 1.5% just past halfway and has settled by the end. `--spring` in tokens.css is the same
 * curve for CSS.
 */
export function spring(t: number) {
  const zeta = 0.8;
  const omega = 9;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

/** Numbers for CSS: fixed digits, since a value like 1e-7 isn't valid there. */
const n = (value: number) => value.toFixed(4);

const fade = (duration: number, delay = 0): TransitionConfig => ({ delay, duration, css: (t) => `opacity: ${n(t)}` });

/**
 * A facet unfolding out of the control that opened it, from the top-right corner where that control sits: across
 * first, then down, on the spring. Folding back is quicker and speeds up into the control. `reach` is the control's
 * width (px), the size the facet grows from. Without motion it simply fades.
 */
export function unfold(_node: Element, { reach = 44 } = {}, { direction }: { direction: 'in' | 'out' | 'both' }): TransitionConfig {
  if (reducedMotion()) return fade(120);
  const opening = direction !== 'out';
  return {
    duration: opening ? 420 : 200,
    easing: opening ? spring : cubicIn,
    css: (t) => {
      const left = `calc((100% - ${reach}px) * ${n(1 - Math.min(1, t * 1.25))})`;
      const bottom = `calc(100% * ${n(t)})`;
      return [
        `clip-path: polygon(calc(${left} + var(--chamfer)) 0, 100% 0, 100% max(0px, ${bottom} - var(--chamfer)), calc(100% - var(--chamfer)) ${bottom}, ${left} ${bottom}, ${left} min(var(--chamfer), ${bottom}))`,
        `opacity: ${n(Math.min(1, t * 4))}`,
      ].join('; ');
    },
  };
}

/** Content settling in once its surface has opened: up a few pixels and in, on the spring. */
export function rise(_node: Element, { delay = 0, distance = 6, duration = 340 } = {}): TransitionConfig {
  if (reducedMotion()) return fade(120, delay);
  return {
    delay,
    duration,
    easing: spring,
    css: (t, u) => `opacity: ${n(Math.min(1, t * 1.5))}; translate: 0 ${n(u * distance)}px`,
  };
}
