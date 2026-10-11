import type { Candidate, CatalogEvent, CatalogRequest, ElementsMessage, PickRequest, ProgressMessage } from './protocol';

/** How far (sim ms) the drawn orbits may drift from their anchor before the worker re-anchors them. */
const ANCHOR_SPAN = 60_000;

export interface CatalogHandlers {
  onElements(message: ElementsMessage): void;
  onProgress(message: ProgressMessage): void;
}

/**
 * The catalogue worker and its re-anchoring schedule. One request is in flight at a time; anything
 * asked for meanwhile collapses into a single follow-up for the latest time, so scrubbing never
 * queues up stale work.
 */
export function connectCatalog(startTime: number, handlers: CatalogHandlers) {
  const worker = new Worker(new URL('../workers/catalog.worker.ts', import.meta.url), { type: 'module' });
  const send = (request: CatalogRequest, transfer: Transferable[] = []) => worker.postMessage(request, transfer);

  let anchorTime = startTime;
  let inFlight = false;
  let wanted: number | null = null;
  let shown: Float32Array | null = null;
  let pickId = 0;
  const picks = new Map<number, (candidates: Candidate[]) => void>();

  function anchor(time: number) {
    if (inFlight) {
      wanted = time;
      return;
    }
    inFlight = true;
    send({ type: 'anchor', time });
  }

  worker.onmessage = ({ data }: MessageEvent<CatalogEvent>) => {
    if (data.type === 'progress') return handlers.onProgress(data);
    if (data.type === 'picked') {
      picks.get(data.id)?.(data.candidates);
      picks.delete(data.id);
      return;
    }
    const previous = shown;
    shown = data.el;
    anchorTime = data.time;
    handlers.onElements(data);
    // The renderer now reads the new buffer, so the old one goes back to be refilled
    if (previous && previous.buffer.byteLength) send({ type: 'recycle', buffer: previous.buffer as ArrayBuffer }, [previous.buffer]);
    if (!data.anchored) return;
    inFlight = false;
    if (wanted !== null) {
      const next = wanted;
      wanted = null;
      if (Math.abs(next - anchorTime) > 1000) anchor(next);
    }
  };

  anchor(startTime);

  return {
    /** Each frame: re-anchor when the drawn orbits have drifted too far, leading a little in the direction of play. */
    tick(time: number, speed: number) {
      if (Math.abs(time - anchorTime) <= ANCHOR_SPAN) return;
      const lead = Math.sign(speed) * Math.min(Math.abs(speed) * 200, ANCHOR_SPAN / 2);
      anchor(time + lead);
    },
    /** Timeline jumps re-anchor straight away. */
    jump: anchor,
    /** The objects drawn near a point on screen, best first. */
    pick(request: Omit<PickRequest, 'type' | 'id'>) {
      const id = ++pickId;
      send({ type: 'pick', id, ...request });
      return new Promise<Candidate[]>((resolve) => picks.set(id, resolve));
    },
    /** Fetch again whatever failed to load. */
    retry() {
      send({ type: 'retry' });
    },
    dispose() {
      worker.terminate();
    },
  };
}
