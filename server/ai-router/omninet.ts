import { getDb } from '../db/index';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

type ProviderType = 'openai-compatible' | 'gemini' | 'claude' | 'ollama' | 'local-transformers' | 'local-onnx' | 'huggingface';
type ProviderTier = 1 | 2 | 3 | 4;
type HealthStatus = 'healthy' | 'degraded' | 'down';
type CircuitState = 'closed' | 'open' | 'half-open';
export type Complexity = 'simple' | 'medium' | 'complex' | 'reasoning';

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  baseUrl?: string;
  models: string[];
  rateLimit: number;
  tier: ProviderTier;
  local?: boolean;
  apiKeyEnvVar?: string;
  supportsEmbeddings?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
}

interface ProviderState {
  config: ProviderConfig;
  status: HealthStatus;
  lastChecked: number;
  failureCount: number;
  consecutiveSuccesses: number;
  circuitState: CircuitState;
  circuitFailures: number;
  circuitOpenedAt: number;
  tokens: number;
  lastTokenRefill: number;
  totalRequests: number;
  totalTokens: number;
  estimatedCost: number;
  lastLatency: number;
}

export interface RouteResult {
  provider: string;
  model: string;
  estimatedLatency: number;
}

export interface OmninetOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  stream?: boolean;
  signal?: AbortSignal;
}

// ── Provider Registry ───────────────────────────────────────────

const PROVIDER_CONFIGS: ProviderConfig[] = [
  { name: 'groq', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], rateLimit: 20, tier: 1, apiKeyEnvVar: 'GROQ_API_KEY', supportsStreaming: true },
  { name: 'cerebras', type: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', models: ['llama-3.3-70b'], rateLimit: 1, tier: 1, apiKeyEnvVar: 'CEREBRAS_API_KEY', supportsStreaming: true },
  { name: 'sambanova', type: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1', models: ['llama-3.1-8b'], rateLimit: 10, tier: 1, apiKeyEnvVar: 'SAMBANOVA_API_KEY', supportsStreaming: true },
  { name: 'gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'], rateLimit: 60, tier: 2, apiKeyEnvVar: 'GOOGLE_GEMINI_API_KEY', supportsStreaming: true, supportsVision: true },
  { name: 'openrouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-r1', 'qwen/qwen3-235b', 'meta-llama/llama-4-scout'], rateLimit: 200, tier: 2, apiKeyEnvVar: 'OPENROUTER_API_KEY', supportsStreaming: true },
  { name: 'together', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3-70b'], rateLimit: 60, tier: 2, apiKeyEnvVar: 'TOGETHER_API_KEY', supportsStreaming: true },
  { name: 'deepseek', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], rateLimit: 50, tier: 3, apiKeyEnvVar: 'DEEPSEEK_API_KEY', supportsStreaming: true },
  { name: 'claude', type: 'claude', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-3-haiku'], rateLimit: 5, tier: 3, apiKeyEnvVar: 'ANTHROPIC_API_KEY', supportsStreaming: true },
  { name: 'ollama', type: 'ollama', baseUrl: 'http://localhost:11434', models: ['llama3', 'mistral'], rateLimit: 9999, tier: 4, local: true, supportsStreaming: true, supportsEmbeddings: true },
  { name: 'xenova', type: 'local-transformers', models: ['Xenova/all-MiniLM-L6-v2'], rateLimit: 9999, tier: 4, local: true, supportsEmbeddings: true },
  { name: 'huggingface', type: 'huggingface', baseUrl: 'https://api-inference.huggingface.co', models: ['meta-llama/Llama-3.1-8B'], rateLimit: 10, tier: 4, apiKeyEnvVar: 'HUGGINGFACE_API_KEY', supportsEmbeddings: true },
  { name: 'onnx', type: 'local-onnx', models: ['onnx-model-path'], rateLimit: 9999, tier: 4, local: true, supportsEmbeddings: true },
];

