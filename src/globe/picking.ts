import { Matrix4, type PerspectiveCamera } from 'three';
import type { Candidate, PickRequest } from '../data/protocol';

type Pick = (request: Omit<PickRequest, 'type' | 'id'>) => Promise<Candidate[]>;

export interface PickingHandlers {
  /** A tap or click that didn't drag: every object under it, best first (empty for open space). */
  onTap(candidates: Candidate[]): void;
  /** The object under a resting mouse pointer, or null; with the pointer's position in the canvas. */
  onHover(candidate: Candidate | null, x: number, y: number): void;
}

/** A tap is a press that travels no further than this, in CSS pixels. */
const TAP_TRAVEL = 6;
const RADIUS = { mouse: 12, touch: 24 };
/** Hover picks at most this often while the mouse rests or creeps. */
const HOVER_MS = 100;

/**
 * Turns pointer input on the globe into picks. Positions are taken at the moment the pointer goes down,
 * so fast playback can't carry a satellite away from the finger before it lifts.
 */
export function attachPicking(canvas: HTMLCanvasElement, camera: PerspectiveCamera, simTime: () => number, pick: Pick, handlers: PickingHandlers) {
  const viewProjection = new Matrix4();
  const pointers = new Set<number>();
  let press: { x: number; y: number; request: Omit<PickRequest, 'type' | 'id'> } | null = null;

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
  };
  const snapshot = (event: PointerEvent, radius: number) => {
    const { x, y, width, height } = local(event);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const { x: cx, y: cy, z: cz } = camera.position;
    return { x, y, radius, width, height, viewProjection: [...viewProjection.elements], camera: [cx, cy, cz] as [number, number, number], time: simTime() };
  };

  function onDown(event: PointerEvent) {
    pointers.add(event.pointerId);
    // A second finger means a pinch, not a tap
    press = pointers.size === 1 ? { x: event.clientX, y: event.clientY, request: snapshot(event, event.pointerType === 'touch' ? RADIUS.touch : RADIUS.mouse) } : null;
    hover.cancel();
  }

  function onUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (!press) return;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const request = press.request;
    press = null;
    if (travel <= TAP_TRAVEL) void pick(request).then(handlers.onTap);
  }

  function onCancel(event: PointerEvent) {
    pointers.delete(event.pointerId);
    press = null;
  }

  const hover = (() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: PointerEvent | null = null;
    let inFlight = false;
    const run = () => {
      timer = undefined;
      if (!latest || inFlight) return;
      const event = latest;
      inFlight = true;
      const request = snapshot(event, RADIUS.mouse);
      void pick(request).then((candidates) => {
        inFlight = false;
        if (latest === event) handlers.onHover(candidates[0] ?? null, request.x, request.y);
        else if (latest) timer ??= setTimeout(run, HOVER_MS);
      });
    };
    return {
      move(event: PointerEvent) {
        latest = event;
        timer ??= setTimeout(run, HOVER_MS);
      },
      cancel() {
        clearTimeout(timer);
        timer = undefined;
        if (latest) handlers.onHover(null, 0, 0);
        latest = null;
      },
    };
  })();

  function onMove(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    hover.move(event);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', hover.cancel);
  return () => {
    hover.cancel();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', hover.cancel);
  };
}
