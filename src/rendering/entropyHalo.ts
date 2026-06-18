import * as Cesium from 'cesium';

export class EntropyHalo {
  private viewer: Cesium.Viewer;
  private stage: Cesium.PostProcessStage | null = null;
  private lastEntropy: number = 0.0;
  private shakeIntensity: number = 0.0;
  private readonly postRenderHandler: () => void;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.postRenderHandler = this.onPostRender.bind(this);
    this.createStage();
    this.viewer.scene.postRender.addEventListener(this.postRenderHandler);
  }

  private createStage(): void {
    const fragmentShader = `
      uniform sampler2D colorTexture;
      uniform float entropy;
      uniform float time;
      in vec2 v_textureCoordinates;

      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec4 color = texture(colorTexture, v_textureCoordinates);
        vec2 uv = v_textureCoordinates;

        float chromaticIntensity = entropy * 0.008;
        float r = texture(colorTexture, uv + vec2(chromaticIntensity, 0.0)).r;
        float g = texture(colorTexture, uv).g;
        float b = texture(colorTexture, uv - vec2(chromaticIntensity, 0.0)).b;

        float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float limbFactor = smoothstep(0.0, 0.3, edgeDist);
        float shimmer = snoise(uv * 20.0 + time * 2.0) * 0.5 + 0.5;
        float limbGlow = (1.0 - limbFactor) * entropy * shimmer * 0.3;

        vec3 limbColor = vec3(1.0, 0.1, 0.05) * limbGlow * step(0.5, entropy);

        vec3 atmosphere = vec3(0.05, 0.1, 0.25) * (1.0 - entropy) * limbGlow;

        vec3 finalColor = vec3(r, g, b) + limbColor + atmosphere;

        float vignette = 1.0 - entropy * 0.3 * (1.0 - limbFactor);
        finalColor *= vignette;

        out_FragColor = vec4(finalColor, 1.0);
      }
    `;

    this.stage = new Cesium.PostProcessStage({
      name: 'entropy_halo',
      fragmentShader,
      uniforms: {
        entropy: 0.0,
        time: 0.0,
      },
    });

    this.viewer.scene.postProcessStages.add(this.stage);
  }

  setEntropy(entropy: number): void {
    if (this.destroyed) return;
    this.lastEntropy = Math.max(0.0, Math.min(1.0, entropy));
    if (this.stage) {
      this.stage.uniforms.entropy = this.lastEntropy;
    }
    this.shakeIntensity = Math.max(0, (this.lastEntropy - 0.6) / 0.4);
  }

  getEntropy(): number { return this.lastEntropy; }

  getInterpretation(): 'baseline' | 'restless' | 'critical' | 'catastrophic' {
    if (this.lastEntropy < 0.3) return 'baseline';
    if (this.lastEntropy < 0.6) return 'restless';
    if (this.lastEntropy < 0.9) return 'critical';
    return 'catastrophic';
  }

  private onPostRender(): void {
    if (this.destroyed) return;
    if (this.shakeIntensity <= 0.001) return;

    const camera = this.viewer.camera;
    const intensity = this.shakeIntensity * 0.0001;

    const offset = new Cesium.Cartesian3(
      (Math.random() - 0.5) * intensity,
      (Math.random() - 0.5) * intensity,
      (Math.random() - 0.5) * intensity * 0.3,
    );

    camera.position = Cesium.Cartesian3.add(camera.position, offset, new Cesium.Cartesian3());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      this.viewer.scene?.postRender.removeEventListener(this.postRenderHandler);
    } catch {
      /* viewer may already be destroyed during hot reload */
    }

    if (this.stage) {
      try {
        this.viewer.scene?.postProcessStages.remove(this.stage);
        if (!this.stage.isDestroyed?.()) {
          this.stage.destroy();
        }
      } catch {
        /* viewer may already be destroyed during hot reload */
      } finally {
        this.stage = null;
      }
    }
  }
}
