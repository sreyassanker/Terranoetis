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
  shellEntity: Cesium.Entity | null;
  lat: number;
  lon: number;
  ghosts: GhostData[];
  ghostsSpawned: boolean;
}

export class ForkRenderer {
  private viewer: Cesium.Viewer;
  private forks: Map<string, ForkVisualState>;
  private readonly AMBER_COLOR = new Cesium.Color(1.0, 0.65, 0.0, 0.35);
  private readonly SHELL_ALTITUDE_KM = 500;
  private readonly MAX_GHOSTS = 120;

  /** Getter that always returns the LIVE entity store — never stale */
  private entityCacheGetter: (() => Record<string, Cesium.Entity[]>) | null = null;
  private skipLayers: Set<string> = new Set();

  /**
   * Provide a getter function that returns the current entity store.
   * This ensures spawnGhosts always reads fresh data, even if the
   * underlying ref is reassigned.
   */
  setEntityCacheGetter(getter: () => Record<string, Cesium.Entity[]>): void {
    this.entityCacheGetter = getter;
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

  createForkVisual(forkId: string, name: string, lat: number, lon: number): ForkVisualState {
    this.removeForkVisual(forkId);

    const shellEntity = this.viewer.entities.add({
      id: `fork_shell_${forkId}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, this.SHELL_ALTITUDE_KM * 1000),
      ellipsoid: {
        radii: new Cesium.Cartesian3(2000000, 2000000, 500000),
        material: new Cesium.ColorMaterialProperty(this.AMBER_COLOR),
        outline: true,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 2,
        slicePartitions: 24,
        stackPartitions: 16,
      },
    });

    this.viewer.scene.requestRender();

    const forkState: ForkVisualState = {
      forkId,
      name,
      divergenceScore: 0.0,
      simulatedTimeMs: 0,
      status: 'running',
      entities: [shellEntity],
      shellEntity,
      lat,
      lon,
      ghosts: [],
      ghostsSpawned: false,
    };

    this.forks.set(forkId, forkState);
    return forkState;
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
    const radiusM = 3000000; // 3000km radius

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

    if (fork.shellEntity && fork.shellEntity.ellipsoid) {
      const baseAlpha = 0.1 + (divergenceScore * 0.2);
      const redShift = divergenceScore * 0.3;
      const color = new Cesium.Color(1.0, 0.65 - redShift, 0.0, baseAlpha);
      (fork.shellEntity.ellipsoid.material as Cesium.ColorMaterialProperty).color = new Cesium.ConstantProperty(color);
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
    this.forks.delete(forkId);
    this.viewer.scene.requestRender();
  }

  getAllForks(): ForkVisualState[] {
    return Array.from(this.forks.values());
  }

  getFork(forkId: string): ForkVisualState | undefined {
    return this.forks.get(forkId);
  }
}
