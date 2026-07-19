import * as Cesium from 'cesium';

export interface UcsSatellite {
  noradId: number;
  name: string;
  country: string;
  operator: string;
  users: string;
  purpose: string;
  detailedPurpose: string;
  orbitClass: string;
  orbitType: string;
  perigee: number;
  apogee: number;
  eccentricity: number;
  inclination: number;
  period: number;
  longitudeOfGEO: number;
  launchMass: number;
  power: number;
  launchDate: string;
  expectedLifetime: string;
  contractor: string;
  launchSite: string;
  launchVehicle: string;
  cosparNumber: string;
}

const ucsData = new Map<number, UcsSatellite>();


export function getUcsForNorad(noradId: number): UcsSatellite | undefined {
  return ucsData.get(noradId);
}

export async function fetchAndStoreUcsData(
  apiGet: <T>(path: string) => Promise<T>,
  progressCallback?: (count: number) => void,
): Promise<UcsSatellite[]> {
  const raw = await apiGet<Record<string, unknown>[]>('/ucs-satellites');
  const parsed: UcsSatellite[] = [];
  ucsData.clear();
  for (const row of raw) {
    const noradId = Number(row['NORAD Number'] ?? row['norad_cat_id'] ?? 0);
    if (!noradId) continue;
    const sat: UcsSatellite = {
      noradId,
      name: String(row['Name of Satellite, Alternate Names'] || row['Current Official Name of Satellite'] || ''),
      country: String(row['Country/Org of UN Registry'] || ''),
      operator: String(row['Operator/Owner'] || ''),
      users: String(row['Users'] || ''),
      purpose: String(row['Purpose'] || ''),
      detailedPurpose: String(row['Detailed Purpose'] || ''),
      orbitClass: String(row['Class of Orbit'] || ''),
      orbitType: String(row['Type of Orbit'] || ''),
      perigee: Number(row['Perigee (km)'] || 0),
      apogee: Number(row['Apogee (km)'] || 0),
      eccentricity: Number(row['Eccentricity'] || 0),
      inclination: Number(row['Inclination (degrees)'] || 0),
      period: Number(row['Period (minutes)'] || 0),
      longitudeOfGEO: Number(row['Longitude of GEO (degrees)'] || 0),
      launchMass: Number(row['Launch Mass (kg.)'] || 0),
      power: Number(row['Power (watts)'] || 0),
      launchDate: String(row['Date of Launch'] || ''),
      expectedLifetime: String(row['Expected Lifetime (yrs.)'] || ''),
      contractor: String(row['Contractor'] || ''),
      launchSite: String(row['Launch Site'] || ''),
      launchVehicle: String(row['Launch Vehicle'] || ''),
      cosparNumber: String(row['COSPAR Number'] || ''),
    };
    ucsData.set(sat.noradId, sat);
    parsed.push(sat);
  }
  progressCallback?.(parsed.length);
  return parsed;
}

const EARTH_RADIUS_KM = 6371;
const GM = 3.986004418e14;

function ucsColorByPurpose(purpose: string): Cesium.Color {
  const p = purpose.toLowerCase();
  if (p.includes('communic')) return Cesium.Color.fromCssColorString('#3b82f6');
  if (p.includes('earth') || p.includes('observ')) return Cesium.Color.fromCssColorString('#22c55e');
  if (p.includes('navig') || p.includes('gps')) return Cesium.Color.fromCssColorString('#eab308');
  if (p.includes('milit') || p.includes('recon') || p.includes('spy')) return Cesium.Color.fromCssColorString('#ef4444');
  if (p.includes('scienc') || p.includes('research')) return Cesium.Color.fromCssColorString('#a855f7');
  if (p.includes('weath') || p.includes('meteor')) return Cesium.Color.fromCssColorString('#06b6d4');
  if (p.includes('space') || p.includes('debris') || p.includes('situat')) return Cesium.Color.fromCssColorString('#f97316');
  return Cesium.Color.fromCssColorString('#94a3b8');
}

const UCS_EPOCH_MS = Date.now();

