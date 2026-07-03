interface EoEntity {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  description: string;
  properties: Record<string, unknown>;
  relations: Array<{ targetId: string; relation: string }>;
  source: 'wikidata' | 'osm' | 'knowwheregraph' | 'inferred' | 'curated';
}

interface KnowledgeQuery {
  text?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  type?: string;
  limit?: number;
}

interface KnowledgeResult {
  entities: EoEntity[];
  query: KnowledgeQuery;
  enriched: boolean;
}

const CURATED_ENTITIES: EoEntity[] = [
  { id: 'eo:earth', name: 'Earth', type: 'Planet', lat: 0, lon: 0, description: 'Third planet from the Sun, subject of Earth observation', properties: { radiusKm: 6371, surfaceArea: 510.1e6 }, relations: [], source: 'curated' },
  { id: 'eo:sentinel2', name: 'Sentinel-2', type: 'Satellite', lat: 0, lon: 0, description: 'ESA Copernicus multi-spectral imaging satellite constellation', properties: { operator: 'ESA', resolution: '10m', bands: 13 }, relations: [], source: 'curated' },
  { id: 'eo:landsat', name: 'Landsat', type: 'Satellite', lat: 0, lon: 0, description: 'NASA/USGS Earth observation satellite program', properties: { operator: 'NASA/USGS', resolution: '30m' }, relations: [], source: 'curated' },
  { id: 'eo:modis', name: 'MODIS', type: 'Instrument', lat: 0, lon: 0, description: 'Moderate Resolution Imaging Spectroradiometer on Terra and Aqua', properties: { bands: 36, resolution: '250m-1km' }, relations: [], source: 'curated' },
  { id: 'eo:prithvi', name: 'Prithvi-EO-2.0', type: 'FoundationModel', lat: 0, lon: 0, description: 'NASA/IBM geospatial foundation model for land cover analysis', properties: { parameters: '5M', classes: 9 }, relations: [], source: 'curated' },
];

const LAND_COVER_ENTITIES: Record<string, Partial<EoEntity>> = {
  water: { name: 'Water', type: 'LandCover', description: 'Open water bodies including oceans, lakes, rivers, and reservoirs', properties: { copernicusCode: 50, esaCode: 80 } },
  trees: { name: 'Forest/Trees', type: 'LandCover', description: 'Tree-covered areas including deciduous, evergreen, and mixed forests', properties: { copernicusCode: 30, esaCode: 50 } },
  grass: { name: 'Grassland', type: 'LandCover', description: 'Natural grasslands, pastures, and herbaceous vegetation', properties: { copernicusCode: 30, esaCode: 30 } },
  crops: { name: 'Cropland', type: 'LandCover', description: 'Agricultural areas with cultivated crops', properties: { copernicusCode: 40, esaCode: 10 } },
  built_area: { name: 'Built-up Area', type: 'LandCover', description: 'Urban and built-up areas including cities, towns, and infrastructure', properties: { copernicusCode: 10, esaCode: 90 } },
  bare_ground: { name: 'Bare Ground', type: 'LandCover', description: 'Bare soil, sand, rocks, and sparse vegetation areas', properties: { copernicusCode: 60, esaCode: 60 } },
  snow_ice: { name: 'Snow and Ice', type: 'LandCover', description: 'Perennial snow, glaciers, and ice sheets', properties: { copernicusCode: 70, esaCode: 70 } },
};

function latLonToPlaceKey(lat: number, lon: number): string {
  const rlat = Math.round(lat * 10) / 10;
  const rlon = Math.round(lon * 10) / 10;
  return `${rlat >= 0 ? 'N' : 'S'}${Math.abs(rlat).toFixed(1)}_${rlon >= 0 ? 'E' : 'W'}${Math.abs(rlon).toFixed(1)}`;
}

async function queryWikidata(text: string): Promise<EoEntity[]> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(text)}&language=en&format=json&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as { search?: Array<{ id: string; label?: string; description?: string; [key: string]: unknown }> };
    if (!data.search) return [];
    return data.search.map((item) => ({
      id: `wikidata:${item.id}`,
      name: item.label || item.id,
      type: 'Wikidata',
      lat: 0, lon: 0,
      description: item.description || '',
      properties: { wikidataId: item.id, url: `https://www.wikidata.org/wiki/${item.id}` },
      relations: [],
      source: 'wikidata' as const,
    }));
  } catch {
    return [];
  }
}

