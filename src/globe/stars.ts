import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

const RADIUS = 90;

interface StarCatalogue {
  stars: [raHours: number, decDeg: number, mag: number, colourIndex: number][];
}

// B–V colour index to a rough blackbody tint: blue-white hot stars to orange cool ones
function tint(bv: number): [number, number, number] {
  const t = Math.min(Math.max((bv + 0.3) / 1.9, 0), 1);
  const stops: [number, number, number][] = [
    [0.66, 0.76, 1.0],
    [1.0, 0.98, 0.94],
    [1.0, 0.78, 0.52],
  ];
  const [a, b, k] = t < 0.47 ? [stops[0]!, stops[1]!, t / 0.47] : [stops[1]!, stops[2]!, (t - 0.47) / 0.53];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export async function createStars(pixelRatio: number) {
  const { stars } = (await (await fetch('/stars.json')).json()) as StarCatalogue;
  const position = new Float32Array(stars.length * 3);
  const colour = new Float32Array(stars.length * 3);
  const size = new Float32Array(stars.length);
  stars.forEach(([ra, dec, mag, bv], i) => {
    const a = (ra * 15 * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    // Equatorial (x to the vernal equinox, z to the pole) in the same axes as the orbits
    position.set([RADIUS * Math.cos(d) * Math.cos(a), RADIUS * Math.sin(d), -RADIUS * Math.cos(d) * Math.sin(a)], i * 3);
    const light = Math.pow(10, -0.4 * (mag - 1));
    colour.set(tint(bv).map((c) => c * Math.min(1, 0.4 + light)), i * 3);
    size[i] = Math.max(1.4, 3.8 - mag * 0.45) * pixelRatio;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aColour', new BufferAttribute(colour, 3));
  geometry.setAttribute('aSize', new BufferAttribute(size, 1));
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aColour;
      attribute float aSize;
      varying vec3 vColour;
      void main() {
        vColour = aColour;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vColour * a * a, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}