function ucsComputePosition(sat: UcsSatellite, time: Cesium.JulianDate): Cesium.Cartesian3 {
  const currentMs = Cesium.JulianDate.toDate(time).getTime();
  const dt = (currentMs - UCS_EPOCH_MS) / 1000;

  const a = ((sat.perigee + sat.apogee) / 2 + EARTH_RADIUS_KM) * 1000;
  const ecc = sat.eccentricity || 0.001;
  const incRad = (sat.inclination || 0) * Math.PI / 180;

  const noradHash = (sat.noradId * 2654435761) >>> 0;
  const raan = ((noradHash % 360) / 360) * 2 * Math.PI;
  const argPerigee = ((noradHash * 7 % 360) / 360) * 2 * Math.PI;
  const meanAnomaly0 = ((noradHash * 13 % 360) / 360) * 2 * Math.PI;

  const n = Math.sqrt(GM / (a * a * a));
  const M = meanAnomaly0 + n * dt;

  let E = M;
  for (let i = 0; i < 5; i++) E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));

  const cosV = (Math.cos(E) - ecc) / (1 - ecc * Math.cos(E));
  const sinV = (Math.sqrt(1 - ecc * ecc) * Math.sin(E)) / (1 - ecc * Math.cos(E));
  const v = Math.atan2(sinV, cosV);
  const r = a * (1 - ecc * Math.cos(E));

  const xOrb = r * Math.cos(v);
  const yOrb = r * Math.sin(v);

  const cosO = Math.cos(argPerigee);
  const sinO = Math.sin(argPerigee);
  const cosR = Math.cos(raan);
  const sinR = Math.sin(raan);
  const cosI = Math.cos(incRad);
  const sinI = Math.sin(incRad);

  const xI = xOrb * (cosO * cosR - sinO * sinR * cosI) - yOrb * (sinO * cosR + cosO * sinR * cosI);
  const yI = xOrb * (cosO * sinR + sinO * cosR * cosI) - yOrb * (sinO * sinR - cosO * cosR * cosI);
  const zI = xOrb * (sinO * sinI) + yOrb * (cosO * sinI);

  const theta = 7.2921159e-5 * dt;
  const x = xI * Math.cos(theta) + yI * Math.sin(theta);
  const y = -xI * Math.sin(theta) + yI * Math.cos(theta);
  const z = zI;

  return new Cesium.Cartesian3(x, y, z);
}

export function addUcsEntities(viewer: Cesium.Viewer): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  if (ucsData.size === 0) return ents;

  const now = Cesium.JulianDate.now();

  ucsData.forEach((sat) => {
    const isGeo = sat.orbitClass === 'GEO' && sat.longitudeOfGEO !== 0;
    let position: Cesium.PositionProperty;

    if (isGeo) {
      position = Cesium.Cartesian3.fromDegrees(
        sat.longitudeOfGEO, 0, 35786000,
      ) as unknown as Cesium.PositionProperty;
    } else {
      const sampledPosition = new Cesium.SampledPositionProperty();
      sampledPosition.setInterpolationOptions({
        interpolationDegree: 3,
        interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
      });
      for (let step = 0; step <= 72; step++) {
        const t = Cesium.JulianDate.addSeconds(now, step * 600, new Cesium.JulianDate());
        sampledPosition.addSample(t, ucsComputePosition(sat, t));
      }
      position = sampledPosition as unknown as Cesium.PositionProperty;
    }

    const ent = viewer.entities.add({
      position,
      name: sat.name,
      point: {
        pixelSize: 3,
        color: ucsColorByPurpose(sat.purpose),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
        outlineWidth: 0.5,
        heightReference: Cesium.HeightReference.NONE,
        scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.5, 1.5e8, 0.2),
      },
      properties: {
        layer: 'ucs_satellite_db',
        noradId: sat.noradId,
        name: sat.name,
        purpose: sat.purpose,
        country: sat.country,
        operator: sat.operator,
        users: sat.users,
        orbitClass: sat.orbitClass,
        launchDate: sat.launchDate,
      },
    });
    ents.push(ent);
  });

  return ents;
}
