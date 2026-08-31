/**
 * Sensor Styles — GLSL post-processing looks over the whole globe.
 * CRT · NVG (night vision) · FLIR (thermal) · Noir · Snow · Normal.
 *
 * Each style is a Cesium.PostProcessStage with a fragment shader. Only one
 * style is active at a time; toggling swaps stages on viewer.scene.postProcessStages.
 * Pure real-time rendering — no mock data, no external API.
 */

import * as Cesium from 'cesium';

export type SensorStyleId = 'normal' | 'crt' | 'nvg' | 'flir' | 'noir' | 'snow';

export interface SensorStyleDef {
  id: SensorStyleId;
  label: string;
  /** GLSL fragment shader body. `colorTexture` and `v_textureCoordinates` are
   *  provided by Cesium; the shader must assign `gl_FragColor`. */
  frag: string;
  /** Optional single-key keyboard shortcut (e.g. '1'..'7'). */
  key?: string;
  /** Short hint shown in the UI. */
  hint: string;
}

// Shared GLSL helpers (injected above each style's main()).
const NOISE_HELPERS = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const CRT_FRAG = `
uniform sampler2D colorTexture;
uniform float time;
in vec2 v_textureCoordinates;

void main(void) {
  vec2 uv = v_textureCoordinates;
  // RGB subpixel beam offset (chromatic aberration)
  float sub = 0.0011;
  float r = texture(colorTexture, uv + vec2(sub, 0.0)).r;
  float g = texture(colorTexture, uv).g;
  float b = texture(colorTexture, uv - vec2(sub, 0.0)).b;

  // Scanlines
  float scanline = 0.72 + 0.28 * sin(uv.y * 640.0 + time * 0.9);

  // Slight barrel roll vignette
  vec2 c = uv - 0.5;
  float vignette = 1.0 - dot(c, c) * 1.1;

  vec3 rgb = vec3(r, g, b) * scanline * vignette;
  rgb = pow(rgb, vec3(0.9)); // gamma-ish lift
  rgb += vec3(0.015, 0.005, 0.01); // phosphor glow floor
  gl_FragColor = vec4(rgb, 1.0);
}
`;

const NVG_FRAG = `
uniform sampler2D colorTexture;
uniform float time;
in vec2 v_textureCoordinates;
${NOISE_HELPERS}

void main(void) {
  vec3 col = texture(colorTexture, v_textureCoordinates).rgb;
  // Photon-limited luminance
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  // Night-vision tube transfer: crush blacks, lift mids, clip highlights
  float gated = smoothstep(0.02, 0.9, lum);
  // Classic green phosphor tint
  vec3 nvg = vec3(gated * 0.15, gated * 0.95, gated * 0.35);
  // Per-pixel grain
  float grain = (hash(v_textureCoordinates * 1000.0 + fract(time) * 7.0) - 0.5) * 0.12;
  nvg += grain;
  // Center hotspot (lens) + vignette
  vec2 c = v_textureCoordinates - 0.5;
  float vig = 1.0 - dot(c, c) * 1.3;
  nvg *= mix(0.92, 1.0, vig);
  gl_FragColor = vec4(nvg, 1.0);
}
`;

const FLIR_FRAG = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;

vec3 thermal(vec3 c) {
  float t = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Ironbow-like thermal ramp
  vec3 black = vec3(0.0, 0.0, 0.0);
  vec3 deepblue = vec3(0.0, 0.0, 0.6);
  vec3 cyan = vec3(0.0, 0.8, 0.8);
  vec3 yellow = vec3(0.95, 0.9, 0.1);
  vec3 white = vec3(1.0, 1.0, 1.0);
  vec3 col;
  if (t < 0.25) col = mix(black, deepblue, t / 0.25);
  else if (t < 0.5) col = mix(deepblue, cyan, (t - 0.25) / 0.25);
  else if (t < 0.75) col = mix(cyan, yellow, (t - 0.5) / 0.25);
  else col = mix(yellow, white, (t - 0.75) / 0.25);
  return col;
}

