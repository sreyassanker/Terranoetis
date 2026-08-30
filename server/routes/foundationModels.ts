import { Router } from 'express';
import type { Request, Response } from 'express';

import { getTileJson, getLayerSources, handleTileRequest } from '../foundation-models/mvtTileServer';
import { roadTrafficDetector } from '../sentinel/roadTrafficDetector';
import { spacexEngine } from '../foundation-models/spacexApi';
import { bayFireDetector } from '../foundation-models/bayFireDetector';
import { weatherForecaster } from '../foundation-models/weatherForecaster';
import { agricultureMonitor } from '../foundation-models/agricultureMonitor';

export const foundationModelsRouter = Router();

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
