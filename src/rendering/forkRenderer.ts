import * as Cesium from 'cesium';

interface GhostData {
  ghostEntity: Cesium.Entity;
  originalPosition: Cesium.Cartesian3;
  driftVector: Cesium.Cartesian3;
  lastDivergence: number;
}

export interface ForkVisualState {
  forkId: string;
  name: string;
  divergenceScore: number;
  simulatedTimeMs: number;
  status: 'running' | 'paused' | 'terminated';
  entities: Cesium.Entity[];
  shellPrimitive: Cesium.Primitive | null;
  wireframePrimitive: Cesium.Primitive | null;
  rimEntity: Cesium.Entity | null;
  bufferRadiusM: number;
  lat: number;
  lon: number;
  ghosts: GhostData[];
  ghostsSpawned: boolean;
}

export class ForkRenderer {
  private viewer: Cesium.Viewer;
  private forks: Map<string, ForkVisualState>;
  private readonly SHELL_COLOR = new Cesium.Color(1.0, 1.0, 1.0, 0.08);
  private readonly WIRE_COLOR = new Cesium.Color(1.0, 1.0, 1.0, 0.6);
  private readonly SHELL_BASE_ALTITUDE_M = 0;     // dome base sits at the surface
  private readonly DEFAULT_BUFFER_RADIUS_M = 500_000;  // 500 km default dome radius
  private readonly MIN_BUFFER_RADIUS_M = 0;             // 0 m — no minimum
  private readonly MAX_BUFFER_RADIUS_M = 10_000_000;   // 10,000 km maximum
  private readonly MAX_GHOSTS = 120;
  // Dome height scales with buffer radius: 25% of the radius, clamped to a
  // sensible 50 km–500 km range so small buffers get a proportional dome and
  // huge buffers don't pierce orbit. (e.g. 500 km radius → 125 km tall dome)
  private readonly DOME_HEIGHT_RATIO = 0.25;
  private readonly DOME_MIN_HEIGHT_M = 50_000;     // 50 km
  private readonly DOME_MAX_HEIGHT_M = 500_000;     // 500 km

  /** Getter that always returns the LIVE entity store — never stale */
  private entityCacheGetter: (() => Record<string, Cesium.Entity[]>) | null = null;
  /** Getter for overlay imagery layers (WMS/XYZ tiles) — keyed by layerId. */
  private imageryGetter: (() => Record<string, Cesium.ImageryLayer>) | null = null;
  /** Getter for extra 3D tilesets (e.g. OSM buildings) that should be cropped. */
  private tilesetsGetter: (() => Cesium.Cesium3DTileset[]) | null = null;
  private skipLayers: Set<string> = new Set();

  /**
   * Provide a getter function that returns the current entity store.
   * This ensures spawnGhosts always reads fresh data, even if the
   * underlying ref is reassigned.
   */
  setEntityCacheGetter(getter: () => Record<string, Cesium.Entity[]>): void {
    this.entityCacheGetter = getter;
  }

  /** Provide overlay imagery layers (WMS/XYZ tiles) so they can be cropped. */
  setImageryGetter(getter: () => Record<string, Cesium.ImageryLayer>): void {
    this.imageryGetter = getter;
  }

  /** Provide 3D tilesets (e.g. OSM buildings) so they can be cropped. */
  setTilesetsGetter(getter: () => Cesium.Cesium3DTileset[]): void {
    this.tilesetsGetter = getter;
  }

