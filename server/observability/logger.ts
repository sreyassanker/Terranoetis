/* eslint-disable @typescript-eslint/no-explicit-any */
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['apiKey', 'token', 'password', 'authorization', 'x-api-token', 'api_key'],
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      userId: req.userId,
    }),
    err: pino.stdSerializers.err,
  },
});

export function requestLoggerMiddleware(): (req: any, res: any, next: any) => void {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    req.correlationId = req.correlationId || crypto.randomUUID();

    res.on('finish', () => {
      const duration = Date.now() - start;
      if (res.statusCode >= 400) {
        logger.warn({ method: req.method, path: req.path, correlationId: req.correlationId, userId: req.userId, duration_ms: duration, statusCode: res.statusCode }, 'request completed');
      } else {
        logger.info({ method: req.method, path: req.path, correlationId: req.correlationId, userId: req.userId, duration_ms: duration, statusCode: res.statusCode }, 'request completed');
      }
    });

    next();
  };
}

let slowLogInterval: ReturnType<typeof setInterval> | null = null;

export function startMemoryLogging(intervalMs = 60000): void {
  if (slowLogInterval) return;
  slowLogInterval = setInterval(() => {
    const usage = process.memoryUsage();
    logger.info({
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100,
    }, 'memory usage');
  }, intervalMs);
}

export function stopMemoryLogging(): void {
  if (slowLogInterval) {
    clearInterval(slowLogInterval);
    slowLogInterval = null;
  }
}