async function queryNominatim(text: string, limit = 5): Promise<EoEntity[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=${limit}&addressdetails=0`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'RealtimeV2/1.0' },
    });
    const data = await res.json() as Array<{ osm_type?: string; osm_id?: string; display_name?: string; type?: string; lat: string; lon: string; category?: string; importance?: number }>;
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      id: `osm:${item.osm_type || 'node'}:${item.osm_id}`,
      name: item.display_name?.split(',')[0] || item.display_name || text,
      type: item.type || 'place',
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      description: item.display_name || '',
      properties: { category: item.category || '', type: item.type || '', importance: item.importance },
      relations: [],
      source: 'osm' as const,
    }));
  } catch {
    return [];
  }
}

export class EoKnowledgeGraph {
  async query(q: KnowledgeQuery): Promise<KnowledgeResult> {
    const entities: EoEntity[] = [];
    const seen = new Set<string>();

    if (q.text) {
      const lower = q.text.toLowerCase();

      for (const curated of CURATED_ENTITIES) {
        if (curated.name.toLowerCase().includes(lower) || curated.type.toLowerCase().includes(lower) || curated.description.toLowerCase().includes(lower)) {
          if (!seen.has(curated.id)) { entities.push(curated); seen.add(curated.id); }
        }
      }

      for (const [key, ent] of Object.entries(LAND_COVER_ENTITIES)) {
        if (key.includes(lower) || ent.name!.toLowerCase().includes(lower) || (ent.description && ent.description.toLowerCase().includes(lower))) {
          const id = `eo:landcover:${key}`;
          if (!seen.has(id)) {
            entities.push({
              id, lat: 0, lon: 0, source: 'curated',
              relations: [],
              ...ent,
            } as EoEntity);
            seen.add(id);
          }
        }
      }

      const wikidataResults = await queryWikidata(q.text);
      for (const e of wikidataResults) {
        if (!seen.has(e.id)) { entities.push(e); seen.add(e.id); }
      }

      const osmResults = await queryNominatim(q.text);
      for (const e of osmResults) {
        if (!seen.has(e.id)) { entities.push(e); seen.add(e.id); }
      }
    }

    if (q.lat != null && q.lon != null) {
      const placeKey = latLonToPlaceKey(q.lat, q.lon);
      const id = `eo:place:${placeKey}`;
      if (!seen.has(id)) {
        const description = `Geographic location at ${q.lat.toFixed(2)}, ${q.lon.toFixed(2)}`;
        entities.push({
          id, name: `Location ${placeKey}`, type: 'GeoLocation',
          lat: q.lat, lon: q.lon, description,
          properties: { placeKey },
          relations: [], source: 'inferred',
        });
        seen.add(id);
      }

      for (const [key, ent] of Object.entries(LAND_COVER_ENTITIES)) {
        const lcId = `eo:landcover:${key}@${placeKey}`;
        if (!seen.has(lcId)) {
          entities.push({
            id: lcId, lat: q.lat, lon: q.lon, source: 'inferred',
            relations: [{ targetId: `eo:place:${placeKey}`, relation: 'observed_at' }],
            ...ent,
          } as EoEntity);
          seen.add(lcId);
        }
      }
    }

    let result = entities;
    if (q.type) {
      result = result.filter(e => e.type.toLowerCase() === q.type!.toLowerCase());
    }
    if (q.limit && q.limit > 0) {
      result = result.slice(0, q.limit);
    }

    return { entities: result, query: q, enriched: result.some(e => e.source === 'osm' || e.source === 'wikidata') };
  }

  async enrichLocation(lat: number, lon: number): Promise<EoEntity[]> {
    const result = await this.query({ lat, lon, limit: 20 });
    return result.entities;
  }

  async search(text: string, limit = 10): Promise<EoEntity[]> {
    const result = await this.query({ text, limit });
    return result.entities;
  }

  getCurated(): EoEntity[] {
    return [
      ...CURATED_ENTITIES,
      ...Object.entries(LAND_COVER_ENTITIES).map(([key, ent]) => ({
        id: `eo:landcover:${key}`, lat: 0, lon: 0, source: 'curated' as const,
        relations: [], ...ent,
      })),
    ] as EoEntity[];
  }
}

export const eoKnowledgeGraph = new EoKnowledgeGraph();
