/// <reference lib="webworker" />
import {
  BulkPropagator,
  EciBaseCalculator,
  createSingleThreadRuntime,
  json2satrec,
  propagate,
  sunPos,
  jday,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import { CsvReader, readCsv, type Row } from '../data/csv';
import { Kind, type CatalogRequest, type Dataset, type ElementsMessage, type ProgressMessage } from '../data/protocol';
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
function countSunlit() {
  const { x, y, z } = sunPos(jday(new Date(anchorTime))).rsun;
  const n = Math.hypot(x, y, z);
  const sx = x / n, sy = y / n, sz = z / n;
  const day = anchorTime / DAY_MS;
  let lit = 0;
  for (let slot = 0; slot < recs.length; slot++) {
    const rx = anchorPositions[slot * 3]!, ry = anchorPositions[slot * 3 + 1]!, rz = anchorPositions[slot * 3 + 2]!;
    if (Number.isNaN(rx) || objects[slot]!.launchDay > day) continue;
    const along = rx * sx + ry * sy + rz * sz;
    const cx = ry * sz - rz * sy, cy = rz * sx - rx * sz, cz = rx * sy - ry * sx;
    if (along > 0 || cx * cx + cy * cy + cz * cz > EARTH_RADIUS_KM * EARTH_RADIUS_KM) lit++;
  }
  return lit;
}

function emit(anchored: boolean) {
  let buffer = spare.pop();
  while (buffer && buffer.byteLength !== master.byteLength) buffer = spare.pop();
  const el = buffer ? new Float32Array(buffer) : new Float32Array(master.length);
  el.set(master);
  const message: ElementsMessage = { type: 'elements', time: anchorTime, count: recs.length, el, sunlit: countSunlit(), anchored };
  scope.postMessage(message, [el.buffer]);
}

function addRow(row: Row) {
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
    objects.push({ norad, name, type: objectType(row, name), sizeClass: row.RCS_SIZE ?? '', epoch, launchDay: Number.isNaN(launch) ? 0 : launch });
  } else {
    // The same object from another source: take its type and size, and its orbit if newer
    const info = objects[slot]!;
    if (row.OBJECT_TYPE) info.type = objectType(row, name);
    if (row.RCS_SIZE) info.sizeClass = row.RCS_SIZE;
    if (!Number.isNaN(launch)) info.launchDay = launch;
    if (epoch > info.epoch) {
      info.epoch = epoch;
      recs[slot] = rec;
    }
  }
  bulkStale = true;
  writeStatic(slot);
  anchorOne(slot, new Date(anchorTime));
}

const loaded: Dataset[] = [];
const failed: Dataset[] = [];
let fetchedAt: string | null = null;

function progress(done: boolean) {
  const message: ProgressMessage = { type: 'progress', count: recs.length, loaded: [...loaded], failed: [...failed], fetchedAt, done };
  scope.postMessage(message);
}

/** The Worker's cached copy first, then the static snapshot taken at build time. */
async function fetchData(name: string): Promise<Response> {
  for (const url of [`/api/${name}`, `/snapshot/${name}.csv`]) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok && response.body) return response;
  }
  throw new Error(`No source for ${name}`);
}

async function loadCatalogue() {
  const datasets: Dataset[] = ['bright', 'payloads', 'debris'];
  // Requested together, read in order: the brightest objects reach the screen first
  const responses = datasets.map((name) => fetchData(name));
  responses.forEach((r) => r.catch(() => undefined));
  const rcs = fetch('/rcs.bin')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
  const wasm = createBulk().catch(() => null);

  for (const [i, name] of datasets.entries()) {
    try {
      const response = await responses[i]!;
      const at = response.headers.get('X-Fetched-At');
      if (at && (!fetchedAt || at < fetchedAt)) fetchedAt = at;
      let flushed = recs.length;
      const reader = new CsvReader(addRow);
      await readCsv(response.body!, reader, () => {
        if (recs.length - flushed < BATCH) return;
        flushed = recs.length;
        emit(false);
        progress(false);
      });
      loaded.push(name);
    } catch {
      failed.push(name);
    }
    emit(false);
    progress(false);
    if (name === 'bright') {
      const table = await rcs;
      if (table) rcsTable = decodeRcsTable(table);
      for (let slot = 0; slot < recs.length; slot++) writeStatic(slot);
    }
  }

  bulk = await wasm;
  progress(true);

  // Which payloads still work: only dims the dead ones, so it can wait
  try {
    const response = await fetchData('satcat');
    const active = new Set<number>();
    await readCsv(
      response.body!,
      new CsvReader((row) => {
        if (OPERATIONAL.has(row.OPS_STATUS_CODE ?? '')) active.add(Number(row.NORAD_CAT_ID));
      }),
    );
    operational = active;
    for (let slot = 0; slot < recs.length; slot++) writeStatic(slot);
    emit(false);
  } catch {
    // Every payload stays drawn as active
  }
}

scope.onmessage = (event: MessageEvent<CatalogRequest>) => {
  const request = event.data;
  if (request.type === 'recycle') {
    if (request.buffer.byteLength === master.byteLength) spare.push(request.buffer);
    return;
  }
  anchorAll(request.time);
  emit(true);
};

void loadCatalogue();
