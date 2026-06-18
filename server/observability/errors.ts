export class AppError extends Error {
  public readonly errorCode: string;
  public readonly statusCode: number;
  public readonly isRetryable: boolean;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    errorCode: string,
    statusCode = 500,
    isRetryable = false,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.context = context;
  }

  toJSON(correlationId?: string) {
    return {
      error: this.message,
      errorCode: this.errorCode,
      correlationId,
      timestamp: new Date().toISOString(),
      retryable: this.isRetryable,
    };
  }
}

export class GeminiError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'GEMINI_API_ERROR', 502, true, context);
  }
}

export class SandboxError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'SANDBOX_ERROR', 502, true, context);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'VALIDATION_ERROR', 400, false, context);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'DATABASE_ERROR', 500, true, context);
  }
}

export class CircuitOpenError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'CIRCUIT_OPEN', 503, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized', context: Record<string, unknown> = {}) {
    super(message, 'AUTH_ERROR', 401, false, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', context: Record<string, unknown> = {}) {
    super(message, 'NOT_FOUND', 404, false, context);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', context: Record<string, unknown> = {}) {
    super(message, 'RATE_LIMIT', 429, false, context);
  }
}
