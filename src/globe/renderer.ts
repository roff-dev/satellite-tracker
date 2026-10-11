import { ACESFilmicToneMapping, Group, Scene, Timer, Vector3, WebGLRenderer } from 'three';
import { clock } from '../time/clock';
import { gmst, sunDirection } from '../orbit/frames';
import { createEarth } from './earth';
import { createAtmosphere } from './atmosphere';
import { createStars } from './stars';
import { createCamera, timezoneLongitude } from './camera';
import { createFpsProbe, initialTier, settingsFor, type Tier } from './quality';

export interface Globe {
  scene: Scene;
  inertial: Group;
  /** Unit vector towards the Sun in scene space, updated every frame. */
  sun: Vector3;
  readonly pixelRatio: number;
  ready: Promise<void>;
  onInteract(fn: () => void): () => void;
  onFrame(fn: (realSeconds: number) => void): () => void;
  readonly tier: Tier;
  dispose(): void;
}

export function createGlobe(host: HTMLElement): Globe {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier = initialTier();
  const renderer = new WebGLRenderer({
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
    // Close follow puts the camera metres from a satellite with the Earth thousands of km away
    logarithmicDepthBuffer: true,
  });
  let quality = settingsFor(tier);
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x05070c, 1);
  renderer.domElement.className = 'globe-canvas';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const inertial = new Group(); // orbits, stars, the Sun: fixed in space
  const earthFrame = new Group(); // turns with the Earth
  scene.add(inertial, earthFrame);

  const earth = createEarth();
  earthFrame.add(earth.group);
  const atmosphere = createAtmosphere();
  atmosphere.setFull(quality.fullAtmosphere);
  scene.add(atmosphere.mesh);
  void createStars(renderer.getPixelRatio()).then((stars) => inertial.add(stars));

  const view = createCamera(renderer.domElement, reducedMotion);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Satellite globe. Drag or use the arrow keys to turn it, plus and minus to zoom.');
  renderer.domElement.addEventListener('keydown', (e) => view.keyboard(e));

  const probe = createFpsProbe((next) => {
    tier = next;
    quality = settingsFor(tier);
    renderer.setPixelRatio(quality.pixelRatio);
    atmosphere.setFull(quality.fullAtmosphere);
    resize();
  }, renderer);
  probe.setTier(tier);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h, false);
    view.resize(w, h);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const frameListeners = new Set<(s: number) => void>();
  const sun = new Vector3();
  const timer = new Timer();
  let lastGmst = gmst(clock.time);
  let running = true;

  function frame(timestamp: number) {
    if (!running) return;
    requestAnimationFrame(frame);
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.1);
    clock.tick(dt * 1000);
    const g = gmst(clock.time);
    let deltaGmst = g - lastGmst;
    if (deltaGmst < -Math.PI) deltaGmst += 2 * Math.PI;
    lastGmst = g;
    earthFrame.rotation.y = g;
    view.followEarth(deltaGmst);
    sunDirection(clock.time, sun);
    earth.setSun(sun);
    atmosphere.setSun(sun);
    frameListeners.forEach((fn) => fn(dt));
    view.update(dt);
    renderer.render(scene, view.camera);
    probe.frame(performance.now());
  }

  if (import.meta.env.DEV) Object.assign(window, { __overhead: { view, renderer, scene } });

  // Shaders link in the background where the driver allows it, so the page stays responsive meanwhile
  const ready = earth.ready.then(async () => {
    await renderer.compileAsync(scene, view.camera);
    view.arrive(timezoneLongitude(), gmst(clock.time));
    requestAnimationFrame(frame);
  });

  return {
    scene,
    inertial,
    sun,
    ready,
    get pixelRatio() {
      return renderer.getPixelRatio();
    },
    get tier() {
      return tier;
    },
    onInteract: view.onInteract,
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    dispose() {
      running = false;
      observer.disconnect();
      view.dispose();
      renderer.dispose();
    },
  };
}
