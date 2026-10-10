import { clock } from '../time/clock';
import { connectCatalog } from '../data/catalog';
import type { Dataset } from '../data/protocol';
import { createGlobe } from './renderer';
import { createSatellites } from './satellites';

export interface CatalogStatus {
  /** Objects received so far. */
  count: number;
  /** Of those, how many are in sunlight right now. */
  sunlit: number;
  done: boolean;
  failed: Dataset[];
  fetchedAt: string | null;
}

/** The globe with the catalogue on it: everything that needs three.js, loaded as one chunk. */
export function startGlobe(host: HTMLElement, onStatus: (status: CatalogStatus) => void) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const globe = createGlobe(host);
  const satellites = createSatellites(reducedMotion);
  globe.inertial.add(satellites.points);

  let status: CatalogStatus = { count: 0, sunlit: 0, done: false, failed: [], fetchedAt: null };
  const update = (next: Partial<CatalogStatus>) => onStatus((status = { ...status, ...next }));

  const catalog = connectCatalog(clock.time, {
    onElements(message) {
      satellites.setElements(message);
      update({ count: message.count, sunlit: message.sunlit });
    },
    onProgress({ count, done, failed, fetchedAt }) {
      update({ count, done, failed, fetchedAt });
    },
  });

  const stopJump = clock.onJump((time) => catalog.jump(time));
  const stopFrame = globe.onFrame(() => {
    catalog.tick(clock.time, clock.speed);
    satellites.update(clock.time, globe.sun, globe.pixelRatio);
  });
  void globe.ready.then(() => satellites.start());

  return {
    globe,
    dispose() {
      stopJump();
      stopFrame();
      catalog.dispose();
      satellites.dispose();
      globe.dispose();
    },
  };
}
