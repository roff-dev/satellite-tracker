import {
  AdditiveBlending,
  BufferAttribute,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LineSegments,
  ShaderMaterial,
  type IUniform,
} from 'three';
import { STRIDE } from '../orbit/elements';
import { KEY_GLSL, KEY_UNIFORMS_GLSL, ORBIT_GLSL, SKY_GLSL } from './orbit.glsl';
import type { QualitySettings } from './quality';

type TrailDetail = QualitySettings['trails'];

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uDt;
  uniform vec3 uSun;
  uniform int uKinds;
  uniform float uSolo;
  uniform float uSelected;
  /** Sim seconds per real second, signed: the tail streams out behind the direction of play. */
  uniform float uSpeed;
  uniform float uTrail;
  ${KEY_UNIFORMS_GLSL}

  in vec3 aOrbit;
  in float aMdot;
  in vec4 aP;
  in vec4 aQ;
  in vec4 aX;
  in float aGroups;

  out vec3 vColour;

  ${ORBIT_GLSL}
  ${KEY_GLSL}
  ${SKY_GLSL}

  void main() {
    int kind = int(aX.y + 0.5);
    bool hidden = aOrbit.x <= 0.0 || uDay < aX.w || ((uKinds >> kind) & 1) == 0 || (uSolo > 0.5 && float(gl_InstanceID) != uSelected);
    #ifdef PAYLOADS_ONLY
      hidden = hidden || kind >= 2;
    #endif
    // Over a chosen place, judged where the object is now, so a tail is kept or dropped whole
    if (!hidden && uSky > 1.5 && float(gl_InstanceID) != uSelected) {
      vec3 now = toScene(orbitPosition(aOrbit, aMdot, aP, aQ, aX.x, uDt));
      hidden = seen(now, inSunlight(now, uSun), aX.z) < uSky - 1.0;
    }
    if (hidden) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // Two seconds of playback, but never more than 10° of its own orbit, so the dense shells stay readable
    float k = position.x;
    float span = min(abs(uSpeed) * 2.0, 6.2831853 / aMdot / 36.0);
    float dt = uDt - sign(uSpeed) * span * k / (SAMPLES - 1.0);
    vec3 p = toScene(orbitPosition(aOrbit, aMdot, aP, aQ, aX.x, dt));

    float lit = inSunlight(p, uSun);
    vec3 key = keyColour(kind, aOrbit.x, aOrbit.y);
    vec3 shade = uColourBy < 0.5 ? uShadow * 0.25 : key * 0.3;
    // Brightest at the object, fading to nothing at the end of the tail; faint, since thousands overlap
    float fade = 1.0 - k / (SAMPLES - 1.0);
    vColour = mix(shade, key, lit) * 0.35 * fade * fade * uTrail * membership(kind, aX.z, aX.w, aGroups) * (kind == 1 ? 0.6 : 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColour;
  out highp vec4 fragColour;
  #define gl_FragColor fragColour

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(vColour, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Line segments joining each sample to the next along the tail: 0–1, 1–2 … */
function template(samples: number) {
  const index = new Float32Array((samples - 1) * 2 * 3);
  for (let k = 0; k < samples - 1; k++) {
    index[k * 6] = k;
    index[k * 6 + 3] = k + 1;
  }
  return new BufferAttribute(index, 3);
}

/**
 * Motion trails: the same element buffer drawn a second time as short tails, every object evaluated at a few
 * moments behind where it is now. Pure GPU work; only shown at 60× and faster.
 * Starts at the device's level of detail, so the shader compiled at startup is the one that draws.
 */
export function createTrails(shared: Record<string, IUniform>, detail: TrailDetail) {
  const uniforms = { ...shared, uSpeed: { value: 0 }, uTrail: { value: 0 } };
  let { samples, payloadsOnly } = detail;
  const defines = () => ({ SAMPLES: samples.toFixed(1), ...(payloadsOnly ? { PAYLOADS_ONLY: '' } : {}) });
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    defines: defines(),
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  let geometry = new InstancedBufferGeometry();
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  lines.visible = false;
  let buffer: InstancedInterleavedBuffer | null = null;

  function build(el: Float32Array) {
    geometry.dispose();
    geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', template(samples));
    buffer = new InstancedInterleavedBuffer(el, STRIDE, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aOrbit', new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('aMdot', new InterleavedBufferAttribute(buffer, 1, 3));
    geometry.setAttribute('aP', new InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aQ', new InterleavedBufferAttribute(buffer, 4, 8));
    geometry.setAttribute('aX', new InterleavedBufferAttribute(buffer, 4, 12));
    geometry.setAttribute('aGroups', new InterleavedBufferAttribute(buffer, 1, 16));
    lines.geometry = geometry;
  }

  return {
    lines,
    setElements(el: Float32Array, count: number) {
      if (buffer && buffer.array.length === el.length) {
        buffer.array = el;
        buffer.needsUpdate = true;
      } else build(el);
      geometry.instanceCount = count;
    },
    /** Fewer samples, or payloads only, on devices that can't afford the full set. */
    setDetail(nextSamples: number, nextPayloadsOnly: boolean) {
      if (nextSamples === samples && nextPayloadsOnly === payloadsOnly) return;
      samples = nextSamples;
      payloadsOnly = nextPayloadsOnly;
      material.defines = defines();
      material.needsUpdate = true;
      geometry.setAttribute('position', template(samples));
    },
    /** Speed in sim seconds per real second, and how far the trails have faded in (0 to 1). */
    update(speed: number, strength: number) {
      uniforms.uSpeed.value = speed;
      uniforms.uTrail.value = strength;
      lines.visible = strength > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
