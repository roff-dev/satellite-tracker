import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Group, Mesh, Points, ShaderMaterial, Vector3 } from 'three';

/** The dome's roof, 2,000 km up, and its edge, 10° above the horizon. */
const ROOF = 1 + 2000 / 6371;
const LOWEST = (10 * Math.PI) / 180;
const AROUND = 72;
const UP_TO_ZENITH = 10;

const token = (name: string) => new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

const domeVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  out vec3 vView;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vView = view.xyz;
    gl_Position = projectionMatrix * view;
    #include <logdepthbuf_vertex>
  }
`;

const domeFragment = /* glsl */ `
  uniform vec3 uColour;
  in vec3 vView;
  out highp vec4 fragColour;
  #define gl_FragColor fragColour
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    // Each facet lit flat, from its own slope; brighter where it turns edge-on, so the shell reads by its outline
    vec3 normal = normalize(cross(dFdx(vView), dFdy(vView)));
    float edge = 1.0 - abs(dot(normal, normalize(vView)));
    gl_FragColor = vec4(uColour * (0.012 + 0.3 * edge * edge * edge * edge), 1.0);
    #include <colorspace_fragment>
  }
`;

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
  uniform float uPulse;
  out highp vec4 fragColour;
  #define gl_FragColor fragColour
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // A point that breathes, inside a thin ring
    float core = 1.0 - smoothstep(0.2 + 0.08 * uPulse, 0.3 + 0.08 * uPulse, r);
    float ring = smoothstep(0.78, 0.84, r) * (1.0 - smoothstep(0.9, 0.96, r));
    gl_FragColor = vec4(uColour, max(core, ring * 0.9));
    #include <colorspace_fragment>
  }
`;

/**
 * The sky over a place, on the turning Earth: a marker where it stands, and a faceted dome over everything at least
 * 10° above its horizon and within 2,000 km of the ground. Positions are Earth-fixed scene units; up is the
 * ellipsoid's normal there.
 */
export function createDome(place: Vector3, up: Vector3, reducedMotion: boolean) {
  const glint = token('--glint');
  const group = new Group();

  // East and north at the place, so bearings can be laid out around it
  const east = new Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  east.normalize();
  const north = new Vector3().crossVectors(up, east);
  const direction = new Vector3();
  /** Where a line from the place at an elevation and bearing meets the roof. */
  const roof = (elevation: number, bearing: number, out: number[]) => {
    direction
      .copy(north)
      .multiplyScalar(Math.cos(bearing) * Math.cos(elevation))
      .addScaledVector(east, Math.sin(bearing) * Math.cos(elevation))
      .addScaledVector(up, Math.sin(elevation));
    const b = place.dot(direction);
    const t = -b + Math.sqrt(b * b - (place.lengthSq() - ROOF * ROOF));
    out.push(place.x + direction.x * t, place.y + direction.y * t, place.z + direction.z * t);
  };

  // The apex at the place, then rings of the roof from its 10° edge up to the zenith
  const positions: number[] = [place.x, place.y, place.z];
  for (let i = 0; i <= UP_TO_ZENITH; i++) {
    const elevation = LOWEST + ((Math.PI / 2 - LOWEST) * i) / UP_TO_ZENITH;
    for (let j = 0; j < AROUND; j++) roof(elevation, (j / AROUND) * Math.PI * 2, positions);
  }
  const at = (i: number, j: number) => 1 + i * AROUND + (j % AROUND);
  const index: number[] = [];
  // The sides: a cone from the place out to the roof's edge
  for (let j = 0; j < AROUND; j++) index.push(0, at(0, j), at(0, j + 1));
  // The roof
  for (let i = 0; i < UP_TO_ZENITH; i++) {
    for (let j = 0; j < AROUND; j++) index.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  const domeGeometry = new BufferGeometry();
  domeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  domeGeometry.setIndex(index);
  const domeMaterial = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: domeVertex,
    fragmentShader: domeFragment,
    uniforms: { uColour: { value: glint } },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const dome = new Mesh(domeGeometry, domeMaterial);
  dome.renderOrder = 3;

  // Just above the tallest relief, so the marker is never buried in a mountain
  const markerGeometry = new BufferGeometry();
  markerGeometry.setAttribute('position', new BufferAttribute(new Float32Array(place.clone().normalize().multiplyScalar(1.03).toArray()), 3));
  const markerMaterial = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: markerVertex,
    fragmentShader: markerFragment,
    uniforms: { uColour: { value: glint }, uSize: { value: 18 }, uPulse: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
  const marker = new Points(markerGeometry, markerMaterial);
  marker.renderOrder = 4;
  marker.frustumCulled = false;
  group.add(dome, marker);

  let elapsed = 0;
  return {
    group,
    /** Each frame: the marker's breathing, and its size in device pixels. */
    update(seconds: number, pixelRatio: number) {
      elapsed += seconds;
      markerMaterial.uniforms.uPulse!.value = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 3.5);
      markerMaterial.uniforms.uSize!.value = 18 * pixelRatio;
    },
    dispose() {
      domeGeometry.dispose();
      domeMaterial.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
    },
  };
}

export type Dome = ReturnType<typeof createDome>;
