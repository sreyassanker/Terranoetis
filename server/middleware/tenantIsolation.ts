import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index';

/**
 * Tenant isolation middleware. Validates that the requesting user owns the resource
 * identified by `req.params.id` in the given table.
 *
 * IMPORTANT: This module is the SOLE authority for which tables/columns are
 * queryable. It uses a closed set of compile-time constants — never user input —
 * to construct SQL. There is no string interpolation of user-controlled values
 * into SQL statements.
 */

const TABLE_CONFIG: Record<string, { idField: string }> = {
  chats:         { idField: 'id' },
  monitor_rules: { idField: 'rule_id' },
  scheduled_tasks:{ idField: 'task_id' },
  profiles:      { idField: 'user_id' },
  feedback:      { idField: 'feedback_id' },
};

export function requireOwnership(table: string) {
  const config = TABLE_CONFIG[table];
  if (!config) {
    throw new Error(`requireOwnership: unknown table "${table}". Add to TABLE_CONFIG before use.`);
  }
  const { idField } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const resourceId = req.params.id;
    if (!resourceId) {
      next();
      return;
    }
    try {
      const db = getDb();
      // Parameterized query — no string interpolation of user data
      const row = db
        .prepare('SELECT user_id FROM ' + table + ' WHERE ' + idField + ' = ?')
        .get(resourceId) as { user_id: string } | undefined;
      if (!row) {
        next();
        return;
      }
      if (row.user_id !== (req as any).userId) {
        res.status(403).json({ error: 'Forbidden: you do not own this resource' });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: 'Ownership check failed' });
    }
  };
}

/** Exposed for tests / introspection only. */
export const _TABLE_CONFIG = TABLE_CONFIG;
