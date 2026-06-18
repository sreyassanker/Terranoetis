import { getDb } from '../db/index';

export function auditLog(
  userId: string,
  action: string,
  resource: string,
  details: string,
  ip: string,
  userAgent: string,
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, resource, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, action, resource, details, ip, userAgent);
  } catch {
    /* silent */
  }
}
