import { Router } from 'express';
import type { Request, Response } from 'express';
import { logger } from '../observability/logger';
import { getDb } from '../db/index';
import { authGuard } from '../middleware/auth';

/** Allowed user API vault keys (flat map stored in profiles.json_data.api_vault). */
export const VAULT_KEY_NAMES = [
  // AI / Analytics
  'GOOGLE_GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_API_URL',
  'OLLAMA_MODEL',
  'OLLAMA_API_KEY',

  // Satellite & Imagery
  'CESIUM_ION_ACCESS_TOKEN',
  'SENTINEL_HUB_CLIENT_ID',
  'SENTINEL_HUB_CLIENT_SECRET',
  'NASA_FIRMS_API_KEY',
  'PLANET_API_KEY',

  // Aviation
  'OPENSKY_CLIENT_ID',
  'OPENSKY_CLIENT_SECRET',
  'FLIGHTAWARE_AEROAPI_KEY',
  'AIRLABS_API_KEY',
  'AVIATIONSTACK_API',
  'ICAO_API_KEY',
  'TRAVELPAYOUTS_API_TOKEN',
  'WINGBITS_API_KEY',

  // Maritime
  'AIS_STREAM_API_KEY',
  'MARINE_TRAFFIC_API_KEY',
  'CORRIDOR_RISK_API_KEY',

  // Weather & Disaster
  'OPENAQ_API_KEY',
  'WAQI_API_KEY',
  'RELIEFWEB_APPNAME',
  'WINDY_API_KEY',
  'CLOUDFLARE_API_TOKEN',

  // Economic / Financial
  'FRED_API_KEY',
  'EIA_API_KEY',
  'IMF_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'COINGECKO_API_KEY',
  'COINGECKO_DEMO_API_KEY',
  'GIE_API_KEY',
  'ENTSOE_E_TOKEN',
  'COMTRADE_API_KEYS',
  'WTO_API_KEY',

  // Cyber Threat Intelligence
  'ABUSEIPDB_API_KEY',
  'OTX_API_KEY',
  'URLHAUS_AUTH_KEY',

  // Search / Scraping
  'EXA_API_KEYS',
  'FIRECRAWL_API_KEY',
  'BRAVE_API_KEYS',

  // Notifications
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_BRIEF',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_REDIRECT_URI',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',

  // Auth & Security
  'CLERK_SECRET_KEY',
  'CLERK_JWT_ISSUER_DOMAIN',
  'TURNSTILE_SECRET_KEY',
  'WM_SESSION_SECRET',

  // Payments
  'DODO_API_KEY',
  'DODO_WEBHOOK_SECRET',
  'DODO_IDENTITY_SIGNING_SECRET',
  'DODO_BUSINESS_ID',

  // Infrastructure
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'REDIS_PASSWORD',
  'REDIS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_BUCKET',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',

  // Convex
  'CONVEX_URL',
  'CONVEX_SITE_URL',
  'CONVEX_SERVER_SHARED_SECRET',

  // WorldMonitor Internal
  'WORLDMONITOR_VALID_KEYS',
  'RELAY_SHARED_SECRET',
  'MCP_PRO_GRANT_HMAC_SECRET',
  'MCP_INTERNAL_HMAC_SECRET',

  // Legacy / Deprecated
  'GEMINI_API_KEY',
  'E2B_API_KEY',
  'METRICS_API_TOKEN',
  'SANDBOX_API_TOKEN',
  'SENTRY_DSN',
] as const;


/** Maps vault key names to alternative env var names when the .env uses a different name. */
const VAULT_KEY_ENV_ALIASES: Record<string, string[]> = {
  'CESIUM_ION_ACCESS_TOKEN': ['VITE_CESIUM_ION_ACCESS_TOKEN'],
  'NASA_FIRMS_API_KEY': ['NASA_FIRMS_MAP_KEY'],
  'CLOUDFLARE_API_TOKEN': ['CLOUDFLARE_RADAR_API_KEY'],
  'ALPHA_VANTAGE_API_KEY': ['ALPHAVANTAGE_API_KEY'],
  'ENTSOE_E_TOKEN': ['ENTSOE_API_KEY'],
  'COMTRADE_API_KEYS': ['COMTRADE_API_KEY'],
  'BRAVE_API_KEYS': ['BRAVE_SEARCH_API_KEY'],
  'EXA_API_KEYS': ['EXA_API_KEY'],
};

function resolveEnvVar(vaultKey: string): string {
  const direct = process.env[vaultKey];
  if (direct) return direct;
  const aliases = VAULT_KEY_ENV_ALIASES[vaultKey];
  if (aliases) {
    for (const alias of aliases) {
      const val = process.env[alias];
      if (val) return val;
    }
  }
  return '';
}

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
  try {
    const data = row ? (JSON.parse(row.json_data || '{}') as { api_vault?: Record<string, string> }) : {};
    const vault = data.api_vault ?? {};
    const out: Record<string, string> = {};
    for (const k of VAULT_KEY_NAMES) {
      out[k] = typeof vault[k] === 'string' && vault[k] !== ''
        ? vault[k]
        : resolveEnvVar(k);
    }
    return out;
  } catch (e) {
    logger.warn({ err: e }, 'Vault profile parse failed, falling back to env');
    const out: Record<string, string> = {};
    for (const k of VAULT_KEY_NAMES) {
      out[k] = resolveEnvVar(k);
    }
    return out;
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
  } catch (e) {
    logger.warn({ err: e }, 'Vault JSON parse failed');
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
