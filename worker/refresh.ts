import { CELESTRAK, CSV_HEADER, SPACETRACK, USER_AGENT } from './sources';

export interface RefreshEnv {
  ORBITS: KVNamespace;
  SPACETRACK_USER?: string;
  SPACETRACK_PASS?: string;
}

export interface Status {
  key: string;
  source: 'space-track' | 'celestrak';
  http: number;
  at: string;
  note: string;
}

class SourceError extends Error {
  constructor(
    readonly http: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checks the first bytes look like the expected CSV, then hands back a stream of the whole body.
 * The body is never parsed: a free-plan Worker gets 10 ms of CPU, and waiting on I/O doesn't count.
 */
async function validated(response: Response): Promise<ReadableStream<Uint8Array>> {
  if (!response.ok || !response.body) throw new SourceError(response.status, (await response.text()).slice(0, 200));
  const reader = response.body.getReader();
  const first = await reader.read();
  const head = first.value ? new TextDecoder().decode(first.value.slice(0, 64)) : '';
  if (first.done || !head.startsWith(CSV_HEADER)) {
    await reader.cancel();
    throw new SourceError(response.status, `Unexpected body: ${head.slice(0, 120)}`);
  }
  return new ReadableStream({
    start(controller) {
      controller.enqueue(first.value);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function store(env: RefreshEnv, key: string, source: Status['source'], body: ReadableStream<Uint8Array>) {
  const at = new Date().toISOString();
  await env.ORBITS.put(key, body, { metadata: { fetchedAt: at, source } });
  await writeStatus(env, { key, source, http: 200, at, note: '' });
}

function writeStatus(env: RefreshEnv, status: Status) {
  return env.ORBITS.put(`status:${status.key}`, JSON.stringify(status));
}

async function fail(env: RefreshEnv, key: string, source: Status['source'], error: unknown) {
  const http = error instanceof SourceError ? error.http : 0;
  const note = error instanceof Error ? error.message.slice(0, 200) : String(error);
  await writeStatus(env, { key, source, http, at: new Date().toISOString(), note });
}

async function fromCelestrak(env: RefreshEnv, key: string, url: string) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    await store(env, key, 'celestrak', await validated(response));
    return true;
  } catch (error) {
    // CelesTrak asks clients to stop on any non-200 until the next update, so no retry here
    await fail(env, key, 'celestrak', error);
    return false;
  }
}

async function spaceTrackSession(env: RefreshEnv): Promise<string> {
  if (!env.SPACETRACK_USER || !env.SPACETRACK_PASS) throw new SourceError(0, 'Space-Track credentials are not set');
  const response = await fetch(`${SPACETRACK.base}/ajaxauth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ identity: env.SPACETRACK_USER, password: env.SPACETRACK_PASS }),
  });
  const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const text = await response.text();
  if (!response.ok || !cookies || text.includes('"Login":"Failed"')) throw new SourceError(response.status, 'Space-Track login failed');
  return cookies;
}

/** Payloads and everything else from Space-Track; CelesTrak's active list stands in for payloads if that fails. */
async function refreshCatalogue(env: RefreshEnv) {
  let cookie: string | null = null;
  try {
    cookie = await spaceTrackSession(env);
  } catch (error) {
    await fail(env, 'payloads', 'space-track', error);
    await fail(env, 'debris', 'space-track', error);
  }
  let payloadsOk = false;
  if (cookie) {
    for (const key of ['payloads', 'debris'] as const) {
      try {
        const response = await fetch(SPACETRACK.base + SPACETRACK.queries[key], { headers: { Cookie: cookie, 'User-Agent': USER_AGENT } });
        await store(env, key, 'space-track', await validated(response));
        if (key === 'payloads') payloadsOk = true;
      } catch (error) {
        await fail(env, key, 'space-track', error);
      }
    }
    await fetch(`${SPACETRACK.base}/ajaxauth/logout`, { headers: { Cookie: cookie, 'User-Agent': USER_AGENT } }).catch(() => undefined);
  }
  if (!payloadsOk) await fromCelestrak(env, 'payloads', CELESTRAK.active);
}

async function refreshGroups(env: RefreshEnv) {
  // A single value holding several small CelesTrak groups, each introduced by a "# name" line
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const put = env.ORBITS.put('groups', readable, { metadata: { fetchedAt: new Date().toISOString(), source: 'celestrak' } });
  let failures = 0;
  for (const [name, url] of CELESTRAK.groups) {
    try {
      const body = await validated(await fetch(url, { headers: { 'User-Agent': USER_AGENT } }));
      await writer.write(encoder.encode(`# ${name}\n`));
      const reader = body.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) await writer.write(chunk.value);
      await writer.write(encoder.encode('\n'));
    } catch {
      failures++;
    }
  }
  await writer.close();
  await put;
  await writeStatus(env, { key: 'groups', source: 'celestrak', http: failures ? 207 : 200, at: new Date().toISOString(), note: failures ? `${failures} groups failed` : '' });
}

export async function refresh(env: RefreshEnv, when: Date) {
  await refreshCatalogue(env);
  await fromCelestrak(env, 'visual', CELESTRAK.visual);
  await fromCelestrak(env, 'stations', CELESTRAK.stations);
  // The catalogue and group lists change slowly: twice a day, plus once on a fresh deploy
  const due = when.getUTCHours() % 12 === 0;
  if (due || !(await env.ORBITS.get('status:satcat'))) await fromCelestrak(env, 'satcat', CELESTRAK.satcat);
  if (due || !(await env.ORBITS.get('status:groups'))) await refreshGroups(env);
}
