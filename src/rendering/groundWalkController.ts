/**
 * 3D Ground Walk & Tactical Vehicle Simulator for Cesium.
 *
 * Implements interactive 60 FPS ground exploration:
 * 1. Tactical Ground Vehicle (Rover / Humvee) with 3D model, realistic driving physics,
 *    and third-person chase / first-person cockpit camera views.
 * 2. Human-scale pedestrian walking mode with eye-level perspective and sprint.
 * 3. Low-altitude survey drone view with 360° gimbal tilt.
 * 4. Automatic 3D building streaming and terrain height clamping.
 */

import * as Cesium from 'cesium';
import {
  getTeslaRoadsterGltf,
  WHEEL_PIVOT_FL,
  WHEEL_PIVOT_FR,
  WHEEL_PIVOT_RL,
  WHEEL_PIVOT_RR,
} from './roadsterModel';
import { RoadsterAudioEngine } from './roadsterAudio';
import { hideOsmBuildings, removeOsmBuildings } from './osmBuildings';

export type GroundExplorerMode = 'drive' | 'walk' | 'drone';
export type CameraViewPerspective = 'chase' | 'cockpit';

export interface GroundWalkState {
  lat: number;
  lon: number;
  heading: number; // degrees (0 = N, 90 = E)
  pitch: number;   // degrees (-90 looking down, 0 level horizon)
  speed: number;   // km/h
  mode: GroundExplorerMode;
  perspective: CameraViewPerspective;
  isMoving: boolean;
  copvPressurePsi?: number;   // 0 to 10,000 PSI (SpaceX air pressure)
  flightAltitudeM?: number;   // height above terrain in meters
  isFlying?: boolean;         // SpaceX cold-gas thruster flight active
  isLudicrous?: boolean;      // Ludicrous+ 400+ km/h boost
  autoTurntable?: boolean;    // 360° showcase studio spin active
  targaOpen?: boolean;        // Targa open-air convertible mode
  isAudioMuted?: boolean;     // Sound engine mute state
  steerAngleDeg?: number;     // Dynamic steering yoke angle in degrees (-30 to +30)
  throttlePct?: number;       // 0 to 100% accelerator pedal depression
  brakePct?: number;          // 0 to 100% brake pedal depression
  headlightsOn?: boolean;     // Functional headlights & projector beams active
  odometerKm?: number;        // Authentic Tesla Roadster cumulative odometer reading
}

export type GroundWalkCallback = (state: GroundWalkState) => void;

export class GroundWalkController {
  private viewer: Cesium.Viewer | null = null;
  private active = false;
  private onUpdate: GroundWalkCallback | null = null;

  // Position & Orientation
  private lat = 0;
  private lon = 0;
  private heading = 0; // radians (0 = North, PI/2 = East)
  private pitch = 0;   // radians
  private currentGroundHeight = 0;
  private mode: GroundExplorerMode = 'drive';
  private perspective: CameraViewPerspective = 'chase';

  // 3D Vehicle Model Primitive
  private roverModel: Cesium.Model | null = null;
  private modelLoadPromise: Promise<void> | null = null;

  // Wheel Scene-Graph Nodes for real-time 60 FPS spinning & steering
  private wheelNodeFL: Cesium.ModelNode | null = null;
  private wheelNodeFR: Cesium.ModelNode | null = null;
  private wheelNodeRL: Cesium.ModelNode | null = null;
  private wheelNodeRR: Cesium.ModelNode | null = null;
  private thrusterNode: Cesium.ModelNode | null = null;
  private verticalThrusterNode: Cesium.ModelNode | null = null;
  private horizontalThrusterNode: Cesium.ModelNode | null = null;
  private yokeNode: Cesium.ModelNode | null = null;
  private initialYokeMatrix: Cesium.Matrix4 | null = null;
  private wheelRollAngle = 0;
  private currentSteerAngle = 0;

  // Vehicle Physics & Dynamics
  private velocityMps = 0; // forward speed in m/s
  private steeringInput = 0; // -1 (left) to +1 (right)
  private throttleInput = 0; // -1 (reverse) to +1 (forward)
  private keysHeld: Record<string, boolean> = {};
  private lastFrameTime = 0;
  private removePreRenderListener: (() => void) | null = null;
  private removeMouseListeners: (() => void) | null = null;
  private removeKeyListeners: (() => void) | null = null;

  // SpaceX Thruster Package & Flight Simulation (COPV 10,000 PSI)
  private copvPressurePsi = 10000;
  private flightAltitudeM = 0;
  private verticalVelocityMps = 0;
  private isFlying = false;
  private manualFlyInput = false;
  private manualLudicrousInput = false;
  private get isLudicrous(): boolean {
    return this.manualLudicrousInput || !!this.keysHeld['ShiftLeft'] || !!this.keysHeld['ShiftRight'];
  }

  // Vehicle Headlights, Taillights & Odometer
  private headlightsOn = false; // Default OFF
  private odometerKm = 12480.0;
  private hoverCushionEntity: Cesium.Entity | null = null;
  private thrusterGlowEntity: Cesium.Entity | null = null;
  private brakeLightNode: Cesium.ModelNode | null = null;
  private headlightBeamEntity: Cesium.Entity | null = null;
  private manualThrottleInput = 0;
  private manualSteerInput = 0;
  private autoTurntable = false;
  private targaOpen = false;
  private wasFlying = false;
  private audioEngine: RoadsterAudioEngine | null = null;

  // Mouse orbit and look tracking
  private isMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private mouseYawOffset = 0;
  private mousePitchOffset = 0;
  private orbitDistanceMultiplier = 1.0;
  private yawFlingVelocity = 0;

  // Cached camera controller states to restore on exit
  private prevRotateState = true;
  private prevZoomState = true;
  private prevTiltState = true;
  private prevLookState = true;

  // Scratch objects for zero GC pressure
  private readonly scratchCarto = new Cesium.Cartographic();
  private readonly scratchPos = new Cesium.Cartesian3();

  constructor() {}

  get isActive(): boolean {
    return this.active;
  }

  get currentMode(): GroundExplorerMode {
    return this.mode;
  }

  get currentPerspective(): CameraViewPerspective {
    return this.perspective;
  }

