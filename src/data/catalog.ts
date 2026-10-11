import type { Candidate, CatalogEvent, CatalogRequest, CountedMessage, DescribedMessage, ElementsMessage, PickRequest, ProgressMessage, SearchResult, SearchedMessage } from './protocol';

type Reply = Extract<CatalogEvent, { id: number }>;
/** A request that expects a reply, before its id is attached. */
type Question = Extract<CatalogRequest, { id: number }> extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

/** How far (sim ms) the drawn orbits may drift from their anchor before the worker re-anchors them. */
const ANCHOR_SPAN = 60_000;
/**
 * At least this long (real ms) between re-anchors. While scrubbing, the shader carries the orbits between
 * anchors to within a few km, so a fresh 2 MB upload every frame would buy nothing but dropped frames.
 */
const ANCHOR_GAP_MS = 66;

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
  let lastSent = -Infinity;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let shown: Float32Array | null = null;
  let requestId = 0;
  const replies = new Map<number, (reply: Reply) => void>();
  /** Sends a request that gets one reply, matched up by id. */
  function ask<T extends Reply>(request: Question) {
    const id = ++requestId;
    send({ ...request, id } as CatalogRequest);
    return new Promise<T>((resolve) => replies.set(id, resolve as (reply: Reply) => void));
  }

  function anchor(time: number) {
    const early = lastSent + ANCHOR_GAP_MS - performance.now();
    if (inFlight || early > 0) {
      wanted = time;
      if (!inFlight && early > 0) waiting ??= setTimeout(followUp, early);
      return;
    }
    inFlight = true;
    lastSent = performance.now();
    send({ type: 'anchor', time });
  }

  /** The latest time asked for while busy, if it's still worth anchoring at. */
  function followUp() {
    waiting = undefined;
    if (wanted === null) return;
    const next = wanted;
    wanted = null;
    if (Math.abs(next - anchorTime) > 1000) anchor(next);
  }

  worker.onmessage = ({ data }: MessageEvent<CatalogEvent>) => {
    if (data.type === 'progress') return handlers.onProgress(data);
    if ('id' in data) {
      replies.get(data.id)?.(data);
      replies.delete(data.id);
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
    followUp();
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
    async pick(request: Omit<PickRequest, 'type' | 'id'>): Promise<Candidate[]> {
      const reply = await ask<Extract<Reply, { type: 'picked' }>>({ type: 'pick', ...request });
      return reply.candidates;
    },
    /** Details, position and (when asked) the orbit and ground track of one object. */
    describe(slot: number, time: number, paths: boolean) {
      return ask<DescribedMessage>({ type: 'describe', slot, time, paths });
    },
    /** The object with this catalogue number, if it's loaded. */
    async find(norad: number): Promise<Candidate | null> {
      const reply = await ask<Extract<Reply, { type: 'found' }>>({ type: 'find', norad });
      return reply.candidate;
    },
    /** Objects matching a name, catalogue number or international designator, best first. */
    async search(query: string): Promise<SearchResult[]> {
      return (await ask<SearchedMessage>({ type: 'search', query })).results;
    },
    /** How many members of a group (a filter code) have a position now. */
    async count(filter: number): Promise<number> {
      return (await ask<CountedMessage>({ type: 'count', filter })).count;
    },
    /** Mark every object from one launch, or none; resolves with how many there are. */
    async highlight(launch: string | null): Promise<number> {
      return (await ask<CountedMessage>({ type: 'highlight', launch })).count;
    },
    /** Fetch again whatever failed to load. */
    retry() {
      send({ type: 'retry' });
    },
    /** The kinds being shown, one bit per kind, so taps only find what's drawn. */
    setKinds(mask: number) {
      send({ type: 'kinds', mask });
    },
    dispose() {
      clearTimeout(waiting);
      worker.terminate();
    },
  };
}
