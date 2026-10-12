import type { PassesReply, PassesRequest } from '../workers/passes.worker';

let worker: Worker | null = null;
let asked = 0;

/** Each station's next visible pass over a place, worked out in its own worker, started on first use. */
export function stationPasses(request: Omit<PassesRequest, 'id'>): Promise<PassesReply['next']> {
  worker ??= new Worker(new URL('../workers/passes.worker.ts', import.meta.url), { type: 'module' });
  const searcher = worker;
  const id = ++asked;
  return new Promise((resolve) => {
    const listen = ({ data }: MessageEvent<PassesReply>) => {
      if (data.id !== id) return;
      searcher.removeEventListener('message', listen);
      resolve(data.next);
    };
    searcher.addEventListener('message', listen);
    searcher.postMessage({ ...request, id });
  });
}
