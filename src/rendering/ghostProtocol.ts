import * as Cesium from 'cesium';
import { GhostEntity } from './ghostEntity';
import type { FutureTensorDomain } from './trajectoryPredictor';

/**
 * GhostProtocol is the central manager for all GhostEntities in the TERRA UMBRA
 * Ghost Protocol rendering pipeline. It owns the lifecycle of every probability
 * trail polyline on the globe and orchestrates creation, position updates,
 * trail regeneration, and cleanup.
 *
 * @remarks
 * Usage pattern:
 * 1. Instantiate with a Cesium Viewer: `const protocol = new GhostProtocol(viewer)`
 * 2. Create ghosts for new entities: `protocol.createGhost(id, config, domain, vel, heading)`
 * 3. On each real-time position update: `protocol.updateGhostPosition(id, newPos, vel, heading)`
 * 4. On entity removal: `protocol.removeGhost(id)`
 *
 * Trails are separate Cesium polyline entities with ID `${entityId}_trail` to avoid
 * collisions with real entities. They use PolylineGlowMaterialProperty for a
 * cyan luminous effect and CallbackProperty for dynamic position updates.
 *
 * For static domains (seismic, weather), translucent expanding probability halos
 * are rendered as ellipses with CallbackProperty-driven radius and opacity.
 */
export class GhostProtocol {
  /** Reference to the Cesium Viewer that owns all entities. */
  private viewer: Cesium.Viewer;

  /** Map of entity ID to GhostEntity wrapper. */
  private ghosts: Map<string, GhostEntity>;

  /** Map of entity ID to trail polyline entity (separate from real entity). */
  private trailEntities: Map<string, Cesium.Entity>;

  /** Map of entity ID to halo ellipse entity (for seismic/weather static layers). */
  private haloEntities: Map<string, Cesium.Entity>;

