import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from './db/index';
import { logger } from './observability/logger';
import { API_METADATA } from './apiMetadata';

export interface KeyStatus {
  configured: boolean;
  masked: string;
  source: 'user' | 'env' | 'none';
}

interface EncryptedPayload {
  version: number;
  iv: string;
  authTag: string;
  data: string;
  updatedAt: string;
}

export const KEY_ALIASES: Record<string, string[]> = {
  GOOGLE_GEMINI_API_KEY: ['GEMINI_API_KEY'],
  GEMINI_API_KEY: ['GOOGLE_GEMINI_API_KEY'],
  NASA_FIRMS_MAP_KEY: ['NASA_FIRMS_API_KEY'],
  NASA_FIRMS_API_KEY: ['NASA_FIRMS_MAP_KEY'],
  ALPHAVANTAGE_API_KEY: ['ALPHA_VANTAGE_API_KEY'],
  ALPHA_VANTAGE_API_KEY: ['ALPHAVANTAGE_API_KEY'],
  NEWSAPI_API_KEY: ['NEWS_API_KEY'],
  NEWS_API_KEY: ['NEWSAPI_API_KEY'],
  EXA_API_KEY: ['EXA_API_KEYS'],
  EXA_API_KEYS: ['EXA_API_KEY'],
  COMTRADE_API_KEY: ['COMTRADE_API_KEYS'],
  COMTRADE_API_KEYS: ['COMTRADE_API_KEY'],
  BRAVE_SEARCH_API_KEY: ['BRAVE_API_KEYS'],
  BRAVE_API_KEYS: ['BRAVE_SEARCH_API_KEY'],
  ENTSOE_API_KEY: ['ENTSOE_E_TOKEN'],
  ENTSOE_E_TOKEN: ['ENTSOE_API_KEY'],
  CLOUDFLARE_API_KEY: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_RADAR_API_KEY'],
  CLOUDFLARE_API_TOKEN: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_RADAR_API_KEY'],
  CLOUDFLARE_RADAR_API_KEY: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_API_TOKEN'],
};

class KeyManager {
  private userKeys: Map<string, string> = new Map();
  private envDefaults: Map<string, string> = new Map();
  private masterKey: Buffer | null = null;
  private vaultDir: string = '';
  private vaultFilePath: string = '';
  private saltFilePath: string = '';
  private changeListeners: Array<(changedKeys: string[]) => void> = [];
  private initialized: boolean = false;

  constructor() {
    this.resolvePaths();
  }

  private resolvePaths(): void {
    const platform = process.platform;
    let baseDir: string;
    if (platform === 'darwin') {
      baseDir = path.join(os.homedir(), 'Library', 'Application Support', 'Terranoetis');
    } else if (platform === 'win32') {
      baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming', 'Terranoetis');
    } else {
      baseDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config', 'terranoetis');
    }

    this.vaultDir = baseDir;
    this.vaultFilePath = path.join(baseDir, 'vault.enc.json');
    this.saltFilePath = path.join(baseDir, '.terranoetis_salt');
  }

  private getMasterKey(): Buffer {
    if (this.masterKey) return this.masterKey;

    try {
      if (!fs.existsSync(this.vaultDir)) {
        fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
      }
    } catch (e) {
      logger.warn({ err: e }, '[KeyManager] Unable to create AppData directory');
    }

    let salt: Buffer;
    try {
      if (fs.existsSync(this.saltFilePath)) {
        salt = fs.readFileSync(this.saltFilePath);
      } else {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(this.saltFilePath, salt, { mode: 0o600 });
      }
    } catch {
      salt = Buffer.from('terranoetis-fallback-device-salt-seed-2026', 'utf-8');
    }

    const username = os.userInfo().username || 'default_user';
    const hostname = os.hostname() || 'localhost';
    const platform = process.platform;
    const machineSeed = `terranoetis-key-seed::${username}::${hostname}::${platform}`;

    this.masterKey = crypto.scryptSync(salt, machineSeed, 32);
    return this.masterKey;
  }

