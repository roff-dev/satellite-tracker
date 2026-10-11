import { AdditiveBlending, BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

const SHELL = 1.06;

// A thin, clean halo outside the Earth's disc: density falls off with the closest approach of each view ray
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
    float density = exp(-height / 0.007);
    float sunSide = dot(normalize(closest), uSun);
    float lit = smoothstep(-0.2, 0.2, sunSide);
    vec3 color = mix(vec3(1.0, 0.5, 0.25), vec3(0.35, 0.62, 1.0), smoothstep(-0.05, 0.35, sunSide));
    gl_FragColor = vec4(color * density * lit * uStrength * 0.8, 1.0);
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
  const mesh = new Mesh(new SphereGeometry(SHELL, 96, 48), material);
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
