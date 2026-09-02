import { getDb } from '../db/index';
import { ensureReasoningTracesTable } from '../db/reasoningTraces';
import { logger } from '../observability/logger';
import { system1, type System1Result } from './system1';
import { system2, type System2Result, type ReasoningStep } from './system2';
import { ExecutionOrchestrator, type FormattedTraceNode } from './executionOrchestrator';
import { MCTSEngine } from './mctsEngine';
import { TreeOfThoughts } from './treeOfThoughts';


// ── Types ───────────────────────────────────────────────────────

export type CognitionMode = 'system1_only' | 'system1_with_verification' | 'system2_full' | 'system2_timed_out';

export interface CognitionResult {
  finalOutput: string;
  mode: CognitionMode;
  system1Result: System1Result | null;
  system2Result: System2Result | null;
  criticScore: number | null;
  traceId: string | null;
  latencyMs: number;
  iterationCount: number;
  flagsForReview: boolean;
}

export interface CognitionTrace {
  traceId: string;
  query: string;
  systemUsed: string;
  traceJson: string;
  durationMs: number;
  finalConfidence: number | null;
  criticScore: number | null;
  iterationCount: number;
}

export type ProgressCallback = (event: string, data: Record<string, unknown>) => void;

// ── System 1 real-data fast path ────────────────────────────────
// System 1's high-confidence match must NEVER emit its canned
// responseTemplate (those carry {variable} placeholders). Instead we map the
// matched intent to a REAL registered tool, execute it, and build the reply
// from the tool's actual output. If no real tool is registered for the intent,
// or the tool fails, we fall through to System 2 — never fabricate data.

const INTENT_TOOL_MAP: Record<string, { tool: string; describe: (r: unknown) => string }> = {
  weather_check: {
    tool: 'weather_forecast',
    describe: describeWeather,
  },
  earthquake_check: {
    tool: 'earthquakes',
    describe: describeEarthquakes,
  },
  aviation: {
    tool: 'flights_all',
    describe: describeFlights,
  },
  quick_scan: {
    tool: 'eonet_events',
    describe: describeEonet,
  },
  hazard_query: {
    tool: 'gdacs',
    describe: describeGdacs,
  },
  space_weather: {
    tool: 'space_weather_kp',
    describe: describeSpaceWeather,
  },
};

function describeWeather(r: unknown): string {
  const d = r as { current?: { temperature_2m?: number; relative_humidity_2m?: number; wind_speed_10m?: number; precipitation?: number; weather_code?: number; pressure_msl?: number } };
  const c = d?.current;
  if (!c || typeof c.temperature_2m !== 'number') return 'Weather tool returned no current conditions.';
  const codeDesc = weatherCodeText(c.weather_code);
  return [
    `Current conditions: ${codeDesc}.`,
    `Temperature ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m ?? 'n/a'}%, wind ${c.wind_speed_10m ?? 'n/a'} km/h, precipitation ${c.precipitation ?? 0} mm/h.`,
  ].join(' ');
}

function describeEarthquakes(r: unknown): string {
  const d = r as { features?: Array<{ properties?: { mag?: number; place?: string; time?: number; depth?: number } }> };
  const feats = (d?.features || []).slice(0, 8);
  if (feats.length === 0) return 'No earthquakes detected in the queried window.';
  const lines = feats.map((f) => {
    const p = f.properties || {};
    const mag = typeof p.mag === 'number' ? `M${p.mag.toFixed(1)}` : 'unknown magnitude';
    const when = p.time ? ` (${new Date(p.time).toISOString()})` : '';
    return `${mag} ${p.place || 'unknown location'}${when}`;
  });
  return `${feats.length} earthquake(s) detected. ${lines.join(' · ')}`;
}

function describeFlights(r: unknown): string {
  const d = r as { states?: unknown[][]; count?: number };
  const n = typeof d?.count === 'number' ? d.count : (Array.isArray(d?.states) ? d.states.length : 0);
  if (n === 0) return 'No aircraft found in the queried area right now.';
  return `${n} aircraft currently tracked in the queried area (live ADS-B/OpenSky).`;
}

