import { Color, Group, HalfFloatType, Scene, Timer, Vector3, WebGLRenderer, type PerspectiveCamera } from 'three';
import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { clock } from '../time/clock';
import { gmst, sunDirection } from '../orbit/frames';
import { createEarth } from './earth';
import { createAtmosphere } from './atmosphere';
import { createStars } from './stars';
import { createCamera, timezoneLongitude } from './camera';
import { createFpsProbe, initialTier, settingsFor, type QualitySettings, type Tier } from './quality';
import { GlowEffect, compilePasses } from './glow';

export interface Globe {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  inertial: Group;
  /** Turns with the Earth: things fixed to the ground go here. */
  earthFixed: Group;
  /** Turns the view to face a point in space (scene units). */
  flyTo(point: Vector3): void;
  /** Hand the camera to something else (following an object), and take it back. */
  suspendCamera(): void;
  resumeCamera(): void;
  readonly restDistance: number;
  readonly reducedMotion: boolean;
  /** Unit vector towards the Sun in scene space, updated every frame. */
  sun: Vector3;
  readonly pixelRatio: number;
  /** Resolution of the glow buffer relative to the screen; 0 when glow is off. */
  readonly glowScale: number;
  readonly quality: QualitySettings;
  ready: Promise<void>;
  /** Settles once the opening flight has come to rest. */
  arrived: Promise<void>;
  /** Centres the globe in the space the panels leave, as touching it does, but keeps the idle turn going. */
  explore(): void;
  onInteract(fn: () => void): () => void;
  /** Screen space covered by panels (CSS px), so the globe can centre itself in the rest. */
  setInsets(right: number, bottom: number): void;
  onFrame(fn: (realSeconds: number) => void): () => void;
  readonly tier: Tier;
  dispose(): void;
}

export function createGlobe(host: HTMLElement): Globe {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier = initialTier();
  const renderer = new WebGLRenderer({
    // Antialiasing comes from the composer's multisampling when glow is on; the low tier goes without
    antialias: false,
    powerPreference: 'high-performance',
    // Close follow puts the camera metres from a satellite with the Earth thousands of km away
    logarithmicDepthBuffer: true,
  });
  let quality = settingsFor(tier);
  renderer.setPixelRatio(quality.pixelRatio);
  const space = new Color(0x05070c);
  renderer.setClearColor(space, 1);
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

  function applyTier(next: Tier) {
    tier = next;
    quality = settingsFor(tier);
    renderer.setPixelRatio(quality.pixelRatio);
    atmosphere.setFull(quality.fullAtmosphere);
    configureGlow();
    resize();
  }
  const probe = createFpsProbe(applyTier, renderer);
  probe.setTier(tier);

  // Glowing satellites and sea sparkle: a composer with a glow pass on the tiers that can afford it
  let composer: EffectComposer | null = null;
  let glow: GlowEffect | null = null;
  let effectPass: EffectPass | null = null;
  function configureGlow() {
    if (!quality.glow) {
      composer?.dispose();
      composer = glow = effectPass = null;
      renderer.setClearColor(space, 1);
      return;
    }
    // three encodes the clear colour for the screen even when clearing the composer's linear buffer, and the
    // composer encodes again on output; clearing with the pre-decoded colour leaves space exactly --void
    renderer.setClearColor(space.clone().convertSRGBToLinear(), 1);
    if (!composer) {
      composer = new EffectComposer(renderer, { multisampling: 4, frameBufferType: HalfFloatType });
      composer.addPass(new RenderPass(scene, view.camera));
      glow = new GlowEffect(scene, view.camera);
      effectPass = new EffectPass(view.camera, glow);
      composer.addPass(effectPass);
    }
    glow!.scale = quality.glow;
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h, false);
    view.resize(w, h);
  }
  configureGlow();
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
    if (composer) composer.render(dt);
    else renderer.render(scene, view.camera);
    probe.frame(performance.now());
  }

  if (import.meta.env.DEV) Object.assign(window, { __overhead: { view, renderer, scene, applyTier, clock } });

  // Shaders link in the background where the driver allows it, so the page stays responsive meanwhile
  const ready = earth.ready.then(async () => {
    // Every material in the scene, hidden ones and the glow copies included, compiled for the buffer it'll draw
    // into, so nothing compiles again on the first frame
    renderer.setRenderTarget(composer ? composer.inputBuffer : null);
    await renderer.compileAsync(scene, view.camera);
    renderer.setRenderTarget(null);
    if (composer && glow && effectPass) await compilePasses(renderer, view.camera, glow.blurMaterials, [effectPass.fullscreenMaterial], composer.inputBuffer);
    view.arrive(timezoneLongitude(), gmst(clock.time));
    requestAnimationFrame(frame);
  });

  return {
    scene,
    camera: view.camera,
    canvas: renderer.domElement,
    inertial,
    earthFixed: earthFrame,
    flyTo: (point: Vector3) => view.flyTo(point),
    suspendCamera: () => view.suspend(),
    resumeCamera: () => view.resume(),
    get restDistance() {
      return view.restDistance;
    },
    reducedMotion,
    sun,
    ready,
    get pixelRatio() {
      return renderer.getPixelRatio();
    },
    get glowScale() {
      return quality.glow;
    },
    get quality() {
      return quality;
    },
    get tier() {
      return tier;
    },
    arrived: view.arrived,
    explore: view.explore,
    onInteract: view.onInteract,
    setInsets: view.setInsets,
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    dispose() {
      running = false;
      observer.disconnect();
      view.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
}
