import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const askSchema = z.object({
  message: z.string().min(1).max(10000),
  cloud: z.boolean().optional(),
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

export const digitalTwinSchema = z.object({
  message: z.string().min(1).max(2000),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationName: z.string().optional(),
  radiusKm: z.number().min(1).max(200).optional(),
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
