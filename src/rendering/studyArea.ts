import * as Cesium from 'cesium';

export interface StudyAreaItem {
  id: string;
  name: string;
  type: 'rectangle' | 'polygon' | 'circle' | 'geojson' | 'shapefile';
  visible: boolean;
  dataSource?: Cesium.GeoJsonDataSource;
  entity?: Cesium.Entity;
  positions?: Cesium.Cartesian3[];
  geojson?: GeoJSON.FeatureCollection;
  color: string;
}

let areaIdCounter = 0;
export function generateAreaId(): string {
  return `study_area_${++areaIdCounter}`;
}

export function loadGeoJsonToGlobe(
  viewer: Cesium.Viewer,
  geojson: GeoJSON.FeatureCollection,
  name: string,
  color: string,
): Promise<Cesium.GeoJsonDataSource> {
  const ds = new Cesium.GeoJsonDataSource(name);
  return ds.load(geojson, {
    stroke: Cesium.Color.fromCssColorString(color),
    fill: Cesium.Color.fromCssColorString(color).withAlpha(0.12),
    strokeWidth: 2,
    clampToGround: true,
  }).then(() => {
    viewer.dataSources.add(ds);
    viewer.flyTo(ds);
    return ds;
  });
}

export function removeStudyAreaFromGlobe(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
): void {
  if (item.dataSource) {
    viewer.dataSources.remove(item.dataSource, true);
    item.dataSource = undefined;
  }
  if (item.entity) {
    viewer.entities.remove(item.entity);
    item.entity = undefined;
  }
}

export function setStudyAreaVisibility(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
  visible: boolean,
): void {
  if (item.dataSource) {
    item.dataSource.show = visible;
  }
  if (item.entity) {
    item.entity.show = visible;
  }
  viewer.scene.requestRender();
}

export function exportToGeoJSON(items: StudyAreaItem[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const item of items) {
    if (item.geojson) {
      features.push(...item.geojson.features);
    } else if (item.positions && item.positions.length >= 2) {
      const coords = item.positions.map(p => {
        const carto = Cesium.Cartographic.fromCartesian(p);
        return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
      });
      if (item.type === 'polygon') {
        coords.push(coords[0]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: { name: item.name, type: item.type },
        });
      } else if (item.type === 'rectangle' && coords.length >= 2) {
        const west = coords[0][0]; const south = coords[0][1];
        const east = coords[1][0]; const north = coords[1][1];
        const rectCoords = [
          [west, north], [east, north], [east, south], [west, south], [west, north],
        ];
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [rectCoords] },
          properties: { name: item.name, type: item.type },
        });
      } else if (item.type === 'circle' && coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords[0] },
          properties: { name: item.name, type: item.type, radiusMeters: item.positions[2] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.geojson') ? filename : `${filename}.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function createRectangleEntity(
  viewer: Cesium.Viewer,
  west: number, south: number, east: number, north: number,
  color: string,
  name: string,
): Cesium.Entity {
  const c = Cesium.Color.fromCssColorString(color);
  const entity = viewer.entities.add({
    name,
    rectangle: {
      coordinates: new Cesium.Rectangle(
        Cesium.Math.toRadians(west),
        Cesium.Math.toRadians(south),
        Cesium.Math.toRadians(east),
        Cesium.Math.toRadians(north),
      ),
      material: c.withAlpha(0.1),
      outline: true,
      outlineColor: c,
      outlineWidth: 2,
    },
  });
  return entity;
}

export function positionsToGeoJSON(
  positions: Cesium.Cartesian3[],
  type: 'Polygon' | 'LineString',
  name: string,
): GeoJSON.Feature {
  const coords = positions.map(p => {
    const carto = Cesium.Cartographic.fromCartesian(p);
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
  });
  if (type === 'Polygon') coords.push(coords[0]);
  return {
    type: 'Feature',
    geometry: { type, coordinates: type === 'Polygon' ? [coords] : coords },
    properties: { name },
  };
}

export async function parseFileToGeoJSON(file: File): Promise<Array<{
  name: string;
  geojson: GeoJSON.FeatureCollection;
  format: 'geojson' | 'shapefile';
}>> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'geojson' || ext === 'json') {
    const text = await file.text();
    const data = JSON.parse(text);
    let geojson: GeoJSON.FeatureCollection;
    if (data.type === 'FeatureCollection') {
      geojson = data as GeoJSON.FeatureCollection;
    } else if (data.type === 'Feature') {
      geojson = { type: 'FeatureCollection', features: [data] };
    } else {
      throw new Error('Invalid GeoJSON file');
    }
    return [{ name: file.name.replace(/\.[^/.]+$/, ''), geojson, format: 'geojson' }];
  }

  if (ext === 'zip' || ext === 'shp') {
    const shp = await import('shpjs');
    const buffer = await file.arrayBuffer();
    const result = await shp.default(buffer);
    const entries: Array<{ name: string; geojson: GeoJSON.FeatureCollection; format: 'geojson' | 'shapefile' }> = [];
    const rawList: any[] = Array.isArray(result) ? result : [result];
    for (const r of rawList) {
      const name = rawList.length > 1 && r.fileName
        ? r.fileName.replace(/\.[^/.]+$/, '')
        : file.name.replace(/\.[^/.]+$/, '');
      if (r.type === 'FeatureCollection') {
        entries.push({ name, geojson: r as GeoJSON.FeatureCollection, format: 'shapefile' });
      } else {
        throw new Error('Shapefile did not parse to GeoJSON');
      }
    }
    return entries;
  }

  throw new Error(`Unsupported file format: .${ext}. Use .geojson, .json, .zip (shapefile), or .shp`);
}
