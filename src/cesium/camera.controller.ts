import * as Cesium from 'cesium';

export function cinematicFlyTo(
  viewer: Cesium.Viewer,
  lon: number,
  lat: number,
  targetHeight = 500000,
  duration = 2.5,
) {
  const endPos = Cesium.Cartesian3.fromDegrees(lon, lat, targetHeight);
  const orientation = {
    heading: Cesium.Math.toRadians(20),
    pitch: Cesium.Math.toRadians(-35),
    roll: 0,
  };
  viewer.camera.flyTo({
    destination: endPos,
    orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
  viewer.scene.requestRender();
}

export type TrackEntityType = 'aircraft' | 'satellite' | 'earthquake' | 'ship' | 'cctv' | 'default';

const TRACK_OFFSETS: Record<TrackEntityType, { range: number; pitch: number }> = {
  aircraft: { range: 300000, pitch: -30 },
  satellite: { range: 2000000, pitch: -90 },
  earthquake: { range: 250000, pitch: -50 },
  ship: { range: 100000, pitch: -30 },
  cctv: { range: 12000, pitch: -45 },
  default: { range: 150000, pitch: -35 },
};

export function createEntityTracker(viewer: Cesium.Viewer) {
  let tracked: Cesium.Entity | null = null;
  let removeKey: (() => void) | null = null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && tracked) {
      viewer.trackedEntity = undefined;
      tracked = null;
    }
  };

  window.addEventListener('keydown', onKey);
  removeKey = () => window.removeEventListener('keydown', onKey);

  return {
    track(entity: Cesium.Entity, type: TrackEntityType = 'default') {
      tracked = entity;
      const offset = TRACK_OFFSETS[type] ?? TRACK_OFFSETS.default;
      viewer.trackedEntity = entity;
      viewer.zoomTo(
        entity,
        new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(offset.pitch), offset.range),
      );
    },
    untrack() {
      viewer.trackedEntity = undefined;
      tracked = null;
    },
    destroy() {
      removeKey?.();
      viewer.trackedEntity = undefined;
      tracked = null;
    },
  };
}
