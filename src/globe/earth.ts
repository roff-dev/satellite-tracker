import { BufferAttribute, BufferGeometry, Color, Group, Mesh, ShaderMaterial, Sphere, Vector3 } from 'three';
import type { EarthMesh } from '../workers/earth.worker';
import { GLOW_LAYER } from './glow';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aColour;
  attribute vec2 aSurface;
  varying vec3 vColour;
  varying vec2 vSurface;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vColour = aColour;
    vSurface = aSurface;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uShadow;
  uniform vec3 uLights;
  varying vec3 vColour;
  varying vec2 vSurface;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float d = dot(N, uSun);
    float ocean = vSurface.y;

    // The palette comes straight from the satellite imagery; lift and saturate it a little for the stylised look
    vec3 base = pow(vColour, vec3(2.2));
    float grey = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = max(mix(vec3(grey), base, 1.35), 0.0) * 2.1;

    // Soft, flat light: every facet reads, and nothing on the day side goes black
    float day = smoothstep(-0.05, 0.14, d);
    vec3 colour = base * (0.42 + 0.58 * max(d, 0.0)) * day;
    // How far each facet tilts from the true sphere, towards or away from the Sun, exaggerated so the facets read
    float facet = dot(N - normalize(vPosW), uSun);
    colour *= clamp(1.0 + mix(4.0, 3.0, ocean) * facet, 0.55, 1.6);

    // Night: a deep navy taken from the shadow colour, with the land faintly visible
    colour += (uShadow * 0.012 + base * 0.018) * (1.0 - day);

    // Warmth along the terminator
    float twilight = (1.0 - smoothstep(0.0, 0.22, abs(d - 0.03))) * day;
    colour *= mix(vec3(1.0), vec3(1.3, 0.85, 0.62), twilight * 0.6);

    // Sea facets turned towards the Sun flash
    vec3 H = normalize(uSun + V);
    vec3 sparkle = vec3(1.0, 0.86, 0.64) * pow(max(dot(N, H), 0.0), 90.0) * 0.6 * ocean * day;
    colour += sparkle;

    // City lights, a facet at a time
    colour += uLights * vSurface.x * vSurface.x * (1.0 - smoothstep(-0.2, 0.04, d)) * 1.4;

    #ifdef GLOW
      // Into the glow buffer only the sparkle goes; the rest is black but still hides what's behind the Earth
      colour = sparkle;
    #endif

    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }
`;

function token(name: string) {
  return new Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** The faceted Earth. Its mesh is built in a worker from earth.bin; ready resolves once it's in the scene. */
export function createEarth() {
  const group = new Group();
  const material = new ShaderMaterial({
    uniforms: {
      uSun: { value: new Vector3(1, 0, 0) },
      uShadow: { value: token('--cool') },
      uLights: { value: token('--glint') },
    },
    vertexShader,
    fragmentShader,
  });

  const glowMaterial = material.clone();
  glowMaterial.uniforms = material.uniforms;
  glowMaterial.defines = { GLOW: '' };

  const ready = new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/earth.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<EarthMesh | { error: string }>) => {
      worker.terminate();
      if ('error' in data) return reject(new Error(data.error));
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.position, 3));
      geometry.setAttribute('normal', new BufferAttribute(data.normal, 3));
      geometry.setAttribute('aColour', new BufferAttribute(data.colour, 3, true));
      geometry.setAttribute('aSurface', new BufferAttribute(data.surface, 2, true));
      // The bounds are known (highest relief is under 1.03), which saves walking 246,000 vertices on the first frame
      geometry.boundingSphere = new Sphere(new Vector3(), 1.03);
      const glow = new Mesh(geometry, glowMaterial);
      glow.layers.set(GLOW_LAYER);
      group.add(new Mesh(geometry, material), glow);
      resolve();
    };
  });

  return {
    group,
    ready,
    setSun(direction: Vector3) {
      (material.uniforms.uSun!.value as Vector3).copy(direction);
    },
  };
}
