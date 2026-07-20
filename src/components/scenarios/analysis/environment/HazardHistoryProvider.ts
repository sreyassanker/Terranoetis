import { Math as CMath, Rectangle } from "cesium";
import type { HazardHistory } from "../core/types";

export class HazardHistoryProvider {
  async query(rectangle: Rectangle): Promise<HazardHistory> {
    const lat = CMath.toDegrees((rectangle.north + rectangle.south) / 2);
    const lon = CMath.toDegrees((rectangle.east + rectangle.west) / 2);
    const [quakes, volcanoes] = await Promise.all([
      this.quakes(lat, lon), this.volcanoes(lat, lon),
    ]);
    return {
      significantQuakesWithin100Km: quakes,
      volcanoesWithin50Km: volcanoes,
      nearestFaultDistanceKm: quakes.length >= 3 ? 0 : null,
    };
  }

  private async quakes(lat: number, lon: number) {
    try {
      const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
        `&latitude=${lat}&longitude=${lon}&maxradiuskm=100&minmagnitude=4.5` +
        `&starttime=1950-01-01&orderby=magnitude&limit=50`;
      const json = await (await fetch(url)).json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (json.features ?? []).map((f: any) => ({
        magnitude: f.properties.mag, depthKm: f.geometry.coordinates[2],
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        year: new Date(f.properties.time).getFullYear(),
      }));
    } catch { return []; }
  }

  private async volcanoes(lat: number, lon: number) {
    try {
      const url = `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS` +
        `&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes` +
        `&outputFormat=application/json&cql_filter=DWITHIN(the_geom,POINT(${lon}%20${lat}),50000,meters)`;
      const json = await (await fetch(url)).json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (json.features ?? []).map((f: any) => ({
        name: f.properties.Volcano_Name,
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        elevationM: f.properties.Elevation ?? 0,
      }));
    } catch { return []; }
  }
}
