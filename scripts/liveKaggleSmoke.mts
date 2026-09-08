/**
 * Live backend smoke test — mounts the REAL kaggle router on a throwaway
 * express app and drives the three 2D local scenario types through the full
 * HTTP surface a client uses: POST /simulate → poll → GET /grid (JSON) →
 * GET /geotiff. Proves the local python3 path, the results layout, and the
 * grid/GeoTIFF endpoints are wired end-to-end. Not part of the test suite;
 * run manually with `npx tsx scripts/liveKaggleSmoke.mjs`.
 */
import express from 'express';
import { kaggleRouter } from '../server/kaggle/index.ts';

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/api/kaggle', kaggleRouter);

const PORT = 8791;
const server = app.listen(PORT, async () => {
  const base = `http://127.0.0.1:${PORT}/api/kaggle`;
  const cases = [
    {
      name: 'earthquake_swarm',
      body: { type: 'earthquake_swarm', lat: 35.68, lon: 139.65, grid_size: 256, extent_km: 128, magnitude: 7.0, depth_km: 10 },
      grid: 'pga_cm_s2',
    },
    {
      name: 'wildfire_spread',
      body: { type: 'wildfire_spread', lat: 38.5, lon: -121.5, grid_size: 128, extent_km: 10, wind_speed_ms: 10, wind_dir_deg: 270, humidity_pct: 15, duration_hours: 1, fuel_type: 'grass', seed: 42 },
      grid: 'fire_intensity',
    },
    {
      name: 'hurricane_landfall',
      body: { type: 'hurricane_landfall', lat: 29.3, lon: -94.8, grid_size: 192, extent_km: 240, category: 4, central_pressure_hpa: 946, radius_max_wind_km: 32, forward_speed_kmh: 30, duration_hours: 6 },
      grid: 'wind_speed',
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const start = await fetch(`${base}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      }).then((r) => r.json());
      const id = start.jobId;
      // Poll to terminal.
      let status = start.status;
      for (let i = 0; i < 400 && status !== 'complete' && status !== 'error'; i++) {
        await new Promise((r) => setTimeout(r, 250));
        status = (await fetch(`${base}/simulate/${id}`).then((r) => r.json())).status;
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (status !== 'complete') {
        console.log(`FAIL ${c.name}: status=${status} after ${secs}s`);
        failures++;
        continue;
      }
      // Grid JSON endpoint.
      const grid = await fetch(`${base}/simulate/${id}/grid/${c.grid}`).then((r) => r.json());
      const gridOk = Array.isArray(grid.values) && grid.values.length > 0;
      // GeoTIFF endpoint (binary).
      const tiff = await fetch(`${base}/simulate/${id}/geotiff/${c.grid}`);
      const tiffOk = tiff.ok && (await tiff.arrayBuffer()).byteLength > 512;
      // Metadata endpoint.
      const meta = await fetch(`${base}/simulate/${id}/results`).then((r) => r.json());
      const metaOk = !!meta && (meta.completed === true || meta.final_stats);
      console.log(
        `${gridOk && tiffOk && metaOk ? 'PASS' : 'FAIL'} ${c.name}: ${secs}s ` +
        `grid=${gridOk} shape=${grid.shape} geotiff=${tiffOk} meta=${metaOk}`,
      );
      if (!(gridOk && tiffOk && metaOk)) failures++;
    } catch (e) {
      console.log(`FAIL ${c.name}: ${(e as Error).message}`);
      failures++;
    }
  }
  console.log(failures === 0 ? '\nALL BACKEND SMOKE CASES PASSED' : `\n${failures} FAILURE(S)`);
  server.close();
  process.exit(failures === 0 ? 0 : 1);
});
