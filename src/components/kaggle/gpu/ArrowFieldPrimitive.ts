/**
 * ArrowFieldPrimitive.ts
 *
 * Single-draw-call GPU-animated 3D CFD arrow field.
 *
 * Each arrow is a real triangulated mesh (cylinder shaft + cone head),
 * duplicated once per sampled grid cell, one index buffer — one draw call for all
 * arrows. The vertex shader samples the packed velocity atlas and rigidly rotates
 * + scales the unit arrow to local flow; the fragment shader colors by colormap.
 * Frame changes are uniform updates only.
 *
 * Custom attribute names are registered with Cesium via the recorded
 * `createAttributeLocations` path — a runtime-visible `as unknown as` /
 * `Partial`-cast workaround is required for TypeScript's narrowed
 * `GeometryAttributes`.
 */

import * as Cesium from 'cesium';
import {
  buildGeoFrame,
  cellToWorld,
  packScalarAtlas,
  packVelocityAtlas,
  type ScalarAtlas,
  type VelocityAtlas,
  type GeoFrame,
} from './fieldData';
import type { GridData } from '../shared';
import { colormapGLSL, type CfaColormapName } from './cfdColormaps';
import {
  runtimeCesium,
  sceneContext,
  type LooseMaterialAppearance,
  type LooseTexture,
} from './cesiumRuntime';

/** Atlas tile lookup used by the vertex shader (arrow deformation). */
const ATLAS_UV_GLSL = /* glsl */ `
  vec2 kaggleAtlasUV(float frame, vec2 tiles, vec2 st) {
    float f = floor(frame + 0.5);
    float col = mod(f, tiles.x);
    float row = floor(f / tiles.x);
    return (vec2(col, row) + clamp(st, 0.0, 1.0)) / tiles;
  }

  /** Interpolated atlas sample for velocity — lerps between frames for smooth arrow animation. */
  vec3 kaggleAtlasLerp3(sampler2D tex, float frame, vec2 tiles, vec2 st) {
    float totalFrames = tiles.x * tiles.y;
    float f0 = floor(frame);
    float f1 = min(f0 + 1.0, totalFrames - 1.0);
    float t = frame - f0;
    vec2 uv0 = kaggleAtlasUV(f0, tiles, st);
    vec2 uv1 = kaggleAtlasUV(f1, tiles, st);
    return mix(texture(tex, uv0).rgb, texture(tex, uv1).rgb, t);
  }
`;

// — Mesh template ----------------------------------------------------------

interface ArrowTemplate {
  positions: Float32Array;
  triangles: Uint16Array;
  count: number; // vertices per arrow
}

/**
 * Build a unit arrow mesh along +X: cylinder shaft + cone head.
 * All vertices share the same 7-attribute layout; displacement occurs in
 * the vertex shader.
 */
function buildArrowTemplate(
  segments = 8,
  shaftLen = 0.72,
  shaftRadius = 0.05,
  headLen = 0.28,
  headRadius = 0.15,
): ArrowTemplate {
  // Ring-ordered vertices: [base center, shaftStart(i), shaftEnd(i), headRing(i), coneTip]
  const verts: number[] = [0, 0, 0]; // cone base center (index 0)
  const shaftStart: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    shaftStart.push(verts.length / 3);
    verts.push(0, shaftRadius * Math.cos(a), shaftRadius * Math.sin(a));
  }
  const shaftEnd: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    shaftEnd.push(verts.length / 3);
    verts.push(shaftLen, shaftRadius * Math.cos(a), shaftRadius * Math.sin(a));
  }
  const headRing: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    headRing.push(verts.length / 3);
    verts.push(shaftLen, headRadius * Math.cos(a), headRadius * Math.sin(a));
  }
  const coneTip = verts.length / 3;
  verts.push(shaftLen + headLen, 0, 0);

  const tris: number[] = [];
  // Base octagon fan
  for (let s = 0; s < segments; s++) {
    tris.push(0, shaftStart[s], shaftStart[(s + 1) % segments]);
  }
  // Shaft wall quads
  for (let s = 0; s < segments; s++) {
    const a0 = shaftStart[s];
    const a1 = shaftStart[(s + 1) % segments];
    const b0 = shaftEnd[s];
    const b1 = shaftEnd[(s + 1) % segments];
    tris.push(a0, b0, a1, a1, b0, b1);
  }
  // Cone ring walls (head)
  for (let s = 0; s < segments; s++) {
    const b0 = shaftEnd[s];
    const b1 = shaftEnd[(s + 1) % segments];
    const h0 = headRing[s];
    const h1 = headRing[(s + 1) % segments];
    tris.push(b0, h0, b1, b1, h0, h1);
  }
  // Cone lid (tip)
  for (let s = 0; s < segments; s++) {
    tris.push(headRing[s], coneTip, headRing[(s + 1) % segments]);
  }

  return {
    positions: new Float32Array(verts),
    triangles: new Uint16Array(tris),
    count: verts.length / 3,
  };
}

