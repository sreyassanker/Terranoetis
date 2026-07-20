import { Math as CMath, Rectangle } from "cesium";
import type { WeatherState } from "../core/types";

export class WeatherProvider {
  async current(rectangle: Rectangle): Promise<WeatherState> {
    const lat = CMath.toDegrees((rectangle.north + rectangle.south) / 2);
    const lon = CMath.toDegrees((rectangle.east + rectangle.west) / 2);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,surface_pressure,` +
      `wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
    try {
      const res = await fetch(url);
      const { current } = await res.json();
      return {
        temperatureC: current.temperature_2m,
        relativeHumidityPct: current.relative_humidity_2m,
        precipitationMmHr: current.precipitation,
        pressureHpa: current.surface_pressure,
        windSpeedMs: current.wind_speed_10m,
        windDirectionDeg: current.wind_direction_10m,
      };
    } catch {
      return { temperatureC: 20, relativeHumidityPct: 50, precipitationMmHr: 0,
               pressureHpa: 1013, windSpeedMs: 4, windDirectionDeg: 270 };
    }
  }
}
