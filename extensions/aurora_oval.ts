// Aurora Oval & Geomagnetic Latitude Calculator
module.exports = {};

module.exports.init = function(api) {
  api.log('info', 'Aurora Oval & Magnetosphere plugin active');

  api.registerTool({
    name: 'aurora_oval_boundary',
    description: 'Calculate auroral oval equatorward boundary latitude and visibility probability from Kp index',
    category: 'geomagnetism',
    schema: {
      kpIndex: 'number (Planetary Kp index 0-9)',
      observerLat: 'number (Observer geographic latitude)'
    },
    exampleArgs: {
      kpIndex: 5.3,
      observerLat: 54.5
    },
    handler: async (args) => {
      const kp = Math.max(0, Math.min(9, Number(args.kpIndex) || 3.0));
      const obsLat = Math.abs(Number(args.observerLat) || 60.0);

      // Starkov (1994) empirical auroral oval midnight equatorward boundary model:
      // Lat_boundary = 65.9 - 2.1 * Kp + 0.11 * Kp^2
      const boundaryLat = Math.round((65.9 - 2.1 * kp + 0.11 * (kp * kp)) * 10) / 10;
      const isVisible = obsLat >= boundaryLat;

      return {
        planetaryKp: kp,
        observerLatitude: obsLat,
        auroraEquatorwardBoundaryLat: boundaryLat,
        overheadVisibility: isVisible,
        horizonVisibility: obsLat >= (boundaryLat - 5),
        recommendedObservationWindow: '22:00 - 02:00 Magnetic Midnight',
        timestamp: new Date().toISOString()
      };
    }
  });
};
