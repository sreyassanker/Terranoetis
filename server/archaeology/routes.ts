import { Router } from 'express';
import type { Request, Response } from 'express';
import { globalArchaeologyEngine } from './archaeologyEngine';
import { PEER_REVIEWED_REFERENCE_SITES } from './referenceSites';
import { runPeerReviewedValidationBenchmark } from './validationBenchmark';
import type { StudyAreaBoundingBox, BiomeType } from './types';

export const archaeologyRouter = Router();

/**
 * POST /api/archaeology/scan
 * Scans a user-drawn study area bounding box for multi-modal archaeological anomalies.
 */
archaeologyRouter.post('/scan', async (req: Request, res: Response) => {
  try {
    const { studyArea, biome, maxCloudCoverPercent, seasonWindow, startDate, endDate } = req.body as {
      studyArea?: StudyAreaBoundingBox;
      biome?: BiomeType;
      maxCloudCoverPercent?: number;
      seasonWindow?: 'clearest_auto' | 'dry_season' | 'historical_archive';
      startDate?: string;
      endDate?: string;
    };

    if (
      !studyArea ||
      typeof studyArea.latMin !== 'number' ||
      typeof studyArea.latMax !== 'number' ||
      typeof studyArea.lonMin !== 'number' ||
      typeof studyArea.lonMax !== 'number'
    ) {
      res.status(400).json({
        error: 'Invalid study area bounding box. Must supply latMin, latMax, lonMin, lonMax numbers.',
      });
      return;
    }

    if (studyArea.latMin >= studyArea.latMax || studyArea.lonMin >= studyArea.lonMax) {
      res.status(400).json({
        error: 'Invalid coordinates: latMin must be < latMax and lonMin must be < lonMax.',
      });
      return;
    }

    const result = await globalArchaeologyEngine.scanStudyArea(studyArea, biome, {
      maxCloudCoverPercent,
      seasonWindow,
      startDate,
      endDate,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Archaeology scan failed: ${message}` });
  }
});

/**
 * GET /api/archaeology/benchmarks
 * Returns the list of 5 peer-reviewed reference sites with citations.
 */
archaeologyRouter.get('/benchmarks', (_req: Request, res: Response) => {
  res.json({
    count: PEER_REVIEWED_REFERENCE_SITES.length,
    sites: PEER_REVIEWED_REFERENCE_SITES,
  });
});

/**
 * GET or POST /api/archaeology/benchmark/run
 * Executes the validation suite across all 5 reference locations,
 * calculating spatial error, IoU, and confidence scores.
 */
const handleBenchmarkRun = async (_req: Request, res: Response) => {
  try {
    const auditReport = await runPeerReviewedValidationBenchmark();
    res.json(auditReport);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Benchmark validation failed: ${message}` });
  }
};

archaeologyRouter.get('/benchmark/run', handleBenchmarkRun);
archaeologyRouter.post('/benchmark/run', handleBenchmarkRun);

