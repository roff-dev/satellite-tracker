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
import { STRIDE, keplerPosition } from '../orbit/elements';
import { GLOW_LAYER } from './glow';
import { KEY_GLSL, KEY_UNIFORMS_GLSL, ORBIT_GLSL, SKY_GLSL } from './orbit.glsl';
import { createTrails } from './trails';
import type { QualitySettings } from './quality';
import { ALL_KINDS, type ElementsMessage } from '../data/protocol';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uDt;
  uniform vec3 uSun;
  uniform float uPixelRatio;
  uniform float uReveal;
  uniform vec2 uFresh;
  uniform float uSelected;
  uniform float uHovered;
  uniform float uHidden;
  uniform float uSolo;
  uniform int uKinds;
  ${KEY_UNIFORMS_GLSL}

  in float aMdot;
  in vec4 aP;
  in vec4 aQ;
  in vec4 aX;
  in float aGroups;
  in float aEpoch;

  out vec3 vColour;
  out float vSelected;
  out float vRing;

  ${ORBIT_GLSL}
  ${KEY_GLSL}
  ${SKY_GLSL}

  void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }

  void main() {
    float a = position.x;
    float e = position.y;
    // No orbit (SGP4 failed), not launched yet at this point in time, or not the one object being shown alone
    if (a <= 0.0 || uDay < aX.w || float(gl_VertexID) == uHidden || (uSolo > 0.5 && float(gl_VertexID) != uSelected)) {
      hide();
      return;
    }

    vec3 r = orbitPosition(position, aMdot, aP, aQ, aX.x, uDt);
    vec3 p = toScene(r);
    float lit = inSunlight(p, uSun);

    // How much of the lit side faces the viewer: a Lambert sphere's phase law
    float beta = acos(clamp(dot(uSun, normalize(cameraPosition - p)), -1.0, 1.0));
    float phase = ((PI - beta) * cos(beta) + sin(beta)) / PI;

    int kind = int(aX.y + 0.5);
    float glint = aX.z;
    // Kinds can be switched off, though the selected object stays: search can find one that's hidden
    if (((uKinds >> kind) & 1) == 0 && float(gl_VertexID) != uSelected) {
      hide();
      return;
    }
    // Over a chosen place, only what its sky shows, if that's all that's asked for
    float sky = seen(p, lit, glint);
    if (sky < uSky - 1.0 && float(gl_VertexID) != uSelected) {
      hide();
      return;
    }
    float size = kind <= 1 ? 2.5 : kind == 2 ? 3.0 : 1.5;
    float opacity = kind == 1 ? 0.6 : 1.0;
    // More than a week from when its orbit was measured, its position is a rough guide: drawn at half strength
    if (abs(uDay - aEpoch) > 7.0) opacity *= 0.5;

    vec3 key = keyColour(kind, a, e);
    float member = membership(kind, glint, aX.w, aGroups);

    // Glint runs 0.35 to 8. On screen it saturates at 3, compressed so the brightest stay amber rather than
    // clipping to white; the range above 3 only picks out the truly bright objects that glow
    float strength = mix(0.35, 1.1, smoothstep(0.35, 3.0, glint));
    vec3 sunlit = key * strength * (0.3 + 0.7 * phase);
    size *= mix(1.0, 0.85 + 0.15 * clamp(glint, 0.35, 3.0), lit);

    // The loading wave: objects appear as it passes outward through their shell, briefly bright at its crest
    float radius = length(r);
    float shown = smoothstep(uReveal, uReveal - 250.0, radius);
    float crest = 1.0 + 1.5 * shown * (1.0 - smoothstep(0.0, 1200.0, uReveal - radius));
    if (float(gl_VertexID) >= uFresh.x) shown *= uFresh.y;

    #ifdef GLOW
      // Only the bright and sunlit spill into a halo, in their own colour
      vColour = sunlit * lit * opacity * shown * crest * smoothstep(4.0, 8.0, glint) * step(0.5, member);
      vSelected = 0.0;
      vRing = 0.0;
    #else
      // In Earth's shadow: the shadow colour when colouring by light, otherwise its own colour, dimmed
      vec3 shade = uColourBy < 0.5 ? uShadow * 0.25 : key * 0.3;
      vColour = mix(shade, sunlit, lit) * opacity * shown * crest * member;
      // The selected object is drawn larger, in the selection colour, with a ring around it
      vSelected = float(gl_VertexID) == uSelected ? 1.0 : 0.0;
      if (vSelected > 0.5) {
        vColour = uFlare;
        size = 22.0;
      } else if (float(gl_VertexID) == uHovered) {
        size = max(size, 5.0);
        vColour = max(vColour, sunlit * 0.9);
      }
      // Inside the dome over the chosen place (at least 10° up, within 2,000 km of the ground): ringed
      vRing = sky > 0.5 && vSelected < 0.5 ? 1.0 : 0.0;
      if (vRing > 0.5) size = max(size, 7.0);
    #endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = size * uPixelRatio;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColour;
  in float vSelected;
  in float vRing;
  uniform vec3 uGlint;
  // three's output chunks still write gl_FragColor, which GLSL 3 doesn't have
  out highp vec4 fragColour;
  #define gl_FragColor fragColour

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float alpha = 1.0 - smoothstep(0.0, 1.0, r);
    vec3 colour = vColour;
    // Selected: a 7 px core and a thin ring, in a 22 px sprite
    if (vSelected > 0.5) alpha = (1.0 - smoothstep(0.26, 0.34, r)) + smoothstep(0.7, 0.76, r) * (1.0 - smoothstep(0.82, 0.88, r));
    // Over the chosen place: the point inside a thin amber ring
    else if (vRing > 0.5) {
      float ring = smoothstep(0.66, 0.72, r) * (1.0 - smoothstep(0.84, 0.9, r));
      alpha = max(1.0 - smoothstep(0.0, 0.45, r), ring);
      colour = mix(vColour, uGlint * 0.85, ring);
    }
    gl_FragColor = vec4(colour, alpha);
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

export function createSatellites(reducedMotion: boolean, trailDetail: QualitySettings['trails']) {
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
    uFlare: { value: token('--flare') },
    uSelected: { value: -1 },
    uHovered: { value: -1 },
    // Not drawn as a point: the object being followed, when it has a model of its own
    uHidden: { value: -1 },
    // 1 while only the selected object is shown
    uSolo: { value: 0 },
    uSky: { value: 0 },
    uObserver: { value: new Vector3() },
    uUp: { value: new Vector3(0, 1, 0) },
    // A group's filter code, or -1 for everything
    uFilter: { value: -1 },
    // Kinds drawn, one bit per kind
    uKinds: { value: ALL_KINDS },
    uColourBy: { value: 0 },
    uGlint: { value: token('--glint') },
    uMuted: { value: token('--muted') },
    uInk: { value: token('--ink') },
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
  const trails = createTrails(uniforms, trailDetail);
  /** How far the trails have faded in, 0 to 1. */
  let trailStrength = 0;
  let lastUpdate = performance.now();
  const glowPoints = new Points(geometry, glowMaterial);
  glowPoints.frustumCulled = false;
  glowPoints.layers.set(GLOW_LAYER);

  let anchorTime = 0;
  const teme = new Float64Array(3);
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
    geometry.setAttribute('aGroups', new InterleavedBufferAttribute(buffer, 1, 16));
    geometry.setAttribute('aEpoch', new InterleavedBufferAttribute(buffer, 1, 17));
    points.geometry = geometry;
    glowPoints.geometry = geometry;
  }

  return {
    points,
    glowPoints,
    trailLines: trails.lines,
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
      trails.setElements(el, count);
    },
    /** Highlights one object (its buffer slot), or none with -1. */
    setSelected(slot: number) {
      uniforms.uSelected.value = slot;
    },
    setHovered(slot: number) {
      uniforms.uHovered.value = slot;
    },
    setHidden(slot: number) {
      uniforms.uHidden.value = slot;
    },
    /** Draw only the selected object, or everything again. */
    setSolo(on: boolean) {
      uniforms.uSolo.value = on ? 1 : 0;
    },
    /**
     * The sky over a place: where it stands and its up, in scene space, and what to draw (1 everything, with what's
     * inside the dome ringed; 2 only what's inside; 3 only what can be seen there by eye); null for no place.
     */
    setSky(observer: Vector3 | null, up?: Vector3, mode = 1) {
      uniforms.uSky.value = observer ? mode : 0;
      if (observer) uniforms.uObserver.value.copy(observer);
      if (up) uniforms.uUp.value.copy(up);
    },
    /** Dim everything outside a group (its filter code), or -1 for none. */
    setFilter(filter: number) {
      uniforms.uFilter.value = filter;
    },
    /** Which kinds are drawn, one bit per kind. */
    setKinds(mask: number) {
      uniforms.uKinds.value = mask;
    },
    /** 0 by sunlight, 1 by what it is, 2 by orbit. */
    setColourBy(mode: number) {
      uniforms.uColourBy.value = mode;
    },
    /** Where an object is drawn at this sim time, in scene units, using the shader's own maths; null if it isn't drawn. */
    positionOf(slot: number, time: number, out: Vector3) {
      const attribute = geometry.getAttribute('position') as InterleavedBufferAttribute | undefined;
      const el = attribute?.data.array as Float32Array | undefined;
      if (!el || slot < 0 || slot >= count || !(el[slot * STRIDE]! > 0)) return null;
      keplerPosition(el, slot * STRIDE, (time - anchorTime) / 1000, teme);
      return out.set(teme[0]! / 6371, teme[2]! / 6371, -teme[1]! / 6371);
    },
    /** Lets the loading wave begin; it waits for the first objects if they aren't here yet. */
    start() {
      started = true;
    },
    /** Speed is sim time per real time, signed; trails show at 60× and faster. */
    update(time: number, sun: Vector3, pixelRatio: number, glowScale: number, speed = 1, detail = { samples: 8, payloadsOnly: false }) {
      const real = performance.now();
      const target = Math.abs(speed) >= 60 ? 1 : 0;
      // Trails fade in and out over 400 ms, or switch straight over without motion
      trailStrength = reducedMotion ? target : Math.min(1, Math.max(0, trailStrength + Math.sign(target - trailStrength) * ((real - lastUpdate) / 400)));
      lastUpdate = real;
      trails.setDetail(detail.samples, detail.payloadsOnly);
      trails.update(speed, trailStrength);
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
      trails.dispose();
    },
  };
}
