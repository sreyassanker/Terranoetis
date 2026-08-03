/**
 * ScalarSurfacePrimitive.ts — GPU-animated 3D displaced surface.
 *
 * A single Cesium.Primitive renders every animation frame:
 *  - mesh of the domain at renderGrid resolution
 *  - vertex shader samples the packed atlas and displaces vertices up
 *  - fabric material shades fragments via a GLSL colormap
 *  - lighting uses Cesium's Phong harness (FLAT / FACE_FORWARD aware)
 *
 * Frame changes are single uniform updates on the GPU — no mesh rebuilds,
 * texture re-creations, or per-frame canvas rasterization.
 */

import * as Cesium from 'cesium';
import {
  buildGeoFrame,
  cellToWorld,
  heightfieldNormals,
  packScalarAtlas,
  type ScalarAtlas,
  type GeoFrame,
} from './fieldData';
import type { GridData } from '../shared';
import { colormapGLSL, type CfaColormapName } from './cfdColormaps';

/** Atlas tile lookup used by both the vertex shader and the fabric fragment. */
const ATLAS_UV_GLSL = /* glsl */ `
  vec2 kaggleAtlasUV(float frame, vec2 tiles, vec2 st) {
    float f = floor(frame + 0.5);
    float col = mod(f, tiles.x);
    float row = floor(f / tiles.x);
    return (vec2(col, row) + clamp(st, 0.0, 1.0)) / tiles;
  }
`;

export interface ScalarSurfaceOptions {
  viewer: Cesium.Viewer;
  centerLat: number;
  centerLon: number;
  gs: number;
  cellSizeM: number;
  /** [F,R,C] scalar series; F=1 renders a static surface. */
  series: GridData;
  /** Optional per-frame seconds (only used for display). */
  times?: number[];
  /** Terrain elevation in meters [gs*gs]; default flat ellipsoid (0). */
  terrain?: ArrayLike<number>;
  /** World height (meters) of one normalized unit — `value/max * exaggeration`. */
  exaggeration?: number;
  /** Normalization cap. Defaults to series max. */
  maxValue?: number;
  /** Colormap name compiled into GLSL. */
  colormap?: CfaColormapName;
  /**
   * Hide fragments with normalized value < alphaFloor. Default 0.005.
   * Increase to clip out noise / non-flooded interior.
   */
  alphaFloor?: number;
  /** Add a subtle grey side-wall tint to vertical faces (CFD cross-section look). */
  sideTint?: boolean;
  /** Force fully opaque surface regardless of value. */
  forceOpaque?: boolean;
}

export class ScalarSurfacePrimitive {
  readonly frames: number;
  readonly times: number[];
  readonly maxValue: number;
  readonly minValue: number;

  private readonly viewer: Cesium.Viewer;
  private readonly frame: GeoFrame;
  private readonly gs: number;
  private readonly exaggeration: number;
  private colormap: CfaColormapName;
  private readonly atlas: ScalarAtlas;
  private readonly alphaFloor: number;
  private readonly sideTint: boolean;
  private readonly forceOpaque: boolean;

  private primitive: Cesium.Primitive | null = null;
  private material: Cesium.Material | null = null;
  private appearance: Cesium.MaterialAppearance | null = null;
  private atlasTexture: (Cesium.Texture & { type?: string }) | null = null;
  private vertexShaderSource = '';
  private opacity = 1;
  private currentFrame = -1;
  private destroyed = false;

  constructor(opts: ScalarSurfaceOptions) {
    this.viewer = opts.viewer;
    this.frame = buildGeoFrame(opts.centerLat, opts.centerLon, opts.gs, opts.cellSizeM);
    this.gs = opts.gs;
    this.exaggeration = opts.exaggeration ?? 1000;
    this.colormap = opts.colormap ?? 'turbo';
    this.alphaFloor = Math.max(0, opts.alphaFloor ?? 0.005);
    this.sideTint = !!opts.sideTint;
    this.forceOpaque = !!opts.forceOpaque;

    this.atlas = packScalarAtlas(opts.series);
    this.frames = this.atlas.frames;
    this.times = opts.times ?? Array.from({ length: this.frames }, (_, i) => i);
    this.maxValue = opts.maxValue ?? this.atlas.max;
    this.minValue = this.atlas.min;

    this.build(opts.terrain);
  }

