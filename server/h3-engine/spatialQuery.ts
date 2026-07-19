import { Router, Request, Response } from 'express';
import { coordsToH3, h3ToCoords, getNeighbors, h3Distance, spatialJoin, expandToResolution } from './h3Index';
import { TimescaleH3 } from './timescaleDb';
import { ClickhouseH3 } from './clickhouse';

const router = Router();
let tsdb: TimescaleH3 | null = null;
let chdb: ClickhouseH3 | null = null;

export function initSpatialEngine(
  timescaleConfig?: string,
  clickhouseConfig?: { host: string; port: number },
  _streamConfig?: { kafkaBrokers?: string[] },
): void {
  if (timescaleConfig) tsdb = new TimescaleH3(timescaleConfig);
  if (clickhouseConfig) chdb = new ClickhouseH3(clickhouseConfig);
}




router.get('/api/spatial/h3', (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const resolution = parseInt(req.query.res as string, 10) || 6;
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }
    const h3Index = coordsToH3(lat, lon, resolution);
    const center = h3ToCoords(h3Index);
    res.json({ h3Index, resolution, center });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/api/spatial/neighbors', (req: Request, res: Response) => {
  try {
    const h3 = req.query.h3 as string;
    const k = parseInt(req.query.k as string, 10) || 1;
    if (!h3) return res.status(400).json({ error: 'h3 parameter required' });
    const neighbors = getNeighbors(h3, k);
    res.json({ h3, k, neighbors, count: neighbors.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/api/spatial/events', async (req: Request, res: Response) => {
  try {
    const h3 = req.query.h3 as string;
    const type = req.query.type as string | undefined;
    const hours = parseInt(req.query.hours as string, 10) || 24;
    if (!h3) return res.status(400).json({ error: 'h3 parameter required' });
    if (!tsdb) return res.status(503).json({ error: 'TimescaleDB not configured' });
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600000);
    const events = await tsdb.queryEvents(h3, [start, end], type);
    res.json({ h3, timeRange: { start, end }, events, count: events.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/api/spatial/aggregate', async (req: Request, res: Response) => {
  try {
    const h3 = req.query.h3 as string;
    const metric = req.query.metric as string;
    if (!h3 || !metric) return res.status(400).json({ error: 'h3 and metric required' });
    if (!chdb) return res.status(503).json({ error: 'Clickhouse not configured' });
    const result = await chdb.queryH3(h3, metric);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/api/spatial/query', (req: Request, res: Response) => {
  try {
    const { operation, h3SetA, h3SetB, center, k, targetRes } = req.body;
    switch (operation) {
      case 'join': {
        if (!h3SetA || !h3SetB) return res.status(400).json({ error: 'h3SetA and h3SetB required' });
        const joined = spatialJoin(h3SetA, h3SetB);
        return res.json({ operation, result: joined, count: joined.length });
      }
      case 'neighbors': {
        if (!center) return res.status(400).json({ error: 'center required' });
        const neighbors = getNeighbors(center, k || 1);
        return res.json({ operation, center, k: k || 1, result: neighbors, count: neighbors.length });
      }
      case 'expand': {
        if (!h3SetA) return res.status(400).json({ error: 'h3SetA required' });
        const expanded = expandToResolution(h3SetA, targetRes || 8);
        return res.json({ operation, targetRes: targetRes || 8, result: expanded, count: expanded.length });
      }
      case 'distance': {
        if (!h3SetA || h3SetA.length < 2) return res.status(400).json({ error: 'need two h3 indices' });
        const dist = h3Distance(h3SetA[0], h3SetA[1]);
        return res.json({ operation, a: h3SetA[0], b: h3SetA[1], distance: dist });
      }
      default:
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
