import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GLSL3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from 'three';

const METRE = 1 / 6_371_000;
/** The camera looks down on what it follows at this angle, which puts the horizon near the middle of the view. */
const DIP = (20 * Math.PI) / 180;
/** Room to frame: the ISS fits in a sphere of about 65 m; a lone point gets the same framing. */
const FRAME_RADIUS = 65 * METRE;
const FLY_IN_S = 1.6;
const FLY_OUT_S = 1.3;
const ISS = 25544;

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * The followed object's marker, drawn from its own position rather than by the satellites' shader. Up close, that
 * shader's 32-bit positions are a metre or so out, which reads as the object shaking a few pixels every frame; placed
 * from the CPU, the object less the camera is worked out in double precision.
 */
const markerVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
    #include <logdepthbuf_vertex>
  }
`;

const markerFragment = /* glsl */ `
  uniform vec3 uColour;
  out highp vec4 fragColour;
  #define gl_FragColor fragColour
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // The selection marker: a core and a thin ring
    gl_FragColor = vec4(uColour, (1.0 - smoothstep(0.26, 0.34, r)) + smoothstep(0.7, 0.76, r) * (1.0 - smoothstep(0.82, 0.88, r)));
    #include <colorspace_fragment>
  }
`;

export interface FollowHost {
  camera: PerspectiveCamera;
  inertial: Group;
  sun: Vector3;
  reducedMotion: boolean;
  /** Where the object is drawn at a sim time, scene units, or null if it isn't. */
  positionOf(slot: number, time: number, out: Vector3): Vector3 | null;
  hide(slot: number): void;
  /** Keep this object's path continuous when new orbits arrive, or -1 for none. */
  steady(slot: number): void;
  pixelRatio(): number;
  suspendCamera(): void;
  resumeCamera(): void;
  restDistance(): number;
}

/**
 * Rides along with one object: the camera flies in to a few metres behind it, keeps pace above the turning
 * Earth, and flies back out to the globe when stopped. The ISS gets NASA's model, lit by the real Sun and
 * dark in Earth's shadow; anything else stays a point of light.
 */
export function createFollow(host: FollowHost) {
  const { camera, inertial, sun } = host;
  const light = new DirectionalLight(0xffffff, 0);
  // Seen by every pass, the glow pass too: a different light count keys a different program, so the glow shaders
  // compiled at startup would otherwise link again on the first frame
  light.layers.enableAll();
  // Earthshine, blue-tinted, so the side away from the Sun isn't black
  const ambient = new AmbientLight(new Color('#8db8f2'), 0);
  inertial.add(light, light.target, ambient);
  let station: Promise<Mesh | null> | null = null;
  let model: Mesh | null = null;
  const markerSize = { value: 22 };
  const marker = new Points(
    new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(3), 3)),
    new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: markerVertex,
      fragmentShader: markerFragment,
      uniforms: { uColour: { value: new Color(getComputedStyle(document.documentElement).getPropertyValue('--flare').trim()) }, uSize: markerSize },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  marker.matrixAutoUpdate = false;
  marker.frustumCulled = false;
  marker.renderOrder = 2;
  // In the scene from the start, hidden, so its shader is compiled with the rest
  marker.visible = false;
  inertial.add(marker);

  type Phase = { kind: 'in' | 'riding'; start: number; from: Vector3; up: Vector3 } | { kind: 'out'; start: number; from: Vector3; target: Vector3 };
  let following: { slot: number; norad: number; phase: Phase } | null = null;
  let onEnd: (() => void) | null = null;

  const p = new Vector3();
  const ahead = new Vector3();
  const forward = new Vector3();
  const up = new Vector3();
  const right = new Vector3();
  const chase = new Vector3();
  const look = new Vector3();
  const basis = new Matrix4();
  const scale = new Vector3(METRE, METRE, METRE);
  const orientation = new Quaternion();

  /** Position, forward and up of the object at a moment; false if it can't be placed. */
  function frame(time: number) {
    if (!following || !host.positionOf(following.slot, time, p) || !host.positionOf(following.slot, time + 1000, ahead)) return false;
    up.copy(p).normalize();
    // The direction of travel, levelled to the local horizon
    forward.subVectors(ahead, p);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    right.crossVectors(up, forward);
    // Far enough back that the whole station fits the narrower side of the screen, with a little room
    const halfView = Math.min((camera.fov * Math.PI) / 360, Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect));
    const distance = (FRAME_RADIUS / Math.sin(halfView)) * 1.15;
    chase.copy(p).addScaledVector(forward, -distance * Math.cos(DIP)).addScaledVector(up, distance * Math.sin(DIP));
    return true;
  }

  return {
    get following() {
      return following ? following.norad : null;
    },
    start(slot: number, norad: number, now: number, ended: () => void) {
      onEnd = ended;
      host.suspendCamera();
      following = { slot, norad, phase: { kind: 'in', start: now, from: camera.position.clone(), up: camera.up.clone() } };
      host.hide(slot);
      host.steady(slot);
      marker.visible = true;
      if (norad === ISS) {
        // NASA's model loads on first use, with its own code
        station ??= import('./station')
          .then(({ loadStation }) => loadStation({ BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial }))
          .catch(() => null);
        void station.then((mesh) => {
          if (!mesh || following?.norad !== ISS) return;
          model = mesh;
          inertial.add(mesh);
          marker.visible = false;
        });
      }
    },
    stop(now: number) {
      if (!following || following.phase.kind === 'out') return;
      following.phase = { kind: 'out', start: now, from: camera.position.clone(), target: p.clone() };
    },
    /** Each frame, before rendering: real seconds for the flights, sim time for where the object is. */
    update(now: number, time: number) {
      if (!following) return;
      const placed = frame(time);
      const phase = following.phase;
      if (placed && marker.visible) {
        marker.matrix.makeTranslation(p);
        marker.matrixWorldNeedsUpdate = true;
        markerSize.value = 22 * host.pixelRatio();
      }
      const t = host.reducedMotion ? 1 : Math.min((now - phase.start) / ((phase.kind === 'out' ? FLY_OUT_S : FLY_IN_S) * 1000), 1);
      const e = smootherstep(t);

      if (phase.kind === 'out' || !placed) {
        // Rise away from the object to the resting view above it, turning to face the Earth's centre
        const from = phase.from;
        const end = (placed ? p : from).clone().normalize().multiplyScalar(host.restDistance());
        const radius = Math.exp((1 - e) * Math.log(from.length()) + e * Math.log(end.length()));
        camera.position.copy(from).normalize().lerp(end.clone().normalize(), e).normalize().multiplyScalar(radius);
        camera.up.set(0, 1, 0);
        camera.lookAt(look.copy(phase.kind === 'out' ? phase.target : from).multiplyScalar(1 - e));
        if (t >= 1 || !placed) {
          following = null;
          host.hide(-1);
          host.steady(-1);
          marker.visible = false;
          model?.removeFromParent();
          model = null;
          light.intensity = ambient.intensity = 0;
          host.resumeCamera();
          onEnd?.();
        }
        return;
      }

      // Into position: the distance closes on a log scale, so the approach slows as it nears
      if (phase.kind === 'in') {
        const from = phase.from.clone().sub(p);
        const to = chase.clone().sub(p);
        const length = Math.exp((1 - e) * Math.log(from.length()) + e * Math.log(to.length()));
        camera.position.copy(p).add(from.normalize().lerp(to.normalize(), e).normalize().multiplyScalar(length));
        camera.up.copy(phase.up).lerp(up, e).normalize();
        if (t >= 1) following.phase = { ...phase, kind: 'riding' };
      } else {
        camera.position.copy(chase);
        camera.up.copy(up);
      }
      camera.lookAt(p);

      if (model) {
        // Truss across the orbit, modules along the velocity, the model's +y away from the Earth
        basis.makeBasis(right, up, forward);
        orientation.setFromRotationMatrix(basis);
        model.matrix.compose(p, orientation, scale);
        model.matrixWorldNeedsUpdate = true;
      }
      // Sunlit unless inside Earth's shadow cylinder, with a soft edge
      const across = Math.sqrt(Math.max(0, p.lengthSq() - p.dot(sun) ** 2));
      const lit = p.dot(sun) > 0 ? 1 : Math.min(Math.max((across - 0.985) / 0.03, 0), 1);
      light.position.copy(p).addScaledVector(sun, 1);
      light.target.position.copy(p);
      light.intensity = 3 * lit;
      // Earthshine: a sunlit Earth below lights the station's underside; the night side barely does
      ambient.intensity = 0.25 + 0.9 * Math.max(0, up.dot(sun));
    },
    dispose() {
      light.removeFromParent();
      ambient.removeFromParent();
      model?.removeFromParent();
      marker.removeFromParent();
      marker.geometry.dispose();
      marker.material.dispose();
    },
  };
}
