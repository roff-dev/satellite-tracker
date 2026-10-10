import {
  Group,
  ImageBitmapLoader,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { QualitySettings } from './quality';

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNightOcean;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float d = dot(N, uSun);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec2 nightOcean = texture2D(uNightOcean, vUv).rg;
    float ocean = smoothstep(0.35, 0.65, nightOcean.g);

    // Sunlight, with a soft terminator rather than a hard Lambert edge
    float sun = smoothstep(-0.10, 0.22, d) * (0.4 + 0.6 * max(d, 0.0));
    vec3 color = day * (0.03 + 1.45 * sun);
    // Faint earthshine keeps the night side readable against space
    color += vec3(0.004, 0.008, 0.018) * (1.0 - sun);

    // The day side warms as the Sun gets low
    float twilight = (1.0 - smoothstep(0.0, 0.3, abs(d - 0.04))) * smoothstep(-0.12, 0.05, d);
    color *= mix(vec3(1.0), vec3(1.25, 0.82, 0.6), twilight * 0.7);

    // Sun glint on open water
    vec3 H = normalize(uSun + V);
    float nh = max(dot(N, H), 0.0);
    float facing = smoothstep(0.3, 0.75, dot(N, V));
    float glint = (pow(nh, 320.0) * 0.55 + pow(nh, 48.0) * 0.06) * ocean * smoothstep(0.0, 0.12, d) * facing;
    color += vec3(1.0, 0.8, 0.56) * glint;

    // City lights: sodium amber, only where it's dark
    float lights = pow(nightOcean.r, 1.8) * (1.0 - smoothstep(-0.18, 0.06, d)) * (1.0 - ocean);
    color += vec3(1.0, 0.6, 0.26) * lights * 1.6;

    // Atmosphere seen edge-on across the lit limb
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
    vec3 air = mix(vec3(1.0, 0.48, 0.24), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.35, d));
    color += air * fresnel * smoothstep(-0.25, 0.15, d) * 0.75;
    color += vec3(0.1, 0.17, 0.38) * fresnel * (1.0 - smoothstep(-0.25, 0.15, d)) * 0.22;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createEarth(renderer: WebGLRenderer, quality: QualitySettings) {
  const group = new Group();
  const blank = new Texture();
  const material = new ShaderMaterial({
    uniforms: {
      uDay: { value: blank },
      uNightOcean: { value: blank },
      uSun: { value: new Vector3(1, 0, 0) },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new Mesh(new SphereGeometry(1, 192, 128), material);
  group.add(mesh);

  const loader = new ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' });
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function load(url: string, srgb: boolean): Promise<Texture> {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (bitmap) => {
          const texture = new Texture(bitmap);
          texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
          texture.flipY = false;
          texture.anisotropy = anisotropy;
          texture.minFilter = LinearMipmapLinearFilter;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
  }

  function swap(uniform: 'uDay' | 'uNightOcean', texture: Texture) {
    // Upload before swapping so the switch never shows a blank frame
    renderer.initTexture(texture);
    const previous = material.uniforms[uniform]!.value as Texture;
    material.uniforms[uniform]!.value = texture;
    if (previous !== blank) {
      (previous.image as ImageBitmap | undefined)?.close?.();
      previous.dispose();
    }
  }

  let generation = 0;
  /** Loads textures smallest first, upgrading as each arrives. Resolves when the first pair is on screen. */
  async function loadTextures(settings: QualitySettings) {
    const run = ++generation;
    const [day, night] = await Promise.all([load('/textures/day-1024.avif', true), load('/textures/night-ocean-2048.avif', false)]);
    if (run !== generation) return;
    swap('uDay', day);
    swap('uNightOcean', night);
    const upgrades: Array<['uDay' | 'uNightOcean', string, boolean]> = [];
    for (const size of [2048, 4096, 8192] as const) {
      if (size <= settings.dayTexture) upgrades.push(['uDay', `/textures/day-${size}.avif`, true]);
    }
    if (settings.nightTexture === 4096) upgrades.push(['uNightOcean', '/textures/night-ocean-4096.avif', false]);
    void (async () => {
      for (const [uniform, url, srgb] of upgrades) {
        await new Promise((r) => (window.requestIdleCallback ?? setTimeout)(r));
        const texture = await load(url, srgb).catch(() => null);
        if (!texture || run !== generation) return;
        swap(uniform, texture);
      }
    })();
  }

  const ready = loadTextures(quality);

  return {
    group,
    ready,
    setSun(direction: Vector3) {
      (material.uniforms.uSun!.value as Vector3).copy(direction);
    },
    setQuality(settings: QualitySettings) {
      void loadTextures(settings);
    },
  };
}
