/**
 * Cross-component flag: true while the scenario editor's globe point-picker
 * (volcano vent / earthquake epicentre / hurricane landfall) is waiting for
 * a click. Cesium dispatches canvas clicks to every ScreenSpaceEventHandler
 * independently, so without this the App's global LEFT_CLICK handler would
 * also fire on a pick click — zooming to whatever entity is under the cursor
 * (entityTracker.track → viewer.zoomTo) and opening the context menu.
 */
let active = false;

export function setGlobePickMode(value: boolean): void {
  active = value;
}

export function isGlobePickMode(): boolean {
  return active;
}
