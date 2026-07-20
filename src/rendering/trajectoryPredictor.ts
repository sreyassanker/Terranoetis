import * as Cesium from 'cesium';

/**
 * Domain classification for predictive behavior differentiation.
 * - 'maritime': Ships — great-circle projection with course-based heading perturbation.
 * - 'aviation': Aircraft — great-circle projection at flight velocity.
 * - 'seismic': Static seismic event — concentric uncertainty rings.
 * - 'weather': Static weather system — concentric uncertainty rings.
 */
export type FutureTensorDomain = 'maritime' | 'aviation' | 'seismic' | 'weather';

/**
 * A single predicted waypoint along a future trajectory.
 */
export interface PredictionWaypoint {
  /** Predicted ECEF position in meters. */
  position: Cesium.Cartesian3;
  /** Unix epoch milliseconds for this prediction. */
  timestamp: number;
  /** 1 uncertainty radius in meters at this waypoint. */
  uncertaintyRadiusMeters: number;
}

/**
 * A decayed trail position for polyline rendering — includes opacity for fade-out.
 */
export interface TrailPosition {
  /** ECEF position in meters. */
  position: Cesium.Cartesian3;
  /** Opacity in range [0.1, 1.0] where 1.0 = current time, 0.1 = 72h out. */
  opacity: number;
  /** Unix epoch milliseconds for this trail point. */
  timestamp: number;
}

/**
 * FutureTensor stores 96 predicted future positions (15-minute intervals for 24 hours)
 * for a single entity. Different domains use different uncertainty-growth models.
 *
 * @remarks
 * - Maritime: Great-circle projection with heading perturbation (15 per hour).
 * - Aviation: Great-circle projection at constant altitude with tighter uncertainty.
 * - Seismic/Weather: Static concentric rings with linear uncertainty growth.
 */
export class FutureTensor {
  /** Unique identifier for the tracked entity. */
  readonly entityId: string;

  /** Predictive domain — determines uncertainty model. */
  readonly domain: FutureTensorDomain;

  /** Last known ECEF position. */
  private currentPosition: Cesium.Cartesian3;

  /** Last known velocity in ECEF meters/second (null for static entities). */
  private currentVelocity: Cesium.Cartesian3 | null;

  /** Last known heading in degrees (0 = North, clockwise). Only relevant for maritime/aviation. */
  private currentHeading: number | null;

  private _cachedTrailPositions: TrailPosition[] | null = null;
  private _lastTrailUpdateKey = '';

  /**
   * Array of 96 predicted waypoints at 15-minute intervals spanning 24 hours.
   */
  predictions: PredictionWaypoint[] = [];

  /**
   * Interval between consecutive predictions in seconds (15 minutes = 900 seconds).
   */
  private static readonly INTERVAL_SECONDS = 15 * 60;

  /**
   * Total number of prediction waypoints (24 hours / 15 min = 96).
   * Reduced from 288 (72h) to save 3× memory per ghost entity.
   */
  private static readonly WAYPOINT_COUNT = 96;

  /**
   * @param entityId - Unique identifier for the tracked entity.
   * @param domain - Predictive domain determining uncertainty behavior.
   * @param currentPosition - ECEF position of the entity at the current moment.
   * @param currentVelocity - ECEF velocity vector in meters/second (null for static entities).
   * @param currentHeading - Heading in degrees, 0 = North, clockwise (null for static entities).
   */
  constructor(
    entityId: string,
    domain: FutureTensorDomain,
    currentPosition: Cesium.Cartesian3,
    currentVelocity: Cesium.Cartesian3 | null,
    currentHeading: number | null,
  ) {
    this.entityId = entityId;
    this.domain = domain;
    this.currentPosition = currentPosition.clone();
    this.currentVelocity = currentVelocity ? currentVelocity.clone() : null;
    this.currentHeading = currentHeading;
    this.generatePredictions();
  }

  /**
   * Returns the WGS-84 ellipsoid for geodetic calculations.
   */
  private get ellipsoid(): Cesium.Ellipsoid {
    return Cesium.Ellipsoid.WGS84;
  }