  setSkipLayers(layers: string[]): void {
    this.skipLayers = new Set(layers);
  }

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.forks = new Map();
  }

  private getEntityCache(): Record<string, Cesium.Entity[]> {
    return this.entityCacheGetter ? this.entityCacheGetter() : {};
  }

  createForkVisual(forkId: string, name: string, lat: number, lon: number, bufferRadiusM?: number): ForkVisualState {
    this.removeForkVisual(forkId);

    const baseRadius = this.clampBufferRadius(bufferRadiusM);

    // 1) Flat circular rim drawn on the ground — marks the dome's base.
    const rimEntity = this.viewer.entities.add({
      id: `fork_rim_${forkId}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      ellipse: {
        semiMajorAxis: baseRadius,
        semiMinorAxis: baseRadius,
        height: 0,
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });

    // 2) Hemispherical dome (spherical cap) mesh sitting on the rim.
    const { fillGeometry, wireGeometry } = this.buildDomeGeometry(lat, lon, baseRadius);

    const shellPrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: fillGeometry,
        id: `fork_shell_${forkId}`,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.SHELL_COLOR),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({
        closed: false,
        translucent: true,
        flat: true,
      }),
      asynchronous: false,
    });
    this.viewer.scene.primitives.add(shellPrimitive);

    // 3) White wireframe grid covering the dome — latitude rings + longitude meridians.
    const wireframePrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: wireGeometry,
        id: `fork_wire_${forkId}`,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.WIRE_COLOR),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({
        closed: false,
        translucent: true,
        flat: true,
      }),
      asynchronous: false,
    });
    this.viewer.scene.primitives.add(wireframePrimitive);

    this.viewer.scene.requestRender();

    const forkState: ForkVisualState = {
      forkId,
      name,
      divergenceScore: 0.0,
      simulatedTimeMs: 0,
      status: 'running',
      entities: [rimEntity],
      shellPrimitive,
      wireframePrimitive,
      rimEntity,
      bufferRadiusM: baseRadius,
      lat,
      lon,
      ghosts: [],
      ghostsSpawned: false,
    };

    this.forks.set(forkId, forkState);
    this.reapplyCrop();
    return forkState;
  }

  /** Clamp an incoming buffer radius to a safe, usable range. Falls back to default. */
  private clampBufferRadius(requested?: number): number {
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 0) {
      return this.DEFAULT_BUFFER_RADIUS_M;
    }
    return Math.min(Math.max(requested, this.MIN_BUFFER_RADIUS_M), this.MAX_BUFFER_RADIUS_M);
  }

  /**
   * Dome height scales with the buffer radius so the dome stays proportional:
   * 25% of radius, clamped to [50 km, 500 km].
   * Examples:  50 km radius → 50 km tall · 500 km radius → 125 km · 2000 km → 500 km.
   */
  private domeHeightForRadius(radiusM: number): number {
    return Math.min(
      Math.max(radiusM * this.DOME_HEIGHT_RATIO, this.DOME_MIN_HEIGHT_M),
      this.DOME_MAX_HEIGHT_M,
    );
  }

  /**
   * Build a hemispherical dome (spherical cap) as Cesium Geometry.
   * Returns two geometries sharing the same vertex set:
   *  - fillGeometry: TRIANGLES — the solid (very transparent) dome surface + base.
   *  - wireGeometry:  LINES    — white grid lines: latitude rings + longitude meridians,
   *                              giving the dome a visible "covering" / glass-dome feel.
   *
   * The cap has a circular base of radius `baseRadius` sitting at the surface
   * and bulges upward a height proportional to that radius (DOME_HEIGHT_RATIO,
   * clamped to [DOME_MIN_HEIGHT_M, DOME_MAX_HEIGHT_M]), oriented so its axis
   * points away from Earth (local "up" at the fork's lat/lon).
   */
  private buildDomeGeometry(lat: number, lon: number, baseRadius: number): {
    fillGeometry: Cesium.Geometry;
    wireGeometry: Cesium.Geometry;
  } {
    const R = baseRadius;
    const h = this.domeHeightForRadius(R);
    // Sphere radius for a cap with base radius R and height h:
    const sphereR = (R * R + h * h) / (2 * h);
    const sphereCenterUp = h - sphereR; // local up-coord of sphere center (negative => below base)
    const phiMax = Math.asin(R / sphereR); // angle from apex to rim

    const slices = 48; // segments around
    const stacks = 24; // rings from apex to rim

    // Local ENU frame at the fork location (base altitude 0).
    const origin = Cesium.Cartesian3.fromDegrees(lon, lat, this.SHELL_BASE_ALTITUDE_M);
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin);

    const positions: number[] = [];
    const normals: number[] = [];
    const fillIndices: number[] = [];
    const wireIndices: number[] = [];

    const toFixed = (east: number, north: number, up: number) => {
      const local = new Cesium.Cartesian3(east, north, up);
      const world = Cesium.Matrix4.multiplyByPoint(frame, local, new Cesium.Cartesian3());
      positions.push(world.x, world.y, world.z);
    };

    // Apex vertex (index 0)
    toFixed(0, 0, h);
    normals.push(0, 0, 1);

    // Dome surface rings: ring i goes from apex(1) to rim(stacks+1)
    const ringStart = 1;
    for (let i = 1; i <= stacks; i++) {
      const phi = (i / stacks) * phiMax;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let j = 0; j < slices; j++) {
        const theta = (j / slices) * (Math.PI * 2);
        const east = sphereR * sinPhi * Math.cos(theta);
        const north = sphereR * sinPhi * Math.sin(theta);
        const up = sphereCenterUp + sphereR * cosPhi;
        toFixed(east, north, up);
        // Outward normal = (point - sphere center), normalized.
        const nx = east;
        const ny = north;
        const nz = up - sphereCenterUp;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
      }
    }

    // Base center vertex (flat disk cap at up=0)
    const baseCenterIdx = positions.length / 3;
    toFixed(0, 0, 0);
    normals.push(0, 0, -1);

    // Base ring vertices (copy of rim ring) with downward normals
    const baseRingStart = baseCenterIdx + 1;
    for (let j = 0; j < slices; j++) {
      const theta = (j / slices) * (Math.PI * 2);
      const east = R * Math.cos(theta);
      const north = R * Math.sin(theta);
      toFixed(east, north, 0);
      normals.push(0, 0, -1);
    }

    // --- Fill indices: dome surface (triangle fan from apex) ---
    for (let j = 0; j < slices; j++) {
      const a = 0;
      const b = ringStart + j;
      const c = ringStart + ((j + 1) % slices);
      fillIndices.push(a, c, b);
    }
    // --- Fill indices: dome body quads between rings ---
    for (let i = 0; i < stacks - 1; i++) {
      const ringA = ringStart + i * slices;
      const ringB = ringStart + (i + 1) * slices;
      for (let j = 0; j < slices; j++) {
        const i0 = ringA + j;
        const i1 = ringA + (j + 1) % slices;
        const i2 = ringB + (j + 1) % slices;
        const i3 = ringB + j;
        fillIndices.push(i0, i1, i2);
        fillIndices.push(i0, i2, i3);
      }
    }
    // --- Fill indices: base disk (fan from base center) ---
    for (let j = 0; j < slices; j++) {
      const a = baseCenterIdx;
      const b = baseRingStart + j;
      const c = baseRingStart + ((j + 1) % slices);
      fillIndices.push(a, b, c);
    }

    // --- Wireframe indices: latitude rings (every Nth stack) ---
    const ringEvery = 4; // draw a ring every 4 stacks => 6 rings on a 24-stack dome
    for (let i = 1; i <= stacks; i++) {
      if (i !== stacks && i % ringEvery !== 0) continue;
      const ringBase = ringStart + (i - 1) * slices;
      for (let j = 0; j < slices; j++) {
        const a = ringBase + j;
        const b = ringBase + ((j + 1) % slices);
        wireIndices.push(a, b);
      }
    }
    // --- Wireframe indices: longitude meridians (every Mth slice) ---
    const meridianEvery = 4; // draw a meridian every 4 slices => 12 meridians
    for (let j = 0; j < slices; j += meridianEvery) {
      // Apex (0) -> ring1 -> ring2 -> ... -> rim (base ring copy)
      for (let i = 1; i < stacks; i++) {
        const a = ringStart + (i - 1) * slices + j;
        const b = ringStart + i * slices + j;
        wireIndices.push(a, b);
      }
      // Connect last dome ring vertex to base rim vertex
      const lastDome = ringStart + (stacks - 1) * slices + j;
      const baseVert = baseRingStart + j;
      wireIndices.push(lastDome, baseVert);
    }
    // --- Wireframe indices: base rim ring (highlight the circular base) ---
    for (let j = 0; j < slices; j++) {
      const a = baseRingStart + j;
      const b = baseRingStart + ((j + 1) % slices);
      wireIndices.push(a, b);
    }

    const attributes = new Cesium.GeometryAttributes();
    attributes.position = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: new Float64Array(positions),
    });
    attributes.normal = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      values: new Float32Array(normals),
    });

    const fillGeometry = new Cesium.Geometry({
      attributes,
      indices: new Uint32Array(fillIndices),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });
    const wireGeometry = new Cesium.Geometry({
      attributes,
      indices: new Uint32Array(wireIndices),
      primitiveType: Cesium.PrimitiveType.LINES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });
    return { fillGeometry, wireGeometry };
  }

  /**
   * Spawn ghosts with fallback retries at increasing intervals.
   * Each retry reads the LIVE entity cache via the getter.
   */
  spawnGhostsWithRetry(forkId: string, retries = 5, delayMs = 1000): void {
    const fork = this.forks.get(forkId);
    if (!fork || fork.ghostsSpawned) return;
    this.spawnGhosts(forkId);
    if (fork.ghostsSpawned) return;
    if (retries > 0) {
      setTimeout(() => this.spawnGhostsWithRetry(forkId, retries - 1, delayMs + 700), delayMs);
    }
  }

  spawnGhosts(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (!fork || fork.ghostsSpawned) return;

    const now = Cesium.JulianDate.now();
    const center = Cesium.Cartesian3.fromDegrees(fork.lon, fork.lat, 0);
    // Ghost collection radius matches the dome's buffer radius so the fork
    // captures exactly the entities covered by its bubble.
    const radiusM = fork.bufferRadiusM;

    const seen = new Set<string>();
    const allEntities: Cesium.Entity[] = [];

    const addIfNew = (e: Cesium.Entity) => {
      const id = String(e.id ?? '');
      if (id && !seen.has(id)) { seen.add(id); allEntities.push(e); }
    };

    // 1. Collect from viewer's main entity collection
    for (const e of this.viewer.entities.values) addIfNew(e);

    // 2. Collect from data sources
    for (let i = 0; i < this.viewer.dataSources.length; i++) {
      const ds = this.viewer.dataSources.get(i);
      if (ds?.entities) { for (const e of ds.entities.values) addIfNew(e); }
    }

    // 3. Collect from LIVE entity cache via getter (always fresh)
    const cache = this.getEntityCache();
    const cacheLayerCount = Object.keys(cache).length;
    for (const [layerId, list] of Object.entries(cache)) {
      if (this.skipLayers.has(layerId)) continue;
      for (const e of list) addIfNew(e);
    }

    // Helper to check if entity is eligible (position-resolvable, not fork, not skipped layer)
    const isEligible = (e: Cesium.Entity): Cesium.Cartesian3 | null => {
      const id = String(e.id ?? '');
      if (!id || id.startsWith('fork_')) return null;
      if (!e.position) return null;
      const pos = e.position.getValue(now);
      if (!pos) return null;
      const layer = (e.properties as Record<string, unknown>)?.layer;
      const layerVal = typeof layer === 'object' && layer !== null && 'getValue' in layer
        ? (layer as Cesium.Property).getValue(now)
        : layer;
      if (layerVal && this.skipLayers.has(String(layerVal))) return null;
      return pos;
    };

    // First pass: entities within radius
    const nearEntities: Array<{ entity: Cesium.Entity; pos: Cesium.Cartesian3; dist: number }> = [];
    const farEntities: Array<{ entity: Cesium.Entity; pos: Cesium.Cartesian3; dist: number }> = [];

    for (const e of allEntities) {
      const pos = isEligible(e);
      if (!pos) continue;
      const dist = Cesium.Cartesian3.distance(center, pos);
      if (dist <= radiusM) {
        nearEntities.push({ entity: e, pos, dist });
      } else {
        farEntities.push({ entity: e, pos, dist });
      }
    }

    // If no entities within radius, use closest entities globally
    let eligible = nearEntities;
    if (eligible.length === 0 && farEntities.length > 0) {
      farEntities.sort((a, b) => a.dist - b.dist);
      eligible = farEntities.slice(0, this.MAX_GHOSTS);
      console.log(`[FORK] No entities within ${(radiusM / 1000).toFixed(0)}km radius, using ${eligible.length} closest entities globally`);
    }

    const total = allEntities.length;
    let count = 0;

    const shuffled = eligible.sort(() => Math.random() - 0.5).slice(0, this.MAX_GHOSTS);

    for (const item of shuffled) {
      const entity = item.entity;
      const pos = item.pos;

      const config: Cesium.Entity.ConstructorOptions = {
        position: pos.clone(),
        properties: entity.properties,
      };

      if (entity.point) {
        const pg = entity.point;
        config.point = {
          color: new Cesium.Color(1.0, 0.65, 0.0, 0.85),
          pixelSize: Math.max(8, ((pg.pixelSize?.getValue(now) ?? 6)) * 1.5),
          outlineColor: new Cesium.Color(1.0, 0.8, 0.0, 0.6),
          outlineWidth: pg.outlineWidth?.getValue(now) ?? 1,
          scaleByDistance: pg.scaleByDistance?.getValue(now),
          distanceDisplayCondition: pg.distanceDisplayCondition?.getValue(now),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
      }

      if (entity.billboard) {
        const bg = entity.billboard;
        config.billboard = {
          image: bg.image?.getValue(now),
          color: new Cesium.Color(1.0, 0.65, 0.0, 0.85),
          width: bg.width?.getValue(now),
          height: bg.height?.getValue(now),
          scale: bg.scale?.getValue(now),
          rotation: bg.rotation?.getValue(now),
          alignedAxis: bg.alignedAxis?.getValue(now),
          verticalOrigin: bg.verticalOrigin?.getValue(now),
          horizontalOrigin: bg.horizontalOrigin?.getValue(now),
          pixelOffset: bg.pixelOffset?.getValue(now),
          scaleByDistance: bg.scaleByDistance?.getValue(now),
          distanceDisplayCondition: bg.distanceDisplayCondition?.getValue(now),
        };
      }

      if (entity.ellipse) {
        const eg = entity.ellipse;
        config.ellipse = {
          semiMajorAxis: eg.semiMajorAxis?.getValue(now),
          semiMinorAxis: eg.semiMinorAxis?.getValue(now),
          material: new Cesium.ColorMaterialProperty(new Cesium.Color(1.0, 0.65, 0.0, 0.3)),
          outline: eg.outline?.getValue(now),
          outlineColor: new Cesium.Color(1.0, 0.65, 0.0, 0.5),
        };
      }

      const ghost = this.viewer.entities.add({
        ...config,
        id: `${entity.id}_fork_${forkId}`,
      });

      const driftVector = new Cesium.Cartesian3(
        (Math.random() - 0.5) * 200000,
        (Math.random() - 0.5) * 200000,
        (Math.random() - 0.5) * 50000,
      );

      fork.ghosts.push({ ghostEntity: ghost, originalPosition: pos.clone(), driftVector, lastDivergence: 0 });
      fork.entities.push(ghost);
      count++;
    }

    if (count > 0) {
      fork.ghostsSpawned = true;
      this.viewer.scene.requestRender();
      requestAnimationFrame(() => this.viewer.scene.requestRender());
    }
    console.log(`[FORK] Spawned ${count}/${this.MAX_GHOSTS} ghosts for ${forkId} at ${fork.lat},${fork.lon}. Total entities: ${total}, eligible: ${eligible.length}, cache layers: ${cacheLayerCount}`);
  }

  updateGhosts(forkId: string, divergenceScore: number): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;
    if (!fork.ghostsSpawned) { this.spawnGhosts(forkId); return; }
    if (fork.ghosts.length === 0) return;

    const now = Cesium.JulianDate.now();
    for (const ghost of fork.ghosts) {
      const delta = divergenceScore - ghost.lastDivergence;
      if (delta <= 0) continue;

      const step = Cesium.Cartesian3.multiplyByScalar(
        ghost.driftVector,
        delta,
        new Cesium.Cartesian3()
      );
      const current = ghost.ghostEntity.position?.getValue(now);
      if (!current) continue;
      const newPos = Cesium.Cartesian3.add(current, step, new Cesium.Cartesian3());
      (ghost.ghostEntity.position as Cesium.ConstantPositionProperty).setValue(newPos);
      ghost.lastDivergence = divergenceScore;
    }
    this.viewer.scene.requestRender();
  }

  updateDivergence(forkId: string, divergenceScore: number, simulatedTimeMs: number): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;

    fork.divergenceScore = divergenceScore;
    fork.simulatedTimeMs = simulatedTimeMs;

    if (fork.shellPrimitive) {
      const baseAlpha = 0.04 + (divergenceScore * 0.16);
      const tint = divergenceScore * 0.3;
      const fillColor = new Cesium.Color(1.0, 1.0 - tint * 0.4, 1.0 - tint * 0.7, baseAlpha);
      const attributes = fork.shellPrimitive.getGeometryInstanceAttributes(`fork_shell_${forkId}`);
      if (attributes && attributes.color) {
        Cesium.ColorGeometryInstanceAttribute.toValue(fillColor, attributes.color);
      }
    }
    if (fork.wireframePrimitive) {
      const wireAlpha = 0.5 + (divergenceScore * 0.3);
      const tint = divergenceScore * 0.3;
      const wireColor = new Cesium.Color(1.0, 1.0 - tint * 0.4, 1.0 - tint * 0.7, Math.min(1, wireAlpha));
      const wireAttrs = fork.wireframePrimitive.getGeometryInstanceAttributes(`fork_wire_${forkId}`);
      if (wireAttrs && wireAttrs.color) {
        Cesium.ColorGeometryInstanceAttribute.toValue(wireColor, wireAttrs.color);
      }
    }

    this.updateGhosts(forkId, divergenceScore);
  }

  pauseForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) fork.status = 'paused';
  }

  resumeForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) fork.status = 'running';
  }

  removeForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;

    for (const ent of fork.entities) {
      this.viewer.entities.remove(ent);
    }
    if (fork.shellPrimitive) {
      this.viewer.scene.primitives.remove(fork.shellPrimitive);
    }
    if (fork.wireframePrimitive) {
      this.viewer.scene.primitives.remove(fork.wireframePrimitive);
    }
    this.forks.delete(forkId);
    this.reapplyCrop();
    this.viewer.scene.requestRender();
  }

  getAllForks(): ForkVisualState[] {
    return Array.from(this.forks.values());
  }

  getFork(forkId: string): ForkVisualState | undefined {
    return this.forks.get(forkId);
  }

  /**
   * Whenever at least one fork dome exists, data-layer entities (anything in
   * the entity cache that is NOT a fork ghost/shell) are hidden unless they
   * fall inside a dome's buffer radius. This gives the visual effect of the
   * dome "containing" / cropping the live data layers automatically — no
   * manual toggle required. With no forks, everything shows normally.
   *
   * Call this after creating/removing a fork, after a layer toggle, after a
   * bulk enable/disable, and periodically for streaming live data.
   */
  reapplyCrop(): void {
    const now = Cesium.JulianDate.now();
    const forks = Array.from(this.forks.values()).filter(f => f.status !== 'terminated');
    const hasForks = forks.length > 0;

    // 1) Entities tracked in the store (point/billboard/heatmap/geojson/etc.)
    const cache = this.getEntityCache();
    for (const [layerId, ents] of Object.entries(cache)) {
      if (this.skipLayers.has(layerId)) continue;
      for (const ent of ents) {
        if (!ent) continue;
        const id = String(ent.id ?? '');
        // Fork-owned entities are never cropped.
        if (id.startsWith('fork_') || id.includes('_fork_')) {
          ent.show = true;
          continue;
        }
        ent.show = hasForks ? this.isInsideAnyFork(ent, now, forks) : true;
      }
    }

    // 2) Entities inside viewer.dataSources (e.g. submarine cables, tectonic,
    //    study areas) — spawnGhosts already reads these; crop must too.
    for (let i = 0; i < this.viewer.dataSources.length; i++) {
      const ds = this.viewer.dataSources.get(i);
      if (!ds?.entities) continue;
      // Skip fork-owned data sources (none currently, but be safe).
      if (String(ds.name ?? '').startsWith('fork_')) continue;
      for (const ent of ds.entities.values) {
        if (!ent) continue;
        const id = String(ent.id ?? '');
        if (id.startsWith('fork_') || id.includes('_fork_')) {
          ent.show = true;
          continue;
        }
        ent.show = hasForks ? this.isInsideAnyFork(ent, now, forks) : true;
      }
    }

    // 3) Entities added directly to viewer.entities but NOT in the store
    //    (e.g. orphan trail polylines, dropped pins). Skip fork-owned ones.
    for (const ent of this.viewer.entities.values) {
      if (!ent) continue;
      const id = String(ent.id ?? '');
      if (id.startsWith('fork_') || id.includes('_fork_')) continue;
      // Already handled above? Heuristic: skip entities we know are in the store.
      // We crop everything else — cheaper than building a lookup set every tick.
      ent.show = hasForks ? this.isInsideAnyFork(ent, now, forks) : true;
    }

    // 4) Overlay imagery layers (WMS/XYZ tiles) — these are full-globe rasters
    //    that cannot be per-position cropped. When a dome is active, hide them
    //    entirely so only entity vector data shows inside the dome.
    if (this.imageryGetter) {
      const imagery = this.imageryGetter();
      for (const [, layer] of Object.entries(imagery)) {
        if (layer) layer.show = !hasForks;
      }
    }

    // 5) 3D tilesets (e.g. OSM buildings) — also full-coverage; hide when cropping.
    if (this.tilesetsGetter) {
      for (const ts of this.tilesetsGetter()) {
        if (ts) ts.show = !hasForks;
      }
    }

    this.viewer.scene.requestRender();
  }

  /**
   * Determine whether an entity should be visible inside any active fork dome.
   * Handles all Cesium graphics types:
   *  - position-based (point, billboard, label, model, cylinder, ellipse)
   *  - polyline (positions array)
   *  - polygon (positions hierarchy)
   *  - rectangle, wall, corridor, box
   * Returns true if ANY part of the entity lies within a dome.
   */
  private isInsideAnyFork(
    ent: Cesium.Entity,
    now: Cesium.JulianDate,
    forks: ForkVisualState[],
  ): boolean {
    const positions = this.collectEntityPositions(ent, now);
    if (positions.length === 0) return false;

    for (const f of forks) {
      const center = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0);
      const radius = f.bufferRadiusM;
      for (const pos of positions) {
        const dist = Cesium.Cartesian3.distance(center, pos);
        if (dist <= radius) return true;
      }
    }
    return false;
  }

  /**
   * Collect all cartesian positions for an entity across its graphics types.
   * Returns an array of Cartesian3 (any one inside a dome => entity shown).
   */
  private collectEntityPositions(ent: Cesium.Entity, now: Cesium.JulianDate): Cesium.Cartesian3[] {
    const out: Cesium.Cartesian3[] = [];
    const add = (p: Cesium.Cartesian3 | undefined) => { if (p) out.push(p); };

    // Direct position property (point, billboard, label, model, etc.)
    if (ent.position) {
      try { add(ent.position.getValue(now)); } catch { /* ignore */ }
    }

    // Polyline: positions array
    const poly = ent.polyline;
    if (poly?.positions) {
      try {
        const v = poly.positions.getValue(now);
        if (Array.isArray(v)) for (const p of v) add(p as Cesium.Cartesian3);
      } catch { /* ignore */ }
    }

    // Polygon: positions hierarchy
    const polyg = ent.polygon;
    if (polyg?.hierarchy) {
      try {
        const hier = polyg.hierarchy.getValue(now);
        if (hier?.positions) for (const p of hier.positions) add(p as Cesium.Cartesian3);
        if (Array.isArray(hier?.holes)) {
          for (const hole of hier.holes) {
            if (hole?.positions) for (const p of hole.positions) add(p as Cesium.Cartesian3);
          }
        }
      } catch { /* ignore */ }
    }

    // Wall: positions array
    const wall = ent.wall;
    if (wall?.positions) {
      try {
        const v = wall.positions.getValue(now);
        if (Array.isArray(v)) for (const p of v) add(p as Cesium.Cartesian3);
      } catch { /* ignore */ }
    }

    // Corridor: positions array
    const corr = ent.corridor;
    if (corr?.positions) {
      try {
        const v = corr.positions.getValue(now);
        if (Array.isArray(v)) for (const p of v) add(p as Cesium.Cartesian3);
      } catch { /* ignore */ }
    }

    // Rectangle: coordinates (west/south/east/north)
    const rect = ent.rectangle;
    if (rect?.coordinates) {
      try {
        const r = rect.coordinates.getValue(now);
        if (r) {
          // Sample 4 corners + center of the rectangle.
          for (const [lon, lat] of [
            [r.west, r.south], [r.west, r.north],
            [r.east, r.south], [r.east, r.north],
            [(r.west + r.east) / 2, (r.south + r.north) / 2],
          ]) {
            add(Cesium.Cartesian3.fromRadians(lon, lat, 0));
          }
        }
      } catch { /* ignore */ }
    }

    // PolylineVolume: positions array
    const pv = (ent as unknown as { polylineVolume?: { positions?: Cesium.PositionProperty } }).polylineVolume;
    if (pv?.positions) {
      try {
        const v = pv.positions.getValue(now);
        if (Array.isArray(v)) for (const p of v) add(p as Cesium.Cartesian3);
      } catch { /* ignore */ }
    }

    return out;
  }

  /** True if at least one non-terminated fork dome exists (i.e. cropping is active). */
  hasActiveForks(): boolean {
    for (const f of this.forks.values()) {
      if (f.status !== 'terminated') return true;
    }
    return false;
  }

  /**
   * Crop a single entity against all fork domes. Returns true if the entity
   * should be visible (inside a dome, or no forks exist, or fork-owned).
   * Used by callers that set entity visibility directly.
   */
  shouldEntityShow(ent: Cesium.Entity, now: Cesium.JulianDate = Cesium.JulianDate.now()): boolean {
    const id = String(ent.id ?? '');
    if (id.startsWith('fork_') || id.includes('_fork_')) return true;
    const forks = Array.from(this.forks.values()).filter(f => f.status !== 'terminated');
    if (forks.length === 0) return true;
    return this.isInsideAnyFork(ent, now, forks);
  }
}
