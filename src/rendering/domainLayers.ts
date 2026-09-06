/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import * as Cesium from 'cesium';

// --- REAL AIRSPACES (GeoJSON) ---
export async function loadAirspaces(viewer: Cesium.Viewer): Promise<Cesium.Entity[]> {
  try {
    const res = await fetch('/api/airspaces');
    if (!res.ok) throw new Error('Failed to fetch real airspace data.');
    
    const geojson = await res.json();
    const dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
      stroke: Cesium.Color.fromCssColorString('#00f2fe').withAlpha(0.6),
      fill: Cesium.Color.fromCssColorString('#00f2fe').withAlpha(0.1),
      strokeWidth: 2,
    });
    
    const entities: Cesium.Entity[] = [];
    for (let i = 0; i < dataSource.entities.values.length; i++) {
      const entity = dataSource.entities.values[i];
      entity.properties?.addProperty('layer', 'airspaces');
      entities.push(entity);
      viewer.entities.add(entity);
    }
    viewer.scene.requestRender();
    return entities;
  } catch (err) {
    console.error('Airspaces error:', err);
    throw err;
  }
}

// --- REAL AIS VESSELS ---
async function loadAisVessels(viewer: Cesium.Viewer, apiKey: string): Promise<Cesium.Entity[]> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('AISStream API Key required for real live vessels.');
  }

  // Normally we would open a WebSocket to wss://stream.aisstream.io/v0/stream
  // Since we only want to load a snapshot into the entity store to be pure "real data"
  // AISStream only provides a websocket. We will instantiate the websocket, listen for 5 seconds to collect live ships, 
  // and then close it for simplicity (or keep it open to update).
  
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const entities: Cesium.Entity[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      socket.close();
      if (entities.length === 0) reject(new Error('No vessels received from AISStream.'));
      else resolve(entities);
    }, 5000); // Wait 5 seconds to buffer live ships

    socket.onopen = () => {
      // Subscribe to all world bounding boxes
      const subMsg = {
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport"]
      };
      socket.send(JSON.stringify(subMsg));
    };

    socket.onmessage = (event) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.MessageType === "PositionReport" && msg.Message?.PositionReport) {
          const report = msg.Message.PositionReport;
          const lat = report.Latitude;
          const lon = report.Longitude;
          const mmsi = msg.MetaData?.MMSI || 'Unknown';
          
          if (typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon)) {
            const ship = viewer.entities.add({
              name: `Vessel MMSI: ${mmsi}`,
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
              billboard: {
                image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0ea5e9"><path d="M21 16.5l-9 4.5-9-4.5V7.5L12 3l9 4.5v9z"/></svg>`),
                width: 16,
                height: 16,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
              },
              properties: { ...report, layer: 'ais_vessels' }
            });
            entities.push(ship);
          }
        }
      } catch (err) {
        console.warn('AIS parse error:', err);
      }
    };

    socket.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      entities.forEach(e => viewer.entities.remove(e));
      reject(new Error('AISStream WebSocket error. Invalid API Key?'));
    };
  });
}

// --- Keplerian Solver for Space Debris ---
function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 5; i++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  return E;
}

function tleEpochToMs(epoch: string): number {
  const iso = new Date(epoch).getTime();
  if (!isNaN(iso)) return iso;
  const m = epoch.match(/^(\d{2})(\d{3})\.(\d+)$/);
  if (!m) return NaN;
  let yy = parseInt(m[1]);
  const doy = parseInt(m[2]);
  const frac = parseFloat(`0.${m[3]}`);
  if (yy >= 57) yy += 1900; else yy += 2000;
  return Date.UTC(yy, 0, doy + frac);
}

