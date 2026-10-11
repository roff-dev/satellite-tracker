// Saves the live orbit data into the build as static files: the fallback when the Worker can't answer
// (down, or over its daily request limit), since static files are always served.
// Reads from SNAPSHOT_ORIGIN, e.g. https://overhead.example. Without it, or if the site can't be reached,
// it skips quietly and the build carries on.
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.SNAPSHOT_ORIGIN?.replace(/\/$/, '');
const DATASETS = ['bright', 'payloads', 'debris', 'satcat'];

if (!origin) {
  console.log('snapshot: SNAPSHOT_ORIGIN is not set, so no snapshot this build');
  process.exit(0);
}

await mkdir('dist/snapshot', { recursive: true });
const saved = [];
let fetchedAt = null;
for (const name of DATASETS) {
  try {
    const response = await fetch(`${origin}/api/${name}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!/^(OBJECT_NAME,|# )/.test(text)) throw new Error('not orbit data');
    await writeFile(`dist/snapshot/${name}.csv`, text);
    const at = response.headers.get('X-Fetched-At');
    if (at && (!fetchedAt || at < fetchedAt)) fetchedAt = at;
    saved.push(name);
    console.log(`snapshot: ${name} (${(text.length / 1e6).toFixed(1)} MB)`);
  } catch (error) {
    console.log(`snapshot: ${name} skipped (${error.message})`);
  }
}
if (saved.length) await writeFile('dist/snapshot/meta.json', JSON.stringify({ fetchedAt, datasets: saved }));