// ── Query Classification ─────────────────────────────────────────

export function classifyComplexity(query: string): Complexity {
  if (!query || query.length < 20) return 'simple';

  const lower = query.toLowerCase();

  if (/^\d+\s*[+\-*/]\s*\d/.test(lower) || lower.includes('calculate') || lower.includes('compute') || lower.includes('reason') || lower.includes('logic') || lower.includes('proof') || lower.includes('equation') || lower.includes('formula') || lower.includes('solve')) {
    return 'reasoning';
  }

  if (lower.includes('compare') || lower.includes('correlation') || lower.includes('versus') || lower.includes(' vs ') || lower.includes('synthesize') || lower.includes('comprehensive') || lower.includes('detailed analysis') || lower.includes('research') || lower.includes('investigate')) {
    return 'complex';
  }

  if (lower.includes('weather') || lower.includes('earthquake') || lower.includes('hazard') || lower.includes('risk') || lower.includes('forecast') || lower.includes('scan') || lower.includes('what is') || lower.includes('show me') || lower.includes('status') || lower.includes('check')) {
    return 'medium';
  }

  return 'medium';
}

// ── Omninet ──────────────────────────────────────────────────────

export class Omninet {
  private providers: ProviderState[] = [];
  private initialized = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private localPipeline: ((text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>) | null = null;
  private localPipelinePromise: Promise<((text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>) | null> | null = null;
  private monthlyBudgetCap = 0;

  init(): void {
    if (this.initialized) return;
    this.providers = PROVIDER_CONFIGS.map(config => {
      const saved = this.loadState(config.name);
      return {
        config,
        status: config.local ? 'healthy' : ((saved?.status as HealthStatus) || 'healthy'),
        lastChecked: (saved?.lastChecked as number) || 0,
        failureCount: (saved?.failureCount as number) || 0,
        consecutiveSuccesses: (saved?.consecutiveSuccesses as number) || 0,
        circuitState: 'closed',
        circuitFailures: 0,
        circuitOpenedAt: 0,
        tokens: (saved?.tokens as number) ?? config.rateLimit,
        lastTokenRefill: (saved?.lastTokenRefill as number) || Date.now(),
        totalRequests: (saved?.totalRequests as number) || 0,
        totalTokens: (saved?.totalTokens as number) || 0,
        estimatedCost: (saved?.estimatedCost as number) || 0,
        lastLatency: (saved?.lastLatency as number) || 1000,
      };
    });
    this.initialized = true;
    this.ensureTable();
    this.startHealthChecks();
    logger.info({ providerCount: this.providers.length }, 'Omninet initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS provider_stats (
        provider_name TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'healthy',
        last_checked INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        consecutive_successes INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 60,
        last_token_refill INTEGER NOT NULL DEFAULT 0,
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        last_latency INTEGER NOT NULL DEFAULT 1000,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch { /* table exists */ }
  }

  private loadState(providerName: string): Record<string, unknown> | null {
    try {
      const db = getDb();
      return db.prepare('SELECT * FROM provider_stats WHERE provider_name = ?').get(providerName) as Record<string, unknown> | undefined || null;
    } catch { return null; }
  }

  private persistState(state: ProviderState): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO provider_stats (provider_name, status, last_checked, failure_count, consecutive_successes, tokens, last_token_refill, total_requests, total_tokens, estimated_cost, last_latency, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(provider_name) DO UPDATE SET
          status = excluded.status, last_checked = excluded.last_checked, failure_count = excluded.failure_count,
          consecutive_successes = excluded.consecutive_successes, tokens = excluded.tokens,
          last_token_refill = excluded.last_token_refill, total_requests = excluded.total_requests,
          total_tokens = excluded.total_tokens, estimated_cost = excluded.estimated_cost,
          last_latency = excluded.last_latency, updated_at = excluded.updated_at
      `).run(
        state.config.name, state.status, state.lastChecked, state.failureCount,
        state.consecutiveSuccesses, state.tokens, state.lastTokenRefill,
        state.totalRequests, state.totalTokens, state.estimatedCost, state.lastLatency,
      );
    } catch { /* persist failed */ }
  }

  shutdown(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    for (const state of this.providers) {
      this.persistState(state);
    }
  }

  // ── Health Monitoring ─────────────────────────────────────────

  private startHealthChecks(): void {
    this.healthTimer = setInterval(async () => {
      for (const state of this.providers) {
        if (state.config.local) continue;
        const apiKey = state.config.apiKeyEnvVar ? process.env[state.config.apiKeyEnvVar] : undefined;
        if (!apiKey) continue;
        try {
          await this.healthPing(state);
          state.consecutiveSuccesses++;
          state.failureCount = 0;
          if (state.consecutiveSuccesses >= 3) state.status = 'healthy';
        } catch {
          state.failureCount++;
          state.consecutiveSuccesses = 0;
          if (state.failureCount >= 5) state.status = 'down';
          else if (state.failureCount >= 3) state.status = 'degraded';
        }
        state.lastChecked = Date.now();
        this.persistState(state);
      }
    }, 30000);
  }

  private async healthPing(state: ProviderState): Promise<void> {
    const start = Date.now();
    const config = state.config;
    const model = config.models[0];

    await this.executeProviderCall(config, model, 'hi', { maxTokens: 1, temperature: 0.1, signal: AbortSignal.timeout(10000) });
    state.lastLatency = Date.now() - start;
  }

  // ── Token Bucket Rate Limiting ────────────────────────────────

  private refillTokens(state: ProviderState): void {
    const now = Date.now();
    const elapsed = now - state.lastTokenRefill;
    const refillAmount = Math.floor(elapsed / 60000 * state.config.rateLimit);
    if (refillAmount > 0) {
      state.tokens = Math.min(state.config.rateLimit, state.tokens + refillAmount);
      state.lastTokenRefill = now;
    }
  }

  private consumeToken(state: ProviderState): boolean {
    this.refillTokens(state);
    if (state.tokens < 1) return false;
    state.tokens--;
    return true;
  }

  // ── Complexity to Tier Mapping ─────────────────────────────────

  private complexityToTier(complexity: Complexity): ProviderTier {
    switch (complexity) {
      case 'simple': return 1;
      case 'medium': return 2;
      case 'complex': return 3;
      case 'reasoning': return 3;
    }
  }

  // ── Routing Logic ─────────────────────────────────────────────

  route(query: string, complexity: Complexity, preferredModel?: string): RouteResult {
    this.ensureInit();
    const targetTier = this.complexityToTier(complexity);
    const eligible = this.providers.filter(s => {
      if (s.status === 'down') return false;
      if (s.circuitState === 'open') {
        if (Date.now() - s.circuitOpenedAt > 30000) s.circuitState = 'half-open';
        else return false;
      }
      if (s.config.apiKeyEnvVar && !process.env[s.config.apiKeyEnvVar] && !s.config.local) return false;
      this.refillTokens(s);
      if (s.tokens < 1) return false;
      if (s.config.tier === 3 && this.monthlyBudgetCap <= 0) return false;
      return true;
    });

    const sorted = eligible.sort((a, b) => {
      const aTierDiff = Math.abs(a.config.tier - targetTier);
      const bTierDiff = Math.abs(b.config.tier - targetTier);
      if (aTierDiff !== bTierDiff) return aTierDiff - bTierDiff;
      if (a.config.tier !== b.config.tier) return a.config.tier - b.config.tier;
      return a.lastLatency - b.lastLatency;
    });

    if (sorted.length > 0) {
      const selected = sorted[0];
      const model = preferredModel && selected.config.models.includes(preferredModel) ? preferredModel : selected.config.models[0];
      return { provider: selected.config.name, model, estimatedLatency: selected.lastLatency || 1000 };
    }

    const fallbackLocal = this.providers.find(s => s.config.local && s.config.type === 'ollama');
    if (fallbackLocal) {
      return { provider: 'ollama', model: 'llama3', estimatedLatency: 100 };
    }
    throw new OmninetError('All AI providers unavailable. Check API keys and provider status.', []);
  }

  // ── Provider API Call ─────────────────────────────────────────

  private async executeProviderCall(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions): Promise<string> {
    const timeout = options?.signal ? undefined : 30000;
    const signal = options?.signal || (timeout ? AbortSignal.timeout(timeout) : undefined);

    switch (config.type) {
      case 'openai-compatible':
        return this.callOpenAI(config, model, prompt, options, signal);
      case 'gemini':
        return this.callGemini(config, model, prompt, options, signal);
      case 'claude':
        return this.callClaude(config, model, prompt, options, signal);
      case 'ollama':
        return this.callOllama(config, model, prompt, options, signal);
      case 'huggingface':
        return this.callHuggingFace(config, model, prompt, options, signal);
      default:
        throw new Error(`${config.name}: unsupported type ${config.type}`);
    }
  }

  private async callOpenAI(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env[config.apiKeyEnvVar!];
    const resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt.slice(0, 32000) }],
        max_tokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.3,
      }),
    });
    if (!resp.ok) throw new Error(`${config.name} HTTP ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content as string || '';
  }

  private async callGemini(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env[config.apiKeyEnvVar!] || process.env.GOOGLE_GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('Gemini API key not configured. Set GOOGLE_GEMINI_API_KEY in server/.env');

    // Try multiple models in order of preference — if the first fails with 429/404, try the next
    const modelsToTry = [model, ...config.models.filter(m => m !== model)];
    let lastError: Error | undefined;
    let bestError: Error | undefined; // Keep the first actionable error (quota > generic)

    for (const currentModel of modelsToTry) {
      const maxRetries = 1;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const base = Math.min(1000 * Math.pow(2, attempt), 16000);
          const jitter = Math.random() * 1000;
          await new Promise(r => setTimeout(r, base + jitter));
          if (signal?.aborted) throw new Error('Request aborted');
        }
        try {
          const attemptSignal = signal || AbortSignal.timeout(30000);
          const resp = await fetch(`${config.baseUrl}/models/${currentModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: attemptSignal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt.slice(0, 16000) }] }],
              generationConfig: { temperature: options?.temperature ?? 0.3, maxOutputTokens: options?.maxTokens ?? 2048 },
              toolConfig: { functionCallingConfig: { mode: 'NONE' } },
            }),
          });
          if (resp.status === 429 || resp.status === 503) {
            const body = await resp.text().catch(() => '');
            const isQuota = body.includes('quota');
            const err = new Error(`Gemini ${currentModel}: HTTP ${resp.status}${isQuota ? ' (quota exceeded — enable Generative Language API at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com)' : ' (transient)'}`);
            lastError = err;
            // Prefer the first actionable error (quota) over later generic ones
            if (isQuota && !bestError) bestError = err;
            else if (!bestError) bestError = err;
            logger.warn({ status: resp.status, model: currentModel, attempt: attempt + 1, isQuota }, 'Gemini transient error, retrying');
            continue;
          }
          if (resp.status === 404) {
            lastError = new Error(`Gemini ${currentModel}: model not found — trying next model`);
            if (!bestError) bestError = lastError;
            logger.info({ model: currentModel }, 'Gemini model not found, trying next');
            break; // break retry loop, try next model
          }
          if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            const err = new Error(`Gemini ${currentModel}: HTTP ${resp.status} — ${body.slice(0, 200)}`);
            lastError = err;
            if (!bestError) bestError = err;
            throw err;
          }
          const data = await resp.json() as Record<string, unknown>;
          const text = (((data.candidates as Array<Record<string, unknown>>)?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
          if (!text && !data.candidates) {
            throw new Error(`Gemini ${currentModel}: empty response — ${JSON.stringify(data).slice(0, 200)}`);
          }
          return text;
        } catch (e) {
          lastError = e as Error;
          if ((e as Error).name === 'AbortError' || (e as Error).message?.includes('abort') || (e as Error).message?.includes('timed out')) {
            throw new Error(`Gemini ${currentModel}: request timed out`);
          }
          if (attempt < maxRetries) continue;
        }
      }
    }
    throw bestError || lastError || new Error('Gemini: all models and retries exhausted. Check API key and billing at https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com');
  }

  private async callClaude(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env[config.apiKeyEnvVar!];
    const resp = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
      signal,
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 1024,
        messages: [{ role: 'user', content: prompt.slice(0, 20000) }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return (data.content as Array<Record<string, unknown>>)?.[0]?.text as string || '';
  }

  private async callOllama(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions, signal?: AbortSignal): Promise<string> {
    const resp = await fetch(`${config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: signal || AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: options?.temperature ?? 0.3, num_predict: options?.maxTokens ?? 2048 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return (data.response as string) || '';
  }

  private async callHuggingFace(config: ProviderConfig, model: string, prompt: string, options?: OmninetOptions, signal?: AbortSignal): Promise<string> {
    const apiKey = process.env[config.apiKeyEnvVar!];
    const resp = await fetch(`${config.baseUrl}/models/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: signal || AbortSignal.timeout(60000),
      body: JSON.stringify({
        inputs: prompt.slice(0, 4000),
        parameters: { max_new_tokens: options?.maxTokens ?? 500, temperature: options?.temperature ?? 0.3 },
      }),
    });
    if (!resp.ok) throw new Error(`HuggingFace HTTP ${resp.status}`);
    const data: unknown = await resp.json();
    return Array.isArray(data) ? ((data as Array<Record<string, unknown>>)[0]?.generated_text as string || '') : ((data as Record<string, unknown>)?.generated_text as string || '');
  }

  // ── Provider Embedding API ─────────────────────────────────────

  private getEmbeddingProviders(): ProviderState[] {
    return this.providers.filter(s => s.config.supportsEmbeddings && s.status !== 'down');
  }

  // ── Circuit Breaker ────────────────────────────────────────────

  private recordFailure(state: ProviderState): void {
    state.circuitFailures++;
    if (state.circuitFailures >= 5) {
      state.circuitState = 'open';
      state.circuitOpenedAt = Date.now();
    }
  }

  private recordSuccess(state: ProviderState): void {
    state.circuitFailures = 0;
    state.circuitState = 'closed';
  }

  // ── Generate Text ─────────────────────────────────────────────

  async generateText(prompt: string, options?: OmninetOptions): Promise<string> {
    this.ensureInit();
    const complexity = classifyComplexity(prompt);
    const routeResult = this.route(prompt, complexity, options?.model);
    let state = this.providers.find(s => s.config.name === routeResult.provider)!;

    let lastError: Error | undefined;
    const backoff = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0 && lastError) {
        await new Promise(r => setTimeout(r, backoff[attempt - 1]));
      }
      try {
        if (!this.consumeToken(state)) {
          throw new OmninetError(`${state.config.name} rate limit exceeded`, [routeResult]);
        }
        const result = await this.executeProviderCall(state.config, routeResult.model, prompt, options);
        state.totalTokens += prompt.length + result.length;
        this.recordSuccess(state);
        this.persistState(state);
        return result;
      } catch (e) {
        lastError = e as Error;
        this.recordFailure(state);
        state.status = 'degraded';
        this.persistState(state);

        if (attempt < 2) {
          const fallbackRoutes = this.getFallbackRoutes(routeResult);
          if (fallbackRoutes.length > 0) {
            const fb = fallbackRoutes[0];
            routeResult.provider = fb.provider;
            routeResult.model = fb.model;
            const fbState = this.providers.find(s => s.config.name === fb.provider);
            if (fbState) state = fbState;
            continue;
          }
        }

        try {
          const localProvider = this.providers.find(s => s.config.local && s.config.type === 'ollama');
          if (localProvider) {
            return await this.executeProviderCall(localProvider.config, 'llama3', prompt, { ...options, maxTokens: 512 });
          }
        } catch { /* local also failed */ }
      }
    }

    throw new OmninetError(
      'All AI providers are currently unavailable. Check API keys and try again later.',
      [{ provider: routeResult.provider, model: routeResult.model, estimatedLatency: 0 }],
    );
  }

  private getFallbackRoutes(current: RouteResult): RouteResult[] {
    return this.providers
      .filter(s => s.config.name !== current.provider && s.status !== 'down' && s.circuitState !== 'open')
      .sort((a, b) => a.config.tier - b.config.tier || a.lastLatency - b.lastLatency)
      .map(s => ({ provider: s.config.name, model: s.config.models[0], estimatedLatency: s.lastLatency }));
  }

  // ── Generate Embedding ────────────────────────────────────────

  async generateEmbedding(text: string): Promise<Float32Array> {
    this.ensureInit();
    if (!text) return new Float32Array(768);

    try {
      return await this.callLocalEmbedding(text);
    } catch {
      // fallback to API-based embedding
      for (const state of this.getEmbeddingProviders()) {
        if (state.config.local) continue; // already tried local
        try {
          return await this.callApiEmbedding(state.config, text);
        } catch { /* try next */ }
      }
    }

    return new Float32Array(768);
  }

  private async callLocalEmbedding(text: string): Promise<Float32Array> {
    if (!this.localPipelinePromise) {
      this.localPipelinePromise = this.initLocalPipeline();
    }
    const pipeline = await this.localPipelinePromise;
    if (!pipeline) throw new Error('Local embedding not available');
    const result = await pipeline(text, { pooling: 'mean', normalize: true });
    return new Float32Array(result.data);
  }

  private async initLocalPipeline(): Promise<((text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>) | null> {
    try {
      const { pipeline: xfPipeline } = await import('@xenova/transformers');
      return await xfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
    } catch {
      return null;
    }
  }

  private async callApiEmbedding(config: ProviderConfig, text: string): Promise<Float32Array> {
    if (config.type === 'gemini') {
      const apiKey = process.env[config.apiKeyEnvVar!] || process.env.GOOGLE_GEMINI_API_KEY || '';
      const resp = await fetch(`${config.baseUrl}/models/embedding-001:embedContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
      const data = await resp.json() as Record<string, unknown>;
      const values = (data.embedding as Record<string, unknown>)?.values as number[];
      if (!values) throw new Error('No embedding values');
      return new Float32Array(values);
    }
    if (config.type === 'openai-compatible') {
      const apiKey = process.env[config.apiKeyEnvVar!];
      const resp = await fetch(`${config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ model: 'text-embedding-ada-002', input: text }),
      });
      if (!resp.ok) throw new Error(`Embedding error: ${resp.status}`);
      const data = await resp.json() as Record<string, unknown>;
      return new Float32Array((data.data as Array<Record<string, unknown>>)?.[0]?.embedding as number[] || []);
    }
    if (config.type === 'ollama') {
      const resp = await fetch(`${config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ model: 'llama3', prompt: text }),
      });
      if (!resp.ok) throw new Error(`Ollama embedding error: ${resp.status}`);
      const data = await resp.json() as Record<string, unknown>;
      return new Float32Array(data.embedding as number[] || []);
    }
    throw new Error(`${config.name}: embedding not supported`);
  }

  // ── Generate Stream ──────────────────────────────────────────

  async *generateStream(prompt: string, options?: OmninetOptions): AsyncGenerator<string, void, unknown> {
    this.ensureInit();
    const complexity = classifyComplexity(prompt);
    const routeResult = this.route(prompt, complexity, options?.model);
    const state = this.providers.find(s => s.config.name === routeResult.provider)!;

    if (!this.consumeToken(state)) {
      yield 'Rate limit exceeded. Please try again shortly.';
      return;
    }

    try {
      const config = state.config;
      const model = routeResult.model;
      const apiKey = config.apiKeyEnvVar ? process.env[config.apiKeyEnvVar] : undefined;

      if (config.type === 'openai-compatible' && apiKey) {
        const resp = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          signal: options?.signal || AbortSignal.timeout(60000),
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt.slice(0, 32000) }],
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0.3,
            stream: true,
          }),
        });
        if (!resp.ok) throw new Error(`${config.name} HTTP ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(trimmed.slice(6));
                const content = chunk.choices?.[0]?.delta?.content || '';
                if (content) yield content;
              } catch { /* skip parse errors */ }
            }
          }
        }
        this.recordSuccess(state);
      } else if (config.type === 'gemini') {
        const gApiKey = process.env[config.apiKeyEnvVar!] || process.env.GOOGLE_GEMINI_API_KEY || '';
        const resp = await fetch(`${config.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${gApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: options?.signal || AbortSignal.timeout(60000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt.slice(0, 16000) }] }],
            generationConfig: { temperature: options?.temperature ?? 0.3, maxOutputTokens: options?.maxTokens ?? 2048 },
          }),
        });
        if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(line.slice(6));
                const content = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (content) yield content;
              } catch { /* skip */ }
            }
          }
        }
        this.recordSuccess(state);
      } else {
        const result = await this.executeProviderCall(config, model, prompt, options);
        yield result;
      }

      state.totalTokens += prompt.length;
      this.persistState(state);
    } catch (e) {
      this.recordFailure(state);
      yield `\n\n[Provider ${state.config.name} failed. ${(e as Error).message}]`;
    }
  }

  // ── Cost Tracking ─────────────────────────────────────────────

  getCostStats(): { totalCost: number; totalRequests: number; byProvider: Record<string, { requests: number; tokens: number; cost: number }> } {
    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {};
    let totalCost = 0;
    let totalRequests = 0;
    for (const s of this.providers) {
      byProvider[s.config.name] = {
        requests: s.totalRequests,
        tokens: s.totalTokens,
        cost: s.estimatedCost,
      };
      totalCost += s.estimatedCost;
      totalRequests += s.totalRequests;
    }
    return { totalCost, totalRequests, byProvider };
  }

  getStatus(): Array<{ name: string; status: HealthStatus; tier: ProviderTier; tokens: number; circuitState: CircuitState; lastLatency: number }> {
    return this.providers.map(s => ({
      name: s.config.name,
      status: s.status,
      tier: s.config.tier,
      tokens: s.tokens,
      circuitState: s.circuitState,
      lastLatency: s.lastLatency,
    }));
  }

  getProviderDetails(): Array<{ name: string; type: string; tier: ProviderTier; status: HealthStatus; models: string[]; rateLimit: number; local: boolean; supportsStreaming: boolean; supportsEmbeddings: boolean; tokens: number; lastLatency: number; lastChecked: number }> {
    return this.providers.map(s => ({
      name: s.config.name,
      type: s.config.type,
      tier: s.config.tier,
      status: s.status,
      models: s.config.models,
      rateLimit: s.config.rateLimit,
      local: !!s.config.local,
      supportsStreaming: !!s.config.supportsStreaming,
      supportsEmbeddings: !!s.config.supportsEmbeddings,
      tokens: s.tokens,
      lastLatency: s.lastLatency,
      lastChecked: s.lastChecked,
    }));
  }

  private ensureInit(): void {
    if (!this.initialized) this.init();
  }
}

export class OmninetError extends Error {
  public fallbackRoutes: RouteResult[];
  constructor(message: string, fallbackRoutes: RouteResult[]) {
    super(message);
    this.name = 'OmninetError';
    this.fallbackRoutes = fallbackRoutes;
  }
}

export const omninet = new Omninet();
