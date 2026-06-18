import { describe, it, expect } from 'vitest';
import {
  askSchema, sandboxExecuteSchema, chatCreateSchema,
  feedbackSchema, monitorRuleSchema, validate,
} from '../../middleware/validate';
import { z } from 'zod';

describe('Zod schemas - valid data', () => {
  it('askSchema accepts valid message', () => {
    const result = askSchema.safeParse({ message: 'Show me earthquakes near Tokyo' });
    expect(result.success).toBe(true);
  });

  it('sandboxExecuteSchema accepts valid python code', () => {
    const result = sandboxExecuteSchema.safeParse({
      code: 'print("hello")',
      language: 'python',
    });
    expect(result.success).toBe(true);
  });

  it('sandboxExecuteSchema accepts all languages', () => {
    for (const lang of ['python', 'node', 'bash', 'r'] as const) {
      const result = sandboxExecuteSchema.safeParse({ code: 'test', language: lang });
      expect(result.success).toBe(true);
    }
  });

  it('chatCreateSchema accepts valid chat', () => {
    const result = chatCreateSchema.safeParse({ id: 'chat-1', title: 'Test Chat' });
    expect(result.success).toBe(true);
  });

  it('feedbackSchema accepts valid feedback', () => {
    const result = feedbackSchema.safeParse({ vote: 'up' });
    expect(result.success).toBe(true);
  });

  it('monitorRuleSchema accepts valid rule', () => {
    const result = monitorRuleSchema.safeParse({
      layerId: 'seismic',
      condition: { field: 'magnitude', operator: 'gt', value: 6 },
      label: 'Big quakes',
    });
    expect(result.success).toBe(true);
  });
});

describe('Zod schemas - invalid data', () => {
  it('askSchema rejects empty message', () => {
    const result = askSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('askSchema rejects missing message', () => {
    const result = askSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('sandboxExecuteSchema rejects invalid language', () => {
    const result = sandboxExecuteSchema.safeParse({ code: 'test', language: 'ruby' });
    expect(result.success).toBe(false);
  });

  it('sandboxExecuteSchema rejects missing code', () => {
    const result = sandboxExecuteSchema.safeParse({ language: 'python' });
    expect(result.success).toBe(false);
  });

  it('feedbackSchema rejects invalid vote', () => {
    const result = feedbackSchema.safeParse({ vote: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('monitorRuleSchema rejects missing layerId', () => {
    const result = monitorRuleSchema.safeParse({
      condition: { field: 'magnitude', operator: 'gt', value: 6 },
    });
    expect(result.success).toBe(false);
  });

  it('monitorRuleSchema rejects invalid operator', () => {
    const result = monitorRuleSchema.safeParse({
      layerId: 'seismic',
      condition: { field: 'mag', operator: 'bad', value: 5 },
    });
    expect(result.success).toBe(false);
  });
});

describe('validate middleware', () => {
  it('should call next on valid body', () => {
    const middleware = validate(askSchema);
    const req: any = { body: { message: 'test query' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 400 on invalid body', () => {
    const middleware = validate(askSchema);
    const req: any = { body: {} };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
