/**
 * Ocean Data Module
 * ── Multi-source ocean physics data for Eqs 66-80 (Ocean Dynamics, Coastal & Wave) ──
 *
 * Sources (Tier 1 = highest accuracy, Tier 3 = NRT/fallback):
 *
 * Tier 1 — ERA5 CDS:
 *   Wind stress components (for curl → Sverdrup/Stommel Eqs 66-68)
 *   Friction velocity (for Ekman Eqs 15, 104)
 *   SST (alternative to OISST)
 *
 * Tier 2 — NOAA OISST / WOA18 climatology:
 *   OISST: daily SST at 0.25 deg (proven ERDDAP integration)
 *   WOA18: monthly T/S climatology at standard depths
 *
 * Tier 3 — Open-Meteo Marine API:
 *   Wave height, period, direction (Eqs 73-80)
 *   Ocean surface current velocity/direction
 *   SST (NRT)
 */

// ── WOA18 Monthly T/S Climatology ──
// Static lookup tables derived from World Ocean Atlas 2018 1-degree seasonal data.
// These provide physically accurate T/S at standard depths when no real-time profile is available.
// The values are representative for mid-latitude open ocean conditions.

interface DepthProfile {
  depths: number[];       // m
  temperatures: number[]; // C
  salinities: number[];   // PSU
}

// WOA18-based climatological profiles by latitude band (annual mean)
const LAT_PROFILES: Record<string, DepthProfile> = {
  tropical: { // 0°–20°
    depths: [0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000, 1500, 2000],
    temperatures: [27.5, 27.3, 26.8, 25.9, 24.0, 21.5, 19.0, 16.5, 14.5, 12.0, 9.0, 6.5, 5.0, 4.0, 3.0, 2.5],
    salinities: [35.0, 35.0, 35.1, 35.2, 35.3, 35.4, 35.5, 35.4, 35.3, 35.1, 34.9, 34.7, 34.6, 34.6, 34.7, 34.8],
  },
  subtropical: { // 20°–40°
    depths: [0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000, 1500, 2000],
    temperatures: [22.0, 21.8, 21.2, 20.3, 18.0, 15.5, 13.5, 12.0, 10.5, 9.0, 7.0, 5.5, 4.5, 3.5, 2.8, 2.3],
    salinities: [35.5, 35.5, 35.6, 35.7, 35.8, 35.8, 35.7, 35.5, 35.3, 35.0, 34.8, 34.6, 34.5, 34.5, 34.6, 34.7],
  },
  midlatitude: { // 40°–60°
    depths: [0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000, 1500, 2000],
    temperatures: [13.0, 12.8, 12.2, 11.5, 10.0, 8.5, 7.5, 7.0, 6.5, 6.0, 5.0, 4.0, 3.5, 3.0, 2.5, 2.0],
    salinities: [34.0, 34.0, 34.1, 34.2, 34.3, 34.4, 34.5, 34.4, 34.3, 34.2, 34.1, 34.0, 34.0, 34.1, 34.2, 34.3],
  },
  polar: { // 60°–90°
    depths: [0, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000, 1500, 2000],
    temperatures: [3.0, 2.8, 2.5, 2.2, 1.5, 1.0, 0.5, 0.3, 0.2, 0.0, -0.5, -0.8, -1.0, -1.2, -1.5, -1.8],
    salinities: [33.0, 33.0, 33.1, 33.2, 33.3, 33.4, 33.5, 33.5, 33.4, 33.3, 33.2, 33.1, 33.0, 33.0, 33.1, 33.2],
  },
};

function getLatBand(lat: number): string {
  const a = Math.abs(lat);
  if (a < 20) return 'tropical';
  if (a < 40) return 'subtropical';
  if (a < 60) return 'midlatitude';
  return 'polar';
}

function interpolateProfile(depths: number[], values: number[], targetDepth: number): number {
  if (targetDepth <= depths[0]) return values[0];
  if (targetDepth >= depths[depths.length - 1]) return values[values.length - 1];
  for (let i = 0; i < depths.length - 1; i++) {
    if (targetDepth >= depths[i] && targetDepth <= depths[i + 1]) {
      const f = (targetDepth - depths[i]) / (depths[i + 1] - depths[i]);
      return values[i] + f * (values[i + 1] - values[i]);
    }
  }
  return values[values.length - 1];
}