function describeEonet(r: unknown): string {
  const d = r as { events?: Array<{ title?: string; categories?: Array<{ title?: string }>; geometry?: Array<{ date?: string }> }> };
  const evts = (d?.events || []).slice(0, 8);
  if (evts.length === 0) return 'No active natural hazard events found near the location.';
  const lines = evts.map((e) => {
    const cats = (e.categories || []).map((c) => c.title).filter(Boolean).join('/') || 'hazard';
    return `${e.title || 'Untitled event'} (${cats})${e.geometry?.[0]?.date ? ` ${new Date(e.geometry[0].date).toISOString().slice(0, 10)}` : ''}`;
  });
  return `${evts.length} active hazard event(s). ${lines.join(' · ')}`;
}

function describeGdacs(r: unknown): string {
  // The /api/gdacs/alerts endpoint returns raw GDACS RSS XML (not JSON).
  const text = typeof r === 'string' ? r : (r as { text?: string })?.text ?? '';
  if (!text || !text.includes('<item>')) {
    // Fall back to a GeoJSON-ish shape if the endpoint ever changes.
    const d = r as { features?: Array<{ properties?: { name?: string; alertlevel?: string; severity?: string; eventtype?: string } }> };
    const feats = (d?.features || []).slice(0, 8);
    if (feats.length === 0) return 'No active GDACS alerts near the location.';
    const lines = feats.map((f) => {
      const p = f.properties || {};
      return `${p.name || 'alert'} (${p.eventtype || 'event'}) — ${p.alertlevel || 'level'}${p.severity ? ` severity ${p.severity}` : ''}`;
    });
    return `${feats.length} active GDACS alert(s). ${lines.join(' · ')}`;
  }
  const titles = [...text.matchAll(/<title>(.*?)<\/title>/g)]
    .map((m) => m[1].trim().replace(/<!\[CDATA\[|\]\]>/g, ''))
    .filter((t) => t && !/^GDACS|^GDACS - This service/i.test(t))
    .slice(0, 6);
  if (titles.length === 0) return 'No active GDACS alerts near the location.';
  return `${titles.length} active GDACS alert(s). ${titles.join(' · ')}`;
}

function describeSpaceWeather(r: unknown): string {
  // /api/space-weather/kp returns NOAA SWPC's raw array-of-arrays:
  // [[timeTag, Kp, estimated, source], ...] — latest row first.
  const rows = Array.isArray(r) ? r : (r as { data?: unknown[] })?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'Space weather (Kp index) data unavailable from NOAA SWPC right now.';
  }
  const latest = rows[0] as Array<string | number | null>;
  const kp = Number(latest[1]);
  if (Number.isFinite(kp)) {
    return `Current Kp index: ${kp.toFixed(1)} (${kpText(kp)}), measured ${String(latest[0] ?? 'recently')}. Source: NOAA SWPC.`;
  }
  return `Kp data loaded from NOAA SWPC (${rows.length} observation(s)).`;
}

function weatherCodeText(code?: number): string {
  const map: Record<number, string> = {
    0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog',
    48: 'depositing rime fog', 51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
    61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain', 71: 'slight snow',
    73: 'moderate snow', 75: 'heavy snow', 80: 'slight rain showers', 81: 'moderate rain showers',
    82: 'violent rain showers', 95: 'thunderstorm', 96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail',
  };
  return code === undefined ? 'unknown' : (map[code] ?? `code ${code}`);
}

function kpText(kp: number): string {
  if (kp <= 2) return 'quiet';
  if (kp <= 4) return 'active';
  if (kp <= 6) return 'storm';
  return 'severe storm';
}

// Test seam — export the System 1 real-data describers so tests can pin them
// against the actual upstream API response shapes (prevents the fast path from
// silently rendering the wrong fields if an endpoint shape changes).
export const __system1Describers = {
  weather: describeWeather,
  earthquakes: describeEarthquakes,
  flights: describeFlights,
  eonet: describeEonet,
  gdacs: describeGdacs,
  spaceWeather: describeSpaceWeather,
  weatherCode: weatherCodeText,
  kp: kpText,
};

// ── Timestamp ───────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CognitiveOrchestrator ───────────────────────────────────────

