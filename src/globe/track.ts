import { Color, type Group } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

function token(name: string) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/**
 * The selected object's orbit through space, and its ground track across the turning Earth, the part
 * already flown drawn fainter. Lines with real width, the same on every device.
 */
export function createTrack(inertial: Group, earthFixed: Group) {
  const flare = token('--flare');
  const material = (linewidth: number, opacity: number) =>
    new LineMaterial({ color: flare, linewidth, transparent: opacity < 1, opacity, depthWrite: false });
  const orbitMaterial = material(2, 0.85);
  const trainMaterial = material(1, 0.45);
  const aheadMaterial = material(1.5, 0.9);
  const behindMaterial = material(1.5, 0.35);
  const materials = [orbitMaterial, aheadMaterial, behindMaterial, trainMaterial];
  let train: Line2 | null = null;

  const lines: Line2[] = [];
  let linesVisible = true;
  function line(points: Float32Array, lineMaterial: LineMaterial, parent: Group) {
    if (points.length < 6) return;
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const drawn = new Line2(geometry, lineMaterial);
    drawn.renderOrder = 1;
    drawn.visible = linesVisible;
    parent.add(drawn);
    lines.push(drawn);
  }

  function clear() {
    for (const drawn of lines.splice(0)) {
      drawn.removeFromParent();
      drawn.geometry.dispose();
    }
  }

  return {
    set(orbit: Float32Array, track: Float32Array, now: number) {
      clear();
      line(orbit, orbitMaterial, inertial);
      // The two halves share the point at "now" so the track has no gap
      line(track.subarray(0, (now + 1) * 3), behindMaterial, earthFixed);
      line(track.subarray(now * 3), aheadMaterial, earthFixed);
    },
    clear,
    /** A faint line through a launch group, in order along the orbit; null removes it. */
    setTrain(points: Float32Array | null) {
      if (train) {
        train.removeFromParent();
        train.geometry.dispose();
        train = null;
      }
      if (!points || points.length < 6) return;
      const geometry = new LineGeometry();
      geometry.setPositions(points);
      train = new Line2(geometry, trainMaterial);
      train.renderOrder = 1;
      train.visible = linesVisible;
      inertial.add(train);
    },
    setVisible(visible: boolean) {
      if (train) train.visible = visible;
      linesVisible = visible;
      for (const drawn of lines) drawn.visible = visible;
    },
    /** Line widths are in CSS pixels, so the materials need the canvas size. */
    setResolution(width: number, height: number) {
      for (const m of materials) m.resolution.set(width, height);
    },
    dispose() {
      clear();
      train?.geometry.dispose();
      materials.forEach((m) => m.dispose());
    },
  };
}
