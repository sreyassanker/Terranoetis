import * as Cesium from 'cesium';
import { FutureTensor } from './trajectoryPredictor';
import type { FutureTensorDomain } from './trajectoryPredictor';

/**
 * GhostEntity wraps a Cesium Entity with a FutureTensor for probabilistic
 * trajectory prediction. It acts as the bridge between the real-time entity
 * displayed on the globe and the Ghost Protocol's volumetric probability trails.
 *
 * @remarks
 * The FutureTensor is attached to the underlying Cesium Entity via a private
 * bag reference (`_futureTensor`), enabling GhostProtocol to access prediction
 * data from any entity reference without additional lookups.
 */
export class GhostEntity {
  /** The underlying Cesium Entity rendered on the globe. */
  private realEntity: Cesium.Entity | null = null;

  /** The probability prediction tensor for this entity. */
  private futureTensor: FutureTensor;

  /** The Cesium Viewer this entity belongs to. */
  private viewer: Cesium.Viewer;

  /** Cached domain for re-creation on position update. */
  private domain: FutureTensorDomain;

  /**
   * Creates a new GhostEntity, adding a real Cesium Entity to the viewer
   * and generating a FutureTensor for its predicted trajectory.
   *
   * @param viewer - The Cesium Viewer instance.
   * @param config - Cesium Entity constructor options (position, billboard, label, etc.).
   * @param domain - Predictive domain ('maritime', 'aviation', 'seismic', 'weather').
   * @param velocity - Optional ECEF velocity vector in meters/second (null for static entities).
   * @param heading - Optional heading in degrees, 0 = North (null for static entities).
   */
  constructor(
    viewer: Cesium.Viewer,
    config: Cesium.Entity.ConstructorOptions,
    domain: FutureTensorDomain,
    velocity?: Cesium.Cartesian3 | null,
    heading?: number | null,
  ) {
    this.viewer = viewer;
    this.domain = domain;

    // Add the real entity to the viewer
    this.realEntity = viewer.entities.add(config);

    // Resolve current position from config
    const resolvedPosition = this.resolvePosition(config.position);

    // Create FutureTensor from resolved position and motion state
    this.futureTensor = new FutureTensor(
      config.id ?? `ghost_${Date.now()}`,
      domain,
      resolvedPosition,
      velocity ?? null,
      heading ?? null,
    );

    // Attach FutureTensor reference directly to the entity object for downstream access.
    // We use bracket indexing to avoid Cesium's PropertyBag type restrictions,
    // placing a non-serialized runtime reference that GhostProtocol reads directly.
    if (this.realEntity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.realEntity as any)._futureTensor = this.futureTensor;
    }
  }

  /**
   * Resolves a Cesium position property to a concrete Cartesian3 ECEF coordinate.
   * Handles Cartesian3, ConstantPositionProperty, SampledPositionProperty,
   * and CallbackProperty types by evaluating at the current Julian date.
   *
   * @param positionProp - The position configuration from entity options.
   * @returns An ECEF Cartesian3 position (ZERO if unresolvable).
   */
  private resolvePosition(
    positionProp: Cesium.Entity.ConstructorOptions['position'],
  ): Cesium.Cartesian3 {
    if (!positionProp) {
      return Cesium.Cartesian3.ZERO.clone();
    }

    if (positionProp instanceof Cesium.Cartesian3) {
      return positionProp.clone();
    }

    if (positionProp instanceof Cesium.ConstantPositionProperty) {
      const value = positionProp.getValue(Cesium.JulianDate.now());
      if (value) return value.clone();
    }

    // Handle SampledPositionProperty, CompositePositionProperty, or CallbackProperty
    if (typeof positionProp.getValue === 'function') {
      const value = positionProp.getValue(Cesium.JulianDate.now());
      if (value instanceof Cesium.Cartesian3) return value.clone();
    }

    return Cesium.Cartesian3.ZERO.clone();
  }

  /**
   * Updates the entity's position on the globe and regenerates its FutureTensor
   * predictions from the new state.
   *
   * @param newPos - New ECEF position for the entity.
   * @param newVelocity - New ECEF velocity vector (null for static entities).
   * @param newHeading - New heading in degrees (null for non-moving entities).
   */
  updatePosition(
    newPos: Cesium.Cartesian3,
    newVelocity?: Cesium.Cartesian3 | null,
    newHeading?: number | null,
  ): void {
    if (!this.realEntity) return;

    // Update the real entity's position
    if (this.realEntity.position instanceof Cesium.ConstantPositionProperty) {
      this.realEntity.position.setValue(newPos.clone());
    } else {
      this.realEntity.position = new Cesium.ConstantPositionProperty(newPos.clone());
    }

    // Regenerate predictions from new state
    this.futureTensor.update(
      newPos,
      newVelocity ?? null,
      newHeading ?? null,
    );
  }

  /**
   * Returns the FutureTensor containing all 288 predicted waypoints
   * for this entity.
   *
   * @returns The FutureTensor instance for this entity.
   */
  getFutureTensor(): FutureTensor {
    return this.futureTensor;
  }

  /**
   * Returns the underlying Cesium Entity rendered on the globe.
   *
   * @returns The real Cesium Entity, or null if destroyed.
   */
  getRealEntity(): Cesium.Entity | null {
    return this.realEntity;
  }

  /**
   * Removes the Cesium Entity from the viewer and cleans up all references.
   * After calling destroy(), this GhostEntity should be discarded.
   */
  destroy(): void {
    if (this.realEntity) {
      this.viewer.entities.remove(this.realEntity);
      this.realEntity = null;
    }
  }
}