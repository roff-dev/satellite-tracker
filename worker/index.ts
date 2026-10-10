import { refresh, type RefreshEnv } from './refresh';

export interface Env extends RefreshEnv {
  ASSETS: Fetcher;
}

type Meta = { fetchedAt: string; source: string };

// What the browser asks for, and which stored values make it up
const DATASETS: Record<string, string[]> = {
  bright: ['visual', 'stations'],
  payloads: ['payloads'],
  debris: ['debris'],
  satcat: ['satcat'],
  groups: ['groups'],
};
const STATUS_KEYS = ['payloads', 'debris', 'visual', 'stations', 'satcat', 'groups'];

async function serveDataset(env: Env, parts: string[]): Promise<Response> {
  const values = await Promise.all(parts.map((key) => env.ORBITS.getWithMetadata<Meta>(key, 'stream')));
  const present = values.filter((v) => v.value);
  if (!present.length) {
    return new Response('No orbit data yet', { status: 503, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  }
  const oldest = present.map((v) => v.metadata?.fetchedAt ?? '').sort()[0] ?? '';
  let body: ReadableStream = present[0]!.value!;
  if (present.length > 1) {
    // Concatenated stream by stream, never buffered or parsed; a newline between parts in case one lacks it
    const { readable, writable } = new TransformStream();
    void (async () => {
      const newline = new TextEncoder().encode('\n');
      for (const [i, { value }] of present.entries()) {
        if (i) {
          const writer = writable.getWriter();
          await writer.write(newline);
          writer.releaseLock();
        }
        await value!.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    })();
    body = readable;
  }
  return new Response(body, {
    headers: {
      // text/plain rather than text/csv: Cloudflare only compresses the former by default
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=6300',
      'X-Fetched-At': oldest,
      'X-Source': present.map((v) => v.metadata?.source).join(','),
    },
  });
}

async function serveStatus(env: Env): Promise<Response> {
  const entries = await Promise.all(STATUS_KEYS.map((key) => env.ORBITS.get(`status:${key}`, 'json')));
  return Response.json(entries.filter(Boolean), { headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/status') return serveStatus(env);
    const parts = DATASETS[path.replace(/^\/api\//, '')];
    if (parts) return serveDataset(env, parts);
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
