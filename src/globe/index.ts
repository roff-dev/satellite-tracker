import { clock } from '../time/clock';
import { connectCatalog } from '../data/catalog';
import type { Dataset } from '../data/protocol';
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

/** Seconds before each automatic retry when something failed to load. */
const RETRY_AFTER = [30, 60, 120];

/** The globe with the catalogue on it: everything that needs three.js, loaded as one chunk. */
export function startGlobe(host: HTMLElement, onStatus: (status: CatalogStatus) => void) {
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

  const stopJump = clock.onJump((time) => catalog.jump(time));
  const stopFrame = globe.onFrame(() => {
    catalog.tick(clock.time, clock.speed);
    satellites.update(clock.time, globe.sun, globe.pixelRatio, globe.glowScale);
  });
  void globe.ready.then(() => satellites.start());

  return {
    globe,
    retryNow,
    dispose() {
      clearTimeout(retryTimer);
      stopJump();
      stopFrame();
      catalog.dispose();
      satellites.dispose();
      globe.dispose();
    },
  };
}