  private build(terrain?: ArrayLike<number>) {
    if (this.destroyed) return;
    const gs = this.gs;
    const frame = this.frame;

    // ── Geometry ──────────────────────────────────────────────────────────────
    const totalVerts = gs * gs;
    const positions = new Float64Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const sts = new Float32Array(totalVerts * 2);
    const indices = new Uint32Array((gs - 1) * (gs - 1) * 6);

    const elev = terrain ?? new Float32Array(totalVerts);
    const norms = heightfieldNormals(elev, gs, frame.cellSizeM);

    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        const cell = r * gs + c;
        const h = Number.isFinite(elev[cell]) ? elev[cell] : 0;
        const w = cellToWorld(frame, c, r, h);
        positions[cell * 3] = w.x;
        positions[cell * 3 + 1] = w.y;
        positions[cell * 3 + 2] = w.z;
        normals[cell * 3] = norms[cell * 3];
        normals[cell * 3 + 1] = norms[cell * 3 + 1];
        normals[cell * 3 + 2] = norms[cell * 3 + 2];
        sts[cell * 2] = c / (gs - 1);
        sts[cell * 2 + 1] = r / (gs - 1);
      }
    }

    let ii = 0;
    for (let r = 0; r < gs - 1; r++) {
      for (let c = 0; c < gs - 1; c++) {
        const i00 = r * gs + c;
        const i01 = i00 + 1;
        const i10 = i00 + gs;
        const i11 = i10 + 1;
        indices[ii++] = i00;
        indices[ii++] = i10;
        indices[ii++] = i01;
        indices[ii++] = i01;
        indices[ii++] = i10;
        indices[ii++] = i11;
      }
    }

    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positions,
        }),
        normal: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: normals,
        }),
        st: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 2,
          values: sts,
        }),
        // MaterialAppearance's MaterialSupport.TEXTURED requires these
        // attributes — supply identity tangents/bitangents. They are not
        // consumed by the fabric shader but satisfy GeometryAttributes.
        tangent: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: new Float32Array(totalVerts * 3).fill(0),
        }),
        bitangent: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: new Float32Array(totalVerts * 3).fill(0),
        }),
        color: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          values: new Uint8Array(totalVerts * 4).fill(255),
          normalize: true,
        }),
      },
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });

    // ── Vertex shader (replaces TEXTURED appearance template) ────────────────
    // Mirrors Cesium's TexturedMaterialAppearanceVS but adds atlas sampling +
    // world-space displacement along u_up.
    const vertexShaderSource = /* glsl */ `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec3 normal;
      in vec2 st;
      in float batchId;

      uniform sampler2D u_vs_field;
      uniform float u_vs_frame;
      uniform vec2 u_vs_tiles;
      uniform vec3 u_vs_up;
      uniform float u_vs_exaggeration;

      out vec3 v_positionEC;
      out vec3 v_normalEC;
      out vec2 v_st;
      out float v_value;

      ${ATLAS_UV_GLSL}

      void main() {
        vec2 uv = kaggleAtlasUV(u_vs_frame, u_vs_tiles, st);
        float norm = texture(u_vs_field, uv).r;

        // czm_computePosition() yields the Cesium-encoded position
        // in the "relative-to-eye" frame the rasterizer expects.
        vec4 p = czm_computePosition();
        p.xyz += u_vs_up * norm * u_vs_exaggeration;

        v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
        v_normalEC = czm_normal * normal;
        v_st = st;
        v_value = norm;

        gl_Position = czm_modelViewProjectionRelativeToEye * p;
      }
    `;
    this.vertexShaderSource = vertexShaderSource;

    // Real GPU texture for the atlas. Used by BOTH the vertex shader (via
    // appearance uniforms, which Cesium does NOT rename) and the material
    // fragment (fabric uniforms get renamed to `<id>_<n>` at compile time, so
    // they must stay separate).
    const atlasSampler = new Cesium.Sampler({
      wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
      wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
      magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
    });
    const atlasTexture = new Cesium.Texture({
      context: this.viewer.scene.context,
      source: {
        arrayBufferView: this.atlas.data,
        width: this.atlas.width,
        height: this.atlas.height,
      },
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      sampler: atlasSampler,
      // Atlas is stored row 0 = grid row 0 (north); st.t=0 must sample v=0.
      flipY: false,
    }) as Cesium.Texture & { type?: string };
    // Material.getUniformType() keys off `.type` to discriminate sampler2D.
    (atlasTexture as unknown as { type: string }).type = 'sampler2D';
    this.atlasTexture = atlasTexture;

    this.appearance = this.buildAppearance(this.colormap);

    this.primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: this.appearance,
      asynchronous: false,
      // Do NOT oct-compress normals: the shader displaces vertices and Cesium
      // would reject the compressed normals.
      compressVertices: false,
    });
    (this.primitive as unknown as { name?: string }).name =
      `kaggle-scalar-${this.colormap}`;
    // Keep the collection from destroying the primitive on removal — the class
    // owns both the texture (via material uniforms) and the appearance, so
    // disposal order is handled explicitly in destroy().
    (this.primitive as unknown as { destroyPrimitives?: boolean });
    this.viewer.scene.primitives.add(this.primitive);
    this.viewer.scene.requestRender();
  }

  /** Fragment source for a given colormap (baked into the fabric shader). */
  private makeFragmentSource(cmap: CfaColormapName): string {
    return /* glsl */ `
      ${ATLAS_UV_GLSL}
      ${colormapGLSL(cmap)}

      czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec2 uv = kaggleAtlasUV(u_frame, u_tiles, materialInput.st);
        float norm = texture(u_field, uv).r;
        vec3 rgb = kaggleCmap(norm);

        ${this.sideTint ? `
        // Side-wall tint — dim the vertical faces for a CFD-mesh look.
        // Use czm_getNonPhotorealisticShading to derive a lighting-friendly edge.
        // Since side walls have steep normals, we approximate their darkness by
        // sampling normal.z from the model's world space (available via
        // materialInput.str after texture coords get remapped).
        // Simply use the norm alpha to indicate interior vs. edge of surface.
        float side = 1.0 - norm;  // alpha=1 => interior, norm≈0 → outer edge of sheet
        rgb = mix(rgb, rgb * 0.45 + vec3(0.35), clamp(side * 0.4, 0.0, 0.6));
        ` : ''}

        material.diffuse = rgb;
        float userAlpha = ${this.forceOpaque ? '1.0' : '(norm < u_alphaFloor) ? 0.0 : 0.93'};
        material.alpha = userAlpha * u_opacity;
        material.specular = 0.25;
        material.shininess = 14.0;
        material.emission = vec3(0.0);
        return material;
      }
    `;
  }

  /**
   * Build a new MaterialAppearance for a colormap. The returned appearance's
   * material holds this.atlasTexture as a shared uniform — ownership of the
   * atlas stays with the class, so disposal must detach it first.
   */
  private buildAppearance(cmap: CfaColormapName): Cesium.MaterialAppearance {
    if (this.destroyed || !this.atlasTexture) {
      throw new Error('buildAppearance called after destroy or without atlas');
    }

    const frame = Math.max(0, this.currentFrame);

    const material = new Cesium.Material({
      fabric: {
        uniforms: {
          u_field: this.atlasTexture,
          u_frame: frame,
          u_tiles: new Cesium.Cartesian2(this.atlas.tilesX, this.atlas.tilesY),
          u_alphaFloor: this.alphaFloor,
          u_opacity: this.opacity,
        },
        source: this.makeFragmentSource(cmap),
      },
      translucent: !this.forceOpaque,
    });

    const appearance = new Cesium.MaterialAppearance({
      material,
      faceForward: false,
      flat: false,
      translucent: !this.forceOpaque,
      materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
      vertexShaderSource: this.vertexShaderSource,
    });
    appearance.uniforms = {
      u_vs_field: this.atlasTexture,
      u_vs_frame: frame,
      u_vs_tiles: new Cesium.Cartesian2(this.atlas.tilesX, this.atlas.tilesY),
      u_vs_up: new Cesium.Cartesian3(this.frame.up.x, this.frame.up.y, this.frame.up.z),
      u_vs_exaggeration: this.exaggeration,
    };
    return appearance;
  }

  /**
   * Destroy a replaced material WITHOUT killing the shared atlas texture.
   * Material.destroy() also destroys every texture in its fabric uniforms
   * (`_textures`), and the atlas is owned by this class and reused across
   * colormap swaps — so detach it from the old material first.
   */
  /**
   * Destroy a material WITHOUT killing the shared atlas texture.
   * Material.destroy() also destroys every texture in its fabric uniforms
   * (`_textures`), and the atlas is owned by this class and reused across
   * colormap swaps — so detach it from the material first.
   */
  private disposeMaterial(mat: Cesium.Material | null): void {
    if (!mat || mat.isDestroyed()) return;
    const textures = (mat as unknown as { _textures?: Record<string, unknown> })._textures;
    if (textures) {
      for (const key of Object.keys(textures)) {
        if (textures[key] === this.atlasTexture) delete textures[key];
      }
    }
    mat.destroy();
  }

  /**
   * Destroy an appearance + its material, detaching the shared atlas from
   * both the fabric material's `_textures` and the appearance's own
   * `uniforms.u_vs_field`.
   */
  private disposeAppearance(appearance: Cesium.MaterialAppearance | null): void {
    if (!appearance || appearance.isDestroyed()) return;
    if (this.atlasTexture && appearance.uniforms && appearance.uniforms.u_vs_field === this.atlasTexture) {
      delete appearance.uniforms.u_vs_field;
    }
    this.disposeMaterial(appearance.material);
    appearance.destroy();
  }

  /** Set the current animation frame — a single GPU uniform update. */
  setFrame(idx: number): void {
    if (this.destroyed || !this.material) return;
    const clamped = Math.max(0, Math.min(this.frames - 1, idx));
    if (clamped === this.currentFrame) return;
    this.currentFrame = clamped;
    this.material.uniforms.u_frame = clamped;
    if (this.appearance && this.appearance.uniforms.u_vs_frame !== undefined) {
      this.appearance.uniforms.u_vs_frame = clamped;
    }
    this.viewer.scene.requestRender();
  }

  /** Live opacity (0–1) via the u_opacity uniform. */
  setOpacity(alpha: number): void {
    if (this.destroyed || !this.material) return;
    this.opacity = Math.max(0, Math.min(1, alpha));
    this.material.uniforms.u_opacity = this.opacity;
    this.viewer.scene.requestRender();
  }

  /**
   * Swap the baked GLSL colormap. Builds a new appearance, swaps it on the
   * live primitive first (so the shader recompile is scheduled by
   * Primitive.update), then disposes the old appearance+material without
   * touching the shared atlas texture.
   */
  setColormap(name: CfaColormapName): void {
    if (this.destroyed || !this.primitive || !this.atlasTexture) return;
    if (name === this.colormap) return;
    this.colormap = name;
    const oldAppearance = this.appearance;
    this.appearance = this.buildAppearance(name);
    this.material = this.appearance.material;
    this.primitive.appearance = this.appearance;
    this.disposeAppearance(oldAppearance);
    this.viewer.scene.requestRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.primitive) {
      // Remove from the scene WITHOUT destroying — ownership of the material,
      // appearance, and atlas texture is this class's responsibility, and
      // dispose order matters (the atlas lives inside appearance.material).
      this.viewer.scene.primitives.remove(this.primitive);
      this.primitive = null;
    }
    this.disposeAppearance(this.appearance);
    this.appearance = null;
    this.material = null;
    if (this.atlasTexture && !this.atlasTexture.isDestroyed()) {
      this.atlasTexture.destroy();
      this.atlasTexture = null;
    }
  }
}