/** Compute smoothed radial normals for the arrow mesh (the normalize trick). */
function computeArrowNormals(template: ArrowTemplate): Float32Array {
  const n = template.count;
  const out = new Float32Array(n * 3);
  const p = template.positions;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    // Smooth-ish radial normal: bend outward along shaft radial, forward along tip
    const radial = Math.hypot(y, z);
    let nx = x + 0.05;   // slight forward bias so the cone tip lights correctly
    const ny = y;
    const nz = z;
    // For shaft vertices (radial>0), the surface normal points outward
    if (radial > 1e-5) {
      nx = 0;            // Zero out X so we don't double-count length
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    out[i * 3] = nx / l;
    out[i * 3 + 1] = ny / l;
    out[i * 3 + 2] = nz / l;
  }
  return out;
}

// — Primitive options -------------------------------------------------------

export interface ArrowFieldOptions {
  viewer: Cesium.Viewer;
  centerLat: number;
  centerLon: number;
  gs: number;
  cellSizeM: number;
  /** [F,R,C] */
  vxSeries: GridData;
  /** [F,R,C] */
  vySeries: GridData;
  /** Terrain elevation [gs*gs]; default flat ellipsoid. */
  terrain?: ArrayLike<number>;
  /**
   * Optional [F,R,C] depth/scalar series used to lift arrows *above the
   * displaced surface* (not just bare terrain). The arrow shader adds
   * `(depth/maxDepth) * exaggeration` of vertical offset, matching
   * ScalarSurfacePrimitive's displacement, so arrows float `lift` meters
   * above the visible debris surface each frame.
   */
  depthSeries?: GridData;
  /**
   * Vertical exaggeration (meters per normalized scalar unit) — MUST match the
   * `exaggeration` passed to ScalarSurfacePrimitive for correct alignment.
   */
  exaggeration?: number;
  /** Sample every Nth cell — 1 = dense. */
  stride?: number;
  /** Shaft length at zero speed (meters). Default cellSizeM * 0.55. */
  minLen?: number;
  /** Extra scale from 0→maxSpeed. Default cellSizeM * 2.4. */
  lenScale?: number;
  /** Physical speed cap for normalization. */
  maxSpeed?: number;
  /** Thickness ratio relative to cellSizeM. Default 0.08. */
  thickness?: number;
  /** Height above terrain to lift arrows (meters). Default cellSizeM * 0.5. */
  lift?: number;
  /** Colormap baked into the fragment shader. */
  colormap?: CfaColormapName;
}

// — Primitive class --------------------------------------------------------

export class ArrowFieldPrimitive {
  readonly frames: number;
  readonly maxSpeed: number;
  readonly stride: number;
  readonly arrowCount: number;

  private readonly viewer: Cesium.Viewer;
  private readonly frame: GeoFrame;
  private readonly gs: number;
  private readonly atlas: VelocityAtlas;
  private colormap: CfaColormapName;

  private primitive: Cesium.Primitive | null = null;
  private material: Cesium.Material | null = null;
  private appearance: LooseMaterialAppearance | null = null;
  private atlasTexture: LooseTexture | null = null;
  private depthAtlas: ScalarAtlas | null = null;
  private depthTexture: LooseTexture | null = null;
  private exaggeration = 0;
  private vertexShaderSource = '';
  private minLen = 0;
  private lenScale = 0;
  private thickRatio = 0;
  private opacity = 1;
  private currentFrame = -1;
  private destroyed = false;

