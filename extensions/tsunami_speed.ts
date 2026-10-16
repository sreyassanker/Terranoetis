// Tsunami Deep-Ocean Wave Phase Speed & Arrival Engine
module.exports = {};

module.exports.init = function(api) {
  api.log('info', 'Tsunami Hydrodynamics Extension active');

  api.registerTool({
    name: 'tsunami_phase_speed',
    description: 'Calculate shallow/deep water tsunami wave phase speed (c = sqrt(g*d)) and propagation travel time',
    category: 'hydrodynamics',
    schema: {
      depthMeters: 'number (mean ocean depth along trench in meters)',
      distanceKm: 'number (distance from subduction epicenter to coast in km)'
    },
    exampleArgs: {
      depthMeters: 4000,
      distanceKm: 1200
    },
    handler: async (args) => {
      const d = Math.max(10, Number(args.depthMeters) || 4000);
      const distKm = Math.max(1, Number(args.distanceKm) || 500);
      const g = 9.80665; // standard gravitational acceleration m/s^2

      // Airy wave theory for shallow-water gravity waves: c = sqrt(g * d)
      const speedMs = Math.sqrt(g * d);
      const speedKmh = Math.round(speedMs * 3.6);
      const speedKnots = Math.round(speedMs * 1.94384);

      const travelTimeHours = Math.round((distKm / speedKmh) * 100) / 100;
      const travelTimeMinutes = Math.round(travelTimeHours * 60);

      return {
        oceanDepthMeters: d,
        travelDistanceKm: distKm,
        waveSpeedMetersPerSec: Math.round(speedMs * 10) / 10,
        waveSpeedKmPerHour: speedKmh,
        waveSpeedKnots: speedKnots,
        jetAirlinerSpeedComparisonPercent: Math.round((speedKmh / 900) * 100),
        estimatedArrivalTimeHours: travelTimeHours,
        estimatedArrivalTimeMinutes: travelTimeMinutes,
        tsunamiRegime: d >= 4000 ? 'Deep Abyssal Plain (Minimal attenuation)' : d >= 1000 ? 'Continental Rise' : 'Continental Shelf (Wave shoaling amplifies amplitude)',
        timestamp: new Date().toISOString()
      };
    }
  });
};
