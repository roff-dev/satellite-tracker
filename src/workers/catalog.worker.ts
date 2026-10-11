/// <reference lib="webworker" />
import {
  BulkPropagator,
  EciBaseCalculator,
  createSingleThreadRuntime,
  json2satrec,
  propagate,
  sunPos,
  jday,
  gstime,
  eciToGeodetic,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import { CsvReader, readCsv, type Row } from '../data/csv';
import {
  Kind,
  type CatalogRequest,
  type DescribeRequest,
  type DescribedMessage,
  type Dataset,
  type ElementsMessage,
  type FoundMessage,
  type PickRequest,
  type PickedMessage,
  type ProgressMessage,
  type Whereabouts,
} from '../data/protocol';
import { orbitNumbers } from '../orbit/describe';
import { STATION, VISUAL, findNearby } from '../data/pick';
import { GLINT, KIND, LAUNCH_DAY, STRIDE, writeElements } from '../orbit/elements';
import { decodeRcsTable, estimateBrightness, glintIntensity, type ObjectType } from '../orbit/brightness';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const DAY_MS = 86_400_000;
const EARTH_RADIUS_KM = 6371;
/** New objects are handed to the renderer this many at a time while the catalogue streams in. */
const BATCH = 1000;
const OPERATIONAL = new Set(['+', 'P', 'B', 'S', 'X']);

interface ObjectInfo {
  norad: number;
  name: string;
  type: ObjectType;
  sizeClass: string;
  epoch: number;
  launchDay: number;
  lists: number;
  /** International designator, e.g. 1998-067A. */
  cospar: string;
  country: string;
  launchDate: string;
}

const recs: SatRec[] = [];
const objects: ObjectInfo[] = [];
const slotOf = new Map<number, number>();
/** The renderer's buffer, kept here as the master copy; each message carries a copy of it. */
let master = new Float32Array(0);
/** TEME position (km) of each object at the anchor time, or NaN when SGP4 failed. */
let anchorPositions = new Float32Array(0);
let anchorTime = Date.now();
const spare: ArrayBuffer[] = [];

let rcsTable: Map<number, number> | null = null;
let operational: Set<number> | null = null;
/** Launch site codes, from the catalogue of working satellites. */
const siteOf = new Map<number, string>();
let bulk: Awaited<ReturnType<typeof createBulk>> | null = null;
let bulkStale = true;

async function createBulk() {
  const runtime = await createSingleThreadRuntime();
  return new BulkPropagator({ runtime, calculators: [new EciBaseCalculator()] as const, satRecsCount: 40_000, datesCount: 1 });
}

function objectType(row: Row, name: string): ObjectType {
  switch (row.OBJECT_TYPE) {
    case 'PAYLOAD':
      return 'payload';
    case 'ROCKET BODY':
      return 'rocket';
    case 'DEBRIS':
    case 'UNKNOWN':
    case 'TBA':
      return 'debris';
  }
  // CelesTrak's element sets carry no type, but the names follow a convention
  if (name.includes('R/B')) return 'rocket';
  if (/\bDEB\b/.test(name)) return 'debris';
  return 'payload';
}

function grow(count: number) {
  if (master.length >= count * STRIDE) return;
  const capacity = Math.ceil(Math.max(count, (master.length / STRIDE) * 1.5) / 1024) * 1024;
  const next = new Float32Array(capacity * STRIDE);
  next.set(master);
  master = next;
  const positions = new Float32Array(capacity * 3).fill(NaN);
  positions.set(anchorPositions);
  anchorPositions = positions;
  spare.length = 0;
}

function writeStatic(slot: number) {
  const info = objects[slot]!;
  const o = slot * STRIDE;
  const kind =
    info.type === 'rocket' ? Kind.Rocket : info.type === 'debris' ? Kind.Debris : operational && !operational.has(info.norad) ? Kind.Dead : Kind.Active;
  master[o + KIND] = kind;
  master[o + GLINT] = glintIntensity(estimateBrightness(info.type, rcsTable?.get(info.norad), info.sizeClass));
  master[o + LAUNCH_DAY] = info.launchDay;
}

function store(slot: number, position: ArrayLike<number> | null, velocity: ArrayLike<number> | null, i: number) {
  const o = slot * STRIDE;
  if (!position || !velocity) {
    master[o] = 0; // a = 0: the shader skips it
    anchorPositions[slot * 3] = NaN;
    return;
  }
  writeElements(master, o, position, velocity, i, recs[slot]!);
  anchorPositions[slot * 3] = position[i]!;
  anchorPositions[slot * 3 + 1] = position[i + 1]!;
  anchorPositions[slot * 3 + 2] = position[i + 2]!;
}

function anchorOne(slot: number, date: Date) {
  const state = propagate(recs[slot]!, date, { communityDecayCheckEnabled: true });
  if (!state) return store(slot, null, null, 0);
  const { position: p, velocity: v } = state;
  store(slot, [p.x, p.y, p.z], [v.x, v.y, v.z], 0);
}

function anchorAll(time: number) {
  anchorTime = time;
  const date = new Date(time);
  if (!bulk) {
    for (let slot = 0; slot < recs.length; slot++) anchorOne(slot, date);
    return;
  }
  if (bulkStale) {
    bulk.setSatRecs(recs);
    bulkStale = false;
  }
  bulk.setDates([date]);
  bulk.run({ eci: { communityDecayCheckEnabled: true } });
  const { position, velocity, error } = bulk.getRawOutput().eci;
  for (let slot = 0; slot < recs.length; slot++) {
    if (error[slot]) store(slot, null, null, 0);
    else store(slot, position, velocity, slot * 3);
  }
}

/** Cylindrical shadow: behind the Earth relative to the Sun and within one Earth radius of the axis. */
function countLight() {
  const { x, y, z } = sunPos(jday(new Date(anchorTime))).rsun;
  const n = Math.hypot(x, y, z);
  const sx = x / n, sy = y / n, sz = z / n;
  const day = anchorTime / DAY_MS;
  let lit = 0;
  let positioned = 0;
  for (let slot = 0; slot < recs.length; slot++) {
    const rx = anchorPositions[slot * 3]!, ry = anchorPositions[slot * 3 + 1]!, rz = anchorPositions[slot * 3 + 2]!;
    if (Number.isNaN(rx) || objects[slot]!.launchDay > day) continue;
    positioned++;
    const along = rx * sx + ry * sy + rz * sz;
    const cx = ry * sz - rz * sy, cy = rz * sx - rx * sz, cz = rx * sy - ry * sx;
    if (along > 0 || cx * cx + cy * cy + cz * cz > EARTH_RADIUS_KM * EARTH_RADIUS_KM) lit++;
  }
  return { positioned, sunlit: lit };
}

function emit(anchored: boolean) {
  let buffer = spare.pop();
  while (buffer && buffer.byteLength !== master.byteLength) buffer = spare.pop();
  const el = buffer ? new Float32Array(buffer) : new Float32Array(master.length);
  el.set(master);
  const message: ElementsMessage = { type: 'elements', time: anchorTime, count: recs.length, el, ...countLight(), anchored };
  scope.postMessage(message, [el.buffer]);
}

function addRow(row: Row, section: string) {
  const lists = section === 'stations' ? STATION : section === 'visual' ? VISUAL : 0;
  const norad = Number(row.NORAD_CAT_ID);
  if (!norad || !row.EPOCH) return;
  let rec: SatRec;
  try {
    rec = json2satrec(row as unknown as OMMJsonObject);
  } catch {
    return;
  }
  const name = row.OBJECT_NAME ?? '';
  const epoch = Date.parse(row.EPOCH.endsWith('Z') ? row.EPOCH : `${row.EPOCH}Z`);
  const launch = row.LAUNCH_DATE ? Date.parse(row.LAUNCH_DATE) / DAY_MS : NaN;
  let slot = slotOf.get(norad);
  if (slot === undefined) {
    slot = recs.length;
    grow(slot + 1);
    slotOf.set(norad, slot);
    recs.push(rec);
    objects.push({
      norad,
      name,
      type: objectType(row, name),
      sizeClass: row.RCS_SIZE ?? '',
      epoch,
      launchDay: Number.isNaN(launch) ? 0 : launch,
      lists,
      cospar: row.OBJECT_ID ?? '',
      country: row.COUNTRY_CODE ?? '',
      launchDate: row.LAUNCH_DATE ?? '',
    });
  } else {
    // The same object from another source: take its type and size, and its orbit if newer
    const info = objects[slot]!;
    if (row.OBJECT_TYPE) info.type = objectType(row, name);
    if (row.RCS_SIZE) info.sizeClass = row.RCS_SIZE;
    if (!Number.isNaN(launch)) {
      info.launchDay = launch;
      info.launchDate = row.LAUNCH_DATE!;
    }
    if (row.COUNTRY_CODE) info.country = row.COUNTRY_CODE;
    info.lists |= lists;
    if (epoch > info.epoch) {
      info.epoch = epoch;
      recs[slot] = rec;
    }
  }
  bulkStale = true;
  writeStatic(slot);
  anchorOne(slot, new Date(anchorTime));
}

const loaded = new Set<Dataset>();
let failed: Dataset[] = [];
let fetchedAt: string | null = null;
/** Any dataset in use came from the build-time snapshot rather than the live Worker. */
let stale = false;
let operationalLoaded = false;
let rcsReady: Promise<void> | null = null;
let wasmReady: Promise<void> | null = null;
let snapshotAge: Promise<string | null> | null = null;
let loading: Promise<void> | null = null;

function progress(done: boolean) {
  const message: ProgressMessage = { type: 'progress', count: recs.length, loaded: [...loaded], failed: [...failed], fetchedAt, stale, done };
  scope.postMessage(message);
}

function noteAge(at: string | null) {
  if (at && (!fetchedAt || at < fetchedAt)) fetchedAt = at;
}

/** Orbit data, not an error or fallback HTML page that a server answered with. */
const usable = (response: Response | null): response is Response =>
  !!response?.ok && !!response.body && !(response.headers.get('Content-Type') ?? '').includes('html');

/** The Worker's cached copy first, then the static snapshot taken at build time. */
async function fetchData(name: string): Promise<{ response: Response; snapshot: boolean }> {
  const live = await fetch(`/api/${name}`).catch(() => null);
  if (usable(live)) return { response: live, snapshot: false };
  const stored = await fetch(`/snapshot/${name}.csv`).catch(() => null);
  if (usable(stored)) return { response: stored, snapshot: true };
  throw new Error(`No source for ${name}`);
}

/** Reads every dataset not yet loaded, so calling it again retries only what failed. */
async function loadCatalogue() {
  const datasets = (['bright', 'payloads', 'debris'] as const).filter((name) => !loaded.has(name));
  failed = [];
  // Requested together, read in order: the brightest objects reach the screen first
  const responses = datasets.map((name) => fetchData(name));
  responses.forEach((r) => r.catch(() => undefined));
  rcsReady ??= fetch('/rcs.bin')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((table) => {
      if (table) rcsTable = decodeRcsTable(table);
    })
    .catch(() => undefined);
  wasmReady ??= createBulk()
    .then((propagator) => {
      bulk = propagator;
    })
    .catch(() => undefined);

  for (const [i, name] of datasets.entries()) {
    try {
      const { response, snapshot } = await responses[i]!;
      if (snapshot) {
        stale = true;
        snapshotAge ??= fetch('/snapshot/meta.json')
          .then((r) => (r.ok ? (r.json() as Promise<{ fetchedAt: string | null }>) : null))
          .then((meta) => meta?.fetchedAt ?? null)
          .catch(() => null);
        noteAge(await snapshotAge);
      } else noteAge(response.headers.get('X-Fetched-At'));
      let flushed = recs.length;
      const reader = new CsvReader(addRow);
      await readCsv(response.body!, reader, () => {
        if (recs.length - flushed < BATCH) return;
        flushed = recs.length;
        emit(false);
        progress(false);
      });
      loaded.add(name);
    } catch {
      failed.push(name);
    }
    emit(false);
    progress(false);
    if (name === 'bright') {
      await rcsReady;
      for (let slot = 0; slot < recs.length; slot++) writeStatic(slot);
    }
  }

  await wasmReady;
  progress(true);

  // Which payloads still work: only dims the dead ones, so it can wait
  if (operationalLoaded || !recs.length) return;
  try {
    const { response } = await fetchData('satcat');
    const active = new Set<number>();
    await readCsv(
      response.body!,
      new CsvReader((row) => {
        if (OPERATIONAL.has(row.OPS_STATUS_CODE ?? '')) active.add(Number(row.NORAD_CAT_ID));
        if (row.LAUNCH_SITE) siteOf.set(Number(row.NORAD_CAT_ID), row.LAUNCH_SITE);
      }),
    );
    operational = active;
    operationalLoaded = true;
    for (let slot = 0; slot < recs.length; slot++) writeStatic(slot);
    emit(false);
  } catch {
    // Every payload stays drawn as active
  }
}

function pick({ id, ...request }: PickRequest) {
  const message: PickedMessage = { type: 'picked', id, candidates: findNearby(master, objects, anchorTime, request) };
  scope.postMessage(message);
}

/** SGP4's Earth radius (WGS 72), the reference for its orbit heights. */
const SGP4_EARTH_KM = 6378.135;
/** Samples per orbit for the drawn path and ground track. */
const PATH_SAMPLES = 512;
/** Just above the highest land, so the track is never buried in the relief. */
const TRACK_RADIUS = 1.027;

function placeAt(rec: SatRec, date: Date) {
  return propagate(rec, date, { communityDecayCheckEnabled: true });
}

function whereabouts(rec: SatRec, time: number): Whereabouts | null {
  const date = new Date(time);
  const state = placeAt(rec, date);
  if (!state) return null;
  const { position: r, velocity: v } = state;
  const { x, y, z } = sunPos(jday(date)).rsun;
  const n = Math.hypot(x, y, z);
  const along = (r.x * x + r.y * y + r.z * z) / n;
  const across = Math.hypot(r.y * z - r.z * y, r.z * x - r.x * z, r.x * y - r.y * x) / n;
  return {
    // Measured from the same equatorial radius as its highest and lowest points, so it always falls between them
    altitudeKm: Math.hypot(r.x, r.y, r.z) - SGP4_EARTH_KM,
    speedKms: Math.hypot(v.x, v.y, v.z),
    sunlit: along > 0 || across > EARTH_RADIUS_KM,
    position: [r.x / EARTH_RADIUS_KM, r.z / EARTH_RADIUS_KM, -r.y / EARTH_RADIUS_KM],
  };
}

/** One orbit in space centred on the time, and the ground track from half an orbit back to one ahead. */
function trace(rec: SatRec, time: number) {
  const periodMs = ((2 * Math.PI) / rec.no) * 60_000;
  const step = periodMs / PATH_SAMPLES;
  const orbit: number[] = [];
  for (let i = -PATH_SAMPLES / 2; i <= PATH_SAMPLES / 2; i++) {
    const state = placeAt(rec, new Date(time + i * step));
    if (!state) continue;
    const { x, y, z } = state.position;
    orbit.push(x / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM, -y / EARTH_RADIUS_KM);
  }
  const track: number[] = [];
  let trackNow = 0;
  for (let i = -PATH_SAMPLES / 2; i <= PATH_SAMPLES; i++) {
    const date = new Date(time + i * step);
    const state = placeAt(rec, date);
    if (!state) continue;
    if (i <= 0) trackNow = track.length / 3;
    // Latitude and longitude on the Earth, in the axes of the turning globe
    const { latitude, longitude } = eciToGeodetic(state.position, gstime(date));
    const c = Math.cos(latitude) * TRACK_RADIUS;
    track.push(c * Math.cos(longitude), Math.sin(latitude) * TRACK_RADIUS, -c * Math.sin(longitude));
  }
  return { orbit: new Float32Array(orbit), track: new Float32Array(track), trackNow };
}

function describe({ id, slot, time, paths }: DescribeRequest) {
  const rec = recs[slot];
  const info = objects[slot];
  if (!rec || !info) return;
  const brightness = estimateBrightness(info.type, rcsTable?.get(info.norad), info.sizeClass);
  const traced = paths ? trace(rec, time) : null;
  const message: DescribedMessage = {
    type: 'described',
    id,
    details: {
      norad: info.norad,
      name: info.name,
      cospar: info.cospar,
      type: info.type,
      station: (info.lists & STATION) !== 0,
      country: info.country,
      launchDate: info.launchDate,
      site: siteOf.get(info.norad) ?? '',
      epoch: info.epoch,
      magnitude: brightness.magnitude,
      giant: brightness.giant,
      working: info.type === 'payload' && operational ? operational.has(info.norad) : null,
      orbit: orbitNumbers(rec),
    },
    now: whereabouts(rec, time),
    paths: traced,
  };
  scope.postMessage(message, traced ? [traced.orbit.buffer, traced.track.buffer] : []);
}

function find(id: number, norad: number) {
  const slot = slotOf.get(norad);
  const info = slot === undefined ? undefined : objects[slot];
  const message: FoundMessage = {
    type: 'found',
    id,
    candidate: info ? { slot: slot!, norad, name: info.name, type: info.type, station: (info.lists & STATION) !== 0, distance: 0 } : null,
  };
  scope.postMessage(message);
}

function load() {
  loading ??= loadCatalogue().finally(() => (loading = null));
}

scope.onmessage = (event: MessageEvent<CatalogRequest>) => {
  const request = event.data;
  if (request.type === 'recycle') {
    if (request.buffer.byteLength === master.byteLength) spare.push(request.buffer);
    return;
  }
  if (request.type === 'retry') return load();
  if (request.type === 'pick') return pick(request);
  if (request.type === 'describe') return describe(request);
  if (request.type === 'find') return find(request.id, request.norad);
  anchorAll(request.time);
  emit(true);
};

load();
