import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
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
  CESIUM_ION_ACCESS_TOKEN: ['VITE_CESIUM_ION_ACCESS_TOKEN'],
  VITE_CESIUM_ION_ACCESS_TOKEN: ['CESIUM_ION_ACCESS_TOKEN'],
  GOOGLE_GEMINI_API_KEY: ['GEMINI_API_KEY'],
  GEMINI_API_KEY: ['GOOGLE_GEMINI_API_KEY'],
  NASA_FIRMS_MAP_KEY: ['NASA_FIRMS_API_KEY', 'FIRMS_MAP_KEY'],
  NASA_FIRMS_API_KEY: ['NASA_FIRMS_MAP_KEY', 'FIRMS_MAP_KEY'],
  FIRMS_MAP_KEY: ['NASA_FIRMS_MAP_KEY', 'NASA_FIRMS_API_KEY'],
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
  WINDY_API_KEY: ['WINDY_WEBCAMS_API_KEY'],
  WINDY_WEBCAMS_API_KEY: ['WINDY_API_KEY'],
  COPERNICUS_TOKEN: ['COPERNICUS_CLIENT_SECRET'],
  COPERNICUS_CLIENT_SECRET: ['COPERNICUS_TOKEN'],
  COINGECKO_API_KEY: ['COINGECKO_DEMO_API_KEY'],
  COINGECKO_DEMO_API_KEY: ['COINGECKO_API_KEY'],
  AVIATIONSTACK_API: ['AVIATIONSTACK_API_KEY'],
  AVIATIONSTACK_API_KEY: ['AVIATIONSTACK_API'],
  DONKI_API_KEY: ['NASA_API_KEY'],
  NASA_API_KEY: ['DONKI_API_KEY'],
  OPENSKY_CLIENT_ID: ['OPENSKY_USERNAME'],
  OPENSKY_USERNAME: ['OPENSKY_CLIENT_ID'],
  OPENSKY_CLIENT_SECRET: ['OPENSKY_PASSWORD'],
  OPENSKY_PASSWORD: ['OPENSKY_CLIENT_SECRET'],
  MAPTILER_API_KEY: ['MAPTILER_KEY'],
  MAPTILER_KEY: ['MAPTILER_API_KEY'],
  EARTHDATA_EDL_TOKEN: ['EARTHDATA_BEARER_TOKEN'],
  EARTHDATA_BEARER_TOKEN: ['EARTHDATA_EDL_TOKEN'],
};

export class KeyManager {
  private userKeys: Map<string, string> = new Map();
  private envDefaults: Map<string, string> = new Map();
  private explicitlyDeletedKeys: Set<string> = new Set();
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

  private getMachineSeedKey(): Buffer {
    let salt: Buffer;
    try {
      if (fs.existsSync(this.saltFilePath)) {
        salt = fs.readFileSync(this.saltFilePath);
      } else {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(this.saltFilePath, salt, { mode: 0o600 });
      }
    } catch {
      salt = crypto.randomBytes(32);
    }

    const username = os.userInfo().username || 'default_user';
    const hostname = os.hostname() || 'localhost';
    const platform = process.platform;
    const machineSeed = `terranoetis-key-seed::${username}::${hostname}::${platform}`;

    return crypto.scryptSync(salt, machineSeed, 32);
  }

  private getMasterKeyFromOsKeychain(): Buffer | null {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return null;
    }
    if (process.platform === 'darwin') {
      try {
        const out = child_process.execFileSync('/usr/bin/security', [
          'find-generic-password',
          '-a', 'TerranoetisVault',
          '-s', 'TerranoetisMasterKey',
          '-w'
        ], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim();
        if (out && out.length === 64) {
          return Buffer.from(out, 'hex');
        }
      } catch {
        // Not yet stored in macOS Keychain
      }
    }
    return null;
  }

  private storeMasterKeyInOsKeychain(key: Buffer): boolean {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return false;
    }
    if (process.platform === 'darwin') {
      try {
        child_process.execFileSync('/usr/bin/security', [
          'add-generic-password',
          '-a', 'TerranoetisVault',
          '-s', 'TerranoetisMasterKey',
          '-w', key.toString('hex'),
          '-U'
        ], { stdio: 'ignore' });
        return true;
      } catch (err) {
        logger.warn({ err }, '[KeyManager] Unable to store master key in macOS Keychain');
      }
    }
    return false;
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

    // 1. Try OS Keychain (macOS Keychain)
    const osKey = this.getMasterKeyFromOsKeychain();
    if (osKey) {
      this.masterKey = osKey;
      return this.masterKey;
    }

