/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import * as Cesium from 'cesium';

// ═══════════════════════════════════════════════════════════════════
// 1. MGRS Grid Overlay — Military Grid Reference System
// ═══════════════════════════════════════════════════════════════════

interface MgrsResult {
  mgrs: string;
  lat: number;
  lon: number;
  zone: number;
  band: string;
  precision: number;
}

/**
 * Render MGRS grid lines and labels for a visible region.
 * Generates grid lines at the specified precision level.
 */
export function addMgrsGridEntities(
  viewer: Cesium.Viewer,
  mgrsData: MgrsResult[],
  precision: number = 3,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  mgrsData.forEach((m) => {
    // Create MGRS label at each grid point
    const mgrsPos = Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 50000); // Float above terrain

    const ent = viewer.entities.add({
      position: mgrsPos,
      name: `MGRS: ${m.mgrs}`,
      label: {
        text: m.mgrs,
        font: 'bold 11px "Space Grotesk", monospace',
        fillColor: Cesium.Color.fromCssColorString('#22d3ee'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, 0),
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.3),
        heightReference: Cesium.HeightReference.NONE,
      },
      point: {
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.6),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
        outlineWidth: 1,
      },
      properties: {
        layer: 'mgrs_grid',
        mgrs: m.mgrs,
        zone: m.zone,
        band: m.band,
        precision: m.precision,
        lat: m.lat,
        lon: m.lon,
      },
    });
    ents.push(ent);
  });

  viewer.scene.requestRender();
  return ents;
}

/**
 * Render a single MGRS coordinate as a highlighted marker
 */
export function addMgrsMarker(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  mgrsString: string,
  label?: string,
): Cesium.Entity {
  const mgrsMarkerPos = Cesium.Cartesian3.fromDegrees(lon, lat, 20000);

  const marker = viewer.entities.add({
    position: mgrsMarkerPos,
    name: label || `MGRS: ${mgrsString}`,
    billboard: {
      image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2322d3ee" stroke="%230891b2" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-family="monospace">M</text></svg>`),
      width: 24,
      height: 24,
      heightReference: Cesium.HeightReference.NONE,
    },
    label: {
      text: mgrsString,
      font: 'bold 12px "Space Grotesk", monospace',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#0891b2'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      heightReference: Cesium.HeightReference.NONE,
    },
    properties: {
      layer: 'mgrs_marker',
      mgrs: mgrsString,
      lat,
      lon,
    },
  });

  viewer.scene.requestRender();
  return marker;
}

// ═══════════════════════════════════════════════════════════════════
// 2. NDBC Ocean Buoy Markers — Real-Time Marine Conditions
// ═══════════════════════════════════════════════════════════════════

interface NdbcReading {
  stationId: string;
  timestamp: string;
  waveHeight?: number;
  windSpeed?: number;
  windDirection?: number;
  seaTemperature?: number;
  airTemperature?: number;
  pressure?: number;
}

interface NdbcStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: 'buoy' | 'cman';
}

/**
 * Render NDBC buoy markers with current ocean conditions
 */
