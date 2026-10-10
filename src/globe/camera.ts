import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({ THREE });

const MIN_DISTANCE = 1.15;
const MAX_DISTANCE = 14;
const ARRIVAL_FROM = 9;
const FILL = 0.8;
const RESTING_SMOOTH_TIME = 0.18;

/** Longitude (degrees east) the visitor's clock suggests, from the standard UTC offset. */
export function timezoneLongitude(now = new Date()) {
  const year = now.getFullYear();
  const standardOffset = Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
  return -standardOffset / 4;
}

/** Scene-space direction of a point on the Earth's surface once the Earth has rotated by gmst. */
export function surfaceDirection(latDeg: number, lonDeg: number, gmst: number, out = new THREE.Vector3()) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg) + gmst;
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export function createCamera(dom: HTMLElement, reducedMotion: boolean) {
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 400);
  const controls = new CameraControls(camera, dom);
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.smoothTime = RESTING_SMOOTH_TIME;
  controls.draggingSmoothTime = 0.12;
  controls.dollySpeed = 0.6;
  controls.mouseButtons.right = CameraControls.ACTION.NONE;
  controls.mouseButtons.middle = CameraControls.ACTION.DOLLY;
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY;
  controls.touches.three = CameraControls.ACTION.NONE;

  let interacted = false;
  let rest = 3.6;
  let aspect = 1;

  /** Distance at which the globe fills FILL of the narrower screen dimension. */
  const restDistance = () => {
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    return 1 / Math.sin(Math.min(vertical, horizontal) * FILL);
  };

  // Leave room for the headline: portrait screens push the globe down, wide screens push it right
  const applyFocalOffset = (distance: number, transition: boolean) => {
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const x = aspect > 1.2 ? -0.18 * halfHeight * aspect : 0;
    const y = aspect < 0.8 ? 0.2 * halfHeight : 0;
    void controls.setFocalOffset(x, y, 0, transition);
  };
  let arriving = false;
  const listeners = new Set<() => void>();
  const markInteracted = () => {
    if (interacted) return;
    interacted = true;
    controls.smoothTime = RESTING_SMOOTH_TIME;
    listeners.forEach((fn) => fn());
  };
  controls.addEventListener('controlstart', markInteracted);

  // Rotation feels the same at every zoom: slower when close to the surface
  const scaleRotation = () => {
    const altitude = controls.distance - 1;
    const speed = THREE.MathUtils.clamp(altitude / 2.2, 0.08, 1);
    controls.azimuthRotateSpeed = speed;
    controls.polarRotateSpeed = speed;
  };

  const tmp = new THREE.Vector3();

  return {
    camera,
    controls,
    get interacted() {
      return interacted;
    },
    onInteract(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Places the camera far out over the given longitude, then glides in. */
    arrive(lonDeg: number, gmst: number) {
      rest = restDistance();
      const end = surfaceDirection(22, lonDeg, gmst, new THREE.Vector3()).multiplyScalar(rest);
      applyFocalOffset(rest, false);
      if (reducedMotion) {
        void controls.setLookAt(end.x, end.y, end.z, 0, 0, 0, false);
        return;
      }
      surfaceDirection(34, lonDeg - 50, gmst, tmp).multiplyScalar(ARRIVAL_FROM);
      void controls.setLookAt(tmp.x, tmp.y, tmp.z, 0, 0, 0, false);
      controls.smoothTime = 1.15;
      arriving = true;
      void controls.setLookAt(end.x, end.y, end.z, 0, 0, 0, true).then(() => {
        arriving = false;
        if (!interacted) controls.smoothTime = RESTING_SMOOTH_TIME;
      });
    },
    /** Keeps the view fixed to the ground by turning with the Earth. */
    followEarth(deltaGmst: number) {
      void controls.rotate(deltaGmst, 0, false);
    },
    update(deltaSeconds: number) {
      scaleRotation();
      if (!interacted && !reducedMotion) void controls.rotate(THREE.MathUtils.degToRad(0.4) * deltaSeconds, 0, false);
      return controls.update(deltaSeconds);
    },
    keyboard(event: KeyboardEvent) {
      const step = THREE.MathUtils.degToRad(5);
      const actions: Record<string, () => void> = {
        ArrowLeft: () => void controls.rotate(-step, 0, true),
        ArrowRight: () => void controls.rotate(step, 0, true),
        ArrowUp: () => void controls.rotate(0, -step, true),
        ArrowDown: () => void controls.rotate(0, step, true),
        '+': () => void controls.dolly(0.25 * (controls.distance - 1), true),
        '=': () => void controls.dolly(0.25 * (controls.distance - 1), true),
        '-': () => void controls.dolly(-0.25 * (controls.distance - 1), true),
        '0': () => void controls.dollyTo(rest, true),
      };
      const action = actions[event.key];
      if (!action) return false;
      event.preventDefault();
      markInteracted();
      action();
      return true;
    },
    resize(width: number, height: number) {
      aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      rest = restDistance();
      if (arriving) return;
      applyFocalOffset(rest, false);
      // Rotating a phone before exploring re-frames the globe
      if (!interacted && controls.distance > 1.2) void controls.dollyTo(rest, false);
    },
    dispose() {
      controls.dispose();
    },
  };
}