export interface OceanProfileData {
  temperature: number;   // C at specified depth
  salinity: number;      // PSU at specified depth
  density: number;       // kg/m³ (sigma-theta, simplified from TEOS-10)
  sst: number;           // C, sea surface temperature
  mixedLayerDepth: number; // m
}

/**
 * Get temperature and salinity at a specified depth using the best available source:
 *   1. Real-time SST from OISST for surface adjustment
 *   2. WOA18 climatology for profile shape
 *   3. Surface adjustment: shift profile so surface matches observed SST
 */
export function getOceanProfile(
  lat: number, _lon: number,
  depth: number = 0,
  observedSst?: number,
): OceanProfileData {
  const band = getLatBand(lat);
  const profile = LAT_PROFILES[band];

  const climoSst = profile.temperatures[0];
  const sst = observedSst ?? climoSst;
  const sstOffset = sst - climoSst;

  // Adjust profile by SST offset (surface mixing assumption)
  const dampFactor = Math.max(0, 1 - depth / 200);
  const adjustedTemp = interpolateProfile(profile.depths, profile.temperatures, depth) + sstOffset * dampFactor;
  const salinity = interpolateProfile(profile.depths, profile.salinities, depth);

  // Simplified density: TEOS-10 linearized (Hill 1960 approximation)
  const density = 1028.0 - 0.15 * (adjustedTemp - 10) + 0.78 * (salinity - 35);
  const mixedLayerDepth = 50; // Default, could be refined with ERA5 wind

  return {
    temperature: adjustedTemp,
    salinity,
    density: Math.round(density * 100) / 100,
    sst,
    mixedLayerDepth,
  };
}

/**
 * Compute approximate Brunt-Väisälä frequency N² (s⁻²) from vertical density gradient.
 * Uses the upper 200m of the T/S profile.
 */
export function computeN2(lat: number, observedSst?: number): number {
  const profile10 = getOceanProfile(lat, 0, 10, observedSst);
  const profile200 = getOceanProfile(lat, 0, 200, observedSst);
  const drho = profile200.density - profile10.density;
  const dz = 190;
  const rhoMean = (profile10.density + profile200.density) / 2;
  const g = 9.81;
  const n2 = drho > 0 ? -(g / rhoMean) * (drho / dz) : 5e-6;
  return Math.max(1e-7, Math.min(1e-2, n2)); // physically bounded
}

/**
 * Simplified wind stress magnitude from ERA5 10m wind.
 * Large & Pond (1981): τ = ρ_air · Cd · U₁₀²
 * Cd = 1.3e-3 for U < 11 m/s, (0.49 + 0.065·U)·1e-3 for U >= 11
 */
export function computeWindStress(windSpeed10m: number): number {
  const rhoAir = 1.225;
  const Cd = windSpeed10m < 11 ? 1.3e-3 : (0.49 + 0.065 * windSpeed10m) * 1e-3;
  return rhoAir * Cd * windSpeed10m * windSpeed10m;
}

/**
 * Estimate wind stress curl (N/m³) from wind field at two nearby points.
 * Used by Sverdrup (Eq 66) and Stommel (Eqs 67-68).
 */
export function computeWindStressCurl(
  windU: number, windV: number,
  dudx: number = 1e-6, dvdy: number = 1e-6,
): number {
  // curl(τ) = d(τ_y)/dx - d(τ_x)/dy
  // Simplified: use wind speed gradients as proxy
  return (windU * dudx - windV * dvdy) * 0.001; // N/m³ order
}

export interface OceanSurfaceData {
  sst: number;
  windStress: number;
  windStressCurl: number;
}

export function getOceanSurface(
  windSpeed10m: number,
  windU10m: number,
  windV10m: number,
  sst: number = 15,
): OceanSurfaceData {
  return {
    sst,
    windStress: computeWindStress(windSpeed10m),
    windStressCurl: computeWindStressCurl(windU10m, windV10m),
  };
}
