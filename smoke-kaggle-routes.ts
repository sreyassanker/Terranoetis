import express from 'express';
import { kaggleRouter } from './server/kaggle';
import { runLocalBatch } from './server/kaggle/localRunner';

const LANDSLIDE_REQ = {
  type: 'landslide',
  magnitude: 6.5,
  mu: 0.25,
  xi: 300,
  cohesion: 8000,
  friction_angle: 32,
  rainfall_threshold: 150,
  entrainment_rate: 0.002,
  erodible_depth_m: 5.0,
  extent_km: 5.12,
  grid_size: 256,
};

async function main() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/kaggle', kaggleRouter);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://localhost:${(server.address() as { port: number }).port}/api/kaggle`;

  // ── Test 1: calibrate (24 trials @128², route -> driver -> kernel) ──
  console.log('POST /api/kaggle/calibrate ...');
  let t0 = Date.now();
  const calRes = await fetch(`${base}/calibrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: LANDSLIDE_REQ, observed_runout_km: 3.5 }),
  });
  console.log(`  -> ${calRes.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const calBody = await calRes.json();
  if (calRes.status !== 200) throw new Error(`calibrate failed: ${JSON.stringify(calBody)}`);
  console.log('  best =', JSON.stringify(calBody.best));
  console.log('  trials =', calBody.trials.length);

  // ── Test 2: Monte-Carlo UQ (4 samples @128²) ──
  console.log('POST /api/kaggle/landslide/quantify ...');
  t0 = Date.now();
  const uqRes = await fetch(`${base}/landslide/quantify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: LANDSLIDE_REQ, samples: 4, exceedance_depth_m: 0.5 }),
  });
  console.log(`  -> ${uqRes.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const uqBody = await uqRes.json();
  if (uqRes.status !== 200) throw new Error(`quantify failed: ${JSON.stringify(uqBody)}`);
  const s = uqBody.summary;
  console.log('  summary =', JSON.stringify(s));
  console.log('  maps: gs=%d mean=%d min=%d max=%d exceedance=%d',
    uqBody.gs, uqBody.mean.length, uqBody.min.length, uqBody.max.length, uqBody.exceedance.length);

  // ── Test 3: one full-res 256² run with new knobs (client's actual path) ──
  console.log('runLocalBatch scalars @256² with mu/xi/entrainment ...');
  t0 = Date.now();
  const full = await runLocalBatch('scalars', [{ ...LANDSLIDE_REQ }], { gridSize: 256, timeoutMs: 240_000 });
  const row = (full as { trials: { mu: number; xi: number; runout_km: number; max_depth: number; area_km2: number }[] }).trials[0];
  console.log(`  -> in ${((Date.now() - t0) / 1000).toFixed(1)}s: runout=${row.runout_km.toFixed(2)}km max_depth=${row.max_depth.toFixed(1)}m area=${row.area_km2.toFixed(2)}km²`);

  server.close();
  console.log('ALL SMOKE TESTS PASSED');
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
