import { BlendFunction, Effect, MipmapBlurPass } from 'postprocessing';
import { BufferAttribute, BufferGeometry, Color, HalfFloatType, Mesh, Scene, Uniform, WebGLRenderTarget, type Camera, type Material, type WebGLRenderer } from 'three';

/**
 * Objects on this layer are drawn only into the glow buffer: copies of the satellites and the Earth that
 * emit nothing but their brightest light. Selecting by what each shader emits, rather than by a brightness
 * threshold, keeps sunlit desert and ice from blooming and lets satellite cores keep their colour.
 */
export const GLOW_LAYER = 1;

const fragmentShader = /* glsl */ `
  uniform sampler2D tGlow;
  uniform float uIntensity;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(texture2D(tGlow, uv).rgb * uIntensity, inputColor.a);
  }
`;

export class GlowEffect extends Effect {
  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private readonly blur = new MipmapBlurPass();
  private readonly black = new Color(0);
  private readonly previousClear = new Color();
  private _scale = 0.5;

  /** Glow buffer resolution relative to the screen. Fewer blur levels at lower resolution keep halos the same size on screen. */
  get scale() {
    return this._scale;
  }
  set scale(value: number) {
    this._scale = value;
    this.blur.levels = value >= 0.5 ? 4 : 3;
  }

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    { scale = 0.5, intensity = 1.6 } = {},
  ) {
    super('GlowEffect', fragmentShader, {
      blendFunction: BlendFunction.ADD,
      uniforms: new Map<string, Uniform>([
        ['tGlow', new Uniform(null)],
        ['uIntensity', new Uniform(intensity)],
      ]),
    });
    // A modest radius keeps each halo close to its source
    this.blur.radius = 0.6;
    this.scale = scale;
    this.uniforms.get('tGlow')!.value = this.blur.texture;
  }

  override update(renderer: WebGLRenderer) {
    const { camera } = this;
    const mask = camera.layers.mask;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.previousClear);
    camera.layers.set(GLOW_LAYER);
    renderer.setClearColor(this.black, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, camera);
    camera.layers.mask = mask;
    renderer.setClearColor(this.previousClear, alpha);
    this.blur.render(renderer, this.target, null);
  }

  /** The blur's shaders, so they can be compiled ahead of the first frame. */
  get blurMaterials(): Material[] {
    const { downsamplingMaterial, upsamplingMaterial } = this.blur as unknown as { downsamplingMaterial: Material; upsamplingMaterial: Material };
    return [downsamplingMaterial, upsamplingMaterial];
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    this.target.setSize(w, h);
    this.blur.setSize(w, h);
  }

  override dispose() {
    this.target.dispose();
    this.blur.dispose();
    super.dispose();
  }
}

/**
 * Compiles full-screen pass materials without blocking, each against the kind of target it draws into:
 * the program differs between a linear buffer and the screen. Otherwise each links on its first frame.
 */
export async function compilePasses(renderer: WebGLRenderer, camera: Camera, toBuffer: Material[], toScreen: Material[], buffer: WebGLRenderTarget) {
  // Shaped like postprocessing's full-screen triangle (a position attribute, no normals): three keys programs on that
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const compile = async (materials: Material[], target: WebGLRenderTarget | null) => {
    const scene = new Scene();
    for (const material of materials) {
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene, camera);
  };
  await compile(toBuffer, buffer);
  await compile(toScreen, null);
  renderer.setRenderTarget(null);
  geometry.dispose();
}
