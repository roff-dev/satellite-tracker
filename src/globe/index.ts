import { clock } from '../time/clock';
import { connectCatalog } from '../data/catalog';
import { Vector3 } from 'three';
import type { Candidate, Dataset, ObjectDetails, Whereabouts } from '../data/protocol';
import { attachPicking } from './picking';
import { createTrack } from './track';
import { createFollow } from './follow';
import { COLOUR_BY, CONSTELLATIONS, GROUPS, HIGHLIGHT_BIT, launchOf, type ColourBy } from '../data/groups';
import { createGlobe } from './renderer';
import { createSatellites } from './satellites';

export interface CatalogStatus {
  /** Objects received so far. */
  count: number;
  /** Objects with a position right now: launched, and with a usable orbit. */
  positioned: number;
  /** Of those, how many are in sunlight. */
  sunlit: number;
  unlaunched: number;
  unplaceable: number;
  live: number;
  /** Positioned objects of each kind, indexed by Kind. */
  kinds: number[];
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

export interface Described {
  /** The moment the numbers are for (sim time, ms). */
  time: number;
  details: ObjectDetails;
  /** Null when its orbit can't be worked out for the moment shown. */
  now: Whereabouts | null;
}

export interface GlobeHandlers {
  onStatus(status: CatalogStatus): void;
  onSelection(selection: Selection | null): void;
  /** The selected object's details and live position, a few times a second; null when nothing is selected. */
  onDescribed(described: Described | null): void;
  /** The name of the object the camera is riding with, or null. */
  onFollow(name: string | null): void;
  onHover(hover: Hover | null): void;
}

/** Where a shared link starts: an object to select and a moment to show. */
export interface StartAt {
  norad?: number;
  time?: number;
}

/** How often the panel's live numbers refresh. */
const DESCRIBE_MS = 250;

/** Seconds before each automatic retry when something failed to load. */
const RETRY_AFTER = [30, 60, 120];

/** The globe with the catalogue on it: everything that needs three.js, loaded as one chunk. */
export function startGlobe(host: HTMLElement, { onStatus, onSelection, onDescribed, onFollow, onHover }: GlobeHandlers, start: StartAt = {}) {
  if (start.time !== undefined) clock.set(start.time);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const globe = createGlobe(host);
  const satellites = createSatellites(reducedMotion, globe.quality.trails);
  globe.inertial.add(satellites.points, satellites.glowPoints, satellites.trailLines);

  let status: CatalogStatus = { count: 0, positioned: 0, sunlit: 0, unlaunched: 0, unplaceable: 0, live: 0, kinds: [0, 0, 0, 0], done: false, failed: [], fetchedAt: null, stale: false, unreachable: false, retryAt: null };
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
      const { count, positioned, sunlit, unlaunched, unplaceable, live, kinds } = message;
      update({ count, positioned, sunlit, unlaunched, unplaceable, live, kinds });
    },
    onProgress({ count, done, failed, fetchedAt, stale }) {
      const unreachable = count === 0 && (done || status.unreachable);
      update({ count, done, failed, fetchedAt, stale, unreachable });
      // A shared link names an object: select it once the catalogue is in, and turn to face it
      if (done && start.norad !== undefined) {
        const norad = start.norad;
        start.norad = undefined;
        void catalog.find(norad).then((candidate) => candidate && select({ candidates: [candidate], index: 0 }, true));
      }
      if (done && failed.length) scheduleRetry();
      else if (done) update({ retryAt: null });
    },
  });

  const track = createTrack(globe.inertial, globe.earthFixed);
  const follow = createFollow({
    camera: globe.camera,
    inertial: globe.inertial,
    sun: globe.sun,
    reducedMotion,
    positionOf: (slot, time, out) => satellites.positionOf(slot, time, out),
    hide: (slot) => satellites.setHidden(slot),
    suspendCamera: () => globe.suspendCamera(),
    resumeCamera: () => globe.resumeCamera(),
    restDistance: () => globe.restDistance,
  });

  // A launch group shown for the selected constellation satellite, and the group filter in force
  let launch: string | null = null;
  let filter = -1;
  async function showLaunch(on: boolean, cospar = '') {
    launch = on ? launchOf(cospar) : null;
    if (!launch) track.setTrain(null);
    satellites.setFilter(launch ? HIGHLIGHT_BIT : filter);
    return catalog.highlight(launch);
  }

  function startFollowing() {
    if (!selection || follow.following !== null) return;
    const candidate = selection.candidates[selection.index]!;
    follow.start(candidate.slot, candidate.norad, performance.now(), () => {
      track.setVisible(true);
      onFollow(null);
    });
    // Riding along is about the view; the orbit and track lines would only cut across it
    track.setVisible(false);
    onFollow(candidate.name);
  }
  function stopFollowing() {
    follow.stop(performance.now());
  }
  let selection: Selection | null = null;
  /** Everything but the selected object hidden, and taps finding only it. */
  let solo = false;
  function setSolo(on: boolean) {
    solo = on && selection !== null;
    satellites.setSolo(solo);
  }
  let describeTimer: ReturnType<typeof setInterval> | undefined;
  /** When the drawn paths were traced, and how long one sample of them spans. */
  let traced: { slot: number; time: number; stepMs: number } | null = null;
  const point = new Vector3();

  const selectedSlot = () => (selection ? selection.candidates[selection.index]!.slot : -1);

  async function describe(fly = false) {
    const slot = selectedSlot();
    if (slot < 0) return;
    const time = clock.time;
    const paths = !traced || traced.slot !== slot || Math.abs(time - traced.time) > traced.stepMs;
    const reply = await catalog.describe(slot, time, paths);
    // The selection may have moved on while the worker was answering
    if (selectedSlot() !== slot) return;
    track.setTrain(reply.train);
    if (reply.paths) {
      track.set(reply.paths.orbit, reply.paths.track, reply.paths.trackNow);
      traced = { slot, time, stepMs: (reply.details.orbit.periodMinutes * 60_000) / 512 };
    }
    if (fly && reply.now) globe.flyTo(point.fromArray(reply.now.position));
    onDescribed({ time: reply.time, details: reply.details, now: reply.now });
  }

  function select(next: Selection | null, fly = false) {
    // Riding along ends when the object it was riding with is no longer the selection, and so does showing it alone
    if (follow.following !== null) stopFollowing();
    if (solo) setSolo(false);
    // A launch group belongs to the object it was shown for
    const previous = selection ? selection.candidates[selection.index]!.norad : null;
    const now = next ? next.candidates[next.index]!.norad : null;
    if (launch && previous !== now) void showLaunch(false);
    selection = next;
    satellites.setSelected(selectedSlot());
    clearInterval(describeTimer);
    traced = null;
    track.clear();
    onSelection(next);
    onDescribed(null);
    if (!next) return;
    void describe(fly);
    describeTimer = setInterval(() => void describe(), DESCRIBE_MS);
  }
  const stopPicking = attachPicking(globe.canvas, globe.camera, () => clock.time, catalog.pick, {
    onTap(candidates) {
      if (follow.following !== null) return;
      // Shown alone, the selected object is the only one there is to find: a tap on it changes nothing
      if (solo) {
        if (candidates.some((c) => c.slot === selectedSlot())) return;
        candidates = [];
      }
      select(candidates.length ? { candidates, index: 0 } : null);
    },
    onHover(candidate, x, y) {
      if (solo && candidate && candidate.slot !== selectedSlot()) candidate = null;
      satellites.setHovered(candidate ? candidate.slot : -1);
      onHover(candidate ? { name: candidate.name, x, y } : null);
    },
  });
  function onKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'Escape' && follow.following !== null) stopFollowing();
    else if (event.key === 'Escape' && selection) select(null);
    else if ((event.key === 'f' || event.key === 'F') && selection) {
      if (follow.following !== null) stopFollowing();
      else startFollowing();
    }
    else if ((event.key === 'n' || event.key === 'N') && selection && selection.candidates.length > 1) {
      select({ ...selection, index: (selection.index + 1) % selection.candidates.length });
    } else return;
    event.preventDefault();
  }
  addEventListener('keydown', onKey);

  const stopJump = clock.onJump((time) => catalog.jump(time));
  // Line widths need the canvas size; reading it every frame would force a layout each time
  const sized = new ResizeObserver(([entry]) => track.setResolution(entry!.contentRect.width, entry!.contentRect.height));
  sized.observe(globe.canvas);
  const stopFrame = globe.onFrame(() => {
    catalog.tick(clock.time, clock.speed);
    satellites.update(clock.time, globe.sun, globe.pixelRatio, globe.glowScale, clock.speed, globe.quality.trails);
    follow.update(performance.now(), clock.time);
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
    follow: startFollowing,
    stopFollowing,
    /** Hide everything but the selected object, or bring it all back. */
    setSolo,
    search: (query: string) => catalog.search(query),
    /** Select an object found some other way than tapping it, and turn to face it. */
    selectFound(candidate: Candidate) {
      select({ candidates: [candidate], index: 0 }, true);
    },
    /** Pick out a group by its slug, or null for everything; resolves with how many are in it. */
    async setGroup(slug: string | null) {
      const group = slug ? GROUPS.find((g) => g.slug === slug) : undefined;
      filter = group ? group.filter : -1;
      if (!launch) satellites.setFilter(filter);
      return group ? catalog.count(group.filter) : 0;
    },
    setColourBy(mode: ColourBy) {
      satellites.setColourBy(COLOUR_BY[mode]);
    },
    /** Which kinds are drawn and can be tapped, one bit per kind. */
    setKinds(mask: number) {
      satellites.setKinds(mask);
      catalog.setKinds(mask);
    },
    /** For a constellation satellite: show every object from its launch; resolves with how many. */
    showLaunch,
    /** Whether a name belongs to a constellation whose launches can be shown. */
    isConstellation: (name: string) => CONSTELLATIONS.some(([prefix]) => name.startsWith(prefix)),
    /** Screen space covered by the panel, timeline and top controls, so the globe can sit in what's left. */
    setInsets: globe.setInsets,
    dispose() {
      clearTimeout(retryTimer);
      clearInterval(describeTimer);
      sized.disconnect();
      track.dispose();
      follow.dispose();
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
