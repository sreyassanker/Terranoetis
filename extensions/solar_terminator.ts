// Subsolar Point & Solar Terminator Calculator
module.exports = {};

module.exports.init = function(api) {
  api.log('info', 'Solar Terminator Extension active');

  api.registerTool({
    name: 'solar_subsolar_point',
    description: 'Calculate subsolar geographic coordinates and day/night/twilight status',
    category: 'astrophysics',
    schema: {
      observerLat: 'number (Observer latitude)',
      observerLon: 'number (Observer longitude)'
    },
    exampleArgs: {
      observerLat: 28.6139,
      observerLon: 77.2090
    },
    handler: async (args) => {
      const lat = Number(args.observerLat) || 0;
      const lon = Number(args.observerLon) || 0;
      const now = new Date();

      const start = new Date(now.getFullYear(), 0, 0);
      const diff = (now.getTime() - start.getTime()) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
      const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

      const toRad = (d) => d * Math.PI / 180;
      const declinationDeg = -23.44 * Math.cos(toRad((360 / 365) * (dayOfYear + 10)));
      const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
      const subsolarLon = (12 - utcHours) * 15;

      const dLat = toRad(lat - declinationDeg);
      const dLon = toRad(lon - subsolarLon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(declinationDeg)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
      const zenithAngleDeg = (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 180 / Math.PI;

      const isDaylight = zenithAngleDeg <= 90;
      const twilightType = zenithAngleDeg <= 90 ? 'Daylight' : zenithAngleDeg <= 96 ? 'Civil Twilight' : zenithAngleDeg <= 102 ? 'Nautical Twilight' : zenithAngleDeg <= 108 ? 'Astronomical Twilight' : 'Night';

      return {
        timestampUtc: now.toISOString(),
        observer: { lat, lon },
        subsolarPoint: {
          latitude: Math.round(declinationDeg * 100) / 100,
          longitude: Math.round(subsolarLon * 100) / 100
        },
        solarZenithAngleDegrees: Math.round(zenithAngleDeg * 10) / 10,
        daylight: isDaylight,
        illuminationPhase: twilightType
      };
    }
  });
};