void main(void) {
  vec3 col = texture(colorTexture, v_textureCoordinates).rgb;
  gl_FragColor = vec4(thermal(col), 1.0);
}
`;

const NOIR_FRAG = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;

void main(void) {
  vec3 col = texture(colorTexture, v_textureCoordinates).rgb;
  // Hard monochrome with lifted blacks (film-noir contrast)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  lum = pow(lum, 0.85);
  float contrast = (lum - 0.45) * 1.25 + 0.45;
  gl_FragColor = vec4(vec3(contrast), 1.0);
}
`;

const SNOW_FRAG = `
uniform sampler2D colorTexture;
uniform float time;
in vec2 v_textureCoordinates;
${NOISE_HELPERS}

void main(void) {
  vec3 col = texture(colorTexture, v_textureCoordinates).rgb;
  // Cool white balance
  col = pow(col, vec3(0.92, 0.95, 1.0)) * 1.05;
  // Drifting snow specks
  float n = hash(floor(v_textureCoordinates * vec2(320.0, 420.0)) + floor(time * 1.5));
  float speck = step(0.998, n);
  col += vec3(speck) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SENSOR_STYLES: SensorStyleDef[] = [
  {
    id: 'normal',
    label: 'Normal',
    hint: 'No post-processing',
    frag: '',
    key: '1',
  },
  {
    id: 'crt',
    label: 'CRT',
    hint: 'Cathode-ray scanlines + chromatic aberration',
    frag: CRT_FRAG,
    key: '2',
  },
  {
    id: 'nvg',
    label: 'NVG',
    hint: 'Night-vision green phosphor',
    frag: NVG_FRAG,
    key: '3',
  },
  {
    id: 'flir',
    label: 'FLIR',
    hint: 'Forward-looking infrared thermal ramp',
    frag: FLIR_FRAG,
    key: '4',
  },
  {
    id: 'noir',
    label: 'Noir',
    hint: 'Monochrome film-noir contrast',
    frag: NOIR_FRAG,
    key: '5',
  },
  {
    id: 'snow',
    label: 'Snow',
    hint: 'Cool white balance + drifting snow',
    frag: SNOW_FRAG,
    key: '6',
  },
];

/**
 * SensorStyles — manages a single active PostProcessStage on a Cesium viewer.
 * Only one style is enabled at a time; toggling swaps the stage out.
 * Timed stages (CRT, NVG, Snow) get a `time` uniform updated each frame.
 */
export class SensorStyles {
  private viewer: Cesium.Viewer;
  private stage: Cesium.PostProcessStage | null = null;
  private activeId: SensorStyleId = 'normal';
  private lastTime = 0;
  private readonly removePostRender: () => void;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.removePostRender = this.onPostRender.bind(this);
    this.viewer.scene.postRender.addEventListener(this.removePostRender);
  }

  get active(): SensorStyleId {
    return this.activeId;
  }

  private onPostRender(): void {
    if (this.destroyed || !this.stage) return;
    const t = performance.now() / 1000;
    if (Math.abs(t - this.lastTime) < 0.05) return;
    this.lastTime = t;
    try {
      this.stage.uniforms.time = t;
    } catch {
      /* uniform may not exist for static styles */
    }
  }

  set(id: SensorStyleId): void {
    if (this.destroyed) return;
    if (id === this.activeId) return;
    const def = SENSOR_STYLES.find(s => s.id === id) ?? SENSOR_STYLES[0];
    if (this.stage) {
      this.viewer.scene.postProcessStages.remove(this.stage);
      this.stage = null;
    }
    this.activeId = def.id;
    if (def.id !== 'normal' && def.frag) {
      const uniforms: Record<string, unknown> = {};
      if (def.frag.includes('time')) uniforms.time = 0;
      this.stage = new Cesium.PostProcessStage({
        fragmentShader: `
          ${def.frag}
        `,
        uniforms,
      });
      this.viewer.scene.postProcessStages.add(this.stage);
    }
  }

  toggle(id: SensorStyleId): SensorStyleId {
    if (this.activeId === id) {
      this.set('normal');
      return 'normal';
    }
    this.set(id);
    return id;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.stage) {
      this.viewer.scene.postProcessStages.remove(this.stage);
      this.stage = null;
    }
    this.removePostRender();
  }
}