  constructor(opts: ArrowFieldOptions) {
    this.viewer = opts.viewer;
    this.frame = buildGeoFrame(opts.centerLat, opts.centerLon, opts.gs, opts.cellSizeM);
    this.gs = opts.gs;
    this.colormap = opts.colormap ?? 'viridis';

    this.atlas = packVelocityAtlas(opts.vxSeries, opts.vySeries);
    this.maxSpeed = opts.maxSpeed && opts.maxSpeed > 0
      ? opts.maxSpeed
      : this.atlas.maxSpeed;
    this.frames = this.atlas.frames;
    this.stride = Math.max(1, opts.stride ?? Math.ceil(opts.gs / 48));
    this.exaggeration = Math.max(0, opts.exaggeration ?? 0);
    if (opts.depthSeries) {
      this.depthAtlas = packScalarAtlas(opts.depthSeries);
    }

    // Build arrow instances (one per active cell)
    const templ = buildArrowTemplate();
    const arrowNormals = computeArrowNormals(templ);
    const arrowVertCount = templ.count;
    const arrowIndexCount = templ.triangles.length; // indices per arrow (vertex count is templ.count)
    const cells: Array<{ row: number; col: number; s: number; t: number; ecef: Cesium.Cartesian3 }> = [];

    // `elev` may be omitted (undefined) by callers who don't have terrain heights.
    // In that case, use a flat zero array so the primitive constructor still succeeds.
    const elev: ArrayLike<number> = opts.terrain ?? Array.from({ length: opts.gs * opts.gs }, () => 0);

    for (let r = 0; r < opts.gs; r += this.stride) {
      for (let c = 0; c < opts.gs; c += this.stride) {
        const rIdx = Math.min(opts.gs - 1, r);
        const cIdx = Math.min(opts.gs - 1, c);
        const cell = rIdx * opts.gs + cIdx;
        const h = Number.isFinite(elev[cell]) ? elev[cell] : 0;
        const ecef = cellToWorld(this.frame, cIdx, rIdx, h + (opts.lift ?? opts.cellSizeM * 0.5));
        cells.push({
          row: rIdx,
          col: cIdx,
          s: cIdx / (opts.gs - 1),
          t: rIdx / (opts.gs - 1),
          ecef: new Cesium.Cartesian3(ecef.x, ecef.y, ecef.z),
        });
      }
    }
    this.arrowCount = cells.length;

    // Expand to a single interleaved vertex buffer: [arrowVerts per arrow] * N instances
    const N = cells.length;
    const vertCount = N * arrowVertCount;
    const positions = new Float64Array(vertCount * 3);     // position (for culling + RTC anchor)
    const arrowLocal = new Float32Array(vertCount * 3);
    const normalArr = new Float32Array(vertCount * 3);
    const tangentArr = new Float32Array(vertCount * 3);
    const bitangentArr = new Float32Array(vertCount * 3);
    const colorArr = new Uint8Array(vertCount * 4).fill(255);
    const stArr = new Float32Array(vertCount * 2);
    const cellSizeArr = new Float32Array(vertCount);
    const indices = new Uint32Array(N * arrowIndexCount);

    for (let inst = 0; inst < N; inst++) {
      const cell = cells[inst];
      const base = inst * arrowVertCount;
      for (let v = 0; v < arrowVertCount; v++) {
        const vi = base + v;
        arrowLocal[vi * 3] = templ.positions[v * 3];
        arrowLocal[vi * 3 + 1] = templ.positions[v * 3 + 1];
        arrowLocal[vi * 3 + 2] = templ.positions[v * 3 + 2];
        normalArr[vi * 3] = arrowNormals[v * 3];
        normalArr[vi * 3 + 1] = arrowNormals[v * 3 + 1];
        normalArr[vi * 3 + 2] = arrowNormals[v * 3 + 2];
        stArr[vi * 2] = cell.s;
        stArr[vi * 2 + 1] = cell.t;
        cellSizeArr[vi] = opts.cellSizeM;
        positions[vi * 3] = cell.ecef.x;
        positions[vi * 3 + 1] = cell.ecef.y;
        positions[vi * 3 + 2] = cell.ecef.z;
      }
      // Indices for this instance
      for (let t = 0; t < arrowIndexCount; t++) {
        indices[inst * arrowIndexCount + t] = base + templ.triangles[t];
      }
    }

    // ── Geometry with custom attributes ───────────────────────────────────────
    // TypeScript declares GeometryAttributes as a closed interface; Cesium's
    // runtime pipeline actually enumerates every own property and creates an
    // attribute location for whatever it finds. We cast via Partial to bypass.
    const attributes: Partial<Cesium.GeometryAttributes> & Record<string, Cesium.GeometryAttribute> = {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      st: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: stArr,
      }),
      arrowLocal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: arrowLocal,
      }),
      cellSize: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: cellSizeArr,
      }),
      // Not used by the appearance shader (we compute normals procedurally
      // in VS), but MaterialAppearance's TEXTURED vertex format requires
      // these attributes, even if unused by its shader. Zero-fill to keep
      // memory footprint small, mirroring ScalarSurfacePrimitive.
      normal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normalArr,
      }),
      tangent: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: tangentArr,
      }),
      bitangent: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: bitangentArr,
      }),
      color: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
        componentsPerAttribute: 4,
        values: colorArr,
        normalize: true,
      }),
    };

    const geometry = new Cesium.Geometry({
      attributes: attributes as Cesium.GeometryAttributes,
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(
        Float64Array.from(cells.flatMap((c) => [c.ecef.x, c.ecef.y, c.ecef.z])),
      ),
    });

    // ── Shaders ─────────────────────────────────────────────────────
    this.minLen = opts.minLen ?? opts.cellSizeM * 0.55;
    this.lenScale = opts.lenScale ?? opts.cellSizeM * 2.4;
    this.thickRatio = opts.thickness ?? 0.08;

    const vertexShaderSource = /* glsl */ `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec2 st;
      in float batchId;

      // Per-vertex (instanced) attributes
      in vec3 arrowLocal;   // unit arrow, tip +X
      in vec3 normal;       // arrow-local normal
      in float cellSize;    // meters per grid cell

      uniform sampler2D u_vs_field;
      uniform sampler2D u_vs_depth;
      uniform float u_vs_frame;
      uniform vec2 u_vs_tiles;
      uniform float u_vs_minLen;
      uniform float u_vs_lenScale;
      uniform float u_vs_thickness;
      uniform float u_vs_exaggeration;
      uniform vec3 u_vs_up;
      uniform vec3 u_vs_east;
      uniform vec3 u_vs_south;

      out vec3 v_positionEC;
      out vec3 v_normalEC;
      out vec2 v_st;
      out float v_speed;

      ${ATLAS_UV_GLSL}

      void main() {
        vec3 packed = kaggleAtlasLerp3(u_vs_field, u_vs_frame, u_vs_tiles, st);
        float vx = packed.x * 2.0 - 1.0;   // east/top-right in grid frame
        float vy = packed.y * 2.0 - 1.0;   // south-positive in grid frame
        float speedNorm = packed.z;        // 0..1

        // Direction in grid space (x = east, y = south).
        vec2 dir = length(vec2(vx, vy)) < 1e-4 ? vec2(1.0, 0.0)
                                                 : normalize(vec2(vx, vy));
        // Magnitude scales length
        float len = u_vs_minLen + speedNorm * u_vs_lenScale;
        float thick = u_vs_thickness * cellSize * (0.75 + 0.45 * speedNorm);

        // ENU basis: X = flow dir in the local tangent plane (east/south mixed in
        // ECEF), Y = tangential normal, Z = geodetic up. Using frame-relative
        // east/south avoids the global x/y-ECEF mapping bug that oriented arrows
        // correctly only at the equator/prime-meridian.
        vec3 upDir = normalize(u_vs_up);
        vec3 flowDir = normalize(dir.x * u_vs_east + dir.y * u_vs_south);
        vec3 flatOut = normalize(cross(upDir, flowDir));   // tangential
        mat3 basis = mat3(flowDir, flatOut, upDir);

        // Scale unit arrow then transform
        vec3 scaled = vec3(arrowLocal.x * len,
                           arrowLocal.y * thick,
                           arrowLocal.z * thick);

        // Anchor = this arrow's cell position on the terrain, already in the
        // eye-relative frame the rasterizer expects (czm_computePosition uses
        // the geometry's position3DHigh/Low — the SAME path ScalarSurfacePrimitive
        // renders with). Add the arrow's local offset directly: eye-relative
        // coords are world meters relative to the RTC center, so a local
        // world-unit offset is exact. (Previously we multiplied raw ECEF
        // center attribute by czm_modelViewRelativeToEye, which is only defined for
        // relative-to-eye input — that misplaced arrows off-globe entirely.)
        vec4 p = czm_computePosition();
        p.xyz += basis * scaled;

        // Lift arrows above the *displaced* surface, not bare terrain:
        // add the same (depth/maxDepth)*exaggeration offset the surface
        // primitive applies, so arrows hover 'lift' meters over the debris.
        // u_vs_exaggeration == 0 when no depth series was supplied -> no-op.
        p.xyz += upDir * (texture(u_vs_depth, uv).r * u_vs_exaggeration);

        vec3 worldNormal = basis * normalize(normal);

        // Output (same eye-relative MVP as the working surface shader).
        v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
        v_normalEC = czm_normal * worldNormal;
        v_st = st;
        v_speed = speedNorm;
        gl_Position = czm_modelViewProjectionRelativeToEye * p;
      }
    `;
    this.vertexShaderSource = vertexShaderSource;

    // The atlas is sampled only in the vertex shader (arrows are deformed per
    // cell there), so it is exposed via appearance uniforms, which — unlike
    // material-fabric uniforms — are NOT renamed by Cesium at compile time.
    const R = runtimeCesium();
    const atlasSampler = new R.Sampler({
      wrapS: R.TextureWrap.CLAMP_TO_EDGE,
      wrapT: R.TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
      magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
    });
    const atlasTexture = new R.Texture({
      context: sceneContext(this.viewer),
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
    }) as LooseTexture;
    // Material.getUniformType() keys off `.type` to discriminate sampler2D.
    (atlasTexture as unknown as { type: string }).type = 'sampler2D';
    this.atlasTexture = atlasTexture;

    // Depth atlas for surface-relative lift (optional). Same tiles/frame layout
    // as the velocity atlas (identical F,R,C), so the shader reuses `uv`.
    let depthTexture: LooseTexture = atlasTexture;
    if (this.depthAtlas) {
      depthTexture = new R.Texture({
        context: sceneContext(this.viewer),
        source: {
          arrayBufferView: this.depthAtlas.data,
          width: this.depthAtlas.width,
          height: this.depthAtlas.height,
        },
        pixelFormat: Cesium.PixelFormat.RGBA,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
        sampler: atlasSampler,
        flipY: false,
      }) as LooseTexture;
      (depthTexture as unknown as { type: string }).type = 'sampler2D';
    }
    this.depthTexture = depthTexture;

    this.appearance = this.buildAppearance(this.colormap);

    this.primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: this.appearance,
      asynchronous: false,
      // Do NOT oct-compress normals: the shader supplies procedural per-instance
      // basis rotation, and Cesium would reject the compressed normals with
      // "vector must be normalized" on semi-arbitrary data.
      compressVertices: false,
    });
    (this.primitive as unknown as { name?: string }).name = `kaggle-arrows-${this.colormap}`;
    this.viewer.scene.primitives.add(this.primitive);
    this.viewer.scene.requestRender();
  }

  /** Fragment source for a given colormap (baked into the fabric shader). */
  private makeFragmentSource(cmap: CfaColormapName): string {
    return /* glsl */ `
      in float v_speed;

      ${ATLAS_UV_GLSL}
      ${colormapGLSL(cmap)}

      czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec3 rgb = kaggleCmap(v_speed);
        material.diffuse = rgb;
        // Fade out nearly-still arrows (they're not informative)
        material.alpha = step(0.01, v_speed) * 0.98 * u_opacity;
        material.specular = 0.38;
        material.shininess = 20.0;
        material.emission = vec3(0.0);
        return material;
      }
    `;
  }

  /**
   * Build a new MaterialAppearance for a colormap. The atlas texture lives in
   * the appearance-level uniforms (u_vs_field) — ownership stays with the
   * class, so disposal must detach it before destroying the appearance.
   */
  private buildAppearance(cmap: CfaColormapName): LooseMaterialAppearance {
    if (this.destroyed || !this.atlasTexture) {
      throw new Error('buildAppearance called after destroy or without atlas');
    }

    const frame = Math.max(0, this.currentFrame);

    // Material fragment (fabric) uses only u_opacity; everything atlas-related
    // lives in the vertex shader via appearance uniforms below.
    const material = new Cesium.Material({
      fabric: {
        uniforms: {
          u_opacity: this.opacity,
        },
        source: this.makeFragmentSource(cmap),
      },
      translucent: true,
    });

    const appearance = new Cesium.MaterialAppearance({
      material,
      faceForward: true,
      flat: false,
      translucent: true,
      materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
      vertexShaderSource: this.vertexShaderSource,
    }) as LooseMaterialAppearance;
    // South = -north in the ENU basis (grid vy is south-positive).
    appearance.uniforms = {
      u_vs_field: this.atlasTexture,
      u_vs_depth: this.depthTexture ?? this.atlasTexture,
      u_vs_frame: frame,
      u_vs_tiles: new Cesium.Cartesian2(this.atlas.tilesX, this.atlas.tilesY),
      u_vs_minLen: this.minLen,
      u_vs_lenScale: this.lenScale,
      u_vs_thickness: this.thickRatio,
      u_vs_exaggeration: this.exaggeration,
      u_vs_up: new Cesium.Cartesian3(this.frame.up.x, this.frame.up.y, this.frame.up.z),
      u_vs_east: new Cesium.Cartesian3(this.frame.east.x, this.frame.east.y, this.frame.east.z),
      u_vs_south: new Cesium.Cartesian3(
        -this.frame.north.x, -this.frame.north.y, -this.frame.north.z,
      ),
    };
    return appearance;
  }

  /**
   * Destroy an appearance + its fabric material WITHOUT destroying the shared
   * atlas texture referenced by the appearance uniforms.
   */
  private disposeAppearance(appearance: LooseMaterialAppearance | null): void {
    if (!appearance || typeof appearance.isDestroyed !== 'function' || appearance.isDestroyed()) return;
    if (this.atlasTexture && appearance.uniforms && appearance.uniforms.u_vs_field === this.atlasTexture) {
      delete appearance.uniforms.u_vs_field;
    }
    if (appearance.material) this.disposeMaterial(appearance.material);
    appearance.destroy();
  }

  /**
   * Destroy a material without killing textures it does not own (none, for
   * arrows — the atlas lives on the appearance uniforms — kept for symmetry
   * with ScalarSurfacePrimitive).
   */
  private disposeMaterial(mat: Cesium.Material | null): void {
    if (!mat || typeof mat.isDestroyed !== 'function' || mat.isDestroyed()) return;
    const textures = (mat as unknown as { _textures?: Record<string, unknown> })._textures;
    if (textures) {
      for (const key of Object.keys(textures)) {
        if (textures[key] === this.atlasTexture) delete textures[key];
      }
    }
    mat.destroy();
  }

  /** Schedule a render, no-op when the owning viewer is already torn down. */
  private requestRender(): void {
    try {
      this.viewer.scene.requestRender();
    } catch {
      /* viewer may already be destroyed during teardown */
    }
  }

  /** Set the current animation frame — single GPU uniform update. */
  setFrame(idx: number): void {
    if (this.destroyed) return;
    const clamped = Math.max(0, Math.min(this.frames - 1, idx));
    if (clamped === this.currentFrame) return;
    this.currentFrame = clamped;
    if (this.appearance && this.appearance.uniforms && this.appearance.uniforms.u_vs_frame !== undefined) {
      this.appearance.uniforms.u_vs_frame = clamped;
    }
    this.requestRender();
  }

  /** Global opacity (0–1) applied via the material's u_opacity uniform. */
  setOpacity(alpha: number): void {
    if (this.destroyed || !this.material) return;
    this.opacity = Math.max(0, Math.min(1, alpha));
    this.material.uniforms.u_opacity = this.opacity;
    this.requestRender();
  }

  /**
   * Swap the baked GLSL colormap. Build the new appearance, swap it onto the
   * live primitive first, then dispose the old one (shader recompile is
   * scheduled by Primitive.update).
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
    this.requestRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.primitive) {
      // Detach the appearance+material from the collection before removal so
      // the collection does NOT destroy them — we own disposal order here
      // because the fabric material's uniform bag aliases our atlas texture.
      try {
        this.viewer.scene.primitives.remove(this.primitive);
      } catch {
        /* viewer may already be destroyed during teardown */
      }
      this.primitive = null;
    }
    this.disposeAppearance(this.appearance);
    this.appearance = null;
    this.material = null;
    if (this.atlasTexture && (typeof this.atlasTexture.isDestroyed !== 'function' || !this.atlasTexture.isDestroyed())) {
      this.atlasTexture.destroy();
      this.atlasTexture = null;
    }
    if (this.depthTexture && this.depthTexture !== this.atlasTexture && (typeof this.depthTexture.isDestroyed !== 'function' || !this.depthTexture.isDestroyed())) {
      this.depthTexture.destroy();
    }
    this.depthTexture = null;
    this.depthAtlas = null;
  }
}
