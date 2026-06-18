declare module 'shpjs' {
  interface ShpFeatureCollection {
    type: 'FeatureCollection';
    features: GeoJSON.Feature[];
    fileName?: string;
  }
  export default function shp(buffer: ArrayBuffer): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;
}