export function addNdbcBuoyEntities(
  viewer: Cesium.Viewer,
  stations: NdbcStation[],
  readings: Map<string, NdbcReading[]>,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  stations.forEach((station) => {
    const stationReadings = readings.get(station.id);
    const latest = stationReadings?.[0];
    const ndbcPos = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0);

    // Determine color based on wave height
    let color = Cesium.Color.fromCssColorString('#3b82f6'); // Default blue
    let waveLabel = '';
    if (latest?.waveHeight) {
      if (latest.waveHeight >= 4) {
        color = Cesium.Color.fromCssColorString('#ef4444'); // Red - dangerous
        waveLabel = `⚠️ ${latest.waveHeight.toFixed(1)}m`;
      } else if (latest.waveHeight >= 2) {
        color = Cesium.Color.fromCssColorString('#f97316'); // Orange - rough
        waveLabel = `${latest.waveHeight.toFixed(1)}m`;
      } else {
        color = Cesium.Color.fromCssColorString('#22c55e'); // Green - calm
        waveLabel = `${latest.waveHeight.toFixed(1)}m`;
      }
    }

    // Create buoy billboard (wave icon)
    const buoyEnt = viewer.entities.add({
      position: ndbcPos,
      name: `${station.name} (${station.id})`,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color.toCssColorString()}"><circle cx="12" cy="12" r="8" stroke="white" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">⛵</text></svg>`),
        width: 20,
        height: 20,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `${station.id} ${waveLabel}`,
        font: '10px "Space Grotesk", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.4),
      },
      properties: {
        layer: 'ndbc_buoy',
        stationId: station.id,
        stationName: station.name,
        lat: station.lat,
        lon: station.lon,
        type: station.type,
        waveHeight: latest?.waveHeight,
        windSpeed: latest?.windSpeed,
        windDirection: latest?.windDirection,
        seaTemperature: latest?.seaTemperature,
        airTemperature: latest?.airTemperature,
        pressure: latest?.pressure,
        timestamp: latest?.timestamp,
      },
    });
    ents.push(buoyEnt);
  });

  viewer.scene.requestRender();
  return ents;
}

// ═══════════════════════════════════════════════════════════════════
// 3. USGS ShakeMap — Earthquake Intensity Contours
// ═══════════════════════════════════════════════════════════════════

interface ShakeMapEvent {
  id: string;
  title: string;
  magnitude: number;
  lat: number;
  lon: number;
  depth: number;
  mmi?: number;
  pga?: number;
  pgv?: number;
  alert?: string;
}

/** MMI color scale */
const MMI_COLORS: Record<number, Cesium.Color> = {
  1: Cesium.Color.fromCssColorString('#ffffff'),
  2: Cesium.Color.fromCssColorString('#ccffff'),
  3: Cesium.Color.fromCssColorString('#99ffcc'),
  4: Cesium.Color.fromCssColorString('#66ff66'),
  5: Cesium.Color.fromCssColorString('#ffff00'),
  6: Cesium.Color.fromCssColorString('#ffcc00'),
  7: Cesium.Color.fromCssColorString('#ff9900'),
  8: Cesium.Color.fromCssColorString('#ff6600'),
  9: Cesium.Color.fromCssColorString('#ff0000'),
  10: Cesium.Color.fromCssColorString('#cc0000'),
  11: Cesium.Color.fromCssColorString('#990066'),
  12: Cesium.Color.fromCssColorString('#660033'),
};

function getMmiColor(mmi: number): Cesium.Color {
  const rounded = Math.min(12, Math.max(1, Math.round(mmi)));
  return MMI_COLORS[rounded] || Cesium.Color.WHITE;
}

function getMmiLabel(mmi: number): string {
  if (mmi <= 2) return 'Not Felt/Weak';
  if (mmi <= 4) return 'Light';
  if (mmi <= 5) return 'Moderate';
  if (mmi <= 6) return 'Strong';
  if (mmi <= 7) return 'Very Strong';
  if (mmi <= 8) return 'Severe';
  if (mmi <= 9) return 'Violent';
  return 'Extreme';
}

/**
 * Render ShakeMap earthquake markers with intensity rings
 */
export function addShakeMapEntities(
  viewer: Cesium.Viewer,
  events: ShakeMapEvent[],
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  events.forEach((event) => {
    const shakemapPos = Cesium.Cartesian3.fromDegrees(event.lon, event.lat, 0);
    const color = event.mmi ? getMmiColor(event.mmi) : Cesium.Color.YELLOW;
    const mmiLabel = event.mmi ? getMmiLabel(event.mmi) : 'Unknown';

    // Epicenter marker (star)
    const epicenter = viewer.entities.add({
      position: shakemapPos,
      name: `${event.title} — M${event.magnitude.toFixed(1)}`,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color.toCssColorString()}"><polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9"/></svg>`),
        width: 28,
        height: 28,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `M${event.magnitude.toFixed(1)} — ${mmiLabel}`,
        font: 'bold 11px "Space Grotesk", sans-serif',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: {
        layer: 'shakemap',
        eventId: event.id,
        magnitude: event.magnitude,
        depth: event.depth,
        mmi: event.mmi,
        pga: event.pga,
        pgv: event.pgv,
        alert: event.alert,
        lat: event.lat,
        lon: event.lon,
      },
    });
    ents.push(epicenter);

    // Intensity rings (concentric circles based on magnitude)
    const ringRadii = [50000, 150000, 300000, 600000]; // 50km, 150km, 300km, 600km
    const ringMmi = [Math.max(1, event.mmi! - 3), Math.max(1, event.mmi! - 2), Math.max(1, event.mmi! - 1), event.mmi!];

    ringRadii.forEach((radius, idx) => {
      if (ringMmi[idx] < 2) return; // Don't show very low intensity rings

      const ringColor = getMmiColor(ringMmi[idx]);
      const ring = viewer.entities.add({
        position: shakemapPos,
        name: `Intensity ${ringMmi[idx]} — ${getMmiLabel(ringMmi[idx])}`,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: new Cesium.ColorMaterialProperty(ringColor.withAlpha(0.15)),
          outline: true,
          outlineColor: ringColor.withAlpha(0.6),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layer: 'shakemap_ring',
          eventId: event.id,
          mmi: ringMmi[idx],
          radius,
        },
      });
      ents.push(ring);
    });
  });

  viewer.scene.requestRender();
  return ents;
}

// ═══════════════════════════════════════════════════════════════════
// 4. NOAA SPC Convective Outlooks — Severe Weather Risk Areas
// ═══════════════════════════════════════════════════════════════════

