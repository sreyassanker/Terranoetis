import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { kaggleClient } from '../../kaggle/kaggleClient';
import { keyManager } from '../../keyManager';
import { API_METADATA } from '../../apiMetadata';
import { isLocalSimType } from '../../kaggle/simRunner';

describe('Kaggle In-App API Vault Integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.KAGGLE_USERNAME;
    delete process.env.KAGGLE_KEY;
    process.env.KAGGLE_CONFIG_DIR = '/tmp/nonexistent-kaggle-dir-' + Date.now();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('API Catalog Registry', () => {
    it('registers Kaggle in API_METADATA with dual credential keys', () => {
      const kaggleEntry = API_METADATA.find(a => a.id === 'kaggle');
      expect(kaggleEntry).toBeDefined();
      expect(kaggleEntry?.name).toBe('Kaggle GPU Compute');
      expect(kaggleEntry?.category).toBe('AI & Analytics');
      expect(kaggleEntry?.envKeys).toEqual(['KAGGLE_USERNAME', 'KAGGLE_KEY']);
      expect(kaggleEntry?.free).toBe(true);
      expect(kaggleEntry?.registrationUrl).toContain('kaggle.com');
    });
  });

  describe('Credential Resolution', () => {
    it('returns null when no credentials exist', () => {
      vi.spyOn(keyManager, 'get').mockReturnValue('');
      expect(kaggleClient.getCredentials()).toBeNull();
      expect(kaggleClient.hasCredentials()).toBe(false);
    });

    it('resolves credentials from KeyManager vault', () => {
      vi.spyOn(keyManager, 'get').mockImplementation((key: string) => {
        if (key === 'KAGGLE_USERNAME') return 'myuser';
        if (key === 'KAGGLE_KEY') return 'secret123';
        return '';
      });

      const creds = kaggleClient.getCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.username).toBe('myuser');
      expect(creds?.key).toBe('secret123');
      expect(creds?.source).toBe('vault');
      expect(kaggleClient.hasCredentials()).toBe(true);
    });

    it('resolves credentials from process.env fallback', () => {
      vi.spyOn(keyManager, 'get').mockReturnValue('');
      process.env.KAGGLE_USERNAME = 'env_user';
      process.env.KAGGLE_KEY = 'env_key';

      const creds = kaggleClient.getCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.username).toBe('env_user');
      expect(creds?.key).toBe('env_key');
      expect(creds?.source).toBe('env');
    });
  });

  describe('Live Credential Validation', () => {
    it('fails gracefully when username or key is missing', async () => {
      const res = await kaggleClient.validateCredentials('', '');
      expect(res.valid).toBe(false);
      expect(res.message).toContain('Kaggle requires both');
    });

    it('succeeds when Kaggle API returns HTTP 200', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ kernels: [] }),
      } as unknown as Response);

      const res = await kaggleClient.validateCredentials('testuser', 'validkey');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.kaggle.com/v1/kernels.KernelsApiService/ListKernels',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic '),
          }),
        }),
      );
      expect(res.valid).toBe(true);
      expect(res.username).toBe('testuser');
      expect(res.message).toContain('Kaggle GPU access verified successfully');
    });

    it('returns clear error when Kaggle API returns HTTP 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"Unauthenticated"}',
      } as unknown as Response);

      const res = await kaggleClient.validateCredentials('testuser', 'badkey');
      expect(res.valid).toBe(false);
      expect(res.message).toContain('Invalid Kaggle credentials (HTTP 401)');
    });

    it('handles network failure with descriptive error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection timed out'));

      const res = await kaggleClient.validateCredentials('testuser', 'key');
      expect(res.valid).toBe(false);
      expect(res.message).toContain('Network error connecting to Kaggle');
    });
  });

  describe('KeyManager Integration', () => {
    it('parses pasted raw kaggle.json in validateKey', async () => {
      const jsonStr = JSON.stringify({ username: 'pasted_user', key: 'pasted_key_12345' });
      const validateSpy = vi.spyOn(kaggleClient, 'validateCredentials').mockResolvedValueOnce({
        valid: true,
        message: 'Success',
      });

      const res = await keyManager.validateKey('KAGGLE_KEY', jsonStr);
      expect(validateSpy).toHaveBeenCalledWith('pasted_user', 'pasted_key_12345');
      expect(res.valid).toBe(true);
    });

    it('synchronizes runtime kaggle.json on saveKeys', () => {
      const result = keyManager.saveKeys({
        KAGGLE_USERNAME: 'sync_user',
        KAGGLE_KEY: 'sync_secret_key',
      });

      expect(result.saved).toBeGreaterThanOrEqual(1);
      expect(process.env.KAGGLE_USERNAME).toBe('sync_user');
      expect(process.env.KAGGLE_KEY).toBe('sync_secret_key');
      expect(process.env.KAGGLE_CONFIG_DIR).toBeDefined();
    });
  });

  describe('Simulation Dispatch Rules', () => {
    it('identifies local simulations that never require Kaggle credentials', () => {
      expect(isLocalSimType('wildfire_spread')).toBe(true);
      expect(isLocalSimType('earthquake_swarm')).toBe(true);
      expect(isLocalSimType('hurricane_landfall')).toBe(true);

      // Heavy 3D CFD types must use Kaggle GPU
      expect(isLocalSimType('flood_inundation')).toBe(false);
      expect(isLocalSimType('tsunami_wave')).toBe(false);
      expect(isLocalSimType('volcanic_eruption')).toBe(false);
      expect(isLocalSimType('landslide')).toBe(false);
    });
  });
});