  /**
   * Generates 96 predicted waypoints using domain-specific projection rules.
   *
   * @remarks
   * Each waypoint is 15 minutes apart. Uncertainty radii grow based on domain:
   * - Maritime: baseRadius = 100 + (hours * 500) meters with heading perturbation.
   * - Aviation: baseRadius = 50 + (hours * 200) meters; defaults to 250 m/s if velocity is null.
   * - Seismic/Weather: static position, radius = hours * 1000 meters.
   */
  generatePredictions(): void {
    this.predictions = [];
    const startEpoch = Date.now();
    const carto = Cesium.Cartographic.fromCartesian(
      this.currentPosition,
      this.ellipsoid,
      new Cesium.Cartographic(),
    );

    let headingRad = 0;
    if (this.currentHeading !== null) {
      headingRad = Cesium.Math.toRadians(this.currentHeading);
    }

    // State variables tracked across iterations for moving entities
    let prevLat = carto.latitude;
    let prevLon = carto.longitude;
    let prevAlt = carto.height;
    // Accumulated perturbation for maritime Gaussian cross-track error
    let accumulatedCrossTrackError = 0;

    for (let step = 0; step < FutureTensor.WAYPOINT_COUNT; step++) {
      // step 0  = 15min, step 287 = 72h
      const secondsFromNow = (step + 1) * FutureTensor.INTERVAL_SECONDS;
      const hoursFromNow = secondsFromNow / 3600;
      const timestamp = startEpoch + secondsFromNow * 1000;

      let newLat: number;
      let newLon: number;
      let newAlt: number;
      let uncertaintyRadiusMeters: number;

      if (this.domain === 'maritime') {
        // Maritime: great-circle projection with Gaussian cross-track error
        const speedMs = this.currentVelocity
          ? Cesium.Cartesian3.magnitude(this.currentVelocity)
          : 0;
        const stepDistanceMeters = speedMs * FutureTensor.INTERVAL_SECONDS;
        const stepAngleRadians = stepDistanceMeters / this.ellipsoid.maximumRadius;

        // Cross-track Gaussian error: sigma = 15 per hour, accumulated as random walk
        const crossTrackSigmaDeg = 15 * hoursFromNow;
        const seed = this.hashStep(step);
        const gaussianNoise = this.pseudoGaussian(seed);
        accumulatedCrossTrackError += gaussianNoise * Cesium.Math.toRadians(crossTrackSigmaDeg);

        const perturbedHeading = headingRad + accumulatedCrossTrackError;

        // Great-circle forward projection using spherical trigonometry
        const cosStep = Math.cos(stepAngleRadians);
        const sinStep = Math.sin(stepAngleRadians);
        const cosLat = Math.cos(prevLat);
        const sinLat = Math.sin(prevLat);

        newLat = Math.asin(
          sinLat * cosStep + cosLat * sinStep * Math.cos(perturbedHeading),
        );

        const dLon = Math.atan2(
          sinStep * Math.sin(perturbedHeading) * cosLat,
          cosStep - sinLat * Math.sin(newLat),
        );
        newLon = prevLon + dLon;

        // Normalize longitude
        if (newLon > Math.PI) newLon -= 2 * Math.PI;
        else if (newLon < -Math.PI) newLon += 2 * Math.PI;

        // Clamp latitude to valid range
        newLat = Cesium.Math.clamp(
          newLat,
          -Cesium.Math.PI_OVER_TWO,
          Cesium.Math.PI_OVER_TWO,
        );

        newAlt = prevAlt;
        uncertaintyRadiusMeters = 100 + hoursFromNow * 500;
      } else if (this.domain === 'aviation') {
        // Aviation: great-circle forward at current velocity
        let speedMs = this.currentVelocity
          ? Cesium.Cartesian3.magnitude(this.currentVelocity)
          : 0;
        if (speedMs < 1) speedMs = 250; // Default: commercial jet ~250 m/s

        const stepDistanceMeters = speedMs * FutureTensor.INTERVAL_SECONDS;
        const stepAngleRadians = stepDistanceMeters / this.ellipsoid.maximumRadius;

        const cosStep = Math.cos(stepAngleRadians);
        const sinStep = Math.sin(stepAngleRadians);
        const cosLat = Math.cos(prevLat);
        const sinLat = Math.sin(prevLat);

        newLat = Math.asin(
          sinLat * cosStep + cosLat * sinStep * Math.cos(headingRad),
        );

        const dLon = Math.atan2(
          sinStep * Math.sin(headingRad) * cosLat,
          cosStep - sinLat * Math.sin(newLat),
        );
        newLon = prevLon + dLon;

        if (newLon > Math.PI) newLon -= 2 * Math.PI;
        else if (newLon < -Math.PI) newLon += 2 * Math.PI;

        newLat = Cesium.Math.clamp(
          newLat,
          -Cesium.Math.PI_OVER_TWO,
          Cesium.Math.PI_OVER_TWO,
        );

        newAlt = prevAlt;
        uncertaintyRadiusMeters = 50 + hoursFromNow * 200;
      } else {
        // Seismic / Weather: static position, expanding uncertainty rings
        newLat = prevLat;
        newLon = prevLon;
        newAlt = prevAlt;
        uncertaintyRadiusMeters = hoursFromNow * 1000;
      }

      const position = Cesium.Cartesian3.fromRadians(
        newLon,
        newLat,
        newAlt,
        this.ellipsoid,
        new Cesium.Cartesian3(),
      );

      this.predictions.push({
        position,
        timestamp,
        uncertaintyRadiusMeters,
      });

      // Update state for next iteration
      prevLat = newLat;
      prevLon = newLon;
      prevAlt = newAlt;
    }
  }

