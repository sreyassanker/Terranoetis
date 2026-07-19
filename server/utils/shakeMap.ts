/**
 * USGS ShakeMap Real-Time Earthquake Impact Assessment
 *
 * Provides near real-time maps of ground motion and shaking intensity
 * following significant earthquakes. Unlike basic earthquake epicenter data,
 * ShakeMap includes modeled peak ground acceleration (PGA), peak ground
 * velocity (PGV), and Modified Mercalli Intensity (MMI).
 *
 * Data source: USGS Earthquake Hazards Program
 * https://earthquake.usgs.gov/data/shakemap/
 */

import { logger } from '../observability/logger';

export interface ShakeMapEvent {
  id: string;
  title: string;
  magnitude: number;
  magType: string;
  time: number; // Unix timestamp ms
  lat: number;
  lon: number;
  depth: number; // km
  mmi?: number;  // Max Modified Mercalli Intensity
  pga?: number;  // Peak Ground Acceleration (%g)
  pgv?: number;  // Peak Ground Velocity (cm/s)
  felt?: number; // Number of "Did You Feel It?" reports
  alert?: string; // PAGER alert level: green, yellow, orange, red
  significance?: number;
  shakeMapUrl?: string;
  stationsUrl?: string;
  pAGER?: {
    alert: string;
    estimatedFatalities?: string;
    estimatedEconomicLosses?: string;
  };
}

export interface ShakeMapStation {
  stationId: string;
  lat: number;
  lon: number;
  network?: string;
  distance?: number; // km from epicenter
  pga?: number;
  pgv?: number;
  mmi?: number;
  siteClass?: string;
}


/**
 * Fetch recent earthquakes with ShakeMap data from USGS
 * Uses the detail endpoint which includes ShakeMap products
 */
export async function fetchRecentShakeMaps(
  minMagnitude: number = 4.5,
  limit: number = 20,
): Promise<ShakeMapEvent[]> {
  try {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=${minMagnitude}&orderby=time&limit=${limit}&includemagnitudes=true`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'USGS ShakeMap fetch failed');
      return [];
    }

    const data = await resp.json() as {
      features: Array<{
        id: string;
        properties: {
          mag: number;
          magType: string;
          place: string;
          time: number;
          updated: number;
          mmi?: number;
          pga?: number;
          pgv?: number;
          felt?: number;
          alert?: string;
          significance?: number;
          url?: string;
          detail?: string;
        };
        geometry: {
          coordinates: [number, number, number]; // [lon, lat, depth]
        };
      }>;
    };

    const events: ShakeMapEvent[] = [];

    for (const feature of (data.features || [])) {
      const p = feature.properties;
      const g = feature.geometry.coordinates;

      events.push({
        id: feature.id,
        title: p.place || 'Unknown Location',
        magnitude: p.mag || 0,
        magType: p.magType || 'mw',
        time: p.time || Date.now(),
        lat: g[1],
        lon: g[0],
        depth: g[2] || 0,
        mmi: p.mmi,
        pga: p.pga,
        pgv: p.pgv,
        felt: p.felt,
        alert: p.alert,
        significance: p.significance,
        shakeMapUrl: p.url,
      });
    }

    return events;
  } catch (e) {
    logger.warn({ err: e }, 'USGS ShakeMap fetch error');
    return [];
  }
}

/**
 * Fetch detailed ShakeMap data for a specific event
 * Returns station data with individual sensor readings
 */
export async function fetchShakeMapDetail(eventId: string): Promise<{
  event: ShakeMapEvent | null;
  stations: ShakeMapStation[];
}> {
  try {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${eventId}&format=geojson`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { event: null, stations: [] };

    const data = await resp.json() as {
      properties: {
        mag: number;
        magType: string;
        place: string;
        time: number;
        mmi?: number;
        pga?: number;
        pgv?: number;
        felt?: number;
        alert?: string;
        url?: string;
      };
      geometry: {
        coordinates: [number, number, number];
      };
    };

    const p = data.properties;
    const g = data.geometry.coordinates;

    const event: ShakeMapEvent = {
      id: eventId,
      title: p.place || 'Unknown',
      magnitude: p.mag,
      magType: p.magType || 'mw',
      time: p.time,
      lat: g[1],
      lon: g[0],
      depth: g[2] || 0,
      mmi: p.mmi,
      pga: p.pga,
      pgv: p.pgv,
      felt: p.felt,
      alert: p.alert,
      shakeMapUrl: p.url,
    };

    // Try to fetch station list
    const stations: ShakeMapStation[] = [];
    try {
      const stationUrl = `https://earthquake.usgs.gov/product/shakemap/${eventId}/download/stationlist.json`;
      const sResp = await fetch(stationUrl, { signal: AbortSignal.timeout(8000) });
      if (sResp.ok) {
        const sData = await sResp.json() as {
          stations?: Array<{
            stationId: string;
            lat: number;
            lon: number;
            network?: string;
            distance?: number;
            pga?: number;
            pgv?: number;
            mmi?: number;
            site?: string;
          }>;
        };
        for (const s of (sData.stations || [])) {
          stations.push({
            stationId: s.stationId,
            lat: s.lat,
            lon: s.lon,
            network: s.network,
            distance: s.distance,
            pga: s.pga,
            pgv: s.pgv,
            mmi: s.mmi,
            siteClass: s.site,
          });
        }
      }
    } catch {
      // Station data not available
    }

    return { event, stations };
  } catch (e) {
    logger.warn({ err: e, eventId }, 'ShakeMap detail fetch error');
    return { event: null, stations: [] };
  }
}

