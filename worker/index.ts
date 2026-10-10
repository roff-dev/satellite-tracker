export interface Env {
  ORBITS: KVNamespace;
  ASSETS: Fetcher;
}

const DATASETS = ['bright', 'payloads', 'debris', 'satcat', 'groups'] as const;
type Dataset = (typeof DATASETS)[number];

const isDataset = (key: string): key is Dataset => (DATASETS as readonly string[]).includes(key);

async function serveDataset(env: Env, key: Dataset): Promise<Response> {
  const { value, metadata } = await env.ORBITS.getWithMetadata<{ fetchedAt: string; source: string }>(key, 'stream');
  if (!value) {
    return new Response('No orbit data yet', { status: 503, headers: { 'Retry-After': '600' } });
  }
  return new Response(value, {
    headers: {
      // text/plain rather than text/csv: Cloudflare only compresses the former by default
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=6300',
      'X-Fetched-At': metadata?.fetchedAt ?? '',
      'X-Source': metadata?.source ?? '',
    },
  });
}

async function serveStatus(env: Env): Promise<Response> {
  const entries = await Promise.all(DATASETS.map((key) => env.ORBITS.get(`status:${key}`, 'json')));
  return Response.json(entries.filter(Boolean), { headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/status') return serveStatus(env);
    const key = path.replace(/^\/api\//, '');
    if (isDataset(key)) return serveDataset(env, key);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