  /**
   * Simple hash of step index + entityId characters for deterministic randomness.
   * Used as a seed for pseudo-Gaussian cross-track error generation.
   *
   * @param step - Current prediction step index (0–287).
   * @returns A 32-bit integer hash value.
   */
  private hashStep(step: number): number {
    let hash = step * 2654435761;
    for (let i = 0; i < this.entityId.length; i++) {
      hash = ((hash << 5) - hash + this.entityId.charCodeAt(i)) | 0;
    }
    return hash;
  }

  /**
   * Approximates a standard normal distribution using a linear combination
   * of uniform random values derived from the seed (central limit theorem,
   * 12-sample approximation).
   *
   * @param seed - A 32-bit integer seed for the PRNG.
   * @returns A value approximating N(0,1).
   */
  private pseudoGaussian(seed: number): number {
    let sum = 0;
    let s = seed;
    for (let i = 0; i < 12; i++) {
      // Simple xorshift PRNG
      s ^= s << 13;
      s ^= s >> 17;
      s ^= s << 5;
      sum += (s & 0x7fffffff) / 0x7fffffff;
    }
    return sum / 12 - 0.5; // Center around 0, result ~ N(0,1)
  }

  /**
   * Returns all predicted waypoints with decayed opacity for a fading trail effect.
   * Opacity fades linearly from 1.0 at the current position to 0.1 at the 24-hour
   * prediction, creating a smoke-trail ghost effect.
   *
   * @returns Array of trail positions with opacity in [0.1, 1.0].
   */
  getTrailPositions(): TrailPosition[] {
    const key = String(this.predictions.length);
    if (this._cachedTrailPositions && this._lastTrailUpdateKey === key) {
      return this._cachedTrailPositions;
    }

    const now = Date.now();
    const preds = this.predictions;
    const len = preds.length;
    const cache: TrailPosition[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const wp = preds[i];
      const hoursFromNow = Math.max(0, wp.timestamp - now) / 3600000;
      cache[i] = {
        position: wp.position,
        opacity: Math.round(Math.max(0.1, 1.0 - hoursFromNow / 24) * 100) / 100,
        timestamp: wp.timestamp,
      };
    }
    this._cachedTrailPositions = cache;
    this._lastTrailUpdateKey = key;
    return cache;
  }

  /**
   * Returns the 2D Gaussian probability that the entity will be at the given world
   * position at the specified time offset from now.
   *
   * @param timeOffsetHours - Hours from now to evaluate probability at (clamped to 0–24).
   * @param worldPos - ECEF world position to evaluate probability for.
   * @returns Probability in range [0.0, 1.0] based on a 2D Gaussian falloff.
   */
  getProbabilityAt(timeOffsetHours: number, worldPos: Cesium.Cartesian3): number {
    if (this.predictions.length === 0) return 0;

    // Clamp time offset (24-hour horizon)
    const clampedHours = Math.max(0, Math.min(24, timeOffsetHours));

    const totalWaypoints = this.predictions.length;
    const fractionalIndex = (clampedHours / 24) * (totalWaypoints - 1);
    const idxLow = Math.floor(fractionalIndex);
    const idxHigh = Math.min(idxLow + 1, totalWaypoints - 1);
    const frac = fractionalIndex - idxLow;

    const wpLow = this.predictions[idxLow];
    const wpHigh = this.predictions[idxHigh];

    // Linear interpolation of position
    const interpolatedPos = new Cesium.Cartesian3();
    Cesium.Cartesian3.lerp(wpLow.position, wpHigh.position, frac, interpolatedPos);

    // Linear interpolation of uncertainty radius
    const uncertaintyRadius =
      wpLow.uncertaintyRadiusMeters +
      (wpHigh.uncertaintyRadiusMeters - wpLow.uncertaintyRadiusMeters) * frac;

    // Distance from queried world position to interpolated predicted position
    const distance = Cesium.Cartesian3.distance(worldPos, interpolatedPos);

    // 2D Gaussian probability: exp(-d^2 / (2 * sigma^2))
    const variance = uncertaintyRadius * uncertaintyRadius;
    if (variance < 0.001) {
      return distance < 1 ? 1.0 : 0.0;
    }
    const probability = Math.exp(-(distance * distance) / (2 * variance));

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, probability));
  }

  /**
   * Updates the internal state (position, velocity, heading) and regenerates
   * all 288 waypoint predictions from the new state.
   *
   * @param newPosition - New ECEF position of the entity.
   * @param newVelocity - New ECEF velocity vector (null for static entities).
   * @param newHeading - New heading in degrees (null for non-moving entities).
   */
  update(
    newPosition: Cesium.Cartesian3,
    newVelocity: Cesium.Cartesian3 | null,
    newHeading: number | null,
  ): void {
    this.currentPosition = newPosition.clone();
    this.currentVelocity = newVelocity ? newVelocity.clone() : null;
    this.currentHeading = newHeading;
    this._cachedTrailPositions = null;
    this._lastTrailUpdateKey = '';
    this.generatePredictions();
  }
}