export function computeDebrisPosition(d: any, time: Cesium.JulianDate): Cesium.Cartesian3 {
  const epochTime = tleEpochToMs(d.epoch);
  const currentTime = Cesium.JulianDate.toDate(time).getTime();
  const dt = (currentTime - epochTime) / 1000; // seconds since epoch

  const GM = 3.986004418e14; // Earth GM (m^3/s^2)
  const Re = 6378137;        // Earth equatorial radius (m)
  const J2 = 1.08262668e-3;
  const a = d.semimajorAxis * 1000; // semi-major axis in meters
  const e = d.eccentricity;
  const i = d.inclination * Math.PI / 180;
  const omega0 = d.argOfPericenter * Math.PI / 180;
  const omegaAN0 = d.raOfAscNode * Math.PI / 180;
  const M0 = d.meanAnomaly * Math.PI / 180;

  // Mean motion (rad/s)
  const n = Math.sqrt(GM / (a * a * a));

  // J2 secular precession rates
  const j2fac = J2 * (Re / a) ** 2 / ((1 - e * e) ** 2);
  const omegaAN_dot = -1.5 * n * j2fac * Math.cos(i);
  const omega_dot = 0.75 * n * j2fac * (5 * Math.cos(i) ** 2 - 1);

  const omegaAN = omegaAN0 + omegaAN_dot * dt;
  const omega = omega0 + omega_dot * dt;

  const M = M0 + n * dt;
  const E = solveKepler(M, e);

  const cosV = (Math.cos(E) - e) / (1 - e * Math.cos(E));
  const sinV = (Math.sqrt(1 - e * e) * Math.sin(E)) / (1 - e * Math.cos(E));
  const v = Math.atan2(sinV, cosV);

  const r = a * (1 - e * Math.cos(E));

  const xOrb = r * Math.cos(v);
  const yOrb = r * Math.sin(v);

  const xI = xOrb * (Math.cos(omega) * Math.cos(omegaAN) - Math.sin(omega) * Math.sin(omegaAN) * Math.cos(i)) -
             yOrb * (Math.sin(omega) * Math.cos(omegaAN) + Math.cos(omega) * Math.sin(omegaAN) * Math.cos(i));
  const yI = xOrb * (Math.cos(omega) * Math.sin(omegaAN) + Math.sin(omega) * Math.cos(omegaAN) * Math.cos(i)) -
             yOrb * (Math.sin(omega) * Math.sin(omegaAN) - Math.cos(omega) * Math.cos(omegaAN) * Math.cos(i));
  const zI = xOrb * (Math.sin(omega) * Math.sin(i)) + yOrb * (Math.cos(omega) * Math.sin(i));

  const theta = 7.2921159e-5 * dt;
  const x = xI * Math.cos(theta) + yI * Math.sin(theta);
  const y = -xI * Math.sin(theta) + yI * Math.cos(theta);
  const z = zI;

  return new Cesium.Cartesian3(x, y, z);
}

export function getDebrisOrbitPositions(d: any, time: Cesium.JulianDate): Cesium.Cartesian3[] {
  const points: Cesium.Cartesian3[] = [];
  const GM = 3.986004418e14;
  const a = d.semimajorAxis * 1000;
  // Calculate period in seconds
  const period = 2 * Math.PI * Math.sqrt((a * a * a) / GM);
  
  // Sample 80 points to trace one full orbit
  for (let step = 0; step <= 80; step++) {
    const fraction = step / 80;
    const futureTime = Cesium.JulianDate.addSeconds(time, fraction * period, new Cesium.JulianDate());
    points.push(computeDebrisPosition(d, futureTime));
  }
  return points;
}

// 1. Render Space Debris — pre-sample orbital positions to avoid per-frame Kepler propagation
export function addSpaceDebrisEntities(viewer: Cesium.Viewer, debrisList: any[]): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const SAMPLE_INTERVAL = 5 * 60; // 5 minutes in seconds
  const SAMPLE_COUNT = 288; // 24 hours / 5 minutes = 288 samples
  const now = Cesium.JulianDate.now();

  debrisList.forEach((d) => {
    // Pre-sample positions at 5-minute intervals for 24 hours
    const sampledPosition = new Cesium.SampledPositionProperty();
    sampledPosition.setInterpolationOptions({
      interpolationDegree: 3,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });

    for (let step = 0; step <= SAMPLE_COUNT; step++) {
      const time = Cesium.JulianDate.addSeconds(now, step * SAMPLE_INTERVAL, new Cesium.JulianDate());
      const position = computeDebrisPosition(d, time);
      sampledPosition.addSample(time, position);
    }

    const ent = viewer.entities.add({
      position: sampledPosition,
      name: d.name,
      point: {
        pixelSize: 4,
        color: Cesium.Color.fromCssColorString('#a855f7').withAlpha(0.85),
        outlineColor: Cesium.Color.fromCssColorString('#e9d5ff').withAlpha(0.3),
        outlineWidth: 1,
      },
      properties: {
        layer: 'space_debris',
        id: d.id,
        name: d.name,
        epoch: d.epoch,
        meanMotion: d.meanMotion,
        eccentricity: d.eccentricity,
        inclination: d.inclination,
        raOfAscNode: d.raOfAscNode,
        argOfPericenter: d.argOfPericenter,
        meanAnomaly: d.meanAnomaly,
        semimajorAxis: d.semimajorAxis,
      }
    });

    ents.push(ent);
  });

  return ents;
}