  private encrypt(text: string): EncryptedPayload {
    const key = this.getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      version: 1,
      iv: iv.toString('hex'),
      authTag,
      data: encrypted,
      updatedAt: new Date().toISOString(),
    };
  }

  private decrypt(payload: EncryptedPayload): string {
    const key = this.getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Initializes the KeyManager:
   * 1. Captures existing process.env defaults.
   * 2. Reads encrypted vault file from disk (or SQLite backup).
   * 3. Injects user-saved keys into process.env and synchronizes canonical aliases.
   */
  init(): void {
    if (this.initialized) return;

    // Snapshot existing env defaults
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        this.envDefaults.set(k, v);
      }
    }

    let loadedKeys: Record<string, string> = {};

    // 1. Try reading disk vault
    if (fs.existsSync(this.vaultFilePath)) {
      try {
        const raw = fs.readFileSync(this.vaultFilePath, 'utf-8');
        const payload = JSON.parse(raw) as EncryptedPayload;
        if (payload.iv && payload.authTag && payload.data) {
          const decryptedJson = this.decrypt(payload);
          loadedKeys = JSON.parse(decryptedJson);
          logger.info({ count: Object.keys(loadedKeys).length }, '[KeyManager] Decrypted user keys from AppData storage');
        }
      } catch (err) {
        logger.error({ err }, '[KeyManager] Failed to read/decrypt AppData vault file');
      }
    }

    // 2. If disk vault was empty or failed, attempt recovery from SQLite backup
    if (Object.keys(loadedKeys).length === 0) {
      try {
        const db = getDb();
        const row = db.prepare('SELECT value FROM config WHERE key = ?').get('vault_backup_enc') as { value: string } | undefined;
        if (row?.value) {
          const payload = JSON.parse(row.value) as EncryptedPayload;
          const decryptedJson = this.decrypt(payload);
          loadedKeys = JSON.parse(decryptedJson);
          logger.info({ count: Object.keys(loadedKeys).length }, '[KeyManager] Restored user keys from SQLite backup');
          // Re-write to disk
          this.persistToDisk(loadedKeys);
        }
      } catch (err) {
        logger.debug({ err }, '[KeyManager] No SQLite backup found or decrypt failed');
      }
    }

    // Populate userKeys map and sync to process.env
    for (const [key, value] of Object.entries(loadedKeys)) {
      const cleanVal = (value || '').trim();
      if (cleanVal) {
        this.userKeys.set(key, cleanVal);
        this.applyKeyToEnv(key, cleanVal);
      }
    }

    this.initialized = true;
    logger.info({ activeUserKeys: this.userKeys.size }, '[KeyManager] KeyManager ready');
  }

  private applyKeyToEnv(key: string, value: string): void {
    process.env[key] = value;
    const aliases = KEY_ALIASES[key] || [];
    for (const alias of aliases) {
      process.env[alias] = value;
    }
  }

  private removeKeyFromEnv(key: string): void {
    const originalDefault = this.envDefaults.get(key);
    if (originalDefault !== undefined) {
      process.env[key] = originalDefault;
    } else {
      delete process.env[key];
    }

    const aliases = KEY_ALIASES[key] || [];
    for (const alias of aliases) {
      const aliasDefault = this.envDefaults.get(alias);
      if (aliasDefault !== undefined) {
        process.env[alias] = aliasDefault;
      } else {
        delete process.env[alias];
      }
    }
  }

  private persistToDisk(keysObj: Record<string, string>): void {
    try {
      const jsonStr = JSON.stringify(keysObj);
      const encrypted = this.encrypt(jsonStr);
      const serialized = JSON.stringify(encrypted, null, 2);

      // Atomic write using temp file
      const tempPath = `${this.vaultFilePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, serialized, { mode: 0o600 });
      fs.renameSync(tempPath, this.vaultFilePath);

      // Backup to SQLite config table
      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO config (key, value) VALUES ('vault_backup_enc', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(JSON.stringify(encrypted));
      } catch (dbErr) {
        logger.warn({ dbErr }, '[KeyManager] SQLite backup update skipped');
      }
    } catch (err) {
      logger.error({ err }, '[KeyManager] Failed to persist encrypted vault to disk');
      throw new Error(`Failed to securely save API keys: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Retrieves an API key:
   * Returns user configured key if present, otherwise process.env fallback.
   */
  get(key: string): string | undefined {
    const userVal = this.userKeys.get(key);
    if (userVal) return userVal;
    return process.env[key] || this.envDefaults.get(key);
  }

  /**
   * Mask a secret for UI display (e.g. ••••••••a1b2).
   */
  mask(val?: string): string {
    if (!val) return '';
    const trimmed = val.trim();
    if (!trimmed) return '';
    if (trimmed.length <= 8) return '••••••••';
    return `••••••••${trimmed.slice(-4)}`;
  }

  /**
   * Get status overview for all known keys.
   */
  getAllStatuses(): Record<string, KeyStatus> {
    const statuses: Record<string, KeyStatus> = {};

    // Collect all potential key names
    const allKeys = new Set<string>();
    for (const k of this.userKeys.keys()) allKeys.add(k);
    for (const [k, v] of Object.entries(process.env)) {
      if (v && /^[A-Z0-9_]+$/.test(k) && (k.includes('KEY') || k.includes('TOKEN') || k.includes('SECRET') || k.includes('CLIENT_ID'))) {
        allKeys.add(k);
      }
    }
    for (const api of API_METADATA) {
      if (api.envKey && api.envKey !== 'N/A') allKeys.add(api.envKey);
      if (api.envKeys) {
        for (const k of api.envKeys) allKeys.add(k);
      }
    }

    for (const key of allKeys) {
      const userVal = this.userKeys.get(key);
      if (userVal && userVal.trim()) {
        statuses[key] = {
          configured: true,
          masked: this.mask(userVal),
          source: 'user',
        };
        continue;
      }

      const envVal = process.env[key];
      if (envVal && envVal.trim()) {
        statuses[key] = {
          configured: true,
          masked: this.mask(envVal),
          source: 'env',
        };
        continue;
      }

      statuses[key] = {
        configured: false,
        masked: '',
        source: 'none',
      };
    }

    return statuses;
  }

  /**
   * Saves API keys securely.
   * Filters out masked placeholders so existing keys are not overwritten with asterisks.
   */
  saveKeys(newKeys: Record<string, string>, deleteKeys: string[] = []): { saved: number; deleted: number } {
    const changed: string[] = [];
    let savedCount = 0;
    let deletedCount = 0;

    for (const [k, rawVal] of Object.entries(newKeys)) {
      const trimmed = (rawVal || '').trim();
      // Skip if masked or empty
      if (!trimmed || trimmed.includes('••••')) {
        continue;
      }
      this.userKeys.set(k, trimmed);
      this.applyKeyToEnv(k, trimmed);
      changed.push(k);
      savedCount++;
    }

    for (const k of deleteKeys) {
      if (this.userKeys.has(k)) {
        this.userKeys.delete(k);
        this.removeKeyFromEnv(k);
        changed.push(k);
        deletedCount++;
      }
    }

    // Build plain object to persist
    const toPersist: Record<string, string> = {};
    for (const [k, v] of this.userKeys.entries()) {
      toPersist[k] = v;
    }

    this.persistToDisk(toPersist);

    if (changed.length > 0) {
      for (const listener of this.changeListeners) {
        try {
          listener(changed);
        } catch (listenerErr) {
          logger.warn({ listenerErr }, '[KeyManager] Change listener threw error');
        }
      }
    }

    return { saved: savedCount, deleted: deletedCount };
  }

  deleteKey(key: string): boolean {
    if (!this.userKeys.has(key)) return false;
    this.userKeys.delete(key);
    this.removeKeyFromEnv(key);

    const toPersist: Record<string, string> = {};
    for (const [k, v] of this.userKeys.entries()) {
      toPersist[k] = v;
    }
    this.persistToDisk(toPersist);

    for (const listener of this.changeListeners) {
      try {
        listener([key]);
      } catch (err) {
        logger.warn({ err }, '[KeyManager] Listener error on delete');
      }
    }
    return true;
  }

  onChange(listener: (changedKeys: string[]) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== listener);
    };
  }

  /**
   * Live validation for a provider key.
   */
  async validateKey(keyName: string, keyValue?: string): Promise<{ valid: boolean; message: string }> {
    const val = (keyValue || this.get(keyName) || '').trim();
    if (!val) {
      return { valid: false, message: 'Key cannot be empty' };
    }

    // Google Gemini
    if (keyName === 'GOOGLE_GEMINI_API_KEY' || keyName === 'GEMINI_API_KEY') {
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Google Gemini API key verified successfully' };
        }
        const errJson = await resp.json().catch(() => ({})) as { error?: { message?: string } };
        return { valid: false, message: errJson.error?.message || `Google returned HTTP ${resp.status}` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Groq
    if (keyName === 'GROQ_API_KEY') {
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Groq API key verified successfully' };
        }
        return { valid: false, message: `Invalid Groq API key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Cesium Ion Access Token
    if (keyName === 'CESIUM_ION_ACCESS_TOKEN') {
      try {
        const resp = await fetch('https://api.cesium.com/v1/me', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Cesium Ion Access Token verified successfully' };
        }
        return { valid: false, message: `Invalid Cesium Ion token (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Anthropic
    if (keyName === 'ANTHROPIC_API_KEY') {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': val, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Anthropic API key verified successfully' };
        }
        return { valid: false, message: `Invalid Anthropic key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // OpenRouter
    if (keyName === 'OPENROUTER_API_KEY') {
      try {
        const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'OpenRouter API key verified successfully' };
        }
        return { valid: false, message: `Invalid OpenRouter key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // WAQI
    if (keyName === 'WAQI_API_KEY') {
      try {
        const resp = await fetch(`https://api.waqi.info/feed/here/?token=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        const data = await resp.json() as { status?: string; data?: string };
        if (data.status === 'ok') {
          return { valid: true, message: 'WAQI token verified successfully' };
        }
        return { valid: false, message: typeof data.data === 'string' ? data.data : 'Invalid WAQI token' };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // DeepSeek
    if (keyName === 'DEEPSEEK_API_KEY') {
      try {
        const resp = await fetch('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'DeepSeek API key verified successfully' };
        }
        return { valid: false, message: `Invalid DeepSeek key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Shodan
    if (keyName === 'SHODAN_API_KEY') {
      try {
        const resp = await fetch(`https://api.shodan.io/api-info?key=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Shodan API key verified successfully' };
        }
        return { valid: false, message: `Invalid Shodan key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // VirusTotal
    if (keyName === 'VIRUSTOTAL_API_KEY') {
      try {
        const resp = await fetch('https://www.virustotal.com/api/v3/users/current', {
          headers: { 'x-apikey': val },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'VirusTotal API key verified successfully' };
        }
        return { valid: false, message: `Invalid VirusTotal key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // NASA FIRMS
    if (keyName === 'NASA_FIRMS_MAP_KEY' || keyName === 'NASA_FIRMS_API_KEY') {
      if (/^[a-f0-9]{32}$/i.test(val)) {
        return { valid: true, message: 'NASA FIRMS Map Key format verified (32-character hex)' };
      }
      return { valid: false, message: 'Invalid NASA FIRMS Map Key: must be 32 hexadecimal characters' };
    }

    // Brave Search
    if (keyName === 'BRAVE_SEARCH_API_KEY' || keyName === 'BRAVE_API_KEYS') {
      try {
        const resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
          headers: { 'X-Subscription-Token': val, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Brave Search API key verified successfully' };
        }
        return { valid: false, message: `Invalid Brave Search key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // General format validation
    if (val.length < 6) {
      return { valid: false, message: 'Key appears too short (expected at least 6 characters)' };
    }
    if (/\s/.test(val)) {
      return { valid: false, message: 'Key must not contain whitespace or line breaks' };
    }

    return { valid: true, message: 'Key format is valid and ready to use' };
  }
}

export const keyManager = new KeyManager();
