import type * as Three from 'three';

/** three's classes, handed over by the globe that has them, so loading this doesn't split three into its own chunk. */
export type StationKit = Pick<typeof Three, 'BufferAttribute' | 'BufferGeometry' | 'Color' | 'Mesh' | 'MeshStandardMaterial'>;

/** Real ISS arrays read as dark gold in sunlight; NASA's model has them blue. */
const SOLAR_ARRAY = '#8a6a2c';

/** iss.bin: NASA's ISS model, decoded at build time, drawn with a flat colour per facet. */
export async function loadStation({ BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial }: StationKit) {
  const bytes = new Uint8Array(await (await fetch('/iss.bin')).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let o = 4;
  const materials = view.getUint8(o++);
  const palette = Array.from({ length: materials }, (_, i) => new Color().setRGB(bytes[o + i * 3]! / 255, bytes[o + i * 3 + 1]! / 255, bytes[o + i * 3 + 2]! / 255, 'srgb'));
  palette[1] = new Color(SOLAR_ARRAY);
  o += materials * 3;
  const vertices = view.getUint32(o, true);
  const triangles = view.getUint32(o + 4, true);
  o += 8;
  const at = (v: number, axis: number) => view.getInt16(o + v * 6 + axis * 2, true) * 0.002;
  const indexAt = o + vertices * 6;
  const materialAt = indexAt + triangles * 6;
  // Every facet its own three vertices, so flat shading gives each one its own normal and colour
  const position = new Float32Array(triangles * 9);
  const colour = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const c = palette[bytes[materialAt + t]!]!;
    for (let k = 0; k < 3; k++) {
      const v = view.getUint16(indexAt + t * 6 + k * 2, true);
      for (let axis = 0; axis < 3; axis++) position[t * 9 + k * 3 + axis] = at(v, axis);
      colour.set([c.r, c.g, c.b], t * 9 + k * 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(colour, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }));
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  return mesh;
}
