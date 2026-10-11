import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
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
/** Real ISS arrays read as dark gold in sunlight; NASA's model has them blue. */
const SOLAR_ARRAY = new Color('#8a6a2c');

/** iss.bin: NASA's ISS model, decoded at build time, drawn with a flat colour per facet. */
async function loadStation() {
  const bytes = new Uint8Array(await (await fetch('/iss.bin')).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let o = 4;
  const materials = view.getUint8(o++);
  const palette = Array.from({ length: materials }, (_, i) => new Color().setRGB(bytes[o + i * 3]! / 255, bytes[o + i * 3 + 1]! / 255, bytes[o + i * 3 + 2]! / 255, 'srgb'));
  palette[1] = SOLAR_ARRAY;
  o += materials * 3;
  const vertices = view.getUint32(o, true);
  const triangles = view.getUint32(o + 4, true);
  o += 8;
  const at = (v: number, axis: number) => view.getInt16(o + v * 6 + axis * 2, true) * 0.002;
  const indexAt = o + vertices * 6;
  const materialAt = indexAt + triangles * 6;
  // Every facet its own three vertices, so flat shading gives each one its own normal and colour
  const position = new Float32Array(triangles * 9);
  const colour = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const c = palette[bytes[materialAt + t]!]!;
    for (let k = 0; k < 3; k++) {
      const v = view.getUint16(indexAt + t * 6 + k * 2, true);
      for (let axis = 0; axis < 3; axis++) position[t * 9 + k * 3 + axis] = at(v, axis);
      colour.set([c.r, c.g, c.b], t * 9 + k * 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(colour, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }));
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  return mesh;
}

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export interface FollowHost {
  camera: PerspectiveCamera;
  inertial: Group;
  sun: Vector3;
  reducedMotion: boolean;
  /** Where the object is drawn at a sim time, scene units, or null if it isn't. */
  positionOf(slot: number, time: number, out: Vector3): Vector3 | null;
  hide(slot: number): void;
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
      if (norad === ISS) {
        station ??= loadStation().catch(() => null);
        void station.then((mesh) => {
          if (!mesh || following?.norad !== ISS) return;
          model = mesh;
          inertial.add(mesh);
          host.hide(slot);
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
    },
  };
}
