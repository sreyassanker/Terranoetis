import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index';
import { authGuard } from '../middleware/auth';

/** Allowed user API vault keys (flat map stored in profiles.json_data.api_vault). */
export const VAULT_KEY_NAMES = [
  'GOOGLE_GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CESIUM_ION_ACCESS_TOKEN',
  'SENTINEL_HUB_CLIENT_ID',
  'SENTINEL_HUB_CLIENT_SECRET',
  'MARINE_TRAFFIC_API_KEY',
  'AIS_STREAM_API_KEY',
  'FLIGHTAWARE_AEROAPI_KEY',
  'AIRLABS_API_KEY',
] as const;

export type VaultKeyName = (typeof VAULT_KEY_NAMES)[number];

function ensureProfile(userId: string): void {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare(
      'INSERT INTO profiles (user_id, json_data) VALUES (?, ?)',
    ).run(userId, '{}');
  }
}

function readVault(userId: string): Record<string, string> {
  const row = getDb()
    .prepare('SELECT json_data FROM profiles WHERE user_id = ?')
    .get(userId) as { json_data: string } | undefined;
  if (!row) return {};
  try {
    const data = JSON.parse(row.json_data || '{}') as { api_vault?: Record<string, string> };
    const vault = data.api_vault ?? {};
    const out: Record<string, string> = {};
    for (const k of VAULT_KEY_NAMES) {
      if (typeof vault[k] === 'string') out[k] = vault[k];
    }
    return out;
  } catch {
    return {};
  }
}

function writeVault(userId: string, keys: Record<string, string>): void {
  ensureProfile(userId);
  const row = getDb()
    .prepare('SELECT json_data FROM profiles WHERE user_id = ?')
    .get(userId) as { json_data: string };
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.json_data || '{}') as Record<string, unknown>;
  } catch {
    data = {};
  }
  const existing = (data.api_vault as Record<string, string>) ?? {};
  const merged: Record<string, string> = { ...existing };
  for (const k of VAULT_KEY_NAMES) {
    if (typeof keys[k] === 'string') merged[k] = keys[k];
  }
  data.api_vault = merged;
  getDb()
    .prepare('UPDATE profiles SET json_data = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(JSON.stringify(data), userId);
}

export const vaultRouter = Router();

vaultRouter.get('/', authGuard, (req: Request, res: Response) => {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ keys: readVault(userId) });
});

vaultRouter.put('/', authGuard, (req: Request, res: Response) => {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const body = req.body as { keys?: Record<string, string> };
  const keys = body?.keys ?? (body as Record<string, string>);
  if (!keys || typeof keys !== 'object') {
    res.status(400).json({ error: 'keys object required' });
    return;
  }
  writeVault(userId, keys);
  res.json({ ok: true, keys: readVault(userId) });
});

/** Server-side lookup for proxied requests (never exposed to other users). */
export function getUserVaultKey(userId: string, keyName: string): string {
  const vault = readVault(userId);
  return vault[keyName] ?? '';
}
