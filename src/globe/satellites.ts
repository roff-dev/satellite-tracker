import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  GLSL3,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { STRIDE } from '../orbit/elements';
import { GLOW_LAYER } from './glow';
import type { ElementsMessage } from '../data/protocol';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uDt;
  uniform float uDay;
  uniform vec3 uSun;
  uniform float uPixelRatio;
  uniform float uReveal;
  uniform vec2 uFresh;
  uniform vec3 uPayload;
  uniform vec3 uRocket;
  uniform vec3 uDebris;
  uniform vec3 uShadow;

  in float aMdot;
  in vec4 aP;
  in vec4 aQ;
  in vec4 aX;

  out vec3 vColour;

  const float KM = 1.0 / 6371.0;

  void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }

  void main() {
    float a = position.x;
    float e = position.y;
    // No orbit (SGP4 failed) or not launched yet at this point in time
    if (a <= 0.0 || uDay < aX.w) {
      hide();
      return;
    }

    // Kepler's equation, then SGP4's secular drift: mean motion and drag, perigee, node
    float M = mod(position.z + aMdot * uDt + aX.x * uDt * uDt, 6.2831853);
    float E = e < 0.8 ? M : PI;
    for (int i = 0; i < 5; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    vec2 xy = vec2(a * (cos(E) - e), a * sqrt(1.0 - e * e) * sin(E));
    float dw = aP.w * uDt;
    float dO = aQ.w * uDt;
    xy = mat2(cos(dw), sin(dw), -sin(dw), cos(dw)) * xy;
    vec3 r = xy.x * aP.xyz + xy.y * aQ.xyz;
    r.xy = mat2(cos(dO), sin(dO), -sin(dO), cos(dO)) * r.xy;
    vec3 p = vec3(r.x, r.z, -r.y) * KM;

    // Earth's shadow as a cylinder, softened a little at the edge so objects fade rather than blink
    float lit = dot(p, uSun) > 0.0 ? 1.0 : smoothstep(0.985, 1.015, length(cross(p, uSun)));

    // How much of the lit side faces the viewer: a Lambert sphere's phase law
    float beta = acos(clamp(dot(uSun, normalize(cameraPosition - p)), -1.0, 1.0));
    float phase = ((PI - beta) * cos(beta) + sin(beta)) / PI;

    int kind = int(aX.y + 0.5);
    float glint = aX.z;
    vec3 base = kind <= 1 ? uPayload : kind == 2 ? uRocket : uDebris;
    float size = kind <= 1 ? 2.5 : kind == 2 ? 3.0 : 1.5;
    float opacity = kind == 1 ? 0.6 : 1.0;

    // Glint runs 0.35 to 8. On screen it saturates at 3, compressed so the brightest stay amber rather than
    // clipping to white; the range above 3 only picks out the truly bright objects that glow
    float strength = mix(0.35, 1.1, smoothstep(0.35, 3.0, glint));
    vec3 sunlit = base * strength * (0.3 + 0.7 * phase);
    size *= mix(1.0, 0.85 + 0.15 * min(glint, 3.0), lit);

    // The loading wave: objects appear as it passes outward through their shell, briefly bright at its crest
    float radius = length(r);
    float shown = smoothstep(uReveal, uReveal - 250.0, radius);
    float crest = 1.0 + 1.5 * shown * (1.0 - smoothstep(0.0, 1200.0, uReveal - radius));
    if (float(gl_VertexID) >= uFresh.x) shown *= uFresh.y;

    #ifdef GLOW
      // Only the bright and sunlit spill into a halo, in their own colour
      vColour = sunlit * lit * opacity * shown * crest * smoothstep(4.0, 8.0, glint);
    #else
      vColour = mix(uShadow * 0.25, sunlit, lit) * opacity * shown * crest;
    #endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = size * uPixelRatio;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColour;
  // three's output chunks still write gl_FragColor, which GLSL 3 doesn't have
  out highp vec4 fragColour;
  #define gl_FragColor fragColour

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColour, 1.0 - smoothstep(0.0, 1.0, r));
    #include <colorspace_fragment>
  }
