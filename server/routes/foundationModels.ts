import { Router } from 'express';
import type { Request, Response } from 'express';

import { logger } from '../observability/logger';
import { prithviEngine } from '../foundation-models/prithvi';
import { satelliteSearcher, LAND_COVER_KEYWORDS } from '../foundation-models/satelliteSearch';
import { satelliteSeeder } from '../foundation-models/satelliteSeeder';
import { getTileJson, getLayerSources, handleTileRequest } from '../foundation-models/mvtTileServer';
import { prithviV2Engine } from '../foundation-models/prithvi-v2';
import { roadTrafficDetector } from '../sentinel/roadTrafficDetector';
import { spacexEngine } from '../foundation-models/spacexApi';
import { clayEngine } from '../foundation-models/clayModel';
import { bayFireDetector } from '../foundation-models/bayFireDetector';
import { unetSegmenter } from '../foundation-models/unetSegmenter';
import { weatherForecaster } from '../foundation-models/weatherForecaster';
import { agricultureMonitor } from '../foundation-models/agricultureMonitor';
import { samGeoSegmenter } from '../foundation-models/samgeoSegmenter';
import { alphaEarthLookup } from '../foundation-models/alphaEarthLookup';

export const foundationModelsRouter = Router();

/* ── Prithvi EO v1 ──────────────────────────────────────────────── */
foundationModelsRouter.get('/fm/prithvi/status', async (_req: Request, res: Response) => {
  if (!prithviEngine.isReady()) {
    res.status(503).json({ error: 'Prithvi engine not initialized yet' });
    return;
  }
  try {
    const status = prithviEngine.getStatus();
    res.json({ status, message: status.ready ? 'Prithvi engine ready' : 'Prithvi engine not initialized' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.post('/fm/prithvi/analyze', async (req: Request, res: Response) => {
  try {
    const { lat, lon, radiusKm } = req.body;
    if (lat == null || lon == null) {
      res.status(400).json({ error: 'lat and lon required' });
      return;
    }
    const result = await prithviEngine.analyze({ lat, lon, radiusKm: radiusKm || 10 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.post('/fm/prithvi/similar', async (req: Request, res: Response) => {
  try {
    const { lat, lon, topK } = req.body;
    if (lat == null || lon == null) {
      res.status(400).json({ error: 'lat and lon required' });
      return;
    }
    const similar = await prithviEngine.getSimilar(lat, lon, topK || 5);
    res.json({ similar });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.post('/fm/prithvi/change', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) {
      res.status(400).json({ error: 'lat and lon required' });
      return;
    }
    const result = await prithviEngine.detectChange(lat, lon);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── Satellite Image Search ─────────────────────────────────────── */
foundationModelsRouter.get('/fm/search', async (req: Request, res: Response) => {
  try {
    const { text, lat, lon, radiusKm, classLabel, limit, offset, since, until } = req.query;
    const results = await satelliteSearcher.search({
      text: text as string | undefined,
      lat: lat ? parseFloat(lat as string) : undefined,
      lon: lon ? parseFloat(lon as string) : undefined,
      radiusKm: radiusKm ? parseFloat(radiusKm as string) : undefined,
      classLabel: classLabel as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
      since: since as string | undefined,
      until: until as string | undefined,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.get('/fm/search/classes', (_req: Request, res: Response) => {
  res.json({
    classes: Object.keys(LAND_COVER_KEYWORDS),
    keywords: LAND_COVER_KEYWORDS,
  });
});

/* ── Satellite Seeder ───────────────────────────────────────────── */
foundationModelsRouter.get('/fm/seeder/status', (_req: Request, res: Response) => {
  res.json(satelliteSeeder.getStatus());
});

foundationModelsRouter.post('/fm/seeder/start', async (req: Request, res: Response) => {
  try {
    const { spacingDeg, latMin, latMax, lonMin, lonMax, resume } = req.body || {};
    satelliteSeeder.start({ spacingDeg, latMin, latMax, lonMin, lonMax, resume }).catch(err => {
      logger.error({ err }, 'Satellite seeder failed');
    });
    res.json({ message: 'Seeder started', status: satelliteSeeder.getStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.post('/fm/seeder/stop', (_req: Request, res: Response) => {
  satelliteSeeder.stop();
  res.json({ message: 'Seeder stopped', status: satelliteSeeder.getStatus() });
});

foundationModelsRouter.post('/fm/seeder/reset', (_req: Request, res: Response) => {
  satelliteSeeder.resetProgress();
  res.json({ message: 'Seeder progress reset', status: satelliteSeeder.getStatus() });
});

foundationModelsRouter.post('/fm/seeder/seed-location', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) {
      res.status(400).json({ error: 'lat and lon required' });
      return;
    }
    await satelliteSeeder.seedLocation(lat, lon);
    res.json({ message: 'Location seeded', lat, lon });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── MVT Vector Tiles ──────────────────────────────────────────── */
foundationModelsRouter.get('/tilejson', (_req: Request, res: Response) => {
  res.json(getTileJson(''));
});

foundationModelsRouter.get('/tile-sources', (_req: Request, res: Response) => {
  res.json({ layers: getLayerSources() });
});

foundationModelsRouter.get('/tiles/:z/:x/:y.mvt', async (req: Request, res: Response) => {
  try {
    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);
    const result = await handleTileRequest(z, x, y);
    if (!result) {
      res.status(204).end();
      return;
    }
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.send(result.buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

foundationModelsRouter.get('/tiles/:z/:x/:y/:layer.mvt', async (req: Request, res: Response) => {
  try {
    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);
    const layer = req.params.layer;
    const result = await handleTileRequest(z, x, y, layer);
    if (!result) {
      res.status(204).end();
      return;
    }
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.send(result.buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PRIORITY 1-10: Upgraded Systems Routes
   ══════════════════════════════════════════════════════════════════ */

/* ── Prithvi V2 ─────────────────────────────────────────────────── */
foundationModelsRouter.get('/fm/prithvi-v2/status', (_req: Request, res: Response) => {
  res.json(prithviV2Engine.getStatus());
});

foundationModelsRouter.post('/fm/prithvi-v2/analyze', async (req: Request, res: Response) => {
  try {
    const { lat, lon, radiusKm, temporalSteps } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await prithviV2Engine.analyze({ lat, lon, radiusKm, temporalSteps });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/prithvi-v2/change', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await prithviV2Engine.detectChangeV2(lat, lon);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ── Road Traffic Detector ──────────────────────────────────────── */
foundationModelsRouter.get('/road-traffic/status', (_req: Request, res: Response) => {
  res.json(roadTrafficDetector.getStatus());
});

foundationModelsRouter.get('/road-traffic/corridors', (_req: Request, res: Response) => {
  res.json({ corridors: roadTrafficDetector.getCorridors() });
});

foundationModelsRouter.post('/road-traffic/analyze', async (req: Request, res: Response) => {
  try {
    const { corridorId } = req.body;
    if (!corridorId) return res.status(400).json({ error: 'corridorId required' });
    const result = await roadTrafficDetector.analyzeCorridor(corridorId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.get('/road-traffic/trends/:corridorId', (req: Request, res: Response) => {
  res.json({ trends: roadTrafficDetector.getTrends(req.params.corridorId) });
});

/* ── SpaceX API ─────────────────────────────────────────────────── */
foundationModelsRouter.get('/spacex/status', (_req: Request, res: Response) => {
  res.json(spacexEngine.getStatus());
});

foundationModelsRouter.get('/spacex/launches', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json({ launches: spacexEngine.getLaunches(limit) });
});

foundationModelsRouter.get('/spacex/starlink', (req: Request, res: Response) => {
  const { latMin, latMax, lonMin, lonMax } = req.query;
  if (latMin && latMax && lonMin && lonMax) {
    res.json({ satellites: spacexEngine.getStarlinkByRegion(+latMin, +latMax, +lonMin, +lonMax) });
  } else {
    res.json({ count: spacexEngine.getStatus().starlinkCount });
  }
});

foundationModelsRouter.get('/spacex/correlations', (_req: Request, res: Response) => {
  res.json({ correlations: spacexEngine.getCorrelations() });
});

/* ── Clay Model ─────────────────────────────────────────────────── */
foundationModelsRouter.get('/fm/clay/status', (_req: Request, res: Response) => {
  res.json(clayEngine.getStatus());
});

foundationModelsRouter.post('/fm/clay/analyze', async (req: Request, res: Response) => {
  try {
    const { lat, lon, sensor } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await clayEngine.analyze({ lat, lon, sensor: sensor || 'sentinel-2' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/clay/flood-sar', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await clayEngine.detectFloodSAR(lat, lon);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ── Bayesian Fire Detector ─────────────────────────────────────── */
foundationModelsRouter.get('/bayfire/status', (_req: Request, res: Response) => {
  res.json(bayFireDetector.getStatus());
});

foundationModelsRouter.get('/bayfire/clusters', (_req: Request, res: Response) => {
  res.json({ clusters: bayFireDetector.getClusters() });
});

foundationModelsRouter.get('/bayfire/results', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ results: bayFireDetector.getRecentResults(limit) });
});

/* ── U-Net Segmenter ────────────────────────────────────────────── */
foundationModelsRouter.get('/fm/unet/status', (_req: Request, res: Response) => {
  res.json(unetSegmenter.getStatus());
});

foundationModelsRouter.post('/fm/unet/segment', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await unetSegmenter.segment({ lat, lon });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { probabilityMap, segmentationMap, ...lightResult } = result;
    res.json(lightResult);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/unet/change', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await unetSegmenter.detectChange(lat, lon);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ── Weather Forecaster ─────────────────────────────────────────── */
foundationModelsRouter.get('/fm/weather/status', (_req: Request, res: Response) => {
  res.json(weatherForecaster.getStatus());
});

foundationModelsRouter.post('/fm/weather/forecast', async (req: Request, res: Response) => {
  try {
    const { lat, lon, forecastDays } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await weatherForecaster.forecast({ lat, lon, forecastDays });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/weather/anomalies', async (req: Request, res: Response) => {
  try {
    const { latMin, latMax, lonMin, lonMax } = req.body;
    const result = await weatherForecaster.detectAnomaliesForRegion(latMin || -10, latMax || 10, lonMin || -10, lonMax || 10);
    res.json({ anomalies: result });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ── Agriculture Monitor ────────────────────────────────────────── */
foundationModelsRouter.get('/fm/agri/status', (_req: Request, res: Response) => {
  res.json(agricultureMonitor.getStatus());
});

foundationModelsRouter.post('/fm/agri/analyze', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await agricultureMonitor.analyzeCrop({ lat, lon });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.get('/fm/agri/alerts', (_req: Request, res: Response) => {
  res.json({ alerts: agricultureMonitor.getAlerts() });
});

/* ── SAMGeo Segmenter ───────────────────────────────────────────── */
foundationModelsRouter.get('/fm/samgeo/status', (_req: Request, res: Response) => {
  res.json(samGeoSegmenter.getStatus());
});

foundationModelsRouter.post('/fm/samgeo/segment', async (req: Request, res: Response) => {
  try {
    const { lat, lon, pointPrompts, boxPrompt } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await samGeoSegmenter.segment({ lat, lon, pointPrompts, boxPrompt });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ── AlphaEarth Embeddings ──────────────────────────────────────── */
foundationModelsRouter.get('/fm/alpha/status', (_req: Request, res: Response) => {
  res.json(alphaEarthLookup.getStatus());
});

foundationModelsRouter.post('/fm/alpha/lookup', async (req: Request, res: Response) => {
  try {
    const { lat, lon, year } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await alphaEarthLookup.lookup(lat, lon, year);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/alpha/change', async (req: Request, res: Response) => {
  try {
    const { lat, lon, yearStart, yearEnd } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await alphaEarthLookup.temporalChange(lat, lon, yearStart || 2020, yearEnd || 2024);
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

foundationModelsRouter.post('/fm/alpha/similar', async (req: Request, res: Response) => {
  try {
    const { lat, lon, topK } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
    const result = await alphaEarthLookup.findSimilar(lat, lon, topK || 5);
    res.json({ similar: result });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
