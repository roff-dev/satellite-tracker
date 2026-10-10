// Simulation clock shared by the renderer, the workers and the UI.
type Listener = (time: number) => void;

let simTime = Date.now();
let speed = 1;
let paused = false;
const listeners = new Set<Listener>();

export const clock = {
  get time() {
    return simTime;
  },
  get speed() {
    return paused ? 0 : speed;
  },
  get paused() {
    return paused;
  },
  /** Advance by a real-time step in milliseconds. */
  tick(realMs: number) {
    if (!paused) simTime += realMs * speed;
  },
  set(time: number) {
    simTime = time;
    listeners.forEach((fn) => fn(simTime));
  },
  setSpeed(next: number) {
    speed = next;
  },
  setPaused(next: boolean) {
    paused = next;
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
