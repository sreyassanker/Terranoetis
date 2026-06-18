import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../observability/errors';
import { logger } from '../observability/logger';

const IS_PROD = process.env.NODE_ENV === 'production';

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

/**
 * Centralized Express error handler.
 * - Hides stack traces and internal error details in production
 * - Maps JSON parse errors to 400 (not 500)
 * - Maps body-too-large to 413
 * - Returns a single canonical error shape: { error: { code, message } }
 *   (correlationId only logged server-side, not echoed to client)
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const e = err as ErrorWithStatus;
  const correlationId = (req as any).correlationId;

  // Body parser errors
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    return;
  }
  if (e?.type === 'encoding.unsupported') {
    res.status(415).json({ error: { code: 'UNSUPPORTED_ENCODING', message: 'Unsupported request encoding' } });
    return;
  }

  // AppError subclasses
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, correlationId }, 'app error');
    } else {
      logger.warn({ err: { message: err.message, code: err.errorCode }, correlationId }, 'app error');
    }
    const body: Record<string, unknown> = {
      error: { code: err.errorCode, message: err.message },
    };
    if (!IS_PROD) body.correlationId = correlationId;
    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown errors
  const status = e?.statusCode || e?.status || 500;
  if (status >= 500) {
    logger.error({ err, correlationId, path: req.path }, 'unhandled error');
    res.status(status).json({
      error: { code: 'INTERNAL_ERROR', message: IS_PROD ? 'Internal server error' : (e?.message || 'Internal server error') },
      ...(IS_PROD ? {} : { correlationId }),
    });
  } else {
    res.status(status).json({
      error: { code: 'CLIENT_ERROR', message: e?.message || 'Request failed' },
      ...(IS_PROD ? {} : { correlationId }),
    });
  }
}

/**
 * 404 handler — must be installed AFTER all routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` },
  });
}
