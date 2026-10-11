// Simulation clock shared by the renderer, the workers and the UI.
type Listener = (time: number) => void;

const DAY_MS = 86_400_000;
/** How far from now the timeline reaches: a week each way, or 90 days with the wider range on. */
export const STANDARD_DAYS = 7;
export const EXTENDED_DAYS = 90;

let simTime = Date.now();
let speed = 1;
let paused = false;
let reachDays = STANDARD_DAYS;
const listeners = new Set<Listener>();

/** The window moves with real time, so "a week from now" stays a week from now. */
function clamp(time: number) {
  const now = Date.now();
  const reach = reachDays * DAY_MS;
  return Math.min(Math.max(time, now - reach), now + reach);
}

export const clock = {
  get time() {
    return simTime;
  },
  /** Sim ms per real ms; 0 while paused. Negative runs backwards. */
  get speed() {
    return paused ? 0 : speed;
  },
  /** The chosen rate, kept while paused. */
  get rate() {
    return speed;
  },
  get paused() {
    return paused;
  },
  get reachDays() {
    return reachDays;
  },
  /** Advance by a real-time step in milliseconds. Playback stops at the edge of the range. */
  tick(realMs: number) {
    if (paused) return;
    const next = simTime + realMs * speed;
    simTime = clamp(next);
    if (simTime !== next) paused = true;
  },
  set(time: number) {
    simTime = clamp(time);
    listeners.forEach((fn) => fn(simTime));
  },
  setSpeed(next: number) {
    speed = next;
  },
  setPaused(next: boolean) {
    paused = next;
  },
  /** Widen the timeline to 90 days each way, or narrow it back to a week (pulling the time inside it). */
  setReach(days: number) {
    reachDays = days;
    if (clamp(simTime) !== simTime) this.set(simTime);
  },
  now() {
    this.set(Date.now());
    speed = 1;
    paused = false;
  },
  /** Called on jumps (scrubbing, "now"), not on every tick. */
  onJump(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