  /**
   * Creates a new GhostProtocol manager bound to the given Cesium Viewer.
   *
   * @param viewer - The Cesium Viewer instance where entities and trails are rendered.
   */
  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.ghosts = new Map();
    this.trailEntities = new Map();
    this.haloEntities = new Map();
  }

  /**
   * Creates a new GhostEntity for the given entity ID, adds its real entity
   * to the viewer, generates initial probability predictions, and renders
   * a glowing trail polyline and (for static domains) an expanding probability halo.
   *
   * @param id - Unique identifier for the entity (used as both map key and Cesium entity ID).
   * @param config - Cesium Entity constructor options (position, billboard, point, etc.).
   * @param domain - Predictive domain ('maritime', 'aviation', 'seismic', 'weather').
   * @param velocity - Optional ECEF velocity vector in meters/second.
   * @param heading - Optional heading in degrees, 0 = North.
   * @returns The newly created GhostEntity instance.
   */
  createGhost(
    id: string,
    config: Cesium.Entity.ConstructorOptions,
    domain: FutureTensorDomain,
    velocity?: Cesium.Cartesian3 | null,
    heading?: number | null,
  ): GhostEntity {
    // Remove any existing ghost with the same ID
    if (this.ghosts.has(id)) {
      this.removeGhost(id);
    }

    const ghost = new GhostEntity(this.viewer, config, domain, velocity, heading);
    this.ghosts.set(id, ghost);

    // Create the trail immediately
    this.updateTrail(id);

    // For static domains (seismic/weather), render an expanding probability halo
    if (domain === 'seismic' || domain === 'weather') {
      this.updateHalo(id);
    }

    return ghost;
  }

  /**
   * Updates an existing ghost's position and velocity, regenerates its
   * FutureTensor predictions, and refreshes its trail polyline.
   *
   * @param id - The entity ID registered with createGhost().
   * @param newPos - New ECEF position for the entity.
   * @param newVelocity - Optional new ECEF velocity vector.
   * @param newHeading - Optional new heading in degrees.
   */
  updateGhostPosition(
    id: string,
    newPos: Cesium.Cartesian3,
    newVelocity?: Cesium.Cartesian3 | null,
    newHeading?: number | null,
  ): void {
    const ghost = this.ghosts.get(id);
    if (!ghost) return;

    ghost.updatePosition(newPos, newVelocity, newHeading);
    this.updateTrail(id);
  }

  /**
   * Removes a GhostEntity, its trail polyline, and its halo ellipse from the
   * viewer, cleaning up all Cesium Entity references. The ghost is removed
   * from the internal map. No-op if the ID is not registered.
   *
   * @param id - The entity ID to remove.
   */
  removeGhost(id: string): void {
    const ghost = this.ghosts.get(id);
    if (ghost) {
      ghost.destroy();
      this.ghosts.delete(id);
    }

    const trailEntity = this.trailEntities.get(id);
    if (trailEntity) {
      this.viewer.entities.remove(trailEntity);
      this.trailEntities.delete(id);
    }

    const halo = this.haloEntities.get(id);
    if (halo) {
      this.viewer.entities.remove(halo);
      this.haloEntities.delete(id);
    }
  }

  /**
   * Creates or updates the glowing polyline trail entity for a registered ghost.
   *
   * @remarks
   * The trail uses a Cesium CallbackProperty to dynamically recompute positions
   * each frame. The callback captures the ghost via `this.ghosts.get(id)` at
   * invocation time — it does NOT close over a stale ghost reference.
   *
   * Trail rendering uses PolylineGlowMaterialProperty with a cyan glow
   * (R: 0.0, G: 0.6, B: 1.0, A: 0.35) and glowPower 0.4 for a subtle
   * holographic probability effect.
   *
   * @param id - The entity ID whose trail should be updated.
   */
  updateTrail(id: string): void {
    // Idempotent guard: if trail already exists, the CallbackProperty
    // automatically re-evaluates on every render frame.  Since
    // FutureTensor.update() regenerates predictions in-place, the trail
    // positions refresh without needing to recreate the polyline entity.
    if (this.trailEntities.has(id)) {
      return;
    }

    const trailId = `${id}_trail`;

    // Build callback that dynamically fetches trail positions from the ghost's FutureTensor.
    // Cache the mapped array — only recompute when predictions change.
    let cachedPositions: Cesium.Cartesian3[] = [];
    let cachedTrailLength = 0;
    const positionsCallback = new Cesium.CallbackProperty(() => {
      const ghost = this.ghosts.get(id);
      if (!ghost) return cachedPositions;

      const trailPositions = ghost.getFutureTensor().getTrailPositions();
      if (trailPositions.length !== cachedTrailLength) {
        cachedPositions = trailPositions.map((tp) => tp.position);
        cachedTrailLength = trailPositions.length;
      }
      return cachedPositions;
    }, false);

    const trailEntity = this.viewer.entities.add({
      id: trailId,
      polyline: {
        positions: positionsCallback,
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: new Cesium.Color(0.0, 0.6, 1.0, 0.35),
          glowPower: 0.4,
        }),
        clampToGround: false,
      },
    });

    this.trailEntities.set(id, trailEntity);
  }

  /**
   * Creates or updates a translucent expanding probability halo for seismic
   * and weather entities. The halo is an ellipse with CallbackProperty-driven
   * radius and opacity that pulses over time, representing the growing
   * uncertainty radius of the entity's location/impact zone over 72 hours.
   *
   * @param id - The entity ID whose halo should be created/updated.
   */
  updateHalo(id: string): void {
    const ghost = this.ghosts.get(id);
    if (!ghost) return;

    const domain = ghost.getFutureTensor().domain;
    if (domain !== 'seismic' && domain !== 'weather') return;

    const haloId = `${id}_halo`;

    // Remove existing halo if present
    const existing = this.haloEntities.get(id);
    if (existing) {
      this.viewer.entities.remove(existing);
      this.haloEntities.delete(id);
    }

    // Resolve initial position from ghost's real entity
    const initialPos = this.resolveGhostPosition(id);

    // Pre-allocate color for halo pulse — avoid per-frame Color allocation
    const haloColor = new Cesium.Color(0.0, 0.6, 1.0, 0.15);
    const halo = this.viewer.entities.add({
      id: haloId,
      position: initialPos,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          const g = this.ghosts.get(id);
          if (!g) return 0;
          const tensor = g.getFutureTensor();
          const lastWp = tensor.predictions[tensor.predictions.length - 1];
          return lastWp ? lastWp.uncertaintyRadiusMeters : 1000;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          const g = this.ghosts.get(id);
          if (!g) return 0;
          const tensor = g.getFutureTensor();
          const lastWp = tensor.predictions[tensor.predictions.length - 1];
          return lastWp ? lastWp.uncertaintyRadiusMeters : 1000;
        }, false),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            const pulse = 0.1 + 0.1 * Math.abs(Math.sin(Date.now() / 2000));
            haloColor.alpha = pulse;
            return haloColor;
          }, false),
        ),
        outline: true,
        outlineColor: new Cesium.Color(0.0, 0.8, 1.0, 0.5),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    this.haloEntities.set(id, halo);
  }

  /**
   * Resolves the current ECEF position of a registered ghost's real entity.
   * Used for initializing halo positions.
   *
   * @param id - The entity ID to resolve position for.
   * @returns ECEF position, or ZERO if unresolvable.
   */
  private resolveGhostPosition(id: string): Cesium.Cartesian3 {
    const ghost = this.ghosts.get(id);
    if (!ghost) return Cesium.Cartesian3.ZERO.clone();

    const realEntity = ghost.getRealEntity();
    if (!realEntity) return Cesium.Cartesian3.ZERO.clone();

    const pos = realEntity.position?.getValue(Cesium.JulianDate.now());
    if (pos instanceof Cesium.Cartesian3) return pos.clone();
    return Cesium.Cartesian3.ZERO.clone();
  }

  /**
   * Regenerates all trail polylines for every currently registered ghost.
   * Useful after batch operations or when the underlying predictions
   * need a full refresh.
   */
  renderAllTrails(): void {
    this.ghosts.forEach((_, id) => {
      this.updateTrail(id);
    });
  }

  /**
   * Returns the GhostEntity registered with the given ID.
   *
   * @param id - The entity ID to look up.
   * @returns The GhostEntity, or undefined if not found.
   */
  getGhost(id: string): GhostEntity | undefined {
    return this.ghosts.get(id);
  }

  /**
   * Returns all currently registered GhostEntities as an array.
   *
   * @returns Array of all GhostEntity instances.
   */
  getAllGhosts(): GhostEntity[] {
    return Array.from(this.ghosts.values());
  }
}