// 2. Render NASA Deep Space Network Stations and Pulsing Beams
const DSN_STATIONS = [
  { id: 'gdscc', friendlyName: 'Goldstone (USA)', lat: 35.4267, lon: -116.8900 },
  { id: 'mdscc', friendlyName: 'Madrid (Spain)', lat: 40.4314, lon: -4.2496 },
  { id: 'cdscc', friendlyName: 'Canberra (Australia)', lat: -35.4014, lon: 148.9817 },
];

export function addNasaDsnEntities(viewer: Cesium.Viewer, dsnData: any): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const stations = dsnData.stations || [];

  DSN_STATIONS.forEach((stationDef) => {
    const serverStation = stations.find((s: any) => s.name?.toLowerCase() === stationDef.id);
    const friendlyName = serverStation?.friendlyName || stationDef.friendlyName;
    const dishes = serverStation?.dishes || [];

    const stationCartesian = Cesium.Cartesian3.fromDegrees(stationDef.lon, stationDef.lat);

    // Create Main Station Node
    const stationEnt = viewer.entities.add({
      position: stationCartesian,
      name: friendlyName,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23fbbf24" stroke="%23d97706" stroke-width="2"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7C9.23858 7 7 9.23858 7 12C7 14.7614 9.23858 17 12 17Z"/></svg>`),
        width: 32,
        height: 32,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: friendlyName,
        font: 'bold 11px "Inter", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: {
        layer: 'nasa_dsn',
        stationId: stationDef.id,
        friendlyName,
        dishes: dishes,
        isStation: true,
      }
    });
    ents.push(stationEnt);

    // Render active dishes and project communications beams
    dishes.forEach((dish: any, dishIdx: number) => {
      const isUp = dish.isUp;
      const targets = dish.targets || [];
      const azimuth = dish.azimuth || 0;
      const elevation = dish.elevation || 15; // default above horizon

      const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(stationCartesian);
      const azimuthRad = (azimuth * Math.PI) / 180;
      const elevationRad = (elevation * Math.PI) / 180;

      // Unit vector in local ENU pointing in the direction of the dish
      const localDir = new Cesium.Cartesian3(
        Math.sin(azimuthRad) * Math.cos(elevationRad),
        Math.cos(azimuthRad) * Math.cos(elevationRad),
        Math.sin(elevationRad)
      );

      // Rotate local unit vector to ECEF
      const ecefDir = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, localDir, new Cesium.Cartesian3());
      
      // Scale beam length (5000km to reach orbit and visually project into deep space)
      const beamLength = 4000000;
      const targetPos = Cesium.Cartesian3.add(
        stationCartesian,
        Cesium.Cartesian3.multiplyByScalar(ecefDir, beamLength, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );

      // Draw beautiful pulsing transmission beam polyline
      if (isUp && targets.length > 0) {
        const pulseMaterial = new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.6),
          glowPower: 0.3,
          taperPower: 0.8,
        });

        const beamEnt = viewer.entities.add({
          name: `${dish.name} [SAT] ${targets.map((t: any) => t.name).join(', ')}`,
          polyline: {
            positions: [stationCartesian, targetPos],
            width: 3.5,
            material: pulseMaterial,
          },
          properties: {
            layer: 'nasa_dsn',
            isBeam: true,
            dishName: dish.name,
            azimuth,
            elevation,
            windspeed: dish.windspeed,
            targets: targets,
          }
        });
        ents.push(beamEnt);
      }
    });
  });

  return ents;
}

// 3. Render Live Lightning Strikes
export function addLightningEntities(viewer: Cesium.Viewer, strikes: any[]): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const now = Date.now();

  strikes.forEach((strike, idx) => {
    const ageMs = now - strike.time;
    if (ageMs > 60000) return; // ignore older strikes

    const pos = Cesium.Cartesian3.fromDegrees(strike.lon, strike.lat);
    const height = 4000 + Math.random() * 2000; // Cloud height 4-6km
    const topPos = Cesium.Cartesian3.fromDegrees(strike.lon, strike.lat, height);

    // 1. Draw glowing vertical bolt
    const bolt = viewer.entities.add({
      position: pos,
      name: `Lightning Strike`,
      polyline: {
        positions: [pos, topPos],
        width: 3.0,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#fef08a'), // bright yellow glow
          glowPower: 0.45,
        }),
      },
      properties: {
        layer: 'lightning_strikes',
        id: strike.id,
        time: strike.time,
        lat: strike.lat,
        lon: strike.lon,
      }
    });
    ents.push(bolt);

    // 2. Draw ground ripple effect that expands and fades (1.6s animation)
    const strikeTime = Cesium.JulianDate.fromDate(new Date(strike.time));
    const baseRippleColor = Cesium.Color.fromCssColorString('#fef08a');
    const transparentRipple = baseRippleColor.withAlpha(0);
    const rippleDuration = 1.6;
    // Pre-compute 8 ripple frames to avoid per-frame Color allocation
    const RIPPLE_FRAMES = 8;
    const rippleColors: Cesium.Color[] = new Array(RIPPLE_FRAMES);
    for (let f = 0; f < RIPPLE_FRAMES; f++) {
      const opacity = Math.max(0, 0.7 - (f / RIPPLE_FRAMES) * rippleDuration * 0.45);
      rippleColors[f] = baseRippleColor.withAlpha(opacity);
    }

    const ringRadius = new Cesium.CallbackProperty((time) => {
      if (!time) return 0;
      const elapsed = Math.max(0, Cesium.JulianDate.secondsDifference(time, strikeTime));
      if (elapsed >= rippleDuration) return 0; // short-circuit after animation ends
      return 15000 + elapsed * 60000;
    }, false);

    const groundRipple = viewer.entities.add({
      position: pos,
      ellipse: {
        semiMajorAxis: ringRadius,
        semiMinorAxis: ringRadius,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty((time) => {
            if (!time) return transparentRipple;
            const elapsed = Math.max(0, Cesium.JulianDate.secondsDifference(time, strikeTime));
            if (elapsed >= rippleDuration) return transparentRipple;
            const frame = Math.min(Math.floor(elapsed / rippleDuration * RIPPLE_FRAMES), RIPPLE_FRAMES - 1);
            return rippleColors[frame];
          }, false)
        ),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        show: new Cesium.CallbackProperty((time) => {
          if (!time) return false;
          const elapsed = Cesium.JulianDate.secondsDifference(time, strikeTime);
          return elapsed >= 0 && elapsed < rippleDuration;
        }, false)
      },
      properties: {
        layer: 'lightning_strikes',
        isRipple: true,
      }
    });
    ents.push(groundRipple);
  });

  return ents;
}

// 4. Render Polar Auroral Oval
export function addAuroraEntities(viewer: Cesium.Viewer, auroraData: any): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const coordinates = auroraData.coordinates || [];

  coordinates.forEach((pt: any) => {
    const prob = pt.prob || 0;
    if (prob < 15) return;

    // Render a high-altitude floating glowing point representation of the aurora
    // Auroral glow sits between 90km and 160km altitude
    const height = 95000 + (prob * 600); 
    const pos = Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, height);

    // Map probability to aurora colors: Green (common) to Red (high probability/altitude)
    const color = prob > 55 
      ? Cesium.Color.fromCssColorString('#f87171').withAlpha(prob / 130) // Red Aurora
      : Cesium.Color.fromCssColorString('#4ade80').withAlpha(prob / 150); // Green Aurora

    const point = viewer.entities.add({
      position: pos,
      name: `Aurora Forecast (Prob: ${prob}%)`,
      point: {
        pixelSize: 5 + (prob * 0.08),
        color: color,
        outlineColor: Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.05),
        outlineWidth: 1,
      },
      properties: {
        layer: 'aurora_oval',
        probability: prob,
        lat: pt.lat,
        lon: pt.lon,
      }
    });

    ents.push(point);
  });

  return ents;
}

// 5. Render Global Submarine Cables (GeoJSON)
const submarineCablesSourceRef = new WeakMap<Cesium.Viewer, Cesium.GeoJsonDataSource>();

export async function loadSubmarineCablesDataSource(viewer: Cesium.Viewer, cablesGeoJson: any): Promise<Cesium.GeoJsonDataSource> {
  // Remove previous data source to prevent accumulation
  const prev = submarineCablesSourceRef.get(viewer);
  if (prev) {
    viewer.dataSources.remove(prev);
  }

  const ds = await Cesium.GeoJsonDataSource.load(cablesGeoJson, {
    stroke: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.7),
    strokeWidth: 2.5,
    clampToGround: true,
  });

  // Apply custom glow material styling to the GeoJSON polyline entities
  for (const ent of ds.entities.values) {
    if (ent.polyline) {
      ent.polyline.material = new Cesium.PolylineGlowMaterialProperty({
        color: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.85),
        glowPower: 0.35,
      });
      ent.polyline.width = new Cesium.ConstantProperty(3.5);
    }
    
    // Tag entities with the layer id and keep ONLY the real fields the
    // TeleGeography cable-geo API actually returns. No invented capacity,
    // owners, or landing-point embellishments are ever attached.
    const originalProps = ent.properties;
    const realName = typeof originalProps?.name?.getValue === 'function' ? originalProps.name.getValue() : undefined;
    const realId = typeof originalProps?.id?.getValue === 'function' ? originalProps.id.getValue() : undefined;
    ent.properties = new Cesium.PropertyBag({
      layer: 'submarine_cables',
      name: realName || 'Undersea Fiber Cable',
      cable_id: realId ?? null,
      source: 'TeleGeography cable-geo API',
    });
  }

  viewer.dataSources.add(ds);
  submarineCablesSourceRef.set(viewer, ds);
  return ds;
}

// 6. Render Carbon Grid Zones
function intensityColor(intensity: number): Cesium.Color {
  if (intensity < 100) return Cesium.Color.fromCssColorString('#22c55e'); // Green
  if (intensity < 250) return Cesium.Color.fromCssColorString('#84cc16'); // Lime green
  if (intensity < 400) return Cesium.Color.fromCssColorString('#eab308'); // Yellow
  if (intensity < 600) return Cesium.Color.fromCssColorString('#f97316'); // Orange
  return Cesium.Color.fromCssColorString('#ef4444'); // Red
}

export function addElectricityGridEntities(viewer: Cesium.Viewer, gridZones: any[]): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  for (const zone of gridZones) {
    // Honest render: only zones with a real reported intensity are drawn.
    const intensity = Number(zone.intensity);
    if (!Number.isFinite(intensity)) continue;
    const color = intensityColor(intensity);
    
    // Scale column height based on carbon intensity (e.g. 500km max column)
    const height = Math.max(100000, intensity * 900);
    const radius = 95000; // 95km radius cylinder

    const centerPos = Cesium.Cartesian3.fromDegrees(zone.lon, zone.lat);

    const column = viewer.entities.add({
      position: centerPos,
      name: `${zone.name} Grid Footprint`,
      cylinder: {
        length: height,
        topRadius: radius,
        bottomRadius: radius,
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.65)),
        outline: true,
        outlineColor: color.withAlpha(0.9),
        outlineWidth: 1.5,
      },
      label: {
        text: `${zone.id}: ${intensity}g`,
        font: 'bold 10px "Inter", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2.5,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 8e6, 0.45),
      },
      properties: {
        layer: 'electricity_grid',
        id: zone.id,
        name: zone.name,
        intensity,
        lat: zone.lat,
        lon: zone.lon,
      }
    });

    ents.push(column);
  }

  return ents;
}

/**
 * Ground-clamped ring (polyline, clamped to terrain) — the supported way to
 * draw an outline on terrain. Entity *geometry* outlines (ellipse/rectangle)
 * are not supported when terrain-clamped, so disc layers draw their ring as
 * a separate clamped polyline instead of geometry `outline`.
 */
export function addGroundClampedRing(
  viewer: Cesium.Viewer,
  lon: number,
  lat: number,
  radiusM: number,
  color: Cesium.Color,
  layerId: string,
  width = 1.5,
): Cesium.Entity {
  const steps = 72;
  const positions = new Array<Cesium.Cartesian3>(steps + 1);
  const mPerDeg = 111320;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.15);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    positions[i] = Cesium.Cartesian3.fromDegrees(
      lon + (Math.sin(a) * radiusM) / (mPerDeg * cosLat),
      lat + (Math.cos(a) * radiusM) / mPerDeg,
      0,
    );
  }
  return viewer.entities.add({
    polyline: {
      positions,
      width,
      clampToGround: true,
      material: color,
    },
    properties: { layer: layerId },
  });
}

// 6b. Render EU Gas Storage (GIE AGSI+ real storage levels)
export function addEuGasStorageEntities(viewer: Cesium.Viewer, countries: any[]): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const volumes = countries.map((c) => Number(c.workingGasVolume) || 0).filter((v) => v > 0);
  const maxVol = volumes.length ? Math.max(...volumes) : 1;

  for (const c of countries) {
    const lat = Number(c.lat);
    const lon = Number(c.lon);
    const fillPct = Number(c.fillPct);
    const vol = Number(c.workingGasVolume) || 0;
    // Only real, finite readings are drawn.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(fillPct)) continue;
    // 0% full → red (supply risk), 100% → green (storage secure).
    const hue = 120 * Math.min(1, Math.max(0, fillPct / 100));
    const color = Cesium.Color.fromHsl(hue / 360, 0.8, 0.45);
    const radius = 60000 + Math.sqrt(vol / Math.max(maxVol, 1)) * 200000;
    // Flat disc just above the ground (RELATIVE_TO_GROUND with a defined
    // height) — terrain-following without the clamped-geometry warnings,
    // plus a ground-clamped polyline ring for the edge.
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      name: `${c.name || c.countryCode} — ${fillPct}% full`, // e.g. "Austria — 81% full"
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color.withAlpha(0.4),
        height: 2,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      },
      label: {
        text: `${c.countryCode}: ${fillPct}%`,
        font: 'bold 10px "Inter", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2.5,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 8e6, 0.5),
      },
      properties: {
        layer: 'eu_gas_storage',
        countryCode: c.countryCode,
        name: c.name,
        fillPct,
        gasInStorage: c.gasInStorage,
        workingGasVolume: vol,
        gasDayStart: c.gasDayStart || null,
        status: c.status || '',
        lat,
        lon,
        source: c.source || 'GIE AGSI+',
      },
    });
    ents.push(ent);
    ents.push(addGroundClampedRing(viewer, lon, lat, radius, color.withAlpha(0.9), 'eu_gas_storage', 1.5));
  }
  return ents;
}

// 7. Render Animal Migrations
export function addAnimalMigrationEntities(viewer: Cesium.Viewer, migrations: any[]): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];

  migrations.forEach((m) => {
    const pathCoords = m.path || [];
    if (pathCoords.length < 2) return;

    const cartesians = pathCoords.map((coord: [number, number]) => Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 150));

    // 1. Draw migration track ribbon
    const track = viewer.entities.add({
      name: `${m.animalId} Route`,
      polyline: {
        positions: cartesians,
        width: 3.0,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.7),
          glowPower: 0.25,
        })
      },
      properties: {
        layer: 'animal_migrations',
        animalId: m.animalId,
        species: m.species,
        isTrack: true,
      }
    });
    ents.push(track);

    // 2. Put a moving/pulsing dot on the animal's last known coordinate
    const lastCoord = pathCoords[pathCoords.length - 1];
    const marker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lastCoord[0], lastCoord[1], 200),
      name: `${m.animalId} (${m.species})`,
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23f59e0b" stroke="%237c2d12" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`),
        width: 18,
        height: 18,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: m.animalId,
        font: '10px "Inter", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000000),
      },
      properties: {
        layer: 'animal_migrations',
        animalId: m.animalId,
        species: m.species,
        path: pathCoords,
        lat: lastCoord[1],
        lon: lastCoord[0],
        isMarker: true,
      }
    });
    ents.push(marker);
  });

  return ents;
}