    // 2. If Keychain is supported, generate a fresh 256-bit key and save to Keychain
    if (process.platform === 'darwin' && !process.env.NODE_ENV?.includes('test') && !process.env.VITEST) {
      const freshKey = crypto.randomBytes(32);
      if (this.storeMasterKeyInOsKeychain(freshKey)) {
        this.masterKey = freshKey;
        logger.info('[KeyManager] Initialized master key in OS Keychain');
        return this.masterKey;
      }
    }

    // 3. Fallback to hardware/machine-seed derived key
    this.masterKey = this.getMachineSeedKey();
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

  private decryptWithKey(payload: EncryptedPayload, key: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private decrypt(payload: EncryptedPayload): string {
    const key = this.getMasterKey();
    try {
      return this.decryptWithKey(payload, key);
    } catch (err) {
      // If primary key failed (e.g. migration from machine-seed to Keychain), try machine seed fallback
      const fallbackKey = this.getMachineSeedKey();
      if (!fallbackKey.equals(key)) {
        try {
          const decrypted = this.decryptWithKey(payload, fallbackKey);
          logger.info('[KeyManager] Successfully migrated vault from machine-seed key to OS Keychain');
          // Re-encrypt with primary key and persist
          setTimeout(() => {
            try {
              const loaded = JSON.parse(decrypted);
              this.persistToDisk(loaded);
            } catch { /* ignore */ }
          }, 0);
          return decrypted;
        } catch {
          // both failed
        }
      }
      throw err;
    }
  }

  /**
   * Initializes the KeyManager:
   * 1. Captures existing process.env defaults.
   * 2. Reads encrypted vault file from disk (or SQLite backup).
   * 3. Injects user-saved keys into process.env and synchronizes canonical aliases.
   */
  init(): void {
    if (this.initialized) return;

    // Snapshot existing env defaults and synchronize canonical aliases
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        this.envDefaults.set(k, v);
        const aliases = KEY_ALIASES[k] || [];
        for (const alias of aliases) {
          if (!process.env[alias]) {
            process.env[alias] = v;
            this.envDefaults.set(alias, v);
          }
        }
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

    const initKaggleUser = this.userKeys.get('KAGGLE_USERNAME') || process.env.KAGGLE_USERNAME;
    const initKaggleKey = this.userKeys.get('KAGGLE_KEY') || process.env.KAGGLE_KEY;
    if (initKaggleUser && initKaggleKey) {
      this.syncKaggleConfig(initKaggleUser, initKaggleKey);
    }

    this.initialized = true;
    logger.info({ activeUserKeys: this.userKeys.size }, '[KeyManager] KeyManager ready');
  }

  private syncKaggleConfig(username: string, key: string): void {
    try {
      const kaggleDir = path.join(this.vaultDir, '.kaggle');
      fs.mkdirSync(kaggleDir, { recursive: true, mode: 0o700 });
      const configPath = path.join(kaggleDir, 'kaggle.json');
      fs.writeFileSync(configPath, JSON.stringify({ username, key }, null, 2), { mode: 0o600 });
      process.env.KAGGLE_CONFIG_DIR = kaggleDir;

      // Also best-effort sync to ~/.kaggle if accessible
      const homeKaggleDir = path.join(os.homedir(), '.kaggle');
      try {
        fs.mkdirSync(homeKaggleDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(homeKaggleDir, 'kaggle.json'), JSON.stringify({ username, key }, null, 2), { mode: 0o600 });
      } catch { /* best effort */ }

      logger.info({ username }, '[KeyManager] Kaggle credentials synchronized to AppData and environment');
    } catch (err) {
      logger.warn({ err }, '[KeyManager] Failed to sync Kaggle configuration file');
    }
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
    if (this.explicitlyDeletedKeys.has(key)) return undefined;
    const userVal = this.userKeys.get(key);
    if (userVal) return userVal;
    for (const alias of KEY_ALIASES[key] || []) {
      if (this.explicitlyDeletedKeys.has(alias)) continue;
      const aliasUserVal = this.userKeys.get(alias);
      if (aliasUserVal) return aliasUserVal;
    }
    const envVal = process.env[key] || this.envDefaults.get(key);
    if (envVal) return envVal;
    for (const alias of KEY_ALIASES[key] || []) {
      if (this.explicitlyDeletedKeys.has(alias)) continue;
      const aliasEnv = process.env[alias] || this.envDefaults.get(alias);
      if (aliasEnv) return aliasEnv;
    }
    return undefined;
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
   * Get status overview for a single key.
   */
  getStatus(key: string): KeyStatus {
    const all = this.getAllStatuses();
    return all[key] || { configured: false, masked: '', source: 'none' };
  }

  /**
   * Get status overview for all known keys.
   */
  getAllStatuses(): Record<string, KeyStatus> {
    const statuses: Record<string, KeyStatus> = {};

    // Collect all potential key names
    const allKeys = new Set<string>();
    for (const k of this.userKeys.keys()) allKeys.add(k);
    for (const k of this.explicitlyDeletedKeys) allKeys.add(k);
    for (const k of this.envDefaults.keys()) allKeys.add(k);
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
      if (this.explicitlyDeletedKeys.has(key)) {
        statuses[key] = {
          configured: false,
          masked: '',
          source: 'none',
        };
        continue;
      }

      let userVal = this.userKeys.get(key);
      if (!userVal) {
        for (const alias of KEY_ALIASES[key] || []) {
          if (this.explicitlyDeletedKeys.has(alias)) continue;
          const av = this.userKeys.get(alias);
          if (av && av.trim()) {
            userVal = av;
            break;
          }
        }
      }
      if (userVal && userVal.trim()) {
        statuses[key] = {
          configured: true,
          masked: this.mask(userVal),
          source: 'user',
        };
        continue;
      }

      let envVal = process.env[key];
      if (!envVal) {
        for (const alias of KEY_ALIASES[key] || []) {
          if (this.explicitlyDeletedKeys.has(alias)) continue;
          const ev = process.env[alias];
          if (ev && ev.trim()) {
            envVal = ev;
            break;
          }
        }
      }
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
      this.explicitlyDeletedKeys.delete(k);
      for (const a of KEY_ALIASES[k] || []) {
        this.explicitlyDeletedKeys.delete(a);
      }
      this.userKeys.set(k, trimmed);
      this.applyKeyToEnv(k, trimmed);
      changed.push(k);
      savedCount++;
    }

    for (const k of deleteKeys) {
      this.explicitlyDeletedKeys.add(k);
      for (const a of KEY_ALIASES[k] || []) {
        this.explicitlyDeletedKeys.add(a);
      }
      if (this.userKeys.has(k)) {
        this.userKeys.delete(k);
        this.removeKeyFromEnv(k);
        changed.push(k);
        deletedCount++;
      }
      for (const a of KEY_ALIASES[k] || []) {
        if (this.userKeys.has(a)) {
          this.userKeys.delete(a);
          this.removeKeyFromEnv(a);
        }
      }
    }

    // Build plain object to persist
    const toPersist: Record<string, string> = {};
    for (const [k, v] of this.userKeys.entries()) {
      toPersist[k] = v;
    }

    this.persistToDisk(toPersist);

    // If Kaggle credentials were saved or modified, sync runtime kaggle.json
    const kaggleUser = this.userKeys.get('KAGGLE_USERNAME') || process.env.KAGGLE_USERNAME;
    const kaggleKey = this.userKeys.get('KAGGLE_KEY') || process.env.KAGGLE_KEY;
    if (kaggleUser && kaggleKey && !this.explicitlyDeletedKeys.has('KAGGLE_USERNAME') && !this.explicitlyDeletedKeys.has('KAGGLE_KEY')) {
      this.syncKaggleConfig(kaggleUser, kaggleKey);
    }

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
    const aliases = KEY_ALIASES[key] || [];
    this.explicitlyDeletedKeys.add(key);
    for (const a of aliases) {
      this.explicitlyDeletedKeys.add(a);
    }

    const hadKey = this.userKeys.has(key) ||
      aliases.some(a => this.userKeys.has(a)) ||
      Boolean(process.env[key] || this.envDefaults.get(key) || aliases.some(a => process.env[a] || this.envDefaults.get(a)));
    this.userKeys.delete(key);
    this.removeKeyFromEnv(key);
    for (const a of aliases) {
      this.userKeys.delete(a);
      this.removeKeyFromEnv(a);
    }

    const toPersist: Record<string, string> = {};
    for (const [k, v] of this.userKeys.entries()) {
      toPersist[k] = v;
    }
    this.persistToDisk(toPersist);

    for (const listener of this.changeListeners) {
      try {
        listener([key, ...aliases]);
      } catch (err) {
        logger.warn({ err }, '[KeyManager] Listener error on delete');
      }
    }
    return hadKey;
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
  async validateKey(keyName: string, keyValue?: string, contextKeys?: Record<string, string>): Promise<{ valid: boolean; message: string }> {
    const val = (keyValue || this.get(keyName) || '').trim();
    if (!val) {
      return { valid: false, message: 'Key cannot be empty' };
    }

    // Kaggle GPU Compute Validation
    if (keyName === 'KAGGLE_KEY' || keyName === 'KAGGLE_USERNAME') {
      let username = contextKeys?.KAGGLE_USERNAME || this.get('KAGGLE_USERNAME') || process.env.KAGGLE_USERNAME || '';
      let key = contextKeys?.KAGGLE_KEY || this.get('KAGGLE_KEY') || process.env.KAGGLE_KEY || '';

      // Check if value itself is a pasted JSON object (from kaggle.json)
      if (val.startsWith('{') && val.includes('username') && val.includes('key')) {
        try {
          const parsed = JSON.parse(val) as { username?: string; key?: string };
          if (parsed.username) username = parsed.username;
          if (parsed.key) key = parsed.key;
        } catch { /* continue */ }
      } else if (keyName === 'KAGGLE_USERNAME') {
        username = val;
      } else if (keyName === 'KAGGLE_KEY') {
        key = val;
      }

      if (!username || !key) {
        return {
          valid: false,
          message: 'Both Kaggle Username and API Key are required to connect to Kaggle GPU. Please provide both.',
        };
      }

      const { kaggleClient } = await import('./kaggle/kaggleClient');
      const res = await kaggleClient.validateCredentials(username, key);
      return { valid: res.valid, message: res.message };
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
    if (keyName === 'CESIUM_ION_ACCESS_TOKEN' || keyName === 'VITE_CESIUM_ION_ACCESS_TOKEN') {
      try {
        const resp = await fetch('https://api.cesium.com/v1/me', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => ({})) as { id?: number };
          return { valid: true, message: `Cesium Ion Access Token verified successfully (Account ID: ${data.id || 'Active'})` };
        }
        return { valid: false, message: `Invalid Cesium Ion token (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // OpenAI
    if (keyName === 'OPENAI_API_KEY') {
      try {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${val}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => ({})) as { data?: unknown[] };
          return { valid: true, message: `OpenAI API key verified successfully (${data.data?.length || 0} models available)` };
        }
        return { valid: false, message: `Invalid OpenAI API key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Sentinel Hub (OAuth token check)
    if (keyName === 'SENTINEL_HUB_CLIENT_ID' || keyName === 'SENTINEL_HUB_CLIENT_SECRET') {
      const clientId = contextKeys?.SENTINEL_HUB_CLIENT_ID || this.get('SENTINEL_HUB_CLIENT_ID') || process.env.SENTINEL_HUB_CLIENT_ID || (keyName === 'SENTINEL_HUB_CLIENT_ID' ? val : '');
      const clientSecret = contextKeys?.SENTINEL_HUB_CLIENT_SECRET || this.get('SENTINEL_HUB_CLIENT_SECRET') || process.env.SENTINEL_HUB_CLIENT_SECRET || (keyName === 'SENTINEL_HUB_CLIENT_SECRET' ? val : '');

      if (!clientId || !clientSecret) {
        return { valid: false, message: 'Both Sentinel Hub Client ID and Client Secret are required' };
      }
      try {
        const resp = await fetch('https://services.sentinel-hub.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Sentinel Hub OAuth credentials verified successfully' };
        }
        const data = await resp.json().catch(() => ({})) as { error_description?: string; error?: string };
        return { valid: false, message: data.error_description || data.error || `Sentinel Hub rejected credentials (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // AirLabs Aviation
    if (keyName === 'AIRLABS_API_KEY') {
      try {
        const resp = await fetch(`https://airlabs.co/api/v9/ping?api_key=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        const data = await resp.json().catch(() => ({})) as { response?: string; error?: { message?: string } };
        if (data.response === 'pong') {
          return { valid: true, message: 'AirLabs API key verified successfully (Flight tracking active)' };
        }
        return { valid: false, message: data.error?.message || `AirLabs rejected key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // FRED Economic Data
    if (keyName === 'FRED_API_KEY') {
      try {
        const resp = await fetch(`https://api.stlouisfed.org/fred/series?series_id=GNPCA&api_key=${encodeURIComponent(val)}&file_type=json`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'Federal Reserve (FRED) API key verified successfully' };
        }
        const err = await resp.json().catch(() => ({})) as { error_message?: string };
        return { valid: false, message: err.error_message || `FRED API error (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // AlphaVantage
    if (keyName === 'ALPHAVANTAGE_API_KEY' || keyName === 'ALPHA_VANTAGE_API_KEY') {
      try {
        const resp = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
        if (data['Global Quote']) {
          return { valid: true, message: 'AlphaVantage API key verified successfully' };
        }
        const note = (data['Note'] || data['Information'] || data['Error Message']) as string | undefined;
        return { valid: false, message: note || 'Invalid AlphaVantage key or rate limit exceeded' };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // NewsAPI
    if (keyName === 'NEWSAPI_API_KEY' || keyName === 'NEWS_API_KEY') {
      try {
        const resp = await fetch(`https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        const data = await resp.json().catch(() => ({})) as { status?: string; message?: string };
        if (data.status === 'ok') {
          return { valid: true, message: 'NewsAPI key verified successfully' };
        }
        return { valid: false, message: data.message || `NewsAPI returned HTTP ${resp.status}` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // AlienVault OTX
    if (keyName === 'OTX_API_KEY') {
      try {
        const resp = await fetch('https://otx.alienvault.com/api/v1/user/me', {
          headers: { 'X-OTX-API-KEY': val },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => ({})) as { username?: string };
          return { valid: true, message: `AlienVault OTX key verified successfully (User: ${data.username || 'Active'})` };
        }
        return { valid: false, message: `Invalid AlienVault OTX key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // AbuseIPDB
    if (keyName === 'ABUSEIPDB_API_KEY') {
      try {
        const resp = await fetch('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8', {
          headers: { Key: val, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'AbuseIPDB API key verified successfully' };
        }
        return { valid: false, message: `Invalid AbuseIPDB key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Windy API (Supports both Webcams v3 & Point Forecast v2)
    if (keyName === 'WINDY_API_KEY' || keyName === 'WINDY_WEBCAMS_API_KEY') {
      try {
        // 1. Prioritize Windy Webcams v3 (powers Terranoetis global CCTV & live webcams)
        const webcamResp = await fetch('https://api.windy.com/webcams/api/v3/webcams?limit=1', {
          method: 'GET',
          headers: {
            'x-windy-api-key': val,
            'Accept': 'application/json',
            'User-Agent': 'Terranoetis/3.0',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (webcamResp.ok) {
          const body = await webcamResp.json().catch(() => null) as { total?: number } | null;
          const count = body?.total ? ` (${body.total.toLocaleString()} active webcams available)` : '';
          return { valid: true, message: `Windy Webcams v3 API key verified successfully${count}` };
        }

        // 2. Fallback to Windy Point Forecast API v2
        const forecastResp = await fetch('https://api.windy.com/api/point-forecast/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: 40, lon: -74, model: 'gfs', parameters: ['temp'], levels: ['surface'], key: val }),
          signal: AbortSignal.timeout(8000),
        });
        if (forecastResp.ok) {
          return { valid: true, message: 'Windy Forecast API key verified successfully' };
        }

        return {
          valid: false,
          message: `Invalid Windy key (Webcams returned HTTP ${webcamResp.status}; Forecast returned HTTP ${forecastResp.status})`,
        };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // TomTom Traffic
    if (keyName === 'TOMTOM_API_KEY') {
      try {
        const resp = await fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=52.41072,4.84239&key=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'TomTom Traffic API key verified successfully' };
        }
        return { valid: false, message: `Invalid TomTom key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // EIA Energy Data
    if (keyName === 'EIA_API_KEY') {
      try {
        const resp = await fetch(`https://api.eia.gov/v2/electricity?api_key=${encodeURIComponent(val)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'U.S. EIA API key verified successfully' };
        }
        return { valid: false, message: `Invalid EIA key (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // GoldAPI
    if (keyName === 'GOLDAPI_API_KEY') {
      try {
        const resp = await fetch('https://www.goldapi.io/api/XAU/USD', {
          headers: { 'x-access-token': val },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => ({})) as { price?: number };
          return { valid: true, message: `GoldAPI key verified successfully (Gold Spot: $${data.price || 'Active'})` };
        }
        return { valid: false, message: `Invalid GoldAPI token (HTTP ${resp.status})` };
      } catch (e) {
        return { valid: false, message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // E2B Sandboxes
    if (keyName === 'E2B_API_KEY') {
      try {
        const resp = await fetch('https://api.e2b.dev/sandboxes', {
          headers: { 'X-API-KEY': val },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          return { valid: true, message: 'E2B Sandbox API key verified successfully' };
        }
        return { valid: false, message: `Invalid E2B key (HTTP ${resp.status})` };
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