export class CognitiveOrchestrator {
  private initialized = false;
  private executionOrchestrator: ExecutionOrchestrator | null = null;
  private llmRouter = {
    generateText: async (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => {
      const { omninet } = await import('../ai-router/omninet');
      return omninet.generateText(prompt, opts || {});
    },
  };
  private toolRegistry = {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      const { dynamicTools } = await import('../toolsV2/toolGenerator');
      return dynamicTools.execute(name, args) as unknown as { success: boolean; output: unknown };
    },
    listTools: () => {
      return ['earthquakes', 'weather', 'flights', 'sandbox', 'firms', 'eonet', 'tectonic',
        'cctv', 'space_debris', 'lightning', 'gdacs', 'vaac', 'submarine_cables',
        'electricity_grid', 'aurora', 'iss', 'openflights', 'adsb'];
    },
  };

  async init(): Promise<void> {
    if (this.initialized) return;
    await system1.init();
    this.ensureTables();
    this.executionOrchestrator = new ExecutionOrchestrator(
      null as unknown as MCTSEngine,
      null as unknown as TreeOfThoughts,
      this.llmRouter,
      this.toolRegistry,
    );
    this.initialized = true;
    logger.info('CognitiveOrchestrator initialized with MCTS/ToT');
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      ensureReasoningTracesTable(db);
    } catch { /* table exists */ }
  }

  async processQuery(
    query: string,
    context?: { location?: string; lat?: number; lon?: number; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<CognitionResult> {
    const start = Date.now();
    await this.ensureReady();

    // Phase 1: System 1 fast path
    onProgress?.('reasoning', { phase: 'system1', text: 'Checking fast intuition cache...' });
    const s1Result = await system1.classify(query);

    // Decision: which mode?
    const isHighConfidence = s1Result.match !== null && s1Result.match.similarity >= 0.92;
    const isMediumConfidence = s1Result.match !== null && s1Result.match.similarity >= 0.7 && s1Result.match.similarity < 0.92;

    if (isHighConfidence && !s1Result.isAnomaly) {
      onProgress?.('reasoning', { phase: 'system1', text: 'Fast match found — resolving with real data...' });

      // System 1 must NEVER return its canned template. Resolve the matched
      // intent through a REAL registered tool and build the reply from actual
      // data. Falls back to System 2 when no real tool is mapped or it fails.
      const mapping = INTENT_TOOL_MAP[s1Result.match!.intent];
      if (mapping) {
        const realOutput = await this.resolveSystem1WithRealData(mapping.tool, s1Result.match!.intent, context);
        if (realOutput !== null) {
          const result: CognitionResult = {
            finalOutput: realOutput,
            mode: 'system1_only',
            system1Result: s1Result,
            system2Result: null,
            criticScore: null,
            traceId: null,
            latencyMs: Date.now() - start,
            iterationCount: 0,
            flagsForReview: false,
          };
          logger.info({ query: query.slice(0, 50), mode: 'system1_only', latency: result.latencyMs }, 'S1 fast path (real data)');
          return result;
        }
        onProgress?.('reasoning', { phase: 'system1', text: 'Fast-path tool unavailable — escalating to deep reasoning...' });
      } else {
        onProgress?.('reasoning', { phase: 'system1', text: 'No fast-path tool for this intent — escalating to deep reasoning...' });
      }
    }

    // Phase 2: Determine if we need System 2
    const needsFullSystem2 = !s1Result.match || s1Result.isAnomaly || s1Result.match.similarity < 0.7;

    if (isMediumConfidence && !s1Result.isAnomaly) {
      // S1 response + S2 verification in parallel. Prefer a REAL data answer
      // (registered tool for the matched intent) over the canned template so
      // users never see unfilled {placeholders}. Falls back to the template
      // only when no real tool exists.
      onProgress?.('reasoning', { phase: 'verification', text: 'Running deep verification in background...' });

      const s2Promise = this.runSystem2WithTimeout(query, context, 10000, onProgress);

      // Try the real-data fast path first (weather → live conditions, etc.).
      const realOutput = s1Result.match
        ? await this.resolveSystem1WithRealData(
            INTENT_TOOL_MAP[s1Result.match.intent]?.tool || '',
            s1Result.match.intent,
            context,
          )
        : null;

      const s2Result = await s2Promise;

      // Raw template would leak {conditions}/{temp} placeholders — never show it.
      // Fill remaining {vars} with generic text so the reply is always readable.
      const fillTemplate = (tpl: string): string =>
        tpl.replace(/\{[a-zA-Z_]+\}/g, (m) => {
          const k = m.slice(1, -1);
          return k === 'city' ? (context?.location || 'this location') : 'n/a';
        });

      const initialOutput = realOutput || fillTemplate(s1Result.match!.responseTemplate);

      if (s2Result.timeout) {
        // S2 took too long — return S1 response with indicator
        const result: CognitionResult = {
          finalOutput: `${initialOutput}\n\n---\n🤔 Thinking deeper... Analyzing relationships, running simulations, and cross-referencing data. Full results will appear shortly.`,
          mode: 'system1_with_verification',
          system1Result: s1Result,
          system2Result: s2Result.result,
          criticScore: null,
          traceId: null,
          latencyMs: Date.now() - start,
          iterationCount: 0,
          flagsForReview: false,
        };

        // Store the trace for later retrieval
        if (s2Result.result) {
          const traceId = await this.storeTrace(query, 'system2', s2Result.result.reasoningTrace, Date.now() - start, s2Result.result.finalConfidence, null, s2Result.result.reasoningTrace.length);
          result.traceId = traceId;
        }

        logger.info({ query: query.slice(0, 50), mode: 'system1_timeout', latency: result.latencyMs }, 'S1 with pending S2');
        return result;
      }

      if (!s2Result.result) {
        const result: CognitionResult = {
          finalOutput: initialOutput,
          mode: 'system1_only',
          system1Result: s1Result,
          system2Result: null,
          criticScore: null,
          traceId: null,
          latencyMs: Date.now() - start,
          iterationCount: 0,
          flagsForReview: false,
        };
        return result;
      }

      // S2 completed in time — verify and synthesize
      const { finalSynthesis, criticScore, iterations } = await system2.verifyAndRevise(
        s2Result.result.synthesis,
        query,
      );

      const traceId = await this.storeTrace(
        query, 'system1_with_verification', s2Result.result.reasoningTrace,
        Date.now() - start, s2Result.result.finalConfidence, criticScore, iterations,
      );

      const result: CognitionResult = {
        finalOutput: finalSynthesis,
        mode: 'system1_with_verification',
        system1Result: s1Result,
        system2Result: s2Result.result,
        criticScore,
        traceId,
        latencyMs: Date.now() - start,
        iterationCount: iterations,
        flagsForReview: criticScore < 0.7 && iterations >= 2,
      };

      logger.info({ query: query.slice(0, 50), mode: 'system1_verified', criticScore, latency: result.latencyMs }, 'S1+S2 verified');
      return result;
    }

    // Full System 2 reasoning
    onProgress?.('reasoning', { phase: 'system2', text: 'Running deep cognitive analysis...' });

    const s2FullResult = await this.runSystem2WithHardTimeout(query, context, 45000, onProgress);

    const { finalSynthesis, criticScore, iterations } = await system2.verifyAndRevise(
      s2FullResult.synthesis,
      query,
    );

    const traceId = await this.storeTrace(
      query, 'system2_full', s2FullResult.reasoningTrace,
      Date.now() - start, s2FullResult.finalConfidence, criticScore, iterations,
    );

    const result: CognitionResult = {
      finalOutput: finalSynthesis,
      mode: needsFullSystem2 ? 'system2_full' : 'system1_with_verification',
      system1Result: s1Result,
      system2Result: s2FullResult,
      criticScore,
      traceId,
      latencyMs: Date.now() - start,
      iterationCount: iterations,
      flagsForReview: criticScore < 0.7 && iterations >= 2,
    };

    if (result.flagsForReview) {
      logger.warn({ query: query.slice(0, 50), criticScore, traceId }, 'Response flagged for human review');
    }

    logger.info({ query: query.slice(0, 50), mode: result.mode, criticScore, latency: result.latencyMs }, 'Cognition complete');
    return result;
  }

  // ── System 2 with timeout ────────────────────────────────────

  /**
   * Execute the real tool mapped to a System 1 intent and render a reply from
   * its ACTUAL output. When the caller supplies lat/lon (from intent routing),
   * those are forwarded to location-aware tools so the reply reflects real
   * data for the asked-about place, not the tool default. Returns null when
   * the tool is unregistered, fails, or returns nothing usable — in which case
   * the caller escalates to System 2.
   */
  private async resolveSystem1WithRealData(
    toolName: string,
    intent: string,
    context?: { location?: string; lat?: number; lon?: number },
  ): Promise<string | null> {
    try {
      const { dynamicTools } = await import('../toolsV2/toolGenerator');
      if (!dynamicTools.get(toolName)) return null;
      const args: Record<string, unknown> = {};
      const lat = typeof context?.lat === 'number' ? context.lat : undefined;
      const lon = typeof context?.lon === 'number' ? context.lon : undefined;
      const hasCoords = lat !== undefined && lon !== undefined;
      if (hasCoords) {
        args['lat'] = lat;
        args['lon'] = lon;
        // Earthquakes/quick-scan endpoints accept a bbox; a small box around
        // the queried location keeps answers local to the place the user asked
        // about instead of the whole planet.
        if (intent === 'earthquake_check' || intent === 'quick_scan') {
          args['bbox'] = `${lon - 4},${lat - 4},${lon + 4},${lat + 4}`;
        }
      }
      const result = await dynamicTools.execute(toolName, args);
      const describe = INTENT_TOOL_MAP[intent]?.describe;
      if (!describe) return null;
      const summary = describe(result);
      if (!summary) return null;
      const place = context?.location ? ` near ${context.location}` : '';
      return `## System 1 fast path (live data${place})\n\n${summary}`;
    } catch (e) {
      logger.warn({ err: (e as Error).message, toolName }, 'System 1 real-data resolution failed');
      return null;
    }
  }

  private async runSystem2WithTimeout(
    query: string,
    context?: { location?: string; intent?: string },
    timeoutMs = 10000,
    onProgress?: ProgressCallback,
  ): Promise<{ result: System2Result | null; timeout: boolean }> {
    try {
      const result = await Promise.race([
        system2.plan(query, context),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);

      if (result === null) {
        // Background: continue S2 and store result for later push
        this.runSystem2Background(query, context, onProgress);
        return { result: null, timeout: true };
      }

      return { result, timeout: false };
    } catch {
      return { result: null, timeout: false };
    }
  }

  private async runSystem2Background(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<void> {
    try {
      const fullResult = await system2.plan(query, context);
      const { finalSynthesis, criticScore } = await system2.verifyAndRevise(
        fullResult.synthesis,
        query,
      );

      const traceId = await this.storeTrace(
        query, 'system2_background', fullResult.reasoningTrace,
        0, fullResult.finalConfidence, criticScore, 2,
      );

      onProgress?.('system2_complete', {
        traceId,
        synthesis: finalSynthesis,
        confidence: fullResult.finalConfidence,
        criticScore,
      });

      logger.info({ query: query.slice(0, 50), traceId }, 'Background S2 complete — ready for push');
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Background S2 failed');
    }
  }

  // ── System 2 with hard wall-clock timeout ─────────────────────
  // Prevents the entire deep reasoning path (MCTS/ToT) from hanging
  // the chat. When the budget is exceeded the caller should fall through
  // to the generic LLM streaming path instead of blocking forever.
  private async runSystem2WithHardTimeout(
    query: string,
    context?: { location?: string; intent?: string },
    timeoutMs = 45000,
    onProgress?: ProgressCallback,
  ): Promise<System2Result> {
    try {
      const result = await Promise.race([
        this.runSystem2Full(query, context, onProgress),
        new Promise<System2Result>((resolve) => {
          setTimeout(() => {
            onProgress?.('reasoning', { phase: 'timeout', text: 'Deep reasoning timed out — synthesizing partial results' });
            resolve({
              plan: [],
              debate: null,
              causalGraph: null,
              counterfactuals: [],
              hypotheses: [],
              reasoningTrace: [{ step: 1, type: 'decomposition' as const, description: 'Timed out after ' + (timeoutMs / 1000) + 's', input: query, output: 'partial', confidence: 0.3 }],
              synthesis: 'The deep reasoning took too long. I will provide what I can based on available information, or you can try rephrasing the question more specifically.',
              finalConfidence: 0.3,
            });
          }, timeoutMs);
        }),
      ]);
      return result;
    } catch {
      return {
        plan: [], debate: null, causalGraph: null, counterfactuals: [],
        hypotheses: [], reasoningTrace: [],
        synthesis: 'Analysis was interrupted. Please try a simpler or more specific question.',
        finalConfidence: 0,
      };
    }
  }

  // ── Full System 2 with MCTS/ToT ──────────────────────────────

  private async runSystem2Full(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<System2Result> {
    const strategy = this.executionOrchestrator
      ? this.executionOrchestrator.selectStrategy(query)
      : 'tot';

    if (strategy === 'mcts' && this.executionOrchestrator) {
      onProgress?.('reasoning', { phase: 'mcts', text: 'Running MCTS deep search (multi-tool query)...' });
      try {
        const mctsResult = await this.executionOrchestrator.executeWithMCTS(
          query,
          { ...(context || {}), strategy: 'mcts' },
        );
        onProgress?.('reasoning', { phase: 'mcts', text: `MCTS complete: ${mctsResult.trace.length} steps explored` });

        return {
          plan: [],
          debate: null,
          causalGraph: null,
          counterfactuals: [],
          hypotheses: mctsResult.trace
            .filter(n => n.action.startsWith('HYPOTHESIS:'))
            .map((n, _i) => ({
              statement: n.action.replace('HYPOTHESIS:', '').trim(),
              probability: n.visits > 0 ? Math.round((n.value / n.visits) * 100) / 100 : 0.5,
              evidenceFor: [],
              evidenceAgainst: [],
              timeframe: 'current',
            })),
          reasoningTrace: mctsResult.trace.map((n, i) => ({
            step: i + 1,
            type: 'decomposition' as const,
            description: n.action,
            input: query,
            output: `value=${(n.visits > 0 ? n.value / n.visits : 0).toFixed(2)} visits=${n.visits}`,
            confidence: n.visits > 0 ? Math.min(1, n.value / n.visits) : 0.5,
          })),
          synthesis: mctsResult.result as string,
          finalConfidence: mctsResult.confidence,
        };
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'MCTS failed, falling back to System 2');
      }
    }

    if (strategy === 'tot' && this.executionOrchestrator) {
      onProgress?.('reasoning', { phase: 'tot', text: 'Running Tree-of-Thoughts reasoning (analytical query)...' });
      try {
        const totResult = await this.executionOrchestrator.executeWithToT(
          query,
          { ...(context || {}), strategy: 'tot' },
        );
        onProgress?.('reasoning', { phase: 'tot', text: `ToT complete: ${totResult.trace.length} reasoning steps` });

        return {
          plan: [],
          debate: null,
          causalGraph: null,
          counterfactuals: [],
          hypotheses: totResult.trace
            .filter(n => n.action.startsWith('HYPOTHESIS:'))
            .map((n, _i) => ({
              statement: n.action.replace('HYPOTHESIS:', '').trim(),
              probability: n.visits > 0 ? Math.round((n.value / n.visits) * 100) / 100 : 0.5,
              evidenceFor: [],
              evidenceAgainst: [],
              timeframe: 'current',
            })),
          reasoningTrace: totResult.trace.map((n, i) => ({
            step: i + 1,
            type: 'decomposition' as const,
            description: n.action,
            input: query,
            output: `confidence=${(n.visits > 0 ? n.value / n.visits : n.prior).toFixed(2)}`,
            confidence: n.visits > 0 ? Math.min(1, n.value / n.visits) : n.prior,
          })),
          synthesis: totResult.result as string,
          finalConfidence: totResult.confidence,
        };
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'ToT failed, falling back to System 2');
      }
    }

    onProgress?.('reasoning', { phase: 'system2', text: 'Running standard deep reasoning...' });
    return system2.plan(query, context);
  }

  // ── Trace Storage ─────────────────────────────────────────────

  private async storeTrace(
    query: string,
    systemUsed: string,
    steps: ReasoningStep[],
    durationMs: number,
    finalConfidence: number | null,
    criticScore: number | null,
    iterationCount: number,
  ): Promise<string> {
    const traceId = uuid();
    const needsReview = (criticScore !== null && criticScore < 0.7 && iterationCount >= 2) ? 1 : 0;

    try {
      const db = getDb();
      const visualSteps = steps.map((step, index) => ({
        type: this.toExplainabilityStepType(step.type),
        description: step.description || step.output || step.type,
        evidence: step.output || step.input,
        confidence: step.confidence,
        timestamp: Date.now() + index,
        metadata: {
          cognitiveType: step.type,
          input: step.input,
          output: step.output,
          step: step.step,
        },
      }));
      const confidence = finalConfidence ?? criticScore ?? 0;
      const traceJson = JSON.stringify(steps);
      const stepsJson = JSON.stringify(visualSteps);
      db.prepare(
        `INSERT OR REPLACE INTO reasoning_traces
         (trace_id, interaction_id, user_id, query, response, system_used, trace_json, steps_json,
          duration_ms, total_duration_ms, final_confidence, confidence, critic_score, iteration_count,
          needs_review, model_used, intent_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        traceId, traceId, 'system', query.slice(0, 500), '', systemUsed, traceJson, stepsJson,
        durationMs, durationMs, finalConfidence, confidence, criticScore, iterationCount,
        needsReview, systemUsed, systemUsed, now(),
      );
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to store reasoning trace');
    }

    return traceId;
  }

  private toExplainabilityStepType(type: string): 'thought' | 'tool_call' | 'tool_result' | 'observation' | 'inference' | 'conclusion' {
    if (type === 'decomposition' || type === 'hypothesis') return 'thought';
    if (type === 'causal_analysis' || type === 'counterfactual') return 'inference';
    if (type === 'verification') return 'observation';
    if (type === 'synthesis' || type === 'debate') return 'conclusion';
    return 'inference';
  }

  // ── Trace Retrieval ───────────────────────────────────────────

  getTrace(traceId: string): CognitionTrace | null {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM reasoning_traces WHERE trace_id = ?',
      ).get(traceId) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      };
    } catch {
      return null;
    }
  }

  getTracesForQuery(query: string, limit = 5): CognitionTrace[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM reasoning_traces WHERE query = ? ORDER BY created_at DESC LIMIT ?',
      ).all(query, limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      }));
    } catch {
      return [];
    }
  }

  getPendingReview(limit = 20): CognitionTrace[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM reasoning_traces WHERE needs_review = 1 ORDER BY created_at DESC LIMIT ?',
      ).all(limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      }));
    } catch {
      return [];
    }
  }

  // ── MCTS/ToT Trace Visualization ─────────────────────────────

  getReasoningTree(traceId: string): { trace: FormattedTraceNode[]; summary: Record<string, unknown> } | null {
    const trace = this.getTrace(traceId);
    if (!trace) return null;

    try {
      const steps = JSON.parse(trace.traceJson) as ReasoningStep[];
      const nodes: FormattedTraceNode[] = steps.map((s, i) => ({
        id: `step_${i}`,
        action: s.description,
        depth: i,
        value: s.confidence,
        visits: 1,
        children: [],
      }));

      for (let i = 1; i < nodes.length; i++) {
        nodes[i - 1].children.push(nodes[i]);
      }

      const roots = nodes.length > 0 ? [nodes[0]] : [];

      return {
        trace: roots,
        summary: {
          query: trace.query,
          systemUsed: trace.systemUsed,
          durationMs: trace.durationMs,
          finalConfidence: trace.finalConfidence,
          criticScore: trace.criticScore,
          stepCount: steps.length,
        },
      };
    } catch {
      return null;
    }
  }

  getExecutionOrchestrator(): ExecutionOrchestrator | null {
    return this.executionOrchestrator;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}

export const cognitiveOrchestrator = new CognitiveOrchestrator();
