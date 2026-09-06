import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const askSchema = z.object({
  message: z.string().min(1).max(10000),
  cloud: z.boolean().optional(),
  environmentId: z.string().optional(),
  interactionId: z.string().optional(),
  userId: z.string().optional(),
  tier: z.enum(['local', 'flash', 'pro']).optional(),
  model: z.string().optional(),
  studyAreaAction: z.enum(['draw', 'detected', 'skip']).optional(),
  // Audit C8: client signals a regeneration so the server does not record a
  // duplicate user turn into conversation memory.
  regen: z.boolean().optional(),
  // Cap image count and per-image payload size: the previous unbounded array of
  // unbounded base64 strings was a memory-DoS vector (whole JSON is parsed into
  // RAM before the handler ever slices to 4). 4 images × ~8MB base64 each.
  images: z.array(z.object({
    dataUrl: z.string().max(8_000_000),
    mimeType: z.string().max(64),
    fileName: z.string().max(256),
  })).max(4).optional(),
  // Audit S4: bound the echoed conversation (was unbounded → prompt-injection
  // and cost-amplification vector). 12 turns × 4KB max.
  recentMessages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(12).optional(),
  // Audit S4: validate coordinate ranges — a garbage bbox silently poisoned
  // every spatial tool call downstream.
  studyAreaBbox: z.object({
    latMin: z.number().min(-90).max(90),
    latMax: z.number().min(-90).max(90),
    lonMin: z.number().min(-180).max(180),
    lonMax: z.number().min(-180).max(180),
  }).nullable().optional(),
  // GeoJSON ring order is [lon, lat] — validate each coord against the union
  // range ([-180,180] covers both lat and lon) rather than assuming an order.
  studyAreaPolygon: z.array(z.array(z.array(z.number().min(-180).max(180)))).max(200).nullable().optional(),
});

export const sandboxExecuteSchema = z.object({
  code: z.string().min(1).max(20000),
  language: z.enum(['python', 'node', 'bash', 'r']),
  workspaceId: z.string().optional(),
  timeout: z.number().int().min(1000).max(120000).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cloud: z.boolean().optional(),
});

export const monitorRuleSchema = z.object({
  layerId: z.string().min(1),
  condition: z.object({
    field: z.string().min(1),
    operator: z.enum(['gt', 'lt', 'eq', 'changed']),
    value: z.number(),
  }),
  location: z.object({
    lat: z.number(),
    lon: z.number(),
    radiusKm: z.number(),
  }).optional(),
  label: z.string().optional(),
  intervalMs: z.number().int().positive().optional(),
});

export const chatCreateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
  environmentId: z.string().optional(),
  workspaceId: z.string().optional(),
});

export const feedbackSchema = z.object({
  vote: z.enum(['up', 'down']),
  query: z.string().optional(),
  response: z.string().optional(),
  intentType: z.string().optional(),
  modelTier: z.string().optional(),
});

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