  /**
   * Start 3D Ground Exploration mode at coordinates.
   */
  start(
    viewer: Cesium.Viewer,
    initialLat: number,
    initialLon: number,
    initialHeadingDeg = 0,
    callback?: GroundWalkCallback,
    initialMode: GroundExplorerMode = 'drive',
  ): void {
    if (this.active) this.stop(0);
    this.viewer = viewer;
    this.active = true;
    this.onUpdate = callback ?? null;
    this.mode = initialMode;
    this.perspective = initialMode === 'drive' ? 'chase' : 'cockpit';
    this.velocityMps = 0;
    this.mouseYawOffset = 0;
    this.mousePitchOffset = 0;
    this.orbitDistanceMultiplier = 1.0;
    this.copvPressurePsi = 10000;
    this.flightAltitudeM = 0;
    this.verticalVelocityMps = 0;
    this.isFlying = false;
    this.manualFlyInput = false;
    this.manualLudicrousInput = false;
    this.manualThrottleInput = 0;
    this.manualSteerInput = 0;
    this.autoTurntable = false;
    this.mouseYawOffset = 0;
    this.mousePitchOffset = 0;
    this.yawFlingVelocity = 0;

    this.lat = initialLat;
    this.lon = initialLon;
    this.heading = Cesium.Math.toRadians(initialHeadingDeg);
    this.pitch = Cesium.Math.toRadians(-8); // slight forward glance

    // 1. Save and disable Cesium default camera interaction
    const ctrl = viewer.scene.screenSpaceCameraController;
    this.prevRotateState = ctrl.enableRotate;
    this.prevZoomState = ctrl.enableZoom;
    this.prevTiltState = ctrl.enableTilt;
    this.prevLookState = ctrl.enableLook;

    ctrl.enableRotate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;

    // 3. Sample ground elevation
    this.currentGroundHeight = this.sampleGroundHeight(this.lat, this.lon);

    // 4. Spawn 3D Vehicle Model if in drive mode
    if (this.mode === 'drive') {
      this.spawnVehicleModel();
      this.audioEngine = new RoadsterAudioEngine();
      this.audioEngine.start();
    }

    // 5. Position camera
    this.applyCameraTransform();

    // 6. Attach input handlers
    this.attachListeners();
    this.lastFrameTime = performance.now();

    // 7. 60 FPS physics & render loop
    const onPreRender = () => this.updateFrame();
    viewer.scene.preRender.addEventListener(onPreRender);
    this.removePreRenderListener = () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(onPreRender);
      }
    };
  }

  /**
   * Stop exploration and restore standard globe interaction.
   */
  stop(revertAltitude = 380): void {
    if (!this.active) return;
    this.active = false;

    if (this.removePreRenderListener) {
      this.removePreRenderListener();
      this.removePreRenderListener = null;
    }

    if (this.removeKeyListeners) {
      this.removeKeyListeners();
      this.removeKeyListeners = null;
    }

    if (this.removeMouseListeners) {
      this.removeMouseListeners();
      this.removeMouseListeners = null;
    }

    this.keysHeld = {};
    this.removeVehicleModel();
    if (this.audioEngine) {
      this.audioEngine.stop();
      this.audioEngine = null;
    }
    hideOsmBuildings();
    if (this.viewer && !this.viewer.isDestroyed()) {
      removeOsmBuildings(this.viewer);
    }

    if (this.viewer && !this.viewer.isDestroyed()) {
      const ctrl = this.viewer.scene.screenSpaceCameraController;
      ctrl.enableRotate = this.prevRotateState;
      ctrl.enableZoom = this.prevZoomState;
      ctrl.enableTilt = this.prevTiltState;
      ctrl.enableLook = this.prevLookState;

      if (revertAltitude > 0) {
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(this.lon, this.lat, revertAltitude),
          orientation: {
            heading: this.heading,
            pitch: Cesium.Math.toRadians(-38),
            roll: 0,
          },
          duration: 1.4,
          easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        });
      }
    }

    this.viewer = null;
    this.onUpdate = null;
  }

  setMode(mode: GroundExplorerMode): void {
    this.mode = mode;
    if (mode === 'drive') {
      this.perspective = 'chase';
      this.spawnVehicleModel();
      if (!this.audioEngine) {
        this.audioEngine = new RoadsterAudioEngine();
        this.audioEngine.start();
      }
    } else {
      this.perspective = 'cockpit';
      this.removeVehicleModel();
      if (this.audioEngine) {
        this.audioEngine.stop();
        this.audioEngine = null;
      }
    }
    this.applyCameraTransform();
  }

  togglePerspective(): CameraViewPerspective {
    if (this.mode === 'drive') {
      this.perspective = this.perspective === 'chase' ? 'cockpit' : 'chase';
      if (this.perspective === 'cockpit') {
        this.mouseYawOffset = 0;
        this.mousePitchOffset = 0;
        this.yawFlingVelocity = 0;
      }
      if (this.roverModel) {
        this.roverModel.show = true; // In cockpit view, dashboard, steering yoke & hood remain visible!
      }
      this.applyCameraTransform();
      this.emitUpdate();
    }
    return this.perspective;
  }

  setPerspective(p: CameraViewPerspective): void {
    if (this.mode === 'drive') {
      this.perspective = p;
      if (this.perspective === 'cockpit') {
        this.mouseYawOffset = 0;
        this.mousePitchOffset = 0;
        this.yawFlingVelocity = 0;
      }
      if (this.roverModel) {
        this.roverModel.show = true;
      }
      this.applyCameraTransform();
      this.emitUpdate();
    }
  }

  private emitUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate({
        lat: this.lat,
        lon: this.lon,
        heading: Math.round(Cesium.Math.toDegrees(this.heading)) % 360,
        pitch: Math.round(Cesium.Math.toDegrees(this.pitch)),
        speed: Math.round(Math.abs(this.velocityMps) * 3.6),
        mode: this.mode,
        perspective: this.perspective,
        isMoving: Math.abs(this.velocityMps) > 0.1,
        copvPressurePsi: Math.round(this.copvPressurePsi),
        flightAltitudeM: Math.round(this.flightAltitudeM * 10) / 10,
        isFlying: this.isFlying,
        isLudicrous: this.manualLudicrousInput || !!this.keysHeld['ShiftLeft'] || !!this.keysHeld['ShiftRight'],
        autoTurntable: this.autoTurntable,
        targaOpen: this.targaOpen,
        isAudioMuted: this.audioEngine?.muted ?? false,
        steerAngleDeg: Math.round((this.currentSteerAngle * 180) / Math.PI),
        throttlePct: Math.round(Math.max(0, this.throttleInput) * 100),
        brakePct: Math.round(this.throttleInput < 0 ? Math.abs(this.throttleInput) * 100 : (this.keysHeld['KeyS'] || this.keysHeld['ArrowDown'] ? 100 : 0)),
        headlightsOn: this.headlightsOn,
        odometerKm: Math.round(this.odometerKm * 10) / 10,
      });
    }
  }

  teleport(lat: number, lon: number, headingDeg?: number): void {
    this.lat = lat;
    this.lon = lon;
    this.velocityMps = 0;
    if (typeof headingDeg === 'number') {
      this.heading = Cesium.Math.toRadians(headingDeg);
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.scratchCarto.latitude = Cesium.Math.toRadians(this.lat);
      this.scratchCarto.longitude = Cesium.Math.toRadians(this.lon);
      const h = this.viewer.scene.globe.getHeight(this.scratchCarto);
      if (typeof h === 'number' && !Number.isNaN(h)) this.currentGroundHeight = h;
      this.updateVehicleModelMatrix();
      this.applyCameraTransform();
    }
  }

  private sampleGroundHeight(lat: number, lon: number): number {
    if (!this.viewer || this.viewer.isDestroyed()) return this.currentGroundHeight;
    this.scratchCarto.latitude = Cesium.Math.toRadians(lat);
    this.scratchCarto.longitude = Cesium.Math.toRadians(lon);

    const gh = this.viewer.scene?.globe?.getHeight(this.scratchCarto);
    if (typeof gh === 'number' && Number.isFinite(gh) && gh >= -500 && gh <= 9000) {
      return Math.max(0, gh);
    }

    if (typeof this.viewer.scene?.sampleHeight === 'function') {
      try {
        const exclude = this.roverModel ? [this.roverModel] : undefined;
        const sh = this.viewer.scene.sampleHeight(this.scratchCarto, exclude);
        if (typeof sh === 'number' && Number.isFinite(sh) && sh >= -500 && sh <= 9000) {
          return Math.max(0, sh);
        }
      } catch { /* sampleHeight requires loaded depth tiles */ }
    }

    return this.currentGroundHeight;
  }

  private spawnVehicleModel(): void {
    if (!this.viewer || this.viewer.isDestroyed() || this.roverModel) return;

    const v = this.viewer;
    this.modelLoadPromise = Cesium.Model.fromGltfAsync({
      url: getTeslaRoadsterGltf({
        targaOpen: this.targaOpen,
        showThrusterPlumes: this.isFlying,
      }),
      id: 'terranoetis_rover_vehicle',
      scale: 1.0,
      shadows: Cesium.ShadowMode.DISABLED,
    }).then((model) => {
      if (!this.active || v.isDestroyed()) {
        try { model.destroy(); } catch { /* ignore */ }
        return;
      }
      v.scene.primitives.add(model);
      this.roverModel = model;
      model.show = true;

      const grabWheelNodes = () => {
        if (!this.active || model.isDestroyed()) return;
        try {
          this.wheelNodeFL = model.getNode('wheel_fl') ?? null;
          this.wheelNodeFR = model.getNode('wheel_fr') ?? null;
          this.wheelNodeRL = model.getNode('wheel_rl') ?? null;
          this.wheelNodeRR = model.getNode('wheel_rr') ?? null;
          this.thrusterNode = model.getNode('spacex_thruster_plumes') ?? null;
          this.verticalThrusterNode = model.getNode('spacex_vertical_thrusters') ?? null;
          this.horizontalThrusterNode = model.getNode('spacex_horizontal_thrusters') ?? null;
          this.brakeLightNode = model.getNode('brake_lights_strip') ?? null;
          this.yokeNode = model.getNode('cockpit_steering_yoke') ?? null;
          if (this.yokeNode) {
            this.initialYokeMatrix = Cesium.Matrix4.clone(this.yokeNode.matrix);
          }
          if (this.thrusterNode) {
            this.thrusterNode.show = this.isFlying;
          }
          if (this.verticalThrusterNode) {
            this.verticalThrusterNode.show = this.isFlying;
          }
          if (this.horizontalThrusterNode) {
            this.horizontalThrusterNode.show = false;
          }
          if (this.brakeLightNode) {
            // When stopped or braking, show intense brake light
            this.brakeLightNode.show = Math.abs(this.velocityMps) < 0.25;
          }
        } catch { /* degrade gracefully */ }
      };

      if (model.ready) grabWheelNodes();
      else if ((model as unknown as { readyEvent?: Cesium.Event }).readyEvent) {
        (model as unknown as { readyEvent: Cesium.Event }).readyEvent.addEventListener(grabWheelNodes);
      }

      this.updateVehicleModelMatrix();
      this.updateWheelTransforms(0.016);
      v.scene.requestRender();
    }).catch((err) => {
      console.warn('[GroundExplorer] Rover 3D model load failed:', err);
    });
  }

  private reloadVehicleModel(): void {
    if (this.mode !== 'drive' || !this.viewer || this.viewer.isDestroyed()) return;
    this.removeVehicleModel();
    this.spawnVehicleModel();
  }

  private removeVehicleModel(): void {
    this.wheelNodeFL = null;
    this.wheelNodeFR = null;
    this.wheelNodeRL = null;
    this.wheelNodeRR = null;
    this.thrusterNode = null;
    this.verticalThrusterNode = null;
    this.horizontalThrusterNode = null;
    this.brakeLightNode = null;
    this.yokeNode = null;
    this.initialYokeMatrix = null;
    if (this.hoverCushionEntity && this.viewer && !this.viewer.isDestroyed()) {
      try {
        this.viewer.entities.remove(this.hoverCushionEntity);
      } catch { /* ignore */ }
      this.hoverCushionEntity = null;
    }
    if (this.thrusterGlowEntity && this.viewer && !this.viewer.isDestroyed()) {
      try {
        this.viewer.entities.remove(this.thrusterGlowEntity);
      } catch { /* ignore */ }
      this.thrusterGlowEntity = null;
    }
    if (this.headlightBeamEntity && this.viewer && !this.viewer.isDestroyed()) {
      try {
        this.viewer.entities.remove(this.headlightBeamEntity);
      } catch { /* ignore */ }
      this.headlightBeamEntity = null;
    }
    if (this.roverModel && this.viewer && !this.viewer.isDestroyed()) {
      try {
        this.viewer.scene.primitives.remove(this.roverModel);
        this.roverModel.destroy();
      } catch { /* ignore */ }
      this.roverModel = null;
    }
  }

  private updateWheelTransforms(dt: number): void {
    if (this.mode !== 'drive') return;

    // Linear distance travelled drives wheel roll angle (radius = 0.3645m, Michelin 28.7" tire)
    // When flying airborne, wheels idle smoothly rather than spinning on phantom pavement
    const wheelRadius = 0.3645;
    const rollDistance = this.isFlying ? 0 : this.velocityMps * dt;
    this.wheelRollAngle += rollDistance / wheelRadius;

    // Accumulate authentic odometer reading in kilometers
    this.odometerKm += Math.abs(rollDistance) / 1000;

    // Smooth steering angle interpolation
    // Target steer angle: 0.46 rad (~26.4 degrees)
    const targetSteer = this.steeringInput * 0.46;
    this.currentSteerAngle = this.currentSteerAngle * 0.82 + targetSteer * 0.18;

    // Wheel axle is along X! Rolling spins around X, steering turns around local Y!
    const rollRot = Cesium.Matrix3.fromRotationX(this.wheelRollAngle);
    // Left turn turns wheels to the Left (+X in glTF space); Right turn turns wheels to the Right (-X)
    const steerRot = Cesium.Matrix3.fromRotationY(-this.currentSteerAngle);
    const frontRot = Cesium.Matrix3.multiply(steerRot, rollRot, new Cesium.Matrix3());

    // Front Left Wheel (Steer about Y + Roll about X)
    if (this.wheelNodeFL) {
      this.wheelNodeFL.matrix = Cesium.Matrix4.fromRotationTranslation(
        frontRot,
        new Cesium.Cartesian3(WHEEL_PIVOT_FL[0], WHEEL_PIVOT_FL[1], WHEEL_PIVOT_FL[2])
      );
    }

    // Front Right Wheel (Steer about Y + Roll about X)
    if (this.wheelNodeFR) {
      this.wheelNodeFR.matrix = Cesium.Matrix4.fromRotationTranslation(
        frontRot,
        new Cesium.Cartesian3(WHEEL_PIVOT_FR[0], WHEEL_PIVOT_FR[1], WHEEL_PIVOT_FR[2])
      );
    }

    // Rear Left Wheel (Roll about X only)
    if (this.wheelNodeRL) {
      this.wheelNodeRL.matrix = Cesium.Matrix4.fromRotationTranslation(
        rollRot,
        new Cesium.Cartesian3(WHEEL_PIVOT_RL[0], WHEEL_PIVOT_RL[1], WHEEL_PIVOT_RL[2])
      );
    }

    // Rear Right Wheel (Roll about X only)
    if (this.wheelNodeRR) {
      this.wheelNodeRR.matrix = Cesium.Matrix4.fromRotationTranslation(
        rollRot,
        new Cesium.Cartesian3(WHEEL_PIVOT_RR[0], WHEEL_PIVOT_RR[1], WHEEL_PIVOT_RR[2])
      );
    }

    // Cockpit 3D Steer-by-Wire Steering Yoke:
    // Pure in-place rotation around the steering spindle axis (local [0, 1, 0]):
    if (this.yokeNode && this.initialYokeMatrix) {
      // Steer input turns yoke clockwise / anticlockwise around its local Y spindle axis
      const yokeSteerAngle = -this.currentSteerAngle * 2.2;
      const axis = new Cesium.Cartesian3(0, 1, 0); // local spindle axis
      const qRot = Cesium.Quaternion.fromAxisAngle(axis, yokeSteerAngle, new Cesium.Quaternion());
      const rotM3 = Cesium.Matrix3.fromQuaternion(qRot, new Cesium.Matrix3());
      const mRot = Cesium.Matrix4.fromRotationTranslation(rotM3, Cesium.Cartesian3.ZERO, new Cesium.Matrix4());

      this.yokeNode.matrix = Cesium.Matrix4.multiply(
        this.initialYokeMatrix,
        mRot,
        new Cesium.Matrix4()
      );
    }

    // 60 FPS SpaceX Cold-Gas Thruster Pulsation & Mach Flow Dynamics
    const isThrusterActive = this.isFlying || (this.isLudicrous && (this.throttleInput > 0.1 || this.manualThrottleInput > 0.1));
    const forwardThrust = (this.throttleInput > 0.1 || this.manualThrottleInput > 0.1);
    if (this.verticalThrusterNode) {
      this.verticalThrusterNode.show = this.isFlying;
    }
    if (this.horizontalThrusterNode) {
      this.horizontalThrusterNode.show = forwardThrust && (this.isLudicrous || this.isFlying);
    }
    if (this.thrusterNode) {
      if (isThrusterActive) {
        this.thrusterNode.show = true;
        const now = performance.now();
        // High-velocity horsepower kinetic vibration and supersonic turbulence
        const machVibe = 1.0 + Math.sin(now * 0.088) * 0.08 + Math.cos(now * 0.165) * 0.04;
        const throttleExpand = 1.0 + Math.max(0, this.throttleInput) * 0.28;
        const pressureScale = Math.max(0.40, Math.min(1.20, this.copvPressurePsi / 7500));
        const sX = machVibe * pressureScale;
        const sY = (1.0 + Math.sin(now * 0.105) * 0.06) * throttleExpand * pressureScale;
        const sZ = (1.0 + Math.cos(now * 0.078) * 0.06) * throttleExpand * pressureScale;
        this.thrusterNode.matrix = Cesium.Matrix4.fromScale(
          new Cesium.Cartesian3(sX, sY, sZ),
          new Cesium.Matrix4()
        );
      } else {
        this.thrusterNode.show = false;
      }
    }

    // Dynamic High-Intensity Brake Stop Lights (Active when braking, decelerating, or stopping)
    if (this.brakeLightNode) {
      const isBraking = (this.throttleInput < 0 && this.velocityMps > 0.1) ||
        (this.keysHeld['KeyS'] || this.keysHeld['ArrowDown']) ||
        (Math.abs(this.velocityMps) < 0.25 && this.throttleInput === 0);
      this.brakeLightNode.show = isBraking;
    }
  }

  private isDaylight(): boolean {
    if (!this.viewer || this.viewer.isDestroyed()) return true;
    try {
      const currentTime = this.viewer.clock?.currentTime ?? Cesium.JulianDate.now();
      const posCartesian = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, Math.max(0, this.currentGroundHeight));
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(posCartesian, new Cesium.Cartesian3());

      const sunPosInertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(currentTime);
      if (sunPosInertial) {
        const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(currentTime, new Cesium.Matrix3());
        const sunPosFixed = icrfToFixed
          ? Cesium.Matrix3.multiplyByVector(icrfToFixed, sunPosInertial, new Cesium.Cartesian3())
          : sunPosInertial;
        Cesium.Cartesian3.normalize(sunPosFixed, sunPosFixed);
        const cosZenith = Cesium.Cartesian3.dot(up, sunPosFixed);
        // Sun elevation: > 0.05 (~3 degrees above horizon) means daytime/daylight
        return cosZenith > 0.05;
      }
    } catch {
      // Fallback: estimate based on local solar time from UTC and longitude
      const now = new Date();
      const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
      const localSolarHour = ((utcHour + this.lon / 15) % 24 + 24) % 24;
      return localSolarHour >= 6.5 && localSolarHour <= 18.0;
    }
    return true;
  }

  private updateFlightGroundEffects(): void {
    if (!this.viewer || this.viewer.isDestroyed() || this.mode !== 'drive') {
      if (this.hoverCushionEntity) this.hoverCushionEntity.show = false;
      if (this.thrusterGlowEntity) this.thrusterGlowEntity.show = false;
      if (this.headlightBeamEntity) this.headlightBeamEntity.show = false;
      return;
    }

    const groundH = Math.max(0, this.currentGroundHeight);

    // 1. Functional Headlights Projector Road Beam
    // Real automotive physics: In bright daylight, headlight ground illumination is invisible.
    // The road projector beam only illuminates the tarmac in night / low brightness conditions or twilight.
    const isDarkOrNight = !this.isDaylight();
    const shouldProjectBeam = (this.headlightsOn || isDarkOrNight) && isDarkOrNight && !this.isFlying;

    if (shouldProjectBeam) {
      if (!this.headlightBeamEntity) {
        this.headlightBeamEntity = this.viewer.entities.add({
          id: 'roadster_headlights_road_beam',
          position: new Cesium.CallbackProperty(() => {
            const h = this.heading;
            const fx = Math.sin(h);
            const fy = Math.cos(h);
            const mLat = 1 / 111139;
            const mLon = 1 / (111139 * Math.max(0.1, Math.cos(Cesium.Math.toRadians(this.lat))));
            return Cesium.Cartesian3.fromDegrees(this.lon + 8.5 * fx * mLon, this.lat + 8.5 * fy * mLat, groundH + 0.03);
          }, false) as unknown as Cesium.PositionProperty,
          ellipse: {
            semiMajorAxis: 8.5,
            semiMinorAxis: 3.2,
            rotation: new Cesium.CallbackProperty(() => -this.heading, false),
            material: new Cesium.Color(1.0, 0.98, 0.92, 0.32),
            height: new Cesium.CallbackProperty(() => Math.max(0, this.currentGroundHeight) + 0.03, false),
          },
        });
      } else {
        this.headlightBeamEntity.show = true;
      }
    } else if (this.headlightBeamEntity) {
      this.headlightBeamEntity.show = false;
    }

    const isThrusterActive = this.isFlying || (this.isLudicrous && (this.throttleInput > 0.1 || this.manualThrottleInput > 0.1));
    if (!isThrusterActive || (this.flightAltitudeM < 0.04 && !this.isFlying)) {
      if (this.hoverCushionEntity) this.hoverCushionEntity.show = false;
      if (this.thrusterGlowEntity) this.thrusterGlowEntity.show = false;
      return;
    }

    // 3. Dense Billowing White Cold-Gas Condensation Cloud underneath vehicle on terrain
    if (!this.hoverCushionEntity) {
      this.hoverCushionEntity = this.viewer.entities.add({
        id: 'roadster_hover_cushion_ground_wash',
        position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(this.lon, this.lat, groundH + 0.04), false) as unknown as Cesium.PositionProperty,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(() => (4.4 + Math.sin(performance.now() * 0.024) * 0.45), false),
          semiMinorAxis: new Cesium.CallbackProperty(() => (3.5 + Math.cos(performance.now() * 0.022) * 0.35), false),
          rotation: new Cesium.CallbackProperty(() => -this.heading, false),
          material: new Cesium.Color(0.97, 0.98, 1.0, 0.76), // Pure dense white cold-gas vapor condensation cloud
          height: new Cesium.CallbackProperty(() => Math.max(0, this.currentGroundHeight) + 0.04, false),
        },
      });
    } else {
      this.hoverCushionEntity.show = true;
    }

    // 4. Rear Diffuser Downward Cold-Gas Thruster Impact Cloud on Ground
    if (!this.thrusterGlowEntity) {
      this.thrusterGlowEntity = this.viewer.entities.add({
        id: 'roadster_thruster_ground_glow',
        position: new Cesium.CallbackProperty(() => {
          const h = this.heading;
          const fx = Math.sin(h);
          const fy = Math.cos(h);
          const mLat = 1 / 111139;
          const mLon = 1 / (111139 * Math.max(0.1, Math.cos(Cesium.Math.toRadians(this.lat))));
          return Cesium.Cartesian3.fromDegrees(this.lon - 1.5 * fx * mLon, this.lat - 1.5 * fy * mLat, groundH + 0.04);
        }, false) as unknown as Cesium.PositionProperty,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(() => 3.6 + Math.sin(performance.now() * 0.042) * 0.40, false),
          semiMinorAxis: 2.2,
          rotation: new Cesium.CallbackProperty(() => -this.heading, false),
          material: new Cesium.Color(1.0, 1.0, 1.0, 0.88), // High-intensity turbulent impact cloud
          height: new Cesium.CallbackProperty(() => Math.max(0, this.currentGroundHeight) + 0.04, false),
        },
      });
    } else {
      this.thrusterGlowEntity.show = true;
    }
  }

  private updateVehicleModelMatrix(): void {
    if (!this.roverModel || this.roverModel.isDestroyed()) return;

    // Vehicle ground position + SpaceX cold-gas thruster flight altitude
    // Model tire contact patch sits at Y = 0.000m. Adding +0.08m clearance ensures all tires
    // rest 100% cleanly ABOVE the Cesium terrain surface / tiles with zero clipping or sunken rims.
    const groundClearance = 0.08;
    // When flying, add subtle aerodynamic ground-effect micro-heave breathing
    const hoverBreathing = (this.isFlying && this.flightAltitudeM > 0.15)
      ? Math.sin(performance.now() * 0.011) * 0.022
      : 0;
    const groundAlt = Math.max(0, this.currentGroundHeight) + groundClearance + this.flightAltitudeM + hoverBreathing;
    const pos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, groundAlt);

    // Orientation: Heading angle around local Z (Up) axis, plus flight pitch and banking when airborne
    // RCS Pitch: Forward rocket launch pitches nose down (-3.5°); retro-braking pitches nose up (+3.0°)
    // RCS Roll: Hypercar high-speed bank-to-turn roll (±9.0°)
    const flightPitch = this.flightAltitudeM > 0.08
      ? Cesium.Math.toRadians(Math.max(-4.5, Math.min(3.5, this.throttleInput > 0 ? -3.5 : this.throttleInput < 0 ? 3.0 : 0.0)))
      : 0;
    const flightRoll = this.flightAltitudeM > 0.08
      ? Cesium.Math.toRadians(Math.max(-10.0, Math.min(10.0, this.steeringInput * 9.0)))
      : 0;
    // Model is aligned so front headlights point precisely along this.heading:
    // GlTF asset in ENU requires +PI/2 rotation so that headlights and front splitter face precisely along this.heading (0° North, 90° East).
    const modelHeading = this.heading + Math.PI * 0.5;
    const hpr = new Cesium.HeadingPitchRoll(modelHeading, flightPitch, flightRoll);
    const qRot = Cesium.Quaternion.fromHeadingPitchRoll(hpr, new Cesium.Quaternion());

    const rotM = Cesium.Matrix4.fromTranslationQuaternionRotationScale(
      Cesium.Cartesian3.ZERO,
      qRot,
      new Cesium.Cartesian3(1, 1, 1),
      new Cesium.Matrix4()
    );

    const enuFixed = Cesium.Transforms.eastNorthUpToFixedFrame(pos, Cesium.Ellipsoid.WGS84, new Cesium.Matrix4());
    this.roverModel.modelMatrix = Cesium.Matrix4.multiply(enuFixed, rotM, new Cesium.Matrix4());
  }

  private attachListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      this.keysHeld[e.code] = true;
      if (e.code === 'KeyV' || e.code === 'KeyC') {
        this.togglePerspective();
      }
      if (e.code === 'KeyF') {
        this.toggleFlight();
      }
      if (e.code === 'KeyR') {
        this.toggleTurntable();
      }
      if (e.code === 'KeyU') {
        this.toggleAudioMute();
      }
      if (e.code === 'KeyT') {
        this.toggleTargaRoof();
      }
      if (e.code === 'KeyL') {
        this.toggleHeadlights();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysHeld[e.code] = false;
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      this.removeKeyListeners = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }

    const canvas = this.viewer?.scene.canvas;
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) {
        this.isMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isMouseDown) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      const sensitivity = 0.0055;
      this.mouseYawOffset += dx * sensitivity;
      this.yawFlingVelocity = dx * sensitivity * 14.0;
      this.mousePitchOffset = Math.max(-0.65, Math.min(0.85, this.mousePitchOffset - dy * sensitivity));
      this.applyCameraTransform();
    };

    const onPointerUp = (e: PointerEvent) => {
      this.isMouseDown = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.perspective === 'cockpit') {
        // Cockpit interior: trackpad scroll / wheel looks around inside the cabin!
        this.mouseYawOffset += e.deltaX * 0.0035;
        this.mousePitchOffset = Math.max(-0.60, Math.min(0.60, this.mousePitchOffset - e.deltaY * 0.0035));
        this.applyCameraTransform();
        return;
      }

      // Chase / Exterior view: Simultaneous horizontal orbit & vertical zoom!
      if (e.deltaX !== 0) {
        // Two-finger horizontal swipe: ROTATE / ORBIT 360° around car with flick momentum
        const d = e.deltaX * 0.0042;
        this.mouseYawOffset += d;
        this.yawFlingVelocity += d * 12.0;
      }
      if (e.deltaY !== 0) {
        // Vertical two-finger swipe / wheel: ZOOM in & out smoothly
        const zoomFactor = Math.exp(e.deltaY * 0.0012);
        this.orbitDistanceMultiplier = Math.max(0.35, Math.min(3.5, this.orbitDistanceMultiplier * zoomFactor));
      }
      this.applyCameraTransform();
    };

    // Safari/macOS trackpad two-finger TWIST (GestureEvent) = orbit, pinch = zoom
    const hasGesture = typeof window !== 'undefined' && typeof (window as unknown as { GestureEvent?: unknown }).GestureEvent !== 'undefined';
    let gRot = 0, gScale = 1;
    const onGStart = (ev: Event) => {
      const g = ev as unknown as { rotation: number; scale: number };
      gRot = g.rotation || 0;
      gScale = g.scale || 1;
    };
    const onGChange = (ev: Event) => {
      ev.preventDefault();
      const g = ev as unknown as { rotation: number; scale: number };
      if (g.rotation !== undefined && g.rotation !== gRot) {
        const d = (g.rotation - gRot) * (Math.PI / 180);
        this.mouseYawOffset += d;
        this.yawFlingVelocity += d * 10.0;
        gRot = g.rotation;
      }
      if (g.scale && g.scale !== gScale) {
        const sc = g.scale / gScale;
        this.orbitDistanceMultiplier = Math.max(0.35, Math.min(3.5, this.orbitDistanceMultiplier / (sc || 1)));
        gScale = g.scale;
      }
      this.applyCameraTransform();
    };
    const onGEnd = () => { gRot = 0; gScale = 1; };

    const onDblClick = () => {
      this.mouseYawOffset = 0;
      this.mousePitchOffset = 0;
      this.orbitDistanceMultiplier = 1.0;
      this.yawFlingVelocity = 0;
      this.applyCameraTransform();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', onPointerUp);
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);

    if (hasGesture) {
      canvas.addEventListener('gesturestart', onGStart as EventListener);
      canvas.addEventListener('gesturechange', onGChange as EventListener, { passive: false });
      canvas.addEventListener('gestureend', onGEnd);
    }

    this.removeMouseListeners = () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerup', onPointerUp);
      }
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      if (hasGesture) {
        canvas.removeEventListener('gesturestart', onGStart as EventListener);
        canvas.removeEventListener('gesturechange', onGChange as EventListener);
        canvas.removeEventListener('gestureend', onGEnd);
      }
    };
  }

  private updateFrame(): void {
    if (!this.active || !this.viewer || this.viewer.isDestroyed()) return;

    const now = performance.now();
    const dt = Math.min(0.08, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // ── Input gathering ──
    let fwd = this.manualThrottleInput;
    let turn = this.manualSteerInput;

    if (this.keysHeld['KeyW'] || this.keysHeld['ArrowUp']) fwd += 1;
    if (this.keysHeld['KeyS'] || this.keysHeld['ArrowDown']) fwd -= 1;
    if (this.keysHeld['KeyA'] || this.keysHeld['ArrowLeft']) turn -= 1;
    if (this.keysHeld['KeyD'] || this.keysHeld['ArrowRight']) turn += 1;
    if (this.keysHeld['KeyQ']) turn -= 1;
    if (this.keysHeld['KeyE']) turn += 1;

    this.steeringInput = turn;
    this.throttleInput = fwd;

    const sprint = !!(this.keysHeld['ShiftLeft'] || this.keysHeld['ShiftRight'] || this.manualLudicrousInput);
    const spaceHeld = !!(this.keysHeld['Space'] || this.manualFlyInput);

    // Continuous 360° studio showcase turntable spin
    if (this.autoTurntable) {
      this.mouseYawOffset += dt * 0.45;
    }

    if (this.mode === 'drive') {
      // ── Tesla Roadster Tri-Motor Electric Hypercar Physics ──
      // Normal cruising: ~135 km/h (37.5 m/s) with instant torque acceleration (18.0 m/s²)
      // Ludicrous+ / Plaid Thruster Mode (Shift): up to ~400 km/h (111.0 m/s) with 34.0 m/s² launch!
      const maxForwardMps = sprint ? 112.0 : 38.0;
      const maxReverseMps = 12.0;                 // ~43 km/h
      const accel = sprint ? 34.0 : 18.0;         // m/s² instant electric torque
      const brakeDrag = 32.0;                     // m/s² carbon-ceramic Brembo braking
      const rollingResistance = 5.0;              // m/s² aero downforce drag

      if (fwd > 0) {
        this.velocityMps = Math.min(maxForwardMps, this.velocityMps + accel * dt);
      } else if (fwd < 0) {
        if (this.velocityMps > 0.5) {
          // Braking
          this.velocityMps = Math.max(0, this.velocityMps - brakeDrag * dt);
        } else {
          // Reverse
          this.velocityMps = Math.max(-maxReverseMps, this.velocityMps - accel * 0.6 * dt);
        }
      } else {
        // Natural deceleration / friction
        if (this.velocityMps > 0) {
          this.velocityMps = Math.max(0, this.velocityMps - rollingResistance * dt);
        } else if (this.velocityMps < 0) {
          this.velocityMps = Math.min(0, this.velocityMps + rollingResistance * dt);
        }
      }

      // Steering with dynamic aerodynamic stability (tighter at low speed, high stability at hypercar speeds)
      if (turn !== 0 && (Math.abs(this.velocityMps) > 0.1 || this.isFlying)) {
        const speedKmh = Math.abs(this.velocityMps) * 3.6;
        const turnSpeedFactor = Math.max(0.20, 1.0 - (speedKmh / 360.0) * 0.70);
        const steerDir = this.velocityMps >= 0 ? turn : -turn; // invert in reverse
        this.heading += steerDir * 2.2 * turnSpeedFactor * dt;
      }

      // ── SpaceX Cold-Gas Thrusters Flight & Ground-Effect Hover System (10,000 PSI COPV) ──
      // Dynamic Pneumatic Physics: 10,000 PSI compressed air stored in composite overwrapped pressure vessels (COPV).
      // Firing cold-gas thrusters depletes tank pressure; thrust authority scales with remaining PSI.
      if (spaceHeld && this.copvPressurePsi > 750) {
        this.isFlying = true;
        // Deplete high-pressure compressed air (~320 PSI/s for vertical hover, +120 PSI/s with forward throttle boost)
        const burnRate = 320 + Math.max(0, fwd) * 120;
        this.copvPressurePsi = Math.max(0, this.copvPressurePsi - burnRate * dt);

        // Thrust authority scales with pressure (nominal hover at >4,000 PSI, settling below 2,000 PSI)
        const thrustAuthority = Math.max(0.20, Math.min(1.0, this.copvPressurePsi / 6000));

        // Ground-effect hovercraft hover (authentic Elon Musk 1.35 to 2.0m leap spec)
        const targetHoverAlt = 1.65 * thrustAuthority;
        const altDiff = targetHoverAlt - this.flightAltitudeM;
        // Spring-damper hover controller for rock-solid aerodynamic stability
        const liftForce = Math.max(-8.0, Math.min(26.0, altDiff * 8.5 + 9.8 - this.verticalVelocityMps * 2.2));
        this.verticalVelocityMps += (liftForce - 9.8) * dt;
        this.verticalVelocityMps *= 0.95; // aerodynamic damping
        this.flightAltitudeM = Math.max(0, this.flightAltitudeM + this.verticalVelocityMps * dt);

        // Supersonic forward cold-gas rocket impulse
        if (fwd > 0) {
          this.velocityMps = Math.min(115.0, this.velocityMps + 44.0 * thrustAuthority * dt); // 0-100 km/h in 1.1s, up to 414 km/h!
        }
      } else {
        // Not firing thrusters (or pressure depleted): descend with automatic retro-cushion
        if (this.flightAltitudeM > 0.04) {
          this.verticalVelocityMps -= 9.8 * dt; // gravity
          // Retro-thrusters activate near touchdown to cushion landing onto Michelin tires
          if (this.flightAltitudeM < 1.4 && this.verticalVelocityMps < -1.2) {
            this.verticalVelocityMps += 16.0 * dt;
          }
          this.flightAltitudeM += this.verticalVelocityMps * dt;
          if (this.flightAltitudeM <= 0) {
            this.flightAltitudeM = 0;
            this.verticalVelocityMps = 0;
            this.isFlying = false;
          }
        } else {
          this.flightAltitudeM = 0;
          this.verticalVelocityMps = 0;
          this.isFlying = false;

          // On ground: onboard electric dual compressors recharge COPV tanks back to 10,000 PSI!
          if (this.copvPressurePsi < 10000) {
            this.copvPressurePsi = Math.min(10000, this.copvPressurePsi + 350 * dt);
          }
        }
      }
    } else if (this.mode === 'walk') {
      // ── Pedestrian Walking Physics ──
      const walkSpeed = sprint ? 4.5 : 1.6; // ~16 km/h sprint, 5.8 km/h walk
      this.velocityMps = fwd * walkSpeed;
      if (turn !== 0) {
        this.heading += turn * 2.2 * dt;
      }
    } else {
      // ── Aerial Recon Drone Physics ──
      const droneSpeed = sprint ? 22.0 : 10.0;
      this.velocityMps = fwd * droneSpeed;
      if (turn !== 0) {
        this.heading += turn * 1.6 * dt;
      }
    }

    // Keep heading in [0, 2PI)
    this.heading = (this.heading % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

    // ── Continuous Ground Elevation Tracking ──
    // Sample ground elevation every frame so when terrain tiles stream in asynchronously,
    // the vehicle and camera immediately settle cleanly ON TOP of the terrain (never underground!)
    const sampledGround = this.sampleGroundHeight(this.lat, this.lon);
    if (this.currentGroundHeight <= 0.01 && sampledGround > 0.05) {
      this.currentGroundHeight = sampledGround;
    } else if (sampledGround > -500 && Math.abs(sampledGround - this.currentGroundHeight) > 0.02) {
      this.currentGroundHeight = this.currentGroundHeight * 0.85 + sampledGround * 0.15;
    }

    // ── Position Displacement along East-North ──
    const isMoving = Math.abs(this.velocityMps) > 0.05 || this.isFlying;
    if (isMoving) {
      const stepDist = this.velocityMps * dt;
      // Heading 0 = North, Heading PI/2 = East
      const dNorth = stepDist * Math.cos(this.heading);
      const dEast = stepDist * Math.sin(this.heading);

      const radLat = Cesium.Math.toRadians(this.lat);
      const mPerDegLat = 111132.954;
      const mPerDegLon = 111132.954 * Math.cos(radLat);

      this.lat += dNorth / mPerDegLat;
      this.lon += dEast / mPerDegLon;
    }

    // When actively driving at speed and user is NOT holding the mouse and NOT in turntable,
    // gently guide the camera back behind the vehicle (auto-align)
    if (this.mode === 'drive' && isMoving && !this.isMouseDown && !this.autoTurntable && Math.abs(this.velocityMps) > 3.0) {
      const returnRate = Math.min(1.8, Math.abs(this.velocityMps) / 14.0);
      this.mouseYawOffset *= Math.max(0, 1.0 - returnRate * dt);
      this.mousePitchOffset *= Math.max(0, 1.0 - returnRate * dt);
    }

    // Update 3D Vehicle model matrix, dynamic wheels, flight ground effects, and camera
    this.updateVehicleModelMatrix();
    this.updateWheelTransforms(dt);
    this.updateFlightGroundEffects();
    this.applyCameraTransform();

    if (this.mode === 'drive') {
      if (this.thrusterNode) {
        this.thrusterNode.show = this.isFlying || (sprint && (this.throttleInput > 0.1 || this.manualThrottleInput > 0.1));
      }
      this.wasFlying = this.isFlying;
      if (this.audioEngine) {
        this.audioEngine.update({
          speedKmh: Math.abs(this.velocityMps) * 3.6,
          throttle: this.throttleInput,
          isFlying: this.isFlying,
          isLudicrous: sprint,
          isBraking: (this.throttleInput < -0.1 && this.velocityMps > 1.0) || this.manualThrottleInput < -0.1,
          copvPressurePsi: this.copvPressurePsi,
          perspective: this.perspective,
          targaOpen: this.targaOpen,
          onGround: this.flightAltitudeM < 0.3,
        });
      }
    }

    if (this.onUpdate) {
      this.onUpdate({
        lat: this.lat,
        lon: this.lon,
        heading: Math.round(Cesium.Math.toDegrees(this.heading)) % 360,
        pitch: Math.round(Cesium.Math.toDegrees(this.pitch)),
        speed: Math.round(Math.abs(this.velocityMps) * 3.6),
        mode: this.mode,
        perspective: this.perspective,
        isMoving,
        copvPressurePsi: Math.round(this.copvPressurePsi),
        flightAltitudeM: Math.round(this.flightAltitudeM * 10) / 10,
        isFlying: this.isFlying,
        isLudicrous: sprint,
        autoTurntable: this.autoTurntable,
        targaOpen: this.targaOpen,
        isAudioMuted: this.audioEngine?.muted ?? false,
        steerAngleDeg: Math.round((this.currentSteerAngle * 180) / Math.PI),
        throttlePct: Math.round(Math.max(0, this.throttleInput) * 100),
        brakePct: Math.round(this.throttleInput < 0 ? Math.abs(this.throttleInput) * 100 : (this.keysHeld['KeyS'] || this.keysHeld['ArrowDown'] ? 100 : 0)),
        headlightsOn: this.headlightsOn,
        odometerKm: Math.round(this.odometerKm * 10) / 10,
      });
    }
  }

  private applyCameraTransform(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return;

    const groundClearance = 0.08;
    const baseAlt = Math.max(0, this.currentGroundHeight) + groundClearance;
    let camPos: Cesium.Cartesian3;
    let camHeading = this.heading + this.mouseYawOffset;
    let camPitch = this.pitch + this.mousePitchOffset;

    if (this.mode === 'drive') {
      if (this.perspective === 'chase') {
        const cam = this.viewer?.scene?.camera as unknown as { frustum?: { near: number } } | undefined;
        if (cam?.frustum) {
          cam.frustum.near = 0.5;
        }

        // ── Third-Person Low-Slung Supercar Spherical Orbit & Chase Camera ──
        // The camera orbits around the Tesla Roadster in a true 3D spherical coordinate system!
        // Dragging the mouse freely pivots the camera 360° horizontally & vertically around the car,
        // while the mouse wheel smoothly zooms in to inspect details or out for wide situational awareness.
        const speedFactor = Math.min(1.0, Math.abs(this.velocityMps) / 80.0);
        const followDist = (4.3 + speedFactor * 1.8) * this.orbitDistanceMultiplier;

        // Base elevation angle above vehicle center (~11° looking down at car)
        const baseElevation = 0.19;
        const elevation = Math.max(-0.35, Math.min(1.25, baseElevation + this.mousePitchOffset));

        const horizDist = followDist * Math.cos(elevation);
        const vertDist = followDist * Math.sin(elevation);

        // Orbit angle in horizontal East-North plane:
        // Heading 0 = North, Math.PI = South (directly behind car tail when mouseYawOffset = 0)
        const orbitAngle = this.heading + Math.PI + this.mouseYawOffset;

        const radLat = Cesium.Math.toRadians(this.lat);
        const mPerDegLat = 111132.954;
        const mPerDegLon = 111132.954 * Math.cos(radLat);

        const dNorth = Math.cos(orbitAngle) * horizDist;
        const dEast = Math.sin(orbitAngle) * horizDist;

        // Vehicle center target height (~0.58m above terrain + flight altitude)
        const targetHeight = baseAlt + this.flightAltitudeM + 0.58;
        const camHeight = Math.max(baseAlt + 0.35, targetHeight + vertDist);

        camPos = Cesium.Cartesian3.fromDegrees(
          this.lon + dEast / mPerDegLon,
          this.lat + dNorth / mPerDegLat,
          camHeight
        );

        // Camera looks directly FROM the camera TO the vehicle center:
        camHeading = (this.heading + this.mouseYawOffset) % (Math.PI * 2);
        if (camHeading < 0) camHeading += Math.PI * 2;

        // Pitch angle looking down at the vehicle center
        camPitch = -elevation;
      } else {
        // ── First-Person Driver Cockpit View ──
        // Positioned comfortably in driver bucket seat headrest looking forward over the steer-by-wire yoke, hood, and road
        const cam = this.viewer?.scene?.camera as unknown as { frustum?: { near: number; fov?: number } } | undefined;
        if (cam?.frustum) {
          cam.frustum.near = 0.04;
          cam.frustum.fov = Cesium.Math.toRadians(70);
        }

        const driverForwardOffset = 0.12; // Authentic driver bucket seat position along heading
        const driverLateralOffset = 0.38;  // 0.38m to the left (driver bucket seat center)
        const camHeight = baseAlt + this.flightAltitudeM + 0.98;

        const radLat = Cesium.Math.toRadians(this.lat);
        const mPerDegLat = 111132.954;
        const mPerDegLon = 111132.954 * Math.cos(radLat);

        // Transform local (forward, left) offset into East-North coordinates
        const dEast = driverForwardOffset * Math.sin(this.heading) - driverLateralOffset * Math.cos(this.heading);
        const dNorth = driverForwardOffset * Math.cos(this.heading) + driverLateralOffset * Math.sin(this.heading);

        camPos = Cesium.Cartesian3.fromDegrees(this.lon + dEast / mPerDegLon, this.lat + dNorth / mPerDegLat, camHeight);
        camHeading = (this.heading + this.mouseYawOffset) % (Math.PI * 2);
        if (camHeading < 0) camHeading += Math.PI * 2;
        camPitch = Math.max(-0.6, Math.min(0.6, Cesium.Math.toRadians(-4.0) + this.mousePitchOffset));
      }
    } else if (this.mode === 'walk') {
      // ── Human Eye-Level Walking Perspective ──
      const eyeAlt = baseAlt + 1.72;
      camPos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, eyeAlt);
      camPitch = Cesium.Math.toRadians(-2) + this.mousePitchOffset;
    } else {
      // ── Reconnaissance UAV / Drone Survey ──
      const droneAlt = baseAlt + 24.0;
      camPos = Cesium.Cartesian3.fromDegrees(this.lon, this.lat, droneAlt);
      camPitch = Cesium.Math.toRadians(-28) + this.mousePitchOffset;
    }

    this.viewer.camera.setView({
      destination: camPos,
      orientation: {
        heading: camHeading,
        pitch: camPitch,
        roll: 0,
      },
    });

    this.viewer.scene.requestRender();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ON-SCREEN TOUCH & INTERACTIVE ACTION CONTROLS
  // ══════════════════════════════════════════════════════════════════════════

  setManualFly(active: boolean): void {
    this.manualFlyInput = active;
    if (active && this.copvPressurePsi > 40) {
      this.isFlying = true;
    }
    this.emitUpdate();
  }

  toggleFlight(): boolean {
    this.manualFlyInput = !this.manualFlyInput;
    if (this.manualFlyInput && this.copvPressurePsi > 40) {
      this.isFlying = true;
    }
    this.emitUpdate();
    return this.manualFlyInput;
  }

  setManualLudicrous(active: boolean): void {
    this.manualLudicrousInput = active;
  }

  setManualThrottle(fwd: number): void {
    this.manualThrottleInput = fwd;
  }

  setManualSteer(turn: number): void {
    this.manualSteerInput = turn;
  }

  toggleTurntable(): boolean {
    this.autoTurntable = !this.autoTurntable;
    this.emitUpdate();
    return this.autoTurntable;
  }

  resetOrbitCamera(): void {
    this.mouseYawOffset = 0;
    this.mousePitchOffset = 0;
    this.orbitDistanceMultiplier = 1.0;
    this.autoTurntable = false;
    this.applyCameraTransform();
  }

  toggleAudioMute(): boolean {
    if (!this.audioEngine) {
      this.audioEngine = new RoadsterAudioEngine();
      this.audioEngine.start();
    }
    const muted = this.audioEngine.toggleMute();
    this.emitUpdate();
    return muted;
  }

  isAudioMuted(): boolean {
    return this.audioEngine?.muted ?? false;
  }

  toggleTargaRoof(): boolean {
    this.targaOpen = !this.targaOpen;
    this.reloadVehicleModel();
    this.emitUpdate();
    return this.targaOpen;
  }

  isTargaRoofOpen(): boolean {
    return this.targaOpen;
  }

  toggleHeadlights(): boolean {
    this.headlightsOn = !this.headlightsOn;
    this.emitUpdate();
    return this.headlightsOn;
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.emitUpdate();
  }

  getHeadlights(): boolean {
    return this.headlightsOn;
  }

  getOdometerKm(): number {
    return Math.round(this.odometerKm * 10) / 10;
  }
}
