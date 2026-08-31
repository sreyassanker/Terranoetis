/**
 * Loads real platform data layers into DuckDB tables.
 * Each layer fetches from the live backend and normalises its rows
 * so geospatial queries (lat/lon filtering, distance, bounding-box)
 * work out of the box.
 */

import { registerTable } from './duckdbAnalytics';

type LayerDef = {
  id: string;
  label: string;
  fetch: (authHeaders: Record<string, string>) => Promise<Array<Record<string, unknown>>>;
};

const AUTH = (): Record<string, string> => {
  const t = (window as unknown as Record<string, unknown>).__AUTH_TOKEN__;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function fetchJson(url: string, auth?: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', ...auth } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export const LAYERS: LayerDef[] = [
  {
    id: 'earthquakes',
    label: 'Earthquakes (USGS)',
    fetch: async () => {
      const d = await fetchJson('/api/earthquakes') as { features?: Array<Record<string, unknown>> };
      const eqs = d.features ?? [];
      // USGS GeoJSON: each feature has {geometry:{coordinates:[lon,lat,depth]}, properties:{mag,place,time,...}}
      return eqs.map((f) => {
        const g = f.geometry as Record<string, unknown> | undefined;
        const coords = (g?.coordinates as number[]) ?? [];
        const props = f.properties as Record<string, unknown> ?? {};
        return {
          id: String(props.id ?? ''),
          mag: props.mag,
          place: props.place,
          time: props.time,
          depth: coords[2] ?? 0,
          lat: coords[1] ?? 0,
          lon: coords[0] ?? 0,
          url: props.url,
          status: props.status,
          tsunami: props.tsunami,
          sig: props.sig,
          felt: props.felt,
          cdi: props.cdi,
          mmi: props.mmi,
          alert: props.alert,
          magType: props.magType,
          nst: props.nst,
          dmin: props.dmin,
          gap: props.gap,
          rms: props.rms,
          updated: props.updated,
        };
      });
    },
  },
  {
    id: 'flights',
    label: 'Flights (ADS-B)',
    fetch: async () => {
      const d = await fetchJson('/api/flights/all') as { states?: unknown[][] };
      const states = d.states ?? [];
      // OpenSky format: [icao24, callsign, origin, time_position, last_contact, lon, lat, baro_altitude, velocity, true_track, vertical_rate, squawk, spi, position_source, category]
      return states.map((s) => {
        const [icao24, callsign, origin, , , lon, lat, baroAlt, velocity, trueTrack, vertRate, squawk, _spi, posSource, category] = s as unknown[];
        return {
          icao24: String(icao24 ?? ''),
          callsign: String(callsign ?? '').trim(),
          origin: String(origin ?? ''),
          lat: Number(lat) || 0,
          lon: Number(lon) || 0,
          baroAltitude: Number(baroAlt) || 0,
          velocity: Number(velocity) || 0,
          trueTrack: Number(trueTrack) || 0,
          verticalRate: Number(vertRate) || 0,
          squawk: String(squawk ?? ''),
          positionSource: Number(posSource) || 0,
          category: Number(category) || 0,
        };
      });
    },
  },
  {
    id: 'satellites',
    label: 'Satellites (CelesTrak)',
    fetch: async () => {
      const d = await fetchJson('/api/satellites/tle') as Array<Record<string, unknown>>;
      // The TLE endpoint returns an array of {id, name, lat, lon, altitude, inclination, meanMotion, ...}
      return d.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        altitude: s.altitude,
        inclination: s.inclination,
        meanMotion: s.meanMotion,
        source: s.source,
        hasTle: s.hasTle,
        orbitClass: s.orbitClass,
        country: s.country,
        purpose: s.purpose,
      }));
    },
  },
  {
    id: 'radio_stations',
    label: 'Radio Stations',
    fetch: async (auth) => {
      const d = await fetchJson('/api/data/radio_stations', auth) as { items?: Array<Record<string, unknown>> };
      const items = d.items ?? [];
      return items.map((r) => ({
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        url: r.url,
        codec: r.codec,
        bitrate: r.bitrate,
        tags: r.tags,
        stationuuid: r.stationuuid,
        favicon: r.favicon,
        source: r.source,
      }));
    },
  },
  {
    id: 'cctv',
    label: 'CCTV Cameras',
    fetch: async () => {
      const d = await fetchJson('/api/cctv/worldwide') as { items?: Array<Record<string, unknown>> };
      const items = d.items ?? [];
      return items.map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lon: c.lon,
        city: c.city,
        region: c.region,
        country: c.country,
        source: c.source,
        category: c.category,
        pageUrl: c.pageUrl,
        previewUrl: c.previewUrl,
      }));
    },
  },
  {
    id: 'weather_alerts',
    label: 'Weather Alerts (NWS)',
    fetch: async () => {
      const d = await fetchJson('/api/weather/alerts') as { features?: Array<Record<string, unknown>> };
      const feats = d.features ?? [];
      return feats.map((f) => {
        const props = f.properties as Record<string, unknown> ?? {};
        return {
          id: props.id,
          areaDesc: props.areaDesc,
          event: props.event,
          headline: props.headline,
          severity: props.severity,
          urgency: props.urgency,
          status: props.status,
          messageType: props.messageType,
          categories: props.categories,
          effective: props.effective,
          expires: props.expires,
          senderName: props.senderName,
        };
      });
    },
  },
  {
    id: 'eonet',
    label: 'EONET Events (NASA)',
    fetch: async () => {
      const d = await fetchJson('/api/eonet') as { events?: Array<Record<string, unknown>> };
      const events = d.events ?? [];
      return events.flatMap((ev) => {
        const cats = (ev.categories as Array<Record<string, unknown>> ?? []).map((c) => String(c.title ?? '')).join('; ');
        const geoms = (ev.geometry as Array<Record<string, unknown>> ?? []);
        return geoms.map((g) => {
          const coords = (g.coordinates as number[]) ?? [];
          return {
            id: ev.id,
            title: ev.title,
            description: String(ev.description ?? '').slice(0, 500),
            category: cats,
            closed: ev.closed,
            geomType: g.type,
            lat: coords[1] ?? 0,
            lon: coords[0] ?? 0,
            magnitudeValue: g.magnitudeValue,
            magnitudeUnit: g.magnitudeUnit,
          };
        });
      });
    },
  },
  {
    id: 'gdacs',
    label: 'GDACS Alerts',
    fetch: async () => {
      const d = await fetchJson('/api/gdacs/alerts') as { alerts?: Array<Record<string, unknown>> };
      const alerts = d.alerts ?? [];
      return alerts.map((a) => ({
        id: a.id,
        title: a.title,
        alertLevel: a.alertLevel,
        severity: a.severity,
        population: a.population,
        vulnerability: a.vulnerability,
        eventType: a.eventType,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        fromDate: a.fromDate,
        toDate: a.toDate,
      }));
    },
  },
];

export interface LoadResult {
  id: string;
  label: string;
  rows: number;
  error?: string;
}

/** Load (or reload) all layers into DuckDB tables. Returns a summary per layer. */
export async function loadAllLayers(): Promise<LoadResult[]> {
  const results: LoadResult[] = [];
  const auth = AUTH();
  for (const layer of LAYERS) {
    try {
      const rows = await layer.fetch(auth);
      await registerTable(layer.id, rows);
      results.push({ id: layer.id, label: layer.label, rows: rows.length });
    } catch (e) {
      results.push({ id: layer.id, label: layer.label, rows: 0, error: (e as Error).message });
    }
  }
  return results;
}

/** Load a single layer by ID. */
export async function loadLayer(id: string, auth?: Record<string, string>): Promise<LoadResult> {
  const layer = LAYERS.find((l) => l.id === id);
  if (!layer) return { id, label: id, rows: 0, error: 'Unknown layer' };
  try {
    const rows = await layer.fetch(auth ?? {});
    await registerTable(layer.id, rows);
    return { id: layer.id, label: layer.label, rows: rows.length };
  } catch (e) {
    return { id: layer.id, label: layer.label, rows: 0, error: (e as Error).message };
  }
}