/**
 * Get MMI (Modified Mercalli Intensity) description
 */
export function getMmiDescription(mmi: number): string {
  const descriptions: Record<number, string> = {
    1: 'Not Felt',
    2: 'Weak',
    3: 'Weak',
    4: 'Light',
    5: 'Moderate',
    6: 'Strong',
    7: 'Very Strong',
    8: 'Severe',
    9: 'Violent',
    10: 'Extreme',
    11: 'Extreme',
    12: 'Extreme',
  };
  return descriptions[Math.round(mmi)] || 'Unknown';
}

/**
 * Get MMI color for visualization
 */
export function getMmiColor(mmi: number): string {
  if (mmi <= 1) return '#ffffff';
  if (mmi <= 2) return '#ccffff';
  if (mmi <= 3) return '#99ffcc';
  if (mmi <= 4) return '#66ff66';
  if (mmi <= 5) return '#ffff00';
  if (mmi <= 6) return '#ffcc00';
  if (mmi <= 7) return '#ff9900';
  if (mmi <= 8) return '#ff6600';
  if (mmi <= 9) return '#ff0000';
  if (mmi <= 10) return '#cc0000';
  if (mmi <= 11) return '#990066';
  return '#660033';
}

/**
 * Get PAGER alert description
 */
export function getPagerDescription(alert: string | undefined): string {
  switch (alert) {
    case 'green': return 'GREEN: Little or no damage';
    case 'yellow': return 'YELLOW: Some damage possible';
    case 'orange': return 'ORANGE: Moderate to heavy damage';
    case 'red': return 'RED: Heavy damage/fatality likely';
    default: return 'No PAGER assessment available';
  }
}

/**
 * Format earthquake for Sentinel engine consumption
 */
export function formatForSentinel(events: ShakeMapEvent[]): {
  avgMagnitude: number;
  maxMagnitude: number;
  eventCount: number;
  maxMmi: number;
  significantEvents: ShakeMapEvent[];
} {
  if (events.length === 0) {
    return { avgMagnitude: 0, maxMagnitude: 0, eventCount: 0, maxMmi: 0, significantEvents: [] };
  }

  const magnitudes = events.map(e => e.magnitude);
  const mmiValues = events.filter(e => e.mmi).map(e => e.mmi!);
  const significant = events.filter(e => e.magnitude >= 5.0 || (e.mmi && e.mmi >= 6));

  return {
    avgMagnitude: magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length,
    maxMagnitude: Math.max(...magnitudes),
    eventCount: events.length,
    maxMmi: mmiValues.length > 0 ? Math.max(...mmiValues) : 0,
    significantEvents: significant,
  };
}