`;

const DAY_MS = 86_400_000;
const REVEAL_SECONDS = 4;
const REVEAL_FROM_KM = 6371;
const REVEAL_TO_KM = 52_000;
const FRESH_SECONDS = 0.6;
/** Past every orbit: nothing is held back by the wave. */
const REVEALED_KM = 1e9;

function token(name: string) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

export function createSatellites(reducedMotion: boolean) {
  const uniforms = {
    uDt: { value: 0 },
    uDay: { value: 0 },
    uSun: { value: new Vector3(1, 0, 0) },
    uPixelRatio: { value: 1 },
    uReveal: { value: reducedMotion ? REVEALED_KM : REVEAL_FROM_KM },
    // Objects from this index on are drawn at this opacity while they fade in
    uFresh: { value: new Vector2(0, reducedMotion ? 0 : 1) },
    uPayload: { value: token('--glint') },
    uRocket: { value: new Color('#f3e9d8') },
    uDebris: { value: token('--faint') },
    uShadow: { value: token('--cool') },
  };
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  let geometry = new BufferGeometry();
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  // The same orbits again, drawn only into the glow buffer
  const glowMaterial = material.clone();
  // Shares every uniform except point size, which follows the glow buffer's lower resolution
  const glowPixelRatio = { value: 1 };
  glowMaterial.uniforms = { ...uniforms, uPixelRatio: glowPixelRatio };
  glowMaterial.defines = { GLOW: '' };
  const glowPoints = new Points(geometry, glowMaterial);
  glowPoints.frustumCulled = false;
  glowPoints.layers.set(GLOW_LAYER);

  let anchorTime = 0;
  let count = 0;
  let revealStart: number | null = null;
  let freshStart = reducedMotion ? Infinity : -Infinity;
  let started = false;

  function build(el: Float32Array) {
    geometry.dispose();
    geometry = new BufferGeometry();
    const buffer = new InterleavedBuffer(el, STRIDE).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('aMdot', new InterleavedBufferAttribute(buffer, 1, 3));
    geometry.setAttribute('aP', new InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aQ', new InterleavedBufferAttribute(buffer, 4, 8));
    geometry.setAttribute('aX', new InterleavedBufferAttribute(buffer, 4, 12));
    points.geometry = geometry;
    glowPoints.geometry = geometry;
  }

  return {
    points,
    glowPoints,
    setElements({ el, count: next, time }: ElementsMessage) {
      const attribute = geometry.getAttribute('position') as InterleavedBufferAttribute | undefined;
      if (attribute && attribute.data.array.length === el.length) {
        attribute.data.array = el;
        attribute.data.needsUpdate = true;
      } else build(el);
      // Objects arriving once the wave has passed fade in where they are
      if (next > count && revealStart !== null && performance.now() - revealStart > REVEAL_SECONDS * 1000) {
        uniforms.uFresh.value.x = count;
        freshStart = performance.now();
      }
      count = next;
      anchorTime = time;
      geometry.setDrawRange(0, count);
    },
    /** Lets the loading wave begin; it waits for the first objects if they aren't here yet. */
    start() {
      started = true;
    },
    update(time: number, sun: Vector3, pixelRatio: number, glowScale: number) {
      uniforms.uDt.value = (time - anchorTime) / 1000;
      uniforms.uDay.value = time / DAY_MS;
      uniforms.uSun.value.copy(sun);
      uniforms.uPixelRatio.value = pixelRatio;
      glowPixelRatio.value = pixelRatio * glowScale;
      const now = performance.now();
      if (started && count && revealStart === null) {
        revealStart = now;
        // Without motion the whole catalogue simply fades in
        if (reducedMotion) freshStart = now;
      }
      if (revealStart !== null && !reducedMotion) {
        const t = Math.min((now - revealStart) / (REVEAL_SECONDS * 1000), 1);
        // Cubic in time: the crowded low shells take the first second, then out past the geostationary belt
        uniforms.uReveal.value = t < 1 ? REVEAL_FROM_KM + (REVEAL_TO_KM - REVEAL_FROM_KM) * t * t * t : REVEALED_KM;
      }
      uniforms.uFresh.value.y = Math.min(Math.max((now - freshStart) / (FRESH_SECONDS * 1000), 0), 1);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      glowMaterial.dispose();
    },
  };
}
