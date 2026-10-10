import { AdditiveBlending, BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

const SHELL = 1.08;

// The halo outside the Earth's disc: density falls off with the closest approach of each view ray,
// tinted by how lit the air is at that point. The Earth's depth hides the shell behind it.
const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPosW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSun;
  uniform float uStrength;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ray = normalize(vPosW - cameraPosition);
    float t = max(-dot(cameraPosition, ray), 0.0);
    vec3 closest = cameraPosition + ray * t;
    float height = max(length(closest) - 1.0, 0.0);
    float density = exp(-height / 0.014);
    float sunSide = dot(normalize(closest), uSun);
    float lit = smoothstep(-0.28, 0.25, sunSide);
    vec3 color = mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.56, 1.0), smoothstep(-0.05, 0.4, sunSide));
    gl_FragColor = vec4(color * density * lit * uStrength, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createAtmosphere() {
  const material = new ShaderMaterial({
    uniforms: { uSun: { value: new Vector3(1, 0, 0) }, uStrength: { value: 1.0 } },
    vertexShader,
    fragmentShader,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(SHELL, 128, 64), material);
  return {
    mesh,
    setSun(direction: Vector3) {
      (material.uniforms.uSun!.value as Vector3).copy(direction);
    },
    setFull(full: boolean) {
      material.uniforms.uStrength!.value = full ? 1.0 : 0.75;
    },
  };
}