interface SpcPolygon {
  properties: { DN: number };
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface SpcGeoJson {
  features: SpcPolygon[];
}

const SPC_CATEGORY_COLORS: Record<number, { color: Cesium.Color; label: string }> = {
  2: { color: Cesium.Color.fromCssColorString('#33cc33'), label: 'General Thunder' },
  3: { color: Cesium.Color.fromCssColorString('#009900'), label: 'Marginal Risk' },
  4: { color: Cesium.Color.fromCssColorString('#ffff00'), label: 'Slight Risk' },
  5: { color: Cesium.Color.fromCssColorString('#ff9900'), label: 'Enhanced Risk' },
  6: { color: Cesium.Color.fromCssColorString('#ff0000'), label: 'Moderate Risk' },
  8: { color: Cesium.Color.fromCssColorString('#ff00ff'), label: 'High Risk' },
};

/**
 * Render SPC convective outlook polygons on the globe
 */
export function addSpcOutlookEntities(
  viewer: Cesium.Viewer,
  geojson: SpcGeoJson,
  day: number = 1,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  if (!geojson?.features) return ents;

  // Process polygons from smallest (highest risk) to largest (lowest risk)
  // This ensures higher risk areas render on top
  const sorted = [...geojson.features].sort((a, b) => (b.properties?.DN || 0) - (a.properties?.DN || 0));

  sorted.forEach((feature) => {
    const dn = feature.properties?.DN || 0;
    const catInfo = SPC_CATEGORY_COLORS[dn];
    if (!catInfo) return;

    const coords = feature.geometry?.coordinates;
    if (!coords) return;

    // Extract polygon coordinates for Cesium
    const polygons = feature.geometry.type === 'MultiPolygon' ? coords : [coords];

    polygons.forEach((polygon: any) => {
      const ring = polygon[0]; // Outer ring
      if (!ring || ring.length < 3) return;

      // Convert GeoJSON [lon, lat] to Cesium positions
      const positions = ring.map((coord: number[]) =>
        Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
      );

      const ent = viewer.entities.add({
        name: `Day ${day} ${catInfo.label}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: catInfo.color.withAlpha(0.2),
          outline: true,
          outlineColor: catInfo.color.withAlpha(0.8),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layer: 'spc_outlook',
          day,
          category: dn,
          label: catInfo.label,
        },
      });
      ents.push(ent);
    });
  });

  viewer.scene.requestRender();
  return ents;
}

// ═══════════════════════════════════════════════════════════════════
// 5. OpenAQ Global Air Quality Stations
// ═══════════════════════════════════════════════════════════════════

interface OpenAQLocation {
  location: string;
  lat: number;
  lon: number;
  country: string;
  measurements: Array<{
    parameter: string;
    value: number;
    units: string;
    lastUpdated: string;
  }>;
}

/** AQI color scale (US EPA) */
function getAqiColor(aqi: number): Cesium.Color {
  if (aqi <= 50) return Cesium.Color.fromCssColorString('#22c55e');  // Good - Green
  if (aqi <= 100) return Cesium.Color.fromCssColorString('#eab308'); // Moderate - Yellow
  if (aqi <= 150) return Cesium.Color.fromCssColorString('#f97316'); // Unhealthy for Sensitive - Orange
  if (aqi <= 200) return Cesium.Color.fromCssColorString('#ef4444'); // Unhealthy - Red
  if (aqi <= 300) return Cesium.Color.fromCssColorString('#a855f7'); // Very Unhealthy - Purple
  return Cesium.Color.fromCssColorString('#7f1d1d'); // Hazardous - Maroon
}

function getAqiLabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy (Sensitive)';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

/**
 * Render OpenAQ air quality station markers
 */
export function addOpenaqEntities(
  viewer: Cesium.Viewer,
  stations: OpenAQLocation[],
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  stations.forEach((station) => {
    // Find PM2.5 measurement for AQI calculation
    const pm25 = station.measurements.find(m => m.parameter === 'pm25');
    const aqi = pm25 ? Math.round((pm25.value / 35.4) * 50) : 0; // Simple PM2.5 to AQI conversion
    const color = getAqiColor(aqi);
    const aqiLabel = getAqiLabel(aqi);

    const openaqPos = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0);

    const ent = viewer.entities.add({
      position: openaqPos,
      name: `${station.location} — AQI ${aqi}`,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color.toCssColorString()}"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="9" font-weight="bold">AQ</text></svg>`),
        width: 18,
        height: 18,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `AQI ${aqi}`,
        font: '10px "Space Grotesk", sans-serif',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.4),
      },
      properties: {
        layer: 'openaq',
        location: station.location,
        country: station.country,
        lat: station.lat,
        lon: station.lon,
        aqi,
        aqiLabel,
        pm25: pm25?.value,
        measurements: station.measurements,
      },
    });
    ents.push(ent);
  });

  viewer.scene.requestRender();
  return ents;
}

// ═══════════════════════════════════════════════════════════════════
// Utility: Remove all entities for a specific layer
// ═══════════════════════════════════════════════════════════════════

export function removeLayerEntities(viewer: Cesium.Viewer, layerName: string): void {
  const toRemove: Cesium.Entity[] = [];
  viewer.entities.values.forEach((entity) => {
    const layer = entity.properties?.getProperty('layer');
    if (layer === layerName) {
      toRemove.push(entity);
    }
  });
  toRemove.forEach((entity) => viewer.entities.remove(entity));
  viewer.scene.requestRender();
}
