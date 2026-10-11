import type { WebGLRenderer } from 'three';

export type Tier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: Tier;
  pixelRatio: number;
  antialias: boolean;
  fullAtmosphere: boolean;
}

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

export function initialTier(): Tier {
  const nav = navigator as NavigatorHints;
  const lowMemory = (nav.deviceMemory ?? 8) <= 4;
  const fewCores = (nav.hardwareConcurrency ?? 8) <= 4;
  if (lowMemory || fewCores || nav.connection?.saveData) return 'low';
  const finePointer = matchMedia('(pointer: fine)').matches;
  return finePointer ? 'high' : 'medium';
}

export function settingsFor(tier: Tier): QualitySettings {
  const dpr = window.devicePixelRatio || 1;
  switch (tier) {
    case 'high':
    case 'medium':
      return { tier, pixelRatio: Math.min(dpr, 2), antialias: true, fullAtmosphere: true };
    case 'low':
      return { tier, pixelRatio: Math.min(dpr, 1.5), antialias: false, fullAtmosphere: false };
  }
}

const lower: Record<Tier, Tier | null> = { high: 'medium', medium: 'low', low: null };

/**
 * Watches frame rate once things have settled and steps the tier down if the device can't keep up.
 * Two-second windows; below 55 fps counts as a miss, two misses in a row drop a tier.
 */
export function createFpsProbe(onDrop: (next: Tier) => void, renderer: WebGLRenderer) {
  let tier: Tier = 'high';
  let windowStart = 0;
  let frames = 0;
  let misses = 0;
  let armedAt = performance.now() + 4000;
  return {
    setTier(next: Tier) {
      tier = next;
      armedAt = performance.now() + 3000;
      frames = 0;
      windowStart = 0;
      misses = 0;
    },
    frame(now: number) {
      if (now < armedAt || document.hidden) return;
      if (!windowStart) windowStart = now;
      frames++;
      if (now - windowStart < 2000) return;
      const fps = (frames * 1000) / (now - windowStart);
      frames = 0;
      windowStart = now;
      misses = fps < 55 ? misses + 1 : 0;
      const next = lower[tier];
      if (misses >= 2 && next) {
        onDrop(next);
        this.setTier(next);
        renderer.info.reset();
      }
    },
  };
}
