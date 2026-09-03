import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../observability/logger';

const SERVER_DIR = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(SERVER_DIR, 'realtime.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: Database.Database): void {
  const schemaPath = path.resolve(import.meta.dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  const currentVersion = database.pragma('user_version', { simple: true }) as number;

  if (currentVersion < 1) {
    database.exec(schema);
    database.pragma('user_version = 1');
    logger.info('[DB] Migrated to schema v1');
  }

  // v2: Add password_hash and role columns to users table for real authentication.
  // Uses table-info introspection to be idempotent (works on fresh and existing DBs).
  if (currentVersion < 2) {
    const userCols = (database.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => c.name);
    if (!userCols.includes('password_hash')) {
      database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT \'\'');
      logger.info('[DB] Added users.password_hash column');
    }
    if (!userCols.includes('role')) {
      database.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'user\'');
      logger.info('[DB] Added users.role column');
    }
    if (!userCols.includes('last_login_at')) {
      database.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
      logger.info('[DB] Added users.last_login_at column');
    }
    if (!userCols.includes('failed_attempts')) {
      database.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0');
      logger.info('[DB] Added users.failed_attempts column');
    }
    if (!userCols.includes('locked_until')) {
      database.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
      logger.info('[DB] Added users.locked_until column');
    }
    database.pragma('user_version = 2');
    logger.info('[DB] Migrated to schema v2');
  }

  // v3: Enterprise API-key hygiene — purge per-user vault keys stored in
  // profiles.json_data.api_vault. Keys are now resolved from the server .env
  // only (server/routes/vault.ts was removed); any keys persisted in the DB
  // from earlier deployments are stale secrets and must not survive.
  if (currentVersion < 3) {
    const profilesExist = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").get());
    if (profilesExist) {
      const rows = database.prepare('SELECT user_id, json_data FROM profiles').all() as { user_id: string; json_data: string }[];
      const stripVault = database.prepare('UPDATE profiles SET json_data = ?, updated_at = datetime(\'now\') WHERE user_id = ?');
      let purged = 0;
      for (const row of rows) {
        try {
          const data = JSON.parse(row.json_data || '{}') as Record<string, unknown>;
          if (data && typeof data === 'object' && data.api_vault) {
            delete data.api_vault;
            stripVault.run(JSON.stringify(data), row.user_id);
            purged++;
          }
        } catch {
          /* skip unparseable rows */
        }
      }
      if (purged > 0) logger.info(`[DB] Purged stored API vault keys from ${purged} profile(s)`);
    }
    database.pragma('user_version = 3');
    logger.info('[DB] Migrated to schema v3 (env-only API keys, vault purged)');
  }

  // Tables added after v1 may be missing in existing databases.
  // Re-run any CREATE TABLE IF NOT EXISTS statements for tables that don't exist yet.
  const existingTables = new Set(
    (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)
  );
  for (const stmt of extractCreateTableStmts(schema)) {
    if (!existingTables.has(stmt.tableName)) {
      try {
        database.exec(stmt.sql);
        logger.info(`[DB] Created missing table: ${stmt.tableName}`);
      } catch (err) {
        logger.warn({ err }, `[DB] Failed to create table: ${stmt.tableName}`);
      }
    }
  }
}

function extractCreateTableStmts(schema: string): { tableName: string; sql: string }[] {
  const results: { tableName: string; sql: string }[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  while (true) {
    const match = re.exec(schema);
    if (!match) break;
    const tableName = match[1];
    const start = match.index;
    // Find the matching closing parenthesis + semicolon
    let depth = 0;
    let end = start;
    for (let i = start; i < schema.length; i++) {
      if (schema[i] === '(') depth++;
      else if (schema[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    // Include trailing semicolon if present
    let sql = schema.slice(start, end);
    const after = schema.slice(end).trimStart();
    if (after.startsWith(';')) sql += ';';
    results.push({ tableName, sql });
  }
  return results;
}

