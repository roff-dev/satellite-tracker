import { clock } from '../time/clock';
import { connectCatalog } from '../data/catalog';
import type { Candidate, Dataset } from '../data/protocol';
import { attachPicking } from './picking';
import { createGlobe } from './renderer';
import { createSatellites } from './satellites';

export interface CatalogStatus {
  /** Objects received so far. */
  count: number;
  /** Objects with a position right now: launched, and with a usable orbit. */
  positioned: number;
  /** Of those, how many are in sunlight. */
  sunlit: number;
  done: boolean;
  failed: Dataset[];
  fetchedAt: string | null;
  /** Some data came from the build-time snapshot because the live data didn't answer. */
  stale: boolean;
  /** Nothing could be loaded from anywhere; stays true through retries until data arrives. */
  unreachable: boolean;
  /** When the next automatic retry happens (epoch ms), if one is scheduled. */
  retryAt: number | null;
}

export interface Selection {
  /** Everything under the tap, best first; one of them is selected and the rest are nearby. */
  candidates: Candidate[];
  index: number;
}

export interface Hover {
  name: string;
  /** Pointer position in the canvas, CSS pixels. */
  x: number;
  y: number;
}

export interface GlobeHandlers {
  onStatus(status: CatalogStatus): void;
  onSelection(selection: Selection | null): void;
  onHover(hover: Hover | null): void;
}

/** Seconds before each automatic retry when something failed to load. */
const RETRY_AFTER = [30, 60, 120];

/** The globe with the catalogue on it: everything that needs three.js, loaded as one chunk. */
export function startGlobe(host: HTMLElement, { onStatus, onSelection, onHover }: GlobeHandlers) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const globe = createGlobe(host);
  const satellites = createSatellites(reducedMotion);
  globe.inertial.add(satellites.points, satellites.glowPoints);

  let status: CatalogStatus = { count: 0, positioned: 0, sunlit: 0, done: false, failed: [], fetchedAt: null, stale: false, unreachable: false, retryAt: null };
  const update = (next: Partial<CatalogStatus>) => onStatus((status = { ...status, ...next }));

  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  function retryNow() {
    clearTimeout(retryTimer);
    update({ retryAt: null });
    catalog.retry();
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = RETRY_AFTER[retries++];
    if (delay === undefined) return update({ retryAt: null });
    update({ retryAt: Date.now() + delay * 1000 });
    retryTimer = setTimeout(retryNow, delay * 1000);
  }

  const catalog = connectCatalog(clock.time, {
    onElements(message) {
      satellites.setElements(message);
      update({ count: message.count, positioned: message.positioned, sunlit: message.sunlit });
    },
    onProgress({ count, done, failed, fetchedAt, stale }) {
      const unreachable = count === 0 && (done || status.unreachable);
      update({ count, done, failed, fetchedAt, stale, unreachable });
      if (done && failed.length) scheduleRetry();
      else if (done) update({ retryAt: null });
    },
  });

  let selection: Selection | null = null;
  function select(next: Selection | null) {
    selection = next;
    satellites.setSelected(next ? next.candidates[next.index]!.slot : -1);
    onSelection(next);
  }
  const stopPicking = attachPicking(globe.canvas, globe.camera, () => clock.time, catalog.pick, {
    onTap(candidates) {
      select(candidates.length ? { candidates, index: 0 } : null);
    },
    onHover(candidate, x, y) {
      satellites.setHovered(candidate ? candidate.slot : -1);
      onHover(candidate ? { name: candidate.name, x, y } : null);
    },
  });
  function onKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'Escape' && selection) select(null);
    else if ((event.key === 'n' || event.key === 'N') && selection && selection.candidates.length > 1) {
      select({ ...selection, index: (selection.index + 1) % selection.candidates.length });
    } else return;
    event.preventDefault();
  }
  addEventListener('keydown', onKey);

  const stopJump = clock.onJump((time) => catalog.jump(time));
  const stopFrame = globe.onFrame(() => {
    catalog.tick(clock.time, clock.speed);
    satellites.update(clock.time, globe.sun, globe.pixelRatio, globe.glowScale);
  });
  void globe.ready.then(() => satellites.start());

  return {
    globe,
    retryNow,
    /** Swap the selection to another of the objects under the last tap. */
    choose(index: number) {
      if (selection) select({ ...selection, index });
    },
    deselect() {
      select(null);
    },
    /** Screen space covered by the object panel, so the globe can sit beside it. */
    setInsets(right: number, bottom: number) {
      globe.setInsets(right, bottom);
    },
    dispose() {
      clearTimeout(retryTimer);
      stopPicking();
      removeEventListener('keydown', onKey);
      stopJump();
      stopFrame();
      catalog.dispose();
      satellites.dispose();
      globe.dispose();
    },
  };
}
