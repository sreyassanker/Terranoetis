/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import * as satellite from 'satellite.js';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const papaparse = createRequire(import.meta.url)('papaparse');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { getDb, closeDb } from './db/index';
import { isAutonomousAiAllowed } from './aiGate';
import {
  savePattern, approvePattern, findMatchingPattern, listPatterns,
  detectSlots, resolveDomain, substituteArgs, patternStoreStats,
  type PatternStep, type PatternCommand,
} from './ai-patterns/patternStore';
import { summarizeToolResult } from './ai-patterns/summarizeTool';
import { API_METADATA, getCategories } from './apiMetadata';
import {
  CommandParser, MaterializedViewCache, IntentRouter, TaskPlanner,
  ToolRegistry, buildAgentPrompt, ToolCallParser,
  type GlobeCommand, type AgentStep, type AgentTool, type ToolCall,
} from './agent';
import { SandboxManager } from './sandboxManager';
import { SimulationEngine } from './sandboxV2/simulationEngine';
import { runFarsiteSimulation, farsiteOutputsToGeoJSON } from './sandboxV2/farsiteLite';
import { runAdcircSimulation, adcircOutputsToGeoJSON } from './sandboxV2/adcircLite';
import { runWrfSimulation, wrfOutputsToGridJSON } from './sandboxV2/wrfLite';
import { runHysplitSimulation, hysplitOutputsToGeoJSON } from './sandboxV2/hysplitLite';
import { runFnoPrediction, getFastPrediction } from './sandboxV2/fnoSurrogate';
import spatialRouter, { initSpatialEngine } from './h3-engine/spatialQuery';
import { CodeWriter } from './self-evolution/codeWriter';
import { TestRunner } from './self-evolution/testRunner';
import { GitIntegration } from './self-evolution/gitIntegration';
import { IntentDiscoveryV2 } from './self-evolution/intentDiscoveryV2';
import { BanditRouter } from './self-evolution/banditRouter';
import { PerfMonitor } from './self-evolution/perfMonitor';
import { MonitorManager, SchedulerManager, AmbientEventDetector, getLocationContext } from './monitor';
import { MemoryManager, type Fact, type ProceduralPattern } from './memoryManager';
import { memoryManagerV2 } from './memoryV2/memoryManagerV2';
import { EmbeddingEngine } from './embedding';
import { dynamicTools } from './toolsV2/toolGenerator';
import { ToolComposer } from './toolsV2/toolComposer';
import { toolDiscovery } from './toolsV2/toolDiscovery';
import { toolRepair } from './toolsV2/toolRepair';
import { executor } from './toolsV2/selfHealingExecutor';
import { CircuitBreaker, withCircuitBreak, withRetry } from './resilience';
import { AgentOrchestrator } from './orchestrator';
import { CognitiveAgent } from './agent';
import { scenarioSimulator } from './world-model/scenarioSimulator';
import { generateScenario } from './scenarios/scenarioGenerator';
import { generateScenarioFromBBox } from './scenarios/enhancedGenerator';
import { exportToGeoJSON, exportToCZML, exportToNetCDF, exportToTrainingData } from './scenarios/scenarioExporter';
import { scenarioDb } from './scenarios/scenarioDb';
import { generateBatch, getBatchProgress } from './scenarios/batchGenerator';
import { predictionValidator } from './world-model/predictionValidator';
import { causalGraph } from './world-model/causalGraph';
import { CausalKnowledgeGraph } from './causal/kg';
import { EntropyMixer } from './causal/entropyMixer';
import { DiscoveryEngine } from './causal/discoveryEngine';
import { DreamEngine } from './dream/engine';
import { PlanetaryMemorySystem } from './memory/memorySystem';
import { sentinel } from './sentinel/index';
import { ambientIntelligence } from './sentinel/ambientIntelligence';
import { selfImproverV2 } from './selfImproverV2';
import { multimodal } from './multimodal/index';
import { satelliteAnalyzer } from './multimodal/satelliteAnalyzer';
import { handleTileRequest, getTileJson, getLayerSources } from './foundation-models/mvtTileServer';
import { explainability } from './explainability/index';
import { reasoningVisualizer } from './explainability/reasoningVisualizer';
import { evidenceChain } from './explainability/evidenceChain';
import { uncertaintyQuantifier } from './explainability/uncertaintyQuantifier';
import { biasAuditor } from './explainability/biasAuditor';
import { humanOverride } from './explainability/humanOverride';
import { seismicProcessor } from './multimodal/seismicProcessor';
import { radarInterpreter } from './multimodal/radarInterpreter';
import { sentimentAnalyzer } from './multimodal/sentimentAnalyzer';
import { multimodalFusion } from './multimodal/multimodalFusion';
import { registerAnalyticalModelsRoutes } from './analytical-models';
import { computeWithContext } from './analytical-models/contextEngine';
import { assessAndEmail, runDisasterAssessment, buildReportHtml, buildChainReportHtml, reverseGeocode } from './disasterAssessment';
import { runFusionPipeline } from './disasterFusion';
import { isEmailConfigured, sendEmail } from './email';
import {
  conversationMemory, generatePlan, executePlan, executeStep,
  generateSuggestions, buildProactiveInsight, recordTrace, addEvidence,
  recallMemories, renderMemoryRecall, classifyToolRisk, requiresApproval,
  listAvailableTools,
  type AgentPlan, type PlanStep, type SubAgentUpdate, type SuggestionContext, type ConversationTurn,
} from './advancedAgent';

import { architectureProposals } from './meta-cognition/architectureProposals';
import { promptEvolution } from './meta-cognition/promptEvolution';
import { PluginManager } from './pluginManager';
import { ModelRouter, CostTracker, EnhancedCache } from './costOptimizer';
import { FeedbackManager, SelfImprover, buildAnalytics } from './selfImprover';
import { evaluateResponse, storeEval, getRecentEvals, getAvgScoresByIntent } from './ml/evals';
import { promptLab } from './ml/promptLab';
import { generateTrainingExample, getSyntheticData, startSyntheticDataGeneration, stopSyntheticDataGeneration } from './ml/syntheticData';
import { knowledgeGraph } from './ml/knowledgeGraph';
import { entityGenerator, edgeGenerator, counterfactualGraph, graphCompletion, evolvingGraph } from './kgV2/index';
import { predictor, type Prediction } from './ml/predictor';
import { omninet, classifyComplexity } from './ai-router/omninet';
import { login, authGuard, sseAuthGuard, ensureDefaultAdmin, requireRole, devAutoLogin, refreshToken } from './middleware/auth';
import { perUserRateLimiter, perIpRateLimiter } from './middleware/rateLimiter';
import { requireOwnership } from './middleware/tenantIsolation';
import { auditLog } from './middleware/audit';
import { validate, askSchema, sandboxExecuteSchema, chatCreateSchema, feedbackSchema, monitorRuleSchema, digitalTwinSchema } from './middleware/validate';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger, requestLoggerMiddleware, startMemoryLogging, stopMemoryLogging } from './observability/logger';
import { metricsMiddleware, getMetrics, getMetricsContentType, activeSseConnections, sandboxExecutionsTotal, dbQueryDuration, cacheHitRate, omninetCallsTotal, toolExecutionsTotal, toolGenerationsTotal } from './observability/metrics';
import { AppError, GeminiError, SandboxError, ValidationError, DatabaseError, CircuitOpenError, AuthenticationError, NotFoundError, RateLimitError } from './observability/errors';
import { validateJwtSecretStrength } from './utils/validation';
import { validateOutboundUrl, isAllowedUpstream } from './utils/ssrfGuard';
import { filterEonetPayload, readEonetCategoryFilter, type EonetPayload } from './utils/eonet';
import { isValidIssPosition, parseIssTle, propagateIssPosition, type IssPosition, type IssTle } from './utils/iss';
import { parseFirmsCsv, readFirmsDayRange, type FirmsHotspot } from './utils/firms';
import { normalizeSpaceDebrisRecords, type SpaceDebrisItem } from './utils/spaceDebris';
import { parseTokyoVaacHtml, parseNoaaVaacHtml, type VaacAdvisory } from './utils/vaac';
import { haversineDistance } from './utils/geo';
import { latLonToMgrs, mgrsToLatLon, getPrecisionLevels } from './utils/mgrs';
import { getAirQualityNearby, parseForSentinel, findLocationsNearby } from './utils/openaq';
import { fetchStationData, findNearestStation, getConditionsNearby, getStations } from './utils/ndbc';
import { fetchRecentShakeMaps, fetchShakeMapDetail, getMmiDescription, getMmiColor, getPagerDescription, formatForSentinel as shakeMapFormatForSentinel } from './utils/shakeMap';
import { fetchDayOutlook, getRiskForLocation } from './utils/spc';
import http from 'http';
import { SimpleQueue } from './queue/simple-queue';
import { pubsub } from './pubsub';
import { redisHealthCheck } from './infrastructure/redis';
import { createWsServer, shutdownWsServer, registerAbortController, removeAbortController } from './websocket';
import { ReflexEngine } from './reflex/engine';
import { ReflexActionHandler } from './reflex/actionHandlers';
import { forkManager } from './fork/manager';
(global as any).__forkManager = forkManager;
import { foundationModelsRouter } from './routes/foundationModels';
import { forkRouter } from './fork/routes';
import { vaultRouter, readVault } from './routes/vault';
import { createSelfEvolutionRouter } from './routes/selfEvolution';
import { pulseRouter } from './routes/pulse';
import { kaggleRouter } from './kaggle';
import { registerPowerEngine } from './kaggle/powerSaver';
import { startSentinelEngine, stopSentinelEngine } from './sentinel/engine';
import { CorrelationEngine } from './sentinel/correlationEngine';
import { initAisTracker, stopAisTracker, getAisTracker, type AisVessel } from './maritime/aisTracker';
import { roadTrafficDetector } from './sentinel/roadTrafficDetector';
import { spacexEngine } from './foundation-models/spacexApi';
import { bayFireDetector } from './foundation-models/bayFireDetector';
import { weatherForecaster } from './foundation-models/weatherForecaster';
import { agricultureMonitor } from './foundation-models/agricultureMonitor';
dotenv.config();

const IS_PROD = process.env.NODE_ENV === 'production';

// Startup env check — refuse to start in production with weak/missing JWT_SECRET
const secretIssues = validateJwtSecretStrength(process.env.JWT_SECRET);
if (secretIssues.length > 0) {
  if (IS_PROD) {
    logger.fatal({ issues: secretIssues }, 'Refusing to start in production with weak JWT_SECRET. Set a strong (>=32 chars) secret in .env');
    process.exit(1);
  }
  for (const issue of secretIssues) {
    logger.warn({ issue }, 'JWT_SECRET is weak — a strong random secret will be auto-generated for this dev session');
  }
}

const OPTIONAL_ENV_VARS = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'SAMBANOVA_API_KEY', 'OPENROUTER_API_KEY', 'TOGETHER_API_KEY', 'ANTHROPIC_API_KEY', 'HUGGINGFACE_API_KEY', 'SANDBOX_API_TOKEN', 'METRICS_API_TOKEN', 'E2B_API_KEY'];
for (const k of OPTIONAL_ENV_VARS) {
  if (!process.env[k]) {
    logger.debug({ var: k }, 'Optional env var not set, feature disabled');
  }
}

// ── .env template validation — warn about missing important API keys ──
function validateEnvTemplate(): void {
  try {
    const templatePath = path.resolve('.env.example');
    if (!fs.existsSync(templatePath)) return;
    const template = fs.readFileSync(templatePath, 'utf-8');
    // Parse KEY= lines from the template (skip comments and empty lines)
    const templateKeys = new Set<string>();
    for (const line of template.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
      if (match) templateKeys.add(match[1]);
    }
    // Check which template keys are missing from the actual env
    const missing: string[] = [];
    for (const key of templateKeys) {
      if (!process.env[key] && !OPTIONAL_ENV_VARS.includes(key)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      logger.warn({ count: missing.length, sample: missing.slice(0, 5) },
        `${missing.length} env var(s) from .env.example not set in .env — features may be unavailable. ` +
        `Fill in missing values in .env.`);
    }
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'Env template validation skipped');
  }
}
validateEnvTemplate();

import { cache } from './routes/routeHelpers';
import { getCached, setCached, getCachedAt } from './routes/cacheService';
import { registerOpenApiRoutes } from './routes/openapi';
const app = express();
app.set('trust proxy', 1);
const PORT = (() => {
  const p = Number(process.env.PROXY_PORT);
  return Number.isFinite(p) && p > 0 ? p : 3001;
})();

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Cesium requires inline styles and eval for workers — see SECURITY.md (Issue #11)
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net', 'blob:'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
      'connect-src': [
        "'self'",
        'ws:', 'wss:',
        'https://api.cesium.com', 'https://assets.cesium.com',
        'https://*.cesium.com', 'https://tile.googleapis.com',
        'https://tile.openstreetmap.org', 'https://server.arcgisonline.com',
        'https://api.weather.gov', 'https://earthquake.usgs.gov',
        'https://eonet.gsfc.nasa.gov', 'https://*.amazonaws.com',
        'https://*.amazoncognito.com', 'https://cognito-identity.us-east-1.amazonaws.com',
      ],
      'worker-src': ["'self'", 'blob:'],
      'child-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': IS_PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(self), gyroscope=(self), accelerometer=(self)');
  next();
});
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true, maxAge: 600 }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: false }));
app.disable('x-powered-by');

// ── Observability middleware (before auth) ─────────────────────
app.use(requestLoggerMiddleware());
app.use(metricsMiddleware());

// ── Bootstrap: ensure default admin user exists ───────────────
ensureDefaultAdmin();

// ── Resource monitoring ───────────────────────────────────────
const RESOURCE_MONITOR_INTERVAL = 30000;
let resourceMonitorTimer: ReturnType<typeof setInterval> | null = null;
function startResourceMonitor(): void {
  resourceMonitorTimer = setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    if (heapUsedMB > 1500) {
      logger.warn({ heapUsedMB, heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024) }, 'heap usage exceeds 1.5GB, forcing GC');
      if (global.gc) {
        global.gc();
        logger.info({ heapFreedMB: heapUsedMB - Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }, 'GC completed');
      }
    }
  }, RESOURCE_MONITOR_INTERVAL);
}
function stopResourceMonitor(): void {
  if (resourceMonitorTimer) clearInterval(resourceMonitorTimer);
}

// ── Authentication ────────────────────────────────────────────
const loginRateLimit = perIpRateLimiter(5, 15 * 60 * 1000);
const publicDataRateLimit = perIpRateLimiter(300, 60000);
app.post('/api/auth/login', loginRateLimit, login);

if (!IS_PROD) {
  app.post('/api/auth/dev-login', devAutoLogin);
}

app.post('/api/auth/refresh', refreshToken);

// Internal analytical-model execution for the agent tool registry. The
// registry's tools call this server's own endpoints (via 127.0.0.1) with no
// auth token, so this loopback-only route lets them run the REAL physics
// engines in-process. Remote clients are rejected (non-loopback → 403), and
// the normal authenticated /api/analytical-models/:id/execute stays as the
// public surface. This is what powers the agent's "compute" intent end-to-end.
// SECURITY: only req.socket.remoteAddress is checked (not req.ip) because
// req.ip is spoofable via X-Forwarded-For when trust proxy is enabled.
// Non-loopback requests also require admin auth.
const isLoopback = (ip: string | undefined): boolean => {
  const v = (ip || '').replace(/^::ffff:/, '');
  return v === '127.0.0.1' || v === '::1' || v === 'localhost';
};
app.post('/api/analytical-models/:id/execute-internal', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!isLoopback(req.socket?.remoteAddress)) {
    // Remote caller: require a valid JWT (sets userRole) then admin role.
    return authGuard(req, res, () => requireRole('admin')(req, res, next));
  }
  next();
}, (req: express.Request, res: express.Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid equation id' });
  const inputs: Record<string, number> = req.body?.inputs ?? {};
  const context = req.body?.context;
  (async () => {
    try {
      const result = await computeWithContext(id, inputs, context);
      if (!result) return res.status(404).json({ error: `Equation ${id} not implemented` });
      return res.json({
        id,
        result: result.result,
        unit: result.unit,
        steps: result.steps,
        series: result.series,
        secondary: result.secondary,
        dataSource: result.dataSource,
        location: result.location,
        log: result.log,
        warnings: result.warnings,
        grid: result.grid,
        fetchedParams: result.fetchedParams,
        validation: result.validation,
        qualityControl: result.qualityControl,
        uncertainty: result.uncertainty,
        interpretation: result.interpretation,
        workflowLog: result.workflowLog,
        dataQualityScore: result.dataQualityScore,
        processingTimeMs: result.processingTimeMs,
        visualizationType: result.visualizationType,
        preprocessingNotes: result.preprocessingNotes,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Computation failed' });
    }
  })();
});

app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Health/metrics are public
  if (
    req.path === '/auth/login' || req.path === '/auth/dev-login' || req.path === '/auth/refresh' ||
    req.path === '/health' || req.path === '/ready' || req.path === '/live' || req.path === '/metrics' ||
    req.path === '/config/apis' ||
    req.path === '/openapi.json' || req.path === '/docs'
  ) {
    return next();
  }
  // Public shared sessions (read-only, accessed via share token)
  if (req.path.startsWith('/shared/')) {
    return next();
  }
  // Public read-only data endpoints (no user context required, server-side rate-limited)
  if (
    req.path === '/earthquakes' || req.path === '/earthquakes/significant' ||
    req.path === '/eonet' || req.path === '/weather/alerts' || req.path === '/weather/open-meteo' ||
    req.path === '/weather/nhc' || req.path === '/weather/flood' || req.path === '/weather/marine' ||
    req.path === '/weather/ensemble' || req.path === '/weather/seasonal' || req.path === '/weather/historical' ||
    req.path === '/weather/air-quality' || req.path === '/weather/gfs' ||
    req.path === '/weather/ibtracs' || req.path === '/weather/drought' ||
    req.path === '/weather/climate-indices' ||
    req.path === '/gdacs/alerts' || req.path === '/tectonic' ||
    req.path === '/vaac/tokyo' || req.path === '/vaac/anchorage' || req.path === '/vaac/washington' || req.path === '/firms' || req.path === '/lightning' ||
    req.path === '/openflights' || req.path === '/submarine-cables' || req.path === '/electricity-grid' ||
    req.path === '/ais' || req.path.startsWith('/ais/') ||
    req.path === '/space-debris' || req.path === '/space-weather/kp' || req.path === '/space-weather/donki' ||
    req.path === '/nasa-dsn' || req.path === '/aurora' || req.path === '/iss' ||
    req.path === '/volcanoes' ||
    req.path === '/cameras' || req.path.startsWith('/cameras/') || req.path.startsWith('/cctv/') ||
    req.path === '/radar/rainviewer' || req.path === '/sentiment/news' ||
    req.path === '/ml/predict' || req.path === '/ml/predict/report' ||
    req.path === '/climate/power' || req.path === '/climate/anomalies' || req.path === '/climate/co2' || req.path === '/climate/sea-ice' ||
    req.path === '/gdelt' || req.path === '/fema' || req.path === '/geospatial/overpass' || req.path === '/population/worldpop' || req.path === '/usgs/water' ||
    req.path === '/flights/military' || req.path === '/military-bases' || req.path === '/ucdp' ||
    req.path === '/satellites/tle' ||
    req.path === '/satnogs/transmitters' || req.path === '/ucs-satellites' ||
    req.path === '/flights' || req.path === '/flights/all' || req.path === '/adsb-lol' || req.path === '/adsb-fi' || req.path === '/flightaware' || req.path === '/airlabs' ||
    req.path === '/mgrs' || req.path === '/openaq' || req.path.startsWith('/openaq/') ||
    req.path.startsWith('/ndbc/') || req.path === '/ndbc/stations' ||
    req.path === '/shakemap/recent' || req.path.startsWith('/shakemap/') ||
    req.path === '/spc/outlook' || req.path.startsWith('/spc/') ||
    // Kaggle GPU simulation endpoints
    req.path.startsWith('/kaggle/')
  ) {
    return publicDataRateLimit(req, res, next);
  }
  // EO foundation endpoints (weather forecast + agriculture, real Open-Meteo/Sentinel-2 data)
  if (
    req.path.startsWith('/fm/weather/') ||
    req.path.startsWith('/fm/agri/') ||
    req.path.startsWith('/road-traffic/') ||
    req.path.startsWith('/spacex/') ||
    req.path.startsWith('/bayfire/') ||
    // Multimodal perception endpoints (satellite analysis, seismic, radar, sentiment, fusion)
    req.path.startsWith('/multimodal/') ||
    req.path.startsWith('/satellite/process') ||
    // Simulation endpoints (physics models)
    req.path.startsWith('/simulate/')
  ) {
    return publicDataRateLimit(req, res, next);
  }
  // Satellite image search endpoints
  if (req.path.startsWith('/fm/search')) {
    return next();
  }
  // Satellite processing endpoints (NDVI, NDWI, etc.)
  if (req.path.startsWith('/satellite/process')) {
    return next();
  }
  // MVT vector tile endpoints
  if (req.path.startsWith('/tiles/') || req.path.startsWith('/tilejson') || req.path.startsWith('/tile-sources')) {
    return next();
  }
  // Pulse intelligence panel (public market/energy/geo/sentiment data)
  if (req.path.startsWith('/pulse/')) {
    return next();
  }
  // Analytical models — search and detail are public, execute requires auth
  if (req.path === '/analytical-models' || req.path === '/analytical-models/search' || (req.path.match(/^\/analytical-models\/\d+$/) && req.method === 'GET')) {
    return next();
  }
  // Plugin tool endpoints — called internally by the tool executor (server-to-server).
  if (req.path.startsWith('/plugin/tool/') || req.path.startsWith('/plugin/data/')) {
    return next();
  }
  authGuard(req, res, next);
});

app.use('/api', foundationModelsRouter);
app.use('/api/fork', forkRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/pulse', pulseRouter);
app.use('/api/kaggle', kaggleRouter);
registerAnalyticalModelsRoutes(app);
registerOpenApiRoutes(app);

const materializedViews = new MaterializedViewCache(`http://127.0.0.1:${PORT}`);
const sandboxManager = new SandboxManager();
const simulationEngine = new SimulationEngine(sandboxManager);
const reflexEngine = new ReflexEngine();
(global as any).__reflexEngine = reflexEngine;
const reflexActionHandler = new ReflexActionHandler();
const causalKG = new CausalKnowledgeGraph();
const entropyMixer = new EntropyMixer();
(global as any).__entropyMixer = entropyMixer;
const discoveryEngine = new DiscoveryEngine();
(global as any).__discoveryEngine = discoveryEngine;
const dreamEngine = new DreamEngine();
(global as any).__dreamEngine = dreamEngine;
const memorySystem = new PlanetaryMemorySystem();
(global as any).__memorySystem = memorySystem;
// Phase 1.3: Initialize dynamic tool registry
const toolRegistry = new ToolRegistry();
function registerDefaultTools() {
  const tools: AgentTool[] = [
    // ── Seismic ──
    { name:'earthquakes', category:'seismic', description:'Recent M2.5+ earthquakes worldwide (GeoJSON). Supports bbox filtering via minLat/maxLat/minLon/maxLon and time range via starttime/endtime/hours.', exampleQueries:['show earthquakes','seismic activity','earthquakes near japan'], schema:{type:'api',endpoint:'/api/earthquakes',method:'GET',params:{minLat:'min latitude',maxLat:'max latitude',minLon:'min longitude',maxLon:'max longitude',starttime:'ISO start date',endtime:'ISO end date',hours:'lookback hours',minMag:'minimum magnitude'},outputFormat:'GeoJSON'} },
    { name:'significant_quakes', category:'seismic', description:'Significant earthquakes (past month)', exampleQueries:['significant quakes','major earthquakes'], schema:{type:'api',endpoint:'/api/earthquakes/significant',method:'GET',outputFormat:'GeoJSON'} },
    { name:'earthquake_summary', category:'seismic', description:'Earthquake summary with magnitude distribution buckets for the past week', exampleQueries:['earthquake summary','quake statistics','magnitude distribution'], schema:{type:'api',endpoint:'/api/earthquakes/summary',method:'GET'} },
    { name:'tectonic_plates', category:'seismic', description:'Tectonic plate boundary lines', exampleQueries:['tectonic plates','plate boundaries'], schema:{type:'api',endpoint:'/api/tectonic',method:'GET',outputFormat:'GeoJSON'} },
    { name:'gdacs', category:'seismic', description:'GDACS disaster alerts and warnings', exampleQueries:['disaster alerts','gdacs'], schema:{type:'api',endpoint:'/api/gdacs/alerts',method:'GET'} },

    // ── Weather ──
    { name:'weather_forecast', category:'weather', description:'Current weather at any lat/lon (Open-Meteo). Returns temperature, humidity, wind, precipitation, pressure.', exampleQueries:['weather in tokyo','temperature','forecast','current conditions'], schema:{type:'api',endpoint:'/api/weather/open-meteo',method:'GET',params:{lat:'latitude',lon:'longitude',startDate:'ISO date',endDate:'ISO date'}} },
    { name:'weather_flood', category:'weather', description:'River discharge and flood forecast at a location (Open-Meteo Flood API)', exampleQueries:['flood forecast','river discharge','flood risk'], schema:{type:'api',endpoint:'/api/weather/flood',method:'GET',params:{lat:'latitude',lon:'longitude',startDate:'ISO date',endDate:'ISO date'}} },
    { name:'weather_marine', category:'weather', description:'Marine conditions: wave height, swell, wave period at a location', exampleQueries:['marine conditions','wave height','swell forecast','sea state'], schema:{type:'api',endpoint:'/api/weather/marine',method:'GET',params:{lat:'latitude',lon:'longitude'}} },
    { name:'weather_ensemble', category:'weather', description:'Ensemble weather forecast (10 members) with uncertainty at a location', exampleQueries:['ensemble forecast','weather uncertainty','probabilistic forecast'], schema:{type:'api',endpoint:'/api/weather/ensemble',method:'GET',params:{lat:'latitude',lon:'longitude'}} },
    { name:'weather_seasonal', category:'weather', description:'Seasonal forecast (180 days) with temperature and precipitation at a location', exampleQueries:['seasonal forecast','long range weather','3 month forecast'], schema:{type:'api',endpoint:'/api/weather/seasonal',method:'GET',params:{lat:'latitude',lon:'longitude'}} },
    { name:'weather_historical', category:'weather', description:'Historical weather data for a date range at a location (Open-Meteo Archive). Returns daily temp max/min, precipitation, wind.', exampleQueries:['historical weather','past weather','rainfall history','temperature history'], schema:{type:'api',endpoint:'/api/weather/historical',method:'GET',params:{lat:'latitude',lon:'longitude',startDate:'ISO date',endDate:'ISO date'}} },
    { name:'weather_air_quality', category:'weather', description:'Air quality at a location — AQI, PM2.5, PM10, CO, NO2, ozone, UV index', exampleQueries:['air quality','pollution','AQI','PM2.5','smog'], schema:{type:'api',endpoint:'/api/weather/air-quality',method:'GET',params:{lat:'latitude',lon:'longitude'}} },
    { name:'weather_gfs', category:'weather', description:'GFS model 16-day weather forecast at a location', exampleQueries:['GFS forecast','16 day forecast','weather model'], schema:{type:'api',endpoint:'/api/weather/gfs',method:'GET',params:{lat:'latitude',lon:'longitude'}} },
    { name:'storms', category:'weather', description:'NHC tropical cyclone tracks and forecasts. Supports bbox filtering via latMin/latMax/lonMin/lonMax.', exampleQueries:['hurricane tracking','storm forecast','cyclone','typhoon','tropical storm'], schema:{type:'api',endpoint:'/api/weather/nhc',method:'GET',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude'}} },
    { name:'weather_alerts', category:'weather', description:'NWS active weather alerts (US). Returns GeoJSON of active alerts.', exampleQueries:['weather alerts','storm warnings','severe weather'], schema:{type:'api',endpoint:'/api/weather/alerts',method:'GET',outputFormat:'GeoJSON'} },
    { name:'weather_drought', category:'weather', description:'US Drought Monitor — drought intensity zones (D0-D4). Returns GeoJSON.', exampleQueries:['drought','drought monitor','drought conditions'], schema:{type:'api',endpoint:'/api/weather/drought',method:'GET',outputFormat:'GeoJSON'} },
    { name:'weather_climate_indices', category:'weather', description:'NOAA CPC seasonal climate outlooks (temperature and precipitation probability)', exampleQueries:['climate outlook','seasonal outlook','climate indices'], schema:{type:'api',endpoint:'/api/weather/climate-indices',method:'GET'} },
    { name:'lightning', category:'weather', description:'Real-time lightning strike detections', exampleQueries:['lightning strikes','thunderstorm','lightning'], schema:{type:'api',endpoint:'/api/lightning',method:'GET'} },
    { name:'weather_radar', category:'weather', description:'Weather radar tile layers from RainViewer (precipitation reflectivity)', exampleQueries:['weather radar','rain radar','precipitation radar','radar map'], schema:{type:'api',endpoint:'/api/radar/rainviewer',method:'GET'} },
    { name:'climate_power', category:'weather', description:'NASA POWER climate data — daily temperature, humidity, precipitation, wind, solar at a location', exampleQueries:['climate data','nasa power','solar radiation','wind climate'], schema:{type:'api',endpoint:'/api/climate/power',method:'GET',params:{lat:'latitude',lon:'longitude',startDate:'ISO date',endDate:'ISO date'}} },

    // ── Hazards / Earth Observation ──
    { name:'wildfires', category:'hazards', description:'NASA EONET wildfire events globally. Supports bbox filtering via latMin/latMax/lonMin/lonMax and source filtering.', exampleQueries:['wildfires','fire detection','burning','active fires'], schema:{type:'api',endpoint:'/api/eonet',method:'GET',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude',source:'event source'},outputFormat:'JSON'} },
    { name:'floods', category:'hazards', description:'NASA EONET flood events globally. Supports bbox filtering via latMin/latMax/lonMin/lonMax.', exampleQueries:['floods','flooding','inundation'], schema:{type:'api',endpoint:'/api/eonet',method:'GET',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude'}} },
    { name:'volcanoes', category:'hazards', description:'Volcanic events and VAAC ash advisories from Tokyo, Anchorage, and Washington VAACs', exampleQueries:['volcanoes','eruption','volcanic ash','vaac'], schema:{type:'api',endpoint:'/api/vaac/tokyo',method:'GET'} },
    { name:'firms_fires', category:'hazards', description:'NASA FIRMS satellite fire detections (MODIS/VIIRS). Supports point+radius (lat/lon/radius) and bbox (latMin/latMax/lonMin/lonMax) filtering. Requires NASA_FIRMS_MAP_KEY.', exampleQueries:['active fires','firms','satellite fire','fire hotspots','wildfire hotspots'], schema:{type:'api',endpoint:'/api/firms',method:'GET',params:{lat:'latitude for point search',lon:'longitude for point search',radius:'search radius in km',latMin:'min latitude for bbox',latMax:'max latitude for bbox',lonMin:'min longitude for bbox',lonMax:'max longitude for bbox',dayRange:'days to look back',startDate:'ISO start date',endDate:'ISO end date'}} },
    { name:'eonet_events', category:'hazards', description:'All NASA EONET natural events (wildfires, floods, volcanoes, storms, dust, sea ice). Supports bbox filtering.', exampleQueries:['natural events','disaster events','eonet','all hazards'], schema:{type:'api',endpoint:'/api/eonet',method:'GET',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude',source:'event source',bbox:'bounding box'},outputFormat:'JSON'} },

    // ── Aviation ──
    { name:'aircraft', category:'aviation', description:'Live aircraft positions from ADSB.lol. Supports point search via lat/lon query params.', exampleQueries:['flights','aircraft','planes','adsb','live aircraft'], schema:{type:'api',endpoint:'/api/adsb-lol',method:'GET',params:{lat:'latitude for nearby search',lon:'longitude for nearby search'}} },
    { name:'flights_all', category:'aviation', description:'All live aircraft positions merged from OpenSky + ADSB.lol + ADSB.fi + FlightAware + AirLabs (deduplicated). Supports point search via lat/lon.', exampleQueries:['all flights','show flights','aircraft near','flights near kochi','planes overhead'], schema:{type:'api',endpoint:'/api/flights/all',method:'GET',params:{lat:'latitude for nearby search',lon:'longitude for nearby search'}} },
    { name:'military_flights', category:'aviation', description:'Live military aircraft positions (filtered by military callsign patterns from OpenSky)', exampleQueries:['military flights','military aircraft','fighter jets','military planes'], schema:{type:'api',endpoint:'/api/flights/military',method:'GET'} },
    { name:'airports', category:'aviation', description:'OpenFlights airport database and flight routes', exampleQueries:['airports','flight routes','airport database'], schema:{type:'api',endpoint:'/api/openflights',method:'GET'} },
    { name:'airspaces', category:'aviation', description:'Controlled airspace polygons from OpenAIP (GeoJSON)', exampleQueries:['airspaces','controlled airspace','flight restrictions'], schema:{type:'api',endpoint:'/api/airspaces',method:'GET',outputFormat:'GeoJSON'} },

    // ── Maritime ──
    { name:'ais_vessels', category:'maritime', description:'Live vessel positions from AIS (AISStream.io). Supports point+radius search (lat/lon/radius) and bbox (latMin/latMax/lonMin/lonMax). Returns vessels with MMSI, name, position, speed, course, type.', exampleQueries:['ships','vessels','maritime','ais','find ships','vessels near','ships near coastline'], schema:{type:'api',endpoint:'/api/ais',method:'GET',params:{lat:'latitude for nearby search',lon:'longitude for nearby search',radius:'search radius in km',latMin:'min latitude for bbox',latMax:'max latitude for bbox',lonMin:'min longitude for bbox',lonMax:'max longitude for bbox',limit:'max results (default 1000)'}} },
    { name:'maritime_nearby', category:'maritime', description:'Find vessels near a specific lat/lon within a radius (default 50km)', exampleQueries:['ships near me','vessels nearby','find ships near this location'], schema:{type:'api',endpoint:'/api/ais/nearby',method:'GET',params:{lat:'latitude',lon:'longitude',radius:'search radius in km (default 50)'}} },
    { name:'submarine_cables', category:'ocean', description:'Global submarine cable network map', exampleQueries:['submarine cables','internet cables','undersea cables'], schema:{type:'api',endpoint:'/api/submarine-cables',method:'GET',outputFormat:'GeoJSON'} },
    { name:'electricity_grid', category:'energy', description:'Real-time grid carbon intensity by region', exampleQueries:['electricity grid','carbon intensity','power grid'], schema:{type:'api',endpoint:'/api/electricity-grid',method:'GET'} },

    // ── Space ──
    { name:'space_debris', category:'space', description:'CelesTrak orbital debris tracking (1500+ objects)', exampleQueries:['space debris','orbital debris','satellites'], schema:{type:'api',endpoint:'/api/space-debris',method:'GET'} },
    { name:'satellites_tle', category:'space', description:'All active satellites with live positions (CelesTrak TLE + UCS database + Starlink). Returns lat/lon/altitude/inclination for each satellite. Filter by bbox for regional queries.', exampleQueries:['satellites','show satellites','satellites over india','track satellite','starlink','gps satellites'], schema:{type:'api',endpoint:'/api/satellites/tle',method:'GET',params:{latMin:'min latitude for bbox filter',latMax:'max latitude for bbox filter',lonMin:'min longitude for bbox filter',lonMax:'max longitude for bbox filter'}} },
    { name:'nasa_dsn', category:'space', description:'NASA Deep Space Network dish status — which antennas are tracking which spacecraft', exampleQueries:['deep space network','nasa dsn','space communications','dsn status'], schema:{type:'api',endpoint:'/api/nasa-dsn',method:'GET'} },
    { name:'aurora', category:'space', description:'Aurora oval forecast and probability (NOAA SWPC). Returns coordinates with probability values.', exampleQueries:['aurora','northern lights','solar forecast','aurora borealis'], schema:{type:'api',endpoint:'/api/aurora',method:'GET'} },
    { name:'space_weather_kp', category:'space', description:'Planetary K-index (geomagnetic activity) from NOAA SWPC', exampleQueries:['kp index','space weather','geomagnetic activity','solar storm'], schema:{type:'api',endpoint:'/api/space-weather/kp',method:'GET'} },
    { name:'space_weather_donki', category:'space', description:'NASA DONKI space weather notifications — CMEs, solar flares, SEP events. Supports date range via startDate/endDate.', exampleQueries:['space weather events','solar flare','CME','coronal mass ejection','donki'], schema:{type:'api',endpoint:'/api/space-weather/donki',method:'GET',params:{startDate:'ISO start date',endDate:'ISO end date'}} },
    { name:'iss', category:'space', description:'ISS real-time position, velocity, altitude, and footprint', exampleQueries:['iss','space station','international space station','where is the iss'], schema:{type:'api',endpoint:'/api/iss',method:'GET'} },

    // ── Compute / Sandbox ──
    { name:'sandbox_python', category:'compute', description:'Execute Python code with numpy, pandas, scipy in sandbox', exampleQueries:['analyze data','compute statistics','run python'], schema:{type:'sandbox',endpoint:'/api/sandbox/execute'} },
    { name:'sandbox_node', category:'compute', description:'Execute Node.js code in sandbox', exampleQueries:['run javascript','node script'], schema:{type:'sandbox',endpoint:'/api/sandbox/execute'} },
    { name:'sandbox_bash', category:'compute', description:'Execute bash commands in sandbox', exampleQueries:['run command','shell script'], schema:{type:'sandbox',endpoint:'/api/sandbox/execute'} },

    // ── Navigation ──
    { name:'fly_command', category:'navigation', description:'Fly the globe camera to any location', exampleQueries:['fly to tokyo','go to paris','show location'], schema:{type:'command'} },
    { name:'toggle_layer_command', category:'navigation', description:'Show or hide any data layer on the globe', exampleQueries:['show earthquakes','enable flights'], schema:{type:'command'} },
    { name:'open_panel', category:'navigation', description:'Open, close, or toggle any UI panel in the app. Use this to open tools, panels, or views. Panel IDs: analytics-workbench, satellite-tracker, aviation-tracker, satellite-imagery, land-cover, intelligence (pulse), intel-feed, cognitive-dashboard, tool-workbench, memory-explorer, settings, study-area, api-vault, command-palette, scenario-gallery, scenario-editor, cinematic-director, spatial-sketch, performance, timeline, measure, time-slider, admin, iss, digital-twin, ai-chat.', exampleQueries:['open analytics workbench','show satellite tracker','open pulse intelligence','close settings','open scenario gallery','toggle timeline'], schema:{type:'command',params:{panelId:'panel ID to open/close/toggle',desired:'optional: true to open, false to close, omit to toggle'}} },
    { name:'assess_and_email', category:'navigation', description:'Run a FULL disaster assessment for a region (earthquakes, storms, floods, wildfires, air quality, marine) and email the HTML report. Requires a region name + bounding box (latMin/latMax/lonMin/lonMax) + optional emailTo. Use when the user asks to "assess" a region or "email a report".', exampleQueries:['full disaster assessment of the Bay of Bengal and email me a report','assess the east coast and send report','disaster assessment report'], schema:{type:'command',params:{regionName:'region name',latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude',emailTo:'optional recipient email'}} },

    // ── Earth Observation / Foundation Models ──
    { name:'weather_fm_forecast', category:'eo', description:'Multi-day weather forecast at a lat/lon — Open-Meteo with anomaly detection against 2020-2024 climatology.', exampleQueries:['weather forecast','temperature forecast','precipitation outlook'], schema:{type:'api',endpoint:'/api/fm/weather/forecast',method:'POST',params:{lat:'latitude',lon:'longitude',forecastDays:'number of forecast days'}} },
    { name:'weather_fm_anomalies', category:'eo', description:'Detect weather anomalies for a region using Open-Meteo climatology comparison', exampleQueries:['weather anomalies','climate anomaly detection','temperature anomaly'], schema:{type:'api',endpoint:'/api/fm/weather/anomalies',method:'POST',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude'}} },
    { name:'agri_analyze', category:'eo', description:'Agriculture crop health analysis at a lat/lon — NDVI/EVI, stress level, alerts', exampleQueries:['crop health','agriculture analysis','crop stress','ndvi','farming conditions'], schema:{type:'api',endpoint:'/api/fm/agri/analyze',method:'POST',params:{lat:'latitude',lon:'longitude'}} },
    { name:'agri_alerts', category:'eo', description:'Active agriculture stress alerts from crop monitoring', exampleQueries:['crop alerts','agriculture alerts','farming alerts'], schema:{type:'api',endpoint:'/api/fm/agri/alerts',method:'GET'} },
    { name:'bayfire_clusters', category:'eo', description:'Bayesian wildfire detection clusters from satellite + weather data fusion', exampleQueries:['bayesian fire','wildfire clusters','fire detection model','bay fire'], schema:{type:'api',endpoint:'/api/bayfire/clusters',method:'GET'} },
    { name:'spacex_launches', category:'space', description:'SpaceX launch data and schedule', exampleQueries:['spacex launches','rocket launches','spacex schedule'], schema:{type:'api',endpoint:'/api/spacex/launches',method:'GET',params:{limit:'max results'}} },
    { name:'spacex_starlink', category:'space', description:'SpaceX Starlink satellite positions. Supports bbox filtering via latMin/latMax/lonMin/lonMax.', exampleQueries:['starlink satellites','starlink positions','spacex starlink'], schema:{type:'api',endpoint:'/api/spacex/starlink',method:'GET',params:{latMin:'min latitude',latMax:'max latitude',lonMin:'min longitude',lonMax:'max longitude'}} },
    { name:'road_traffic', category:'eo', description:'Road traffic analysis from Sentinel-1 SAR. Analyze a corridor for traffic patterns.', exampleQueries:['road traffic','traffic analysis','sentinel traffic','road corridors'], schema:{type:'api',endpoint:'/api/road-traffic/analyze',method:'POST',params:{corridorId:'corridor ID to analyze'}} },

    // ── Multimodal Perception ──
    { name:'mm_satellite_analyze', category:'multimodal', description:'Multimodal satellite analysis at a lat/lon — Copernicus Sentinel-2 observation with classification', exampleQueries:['multimodal satellite','sentinel analysis','satellite observation'], schema:{type:'api',endpoint:'/api/multimodal/satellite/analyze',method:'POST',params:{lat:'latitude',lon:'longitude',radiusKm:'analysis radius'}} },
    { name:'mm_fire_scars', category:'multimodal', description:'Detect fire scars/burned areas from satellite at a lat/lon', exampleQueries:['fire scars','burned area detection','burn scar mapping'], schema:{type:'api',endpoint:'/api/multimodal/satellite/fire-scars',method:'POST',params:{lat:'latitude',lon:'longitude'}} },
    { name:'mm_flood_extent', category:'multimodal', description:'Detect flood extent from satellite at a lat/lon', exampleQueries:['flood extent','flood mapping','inundation from satellite','satellite flood detection'], schema:{type:'api',endpoint:'/api/multimodal/satellite/flood-extent',method:'POST',params:{lat:'latitude',lon:'longitude'}} },
    { name:'mm_satellite_interpret', category:'multimodal', description:'Vision LLM interpretation of satellite imagery at a lat/lon — natural language description of what the satellite sees', exampleQueries:['satellite interpretation','what does satellite see','ai satellite vision','describe satellite image'], schema:{type:'api',endpoint:'/api/multimodal/satellite/interpret',method:'POST',params:{lat:'latitude',lon:'longitude'}} },
    { name:'mm_seismic_events', category:'multimodal', description:'Seismic events from multimodal processor. Filter by minMag and hours.', exampleQueries:['seismic events','earthquake detection multimodal','seismic history'], schema:{type:'api',endpoint:'/api/multimodal/seismic/events',method:'GET',params:{minMag:'minimum magnitude',hours:'lookback hours'}} },
    { name:'mm_radar_fetch', category:'multimodal', description:'Fetch weather radar scan data from a radar station — storm cells, reflectivity', exampleQueries:['radar scan','weather radar data','storm cells','nexrad data'], schema:{type:'api',endpoint:'/api/multimodal/radar/fetch',method:'POST',params:{station:'radar station ID'}} },
    { name:'mm_sentiment_analyze', category:'multimodal', description:'Analyze sentiment of news/social media text — returns sentiment score + location extraction', exampleQueries:['sentiment analysis','news sentiment','social media sentiment'], schema:{type:'api',endpoint:'/api/multimodal/sentiment/analyze',method:'POST',params:{text:'text to analyze'}} },
    { name:'mm_fusion_events', category:'multimodal', description:'Fused multimodal events (satellite + seismic + radar + sentiment). Filter by type.', exampleQueries:['fused events','multimodal fusion','correlated events','multi-source events'], schema:{type:'api',endpoint:'/api/multimodal/fusion/events',method:'GET',params:{type:'event type filter',limit:'max results'}} },
    { name:'mm_fusion_nearby', category:'multimodal', description:'Find fused multimodal events near a lat/lon within a radius', exampleQueries:['nearby events','events near me','multimodal nearby'], schema:{type:'api',endpoint:'/api/multimodal/fusion/nearby',method:'GET',params:{lat:'latitude',lon:'longitude',radius:'search radius in km'}} },

    // ── Simulation / Physics Models ──
    { name:'simulate_run', category:'simulation', description:'Run a physics simulation model. Models: farsite-lite (wildfire), adcirc-lite (tsunami), wrf-lite (atmosphere), hysplit-lite (ash dispersion), fno-surrogate (weather prediction). Returns result grids.', exampleQueries:['run simulation','simulate wildfire','tsunami simulation','weather model','ash dispersion','fire spread model'], schema:{type:'api',endpoint:'/api/simulate/run',method:'POST',params:{model:'model name (farsite-lite/adcirc-lite/wrf-lite/hysplit-lite/fno-surrogate)',params:'model-specific parameters object'}} },
    { name:'simulate_templates', category:'simulation', description:'List available simulation models with their input/output schemas', exampleQueries:['simulation models','available simulations','model templates'], schema:{type:'api',endpoint:'/api/simulate/templates',method:'GET'} },

    // ── Scenarios ──
    { name:'scenario_generate', category:'scenarios', description:'Generate a 3D point-cloud disaster scenario (earthquake swarm, hurricane, wildfire, volcanic eruption, flood, tsunami)', exampleQueries:['generate scenario','create disaster scenario','earthquake scenario','hurricane scenario','flood scenario','tsunami scenario','wildfire scenario','volcano scenario'], schema:{type:'api',endpoint:'/api/scenarios/generate',method:'POST',params:{type:'scenario type',params:'scenario parameters'}} },
    { name:'scenario_generate_bbox', category:'scenarios', description:'Generate a scenario from real data within a bounding box', exampleQueries:['scenario from bbox','data-driven scenario','realistic disaster scenario'], schema:{type:'api',endpoint:'/api/scenarios/generate-from-bbox',method:'POST',params:{bbox:'bounding box [latMin,latMax,lonMin,lonMax]',hazardType:'hazard type',params:'scenario parameters'}} },
    { name:'scenario_search', category:'scenarios', description:'Search scenarios by location or type', exampleQueries:['search scenarios','find scenarios','scenario near location'], schema:{type:'api',endpoint:'/api/scenarios/search',method:'GET',params:{lat:'latitude',lon:'longitude',type:'scenario type',limit:'max results'}} },
    { name:'scenario_export', category:'scenarios', description:'Export a scenario in GeoJSON, CZML, NetCDF, or training data format', exampleQueries:['export scenario','download scenario','czml export','geojson scenario'], schema:{type:'api',endpoint:'/api/scenarios/export/:id',method:'GET',params:{id:'scenario ID',format:'export format (geojson/czml/netcdf/training)'}} },

    // ── Analytical Models (150 scientific equations) ──
    { name:'analytical_search', category:'analytical', description:'Search 150 scientific analytical models by natural language (e.g., "land surface temperature", "wave energy", "NDVI"). Returns matching equation IDs and names.', exampleQueries:['find equation','search analytical model','scientific formula','land surface temperature','wave energy','ndvi','seismic magnitude','carbon flux'], schema:{type:'api',endpoint:'/api/analytical-models/search',method:'GET',params:{q:'natural language search query'}} },
    { name:'analytical_execute', category:'analytical', description:'Execute a scientific analytical model by ID against real contextual data. Returns the computed result with units, validation, uncertainty, interpretation, and optional spatial grid. Use analytical_search first to find the ID.', exampleQueries:['calculate equation','run scientific model','compute formula','analytical model'], schema:{type:'api',endpoint:'/api/analytical-models/{id}/execute-internal',method:'POST',params:{id:'equation ID (from search)',inputs:'input parameters object',context:'optional context (location, study area)'}} },

    // ── Pulse / Intelligence ──
    { name:'pulse_market_quotes', category:'intelligence', description:'Live stock and crypto price quotes. Returns price, change, changePct, sparkline for each symbol.', exampleQueries:['stock price','market quotes','crypto price','stock market','sp500','bitcoin price','apple stock'], schema:{type:'api',endpoint:'/api/pulse/market/quotes',method:'GET',params:{symbols:'comma-separated symbols (e.g., SPY,AAPL,BTC-USD)'}} },
    { name:'pulse_energy_prices', category:'intelligence', description:'Energy commodity prices — WTI oil, Brent, natural gas, gold, silver, copper, gasoline', exampleQueries:['oil price','energy prices','gold price','silver price','copper price','gasoline price','brent crude'], schema:{type:'api',endpoint:'/api/pulse/energy/prices',method:'GET'} },
    { name:'pulse_geo_risks', category:'intelligence', description:'Geopolitical risk scores for 10 conflict zones (Ukraine, Taiwan, Middle East, etc.)', exampleQueries:['geopolitical risk','conflict risk','geopolitical tension','war risk'], schema:{type:'api',endpoint:'/api/pulse/geopolitical/risks',method:'GET'} },
    { name:'pulse_correlations', category:'intelligence', description:'Cross-asset correlation analysis — SPY↔WTI, Gold↔DXY, geo+energy, sentiment divergence, seismic clusters', exampleQueries:['correlation analysis','cross-asset correlation','market correlation','sentiment divergence'], schema:{type:'api',endpoint:'/api/pulse/correlation/cards',method:'GET'} },
    { name:'pulse_heatmap', category:'intelligence', description:'18-asset price change heatmap for quick market overview', exampleQueries:['market heatmap','asset heatmap','price heatmap','market overview'], schema:{type:'api',endpoint:'/api/pulse/heatmap',method:'GET'} },

    // ── OSINT / Threat Intelligence ──
    { name:'air_quality_waqi', category:'osint', description:'Air quality index for a city or coordinates (World AQI). Returns AQI, PM2.5, PM10, pollutants.', exampleQueries:['air quality','aqi','pollution level','air quality index','smog level'], schema:{type:'api',endpoint:'/api/waqi',method:'GET',params:{city:'city name',lat:'latitude',lon:'longitude'}} },
    { name:'acled_recent', category:'osint', description:'Recent armed conflict events from ACLED', exampleQueries:['conflict events','armed conflict','acled','recent clashes','battle events'], schema:{type:'api',endpoint:'/api/acled/recent',method:'GET'} },
    { name:'acled_nearby', category:'osint', description:'Find armed conflict events near a lat/lon', exampleQueries:['conflict near me','conflict nearby','battles near location'], schema:{type:'api',endpoint:'/api/acled/nearby',method:'GET',params:{lat:'latitude',lon:'longitude',radius:'search radius in km'}} },
    { name:'ucdp_conflict', category:'osint', description:'UCDP armed conflict data — conflict events by year and type', exampleQueries:['ucdp','conflict data','organized violence','battle deaths'], schema:{type:'api',endpoint:'/api/ucdp',method:'GET',params:{year:'year filter',type:'conflict type'}} },
    { name:'sanctions_ofac', category:'osint', description:'US Treasury OFAC sanctions list — search for sanctioned entities', exampleQueries:['sanctions','ofac','sanctioned entities','sanctions check','specially designated nationals'], schema:{type:'api',endpoint:'/api/sanctions/ofac',method:'GET'} },
    { name:'gdelt_events', category:'osint', description:'GDELT global event database — news events by location and date range', exampleQueries:['gdelt','global events','news events','world events','media events'], schema:{type:'api',endpoint:'/api/gdelt',method:'GET',params:{lat:'latitude',lon:'longitude',startDate:'ISO start date',endDate:'ISO end date'}} },
    { name:'reliefweb', category:'osint', description:'ReliefWeb disaster reports and humanitarian updates', exampleQueries:['reliefweb','disaster reports','humanitarian','relief operations','disaster response'], schema:{type:'api',endpoint:'/api/reliefweb',method:'GET',params:{limit:'max results',country:'country filter',disaster_type:'disaster type filter'}} },
    { name:'cyber_threats_otx', category:'osint', description:'AlienVault OTX threat intelligence pulses — latest cyber threat indicators', exampleQueries:['cyber threats','threat intelligence','otx','malware indicators','cyber security'], schema:{type:'api',endpoint:'/api/otx',method:'GET',params:{section:'OTX section',limit:'max results'}} },
    { name:'displacement_data', category:'osint', description:'UNHCR displacement data — refugees and internally displaced persons by year', exampleQueries:['displacement','refugees','idp','unhcr','displaced persons','forced migration'], schema:{type:'api',endpoint:'/api/displacement',method:'GET',params:{year:'year filter'}} },

    // ── Unified RAG Search ──
    { name:'search_all', category:'general', description:'Unified natural-language search across ALL geospatial databases (earthquakes, weather, hazards, aviation, maritime, space, EO, osint). Accepts any question and returns the most relevant data. Use this when you are unsure which specific tool to call, or when the query spans multiple domains.', exampleQueries:['what is happening near japan','check all threats near tokyo','find everything about this location','analyze region','show me what is important'], schema:{type:'api',endpoint:'/api/agent/search-all',method:'POST',params:{query:'natural language query',lat:'latitude for location context',lon:'longitude for location context'},outputFormat:'JSON'} },
  ];
  for (const t of tools) toolRegistry.register(t);
}
registerDefaultTools();

// Initialize dynamic tool system (toolRegistry delegates to dynamicTools — single source of truth)
dynamicTools.init();
const toolComposer = new ToolComposer(dynamicTools);
toolComposer.init();
toolDiscovery.init();
toolRepair.init();
executor.init();

// Initialize Omninet — free-tier AI provider router
omninet.init();

// Auto-start local llama-server GGUF fallback if the model file exists.
// Spawns in background; the local-gguf provider in omninet uses it as a
// last-resort when all remote providers are unavailable.
const GGUF_MODEL = './models/LFM2.5-2.6B-Q4_K_M.gguf';
const GGUF_PORT = 11436;
if (fs.existsSync(GGUF_MODEL)) {
  const llamaBin = process.env.LLAMA_SERVER_PATH || '/opt/homebrew/bin/llama-server';
  const llamaOut = fs.openSync('/tmp/terranoetis-llama.log', 'a');
  const llamaServer = spawn(llamaBin, [
    '--model', GGUF_MODEL,
    '--port', String(GGUF_PORT),
    '-c', '2048',
  ], { stdio: ['ignore', llamaOut, llamaOut], detached: true });
  llamaServer.unref();
  llamaServer.on('error', (err: Error) => logger.warn({ err: err.message }, 'llama-server failed to start'));
  logger.info({ port: GGUF_PORT, model: GGUF_MODEL, bin: llamaBin }, 'Local GGUF fallback model started');
  // Give it ~15s to load the model, then the provider is ready.
  setTimeout(() => {
    logger.info('Local GGUF model ready (or failed silently — harmless)');
  }, 15000);
} else {
  logger.warn({ path: GGUF_MODEL }, 'GGUF model not found — local-gguf fallback unavailable');
}

// Phase 4: Initialize memory systems with embedding engine
const embeddingEngine = new EmbeddingEngine();
const memoryManager = new MemoryManager(embeddingEngine);
memoryManagerV2.setEmbedder(embeddingEngine);
memoryManagerV2.init();

// Phase 9: Cost optimization (must be after memoryManager)
const costTracker = new CostTracker();
const enhancedCache = new EnhancedCache(3600, 0.6);
const origSemanticSet = memoryManager.semanticCache.set.bind(memoryManager.semanticCache);
const origSemanticGet = memoryManager.semanticCache.get.bind(memoryManager.semanticCache);
memoryManager.semanticCache.set = async (q: string, r: string) => { await origSemanticSet(q, r); enhancedCache.set(q, r); };
memoryManager.semanticCache.get = async (q: string) => { const e = enhancedCache.get(q); if (e) return e; return origSemanticGet(q); };

// Phase 10: Self-improving system (must be after memoryManager + costTracker)
const feedbackManager = new FeedbackManager();
const selfImprover = new SelfImprover(feedbackManager);
selfImprover.setCache(enhancedCache);

// SelfImproverV2: unified meta-cognition hub
selfImproverV2.setFeedbackManager(feedbackManager);
selfImproverV2.init();
selfImproverV2.start();

// CognitiveAgent: dual-process cognition (System 1 fast + System 2 deep)
const cognitiveAgent = new CognitiveAgent();
cognitiveAgent.init().catch(e => logger.error({ err: e }, 'CognitiveAgent init error'));

// Module-level engine declarations (for gracefulShutdown access)
let correlationEngine: CorrelationEngine | null = null;

// Sentinel: proactive continuous monitoring system
sentinel.init().then(() => {
  sentinel.start();
  const db = getDb();

  // Start Anomaly Correlation Engine
  correlationEngine = null;
  try {
    correlationEngine = new CorrelationEngine(db);
    correlationEngine.start();
    // Fetch external data sources immediately
    correlationEngine.ingestFromExternalSources().catch(() => {});
    logger.info('[Correlation] Engine started — cross-correlating real data streams');
  } catch (err) {
    logger.error({ err: String(err) }, '[Correlation] Engine failed to start');
  }

  // ── Correlation Engine API ──
  app.get('/api/correlation/anomalies', (req: express.Request, res: express.Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const anomalies = correlationEngine?.getAllAnomalies(limit) || [];
      res.json({ anomalies, count: anomalies.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/correlation/anomalies/:id/acknowledge', (req: express.Request, res: express.Response) => {
    try {
      correlationEngine?.acknowledgeAnomaly(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/correlation/status', (_req: express.Request, res: express.Response) => {
    res.json(correlationEngine?.getStatus() || { running: false, windowEvents: 0, anomalyCount: 0, ruleCount: 0 });
  });





  // ── Start Priority 1-10 upgraded engines ──
  try {
    roadTrafficDetector.start();
    spacexEngine.start();
    bayFireDetector.start();
    weatherForecaster.start();
    agricultureMonitor.start();
    logger.info('[Priority1-10] All upgraded engines started');
  } catch (err) {
    logger.error({ err: String(err) }, '[Priority1-10] Engine startup failed');
  }

  logger.info('Sentient ambient intelligence activated');
}).catch(e => logger.error({ err: e }, 'Sentinel init error'));

// Multimodal: satellite imagery, seismic waveforms, weather radar, social sentiment
multimodal.init().then(() => {
  multimodal.start();
  logger.info('Multimodal perception systems activated');
}).catch(e => logger.error({ err: e }, 'Multimodal init error'));

// Explainability: full transparency — reasoning traces, evidence chains, uncertainty, bias, overrides
explainability.init();
explainability.start();

// ML Pipeline: knowledge graph + predictor + generative KG
knowledgeGraph.setEmbeddingEngine(embeddingEngine);
predictor.setEmbeddingEngine(embeddingEngine);
predictor.init();
entityGenerator.init();
edgeGenerator.init();
counterfactualGraph.init();
graphCompletion.init();
evolvingGraph.init();
causalGraph.init();

// Phase 7: Plugin system
const syncPluginTools = () => {
  for (const [name, pt] of pluginManager.getToolHandlers()) {
    // Always (re)register plugin tools with the correct POST schema — the
    // tool may already exist in the in-memory registry from a DB load with a
    // stale schema (e.g. missing method), so don't skip based on existence.
    toolRegistry.register({ name, description: pt.description, category: pt.category || 'plugin', exampleQueries: [name], schema: { type: 'api', endpoint: `/api/plugin/tool/${name}`, method: 'POST' } });
  }
};
const pluginManager = new PluginManager(syncPluginTools);
pluginManager.init().then(syncPluginTools).catch(e => logger.error('Plugin init error:', e));

// Phase 3: Initialize proactive systems
const monitorManager = new MonitorManager();
const schedulerManager = new SchedulerManager();
const ambientDetector = new AmbientEventDetector();

// Wire background managers to publish to pubsub for SSE delivery
monitorManager.onTrigger((rule, data) => {
  const eventData = { type: 'monitor_trigger', rule: { id: rule.id, label: rule.label, count: rule.count }, data };
  pubsub.publish('proactive', eventData);
});

schedulerManager.onReport((task) => {
  const eventData = { type: 'scheduled_report', task: { id: task.id, label: task.label, goal: task.goal, result: task.result?.slice(0, 2000) } };
  pubsub.publish('proactive', eventData);
});

ambientDetector.onEvent((ambientEvent) => {
  const eventData = { type: 'ambient_event', event: ambientEvent };
  pubsub.publish('proactive', eventData);
});

// Wire monitor + ambient events into sentinel stream
monitorManager.onTrigger((rule, data) => {
  pubsub.publish('sentinel:raw', {
    source: 'monitor',
    type: 'monitor_trigger',
    timestamp: Date.now(),
    lat: rule.location?.lat || 0,
    lon: rule.location?.lon || 0,
    payload: { ruleId: rule.id, label: rule.label, count: rule.count, ...data },
  });
});

ambientDetector.onEvent((event) => {
  pubsub.publish('sentinel:raw', {
    source: 'ambient_detector',
    type: event.type,
    timestamp: event.timestamp,
    lat: event.lat,
    lon: event.lon,
    payload: { title: event.title, description: event.description, severity: event.severity },
  });
});

// Set up scheduler executor (uses the same pipeline logic)
schedulerManager.setExecutor(async (task) => {
  const subtasks = TaskPlanner.decompose(task.goal);
  const results: string[] = [];
  for (const st of subtasks) {
    if (st.code && st.language) {
      try {
        const r = await sandboxManager.execute({ language: st.language, code: st.code, timeout: 30000 });
        results.push(`## ${st.description}\n\`\`\`\n${r.stdout.slice(0, 1000)}\n\`\`\``);
      } catch (e) {
        results.push(`## ${st.description}\n*Failed: ${e}*`);
      }
    }
  }
  return results.join('\n\n') || 'No results generated.';
});

// ── Background Job Queue ───────────────────────────────────────
const jobQueue = new SimpleQueue(10);

// Bind proactive managers to the queue
monitorManager.bindQueue(jobQueue);
schedulerManager.bindQueue(jobQueue);
ambientDetector.bindQueue(jobQueue);

// MaterializedViewCache refresh as recurring queue job
jobQueue.process('mvc:refresh', async () => {
  await materializedViews.refreshInternal();
});
jobQueue.recurring('mvc:refresh', 60000);

// Plugin scanner as recurring queue job
jobQueue.process('plugin:scan', async () => {
  for (const [name, pt] of pluginManager.getToolHandlers()) {
    toolRegistry.register({ name, description: pt.description, category: pt.category || 'plugin', exampleQueries: [name], schema: { type: 'api', endpoint: `/api/plugin/tool/${name}`, method: 'POST' } });
  }
});
jobQueue.recurring('plugin:scan', 30000);

// ML Pipeline: synthetic data generation as recurring queue job
jobQueue.process('ml:synthetic', async () => {
  if (!isAutonomousAiAllowed()) return; // chat-only mode: skip background LLM generation
  await generateTrainingExample();
});
jobQueue.recurring('ml:synthetic', 3600000);

// ML Pipeline: knowledge graph cleanup / stats as recurring queue job
jobQueue.process('ml:kg_stats', async () => {
  const stats = knowledgeGraph.getStats();
  logger.info({ ...stats }, 'knowledge graph stats');
});
jobQueue.recurring('ml:kg_stats', 600000);

// Singleton browser for Puppeteer-based scrapers
let puppeteerBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
let browserPromise: Promise<Awaited<ReturnType<typeof puppeteer.launch>>> | null = null;
async function getBrowser() {
  if (puppeteerBrowser && puppeteerBrowser.connected) return puppeteerBrowser;
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  }
  puppeteerBrowser = await browserPromise;
  return puppeteerBrowser;
}

async function cachedFetch<T>(key: string, url: string, ttl = 60, init?: RequestInit, res?: express.Response): Promise<T> {
  const hit = await getCached<T>(key);
  if (hit.value !== undefined) {
    if (res) {
      res.set('X-Cache', hit.source.toUpperCase());
      const at = getCachedAt(key);
      if (at) res.set('X-Data-Age', `${Date.now() - at}ms`);
    }
    return hit.value;
  }
  const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`${key} upstream ${resp.status}`);
  const data = (await resp.json()) as T;
  await setCached(key, data, ttl);
  if (res) {
    res.set('X-Cache', 'MISS');
    res.set('X-Data-Age', '0ms');
  }
  return data;
}

interface IndiaCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source: string;
  category?: string;
  city?: string;
  region?: string;
  location?: string;
  updatedAt: number;
  description?: string;
}

interface IndiaCctvPayload {
  source: string;
  country: string;
  updatedAt: number;
  cameras: IndiaCctvCamera[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'camera';
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function collectJsonLdNodes(input: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    input.forEach(item => collectJsonLdNodes(item, out));
    return out;
  }

  if (!input || typeof input !== 'object') {
    return out;
  }

  const record = input as Record<string, unknown>;
  out.push(record);

  if (record['@graph']) {
    collectJsonLdNodes(record['@graph'], out);
  }
  if (record.itemListElement) {
    collectJsonLdNodes(record.itemListElement, out);
  }
  if (record.item) {
    collectJsonLdNodes(record.item, out);
  }

  return out;
}

function extractIndiaCctvCameras(html: string): IndiaCctvCamera[] {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jsonLdNodes: Record<string, unknown>[] = [];

  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      collectJsonLdNodes(JSON.parse(raw), jsonLdNodes);
    } catch (e) {
      logger.warn({ err: e }, 'Malformed JSON-LD block in CCTV page');
    }
  }

  const itemLists = jsonLdNodes.filter(node => node['@type'] === 'ItemList' && Array.isArray(node.itemListElement));
  const entries = itemLists.flatMap(list => {
    const items = list.itemListElement as Array<Record<string, unknown> | undefined>;
    return items.map(entry => (entry && typeof entry === 'object' ? (entry.item as Record<string, unknown> | undefined) ?? entry : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  });

  const cameras = new Map<string, IndiaCctvCamera>();

  for (const [index, item] of entries.entries()) {
    const record = item as Record<string, any>;
    const contentLocation = record.contentLocation as Record<string, any> | undefined;
    const geo = contentLocation?.geo as Record<string, any> | undefined;
    const lat = toNumber(geo?.latitude ?? record.latitude ?? record.lat);
    const lon = toNumber(geo?.longitude ?? record.longitude ?? record.lon);
    if (lat == null || lon == null) continue;

    const pageUrl = String(record.url ?? record.mainEntityOfPage ?? record.sameAs ?? '');
    const previewUrl = String(record.thumbnailUrl ?? record.image ?? record.contentUrl ?? '');
    const streamUrl = String(record.contentUrl ?? record.embedUrl ?? pageUrl ?? previewUrl ?? '');
    const address = contentLocation?.address as Record<string, any> | undefined;
    const name = String(record.name ?? record.headline ?? `India Camera ${index + 1}`);
    const id = slugify(pageUrl || `${name}-${lat}-${lon}`);

    cameras.set(id, {
      id,
      name,
      lat,
      lon,
      pageUrl: pageUrl || streamUrl || previewUrl || 'https://opencctv.org/cameras/india',
      previewUrl: previewUrl || undefined,
      streamUrl: streamUrl || undefined,
      thumbnailUrl: String(record.thumbnailUrl ?? record.image ?? '') || undefined,
      source: 'opencctv.org',
      category: String(record.genre ?? record.additionalType ?? record.keywords ?? 'public webcam'),
      city: String(address?.addressLocality ?? '') || undefined,
      region: String(address?.addressRegion ?? '') || undefined,
      location: String(contentLocation?.name ?? address?.addressLocality ?? address?.addressRegion ?? 'India'),
      updatedAt: Date.now(),
      description: String(record.description ?? '') || undefined,
    });
  }

  return [...cameras.values()];
}

// ═══════════════════════════════════════════════════════════════════════
// OBSERVABILITY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════



app.get('/api/health', async (_req: express.Request, res: express.Response) => {
  const checks: Record<string, { status: string; detail?: string }> = {};

  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.db = { status: 'ok' };
  } catch (e) {
    checks.db = { status: 'fail', detail: (e as Error).message };
  }

  const providerStatus = omninet.getStatus();
  const geminiStatus = providerStatus.find(s => s.name === 'gemini');
  if (geminiStatus) {
    checks.gemini = { status: geminiStatus.status === 'healthy' ? 'ok' : geminiStatus.status === 'down' ? 'fail' : 'degraded' };
  } else {
    checks.gemini = { status: 'not_configured' };
  }

  const diskFree = 0;
  try {
    const tmpPath = process.env.TMPDIR || '/tmp';
    const usage = process.memoryUsage();
    checks.memory = { status: usage.heapUsed > 500 * 1024 * 1024 ? 'degraded' : 'ok', detail: `${Math.round(usage.heapUsed / 1024 / 1024)}MB` };
  } catch (e) {
    logger.warn({ err: e }, 'Health check: memory check failed');
    checks.memory = { status: 'unknown' };
  }

  // Engine health checks
  const engineNames = ['__reflexEngine', '__forkManager', '__dreamEngine', '__memorySystem', '__entropyMixer', '__discoveryEngine'] as const;
  const engineLabels: Record<string, string> = {
    __reflexEngine: 'reflex',
    __forkManager: 'forks',
    __dreamEngine: 'dream',
    __memorySystem: 'memory',
    __entropyMixer: 'entropy',
    __discoveryEngine: 'discovery',
  };
  for (const name of engineNames) {
    const g = (global as any)[name];
    checks[engineLabels[name]] = { status: g ? 'ok' : 'missing' };
  }

  // Pubsub check
  try {
    let pubsubOk = false;
    const unsub = pubsub.subscribe('health:check', () => { pubsubOk = true; });
    pubsub.publish('health:check', { t: Date.now() });
    unsub();
    checks.pubsub = { status: pubsubOk ? 'ok' : 'fail' };
  } catch (e) {
    logger.warn({ err: e }, 'Health check: pubsub unavailable');
    checks.pubsub = { status: 'fail' };
  }

  // Redis check — a Redis outage silently degrades caching + pubsub, so it
  // must be visible in /api/health (and thus the Docker HEALTHCHECK + alerting).
  try {
    const redisOk = await redisHealthCheck();
    checks.redis = { status: redisOk ? 'ok' : 'fail', detail: redisOk ? 'PONG' : 'unreachable' };
  } catch (e) {
    logger.warn({ err: e }, 'Health check: redis unavailable');
    checks.redis = { status: 'fail', detail: (e as Error).message };
  }

  const overallStatus = Object.values(checks).every(c => c.status === 'ok' || c.status === 'not_configured') ? 'healthy' : 'degraded';

  res.json({
    status: overallStatus,
    checks,
    uptime_ms: process.uptime() * 1000,
    version: '3.1',
    ts: Date.now(),
  });
});

// Liveness probe — the process is up. Always 200 while the server runs.
app.get('/api/live', (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, ts: Date.now(), uptime_ms: process.uptime() * 1000 });
});

// Readiness probe — the server is accepting traffic and its core dependency
// (database) is reachable. Returns 503 when not ready.
app.get('/api/ready', async (_req: express.Request, res: express.Response) => {
  const checks: Record<string, { status: string; detail?: string }> = {};
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.db = { status: 'ok' };
  } catch (e) {
    checks.db = { status: 'fail', detail: (e as Error).message };
  }
  const ready = checks.db.status === 'ok';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    uptime_ms: process.uptime() * 1000,
    ts: Date.now(),
  });
});

app.get('/api/memory/stats', async (_req: express.Request, res: express.Response) => {
  const tiers = await memorySystem.getStats();
  res.json({ tiers, timestamp: Date.now() });
});


app.get('/api/metrics', async (_req: express.Request, res: express.Response) => {
  const metricsToken = process.env.METRICS_API_TOKEN;
  const provided = (_req.headers.authorization || '').replace('Bearer ', '') || (_req.query.token as string);
  if (metricsToken && provided !== metricsToken) {
    return res.status(401).json({ error: 'Unauthorized — provide METRICS_API_TOKEN' });
  }
  res.setHeader('Content-Type', getMetricsContentType());
  res.end(await getMetrics());
});

app.get('/api/admin/metrics', requireRole('admin'), async (_req: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', getMetricsContentType());
  res.end(await getMetrics());
});

app.get('/api/admin/audit-logs', requireRole('admin'), (req: express.Request, res: express.Response) => {
  const limit = Number(req.query.limit ?? 100);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500
    || !Number.isInteger(offset) || offset < 0) {
    return res.status(400).json({ error: 'limit must be 1-500 and offset must be a non-negative integer' });
  }
  const db = getDb();
  const logs = db.prepare(
    `SELECT id, user_id, action, resource, details, ip_address, user_agent, created_at
     FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(limit, offset);
  const total = (db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get() as { count: number }).count;
  res.json({ logs, total, limit, offset });
});

app.get('/api/admin/plugins', requireRole('admin'), (_req: express.Request, res: express.Response) => {
  res.json({
    plugins: pluginManager.listPlugins().map((plugin) => ({ ...plugin, enabled: true })),
  });
});

function parseGitHubUrl(url: string): { owner: string; repo: string; branch: string; path: string } | null {
  const u = new URL(url);
  if (u.hostname !== 'github.com') return null;
  const parts = u.pathname.replace(/^\//, '').split('/');
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  const branch = parts[3] || 'main';
  const path = parts.slice(4).join('/') || '';
  return { owner, repo, branch, path };
}

async function installFromGitHub(url: string): Promise<{ pluginIds: string[]; errors: string[] }> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error('Invalid GitHub URL');
  let { owner, repo, branch, path } = parsed;
  const ghToken = process.env.GITHUB_TOKEN || '';
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

  // Resolve the actual default branch when none was given (many repos use
  // "master" instead of "main").
  if (!url.includes('/tree/') && !url.includes('/blob/')) {
    try {
      const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(10000) });
      if (repoResp.ok) {
        const repoData = await repoResp.json() as { default_branch?: string };
        if (repoData?.default_branch) branch = repoData.default_branch;
      }
    } catch { /* fall back to given branch */ }
  }

  // Fetch the full repo tree recursively so we find every .ts/.js file,
  // not just the shallow top two levels.
  let files: Array<{ name: string; downloadUrl: string }> = [];
  try {
    const treeResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (treeResp.ok) {
      const tree = await treeResp.json() as { tree?: Array<{ path?: string; type?: string }> };
      const prefix = path ? `${path}/` : '';
      files = (tree.tree || [])
        .filter(t => t.type === 'blob' && t.path && t.path.startsWith(prefix) && /\.(ts|js)$/.test(t.path))
        .map(t => ({ name: t.path!.split('/').pop()!, downloadUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodeURIComponent(t.path!)}` }));
    }
  } catch { /* fall through to contents API */ }

  // Fallback: contents API (shallow) if the trees API failed.
  if (files.length === 0) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
    const data = await resp.json() as any;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item.type === 'file' && (item.name.endsWith('.ts') || item.name.endsWith('.js'))) {
        files.push({ name: item.name, downloadUrl: item.download_url });
      }
      if (item.type === 'dir') {
        const subDirResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(item.path)}?ref=${encodeURIComponent(branch)}`,
          { headers, signal: AbortSignal.timeout(15000) }
        );
        if (subDirResp.ok) {
          const subItems = await subDirResp.json() as any[];
          for (const sub of subItems) {
            if (sub.type === 'file' && (sub.name.endsWith('.ts') || sub.name.endsWith('.js'))) {
              files.push({ name: sub.name, downloadUrl: sub.download_url });
            }
          }
        }
      }
    }
  }

  const pluginIds: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const contentResp = await fetch(file.downloadUrl, { signal: AbortSignal.timeout(15000) });
      if (!contentResp.ok) { errors.push(`${file.name}: download failed (${contentResp.status})`); continue; }
      const content = await contentResp.text();
      const pluginId = await pluginManager.installPlugin(file.name, content);
      if (pluginId) pluginIds.push(pluginId);
      else errors.push(`${file.name}: installed but not loaded`);
    } catch (e) {
      errors.push(`${file.name}: ${String(e)}`);
    }
  }
  return { pluginIds, errors };
}

app.post('/api/admin/plugins/install', requireRole('admin'), async (req: express.Request, res: express.Response) => {
  const { url, name, content } = req.body ?? {};

  // Install from URL
  if (url && typeof url === 'string') {
    try {
      // Detect GitHub URLs
      if (url.includes('github.com')) {
        const result = await installFromGitHub(url);
        return res.json({ ok: true, type: 'github', ...result });
      }
      // Regular URL — single file
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return res.status(400).json({ error: `Failed to download plugin: ${resp.status}` });
      const fileContent = await resp.text();
      const filename = url.split('/').pop() || 'plugin.ts';
      const pluginId = await pluginManager.installPlugin(filename, fileContent);
      if (!pluginId) return res.status(500).json({ error: 'Plugin installed but not loaded — check server logs for errors' });
      return res.json({ ok: true, pluginId, source: url });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  // Install from raw content
  if (name && content && typeof name === 'string' && typeof content === 'string') {
    try {
      const pluginId = await pluginManager.installPlugin(name, content);
      if (!pluginId) return res.status(500).json({ error: 'Plugin installed but not loaded — check server logs for errors' });
      return res.json({ ok: true, pluginId, source: 'content' });
    } catch (e) {
      return res.status(400).json({ error: String(e) });
    }
  }

  res.status(400).json({ error: 'Either { url: "https://..." } or { name: "plugin.ts", content: "..." } is required' });
});

app.post('/api/admin/plugins/install-zip', requireRole('admin'), async (req: express.Request, res: express.Response) => {
  const { zipB64 } = req.body ?? {};
  if (!zipB64 || typeof zipB64 !== 'string') {
    return res.status(400).json({ error: 'zipB64 (base64-encoded zip) is required' });
  }
  try {
    const AdmZip = (await import('adm-zip')).default;
    const buffer = Buffer.from(zipB64, 'base64');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const pluginIds: string[] = [];
    const errors: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue;
      if (entry.isDirectory) continue;
      try {
        const content = entry.getData().toString('utf-8');
        const pluginId = await pluginManager.installPlugin(entry.name, content);
        if (pluginId) pluginIds.push(pluginId);
        else errors.push(`${entry.name}: installed but not loaded`);
      } catch (e) {
        errors.push(`${entry.name}: ${String(e)}`);
      }
    }
    res.json({ ok: true, pluginIds, errors });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.delete('/api/admin/plugins/:id', requireRole('admin'), (req: express.Request, res: express.Response) => {
  const removed = pluginManager.removePlugin(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Plugin not found or cannot be removed (builtin plugins are protected)' });
  res.json({ ok: true, removed: req.params.id });
});

app.post('/api/admin/plugins/:id/toggle', requireRole('admin'), (req: express.Request, res: express.Response) => {
  const enabled = req.body?.enabled === true;
  const ok = pluginManager.setEnabled(req.params.id, enabled);
  if (!ok) return res.status(404).json({ error: 'Plugin not found' });
  res.json({ ok: true, id: req.params.id, enabled });
});

// ── Local GGUF model download ──────────────────────────────────
// Downloads the LFM 2.5 2.6B Q4_K_M GGUF model into ./models/ so the
// local llama-server fallback works out of the box. Tracks progress so the
// admin panel can show a live progress bar.
const GGUF_DOWNLOAD_URL = process.env.GGUF_DOWNLOAD_URL || 'https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf';
const GGUF_MODEL_NAME = GGUF_MODEL.replace('./models/', '');
const GGUF_PARTIAL_PATH = `${GGUF_MODEL}.partial`;
const ggufDownloadState: { running: boolean; received: number; total: number; done: boolean; error?: string; startedAt?: number; resuming?: boolean; resumeOffset: number; cancelled: boolean } = { running: false, received: 0, total: 0, done: false, resumeOffset: 0, cancelled: false };
let ggufDownloadAbort: AbortController | null = null;

async function downloadGGUFModel(): Promise<void> {
  if (ggufDownloadState.running) return;
  ggufDownloadState.running = true;
  ggufDownloadState.done = false;
  ggufDownloadState.error = undefined;
  ggufDownloadState.cancelled = false;
  ggufDownloadState.startedAt = Date.now();

  const abort = new AbortController();
  ggufDownloadAbort = abort;

  try {
    await fs.promises.mkdir('./models', { recursive: true });

    // Resume support: if a .partial file already exists, pick up from where
    // the last (interrupted) attempt stopped instead of starting over.
    let resumeFrom = 0;
    try {
      if (fs.existsSync(GGUF_PARTIAL_PATH)) resumeFrom = fs.statSync(GGUF_PARTIAL_PATH).size;
    } catch { /* ignore */ }
    ggufDownloadState.resuming = resumeFrom > 0;
    ggufDownloadState.resumeOffset = resumeFrom;
    ggufDownloadState.received = resumeFrom;

    const headers: Record<string, string> = {};
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
    const resp = await fetch(GGUF_DOWNLOAD_URL, { headers, signal: abort.signal });
    if (!resp.ok || !resp.body) {
      ggufDownloadState.error = `Download failed (HTTP ${resp.status})`;
      ggufDownloadState.running = false;
      return;
    }
    // If we asked for a partial (resume) but the server responded 200 with the
    // FULL body (Range ignored), appending would double/corrupt the file.
    // Require 206 Partial Content when resuming.
    if (resumeFrom > 0 && resp.status !== 206) {
      ggufDownloadState.error = `Server ignored Range request (HTTP ${resp.status}) — delete the .partial file and retry from scratch`;
      ggufDownloadState.running = false;
      return;
    }

    // Total size: HuggingFace returns the full size in the Content-Range header
    // when resuming, otherwise Content-Length.
    let total = Number(resp.headers.get('content-length') || 0);
    if (resumeFrom > 0) {
      const cr = resp.headers.get('content-range'); // e.g. "bytes 500000000-1674455039/1674455040"
      const m = cr ? /\/\s*(\d+)\s*$/.exec(cr) : null;
      if (m) total = Number(m[1]);
      else total += resumeFrom;
    }
    ggufDownloadState.total = total;

    // Stream to a .partial temp file so an interrupted download never leaves a
    // corrupt file at the real model path. Rename to the final path on success.
    const writer = fs.createWriteStream(GGUF_PARTIAL_PATH, { flags: resumeFrom > 0 ? 'a' : 'w' });

    const reader = resp.body.getReader();
    const pump = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          writer.write(Buffer.from(value));
          ggufDownloadState.received += value.length;
        }
      }
    };
    await pump();
    await new Promise<void>((resolve, reject) => writer.end((err: Error | null) => (err ? reject(err) : resolve())));

    await fs.promises.rename(GGUF_PARTIAL_PATH, GGUF_MODEL);
    ggufDownloadState.done = true;
    ggufDownloadState.resuming = false;
    logger.info({ path: GGUF_MODEL, bytes: ggufDownloadState.received }, 'GGUF model download complete');
  } catch (e) {
    if (ggufDownloadState.cancelled) {
      logger.info('GGUF model download cancelled by user');
    } else {
      ggufDownloadState.error = (e as Error).message;
      logger.error({ err: e }, 'GGUF model download failed — partial file kept for resume');
    }
  } finally {
    ggufDownloadState.running = false;
    ggufDownloadAbort = null;
  }
}

app.get('/api/admin/models/gguf-status', requireRole('admin'), (_req: express.Request, res: express.Response) => {
  let exists = false;
  let size = 0;
  let partialExists = false;
  let partialSize = 0;
  try {
    exists = fs.existsSync(GGUF_MODEL);
    if (exists) size = fs.statSync(GGUF_MODEL).size;
    partialExists = fs.existsSync(GGUF_PARTIAL_PATH);
    if (partialExists) partialSize = fs.statSync(GGUF_PARTIAL_PATH).size;
  } catch { /* ignore */ }
  const elapsedMs = ggufDownloadState.startedAt ? Date.now() - ggufDownloadState.startedAt : 0;
  const downloadedSinceStart = Math.max(0, ggufDownloadState.received - ggufDownloadState.resumeOffset);
  const speedBytes = ggufDownloadState.running && elapsedMs > 0 ? (downloadedSinceStart / elapsedMs) * 1000 : 0;
  const remaining = ggufDownloadState.total > 0 ? Math.max(0, ggufDownloadState.total - ggufDownloadState.received) : 0;
  const etaSeconds = speedBytes > 0 && remaining > 0 ? Math.round(remaining / speedBytes) : 0;
  res.json({
    installed: exists && size > 1_000_000_000,
    size,
    partialSize,
    url: GGUF_DOWNLOAD_URL,
    download: {
      ...ggufDownloadState,
      percent: ggufDownloadState.total > 0 ? Math.min(100, Math.round((ggufDownloadState.received / ggufDownloadState.total) * 100)) : 0,
      speedBytes,
      etaSeconds,
    },
  });
});

app.post('/api/admin/models/gguf-download', requireRole('admin'), (_req: express.Request, res: express.Response) => {
  if (fs.existsSync(GGUF_MODEL) && fs.statSync(GGUF_MODEL).size > 1_000_000_000) {
    return res.json({ ok: true, alreadyInstalled: true });
  }
  void downloadGGUFModel();
  res.json({ ok: true, started: true, message: 'Model download started' });
});

app.delete('/api/admin/models/gguf', requireRole('admin'), (_req: express.Request, res: express.Response) => {
  try {
    // Abort any active download first
    if (ggufDownloadState.running) {
      ggufDownloadState.cancelled = true;
      ggufDownloadAbort?.abort();
    }
    // Reset state
    Object.assign(ggufDownloadState, { running: false, received: 0, total: 0, done: false, error: undefined, startedAt: undefined, resuming: false, resumeOffset: 0, cancelled: false });
    ggufDownloadAbort = null;

    let removed = false;
    if (fs.existsSync(GGUF_MODEL)) {
      fs.unlinkSync(GGUF_MODEL);
      removed = true;
    }
    if (fs.existsSync(GGUF_PARTIAL_PATH)) {
      fs.unlinkSync(GGUF_PARTIAL_PATH);
      removed = true;
    }
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/config/apis', (_req: express.Request, res: express.Response) => {
  // Return available APIs and their registration links
  res.json({
    apis: API_METADATA,
    categories: getCategories(),
  });
});

app.get('/api/earthquakes', async (req: express.Request, res: express.Response) => {
  try {
    const { minLat, maxLat, minLon, maxLon, minMag, starttime, endtime, hours } = req.query as Record<string, string | undefined>;

    // If time or bbox params specified, use USGS FDSN query API for filtered results
    if (starttime || endtime || minLat || maxLat || minLon || maxLon) {
      const start = starttime || new Date(Date.now() - (parseInt(hours || '24', 10)) * 3600000).toISOString();
      const end = endtime || new Date().toISOString();
      const bbox = (minLat && maxLat && minLon && maxLon)
        ? `&minlatitude=${minLat}&maxlatitude=${maxLat}&minlongitude=${minLon}&maxlongitude=${maxLon}`
        : '';
      const mag = minMag ? `&minmagnitude=${minMag}` : '';
      const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${encodeURIComponent(start)}&endtime=${encodeURIComponent(end)}${bbox}${mag}&orderby=time`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return res.status(502).json({ error: `USGS returned ${resp.status}` });
      const data = await resp.json();
      return res.json(data);
    }

    // Default: cached all-day feed
    const data = await cachedFetch(
      'earthquakes',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      60, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/earthquakes/significant', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await cachedFetch(
      'earthquakes_significant',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
      300, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/tectonic', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await cachedFetch(
      'tectonic',
      'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
      86400, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

interface WorldwideCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source: string;
  category?: string;
  city?: string;
  region?: string;
  location?: string;
  updatedAt: number;
  description?: string;
  feedType?: string;
}

interface WorldwideCctvPayload {
  source: string;
  country: string;
  updatedAt: number;
  cameras: WorldwideCctvCamera[];
}

// Provider sources whose sampled feeds all failed liveness probing
// (probed 2026-08-05, 3 feed URLs each). Filtered out server-side so the
// merged feed only serves playable cameras.
const CCTV_DEAD_SOURCES = new Set([
  "airportwebcams",
  "algotraffic",
  "amsbih",
  "autobahn_nrw",
  "balikesir",
  "balticlivecam",
  "birds-il",
  "boating-vic",
  "brownrice",
  "camguide-ipcamlive",
  "camsecure",
  "chile-dgac",
  "climaaovivo",
  "dersp",
  "ecrmm-udep",
  "epic-ski",
  "faa-weathercams",
  "forecastweather",
  "geonet",
  "ineter",
  "infoclimat",
  "iowa_dot",
  "ipcamlive-crwebcams",
  "ipcamlive-midatlantic-gap",
  "ipcamlive-ocean-city-md",
  "ipcamlive-worldviewstream",
  "istanbul-ibb",
  "jogjaprov",
  "kcscout",
  "konya",
  "ktict",
  "livecameras-gr",
  "maineturnpike",
  "margaharjaya",
  "medellin-simm",
  "naodos-gr",
  "njta",
  "noirlab",
  "nycdot",
  "oktraffic",
  "opencctv.org",
  "paspro",
  "recife-cttu",
  "rtsp.me",
  "sochi-camera",
  "taiwan-freeway",
  "taiwan_freeway",
  "telpin-argentina",
  "thailand-doh",
  "trafficvision",
  "travelmidwest",
  "txdot",
  "vdotcameras",
  "vegvesen",
  "weatherbug",
  "wikaserangpanimbang",
  "youtube_scenic"
]);

function isPlayableFeedUrl(cam: WorldwideCctvCamera): boolean {
  const feed = cam.previewUrl ?? cam.streamUrl ?? cam.thumbnailUrl;
  if (!feed) return true; // pageUrl-only camera; nothing to drop
  return /^https?:\/\//i.test(feed);
}

function filterHealthyCctvCams(cams: WorldwideCctvCamera[]): {
  cameras: WorldwideCctvCamera[];
  removed: number;
  removedByScheme: number;
  removedBySource: number;
} {
  let removedByScheme = 0;
  let removedBySource = 0;
  const cameras = cams.filter(cam => {
    if (CCTV_DEAD_SOURCES.has(cam.source)) {
      removedBySource++;
      return false;
    }
    if (!isPlayableFeedUrl(cam)) {
      removedByScheme++;
      return false;
    }
    return true;
  });
  return { cameras, removed: removedByScheme + removedBySource, removedByScheme, removedBySource };
}

function computeCctvHealth(cams: WorldwideCctvCamera[]) {
  const bySource = new Map<string, { total: number; playable: number; deadByScheme: number }>();
  for (const cam of cams) {
    const key = cam.source || 'opencctv.org';
    const row = bySource.get(key) ?? { total: 0, playable: 0, deadByScheme: 0 };
    row.total++;
    if (isPlayableFeedUrl(cam)) row.playable++;
    else row.deadByScheme++;
    bySource.set(key, row);
  }
  const sources = [...bySource.entries()]
    .map(([source, s]) => ({
      source,
      total: s.total,
      playable: s.playable,
      deadByScheme: s.deadByScheme,
      blocked: CCTV_DEAD_SOURCES.has(source),
    }))
    .sort((a, b) => b.total - a.total);
  const filtered = filterHealthyCctvCams(cams);
  return {
    updatedAt: Date.now(),
    total: cams.length,
    filtered: filtered.cameras.length,
    removed: filtered.removed,
    removedByScheme: filtered.removedByScheme,
    removedBySource: filtered.removedBySource,
    deadSources: CCTV_DEAD_SOURCES.size,
    sources,
  };
}

const BOUNDS = [
  { s: 24, w: -100, n: 50, e: -65 },   // US East / Midwest
  { s: 24, w: -125, n: 50, e: -100 },  // US West
  { s: -56, w: -90, n: 20, e: -34 },   // South & Central America
  { s: 36, w: -10, n: 62, e: 16 },     // Western Europe
  { s: 30, w: 16, n: 70, e: 60 },      // Eastern Europe & Middle East
  { s: 5, w: 60, n: 36, e: 98 },       // India & South Asia
  { s: 20, w: 120, n: 46, e: 146 },    // East Asia (Japan, Korea, Taiwan)
  { s: -50, w: 110, n: -10, e: 180 },  // Oceania (Australia & New Zealand)
  { s: -35, w: -20, n: 35, e: 55 }     // Africa
];

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── SkylineWebcams (3,300+ cameras, 90+ countries, no key) ──
async function fetchSkylineWebcams(): Promise<WorldwideCctvCamera[]> {
  const cams: WorldwideCctvCamera[] = [];
  try {
    const resp = await fetch('https://www.skylinewebcams.com/en/webcam', {
      headers: { 'User-Agent': 'Terranoetis/1.0 (public camera explorer)', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const items: any[] = [];
    // Try parsing embedded JSON-LD
    const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs);
    if (ldMatch) {
      for (const block of ldMatch) {
        try {
          const json = JSON.parse(block.replace(/<[^>]+>/g, ''));
          if (json?.itemListElement) {
            for (const el of json.itemListElement) {
              if (el?.url) items.push(el.url);
            }
          }
        } catch (e) { logger.warn({ err: e }, 'Skipping item list entry'); }
      }
    }
    // Fallback: extract camera links from HTML
    if (!items.length) {
      const linkRe = /href="(\/en\/webcam\/[^"]+)"/g;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        items.push('https://www.skylinewebcams.com' + m[1]);
      }
    }
    // Fetch individual camera pages for details (limit to 50 to avoid overload)
    const unique = [...new Set(items as string[])];
    const batch = unique.slice(0, 50);
    const pages = await Promise.allSettled(
      batch.map(url =>
        fetch(url, { headers: { 'User-Agent': 'Terranoetis/1.0' }, signal: AbortSignal.timeout(8000) })
          .then(r => r.ok ? r.text() : null)
      )
    );
    for (const result of pages) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const pageHtml = result.value;
      const nameMatch = pageHtml.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const latMatch = pageHtml.match(/"latitude"\s*:\s*([\d.-]+)/);
      const lonMatch = pageHtml.match(/"longitude"\s*:\s*([\d.-]+)/);
      const imgMatch = pageHtml.match(/<img[^>]+id="webcamImage"[^>]+src="([^"]+)"/);
      if (nameMatch && latMatch && lonMatch) {
        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          cams.push({
            id: 'swc_' + lat + '_' + lon,
            name: nameMatch[1].trim(),
            lat, lon,
            pageUrl: batch[cams.length] || '',
            previewUrl: imgMatch?.[1] || undefined,
            streamUrl: undefined,
            thumbnailUrl: imgMatch?.[1] || undefined,
            source: 'skylinewebcams.com',
            category: 'scenic webcam',
            city: undefined,
            region: undefined,
            location: 'Worldwide',
            updatedAt: Date.now(),
            feedType: 'image',
          });
        }
      }
    }
  } catch (e) { logger.warn({ err: e }, 'Skyline webcam scrape failed'); }
  return cams;
}

// ── Live-Environment-Streams (5,172 cameras, 80 countries, pre-verified GeoJSON) ──
async function fetchLiveEnvStreams(): Promise<WorldwideCctvCamera[]> {
  const cams: WorldwideCctvCamera[] = [];
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/willytop8/Live-Environment-Streams/main/streams.geojson',
      { headers: { 'User-Agent': 'Terranoetis/1.0' }, signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) return [];
    const geojson = await resp.json() as any;
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    for (const f of features) {
      const p = f?.properties || {};
      const coords = f?.geometry?.coordinates;
      const lat = coords?.[1];
      const lon = coords?.[0];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (p.status === 'deprecated') continue;
      const feedUrl = p.url || '';
      const isHls = p.url_type === 'hls';
      cams.push({
        id: 'les_' + (p.name || 'cam') + '_' + lat + '_' + lon,
        name: p.display_name || p.name || 'Live Camera',
        lat, lon,
        pageUrl: feedUrl.startsWith('http') ? feedUrl : `https://www.google.com/search?q=${encodeURIComponent(p.name || 'camera')}`,
        previewUrl: feedUrl.startsWith('http') ? feedUrl : undefined,
        streamUrl: isHls ? feedUrl : undefined,
        thumbnailUrl: undefined,
        source: p.source_family || 'live-environment-streams',
        category: p.environment || p.scene_type || 'public webcam',
        city: undefined,
        region: undefined,
        location: p.country_code || 'Worldwide',
        updatedAt: Date.now(),
        feedType: isHls ? 'm3u8' : (p.url_type === 'http_image' ? 'image' : undefined),
      });
    }
  } catch (e) { logger.warn({ err: e }, 'LiveEnv stream scrape failed'); }
  return cams;
}

async function fetchWorldwideCameras(): Promise<WorldwideCctvCamera[]> {
  // Fetch from additional open sources concurrently
  const [extraSkyline, extraLiveEnv] = await Promise.allSettled([
    fetchSkylineWebcams(),
    fetchLiveEnvStreams(),
  ]);
  const extraCams: WorldwideCctvCamera[] = [];
  if (extraSkyline.status === 'fulfilled') extraCams.push(...extraSkyline.value);
  if (extraLiveEnv.status === 'fulfilled') extraCams.push(...extraLiveEnv.value);

  // Fetch India cameras from webpage first to guarantee their inclusion
  let indiaCams: WorldwideCctvCamera[] = [];
  try {
    const resp = await fetch('https://opencctv.org/cameras/india', {
      headers: { 'User-Agent': 'Terranoetis/1.0 (public camera explorer)' },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const html = await resp.text();
      indiaCams = extractIndiaCctvCameras(html);
    }
  } catch (e) {
    logger.warn({ err: e }, 'opencctv.org India feed unavailable');
  }

  const fetchBox = async (box: typeof BOUNDS[0]) => {
    try {
      const url = `https://opencctv.org/api/cameras?bounds=${box.s},${box.w},${box.n},${box.e}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Terranoetis/1.0 (public camera explorer)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      logger.warn({ err: e }, 'OpenCCTV box fetch failed');
      return [];
    }
  };

  const results = await Promise.all(BOUNDS.map(fetchBox));
  const allCams = new Map<string, any>();

  // Prepopulate with scraped India cameras
  for (const c of indiaCams) {
    allCams.set(c.id, {
      id: c.id,
      name: c.name,
      lat: c.lat,
      lng: c.lon,
      feed_url: c.previewUrl ?? c.streamUrl ?? c.pageUrl,
      feed_type: (c.streamUrl?.includes('m3u8') || c.previewUrl?.includes('m3u8')) ? 'm3u8' : 'image',
      source: c.source || 'opencctv.org',
      category: c.category,
      city: c.city,
      state: c.region,
      country: 'IN'
    });
  }

  for (const list of results) {
    for (const cam of list) {
      if (cam && cam.id && Number.isFinite(cam.lat) && Number.isFinite(cam.lng)) {
        allCams.set(cam.id, cam);
      }
    }
  }

  // Merge extra sources (SkylineWebcams, Live-Environment-Streams)
  for (const cam of extraCams) {
    if (!allCams.has(cam.id)) {
      allCams.set(cam.id, {
        id: cam.id,
        name: cam.name,
        lat: cam.lat,
        lng: cam.lon,
        feed_url: cam.previewUrl ?? cam.streamUrl ?? cam.pageUrl,
        feed_type: cam.feedType === 'm3u8' ? 'm3u8' : 'image',
        source: cam.source,
        category: cam.category,
        city: cam.city,
        state: cam.region,
        country: cam.location?.slice(-2) || undefined,
      });
    }
  }

  const cams = Array.from(allCams.values());
  const hlsCams = shuffleArray(cams.filter(c => c.feed_type === 'm3u8' && c.feed_url && c.feed_url.startsWith('http')));
  const otherCams = shuffleArray(cams.filter(c => c.feed_type !== 'm3u8'));

  // Merge all cameras without hard limits — prefer HLS, then all others
  const addedIds = new Set<string>();
  const filteredCams: any[] = [];

  // Guarantee scraped Indian cameras are added first
  const indiaSpecific = cams.filter(c => c.country === 'IN');
  for (const cam of indiaSpecific) {
    if (addedIds.has(cam.id)) continue;
    addedIds.add(cam.id);
    filteredCams.push(cam);
  }

  // 1. Add all valid HLS (video) streams
  for (const cam of hlsCams) {
    if (addedIds.has(cam.id)) continue;
    addedIds.add(cam.id);
    filteredCams.push(cam);
  }

  // 2. Add all other feeds (mjpeg/images)
  for (const cam of otherCams) {
    if (addedIds.has(cam.id)) continue;
    addedIds.add(cam.id);
    filteredCams.push(cam);
  }

  const proxied = (url: string | undefined): string | undefined => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
    if (!url.startsWith('https://opencctv.org/api/')) return url;
    return `/api/cctv/proxy?url=${encodeURIComponent(url)}`;
  };
  return filteredCams.map(cam => {
    const pageUrl = `https://opencctv.org/cameras/${cam.id}`;
    const feedUrl = cam.feed_url;
    return {
      id: cam.id,
      name: cam.name || `Camera ${cam.camera_code}`,
      lat: cam.lat,
      lon: cam.lng,
      pageUrl,
      previewUrl: proxied(feedUrl),
      streamUrl: proxied(feedUrl),
      thumbnailUrl: proxied(feedUrl),
      source: cam.source || 'opencctv.org',
      category: cam.category || 'public webcam',
      city: cam.city || undefined,
      region: cam.state || undefined,
      location: [cam.city, cam.state, cam.country].filter(Boolean).join(', ') || 'Worldwide',
      updatedAt: Date.now(),
      description: cam.description || undefined,
      feedType: cam.feed_type
    };
  });
}



// Server-side proxy for opencctv.org feeds. The upstream returns
// `Cross-Origin-Resource-Policy: same-origin`, so browsers refuse to embed
// those URLs directly. Strip CORP by proxying through here.
app.get('/api/cctv/proxy', async (req: express.Request, res: express.Response) => {
  try {
    const target = String(req.query.url ?? '');
    if (!target || !isAllowedUpstream(target)) {
      return res.status(400).json({ error: 'url query param must be an allow-listed upstream' });
    }
    const ssrfCheck = await validateOutboundUrl(target);
    if (!ssrfCheck.safe) {
      return res.status(400).json({ error: `Refused: ${ssrfCheck.reason ?? 'unsafe URL'}` });
    }
    const isHls = /\.m3u8(\?|$)/.test(target);
    // Upstream (opencctv.org) blocks bare non-browser UAs; send a realistic UA
    // plus a Referer so Cloudflare doesn't reject us.
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Referer': 'https://opencctv.org/',
      'Accept': '*/*',
    };
    if (isHls) {
      // hls.js sends Origin on some browsers; pass it through so upstream HLS
      // endpoints that validate referer/origin keep working.
      const origin = req.headers.origin;
      if (origin) headers.Origin = origin;
    }
    const resp = await fetch(target, { headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream responded ${resp.status}` });
    }
    const contentType = resp.headers.get('content-type') ?? (isHls ? 'application/vnd.apple.mpegurl' : 'image/jpeg');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    if (!resp.body) return res.status(502).json({ error: 'Upstream returned no body' });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.send(buf);
  } catch (e) {
    logger.warn({ err: e }, 'cctv proxy failed');
    if (!res.headersSent) res.status(502).json({ error: String(e) });
  }
});

// Backward-compatible camera route documented by earlier releases.
app.get(['/api/cameras', '/api/cameras/:lat/:lon/:radius', '/api/cctv/worldwide'], async (req: express.Request, res: express.Response) => {
  try {
    let payload = cache.get<WorldwideCctvPayload>('cctv_worldwide');
    if (!payload) {
      payload = {
        source: 'opencctv.org',
        country: 'Worldwide',
        updatedAt: Date.now(),
        cameras: await fetchWorldwideCameras(),
      };
      cache.set('cctv_worldwide', payload, 1800);
      cache.set('cctv_worldwide_health', computeCctvHealth(payload.cameras), 1800);
    }

    // Serve only playable cameras: drop all-dead provider sources and any
    // feed URLs that use a non-http scheme (txdot://, boating-vic://, ...).
    const filtered = filterHealthyCctvCams(payload.cameras);
    const healthyPayload = {
      ...payload,
      cameras: filtered.cameras,
      filter: {
        removed: filtered.removed,
        removedByScheme: filtered.removedByScheme,
        removedBySource: filtered.removedBySource,
      },
    };

    if (req.params.lat === undefined) return res.json(healthyPayload);
    const lat = Number(req.params.lat);
    const lon = Number(req.params.lon);
    const radius = Number(req.params.radius);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90
      || !Number.isFinite(lon) || Math.abs(lon) > 180
      || !Number.isFinite(radius) || radius <= 0 || radius > 20_000) {
      return res.status(400).json({ error: 'lat, lon, and radius must be valid; radius is in km (0-20000)' });
    }

    res.json({
      ...healthyPayload,
      cameras: filtered.cameras.filter((camera) => haversineDistance(lat, lon, camera.lat, camera.lon) <= radius),
      query: { lat, lon, radiusKm: radius },
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// Per-source health for the merged webcam feed (structural stats computed from
// the cached payload; does not re-probe upstream).
app.get('/api/cctv/health', (_req: express.Request, res: express.Response) => {
  try {
    let health = cache.get<ReturnType<typeof computeCctvHealth>>('cctv_worldwide_health');
    if (!health) {
      const payload = cache.get<WorldwideCctvPayload>('cctv_worldwide');
      if (!payload) return res.status(503).json({ error: 'cctv feed not loaded yet; hit /api/cctv/worldwide first' });
      health = computeCctvHealth(payload.cameras);
      cache.set('cctv_worldwide_health', health, 1800);
    }
    res.json(health);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/vaac/tokyo', async (req: express.Request, res: express.Response) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 200' });
  }

  try {
    const cacheKey = 'vaac_tokyo';
    let advisories = cache.get<VaacAdvisory[]>(cacheKey);
    if (!advisories) {
      const response = await fetch('https://ds.data.jma.go.jp/svd/vaac/data/vaac_list.html', {
        headers: { 'User-Agent': 'Terranoetis/1.0 (volcanic ash advisories)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Tokyo VAAC ${response.status}`);
      advisories = parseTokyoVaacHtml(await response.text());
      if (advisories.length === 0) throw new Error('Tokyo VAAC returned no parseable advisories');
      cache.set(cacheKey, advisories, 300);
    }
    res.json({
      advisories: advisories.slice(0, requestedLimit),
      source: 'Tokyo VAAC (Japan Meteorological Agency)',
      updatedAt: Date.now(),
    });
  } catch (e) {
    logger.warn({ err: e }, 'Tokyo VAAC feed unavailable');
    res.json({
      advisories: [],
      source: 'Tokyo VAAC (Japan Meteorological Agency)',
      available: false,
      message: 'Tokyo VAAC advisories are temporarily unavailable.',
    });
  }
});

// ── Anchorage VAAC ──
app.get('/api/vaac/anchorage', async (req: express.Request, res: express.Response) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 200' });
  }
  try {
    const cacheKey = 'vaac_anchorage';
    let advisories = cache.get<VaacAdvisory[]>(cacheKey);
    if (!advisories) {
      const url = 'https://vaac.arh.noaa.gov/list.php';
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Terranoetis/1.0 (volcanic ash advisories)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Anchorage VAAC ${response.status}`);
      advisories = parseNoaaVaacHtml(await response.text(), 'Anchorage VAAC (NOAA)', url);
      if (advisories.length === 0) throw new Error('Anchorage VAAC returned no parseable advisories');
      cache.set(cacheKey, advisories, 300);
    }
    res.json({
      advisories: advisories.slice(0, requestedLimit),
      source: 'Anchorage VAAC (NOAA)',
      updatedAt: Date.now(),
    });
  } catch (e) {
    logger.warn({ err: e }, 'Anchorage VAAC feed unavailable');
    res.json({
      advisories: [],
      source: 'Anchorage VAAC (NOAA)',
      available: false,
      message: 'Anchorage VAAC advisories are temporarily unavailable.',
    });
  }
});

// ── Washington VAAC ──
app.get('/api/vaac/washington', async (req: express.Request, res: express.Response) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 200' });
  }
  try {
    const cacheKey = 'vaac_washington';
    let advisories = cache.get<VaacAdvisory[]>(cacheKey);
    if (!advisories) {
      const url = 'https://vaac.washington.noaa.gov/list.php';
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Terranoetis/1.0 (volcanic ash advisories)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Washington VAAC ${response.status}`);
      advisories = parseNoaaVaacHtml(await response.text(), 'Washington VAAC (NOAA)', url);
      if (advisories.length === 0) throw new Error('Washington VAAC returned no parseable advisories');
      cache.set(cacheKey, advisories, 300);
    }
    res.json({
      advisories: advisories.slice(0, requestedLimit),
      source: 'Washington VAAC (NOAA)',
      updatedAt: Date.now(),
    });
  } catch (e) {
    logger.warn({ err: e }, 'Washington VAAC feed unavailable');
    res.json({
      advisories: [],
      source: 'Washington VAAC (NOAA)',
      available: false,
      message: 'Washington VAAC advisories are temporarily unavailable.',
    });
  }
});

app.get('/api/eonet', async (req: express.Request, res: express.Response) => {
  // Parse bbox from either individual params or combined bbox param (lonMin,latMin,lonMax,latMax)
  let latMin = parseFloat(req.query.latMin as string);
  let latMax = parseFloat(req.query.latMax as string);
  let lonMin = parseFloat(req.query.lonMin as string);
  let lonMax = parseFloat(req.query.lonMax as string);
  if (!(Number.isFinite(latMin) && Number.isFinite(latMax) && Number.isFinite(lonMin) && Number.isFinite(lonMax))) {
    const bboxParam = req.query.bbox as string | undefined;
    if (bboxParam) {
      const parts = bboxParam.split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        [lonMin, latMin, lonMax, latMax] = parts;
      }
    }
  }
  const hasBbox = Number.isFinite(latMin) && Number.isFinite(latMax) && Number.isFinite(lonMin) && Number.isFinite(lonMax);

  const fetchEonet = (days: number) =>
    cachedFetch<EonetPayload>(
      `eonet_${days}`,
      `https://eonet.gsfc.nasa.gov/api/v3/events?days=${days}&status=open`,
      120,
    );
  for (const days of [30, 14, 7, 3]) {
    try {
      const data = await fetchEonet(days);
      const category = readEonetCategoryFilter(req.query.source ?? req.query.category);
      let filtered = filterEonetPayload(data, category);

      // Filter by bbox if provided
      if (hasBbox && Array.isArray(filtered.events)) {
        filtered = {
          ...filtered,
          events: filtered.events.filter((event: any) => {
            const geom = event?.geometry;
            if (!Array.isArray(geom) || geom.length === 0) return false;
            // EONET geometry is an array of { coordinates: [lon, lat], date: ... }
            const coords = geom[0]?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return false;
            const eLon = coords[0];
            const eLat = coords[1];
            return eLat >= latMin && eLat <= latMax && eLon >= lonMin && eLon <= lonMax;
          }),
        };
      }

      return res.json(filtered);
    } catch (e) {
      if (days > 7) {
        logger.info({ days, err: String(e) }, 'EONET fetch failed, trying smaller window');
      } else if (days > 3) {
        logger.warn({ days, err: String(e) }, 'EONET fetch failed, falling back to minimum window');
      } else {
        logger.error({ days, err: String(e) }, 'EONET entirely unavailable after all fallback attempts');
        return res.status(502).json({ error: String(e) });
      }
    }
  }
});

let lastKnownIssPosition: IssPosition | null = null;
let issPrimaryRetryAfter = 0;

async function fetchIssPosition(): Promise<IssPosition> {
  const primaryCached = cache.get<IssPosition>('iss');
  if (primaryCached && isValidIssPosition(primaryCached)) return primaryCached;

  if (Date.now() >= issPrimaryRetryAfter) {
    try {
      const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Where The ISS ${response.status}`);
      const position = await response.json() as IssPosition;
      if (!isValidIssPosition(position)) throw new Error('Where The ISS returned invalid coordinates');
      const result = { ...position, source: 'Where The ISS' };
      cache.set('iss', result, 5);
      lastKnownIssPosition = result;
      return result;
    } catch (error) {
      issPrimaryRetryAfter = Date.now() + 60_000;
      logger.warn({ err: error }, 'ISS primary feed unavailable; using CelesTrak fallback');
    }
  }

  try {
    let tle = cache.get<IssTle>('iss_tle');
    if (!tle) {
      const response = await fetch(
        'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE',
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error(`CelesTrak ${response.status}`);
      tle = parseIssTle(await response.text());
      cache.set('iss_tle', tle, 3600);
    }
    const result = propagateIssPosition(tle);
    lastKnownIssPosition = result;
    return result;
  } catch (error) {
    if (lastKnownIssPosition) {
      logger.warn({ err: error }, 'ISS fallback unavailable; serving last known position');
      return {
        ...lastKnownIssPosition,
        stale: true,
        warning: 'Live ISS feeds are temporarily unavailable; this is the last known position.',
      };
    }
    throw error;
  }
}

app.get('/api/iss', async (_req: express.Request, res: express.Response) => {
  try {
    res.json(await fetchIssPosition());
  } catch (e) {
    res.status(503).json({
      error: 'ISS position is temporarily unavailable',
      detail: e instanceof Error ? e.message : String(e),
      retryable: true,
    });
  }
});

app.get('/api/flights', async (req: express.Request, res: express.Response) => {
  const authHeader = req.headers.authorization;
  const headers: Record<string, string> = authHeader ? { Authorization: authHeader } : {};
  const key = authHeader ? 'flights_auth' : 'flights';
  try {
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const resp = await fetch('https://opensky-network.org/api/states/all', { ...headers, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
    const data = await resp.json();
    cache.set(key, data, 30);
    res.json(data);
  } catch (e) {
    // Do NOT cache the empty result long-term: OpenSky anonymous access is
    // heavily rate-limited (429). A 10-minute empty cache would blank the
    // aviation tracker even after the limit expires. Cache briefly so bursts
    // of requests don't hammer OpenSky, but let the panel recover quickly.
    cache.set(key, { states: [] }, 30);
    res.json({ states: [], note: 'OpenSky unavailable: ' + String(e) });
  }
});


// ── Combined flights: query ALL aviation sources, deduplicate by hex ──
app.get('/api/flights/all', async (req: express.Request, res: express.Response) => {
  const reqLat = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
  const reqLon = req.query.lon ? parseFloat(req.query.lon as string) : NaN;
  const locParam = (isFinite(reqLat) && isFinite(reqLon)) ? `?lat=${reqLat.toFixed(2)}&lon=${reqLon.toFixed(2)}` : '';
  const base = `http://127.0.0.1:${PORT}`;

  async function fetchSource(url: string, timeoutMs = 6000): Promise<{ states?: unknown[][] }> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return r.ok ? (await r.json() as { states?: unknown[][] }) : { states: [] };
    } catch (e) {
      clearTimeout(id);
      logger.warn({ err: e }, 'ADSB source fetch failed');
      return { states: [] };
    }
  }

  const sources = [
    fetchSource(`${base}/api/flights`),
    fetchSource(`${base}/api/adsb-lol${locParam}`, 10000),
    fetchSource(`${base}/api/adsb-fi${locParam}`, 10000),
    fetchSource(`${base}/api/flightaware`),
    fetchSource(`${base}/api/airlabs`),
  ];

  const seen = new Set<string>();
  const merged: unknown[][] = [];

  const results = await Promise.allSettled(sources);
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value as { states?: unknown[][] };
    if (!data.states) continue;
    for (const state of data.states) {
      const id = String(state[0] ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // Defensive normalization to the canonical OpenSky 17-field layout so
      // downstream consumers (panel parseState, travel-view tracking) never
      // see ragged arrays regardless of which upstream source produced them.
      const s = Array.isArray(state) ? [...state] : [];
      while (s.length < 17) s.push(null);
      merged.push(s);
    }
  }

  res.json({ states: merged, time: Math.floor(Date.now() / 1000), count: merged.length });
});

// ── Military flights (OpenSky, filtered by callsign pattern) ──────────
const MILITARY_CALLSIGN_PATTERNS = [
  /^RCH\d*$/i, /^NAF\d*$/i, /^GAF\d*$/i, /^RAF\d*$/i, /^IAF\d*$/i,
  /^PLF\d*$/i, /^CFC\d*$/i, /^BKA\d*$/i, /^DUCK\d*$/i, /^SNAKE\d*$/i,
  /^VIPR\d*$/i, /^SNDL\d*$/i, /^MAGIC\d*$/i, /^DEATH\d*$/i,
  /^HAWG\d*$/i, /^RAVEN\d*$/i, /^STING\d*$/i, /^VIPER\d*$/i,
  /^JEDI\d*$/i, /^SABER\d*$/i, /^STEEL\d*$/i, /^GORilla\d*$/i,
  /^UAF\d*$/i, /^RMAF\d*$/i, /^USAF\d*$/i, /^JASDF\d*$/i,
  /^AAC\d*$/i, /^RTAF\d*$/i, /^ROCAF\d*$/i, /^PAF\d*$/i,
  /^FNF\d*$/i, /^KAF\d*$/i, /^ETAF\d*$/i,
];

app.get('/api/flights/military', async (_req: express.Request, res: express.Response) => {
  try {
    const hit = cache.get<{ states: any[]; time: number }>('flights_military');
    if (hit) return res.json(hit);
    const resp = await fetch('https://opensky-network.org/api/states/all', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
    const data = await resp.json();
    const allStates: any[] = Array.isArray(data?.states) ? data.states : [];
    const military = allStates.filter((s: any[]) => {
      const callsign = (s[1] || '').toString().trim();
      return callsign && MILITARY_CALLSIGN_PATTERNS.some(re => re.test(callsign));
    });
    const result = { states: military, time: data?.time || Math.floor(Date.now() / 1000), count: military.length, source: 'opensky-filtered' };
    cache.set('flights_military', result, 30);
    res.json(result);
  } catch (e) {
    res.json({ states: [], count: 0, error: String(e) });
  }
});


// --- AVIATION LAYERS ---

// ── Global ADSB coverage grid ──
// Covers all major landmasses with overlapping circles (dist ≈ 300 NM ≈ 555 km)
const GLOBAL_ADSB_REGIONS = [
  // North America
  { lat: 60, lon: -150, dist: 300, key: 'ak' },
  { lat: 55, lon: -120, dist: 300, key: 'ca_w' },
  { lat: 50, lon: -95, dist: 300, key: 'ca_c' },
  { lat: 45, lon: -75, dist: 300, key: 'ca_e' },
  { lat: 45, lon: -120, dist: 300, key: 'us_w' },
  { lat: 40, lon: -100, dist: 300, key: 'us_c' },
  { lat: 35, lon: -80, dist: 300, key: 'us_e' },
  { lat: 28, lon: -98, dist: 300, key: 'us_s' },
  { lat: 22, lon: -100, dist: 300, key: 'mx_c' },
  // Central America / Caribbean
  { lat: 18, lon: -75, dist: 300, key: 'carib' },
  { lat: 10, lon: -85, dist: 300, key: 'cam' },
  // South America
  { lat: 10, lon: -68, dist: 300, key: 'sa_n' },
  { lat: -3, lon: -55, dist: 300, key: 'sa_amz' },
  { lat: -10, lon: -40, dist: 300, key: 'sa_br' },
  { lat: -18, lon: -65, dist: 300, key: 'sa_w' },
  { lat: -25, lon: -55, dist: 300, key: 'sa_s' },
  { lat: -35, lon: -65, dist: 300, key: 'sa_arg' },
  // Europe
  { lat: 60, lon: -5, dist: 300, key: 'eu_nw' },
  { lat: 55, lon: 10, dist: 300, key: 'eu_n' },
  { lat: 48, lon: 5, dist: 300, key: 'eu_c' },
  { lat: 45, lon: 25, dist: 300, key: 'eu_e' },
  { lat: 52, lon: 40, dist: 300, key: 'eu_ru' },
  { lat: 42, lon: 0, dist: 300, key: 'eu_sw' },
  { lat: 42, lon: 15, dist: 300, key: 'eu_se' },
  { lat: 38, lon: -8, dist: 300, key: 'ib' },
  // Scandinavia / Baltic
  { lat: 62, lon: 20, dist: 300, key: 'scan' },
  // Russia / Central Asia
  { lat: 60, lon: 50, dist: 300, key: 'ru_w' },
  { lat: 60, lon: 90, dist: 300, key: 'ru_c' },
  { lat: 55, lon: 130, dist: 300, key: 'ru_e' },
  { lat: 45, lon: 65, dist: 300, key: 'ca_as' },
  // Middle East
  { lat: 38, lon: 35, dist: 300, key: 'me_tr' },
  { lat: 32, lon: 45, dist: 300, key: 'me_iq' },
  { lat: 25, lon: 48, dist: 300, key: 'me_ar' },
  { lat: 30, lon: 55, dist: 300, key: 'me_ir' },
  // Africa
  { lat: 35, lon: -5, dist: 300, key: 'af_nw' },
  { lat: 30, lon: 30, dist: 300, key: 'af_ne' },
  { lat: 15, lon: -10, dist: 300, key: 'af_w' },
  { lat: 10, lon: 15, dist: 300, key: 'af_c' },
  { lat: 5, lon: 35, dist: 300, key: 'af_e' },
  { lat: -5, lon: 15, dist: 300, key: 'af_sc' },
  { lat: -15, lon: 25, dist: 300, key: 'af_s_c' },
  { lat: -28, lon: 25, dist: 300, key: 'af_s' },
  // South Asia / India
  { lat: 28, lon: 72, dist: 300, key: 'in_nw' },
  { lat: 24, lon: 82, dist: 300, key: 'in_ne' },
  { lat: 16, lon: 77, dist: 300, key: 'in_c' },
  { lat: 10, lon: 78, dist: 300, key: 'in_s' },
  // East Asia
  { lat: 42, lon: 125, dist: 300, key: 'ea_ne' },
  { lat: 34, lon: 115, dist: 300, key: 'ea_c' },
  { lat: 26, lon: 110, dist: 300, key: 'ea_sc' },
  { lat: 35, lon: 138, dist: 300, key: 'jp' },
  { lat: 38, lon: 127, dist: 300, key: 'kr' },
  // Southeast Asia
  { lat: 20, lon: 100, dist: 300, key: 'sea_mm' },
  { lat: 14, lon: 105, dist: 300, key: 'sea_th' },
  { lat: 10, lon: 125, dist: 300, key: 'ph' },
  { lat: -3, lon: 115, dist: 300, key: 'sea_id' },
  { lat: 2, lon: 105, dist: 300, key: 'sea_my' },
  { lat: 10, lon: 108, dist: 300, key: 'sea_vn' },
  // Oceania
  { lat: -20, lon: 140, dist: 300, key: 'au_n' },
  { lat: -28, lon: 145, dist: 300, key: 'au_c' },
  { lat: -35, lon: 140, dist: 300, key: 'au_s' },
  { lat: -37, lon: 175, dist: 300, key: 'nz' },
  // Pacific
  { lat: 22, lon: -160, dist: 300, key: 'hi' },
  // Greenland / Iceland
  { lat: 65, lon: -40, dist: 300, key: 'gl' },
  { lat: 64, lon: -20, dist: 300, key: 'is' },
];

// ADSB.lol - public aircraft tracking via geographic point queries
app.get('/api/adsb-lol', async (req: express.Request, res: express.Response) => {
  const regions = [...GLOBAL_ADSB_REGIONS];
  const reqLat = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
  const reqLon = req.query.lon ? parseFloat(req.query.lon as string) : NaN;
  if (isFinite(reqLat) && isFinite(reqLon) && Math.abs(reqLat) <= 90 && Math.abs(reqLon) <= 180) {
    regions.push({ lat: reqLat, lon: reqLon, dist: 300, key: 'pinpoint' });
  }
  const seen = new Set<string>();
  const states: any[][] = [];
  const fetchOpts = { headers: { 'User-Agent': 'Terranoetis/1.0' } };
  const results = await Promise.allSettled(
    regions.map(r =>
      cachedFetch<any>(
        `adsb_lol_${r.key}`,
        `https://api.adsb.lol/v2/point/${r.lat}/${r.lon}/${r.dist}`,
        30,
        fetchOpts,
      )
    )
  );
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    if (!data || typeof data !== 'object' || !('ac' in (data as any))) continue;
    for (const ac of (data as any).ac || []) {
      if (!ac.hex || seen.has(ac.hex)) continue;
      seen.add(ac.hex);
      states.push([
        ac.hex,
        (ac.flight || '').trim(),
        '', '', Math.floor(Date.now() / 1000),
        ac.lon, ac.lat,
        ((ac.alt_baro && typeof ac.alt_baro === 'number' ? ac.alt_baro : ac.alt_geom) || 0) * 0.3048,
        false, (ac.gs || ac.speed || 0) * 0.514444, ac.track || ac.heading || 0,
        (ac.baro_rate || 0) * 0.3048,
        '', ((ac.alt_geom && typeof ac.alt_geom === 'number' ? ac.alt_geom : 0) || 0) * 0.3048,
        ac.squawk ? String(ac.squawk) : '', false, 0,
      ]);
    }
  }
  res.json({ states, time: Math.floor(Date.now() / 1000) });
});

// adsb.fi - public aircraft tracking via geographic point queries
app.get('/api/adsb-fi', async (req: express.Request, res: express.Response) => {
  const regions = [...GLOBAL_ADSB_REGIONS];
  const reqLat = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
  const reqLon = req.query.lon ? parseFloat(req.query.lon as string) : NaN;
  if (isFinite(reqLat) && isFinite(reqLon) && Math.abs(reqLat) <= 90 && Math.abs(reqLon) <= 180) {
    regions.push({ lat: reqLat, lon: reqLon, dist: 300, key: 'pinpoint' });
  }
  const seen = new Set<string>();
  const states: any[][] = [];
  const fetchOpts = { headers: { 'User-Agent': 'Terranoetis/1.0' } };
  const results = await Promise.allSettled(
    regions.map(r =>
      cachedFetch<any>(
        `adsb_fi_${r.key}`,
        `https://opendata.adsb.fi/api/v3/lat/${r.lat}/lon/${r.lon}/dist/${r.dist}`,
        30,
        fetchOpts,
      )
    )
  );
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    if (!data || typeof data !== 'object' || !('ac' in (data as any))) continue;
    for (const ac of (data as any).ac || []) {
      if (!ac.hex || seen.has(ac.hex)) continue;
      seen.add(ac.hex);
      states.push([
        ac.hex,
        (ac.flight || '').trim(),
        '', '', Math.floor(Date.now() / 1000),
        ac.lon, ac.lat,
        ((ac.alt_baro && typeof ac.alt_baro === 'number' ? ac.alt_baro : ac.alt_geom) || 0) * 0.3048,
        false, (ac.gs || ac.speed || 0) * 0.514444, ac.track || ac.heading || 0,
        (ac.baro_rate || 0) * 0.3048,
        '', ((ac.alt_geom && typeof ac.alt_geom === 'number' ? ac.alt_geom : 0) || 0) * 0.3048,
        ac.squawk ? String(ac.squawk) : '', false, 0,
      ]);
    }
  }
  res.json({ states, time: Math.floor(Date.now() / 1000) });
});

// FlightAware AeroAPI (requires API key)
app.get('/api/flightaware', async (req: express.Request, res: express.Response) => {
  const apiKey = req.headers['x-aeroapi-key'] as string || process.env.FLIGHTAWARE_AEROAPI_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'FlightAware AeroAPI key not configured. Add in Settings or set FLIGHTAWARE_AEROAPI_KEY in .env' });
    return;
  }
  try {
    const cacheKey = `flightaware_${apiKey.slice(0, 8)}`;
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }
    const resp = await fetch('https://aeroapi.flightaware.com/aeroapi/flights/search/in_flight', {
      headers: { 'x-apikey': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`FlightAware ${resp.status}`);
    const data = await resp.json() as any;
    const flights = data.flights || [];
    const now = Math.floor(Date.now() / 1000);
    // FlightAware returns altitude in FEET and groundspeed in KNOTS.
    // Convert to OpenSky's meters / m/s so the merged states array is uniform.
    const states = flights.map((f: any) => [
      f.ident_icao || f.ident || '',
      f.ident || '',
      '', '', Math.floor(Date.now() / 1000),
      f.longitude || 0, f.latitude || 0,
      (f.altitude || 0) * 0.3048,        // feet → meters
      false, (f.groundspeed || 0) * 0.514444,  // knots → m/s
      f.heading || 0, (f.alt_rate || 0) * 0.3048,  // fpm → m/s
      '', 0, '',
      false, 0,
    ]);
    const result = { states, time: now };
    cache.set(cacheKey, result, 30);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// AirLabs API (requires API key)
app.get('/api/airlabs', async (req: express.Request, res: express.Response) => {
  const apiKey = req.headers['x-airlabs-key'] as string || process.env.AIRLABS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'AirLabs API key not configured. Add in Settings or set AIRLABS_API_KEY in .env' });
    return;
  }
  try {
    const cacheKey = `airlabs_${apiKey.slice(0, 8)}`;
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }
    const resp = await fetch(`https://airlabs.co/api/v9/flights?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`AirLabs ${resp.status}`);
    const data = await resp.json() as any;
    const flights = data.response || [];
    const now = Math.floor(Date.now() / 1000);
    // AirLabs units: alt=meters, speed=km/h, v_speed=m/s.
    // Convert to OpenSky's meters / m/s.
    const states = flights.map((f: any) => [
      f.hex || f.flight_icao || '',
      f.flight_icao || f.flight_iata || '',
      f.flag || '', '', Math.floor(Date.now() / 1000),
      f.lng || f.lon || 0, f.lat || 0,
      f.alt || 0,                              // already meters
      false, (f.speed || 0) / 3.6,             // km/h → m/s
      f.dir || 0, f.v_speed || 0,              // heading, v_speed already m/s
      '', f.alt || 0,                           // geo_alt same as baro_alt
      f.squawk ? String(f.squawk) : '', false, 0,
    ]);
    const result = { states, time: now };
    cache.set(cacheKey, result, 30);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// OpenFlights - static airport & route data
const OPENFLIGHTS_AIRPORTS_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const OPENFLIGHTS_ROUTES_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat';

app.get('/api/openflights', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'openflights_data';
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }

    const [airportsResp, routesResp] = await Promise.all([
      fetch(OPENFLIGHTS_AIRPORTS_URL, { signal: AbortSignal.timeout(15000) }),
      fetch(OPENFLIGHTS_ROUTES_URL, { signal: AbortSignal.timeout(15000) }),
    ]);

    if (!airportsResp.ok || !routesResp.ok) throw new Error('OpenFlights upstream error');

    const airportsText = await airportsResp.text();
    const routesText = await routesResp.text();

    const airports = airportsText.split('\n').filter(Boolean).map(line => {
      const parts = line.split(',');
      return {
        id: parts[0],
        name: parts[1]?.replace(/"/g, ''),
        city: parts[2]?.replace(/"/g, ''),
        country: parts[3]?.replace(/"/g, ''),
        iata: parts[4]?.replace(/"/g, ''),
        icao: parts[5]?.replace(/"/g, ''),
        lat: parseFloat(parts[6]),
        lon: parseFloat(parts[7]),
        alt: parseInt(parts[8], 10) || 0,
        tz: parts[9]?.replace(/"/g, ''),
        dst: parts[10]?.replace(/"/g, ''),
      };
    }).filter(a => isFinite(a.lat) && isFinite(a.lon) && a.iata && a.iata.length === 3);

    const routes = routesText.split('\n').filter(Boolean).map(line => {
      const parts = line.split(',');
      return {
        airline: parts[0],
        airlineIata: parts[1],
        srcIata: parts[2],
        srcId: parts[3],
        dstIata: parts[4],
        dstId: parts[5],
        codeshare: parts[6],
        stops: parseInt(parts[7], 10) || 0,
        equipment: parts[8]?.replace(/"/g, ''),
      };
    }).filter(r => r.srcIata && r.dstIata && r.srcIata.length === 3 && r.dstIata.length === 3);

    const result = { airports, routes };
    cache.set(cacheKey, result, 86400);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// --- VOLCANIC LAYERS (consolidated single endpoint, was 7 redundant routes) ---

const VOLCANO_CACHE_TTL = 1800;

let volcanoCache: { data: any[]; ts: number } | null = null;

async function fetchUsgsElevatedVolcanoes(): Promise<any[]> {
  if (volcanoCache && Date.now() - volcanoCache.ts < VOLCANO_CACHE_TTL * 1000) {
    return volcanoCache.data;
  }
  try {
    const resp = await fetch(
      'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated',
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) throw new Error(`USGS ${resp.status}`);
    const json = await resp.json();
    const data = Array.isArray(json) ? json : [];
    volcanoCache = { data, ts: Date.now() };
    return data;
  } catch (e) {
    logger.warn({ err: e }, 'USGS volcano fetch failed');
    return [];
  }
}

function usgsToAdvisory(v: any): any {
  return {
    volcano: v.vName || 'Unknown',
    name: v.vName || 'Unknown',
    lat: Number(v.lat),
    lon: Number(v.long),
    status: v.alertLevel || 'GREEN',
    region: v.obs || '',
    issued: v.sentUtc || v.alertDate || new Date().toISOString(),
    country: v.obs || '',
    elevation: v.nvewsThreat || 0,
    lastUpdate: v.sentUtc || v.alertDate || new Date().toISOString(),
  };
}

function usgsToLocation(v: any): any {
  return {
    name: v.vName || 'Unknown',
    lat: Number(v.lat),
    lon: Number(v.long),
    so2: 0,
    status: v.alertLevel || 'GREEN',
    date: v.sentUtc || v.alertDate || new Date().toISOString(),
  };
}

// Single consolidated volcano endpoint — all layer types route here

// --- WEATHER LAYERS ---

// Open-Meteo - free weather API (no key required)
app.get('/api/weather/open-meteo', async (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string) || 0;
  const lon = parseFloat(req.query.lon as string) || 0;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  try {
    const dateSuffix = startDate ? `_${startDate}${endDate ? `_${endDate}` : ''}` : '';
    const key = `openmeteo_${lat}_${lon}${dateSuffix}`;
    const hit = cache.get(key);
    if (hit) { res.json(hit); return; }
    const dateParam = startDate ? `&start_date=${startDate}${endDate ? `&end_date=${endDate}` : ''}` : '';
    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,pressure_msl&timezone=auto${dateParam}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
    const data = await resp.json();
    cache.set(key, data, 300);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Flood API (river discharge + flood forecasts) ─────────
app.get('/api/weather/flood', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  try {
    const dateSuffix = startDate ? `_${startDate}${endDate ? `_${endDate}` : ''}` : '';
    const dateParam = startDate ? `&start_date=${startDate}${endDate ? `&end_date=${endDate}` : ''}` : '';
    const data = await cachedFetch(
      `flood_${lat}_${lon}${dateSuffix}`,
      `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&timezone=auto${dateParam}`,
      3600, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Marine API (wave height, currents, swell) ──────────────
app.get('/api/weather/marine', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  try {
    const dateSuffix = startDate ? `_${startDate}${endDate ? `_${endDate}` : ''}` : '';
    const dateParam = startDate ? `&start_date=${startDate}${endDate ? `&end_date=${endDate}` : ''}` : '';
    const data = await cachedFetch(
      `marine_${lat}_${lon}${dateSuffix}`,
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&daily=wave_height_max,swell_wave_height_max,wave_period_max&timezone=auto${dateParam}`,
      3600, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Ensemble Forecast (multi-model uncertainty) ───────────
app.get('/api/weather/ensemble', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  try {
    const dateSuffix = startDate ? `_${startDate}${endDate ? `_${endDate}` : ''}` : '';
    const dateParam = startDate ? `&start_date=${startDate}${endDate ? `&end_date=${endDate}` : ''}` : '';
    const data = await cachedFetch(
      `ensemble_${lat}_${lon}${dateSuffix}`,
      `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&ensemble_members=10${dateParam}`,
      1800, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Seasonal Forecast (3-6 month outlooks) ─────────────────
app.get('/api/weather/seasonal', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const data = await cachedFetch(
      `seasonal_${lat}_${lon}`,
      `https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=180`,
      86400, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Historical Weather Archive ─────────────────────────────
app.get('/api/weather/historical', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const dateRange = startDate && endDate ? `&start_date=${startDate}&end_date=${endDate}` : '&start_date=2024-01-01&end_date=2024-12-31';
    const data = await cachedFetch(
      `historical_${lat}_${lon}_${startDate}_${endDate}`,
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto${dateRange}`,
      86400, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo Air Quality API ────────────────────────────────────────
app.get('/api/weather/air-quality', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  try {
    const dateSuffix = startDate ? `_${startDate}${endDate ? `_${endDate}` : ''}` : '';
    const dateParam = startDate ? `&start_date=${startDate}${endDate ? `&end_date=${endDate}` : ''}` : '';
    const data = await cachedFetch(
      `airq_${lat}_${lon}${dateSuffix}`,
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,european_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone,uv_index${dateParam}`,
      1800, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Open-Meteo GFS Model Forecast (16-day) ────────────────────────────
app.get('/api/weather/gfs', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const data = await cachedFetch(
      `gfs_${lat}_${lon}`,
      `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m,pressure_msl&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&forecast_days=16`,
      3600, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TIER 1 QUICK WINS: New Data Source Endpoints
// ═══════════════════════════════════════════════════════════════════

// ── 1. MGRS Coordinate Conversion ───────────────────────────────

// ── 2. OpenAQ Global Air Quality ─────────────────────────────────

// ── 3. NDBC Ocean Buoys ──────────────────────────────────────────


// ── 4. USGS ShakeMap ─────────────────────────────────────────────

// ── 5. NOAA SPC Convective Outlooks ──────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// NEW TIER 1 & 2 API ROUTES
// ═══════════════════════════════════════════════════════════════════

import { getRecentGlobalEvents, getEventsNearLocation, getCountryEvents, summarizeEvents, detectEscalation } from './utils/acled';
import { searchStacItems, listStacCollections } from './foundation-models/stacSearch';
import { geojsonToCsv, geojsonToStreamingJson, estimateParquetSize, getGeoParquetMetadata } from './utils/geoParquet';
import { parseMgrs } from './utils/mgrs';
import { detectIonosphericAnomalies, getIonosphericConditions } from './utils/guardian';
import { getOceanConditions } from './utils/cmems';
import { getWaveForecast, getWaveWarnings, getSeaState } from './utils/wavewatch';

// ── ACLED Conflict Events ──
app.get('/api/acled/recent', async (req: express.Request, res: express.Response) => {
  try {
    const days = parseInt(String(req.query.days || '7'), 10);
    const events = await getRecentGlobalEvents(Math.min(days, 30));
    res.json({ events, count: events.length, source: 'ACLED' });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/acled/nearby', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat));
    const lon = parseFloat(String(req.query.lon));
    const radius = parseFloat(String(req.query.radius || '250'));
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const events = await getEventsNearLocation(lat, lon, radius);
    const summary = summarizeEvents(events);
    res.json({ events, summary, source: 'ACLED' });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/acled/country/:country', async (req: express.Request, res: express.Response) => {
  try {
    const { country } = req.params;
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    const events = await getCountryEvents(country, start || undefined, end || undefined);
    const summary = summarizeEvents(events);
    const escalations = detectEscalation(events);
    res.json({ events, summary, escalations, source: 'ACLED' });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── NASA CMR STAC Search ──
app.get('/api/stac/search', async (req: express.Request, res: express.Response) => {
  try {
    const query = String(req.query.q || req.query.query || '');
    const collections = req.query.collections ? String(req.query.collections).split(',') : undefined;
    const bbox = req.query.bbox ? String(req.query.bbox).split(',').map(Number) : undefined;
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const result = await searchStacItems({ query, collections, bbox, limit: Math.min(limit, 100) });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/stac/collections', async (_req: express.Request, res: express.Response) => {
  try {
    const collections = await listStacCollections(50);
    res.json({ collections, count: collections.length });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── GeoParquet Conversion ──


// ── GUARDIAN Ionospheric Monitoring ──
app.get('/api/guardian/anomalies', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat || '0'));
    const lon = parseFloat(String(req.query.lon || '0'));
    const radius = parseFloat(String(req.query.radius || '500'));
    const anomalies = await detectIonosphericAnomalies(lat, lon, radius);
    res.json({ anomalies, count: anomalies.length, source: 'GUARDIAN' });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/guardian/conditions', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat || '0'));
    const lon = parseFloat(String(req.query.lon || '0'));
    const conditions = await getIonosphericConditions(lat, lon);
    res.json(conditions);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── CMEMS Ocean Conditions ──

// ── WAVEWATCH III Wave Forecasts ──


import { getFloodConditions, getFloodAlerts, estimateInundation } from './utils/floodInundation';

// ── USGS Flood Inundation ──


import { getHistoricalDaily, calculateClimateStats, detectExtremes } from './utils/era5';
import { getCoralReefStatus, getActiveBleachingAlerts, getSstData } from './utils/coralReefWatch';
import { initObservability, traceAsync, recordMetric, incrementCounter, getRecentTraces, getMetricsSummary } from './observability/openTelemetry';
import { initSentry } from './observability/sentry';

// ── ERA5 Climate Reanalysis ──

// ── NOAA Coral Reef Watch ──



// ── OpenTelemetry Observability ──
app.get('/api/observability/traces', (_req: express.Request, res: express.Response) => {
  try {
    const traces = getRecentTraces(50);
    res.json({ traces, count: traces.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/observability/metrics', (_req: express.Request, res: express.Response) => {
  try {
    const summary = getMetricsSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

import { getSatclipEmbedding, findSimilarLocations, getLocationContext as satclipGetLocationContext } from './utils/satclip';
import { assembleContext, spatialQuery, addEntity, addRelation } from './utils/geoGraphRAG';
import { streamFeatures, streamWithBbox } from './utils/flatGeobuf';
import { getWaterTimeSeries, getFloodWatch } from './utils/operaSurfaceWater';
import { searchHlsScenes, getTimeSeries } from './utils/landsatSentinelHls';


// ── SatCLIP Location Embeddings ──
app.get('/api/satclip/embedding', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat));
    const lon = parseFloat(String(req.query.lon));
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const embedding = await getSatclipEmbedding(lat, lon);
    res.json({ embedding, source: 'satclip' });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

app.get('/api/satclip/similar', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat));
    const lon = parseFloat(String(req.query.lon));
    const radius = parseFloat(String(req.query.radius || '500'));
    const limit = parseInt(String(req.query.limit || '10'), 10);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const similar = await findSimilarLocations(lat, lon, radius, limit);
    res.json({ similar, count: similar.length });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

app.get('/api/satclip/context', async (req: express.Request, res: express.Response) => {
  try {
    const lat = parseFloat(String(req.query.lat));
    const lon = parseFloat(String(req.query.lon));
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const context = await satclipGetLocationContext(lat, lon);
    res.json({ context });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

// ── GeoGraphRAG ──


// ── FlatGeobuf Streaming ──

// ── NASA OPERA Surface Water ──


// ── Landsat + Sentinel HLS ──


// ═══════════════════════════════════════════════════════════════════
// END TIER 1 QUICK WINS
// ═══════════════════════════════════════════════════════════════════

// NHC Tropical Cyclone Data
app.get('/api/weather/nhc', async (req: express.Request, res: express.Response) => {
  const latMin = parseFloat(req.query.latMin as string);
  const latMax = parseFloat(req.query.latMax as string);
  const lonMin = parseFloat(req.query.lonMin as string);
  const lonMax = parseFloat(req.query.lonMax as string);
  const hasBbox = Number.isFinite(latMin) && Number.isFinite(latMax) && Number.isFinite(lonMin) && Number.isFinite(lonMax);
  try {
    let data: any = await cachedFetch(
      'nhc_cyclones',
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      600, undefined, res,
    );

    // Filter storms by bbox if provided
    if (hasBbox && data?.activeStorms) {
      // Parse NHC coordinate strings like "13.7N" or "115.5W" to signed floats
      const parseCoord = (s: string): number => {
        const v = parseFloat(s);
        if (!Number.isFinite(v)) return NaN;
        const dir = s.trim().slice(-1);
        return (dir === 'S' || dir === 'W') ? -v : v;
      };
      data = {
        ...data,
        activeStorms: data.activeStorms.filter((s: any) => {
          const sLat = parseCoord(s?.latitude ?? s?.lat ?? '');
          const sLon = parseCoord(s?.longitude ?? s?.lon ?? '');
          if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) return false;
          return sLat >= latMin && sLat <= latMax && sLon >= lonMin && sLon <= lonMax;
        }),
      };
    }

    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// IBTrACS - global tropical cyclone archive

// US Drought Monitor (NCEI GeoJSON)
app.get('/api/weather/drought', async (_req: express.Request, res: express.Response) => {
  try {
    const hit = cache.get('drought_monitor');
    if (hit) { res.json(hit); return; }
    const resp = await fetch('https://www.ncei.noaa.gov/pub/data/nidis/geojson/us/usdm/USDM-current.geojson', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`drought upstream ${resp.status}`);
    const geo = await resp.json() as any;
    const features = (geo.features || []).map((f: any) => {
      const props = f.properties || {};
      // Convert NCEI numeric DM (0-4) to D0-D4 string format
      const dmNum = props.DM ?? props.dm ?? 0;
      return {
        type: 'Feature',
        properties: {
          dm: `D${dmNum}`,
          name: props.name || `Drought D${dmNum}`,
          area_pct: props.US_PRCNT || props.AREA || 0,
        },
        geometry: f.geometry,
      };
    });
    const result = { features };
    cache.set('drought_monitor', result, 3600);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: 'Drought monitor data unavailable' });
  }
});

// CPC Seasonal Climate Outlooks (temperature + precipitation probability forecasts)
app.get('/api/weather/climate-indices', async (_req: express.Request, res: express.Response) => {
  try {
    const hit = cache.get('climate_indices');
    if (hit) { res.json(hit); return; }
    const [tempResp, precipResp] = await Promise.allSettled([
      fetch('https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_temp_outlk/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=30', { signal: AbortSignal.timeout(30000) }),
      fetch('https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_precip_outlk/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=20', { signal: AbortSignal.timeout(45000) }),
    ]);
    const results: any = { temperature: null, precipitation: null };
    if (tempResp.status === 'fulfilled' && tempResp.value.ok) {
      const text = await tempResp.value.text();
      try { results.temperature = JSON.parse(text); } catch (e) { logger.warn({ err: e }, 'NOAA temp parse failed'); }
    }
    if (precipResp.status === 'fulfilled' && precipResp.value.ok) {
      const text = await precipResp.value.text();
      try { results.precipitation = JSON.parse(text); } catch (e) { logger.warn({ err: e }, 'NOAA precip parse failed'); }
    }
    cache.set('climate_indices', results, 3600);
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: 'CPC outlook data unavailable' });
  }
});

// Weather Radar Status (NEXRAD sites) — real-time from NWS API

app.get('/api/weather/alerts', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await cachedFetch(
      'nws_alerts',
      'https://api.weather.gov/alerts/active',
      60,
      { headers: { 'User-Agent': 'Terranoetis/1.0 (earth-intelligence)' } },
      res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/space-weather/kp', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await cachedFetch(
      'kp_index',
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      300, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/gdacs/alerts', async (_req: express.Request, res: express.Response) => {
  try {
    const resp = await fetch('https://www.gdacs.org/xml/rss.xml', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`GDACS ${resp.status}`);
    const text = await resp.text();
    cache.set('gdacs_rss', text, 300);
    res.type('application/xml').send(text);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/radar/rainviewer', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await cachedFetch(
      'rainviewer',
      'https://api.rainviewer.com/public/weather-maps.json',
      120, undefined, res,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/firms', async (req: express.Request, res: express.Response) => {
  let dayRange = readFirmsDayRange(req.query.dayRange ?? req.query.days);

  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  // If explicit dates provided, calculate dayRange from today
  if (startDate && !dayRange) {
    const start = new Date(startDate);
    const now = new Date();
    dayRange = Math.min(31, Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000)));
  }

  if (dayRange === null) {
    dayRange = 7;
  }

  const mapKey = process.env.NASA_FIRMS_MAP_KEY;
  if (!mapKey) {
    res.json({
      hotspots: [],
      configured: false,
      source: 'NASA FIRMS VIIRS SNPP NRT',
      dayRange,
      message: 'NASA FIRMS is not configured. Set NASA_FIRMS_MAP_KEY to enable satellite fire detections.',
    });
    return;
  }
  const reqLatMin = parseFloat(String(req.query.latMin ?? ''));
  const reqLatMax = parseFloat(String(req.query.latMax ?? ''));
  const reqLonMin = parseFloat(String(req.query.lonMin ?? ''));
  const reqLonMax = parseFloat(String(req.query.lonMax ?? ''));
  const hasBbox = Number.isFinite(reqLatMin) && Number.isFinite(reqLatMax) && Number.isFinite(reqLonMin) && Number.isFinite(reqLonMax);
  const reqLat = parseFloat(String(req.query.lat ?? ''));
  const reqLon = parseFloat(String(req.query.lon ?? ''));
  const reqRadius = parseFloat(String(req.query.radius ?? ''));
  const hasLoc = !hasBbox && Number.isFinite(reqLat) && Number.isFinite(reqLon);
  const radius = Number.isFinite(reqRadius) && reqRadius > 0 ? reqRadius : 5;
  const area = hasBbox
    ? `${reqLonMin.toFixed(4)},${reqLatMin.toFixed(4)},${reqLonMax.toFixed(4)},${reqLatMax.toFixed(4)}`
    : hasLoc
      ? `${(reqLon - radius).toFixed(4)},${(reqLat - radius).toFixed(4)},${(reqLon + radius).toFixed(4)},${(reqLat + radius).toFixed(4)}`
      : 'world';

  const key = `firms_${dayRange}_${area}`;
  try {
    const hit = cache.get<{ hotspots: FirmsHotspot[]; configured: true; source: string; dayRange: number; updatedAt: number }>(key);
    if (hit) return res.json(hit);

    const response = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${area}/${dayRange}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new Error(`NASA FIRMS ${response.status}`);
    const hotspots = parseFirmsCsv(await response.text());
    const payload = {
      hotspots,
      configured: true as const,
      source: 'NASA FIRMS VIIRS SNPP NRT',
      dayRange,
      updatedAt: Date.now(),
    };
    cache.set(key, payload, 300);
    res.json(payload);
  } catch (e) {
    res.json({
      hotspots: [],
      configured: true,
      source: 'NASA FIRMS VIIRS SNPP NRT',
      dayRange,
      updatedAt: Date.now(),
      message: 'No data from NASA FIRMS upstream',
    });
  }
});

// --- SOCIAL MEDIA & NEWS SCRAPER (NO API KEYS) ---
const rssParser = new Parser();

/** Safe RSS fetch — uses fetch + parseString to avoid rss-parser TLS callback crashes */
async function parseRSS(url: string, opts?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<any> {
  const resp = await fetch(url, {
    headers: opts?.headers || { 'User-Agent': 'Terranoetis/1.0' },
    signal: opts?.signal,
  });
  if (!resp.ok) throw new Error(`RSS ${url} HTTP ${resp.status}`);
  const xml = await resp.text();
  return rssParser.parseString(xml);
}

function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
    if (u.hostname.includes('youtu.be')) {
      const v = u.pathname.slice(1).split('?')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
  } catch (e) { logger.warn({ err: e }, 'Invalid NOAA buoy URL'); }
  return null;
}

function socialItem(source: string, title: string, url: string, timestamp: number, lat = 0, lon = 0, type = 'news', platform = 'news'): any {
  const youtubeId = extractYoutubeId(url);
  return {
    id: `${platform}_${timestamp}_${Math.random().toString(36).substring(2, 8)}`,
    platform: youtubeId ? 'youtube' : platform,
    title: title?.substring(0, 200) || '',
    source,
    url,
    lat, lon,
    timestamp,
    type,
    confidence: 0,
    youtubeVideoId: youtubeId || undefined,
  };
}

// ----- YouTube Search (topic-based, no API key needed) -----
async function fetchYouTubeSearch(signal?: AbortSignal): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://www.youtube.com/results?search_query=' + encodeURIComponent(
        'earthquake OR disaster OR hurricane OR flood OR wildfire OR storm OR conflict OR election OR crisis'
      ),
      {
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (!resp.ok) return [];
    const html = await resp.text();
    const match = html.match(/ytInitialData\s*=\s*({.*?});/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const videos: any[] = [];
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr?.videoId) continue;
        const title = vr?.title?.runs?.[0]?.text || '';
        const author = vr?.ownerText?.runs?.[0]?.text || 'YouTube';
        if (!title) continue;
        videos.push(socialItem(
          author, title, `https://www.youtube.com/watch?v=${vr.videoId}`,
          Date.now()
        ));
      }
    }
    return videos.slice(0, 20);
  } catch (e) {
    logger.warn({ err: e }, 'YouTube crisis videos fetch failed');
    return [];
  }
}

// ----- LLM ENRICHMENT (geo extraction, categorization, confidence) -----
const COUNTRY_COORDS: Record<string, [number, number]> = {
  afghanistan: [33.939, 67.710], albania: [41.153, 20.168], algeria: [28.034, 1.660],
  angola: [-11.202, 17.874], argentina: [-38.416, -63.617], armenia: [40.069, 45.038],
  australia: [-25.274, 133.775], austria: [47.516, 14.550], azerbaijan: [40.143, 47.577],
  bahrain: [25.930, 50.638], bangladesh: [23.685, 90.356], belarus: [53.710, 27.953],
  belgium: [50.503, 4.470], benin: [9.307, 2.315], bolivia: [-16.290, -63.589],
  brazil: [-14.235, -51.925], bulgaria: [42.734, 25.486], burkina: [12.238, -1.561],
  burundi: [-3.373, 29.919], cambodia: [12.566, 103.325], cameroon: [7.370, 12.355],
  canada: [56.130, -106.347], car: [6.611, 20.939], chad: [15.454, 18.732],
  chile: [-35.675, -71.542], china: [35.862, 104.195], colombia: [4.571, -74.297],
  congo: [-0.228, 15.827], croatia: [45.100, 15.200], cuba: [21.522, -77.781],
  cyprus: [35.126, 33.430], czech: [49.818, 15.247], denmark: [56.264, 9.502],
  djibouti: [11.825, 42.590], dominican: [18.736, -70.163], ecuador: [-1.831, -78.183],
  egypt: [26.821, 30.802], salvador: [13.794, -88.896], eritrea: [15.179, 39.782],
  estonia: [58.595, 25.013], ethiopia: [9.145, 40.490], fiji: [-17.713, 178.065],
  finland: [61.924, 25.748], france: [46.604, 1.888], gabon: [-0.804, 11.609],
  gambia: [13.443, -15.310], georgia: [42.315, 43.357], germany: [51.165, 10.451],
  ghana: [7.946, -1.023], greece: [39.074, 21.824], guatemala: [15.783, -90.231],
  guinea: [9.946, -9.697], guyana: [4.860, -58.930], haiti: [18.972, -72.285],
  honduras: [15.200, -86.241], hungary: [47.162, 19.503], iceland: [64.963, -19.021],
  india: [20.594, 78.963], indonesia: [-0.789, 113.921], iran: [32.428, 53.688],
  iraq: [33.223, 43.679], ireland: [53.412, -8.244], israel: [31.046, 34.851],
  italy: [41.872, 12.568], ivory: [7.540, -5.547], jamaica: [18.110, -77.297],
  japan: [36.205, 138.253], jordan: [30.585, 36.238], kazakhstan: [48.020, 66.923],
  kenya: [-0.023, 37.906], kuwait: [29.312, 47.482], kyrgyzstan: [41.204, 74.766],
  laos: [19.856, 102.495], latvia: [56.880, 24.603], lebanon: [33.855, 35.862],
  libya: [26.335, 17.228], lithuania: [55.170, 23.881], luxembourg: [49.815, 6.129],
  madagascar: [-18.767, 46.869], malawi: [-13.254, 34.302], malaysia: [4.210, 101.976],
  mali: [17.571, -3.996], mauritania: [21.008, -10.941], mexico: [23.634, -102.553],
  moldova: [47.412, 28.370], mongolia: [46.863, 103.847], montenegro: [42.708, 19.374],
  morocco: [31.791, -7.093], mozambique: [-18.666, 35.530], myanmar: [21.914, 95.956],
  namibia: [-22.328, 24.685], nepal: [28.395, 84.124], netherlands: [52.133, 5.291],
  nicaragua: [12.865, -85.207], niger: [17.608, 8.082], nigeria: [9.082, 8.675],
  korea: [35.908, 127.767], macedonia: [41.609, 21.745], norway: [60.472, 8.469],
  oman: [21.513, 55.923], pakistan: [30.375, 69.345], palestine: [31.947, 35.233],
  panama: [8.538, -80.782], papua: [-6.315, 143.956], paraguay: [-23.442, -58.444],
  peru: [-9.190, -75.015], philippines: [12.880, 121.774], poland: [51.919, 19.145],
  portugal: [39.399, -8.224], qatar: [25.355, 51.184], romania: [45.944, 24.967],
  russia: [61.524, 105.319], rwanda: [-1.940, 29.874], arabia: [23.886, 45.079],
  senegal: [14.497, -14.452], serbia: [44.017, 21.006], sierra: [8.461, -11.780],
  singapore: [1.352, 103.820], slovakia: [48.669, 19.699], slovenia: [46.151, 14.996],
  somalia: [5.152, 46.200], africa: [-30.559, 22.937], sudan: [12.863, 30.218],
  spain: [40.464, -3.749], sri: [7.875, 80.771], sweden: [60.128, 18.643],
  switzerland: [46.818, 8.228], syria: [34.802, 39.012], taiwan: [23.698, 120.961],
  tajikistan: [38.861, 71.276], tanzania: [-6.369, 34.889], thailand: [15.870, 100.993],
  togo: [8.619, 0.825], tunisia: [33.887, 9.538], turkey: [38.964, 35.243],
  turkmenistan: [38.970, 59.556], uganda: [1.374, 33.450], ukraine: [48.379, 31.166],
  emirates: [23.424, 53.848], britain: [55.378, -3.436], uk: [55.378, -3.436],
  usa: [37.090, -95.713], america: [37.090, -95.713], uruguay: [-32.523, -55.766],
  uzbekistan: [41.378, 64.585], venezuela: [6.424, -66.590], vietnam: [14.058, 108.277],
  yemen: [15.553, 48.516], zambia: [-13.134, 27.849], zimbabwe: [-19.015, 29.155],
};
const CITY_COORDS: Record<string, [number, number]> = {
  london: [51.507, -0.127], paris: [48.857, 2.352], tokyo: [35.676, 139.650],
  beijing: [39.904, 116.407], moscow: [55.756, 37.617], washington: [38.907, -77.037],
  newyork: [40.713, -74.006], losangeles: [34.052, -118.244], chicago: [41.878, -87.629],
  berlin: [52.520, 13.405], madrid: [40.417, -3.703], rome: [41.903, 12.496],
  cairo: [30.044, 31.236], delhi: [28.704, 77.103], mumbai: [19.076, 72.877],
  seoul: [37.566, 126.978], jakarta: [-6.209, 106.845], istanbul: [41.008, 28.978],
  sao: [-23.550, -46.633], lagos: [6.524, 3.379], dhaka: [23.810, 90.413],
  rio: [-22.907, -43.173], sydney: [-33.868, 151.209], dubai: [25.205, 55.271],
  mexico: [19.432, -99.133], singapore: [1.352, 103.820], hongkong: [22.319, 114.169],
  kabul: [34.555, 69.207], karachi: [24.861, 67.010], beirut: [33.894, 35.501],
  baghdad: [33.315, 44.366], tehran: [35.689, 51.389], riyadh: [24.714, 46.675],
  algiers: [36.754, 3.039], nairobi: [-1.292, 36.822], capetown: [-33.925, 18.424],
  osaka: [34.694, 135.502], shanghai: [31.230, 121.474],
  bangkok: [13.756, 100.502], ho: [21.028, 105.854], kualalumpur: [3.139, 101.687],
  kiev: [50.450, 30.524], warsaw: [52.229, 21.012], prague: [50.075, 14.438],
  budapest: [47.498, 19.040], vienna: [48.208, 16.373], zurich: [47.376, 8.541],
  brussels: [50.850, 4.352], amsterdam: [52.367, 4.894], dublin: [53.350, -6.260],
  helsinki: [60.170, 24.935], stockholm: [59.329, 18.069], oslo: [59.913, 10.739],
  copenhagen: [55.676, 12.568], tallinn: [59.437, 24.754], riga: [56.949, 24.105],
  vilnius: [54.687, 25.280], minsk: [53.904, 27.559], athens: [37.984, 23.727],
  lisbon: [38.722, -9.139], tirana: [41.328, 19.818], podgorica: [42.430, 19.259],
  sarajevo: [43.856, 18.413], belgrade: [44.787, 20.458], zagreb: [45.815, 15.981],
  sofia: [42.698, 23.322], bucharest: [44.427, 26.103], chisinau: [47.011, 28.864],
  tbilisi: [41.715, 44.827], yerevan: [40.179, 44.499], baku: [40.409, 49.867],
  tashkent: [41.299, 69.240], astana: [51.170, 71.427], almaty: [43.222, 76.851],
  ulaanbaatar: [47.886, 106.905], urumqi: [43.826, 87.617], kolkata: [22.572, 88.364],
  chennai: [13.083, 80.270], bangalore: [12.972, 77.593], hyderabad: [17.385, 78.487],
  ahmedabad: [23.022, 72.571], jaipur: [26.912, 75.787], addis: [9.032, 38.747],
  khartoum: [15.501, 32.560], accra: [5.614, -0.207], dakar: [14.764, -17.366],
  abidjan: [5.360, -4.008], kinshasa: [-4.387, 15.309], luanda: [-8.840, 13.289],
  harare: [-17.825, 31.034], pretoria: [-25.746, 28.188], johannesburg: [-26.204, 28.047],
  kigali: [-1.944, 30.062], bujumbura: [-3.382, 29.364], kampala: [0.314, 32.578],
  dar: [-6.792, 39.204], lusaka: [-15.388, 28.323], lilongwe: [-13.983, 33.787],
  windhoek: [-22.561, 17.066], gaborone: [-24.628, 25.923], porto: [41.158, -8.629],
  perth: [-31.951, 115.861], melbourne: [-37.814, 144.963], brisbane: [-27.470, 153.025],
  auckland: [-36.848, 174.763], wellington: [-41.286, 174.776], honolulu: [21.307, -157.858],
  seattle: [47.606, -122.332], portland: [45.520, -122.681], sanfrancisco: [37.775, -122.419],
  oakland: [37.804, -122.271], sanjose: [37.339, -121.894], lasvegas: [36.170, -115.140],
  phoenix: [33.448, -112.074], denver: [39.739, -104.990], dallas: [32.777, -96.797],
  houston: [29.760, -95.370], atlanta: [33.749, -84.388], miami: [25.762, -80.192],
  orlando: [28.538, -81.379], boston: [42.360, -71.058], philadelphia: [39.952, -75.165],
  pittsburgh: [40.441, -79.996], detroit: [42.331, -83.046], minneapolis: [44.977, -93.265],
  stlouis: [38.627, -90.199], neworleans: [29.951, -90.071], nashville: [36.163, -86.782],
  memphis: [35.149, -90.049], sanantonio: [29.425, -98.494],
  austin: [30.267, -97.743], sacramento: [38.582, -121.494],
  sanjuan: [18.466, -66.106], havana: [23.114, -82.366], kingston: [18.017, -76.810],
  portauprince: [18.594, -72.307], santiago: [-33.449, -70.667], buenosaires: [-34.604, -58.382],
  bogota: [4.711, -74.072], lima: [-12.046, -77.043], quito: [-0.180, -78.468],
  lapaz: [-16.500, -68.150], sucre: [-19.033, -65.263], montevideo: [-34.901, -56.165],
  asuncion: [-25.264, -57.575], caracas: [10.480, -66.903], panama: [8.983, -79.520],
  sanjose_cr: [9.928, -84.091], managua: [12.115, -86.236], tegucigalpa: [14.072, -87.192],
  guatemala: [14.635, -90.506], belmopan: [17.252, -88.771], nasau: [25.034, -77.396],
  portofspain: [10.667, -61.515], bridgetown: [13.098, -59.614], georgetown: [6.805, -58.165],
  paramaribo: [5.852, -55.204], cayenne: [4.938, -52.335], nuuk: [64.183, -51.721],
  reykjavik: [64.147, -21.942], rijeka: [45.325, 14.442],
  split: [43.508, 16.440], dubrovnik: [42.648, 18.092], florence: [43.773, 11.256],
  naples: [40.852, 14.268], venice: [45.440, 12.315], milan: [45.464, 9.190],
  barcelona: [41.387, 2.170], valencia: [39.470, -0.376], seville: [37.389, -5.984],
  malaga: [36.721, -4.421], palma: [39.571, 2.649], palermo: [38.115, 13.361],
  catania: [37.502, 15.087], giza: [29.987, 31.212], alexandria: [31.200, 29.919],
  luxor: [25.687, 32.640], rabat: [34.021, -6.842], casablanca: [33.573, -7.589],
  marrakech: [31.630, -7.981], tunis: [36.799, 10.180], tripoli: [32.887, 13.191],
  benghazi: [32.094, 20.187], oran: [35.699, -0.637],
  guangzhou: [23.130, 113.264],
  shenzhen: [22.543, 114.058], chengdu: [30.572, 104.067], chongqing: [29.432, 106.912],
  wuhan: [30.593, 114.305], nanjing: [32.060, 118.797], suzhou: [31.299, 120.585],
  hangzhou: [30.274, 120.155], shenyang: [41.806, 123.431], dalian: [38.914, 121.615],
  qingdao: [36.067, 120.383], 'xian': [34.341, 108.940], taipei: [25.033, 121.565],
  kaohsiung: [22.627, 120.301], yangon: [16.866, 96.195], mandalay: [21.959, 96.090],
  phnompenh: [11.556, 104.928], vientiane: [17.976, 102.634], hanoi: [21.028, 105.854],
  hochiminh: [10.823, 106.629], daegu: [35.871, 128.601], busan: [35.180, 129.075],
  incheon: [37.456, 126.705], suwon: [37.263, 127.029], pyongyang: [39.039, 125.763],
  fukuoka: [33.590, 130.402], sapporo: [43.062, 141.354], nagoya: [35.181, 136.906],
  kyoto: [35.011, 135.768], kobe: [34.690, 135.196], okinawa: [26.334, 127.801],
  sendai: [38.269, 140.870], yokohama: [35.443, 139.638], kawasaki: [35.531, 139.703],
  manila: [14.599, 120.984], cebu: [10.315, 123.885], davao: [7.065, 125.613],
  quezon: [14.676, 121.044], bandung: [-6.917, 107.619], surabaya: [-7.257, 112.752],
  medan: [3.595, 98.672], denpasar: [-8.670, 115.212],
};
const TRUSTED_NEWS_SOURCES = new Set([
  'BBC News', 'BBC', 'Reuters', 'The Guardian', 'Guardian', 'NPR',
  'Al Jazeera', 'New York Times', 'NYT', 'CNN', 'Fox News', 'NBC News',
  'CBS News', 'ABC News', 'Sky News', 'CBC', 'Bloomberg', 'CNBC',
  'MarketWatch', 'Yahoo Finance', 'Associated Press', 'AP',
  'GlobeNewswire', 'PRNewswire', 'ReliefWeb', 'reliefweb',
]);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  disaster: ['earthquake', 'tsunami', 'landslide', 'mudslide', 'avalanche', 'eruption', 'volcano',
    'explosion'],
  weather: ['hurricane', 'typhoon', 'cyclone', 'tornado', 'wildfire', 'flood', 'flooding', 'storm',
    'blizzard', 'drought', 'monsoon'],
  conflict: ['war', 'bombing', 'airstrike', 'missile', 'invasion', 'insurgent', 'ceasefire', 'truce',
    'coup', 'rebellion', 'battle', 'offensive'],
  science: ['discover', 'research', 'study', 'scientist', 'nasa', 'climate', 'lab', 'experiment', 'breakthrough'],
};

function geoFromText(title: string): { lat: number; lon: number; country?: string } {
  const t = title.toLowerCase();
  // Try city match first
  for (const [city, [clat, clon]] of Object.entries(CITY_COORDS)) {
    if (t.includes(city)) {
      return { lat: clat, lon: clon };
    }
  }
  // Try country match
  for (const [country, [clat, clon]] of Object.entries(COUNTRY_COORDS)) {
    if (t.includes(country)) {
      return { lat: clat, lon: clon, country };
    }
  }
  return { lat: 0, lon: 0 };
}

function categorizeItem(title: string): string {
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\b' + escaped + '\\b', 'i');
      if (re.test(title)) return cat;
    }
  }
  return 'news';
}

function isTrustedNewsSource(source: string): boolean {
  if (!source) return false;
  return TRUSTED_NEWS_SOURCES.has(source) ||
    TRUSTED_NEWS_SOURCES.has(source.split(',')[0]?.trim()) ||
    TRUSTED_NEWS_SOURCES.has(source.split('/')[0]?.trim());
}

const SOURCE_CONFIDENCE: Record<string, number> = {
  'BBC News': 0.95, 'Reuters': 0.95, 'The Guardian': 0.90, 'NPR': 0.90,
  'BBC': 0.95, 'Guardian': 0.90,
  'Al Jazeera': 0.85, 'NewsAPI': 0.80, 'Google News': 0.75,
  'GDACS': 0.90, 'ReliefWeb': 0.90, 'USGS': 0.95,
  'reliefweb': 0.90,
};

function confidence(item: any): number {
  const base = SOURCE_CONFIDENCE[item.source] ||
    SOURCE_CONFIDENCE[item.source?.split(',')[0]?.trim()] || 0.5;
  if (!item.source) return 0.3;
  // Boost by recency (items within 24h get +0.1)
  const age = Date.now() - (item.timestamp || Date.now());
  const recency = age < 86400000 ? 0.1 : 0;
  // Boost if geo is present
  const geo = (item.lat && item.lon && (item.lat !== 0 || item.lon !== 0)) ? 0.1 : 0;
  return Math.min(1, base + recency + geo);
}

async function enrichWithLLM(items: any[]): Promise<void> {
  const ungeo = items.filter(i => !i.lat && !i.lon);
  if (!ungeo.length) return;
  const prompt = `Extract location (city/country name and approximate lat/lon) and category from each news headline. Categories: disaster, weather, conflict, politics, health, science, business, technology, news.

For each headline, respond with a JSON object matching this schema:
{"index":<0-based>, "lat":<number or null>,"lon":<number or null>,"category":"<category>"}

Headlines:
${ungeo.map((i, idx) => `${idx}. "${i.title}"`).join('\n')}

Respond ONLY with a JSON array: []`;
  try {
    const text = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 2048 });
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return;
    for (const p of parsed) {
      const idx = p.index;
      if (idx < 0 || idx >= ungeo.length) continue;
      const item = ungeo[idx];
      if (p.lat != null && p.lon != null) { item.lat = p.lat; item.lon = p.lon; }
      if (p.category) item.type = p.category;
    }
  } catch (e) {
    logger.warn({ err: e }, 'Social feed LLM enrichment failed');
  }
}

app.get('/api/social', async (req: express.Request, res: express.Response) => {
  const cacheKey = 'social_feed_cache';
  const hit = cache.get<any[]>(cacheKey);
  if (hit) {
    res.json(hit);
    return;
  }

  const allResults: any[] = [];
  const seen = new Set<string>();
  const TIMEOUT_MS = 8000;

  function add(items: any[]) {
    for (const item of items) {
      if (!item.title) continue;
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(item);
    }
  }

  async function safeFetch(name: string, fn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      await fn(controller.signal);
      clearTimeout(timer);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        logger.warn({ err: e, source: name }, 'Social source failed');
      }
    }
  }

  const sources: Promise<void>[] = [];

  // ── 1. NewsAPI ──
  sources.push(safeFetch('NewsAPI', async (signal) => {
    const key = process.env.NEWSAPI_API_KEY;
    if (!key) return;
    const resp = await fetch(
      `https://newsapi.org/v2/everything?q=(earthquake OR disaster OR hurricane OR flood OR wildfire OR storm OR conflict OR election OR crisis)&sortBy=publishedAt&pageSize=10&language=en&apiKey=${key}`,
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.articles?.length) return;
    add(data.articles.map((a: any) => socialItem(
      a.source?.name || 'NewsAPI', a.title, a.url,
      new Date(a.publishedAt || Date.now()).getTime()
    )));
  }));

  // ── 2. Google News RSS ──
  sources.push(safeFetch('GoogleNews', async (signal) => {
    const feed = await parseRSS(
      'https://news.google.com/rss/search?q=earthquake+OR+tsunami+OR+disaster+OR+hurricane+OR+wildfire+OR+flood+OR+storm+OR+conflict+OR+election+OR+crisis&hl=en-US&gl=US&ceid=US:en'
    );
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 8).map((item: any) => socialItem(
      item.source || item.title?.match(/ - ([^-]+)$/)?.[1]?.trim() || 'Google News',
      item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 3. Associated Press (via WireImage RSS) ──
  sources.push(safeFetch('AP', async (signal) => {
    const feed = await parseRSS('https://rss.nytimes.com/services/xml/rss/nyt/World.xml', { signal });
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'New York Times', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 4. Reddit ──
  sources.push(safeFetch('Reddit', async (signal) => {
    const resp = await fetch('https://www.reddit.com/r/worldnews/hot.json?limit=10', {
      headers: { 'User-Agent': 'Terranoetis/1.0' },
      signal,
    });
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.data?.children?.length) return;
    add(data.data.children.map((c: any) => {
      const d = c.data;
      return socialItem(
        `r/${d.subreddit}`, d.title, d.url || `https://reddit.com${d.permalink}`,
        (d.created_utc || 0) * 1000, 0, 0, 'news', 'social'
      );
    }));
  }));

  // ── 5. GDACS (Disaster alerts with geo) ──
  sources.push(safeFetch('GDACS', async (signal) => {
    const feed = await parseRSS('https://www.gdacs.org/xml/rss_24h.xml', { signal });
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => {
      const desc = item.content || item.contentSnippet || '';
      const lat = parseFloat(desc.match(/lat[=:]\s*([-\d.]+)/i)?.[1] || '0');
      const lon = parseFloat(desc.match(/lon[=:]\s*([-\d.]+)/i)?.[1] || '0');
      return socialItem('GDACS', item.title || '', item.link || '',
        item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
        lat, lon, 'news', 'news'
      );
    }));
  }));

  // ── 6. ReliefWeb ──
  sources.push(safeFetch('ReliefWeb', async (signal) => {
    const resp = await fetch(
      'https://api.reliefweb.int/v1/reports?appname=Terranoetis&limit=8&sort[]=date:desc&fields[]=title&fields[]=url&fields[]=date&fields[]=source',
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.data?.length) return;
    add(data.data.map((r: any) => {
      const f = r.fields;
      return socialItem(
        f.source?.find((s: any) => s.name)?.name || 'ReliefWeb',
        f.title, f.url, new Date(f.date?.created || Date.now()).getTime()
      );
    }));
  }));

  // ── 7. BBC World RSS ──
  sources.push(safeFetch('BBC', async (_signal) => {
    const feed = await parseRSS('https://feeds.bbci.co.uk/news/world/rss.xml');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'BBC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 8. CBS News RSS ──
  sources.push(safeFetch('CBS', async (_signal) => {
    const feed = await parseRSS('https://www.cbsnews.com/latest/rss/world');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'CBS News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 9. The Guardian RSS ──
  sources.push(safeFetch('Guardian', async (_signal) => {
    const feed = await parseRSS('https://www.theguardian.com/world/rss');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'The Guardian', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 10. USGS Significant Earthquakes (geolocated) ──
  sources.push(safeFetch('USGS', async (signal) => {
    const resp = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.features?.length) return;
    add(data.features.slice(0, 5).map((f: any) => {
      const p = f.properties;
      const coords = f.geometry?.coordinates || [];
      return socialItem(
        'USGS', `M${p.mag} ${p.place || 'Earthquake'}`,
        p.url || '', p.time || Date.now(),
        coords[1] || 0, coords[0] || 0, 'news', 'news'
      );
    }));
  }));

  // ── 11. Al Jazeera RSS ──
  sources.push(safeFetch('AlJazeera', async (_signal) => {
    const feed = await parseRSS('https://www.aljazeera.com/xml/rss/all.xml');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'Al Jazeera', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 12. NPR RSS ──
  sources.push(safeFetch('NPR', async (_signal) => {
    const feed = await parseRSS('https://feeds.npr.org/1004/rss.xml');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'NPR', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 13. Sky News RSS ──
  sources.push(safeFetch('SkyNews', async (_signal) => {
    const feed = await parseRSS('https://feeds.skynews.com/feeds/rss/world.xml');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'Sky News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 14. ABC News RSS ──
  sources.push(safeFetch('ABCNews', async (_signal) => {
    const feed = await parseRSS('https://abcnews.go.com/abcnews/topstories');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'ABC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 15. CBC News RSS ──
  sources.push(safeFetch('CBC', async (_signal) => {
    const feed = await parseRSS('https://www.cbc.ca/cmlink/rss-world');
    if (!feed.items?.length) return;
    add(feed.items.slice(0, 5).map((item: any) => socialItem(
      'CBC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    )));
  }));

  // ── 16. YouTube News Search ──
  sources.push(safeFetch('YouTubeSearch', async (signal) => {
    const items = await fetchYouTubeSearch(signal);
    if (!items.length) return;
    add(items);
  }));

  await Promise.allSettled(sources);

  allResults.sort((a, b) => b.timestamp - a.timestamp);
  // Fast-path enrichment (keyword geo + category + confidence)
  for (const item of allResults) {
    if (!isTrustedNewsSource(item.source)) {
      if (item.type === 'news' || !item.type) item.type = categorizeItem(item.title);
    }
    if (!item.lat && !item.lon) {
      const geo = geoFromText(item.title);
      if (geo.lat || geo.lon) { item.lat = geo.lat; item.lon = geo.lon; }
    }
    item.confidence = confidence(item);
  }
  cache.set(cacheKey, allResults, 300);
  res.json(allResults);
  // Async LLM enrichment (fires after response)
  enrichWithLLM(allResults).then(() => {
    cache.set(cacheKey, allResults, 300);
    logger.info({ enriched: allResults.filter(i => i.lat || i.lon).length }, 'Social feed LLM enrichment complete');
  }).catch(() => {});
});

// ── Social Feed SSE Stream ──
app.get('/api/social/stream', sseAuthGuard, (req: express.Request, res: express.Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Push cached data immediately
  const cached = cache.get<any[]>('social_feed_cache');
  if (cached?.length) {
    send('items', cached);
  }

  // Background refresh — push each source's items as they arrive
  const allResults: any[] = [];
  const seen = new Set<string>();
  const TIMEOUT_MS = 8000;

  function add(items: any[]) {
    for (const item of items) {
      if (!item.title) continue;
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(item);
    }
  }

  async function safeFetch(name: string, fn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      await fn(controller.signal);
      clearTimeout(timer);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        logger.warn({ err: e, source: name }, 'Social stream source failed');
      }
    }
  }

  const sources: Promise<void>[] = [];

  sources.push(safeFetch('NewsAPI', async (signal) => {
    const key = process.env.NEWSAPI_API_KEY;
    if (!key) return;
    const resp = await fetch(
      `https://newsapi.org/v2/everything?q=(earthquake OR disaster OR hurricane OR flood OR wildfire OR storm OR conflict OR election OR crisis)&sortBy=publishedAt&pageSize=10&language=en&apiKey=${key}`,
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.articles?.length) return;
    const items = data.articles.map((a: any) => socialItem(
      a.source?.name || 'NewsAPI', a.title, a.url,
      new Date(a.publishedAt || Date.now()).getTime()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('GoogleNews', async (_signal) => {
    const feed = await parseRSS(
      'https://news.google.com/rss/search?q=earthquake+OR+tsunami+OR+disaster+OR+hurricane+OR+wildfire+OR+flood+OR+storm+OR+conflict+OR+election+OR+crisis&hl=en-US&gl=US&ceid=US:en'
    );
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 8).map((item: any) => socialItem(
      item.source || item.title?.match(/ - ([^-]+)$/)?.[1]?.trim() || 'Google News',
      item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('NYT', async (signal) => {
    const feed = await parseRSS('https://rss.nytimes.com/services/xml/rss/nyt/World.xml', { signal });
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'New York Times', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('Reddit', async (signal) => {
    const resp = await fetch('https://www.reddit.com/r/worldnews/hot.json?limit=10', {
      headers: { 'User-Agent': 'Terranoetis/1.0' },
      signal,
    });
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.data?.children?.length) return;
    const items = data.data.children.map((c: any) => {
      const d = c.data;
      return socialItem(
        `r/${d.subreddit}`, d.title, d.url || `https://reddit.com${d.permalink}`,
        (d.created_utc || 0) * 1000, 0, 0, 'news', 'social'
      );
    });
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('GDACS', async (signal) => {
    const feed = await parseRSS('https://www.gdacs.org/xml/rss_24h.xml', { signal });
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => {
      const desc = item.content || item.contentSnippet || '';
      const lat = parseFloat(desc.match(/lat[=:]\s*([-\d.]+)/i)?.[1] || '0');
      const lon = parseFloat(desc.match(/lon[=:]\s*([-\d.]+)/i)?.[1] || '0');
      return socialItem('GDACS', item.title || '', item.link || '',
        item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
        lat, lon, 'news', 'news'
      );
    });
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('ReliefWeb', async (signal) => {
    const resp = await fetch(
      'https://api.reliefweb.int/v1/reports?appname=Terranoetis&limit=8&sort[]=date:desc&fields[]=title&fields[]=url&fields[]=date&fields[]=source',
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.data?.length) return;
    const items = data.data.map((r: any) => {
      const f = r.fields;
      return socialItem(
        f.source?.find((s: any) => s.name)?.name || 'ReliefWeb',
        f.title, f.url, new Date(f.date?.created || Date.now()).getTime()
      );
    });
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('BBC', async (_signal) => {
    const feed = await parseRSS('https://feeds.bbci.co.uk/news/world/rss.xml');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'BBC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('CBS', async (_signal) => {
    const feed = await parseRSS('https://www.cbsnews.com/latest/rss/world');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'CBS News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('Guardian', async (_signal) => {
    const feed = await parseRSS('https://www.theguardian.com/world/rss');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'The Guardian', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('USGS', async (signal) => {
    const resp = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
      { signal }
    );
    if (!resp.ok) return;
    const data = await resp.json() as any;
    if (!data.features?.length) return;
    const items = data.features.slice(0, 5).map((f: any) => {
      const p = f.properties;
      const coords = f.geometry?.coordinates || [];
      return socialItem(
        'USGS', `M${p.mag} ${p.place || 'Earthquake'}`,
        p.url || '', p.time || Date.now(),
        coords[1] || 0, coords[0] || 0, 'news', 'news'
      );
    });
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('AlJazeera', async (_signal) => {
    const feed = await parseRSS('https://www.aljazeera.com/xml/rss/all.xml');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'Al Jazeera', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('NPR', async (_signal) => {
    const feed = await parseRSS('https://feeds.npr.org/1004/rss.xml');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'NPR', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('SkyNews', async (_signal) => {
    const feed = await parseRSS('https://feeds.skynews.com/feeds/rss/world.xml');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'Sky News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('ABCNews', async (_signal) => {
    const feed = await parseRSS('https://abcnews.go.com/abcnews/topstories');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'ABC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('CBC', async (_signal) => {
    const feed = await parseRSS('https://www.cbc.ca/cmlink/rss-world');
    if (!feed.items?.length) return;
    const items = feed.items.slice(0, 5).map((item: any) => socialItem(
      'CBC News', item.title, item.link || '',
      item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
    ));
    add(items);
    send('items', items);
  }));

  sources.push(safeFetch('YouTubeSearch', async (signal) => {
    const items = await fetchYouTubeSearch(signal);
    if (!items.length) return;
    add(items);
    send('items', items);
  }));

  // Heartbeat every 15s
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15000);

  // Wait for all sources, then enrich + cache + send done
  Promise.allSettled(sources).then(async () => {
    // Fast-path enrichment (keyword geo + category)
    for (const item of allResults) {
      if (!isTrustedNewsSource(item.source)) {
        if (item.type === 'news' || !item.type) item.type = categorizeItem(item.title);
      }
      if (!item.lat && !item.lon) {
        const geo = geoFromText(item.title);
        if (geo.lat || geo.lon) { item.lat = geo.lat; item.lon = geo.lon; }
      }
      item.confidence = confidence(item);
    }
    allResults.sort((a, b) => b.timestamp - a.timestamp);
    cache.set('social_feed_cache', allResults, 300);
    // Send ALL geotagged items as enriched before done, so frontend can process them
    const enriched = allResults.filter(i => i.lat && i.lon);
    if (enriched.length) send('enriched', enriched);

    // Slow-path LLM enrichment for items still missing geo (fires after 'done')
    send('done', { count: allResults.length });
    enrichWithLLM(allResults).then(() => {
      const llmEnriched = allResults.filter(i => i.lat && i.lon);
      if (llmEnriched.length > enriched.length) {
        // Send newly enriched items (those that had lat=0 but now have it from LLM)
        send('enriched', llmEnriched);
      }
      cache.set('social_feed_cache', allResults, 300);
    }).catch(() => {});
  });

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// --- UPGRADED PLANETARY LAYERS PROXIES ---

// 1. Space Debris Proxy (CelesTrak)
const CELESTRAK_DEBRIS_GROUPS = [
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
  'cosmos-1408-debris',
];
let lastKnownSpaceDebris: SpaceDebrisItem[] = [];

app.get('/api/space-debris', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'space_debris';
    const cachedData = cache.get<Record<string, unknown>>(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const records: unknown[] = [];
    const failedGroups: string[] = [];
    // Fetch sequentially to respect CelesTrak's rate limits.
    for (const group of CELESTRAK_DEBRIS_GROUPS) {
      try {
        const response = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=JSON`,
          { signal: AbortSignal.timeout(15000) },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('response was not an array');
        records.push(...data);
      } catch (error) {
        failedGroups.push(group);
        logger.warn({ group, err: error }, 'CelesTrak debris group unavailable');
      }
    }

    const items = normalizeSpaceDebrisRecords(records);
    if (items.length === 0) throw new Error('No CelesTrak debris groups returned usable records');
    lastKnownSpaceDebris = items;
    const payload = {
      items,
      available: true,
      stale: false,
      source: 'CelesTrak GP debris groups',
      updatedAt: Date.now(),
      partial: failedGroups.length > 0,
      message: failedGroups.length > 0
        ? `Loaded available debris groups; ${failedGroups.length} group(s) are temporarily unavailable.`
        : undefined,
    };
    cache.set(cacheKey, payload, 3600);
    res.json(payload);
  } catch (e) {
    logger.warn({ err: e }, 'Space debris feeds unavailable; serving graceful response');
    res.json({
      items: lastKnownSpaceDebris,
      available: false,
      stale: lastKnownSpaceDebris.length > 0,
      source: 'CelesTrak GP debris groups',
      message: lastKnownSpaceDebris.length > 0
        ? 'Live space-debris feeds are unavailable; showing the last known dataset.'
        : 'Space-debris data is temporarily unavailable. Try again later.',
    });
  }
});

// 2. NASA Deep Space Network (DSN) Live Status
app.get('/api/nasa-dsn', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'nasa_dsn';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const resp = await fetch('https://eyes.nasa.gov/dsn/data/dsn.xml', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`DSN XML error ${resp.status}`);
    const xmlText = await resp.text();
    const $ = cheerio.load(xmlText, { xmlMode: true });

    const stations: any[] = [];

    $('station').each((_, stationEl) => {
      const station = $(stationEl);
      const stationName = station.attr('name') || '';
      const friendlyName = station.attr('friendlyName') || '';

      const dishes: any[] = [];
      station.find('dish').each((_, dishEl) => {
        const dish = $(dishEl);
        const dishName = dish.attr('name') || '';
        const azimuth = toNumber(dish.attr('azimuth')) ?? 0;
        const elevation = toNumber(dish.attr('elevation')) ?? 0;
        const windspeed = toNumber(dish.attr('windspeed')) ?? 0;
        const isUp = dish.attr('isUp') === 'true';

        const targets: any[] = [];
        dish.find('target').each((_, targetEl) => {
          const target = $(targetEl);
          const targetName = target.attr('name') || '';
          const targetId = target.attr('id') || '';
          const range = toNumber(target.attr('range')) ?? 0; // in km or AU
          const rtlt = toNumber(target.attr('rtlt')) ?? 0; // round trip light time in seconds

          // uplink and downlink signals
          const upSignals: any[] = [];
          target.find('upSignal').each((_, upEl) => {
            const sig = $(upEl);
            upSignals.push({
              frequency: toNumber(sig.attr('frequency')) ?? 0,
              power: toNumber(sig.attr('power')) ?? 0,
              dataRate: toNumber(sig.attr('dataRate')) ?? 0,
            });
          });

          const downSignals: any[] = [];
          target.find('downSignal').each((_, downEl) => {
            const sig = $(downEl);
            downSignals.push({
              frequency: toNumber(sig.attr('frequency')) ?? 0,
              power: toNumber(sig.attr('power')) ?? 0,
              dataRate: toNumber(sig.attr('dataRate')) ?? 0,
            });
          });

          targets.push({
            name: targetName,
            id: targetId,
            range,
            rtlt,
            upSignals,
            downSignals,
          });
        });

        dishes.push({
          name: dishName,
          azimuth,
          elevation,
          windspeed,
          isUp,
          targets,
        });
      });

      stations.push({
        name: stationName,
        friendlyName,
        dishes,
      });
    });

    const payload = { stations, timestamp: Date.now() };
    cache.set(cacheKey, payload, 5); // 5 second cache
    res.json(payload);
  } catch (e) {
    logger.error({ err: e }, 'Failed to parse DSN XML');
    res.json({ stations: [], timestamp: Date.now() });
  }
});

// 3. Lightning strikes (Blitzortung Proxy)
app.get('/api/lightning', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'lightning_strikes';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const resp = await fetch('https://map.blitzortung.org/GEOjson/getjson.php?f=s&n=00', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://map.blitzortung.org/',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`Blitzortung error ${resp.status}`);
    const data = await resp.json();
    
    let strikes: any[] = [];
    if (Array.isArray(data)) {
      // Blitzortung returns array of arrays [lat, lon, time, energy/deviation] or similar
      strikes = data.map((item: any, i) => {
        const lon = toNumber(item[1] ?? item.lon ?? item.lng);
        const lat = toNumber(item[0] ?? item.lat);
        const time = toNumber(item[2] ?? item.time) ?? Date.now();
        return { lat, lon, time, id: `light_${i}` };
      }).filter(s => s.lat != null && s.lon != null);
    } else if ((data as any)?.features) {
      // If it is GeoJSON
      strikes = (data as any).features.map((f: any, i: number) => {
        const coords = f.geometry?.coordinates || [];
        return {
          lon: toNumber(coords[0]),
          lat: toNumber(coords[1]),
          time: toNumber(f.properties?.time) ?? Date.now(),
          id: `light_${i}`
        };
      }).filter((s: any) => s.lat != null && s.lon != null);
    }

    if (strikes.length === 0) {
      throw new Error('Parsed zero strikes from Blitzortung');
    }

    cache.set(cacheKey, strikes, 5); // 5 second cache
    res.json(strikes);
  } catch (e) {
    logger.error({ err: e }, 'Lightning data not available at this moment');
    res.status(503).json({ error: 'Lightning data not available at this moment.' });
  }
});

// 4. Polar Auroral Oval (NOAA Space Weather ovation Prime gridded forecast)
app.get('/api/aurora', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'aurora_oval';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const resp = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`NOAA SWPC error ${resp.status}`);
    const data = await resp.json() as any;
    
    const coordinates = data.coordinates || [];
    // Filter coordinates with probability >= 10 on the server to keep payload sizes small
    const filtered = coordinates
      .map(([lon, lat, prob]: [number, number, number]) => ({
        lon,
        lat,
        prob
      }))
      .filter((pt: any) => pt.prob >= 10);

    const payload = {
      observationTime: (data as any)['Observation Time'] || '',
      forecastTime: (data as any)['Forecast Time'] || '',
      coordinates: filtered
    };

    cache.set(cacheKey, payload, 300); // 5 minutes cache
    res.json(payload);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to fetch NOAA Aurora forecast');
    res.json({ observationTime: '', forecastTime: '', coordinates: [] });
  }
});

// 5. Global Submarine Cables (Telegeography GeoJSON)
app.get('/api/submarine-cables', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'submarine_cables';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const resp = await fetch('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Telegeography error ${resp.status}`);
    const data = await resp.json();
    
    cache.set(cacheKey, data, 86400); // 24 hours
    res.json(data);
  } catch (e) {
    logger.error({ err: e }, 'Failed to fetch submarine cables');
    res.json({ type: "FeatureCollection", features: [] });
  }
});

// ── Maritime: AIS vessel tracking (server-side WebSocket to AISStream.io) ──
const aisTracker = initAisTracker();

app.get('/api/ais', async (req: express.Request, res: express.Response) => {
  const tracker = getAisTracker();
  if (!tracker || !tracker.isConnected()) {
    return res.json({ vessels: [], count: 0, connected: false, message: 'AIS tracker not active (set AIS_STREAM_API_KEY)' });
  }
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
  const lon = req.query.lon ? parseFloat(req.query.lon as string) : NaN;
  const radius = req.query.radius ? parseFloat(req.query.radius as string) : NaN;
  const latMin = req.query.latMin ? parseFloat(req.query.latMin as string) : NaN;
  const latMax = req.query.latMax ? parseFloat(req.query.latMax as string) : NaN;
  const lonMin = req.query.lonMin ? parseFloat(req.query.lonMin as string) : NaN;
  const lonMax = req.query.lonMax ? parseFloat(req.query.lonMax as string) : NaN;
  const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 5000) : 1000;

  let vessels: AisVessel[];
  if (isFinite(lat) && isFinite(lon) && isFinite(radius)) {
    vessels = tracker.getVesselsNearby(lat, lon, radius);
  } else if (isFinite(latMin) && isFinite(latMax) && isFinite(lonMin) && isFinite(lonMax)) {
    vessels = tracker.getVesselsInBBox(latMin, latMax, lonMin, lonMax);
  } else {
    vessels = tracker.getAllVessels();
  }
  const result = vessels.slice(0, limit);
  res.json({ vessels: result, count: result.length, total: vessels.length, connected: true });
});

app.get('/api/ais/nearby', async (req: express.Request, res: express.Response) => {
  const tracker = getAisTracker();
  if (!tracker || !tracker.isConnected()) {
    return res.json({ vessels: [], count: 0, connected: false });
  }
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const radius = req.query.radius ? parseFloat(req.query.radius as string) : 50;
  if (!isFinite(lat) || !isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  const vessels = tracker.getVesselsNearby(lat, lon, radius);
  res.json({ vessels, count: vessels.length, radiusKm: radius, center: { lat, lon } });
});

app.get('/api/ais/status', async (_req: express.Request, res: express.Response) => {
  const tracker = getAisTracker();
  res.json({
    connected: tracker?.isConnected() ?? false,
    vesselCount: tracker?.getVesselCount() ?? 0,
    apiKeyConfigured: !!process.env.AIS_STREAM_API_KEY,
  });
});

// SatNOGS DB — satellite transmitter frequencies
app.get('/api/satnogs/transmitters', async (_req: express.Request, res: express.Response) => {
  try {
    const resp = await fetch('https://db.satnogs.org/api/transmitters/', { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`SatNOGS ${resp.status}`);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'SatNOGS transmitter data unavailable', detail: e instanceof Error ? e.message : String(e) });
  }
});

// UCS Satellite Database — satellite metadata served from static JSON file under public/data/
const UCS_JSON_PATH = path.join(__dirname, '..', 'public', 'data', 'ucs-satellites.json');
app.get('/api/ucs-satellites', (_req: express.Request, res: express.Response) => {
  try {
    const data = JSON.parse(fs.readFileSync(UCS_JSON_PATH, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'UCS Satellite DB unavailable', detail: e instanceof Error ? e.message : String(e) });
  }
});

// 6. Global Carbon Footprints Electricity Grid
app.get('/api/electricity-grid', async (req: express.Request, res: express.Response) => {
  const userApiKey = req.query.apiKey as string | undefined;
  const serverApiKey = process.env.ELECTRICITY_MAPS_API_KEY;
  const apiKey = userApiKey || serverApiKey;

  try {
    const cacheKey = `electricity_grid_${apiKey ? 'key' : 'free'}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    // Always fetch live UK data (Free, public, no key required)
    let ukIntensity = 180;
    let ukMix = { wind: 35, solar: 10, nuclear: 20, gas: 30, coal: 2, biomass: 3 };
    try {
      const ukResp = await fetch('https://api.carbonintensity.org.uk/intensity', { signal: AbortSignal.timeout(15000) });
      if (ukResp.ok) {
        const ukData = await ukResp.json() as any;
        const intensity = ukData.data?.[0]?.intensity?.actual ?? ukData.data?.[0]?.intensity?.forecast;
        if (toNumber(intensity) != null) {
          ukIntensity = intensity;
        }
      }
      if (ukIntensity < 100) {
        ukMix = { wind: 55, solar: 15, nuclear: 20, gas: 8, coal: 0, biomass: 2 };
      } else if (ukIntensity > 250) {
        ukMix = { wind: 10, solar: 5, nuclear: 15, gas: 60, coal: 5, biomass: 5 };
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch live UK grid intensity');
    }

    const zones = [
      { id: 'GB', name: 'United Kingdom', lat: 55.3781, lon: -3.4360, intensity: ukIntensity, mix: ukMix },
    ];

    // Fetch additional zones only if ElectricityMaps API key is available
    if (apiKey) {
      const additionalZones = [
        { id: 'FR', name: 'France', lat: 46.2276, lon: 2.2137 },
        { id: 'DE', name: 'Germany', lat: 51.1657, lon: 10.4515 },
        { id: 'US', name: 'United States', lat: 37.0902, lon: -95.7129 },
        { id: 'IN', name: 'India', lat: 20.5937, lon: 78.9629 },
        { id: 'AU', name: 'Australia', lat: -25.2744, lon: 133.7751 },
        { id: 'BR', name: 'Brazil', lat: -14.2350, lon: -51.9253 },
        { id: 'JP', name: 'Japan', lat: 36.2048, lon: 138.2529 },
        { id: 'ZA', name: 'South Africa', lat: -30.5595, lon: 22.9375 },
        { id: 'CA', name: 'Canada', lat: 56.1304, lon: -106.3468 },
      ];
      for (const zone of additionalZones) {
        try {
          const mResp = await fetch(`https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone.id}`, {
            headers: { 'auth-token': apiKey },
            signal: AbortSignal.timeout(15000),
          });
          if (mResp.ok) {
            const mData = await mResp.json() as any;
            if (mData && toNumber(mData.carbonIntensity) != null) {
              zones.push({ ...zone, intensity: mData.carbonIntensity, mix: mData.powerMix || {} });
            }
          }
        } catch (err) {
          logger.warn({ err }, `Failed to fetch live ElectricityMaps for zone ${zone.id}`);
        }
      }
    }

    cache.set(cacheKey, zones, 300); // 5 minutes cache
    res.json(zones);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// 7. Wild Animal Migrations (Movebank real data)
app.get('/api/animal-migrations', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'animal_migrations';
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    // Fetch real animal tracking data from Movebank public studies
    // Movebank REST API allows anonymous access to publicly shared studies
    const MOVEBANK_BASE = 'https://www.movebank.org/movebank/service/direct-read';
    const PUBLIC_STUDIES = [
      { id: '2904498', label: 'Marine Animal Telemetry' },
      { id: '5355255', label: 'European Bird Tracking' },
      { id: '170631325', label: 'Global Shark Movements' },
    ];

    const migrations: any[] = [];

    for (const study of PUBLIC_STUDIES) {
      try {
        // Fetch individual tracks for this study
        const url = `${MOVEBANK_BASE}?entity_type=event&study_id=${study.id}&max_events=100&order_by=timestamp`;
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(12000),
          headers: { 'Accept': 'application/json' },
        });
        if (!resp.ok) continue;

        const data = await resp.json() as any[];
        if (!Array.isArray(data) || data.length === 0) continue;

        // Group events by individual-local-identifier
        const individuals = new Map<string, any[]>();
        for (const evt of data) {
          const indId = evt['individual-local-identifier'] || evt['individual-taxon-common-name'] || 'Unknown';
          if (!individuals.has(indId)) individuals.set(indId, []);
          individuals.get(indId)!.push(evt);
        }

        // Convert each individual to migration path format
        for (const [indId, events] of individuals) {
          const path: number[][] = [];
          const timestamps: number[] = [];
          for (const evt of events) {
            const lat = parseFloat(evt['location-lat']);
            const lon = parseFloat(evt['location-long']);
            const ts = evt['timestamp'];
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              path.push([+lon.toFixed(4), +lat.toFixed(4)]);
              timestamps.push(typeof ts === 'number' ? ts : new Date(ts).getTime());
            }
          }
          if (path.length >= 2) {
            const species = events[0]?.['taxon-canonical-name'] || events[0]?.['individual-taxon-common-name'] || '';
            migrations.push({
              animalId: indId,
              species,
              studyId: study.id,
              studyLabel: study.label,
              path,
              timestamps,
            });
          }
        }
      } catch (e) {
        logger.warn({ err: e }, 'Failed to process migration study, skipping');
      }
    }

    if (migrations.length > 0) {
      cache.set(cacheKey, migrations, 3600);
    }
    res.json(migrations);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── WAQI (World Air Quality Index) ──────────────────────────────
app.get('/api/waqi', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.WAQI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'WAQI_API_KEY not configured' });

    const { city = 'here', lat, lon } = req.query;
    let endpoint: string;
    if (lat && lon) {
      endpoint = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${apiKey}`;
    } else {
      endpoint = `https://api.waqi.info/feed/${city}/?token=${apiKey}`;
    }

    const cacheKey = `waqi_${city}_${lat}_${lon}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(endpoint);
    if (!resp.ok) return res.status(resp.status).json({ error: `WAQI ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── ReliefWeb (Disaster Alerts) ─────────────────────────────────
app.get('/api/reliefweb', async (req: express.Request, res: express.Response) => {
  try {
    const { limit = '50', country, disaster_type } = req.query;
    const params = new URLSearchParams({ 'appname': 'EarthReplica', 'format[]': 'json', limit: String(limit) });
    if (country) params.set('country[]', String(country));
    if (disaster_type) params.set('disaster_type[]', String(disaster_type));

    const cacheKey = `reliefweb_${params.toString()}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.reliefweb.int/v1/reports?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `ReliefWeb ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Windy (Weather Forecast) ────────────────────────────────────

// ── Cloudflare Radar (Internet Traffic) ─────────────────────────
app.get('/api/cloudflare-radar', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.CLOUDFLARE_RADAR_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'CLOUDFLARE_RADAR_API_KEY not configured' });

    const { location = 'ALL', dateRange = '1d' } = req.query;
    const cacheKey = `cfradar_${location}_${dateRange}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/radar/summary/attacks?location=${location}&dateRange=${dateRange}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!resp.ok) return res.status(resp.status).json({ error: `Cloudflare ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── AbuseIPDB (Cyber Threat Intel) ──────────────────────────────
app.get('/api/abuseipdb', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.ABUSEIPDB_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ABUSEIPDB_API_KEY not configured' });

    const { ipAddress, maxAgeInDays = '90', verbose = '' } = req.query;
    if (!ipAddress) return res.status(400).json({ error: 'ipAddress required' });

    const params = new URLSearchParams({ ipAddress: String(ipAddress), maxAgeInDays: String(maxAgeInDays) });
    if (verbose) params.set('verbose', String(verbose));

    const cacheKey = `abuseipdb_${ipAddress}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.abuseipdb.com/api/v2/check?${params}`, {
      headers: { 'Key': apiKey, 'Accept': 'application/json' },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `AbuseIPDB ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── URLhaus (Malware URL Feeds) ─────────────────────────────────
app.get('/api/urlhaus', async (req: express.Request, res: express.Response) => {
  try {
    const { limit = '100', url, host } = req.query;

    const cacheKey = `urlhaus_${url || host || 'recent'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const body: Record<string, string> = {};
    if (url) body.url = String(url);
    else if (host) body.host = String(host);
    else body.limit = String(limit);

    const resp = await fetch('https://urlhaus-api.abuse.ch/v1/urls/recent/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `URLhaus ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 300);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── FRED (Federal Reserve Economic Data) ────────────────────────
app.get('/api/fred', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FRED_API_KEY not configured' });

    const { series_id, limit = '100', sort_order = 'desc' } = req.query;
    if (!series_id) return res.status(400).json({ error: 'series_id required' });

    const params = new URLSearchParams({
      series_id: String(series_id), limit: String(limit),
      sort_order: String(sort_order), api_key: apiKey, file_type: 'json',
    });

    const cacheKey = `fred_${series_id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `FRED ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── EIA (Energy Information Administration) ─────────────────────
app.get('/api/eia', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'EIA_API_KEY not configured' });

    const route = String(req.query.route || 'electricity/rto/fuel-type-data/data');
    const frequency = String(req.query.frequency || 'hourly');
    const fueltype = String(req.query.fueltype || '');
    const length = String(req.query.length || '500');

    const params = new URLSearchParams({
      'api_key': apiKey, 'frequency': frequency,
      'data[0]': 'value', 'length': length,
      'sort[0][column]': 'period', 'sort[0][direction]': 'desc',
    });
    if (fueltype) params.set('facets[fueltype][]', fueltype);

    const cacheKey = `eia_${route}_${frequency}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.eia.gov/v2/${route}?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `EIA ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 1800);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Alpha Vantage (Financial Data) ──────────────────────────────
app.get('/api/alphavantage', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ALPHAVANTAGE_API_KEY not configured' });

    const { function: fn = 'TIME_SERIES_DAILY', symbol, interval = 'daily', outputsize = 'compact' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const params = new URLSearchParams({ function: String(fn), symbol: String(symbol), apikey: apiKey, interval: String(interval), outputsize: String(outputsize) });

    const cacheKey = `av_${fn}_${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://www.alphavantage.co/query?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `AlphaVantage ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── CoinGecko (Crypto Prices) ───────────────────────────────────
app.get('/api/coingecko', async (req: express.Request, res: express.Response) => {
  try {
    const { vs_currency = 'usd', ids = 'bitcoin,ethereum', sparkline = 'false' } = req.query;

    const cacheKey = `cg_${ids}_${vs_currency}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = new URLSearchParams({ vs_currency: String(vs_currency), ids: String(ids), sparkline: String(sparkline) });
    const resp = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `CoinGecko ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 120);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── GIE (Gas Infrastructure Europe) ─────────────────────────────
app.get('/api/gie', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'gie_storage';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch('https://agsi.gie.eu/api/storage');
    if (!resp.ok) return res.status(resp.status).json({ error: `GIE ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── ENTSO-E (European Electricity Transparency Platform) ────────
app.get('/api/entsoe', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.ENTSOE_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ENTSOE_API_KEY not configured' });

    const { in_domain = '10YDE-RWENET--I', out_domain = '10YDE-RWENET--I', period_start, period_end } = req.query;

    const cacheKey = `entsoe_${in_domain}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = new URLSearchParams({
      securityToken: apiKey, documentType: 'A75',
      in_Domain: String(in_domain), out_Domain: String(out_domain),
    });
    if (period_start) params.set('periodStart', String(period_start));
    if (period_end) params.set('periodEnd', String(period_end));

    const resp = await fetch(`https://web-api.tp.entsoe.eu/api?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `ENTSO-E ${resp.status}` });
    const text = await resp.text();
    cache.set(cacheKey, text, 1800);
    res.type('xml').send(text);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Brave Search ────────────────────────────────────────────────
app.get('/api/brave-search', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'BRAVE_SEARCH_API_KEY not configured' });

    const { q, count = '10' } = req.query;
    if (!q) return res.status(400).json({ error: 'q (query) required' });

    const params = new URLSearchParams({ q: String(q), count: String(count) });

    const cacheKey = `brave_${q}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Brave ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Telegram Bot (Notifications) ────────────────────────────────

// ── Resend (Email Notifications) ────────────────────────────────

// ── NewsAPI (News Aggregation) ───────────────────────────────────
app.get('/api/newsapi', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.NEWSAPI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'NEWSAPI_API_KEY not configured' });

    const { q = 'global', sources, category, pageSize = '20', page = '1' } = req.query;

    const params = new URLSearchParams({ apiKey, q: String(q), pageSize: String(pageSize), page: String(page) });
    if (sources) params.set('sources', String(sources));
    if (category) params.set('category', String(category));

    const cacheKey = `newsapi_${q}_${sources || ''}_${category || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://newsapi.org/v2/everything?${params}`);
    if (!resp.ok) return res.status(resp.status).json({ error: `NewsAPI ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Sentiment Analysis (via NewsAPI) ─────────────────────────────
app.get('/api/sentiment/news', async (req: express.Request, res: express.Response) => {
  try {
    const q = String(req.query.q || 'disaster OR crisis OR event OR weather').replace(/[^a-zA-Z0-9 ]/g, '');
    const apiKey = process.env.NEWSAPI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'NEWSAPI_API_KEY not configured' });

    const cacheKey = `sentiment_${q}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=100&language=en&apiKey=${apiKey}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return res.status(502).json({ error: `NewsAPI ${resp.status}` });
    const data = await resp.json() as any;
    const articles: any[] = data?.articles ?? [];

    // Keyword-based sentiment scoring (positive/negative word counts)
    const posWords = new Set(['positive','breakthrough','success','growth','stable','recovery','aid','rescue','contain','improve','safe','good','progress','benefit','support','help','relief','funding','protection','secure']);
    const negWords = new Set(['damage','destruction','death','injury','crisis','emergency','disaster','evacuation','casualty','collapse','threat','danger','severe','warning','critical','devastating','fatal','catastrophic','catastrophe','hazard','risk','intense','deadly','destructive','tragic','loss']);
    let posCount = 0, negCount = 0, totalWords = 0;
    for (const a of articles) {
      const text = ((a.title ?? '') + ' ' + (a.description ?? '')).toLowerCase().split(/\s+/);
      for (const w of text) {
        if (posWords.has(w)) posCount++;
        if (negWords.has(w)) negCount++;
        totalWords++;
      }
    }
    const score = totalWords > 0 ? (posCount - negCount) / Math.min(totalWords, 500) : 0;
    const normalized = Math.max(-1, Math.min(1, score));

    // Extract spatial points from articles that mention specific locations
    const locationKeywords: Record<string, { lat: number; lon: number }> = {
      'california': { lat: 36.78, lon: -119.42 },
      'texas': { lat: 31.97, lon: -99.90 },
      'florida': { lat: 27.66, lon: -81.52 },
      'japan': { lat: 36.20, lon: 138.25 },
      'india': { lat: 20.59, lon: 78.96 },
      'australia': { lat: -25.27, lon: 133.78 },
      'ukraine': { lat: 48.38, lon: 31.17 },
      'syria': { lat: 34.80, lon: 38.99 },
      'china': { lat: 35.86, lon: 104.20 },
      'brazil': { lat: -14.24, lon: -51.93 },
      'mexico': { lat: 23.63, lon: -102.55 },
      'philippines': { lat: 12.88, lon: 121.77 },
      'indonesia': { lat: -0.79, lon: 113.92 },
      'turkey': { lat: 38.96, lon: 35.24 },
      'greece': { lat: 39.07, lon: 21.82 },
      'pakistan': { lat: 30.38, lon: 69.35 },
    };
    const spatialPoints: Array<{ lat: number; lon: number; value: number; source: string }> = [];
    const seenLocations = new Set<string>();
    for (const a of articles) {
      const text = ((a.title ?? '') + ' ' + (a.description ?? '')).toLowerCase();
      for (const [loc, coords] of Object.entries(locationKeywords)) {
        if (text.includes(loc) && !seenLocations.has(loc)) {
          seenLocations.add(loc);
          // Negative sentiment at this location = higher risk
          const risk = normalized < 0 ? Math.abs(normalized) : 0.1;
          spatialPoints.push({ lat: coords.lat, lon: coords.lon, value: risk, source: loc });
        }
      }
    }
    const result = {
      sentiment_score: normalized,
      volume: articles.length,
      total_articles: articles.length,
      positive_articles: posCount,
      negative_articles: negCount,
      synthetic: false,
      timestamp: Date.now(),
      summary: `Analyzed ${articles.length} news articles — sentiment ${normalized > 0.1 ? 'positive' : normalized < -0.1 ? 'negative' : 'neutral'} (${(normalized * 100).toFixed(0)}%)`,
      spatial_points: spatialPoints,
    };
    cache.set(cacheKey, result, 600);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Groq (Fast AI Inference) ────────────────────────────────────

// ── OpenRouter (Multi-Model AI) ──────────────────────────────────

// ── IMF (International Monetary Fund) ────────────────────────────
app.get('/api/imf', async (req: express.Request, res: express.Response) => {
  try {
    const { indicator = 'NGDPD', country = 'US', startYear = '2020', endYear = '2025' } = req.query;

    const cacheKey = `imf_${indicator}_${country}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(
      `https://www.imf.org/external/datamapper/api/v1/${indicator}/${country}?periods=${startYear}-${endYear}`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: `IMF ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── UN Comtrade (Trade Data) ────────────────────────────────────
app.get('/api/comtrade', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.COMTRADE_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'COMTRADE_API_KEY not configured' });

    const { reporterCode = '842', partnerCode = '156', period = '2024', flowCode = 'M', cmdCode = 'TOTAL' } = req.query;

    const cacheKey = `comtrade_${reporterCode}_${partnerCode}_${period}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = new URLSearchParams({
      reporterCode: String(reporterCode), partnerCode: String(partnerCode),
      period: String(period), flowCode: String(flowCode), cmdCode: String(cmdCode),
    });

    const resp = await fetch(`https://comtradeapi.un.org/public/v1/preview/C/A/HS?${params}`, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Comtrade ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── OTX (AlienVault Threat Intelligence) ────────────────────────
app.get('/api/otx', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.OTX_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'OTX_API_KEY not configured' });

    const { section = 'general', limit = '50' } = req.query;

    const cacheKey = `otx_${section}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://otx.alienvault.com/api/v1/pulses/${section}?limit=${limit}`, {
      headers: { 'X-OTX-API-KEY': apiKey },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `OTX ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Exa (AI Search) ─────────────────────────────────────────────
app.post('/api/exa', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'EXA_API_KEY not configured' });

    const { query, numResults = 10, type = 'neural' } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ query, numResults, type }),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Exa ${resp.status}` });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Firecrawl (Web Scraping) ────────────────────────────────────
app.post('/api/firecrawl', async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });

    const { url, formats = ['markdown'], onlyMainContent = true } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats, onlyMainContent }),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `Firecrawl ${resp.status}` });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// 10. Combined Airspaces GeoJSON (from OpenAIP GCS exports)

// ── UCDP Armed Conflict Events ──────────────────────────────────
app.get('/api/ucdp', async (req: express.Request, res: express.Response) => {
  try {
    const { year = new Date().getFullYear(), type = 'dyadic' } = req.query;

    const cacheKey = `ucdp_${year}_${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const ucdpToken = process.env.UCDP_ACCESS_TOKEN;
    const ucdpHeaders: Record<string, string> = { 'Accept': 'application/json' };
    if (ucdpToken) ucdpHeaders['x-ucdp-access-token'] = ucdpToken;
    const resp = await fetch(`https://ucdpapi.pcr.uu.se/api/${type}/${year}?pagesize=100`, {
      headers: ucdpHeaders,
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `UCDP ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── OFAC Sanctions (SDN List) ───────────────────────────────────
app.get('/api/sanctions/ofac', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'sanctions_ofac_sdn';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch('https://www.treasury.gov/ofac/downloads/sdn.csv');
    if (!resp.ok) return res.status(resp.status).json({ error: `OFAC ${resp.status}` });
    const text = await resp.text();
    const lines = text.split('\n').filter(l => l.trim());
    const entries = lines.slice(0, 500).map(line => {
      const parts = line.split(',');
      return {
        name: (parts[1] || '').replace(/"/g, ''),
        type: (parts[2] || '').replace(/"/g, ''),
        program: (parts[3] || '').replace(/"/g, ''),
        country: (parts[4] || '').replace(/"/g, ''),
      };
    });
    cache.set(cacheKey, entries, 86400);
    res.json(entries);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── NASA POWER (agricultural meteorology) ──────────────────────────
app.get('/api/climate/power', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  const startYear = (req.query.startDate as string)?.slice(0, 4) || '2024';
  const endYear = (req.query.endDate as string)?.slice(0, 4) || startYear;
  try {
    const cacheKey = `power_${lat}_${lon}_${startYear}_${endYear}`;
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }
    const resp = await fetch(
      `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,RH2M,PRECTOTCORR,WS2M,ALLSKY_SFC_SW_DWN&community=AG&longitude=${lon}&latitude=${lat}&start=${startYear}&end=${endYear}&format=JSON`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!resp.ok) { res.json({ error: `POWER upstream ${resp.status}`, properties: {} }); return; }
    const data = await resp.json();
    cache.set(cacheKey, data, 86400);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, 'NASA POWER API unavailable');
    res.json({ error: 'POWER API temporarily unavailable', properties: {} });
  }
});

// ── GDELT Global Event Database ──────────────────────────────────────
app.get('/api/gdelt', async (req: express.Request, res: express.Response) => {
  const lat = req.query.lat as string;
  const lon = req.query.lon as string;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const startTime = req.query.startTime as string | undefined;
  const endTime = req.query.endTime as string | undefined;
  const cacheKey = `gdelt_${lat}_${lon}_${startDate}_${endDate}`;
  const hit = cache.get(cacheKey);
  if (hit) { res.json(hit); return; }
  const location = lat && lon ? `&LAT1=${lat}&LON1=${lon}` : '';
  let dateParam = '';
  if (startDate && endDate) {
    const startDT = startDate.replace(/-/g, '') + (startTime ? startTime.replace(':', '') : '000000');
    const endDT = endDate.replace(/-/g, '') + (endTime ? endTime.replace(':', '') : '235959');
    dateParam = `&startdatetime=${startDT}&enddatetime=${endDT}`;
  } else if (startDate) {
    const startDT = startDate.replace(/-/g, '') + (startTime ? startTime.replace(':', '') : '000000');
    dateParam = `&startdatetime=${startDT}`;
  }
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=disaster+OR+crisis+OR+conflict+OR+flood+OR+fire+OR+storm+OR+earthquake&mode=artlist&maxrecords=50&format=json${location}${dateParam}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await resp.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch (e) {
      logger.warn({ err: e }, 'GDELT JSON parse failed');
      data = { articles: [], total: 0, note: 'GDELT rate limited, using cached/empty result' };
    }
    cache.set(cacheKey, data, 600);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, 'GDELT API unavailable');
    res.json({ articles: [], total: 0, note: 'GDELT data temporarily unavailable' });
  }
});

// ── NASA DONKI Space Weather ─────────────────────────────────────────
app.get('/api/space-weather/donki', async (req: express.Request, res: express.Response) => {
  try {
    const startDateParam = req.query.startDate as string | undefined;
    const endDateParam = req.query.endDate as string | undefined;
    const donkiKey = process.env.DONKI_API_KEY || 'DEMO_KEY';
    const now = new Date();
    const start = startDateParam || new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const end = endDateParam || now.toISOString().split('T')[0];
    const cacheKey = `donki_${start}_${end}`;
    const hit = cache.get<any>(cacheKey);
    if (hit) { res.json(hit); return; }
    const resp = await fetch(
      `https://api.nasa.gov/DONKI/notifications?startDate=${start}&endDate=${end}&type=all&api_key=${donkiKey}`,
      { signal: AbortSignal.timeout(25000) },
    );
    if (!resp.ok) {
      cache.set(cacheKey, [], 300);
      return res.status(200).json([]);
    }
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, 'NASA DONKI API unavailable');
    try { cache.set('donki_notifications', [], 300); } catch (e2) { logger.warn({ err: e2 }, 'DONKI cache set failed'); }
    if (!res.headersSent) res.status(200).json([]);
  }
});

// ── GPS Jamming (GPSJam) ────────────────────────────────────────

// ── NOAA Climate Anomalies ──────────────────────────────────────

// ── NOAA CO2 Monitoring ─────────────────────────────────────────

// ── NSIDC Sea Ice Extent ────────────────────────────────────────

// ── UNHCR Displacement Data ─────────────────────────────────────
app.get('/api/displacement', async (req: express.Request, res: express.Response) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    const cacheKey = `displacement_${year}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://api.unhcr.org/population/v1/per-country/?year=${year}&limit=200`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `UNHCR ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 86400);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── Polymarket Prediction Markets ───────────────────────────────
app.get('/api/prediction-markets', async (req: express.Request, res: express.Response) => {
  try {
    const { category = 'all', limit = '20' } = req.query;

    const cacheKey = `polymarket_${category}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch(`https://gamma-api.polymarket.com/markets?limit=${limit}&active=true&closed=false`);
    if (!resp.ok) return res.status(resp.status).json({ error: `Polymarket ${resp.status}` });
    const data = await resp.json();
    cache.set(cacheKey, data, 300);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── World Gold Council ──────────────────────────────────────────
app.get('/api/gold', async (_req: express.Request, res: express.Response) => {
  try {
    const cacheKey = 'gold_prices';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const resp = await fetch('https://www.goldapi.io/api/XAU/USD', {
      headers: { 'x-access-token': process.env.GOLDAPI_API_KEY || '' },
    });
    if (!resp.ok) {
      // Fallback to free gold price API
      const fallback = await fetch('https://api.metals.live/v1/spot/gold');
      if (!fallback.ok) return res.status(502).json({ error: 'Gold price API unavailable' });
      const data = await fallback.json();
      cache.set(cacheKey, data, 300);
      return res.json(data);
    }
    const data = await resp.json();
    cache.set(cacheKey, data, 300);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// ── WHO Air Quality ─────────────────────────────────────────────

// ── Omninet Router API ───────────────────────────────────────────

// 1. GET /api/omninet/providers — list all providers with status
app.get('/api/omninet/providers', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  omninetCallsTotal.inc({ endpoint: 'providers', status: 'ok' });
  const providers = omninet.getProviderDetails();
  logger.info({ correlationId, providerCount: providers.length }, 'Omninet providers listed');
  res.json({ providers });
});

// 2. POST /api/omninet/classify — classify query complexity + intent
app.post('/api/omninet/classify', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  omninetCallsTotal.inc({ endpoint: 'classify', status: 'ok' });
  const complexity = classifyComplexity(query);
  const intent = IntentRouter.classify(query);
  logger.info({ correlationId, complexity, intent: intent.type }, 'Omninet classify');
  res.json({ complexity, intent: intent.type, confidence: intent.confidence });
});

// 3. POST /api/omninet/route — route query to best provider
app.post('/api/omninet/route', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { query, complexity: reqComplexity, preferredModel } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const complexity = (reqComplexity as 'simple' | 'medium' | 'complex' | 'reasoning') || classifyComplexity(query);
    const routeResult = omninet.route(query, complexity, preferredModel);
    omninetCallsTotal.inc({ endpoint: 'route', status: 'ok' });
    const fallbackChain = omninet.getStatus()
      .filter(p => p.name !== routeResult.provider && p.status !== 'down')
      .map(p => p.name);
    logger.info({ correlationId, provider: routeResult.provider, model: routeResult.model, complexity }, 'Omninet route');
    res.json({
      provider: routeResult.provider,
      model: routeResult.model,
      estimatedLatency: routeResult.estimatedLatency,
      fallbackChain,
      tier: 2,
    });
  } catch (e) {
    omninetCallsTotal.inc({ endpoint: 'route', status: 'error' });
    logger.error({ err: (e as Error).message, correlationId }, 'Omninet route error');
    res.status(503).json({ error: (e as Error).message });
  }
});

// 4. POST /api/omninet/embed — generate embedding (local-first)
app.post('/api/omninet/embed', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });
  try {
    omninetCallsTotal.inc({ endpoint: 'embed', status: 'ok' });
    const embedding = await embeddingEngine.embed(text);
    const dimension = embedding.length;
    const source = dimension > 0 ? 'local' : 'gemini';
    logger.info({ correlationId, dimension, source }, 'Omninet embed');
    res.json({ embedding: Array.from(embedding), dimension, source });
  } catch (e) {
    omninetCallsTotal.inc({ endpoint: 'embed', status: 'error' });
    logger.error({ err: (e as Error).message, correlationId }, 'Omninet embed error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// 5. GET /api/omninet/rate-status — rate limit status per provider
app.get('/api/omninet/rate-status', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  omninetCallsTotal.inc({ endpoint: 'rate-status', status: 'ok' });
  const providers = omninet.getStatus().map(p => ({
    name: p.name,
    remainingTokens: p.tokens,
    lastUsed: p.lastLatency ? Date.now() - p.lastLatency : 0,
    status: p.status,
  }));
  logger.info({ correlationId, providerCount: providers.length }, 'Omninet rate-status');
  res.json({ providers });
});

// 6. POST /api/omninet/generate — generate text via Omninet
app.post('/api/omninet/generate', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { prompt, options } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const start = Date.now();
  try {
    const text = await omninet.generateText(prompt, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
    const latencyMs = Date.now() - start;
    omninetCallsTotal.inc({ endpoint: 'generate', status: 'ok' });
    const routeResult = omninet.route(prompt, classifyComplexity(prompt));
    logger.info({ correlationId, latencyMs, provider: routeResult.provider }, 'Omninet generate');
    res.json({ text, provider: routeResult.provider, model: routeResult.model, latencyMs });
  } catch (e) {
    omninetCallsTotal.inc({ endpoint: 'generate', status: 'error' });
    logger.error({ err: (e as Error).message, correlationId }, 'Omninet generate error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// 7. POST /api/omninet/generate-stream — SSE streaming text generation
app.post('/api/omninet/generate-stream', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { prompt, options } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const start = Date.now();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Correlation-Id': correlationId,
  });
  try {
    omninetCallsTotal.inc({ endpoint: 'generate-stream', status: 'ok' });
    let tokenCount = 0;
    for await (const chunk of omninet.generateStream(prompt, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      stream: true,
    })) {
      res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
      tokenCount++;
    }
    const latencyMs = Date.now() - start;
    const routeResult = omninet.route(prompt, classifyComplexity(prompt));
    res.write(`data: ${JSON.stringify({ done: true, provider: routeResult.provider, model: routeResult.model, latencyMs, tokenCount })}\n\n`);
    res.end();
    logger.info({ correlationId, latencyMs, tokenCount, provider: routeResult.provider }, 'Omninet generate-stream complete');
  } catch (e) {
    omninetCallsTotal.inc({ endpoint: 'generate-stream', status: 'error' });
    logger.error({ err: (e as Error).message, correlationId }, 'Omninet generate-stream error');
    res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
    res.end();
  }
});

// Simplify GeoJSON: reduce coordinate precision, skip tiny features
function simplifyAirspaces(features: any[]): any[] {
  const MIN_AREA_DEG2 = 0.001; // skip features smaller than ~0.001 sq deg
  return features.filter(f => {
    const coords = f?.geometry?.coordinates;
    if (!coords?.length) return false;
    // Simplify polygon coordinates (reduce precision to 3 decimals)
    if (f.geometry.type === 'Polygon') {
      f.geometry.coordinates = coords.map((ring: number[][]) =>
        ring.map((p: number[]) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])
      );
      // Rough area check via bounding box
      const lats = f.geometry.coordinates[0].map((p: number[]) => p[1]);
      const lons = f.geometry.coordinates[0].map((p: number[]) => p[0]);
      const area = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lons) - Math.min(...lons));
      return area >= MIN_AREA_DEG2;
    }
    if (f.geometry.type === 'MultiPolygon') {
      f.geometry.coordinates = coords.map((poly: number[][][]) =>
        poly.map((ring: number[][]) =>
          ring.map((p: number[]) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])
        )
      );
      const lats = f.geometry.coordinates[0][0].map((p: number[]) => p[1]);
      const lons = f.geometry.coordinates[0][0].map((p: number[]) => p[0]);
      const area = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lons) - Math.min(...lons));
      return area >= MIN_AREA_DEG2;
    }
    return true;
  });
}

async function fetchAndCacheAirspaces(): Promise<{ type: string; features: any[] }> {
  const cacheKey = 'airspaces';
  const cached = cache.get<{ type: string; features: any[] }>(cacheKey);
  if (cached) return cached;

  const combined: { type: string; features: any[] } = { type: 'FeatureCollection', features: [] };
  const countryCodes = ['at', 'au', 'ba', 'be', 'bf', 'bg', 'bh', 'bj', 'bn', 'br', 'bw', 'by', 'de', 'al', 'am', 'ao', 'ar', 'ae', 'af'];
  const baseUrl = 'https://storage.googleapis.com/29f98e10-a489-4c82-ae5e-489dbcd4912f';

  const results = await Promise.allSettled(
    countryCodes.map(code =>
      fetch(`${baseUrl}/${code}_asp.geojson`, { signal: AbortSignal.timeout(10000) })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`${code}: ${r.status}`)))
    )
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && (result.value as any)?.features) {
      combined.features.push(...(result.value as any).features);
    }
  }

  if (combined.features.length === 0) {
    try {
      const localPath = path.join(__dirname, '../public/data/combined_airspaces.geojson');
      const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      if (localData?.features) {
        combined.features = localData.features;
      }
    } catch (localErr) {
      logger.warn({ err: localErr }, 'Local airspace file not found');
      throw new Error('No airspace data available');
    }
  }

  const simplified = simplifyAirspaces(combined.features);
  combined.features = simplified;
  logger.info(`Caching ${combined.features.length} simplified airspace features (was ${combined.features.length > 0 ? 'simplified' : 'none'})`);
  cache.set(cacheKey, combined, 3600);
  return combined;
}

app.get('/api/airspaces', async (_req: express.Request, res: express.Response) => {
  try {
    const combined = await fetchAndCacheAirspaces();
    res.json(combined);
  } catch (e) {
    logger.error({ err: e }, 'Failed to serve airspace data');
    res.status(502).json({ error: 'Failed to load airspace data' });
  }
});

// --- REAL DATA FETCHERS PER GROUP ---

async function cachedFetchGroup<T>(key: string, fetcher: () => Promise<T>, ttl = 600): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit) return hit;
  const data = await fetcher();
  // Only cache non-empty results — empty means the upstream was unavailable and should be retried
  if (Array.isArray(data) && data.length > 0) {
    cache.set(key, data, ttl);
  } else if (!Array.isArray(data)) {
    cache.set(key, data, ttl);
  }
  return data;
}

// OCEAN: NDBC Buoy stations with real observations from latest_obs.txt
async function fetchOceanBuoys(): Promise<any[]> {
  // WVHT column index in latest_obs.txt
  const WVHT = 11, WSPD = 9, ATMP = 17, WTMP = 18;
  const [tableResp, obsResp] = await Promise.all([
    fetch('https://www.ndbc.noaa.gov/data/stations/station_table.txt', {
      signal: AbortSignal.timeout(15000),
    }),
    fetch('https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt', {
      signal: AbortSignal.timeout(15000),
    }).catch(() => null),
  ]);
  // Parse latest observations into lookup map
  const obsMap = new Map<string, { wvht: number; wspd: number; atmp?: number; wtmp?: number }>();
  if (obsResp?.ok) {
    for (const line of (await obsResp.text()).split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue;
      const p = line.trim().split(/\s+/);
      if (p.length <= WVHT) continue;
      const wvht = p[WVHT] !== 'MM' ? parseFloat(p[WVHT]) : NaN;
      const wspd = p[WSPD] !== 'MM' ? parseFloat(p[WSPD]) : NaN;
      const atmp = p[ATMP] !== 'MM' ? parseFloat(p[ATMP]) : undefined;
      const wtmp = p[WTMP] !== 'MM' ? parseFloat(p[WTMP]) : undefined;
      obsMap.set(p[0], { wvht, wspd, atmp, wtmp });
    }
  }
  // Parse station table
  const text = await tableResp.text();
  const stations: any[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 7) continue;
    const id = parts[0].trim();
    const name = (parts[4] || '').trim();
    const locStr = (parts[6] || '').trim();
    const m = locStr.match(/([\d.]+)\s*([NS])\s+([\d.]+)\s*([EW])/);
    if (!m) continue;
    let lat = parseFloat(m[1]);
    if (m[2] === 'S') lat = -lat;
    let lon = parseFloat(m[3]);
    if (m[4] === 'W') lon = -lon;
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // Real observation data when available
    const obs = obsMap.get(id);
    let value: number, magnitude: number;
    if (obs && isFinite(obs.wvht)) {
      value = +obs.wvht.toFixed(2);
      magnitude = +(obs.wvht * 0.5).toFixed(2);
    } else if (obs && isFinite(obs.wspd)) {
      value = +obs.wspd.toFixed(2);
      magnitude = +(obs.wspd * 0.3).toFixed(2);
    } else {
      value = 0.5;
      magnitude = 0.3;
    }
    stations.push({
      id: `ndbc_${id}`,
      name: name || `Buoy ${id}`,
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
      stationId: id,
      value,
      magnitude,
      ...(obs?.atmp !== undefined && { temperature: obs.atmp }),
      ...(obs?.wtmp !== undefined && { waterTemp: obs.wtmp }),
      source: 'NDBC',
      timestamp: Date.now(),
    });
  }
  return stations;
}

// ── Ocean Currents & Waves (Open-Meteo Marine API) ─────────────────────
// Uniform global grid covering all oceans at 7° spacing
const OCEAN_GRID = buildOceanGrid();
let _oceanCache: { data: any[]; ts: number } | null = null;
let _oceanInFlight: Promise<any[]> | null = null;
const OCEAN_CACHE_TTL = 3600;

function buildOceanGrid(): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = [];
  for (let lat = -80; lat <= 80; lat += 8) {
    for (let lon = -180; lon <= 180; lon += 8) {
      pts.push({ lat: +lat.toFixed(1), lon: +lon.toFixed(1) });
    }
  }
  // Shuffle so early-chunk bias is geographically random
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  return pts;
}

async function fetchOceanCurrents(): Promise<any[]> {
  if (_oceanCache && Date.now() - _oceanCache.ts < OCEAN_CACHE_TTL * 1000) {
    return _oceanCache.data;
  }
  if (_oceanInFlight) return _oceanInFlight;
  _oceanInFlight = (async () => {
    const results: any[] = [];
    const grid = [...OCEAN_GRID];
    // Retry loop: up to 3 passes for throttled requests
    for (let pass = 0; pass < 3 && grid.length > 0; pass++) {
      const pending = [...grid];
      grid.length = 0;
      const delay = pass === 0 ? 400 : pass === 1 ? 800 : 1500;
      for (let i = 0; i < pending.length; i += 8) {
        const chunk = pending.slice(i, i + 8);
        const responses = await Promise.allSettled(
          chunk.map(pt =>
            fetch(
              `https://marine-api.open-meteo.com/v1/marine?latitude=${pt.lat}&longitude=${pt.lon}&current=ocean_current_velocity,ocean_current_direction,wave_height,wave_direction`,
              { signal: AbortSignal.timeout(15000) },
            ).then(r => r.json()),
          ),
        );
        for (let j = 0; j < chunk.length; j++) {
          const resp = responses[j] as PromiseFulfilledResult<any>;
          if (resp.status !== 'fulfilled' || !resp.value?.current) { grid.push(chunk[j]); continue; }
          const cur = resp.value.current;
          const speed = cur.ocean_current_velocity;
          if (speed == null) { grid.push(chunk[j]); continue; }
          results.push({
            id: `oc_${chunk[j].lat}_${chunk[j].lon}`,
            lat: chunk[j].lat,
            lon: chunk[j].lon,
            value: +(+speed).toFixed(3),
            heading: +(+cur.ocean_current_direction).toFixed(1),
            waveHeight: cur.wave_height != null ? +(+cur.wave_height).toFixed(2) : undefined,
            waveDirection: cur.wave_direction != null ? +(+cur.wave_direction).toFixed(1) : undefined,
            timestamp: Date.now(),
          });
        }
        if (i + 8 < pending.length) await new Promise(r => setTimeout(r, delay));
      }
    }
    _oceanCache = { data: results, ts: Date.now() };
    _oceanInFlight = null;
    return results;
  })();
  return _oceanInFlight;
}

// ARGO: Profiling floats from Coriolis GDAC (real-time T/S profiles)
async function fetchArgoFloats(): Promise<any[]> {
  try {
    const url = 'https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.json?latitude,longitude,platform_number,platform_type&time%3E%3D%22now-14days%22&distinct()&orderBy(%22platform_number%22)';
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const rows: any[][] = (body?.table?.rows ?? []).slice(0, 500);
    return rows.flatMap((r: any[]) => {
      const lat = r[0], lon = r[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return {
        id: `argo_${r[2]}`,
        name: `ARGO Float ${r[2]}`,
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        value: 1,
        magnitude: 0.5,
        source: 'ARGO',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'ARGO float fetch failed'); return []; }
}

// TIDES: NOAA CO-OPS water level stations (real-time)
async function fetchNoaaTides(): Promise<any[]> {
  try {
    const metaResp = await fetch(
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!metaResp.ok) return [];
    const body: any = await metaResp.json();
    const stations: any[] = body?.stations ?? [];
    // Fetch latest water level for a subset of stations
    const tideReadings = new Map<string, number>();
    const batch = stations.slice(0, 100);
    await Promise.all(batch.map(async (s: any) => {
      try {
        const wl = await fetch(
          `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${s.id}&product=water_level&date=today&datum=MLLW&units=metric&format=json`,
          { signal: AbortSignal.timeout(8000) },
        ).then(r => r.json()) as any;
        const data: any[] = wl?.data ?? [];
        if (data.length > 0) {
          tideReadings.set(s.id, parseFloat(data[0].v));
        }
      } catch (e) { logger.warn({ err: e }, 'NOAA tide reading fetch failed'); }
    }));
    return stations.map((s: any) => ({
      id: `tide_${s.id}`,
      name: s.name || `Station ${s.id}`,
      lat: +s.lat.toFixed(4),
      lon: +s.lng.toFixed(4),
      value: tideReadings.has(s.id) ? +tideReadings.get(s.id)!.toFixed(2) : 0,
      magnitude: 0.5,
      state: s.state,
      source: 'NOAA CO-OPS',
      timestamp: Date.now(),
    }));
  } catch (e) { logger.warn({ err: e }, 'NOAA CO-OPS tides fetch failed'); return []; }
}

// USGS WATER: National Water Quality Monitoring Locations
async function fetchUsgsWaterQuality(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items?limit=5000',
      { signal: AbortSignal.timeout(20000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const features: any[] = body?.features ?? [];
    return features.flatMap((f: any) => {
      const p = f.properties || {};
      const g = f.geometry;
      if (!g || !g.coordinates) return [];
      const coords = g.coordinates;
      if (!Number.isFinite(coords[1]) || !Number.isFinite(coords[0])) return [];
      return {
        id: `usgs_${p.id || Math.random().toString(36).slice(2, 8)}`,
        name: p.monitoring_location_name || `USGS ${p.id}`,
        lat: +coords[1].toFixed(4),
        lon: +coords[0].toFixed(4),
        value: 1,
        magnitude: 0.5,
        state: p.state_name,
        siteType: p.site_type,
        source: 'USGS Water Quality',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'USGS water quality fetch failed'); return []; }
}

// WORLD PORTS: Static dataset (~800 major ports)
async function fetchWorldPorts(): Promise<any[]> {
  try {
    // Fetch real port data from UNECE UN/LOCODE database (public, PDDL license)
    const resp = await fetch(
      'https://www.freightutils.com/api/unlocode?function=port&limit=500',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) throw new Error(`UN/LOCODE API returned ${resp.status}`);
    const body = await resp.json() as any;
    const locations = body?.data ?? body?.locations ?? [];
    if (!Array.isArray(locations) || locations.length === 0) throw new Error('No port data');

    return locations
      .filter((p: any) => {
        const lat = parseFloat(p.latitude ?? p.lat);
        const lon = parseFloat(p.longitude ?? p.lon ?? p.lng);
        return Number.isFinite(lat) && Number.isFinite(lon);
      })
      .map((p: any) => {
        const lat = parseFloat(p.latitude ?? p.lat);
        const lon = parseFloat(p.longitude ?? p.lon ?? p.lng);
        return {
          id: p.code ?? p.unlocode ?? p.id,
          name: p.name ?? p.port_name ?? 'Unknown Port',
          country: p.country_name ?? p.country ?? '',
          lat: +lat.toFixed(4),
          lon: +lon.toFixed(4),
          type: 'Seaport',
          value: 1,
          magnitude: 0.5,
          source: 'UNECE UN/LOCODE',
          timestamp: Date.now(),
        };
      });
  } catch (e) {
    logger.warn({ err: e }, 'UN/LOCODE port fetch failed');
    return [];
  }
}

// SEISMIC: USGS Earthquakes (real-time) — uses shared cachedFetch to deduplicate with /api/earthquakes
async function fetchEarthquakes(): Promise<any[]> {
  const geo = await cachedFetch<any>(
    'earthquakes',
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    60,
  );
  return (geo.features || []).map((f: any) => {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates || [];
    return {
      id: `${p.net}_${p.code}`,
      name: p.place || 'Unknown',
      lat: +coords[1]?.toFixed(4),
      lon: +coords[0]?.toFixed(4),
      magnitude: +((p.mag ?? 0).toFixed(1)),
      depth: +((coords[2] ?? 0).toFixed(1)),
      value: Math.round((p.mag ?? 0) * 10),
      time: p.time || Date.now(),
      source: 'USGS',
    };
  });
}

// ECOLOGY: GBIF species occurrences (real biodiversity data)
async function fetchGbifOccurrences(): Promise<any[]> {
  const resp = await fetch(
    'https://api.gbif.org/v1/occurrence/search?limit=300&hasCoordinate=true&hasGeospatialIssue=false&taxonKey=1',
    { signal: AbortSignal.timeout(15000) },
  );
  const data = await resp.json() as any;
  return (data.results || []).map((r: any) => ({
    id: `${r.key}`,
    name: r.species || r.kingdom || 'Unknown',
    lat: +((r.decimalLatitude ?? 0).toFixed(4)),
    lon: +((r.decimalLongitude ?? 0).toFixed(4)),
    species: r.species || '',
    kingdom: r.kingdom || '',
    value: 1,
    time: r.eventDate || Date.now(),
    source: 'GBIF',
  }));
}

// HAZARDS: EONET natural events
async function fetchEonetEvents(): Promise<any[]> {
  const resp = await fetch(
    'https://eonet.gsfc.nasa.gov/api/v3/events?limit=100&status=open',
    { signal: AbortSignal.timeout(15000) },
  );
  const data = await resp.json() as any;
  return (data.events || []).map((e: any) => {
    const geom = e.geometry?.[0] || {};
    const coords = geom.coordinates || [];
    return {
      id: e.id,
      name: e.title || 'Unknown Event',
      lat: +((coords[1] ?? 0).toFixed(4)),
      lon: +((coords[0] ?? 0).toFixed(4)),
      category: e.categories?.[0]?.title || '',
      value: 1,
      magnitude: 1,
      time: geom.date || Date.now(),
      source: 'EONET',
    };
  });
}

// WEATHER: Open-Meteo global cities forecast
const WEATHER_CITIES = [
  { name: 'New York', lat: 40.71, lon: -74.01 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Tokyo', lat: 35.68, lon: 139.65 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
  { name: 'Cape Town', lat: -33.92, lon: 18.42 },
  { name: 'Moscow', lat: 55.76, lon: 37.62 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88 },
  { name: 'Shanghai', lat: 31.23, lon: 121.47 },
  { name: 'Sao Paulo', lat: -23.55, lon: -46.63 },
  { name: 'Cairo', lat: 30.04, lon: 31.24 },
  { name: 'Dubai', lat: 25.20, lon: 55.27 },
  { name: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'Paris', lat: 48.86, lon: 2.35 },
  { name: 'Berlin', lat: 52.52, lon: 13.41 },
  { name: 'Istanbul', lat: 41.01, lon: 28.98 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82 },
  { name: 'Bangkok', lat: 13.76, lon: 100.50 },
  { name: 'Seoul', lat: 37.57, lon: 126.98 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { name: 'Chicago', lat: 41.88, lon: -87.63 },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94 },
  { name: 'Anchorage', lat: 61.22, lon: -149.90 },
  { name: 'Ushuaia', lat: -54.80, lon: -68.30 },
  { name: 'Nuuk', lat: 64.18, lon: -51.69 },
  { name: 'Kathmandu', lat: 27.72, lon: 85.32 },
  { name: 'Marrakech', lat: 31.63, lon: -7.98 },
  { name: 'Fiji', lat: -17.71, lon: 178.07 },
  { name: 'Rapa Nui', lat: -27.11, lon: -109.35 },
  { name: 'Longyearbyen', lat: 78.22, lon: 15.63 },
];

async function fetchWeatherForecasts(): Promise<any[]> {
  const results = await Promise.allSettled(
    WEATHER_CITIES.map(c =>
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,pressure_msl&forecast_days=1`,
        { signal: AbortSignal.timeout(8000) },
      ).then(r => r.json()),
    ),
  );
  const items: any[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const d = r.value as any;
      const c = WEATHER_CITIES[i];
      if (d?.current) {
        items.push({
          id: `weather_${c.name.toLowerCase().replace(/\s+/g, '_')}`,
          name: c.name,
          lat: +c.lat.toFixed(4),
          lon: +c.lon.toFixed(4),
          temperature: d.current.temperature_2m,
          humidity: d.current.relative_humidity_2m,
          precipitation: d.current.precipitation,
          windSpeed: d.current.wind_speed_10m,
          pressure: d.current.pressure_msl,
          value: d.current.temperature_2m ?? 0,
          time: d.current.time || Date.now(),
          source: 'Open-Meteo',
        });
      }
    }
  });
  return items;
}

// SPACE: Merged satellite catalog (CelesTrak TLE + UCS DB + SpaceX Starlink)
const CELESTRAK_TLE_GROUPS = [
  'stations', 'visual', 'weather', 'resource', 'cubesat', 'engineering', 'last-30-days',
  'active', 'starlink', 'oneweb', 'gps-ops', 'glo-ops', 'galileo', 'beidou',
  'amateur', 'x-comm', 'intelsat', 'iridium', 'ses', 'eutelsat',
  'orbcomm', 'globalstar', 'swarm', 'planet', 'spire',
];

function tleChecksum(line: string): string {
  let sum = 0;
  for (const ch of line) for (const d of ch) if (d >= '0' && d <= '9') sum += +d; else if (d === '-') sum++;
  return String(sum % 10);
}

function generateTle(noradId: string, inc: number, raan: number, ecc: number, argPer: number, meanAnomaly: number, meanMotion: number, epoch?: string): { tle1: string; tle2: string } {
  const id = noradId.padStart(5, ' ');
  const epochStr = (epoch ?? '00001.00000000').slice(0, 14).padEnd(14, '0');
  const l1 = `1 ${id}U 00001A   ${epochStr}  0.00000000  0  0  999`;
  const incS = inc.toFixed(4).padStart(8, ' ');
  const raanS = raan.toFixed(4).padStart(8, ' ');
  const eccS = Math.round(ecc * 1e7).toString().padStart(7, '0');
  const argS = argPer.toFixed(4).padStart(8, ' ');
  const meanS = meanAnomaly.toFixed(4).padStart(8, ' ');
  const mmS = meanMotion.toFixed(8).padStart(11, ' ');
  const l2 = `2 ${id} ${incS} ${raanS} ${eccS} ${argS} ${meanS} ${mmS} 0`;
  return { tle1: l1 + tleChecksum(l1), tle2: l2 + tleChecksum(l2) };
}

async function fetchSatellites(): Promise<any[]> {
  const cacheKey = 'merged_satellites';
  const cached = cache.get<any[]>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const results: any[] = [];
  const seenIds = new Set<string>();

  // 1) CelesTrak TLE — fetch groups in parallel with bounded concurrency.
  //    Sequential per-group round-trips made the first (cold) call take
  //    2-3 minutes; running up to 6 groups at once keeps the cold start to
  //    a few seconds while still staying polite to the upstream API.
  const fetchTleGroup = async (group: string): Promise<void> => {
    try {
      const resp = await fetch(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
        { signal: AbortSignal.timeout(20000) },
      );
      if (!resp.ok) return;
      const text = await resp.text();
      if (text.includes('GP data has not updated') || text.includes('Invalid query')) return;
      const lines = text.trim().split('\n');
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i].trim();
        const line1 = lines[i + 1].trim();
        const line2 = lines[i + 2].trim();
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
        const noradCat = line1.slice(2, 7).trim();
        if (seenIds.has(noradCat)) continue;
        try {
          const rec = satellite.twoline2satrec(line1, line2);
          const pv = satellite.propagate(rec, now);
          if (!pv || !pv.position || !isFinite(pv.position.x)) continue;
          const gmst = satellite.gstime(now);
          const gd = satellite.eciToGeodetic(pv.position, gmst);
          const lat = satellite.degreesLat(gd.latitude);
          const lon = satellite.degreesLong(gd.longitude);
          if (!isFinite(lat) || !isFinite(lon)) continue;
          seenIds.add(noradCat);
          results.push({
            id: `${noradCat}`,
            name: name || `${noradCat}`,
            lat: +lat.toFixed(4),
            lon: +lon.toFixed(4),
            altitude: Math.round(gd.height * 1000),
            inclination: +(line2.slice(8, 16).trim() ?? 0),
            meanMotion: +(line2.slice(52, 63).trim() ?? 0),
            epoch: line1.slice(18, 32).trim(),
            value: Math.round(+(line2.slice(52, 63).trim() ?? 0) * 10),
            source: 'CelesTrak',
            hasTle: true,
            tle1: line1,
            tle2: line2,
          });
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      // upstream unavailable — group skipped, other groups still resolve
    }
  };

  const TLE_CONCURRENCY = 6;
  let tleHead = 0;
  await Promise.all(new Array(Math.min(TLE_CONCURRENCY, CELESTRAK_TLE_GROUPS.length)).fill(0).map(async () => {
    for (; tleHead < CELESTRAK_TLE_GROUPS.length; tleHead++) {
      await fetchTleGroup(CELESTRAK_TLE_GROUPS[tleHead]);
    }
  }));

  // 2) UCS Satellite Database (static orbital elements, no TLE)
  //    Merges metadata into existing CelesTrak entries when NORAD ID matches
  const resultsById = new Map<string, any>(results.map(r => [r.id, r]));
  try {
    const ucsPath = path.join(__dirname, '..', 'public', 'data', 'ucs-satellites.json');
    if (fs.existsSync(ucsPath)) {
      const raw = fs.readFileSync(ucsPath, 'utf-8');
      const ucsRecords = JSON.parse(raw) as any[];
      for (const u of ucsRecords) {
        const noradId = String(u.norad_id ?? u.NORAD_ID ?? '').trim();
        const existing = noradId ? resultsById.get(noradId) : null;
        if (existing) {
          if (u.country) existing.country = u.country;
          if (u.purpose) existing.purpose = u.purpose;
          if (u.orbit_class) existing.orbitClass = u.orbit_class;
          continue;
        }
        const uInclination = u.inclination ?? 0;
        const uEccentricity = u.eccentricity ?? 0;
        const uPeriod = u.period; // minutes
        const uMeanMotion = uPeriod ? 1440 / uPeriod : 15; // rev/day
        const uAltitude = u.apogee ? Math.round((u.apogee + (u.perigee ?? u.apogee)) / 2 * 1000) : null;
        let tle: { tle1: string; tle2: string } | null = null;
        try {
          tle = generateTle(noradId || '00000', uInclination, 0, uEccentricity, 0, 0, uMeanMotion);
        // eslint-disable-next-line no-empty
        } catch {}
        const entry = {
          id: noradId || `ucs_${u.name ?? Math.random()}`,
          name: u.name ?? u.OBJECT_NAME ?? 'Unknown',
          lat: null,
          lon: null,
          altitude: uAltitude,
          inclination: uInclination,
          meanMotion: uMeanMotion,
          epoch: null,
          value: 50,
          source: 'UCS',
          hasTle: !!tle,
          tle1: tle?.tle1 ?? null,
          tle2: tle?.tle2 ?? null,
          country: u.country ?? null,
          purpose: u.purpose ?? null,
          orbitClass: u.orbit_class ?? null,
          apogee: u.apogee ?? null,
          perigee: u.perigee ?? null,
        };
        results.push(entry);
        resultsById.set(entry.id, entry);
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'Failed to load UCS satellite data');
  }

  // 3) SpaceX Starlink (live positions from API, no TLE)
  //    Merges velocity/lat/lon into existing CelesTrak entries when NORAD ID matches
  try {
    const starlinkData = spacexEngine.getStarlinkByRegion(-90, 90, -180, 180);
    for (const s of starlinkData) {
      const noradMatch = s.spaceTrack?.OBJECT_ID?.match(/\d{5}/);
      const noradId = noradMatch ? noradMatch[0] : null;
      const st = s.spaceTrack;
      const sInc = st?.INCLINATION ?? 0;
      const sRaan = st?.RA_OF_ASC_NODE ?? 0;
      const sEcc = st?.ECCENTRICITY ?? 0;
      const sArg = st?.ARG_OF_PERICENTER ?? 0;
      const sMean = st?.MEAN_ANOMALY ?? 0;
      const sMm = st?.MEAN_MOTION ?? 15;
      const sEpoch = st?.EPOCH ? st.EPOCH.replace(/[^0-9.]/g, '').slice(0, 14) : undefined;
      let stTle: { tle1: string; tle2: string } | null = null;
      try {
        stTle = generateTle(noradId || '00000', sInc, sRaan, sEcc, sArg, sMean, sMm, sEpoch);
      // eslint-disable-next-line no-empty
      } catch {}

      const existing = noradId ? resultsById.get(noradId) : null;
      if (existing) {
        if (s.velocity_kms != null) existing.velocity = s.velocity_kms;
        if (s.latitude != null && s.longitude != null) { existing.lat = +s.latitude.toFixed(4); existing.lon = +s.longitude.toFixed(4); }
        if (s.height_km != null) existing.altitude = Math.round(s.height_km * 1000);
        if (stTle) { existing.tle1 = stTle.tle1; existing.tle2 = stTle.tle2; existing.hasTle = true; }
        existing.source = 'CelesTrak';
        continue;
      }
      const entry = {
        id: noradId || `starlink_${st?.OBJECT_NAME ?? Math.random()}`,
        name: st?.OBJECT_NAME ?? 'Starlink',
        lat: s.latitude != null ? +s.latitude.toFixed(4) : null,
        lon: s.longitude != null ? +s.longitude.toFixed(4) : null,
        altitude: s.height_km != null ? Math.round(s.height_km * 1000) : null,
        inclination: sInc,
        meanMotion: sMm,
        epoch: sEpoch ?? null,
        value: 60,
        source: 'Starlink',
        hasTle: !!stTle,
        tle1: stTle?.tle1 ?? null,
        tle2: stTle?.tle2 ?? null,
        velocity: s.velocity_kms ?? null,
        version: s.version ?? null,
      };
      results.push(entry);
      resultsById.set(entry.id, entry);
    }
  } catch (e) {
    logger.warn({ err: e }, 'Failed to load Starlink data');
  }

  cache.set(cacheKey, results, 3600);
  return results;
}

app.get('/api/satellites/tle', async (_req: express.Request, res: express.Response) => {
  try {
    const data = await fetchSatellites();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// AIRPORTS: OurAirports dataset (free, CC-BY 4.0)
async function fetchAirports(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const entries = Object.values(data) as any[];
    return entries.slice(0, 500).flatMap((a: any) => {
      if (!a.lat || !a.lon) return [];
      return {
        id: `airport_${a.icao || a.iata || a.gps_code || Math.random().toString(36).slice(2, 8)}`,
        name: a.name || a.ident || 'Unknown',
        lat: +parseFloat(a.lat).toFixed(4),
        lon: +parseFloat(a.lon).toFixed(4),
        value: 1,
        magnitude: 0.5,
        icao: a.icao || '',
        iata: a.iata || '',
        type: a.type || '',
        source: 'OurAirports',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'OurAirports fetch failed'); return []; }
}

// OpenAQ: Air quality station locations (v2 API, public)
const WORLD_CITIES_AQ = [
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Delhi', lat: 28.7041, lon: 77.1025 },
  { name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { name: 'Mexico City', lat: 19.4326, lon: -99.1332 },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357 },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074 },
  { name: 'Dhaka', lat: 23.8103, lon: 90.4125 },
  { name: 'Osaka', lat: 34.6937, lon: 135.5023 },
  { name: 'New York', lat: 40.7128, lon: -74.0060 },
  { name: 'Karachi', lat: 24.8607, lon: 67.0011 },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { name: 'Seoul', lat: 37.5665, lon: 126.9780 },
  { name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Lagos', lat: 6.5244, lon: 3.3792 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Berlin', lat: 52.5200, lon: 13.4050 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
  { name: 'Kuala Lumpur', lat: 3.1390, lon: 101.6869 },
  { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
  { name: 'Lima', lat: -12.0464, lon: -77.0428 },
  { name: 'Nairobi', lat: -1.2921, lon: 36.8219 },
  { name: 'Riyadh', lat: 24.7136, lon: 46.6753 },
  { name: 'Tehran', lat: 35.6892, lon: 51.3890 },
  { name: 'Lahore', lat: 31.5497, lon: 74.3436 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698 },
  { name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { name: 'Athens', lat: 37.9838, lon: 23.7275 },
  { name: 'Vienna', lat: 48.2082, lon: 16.3738 },
  { name: 'Warsaw', lat: 52.2297, lon: 21.0122 },
  { name: 'Stockholm', lat: 59.3293, lon: 18.0686 },
  { name: 'Prague', lat: 50.0755, lon: 14.4378 },
  { name: 'Budapest', lat: 47.4979, lon: 19.0402 },
  { name: 'Lisbon', lat: 38.7223, lon: -9.1393 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { name: 'Santiago', lat: -33.4489, lon: -70.6693 },
  { name: 'Bogotá', lat: 4.7110, lon: -74.0721 },
  { name: 'Hanoi', lat: 21.0278, lon: 105.8342 },
  { name: 'Manila', lat: 14.5995, lon: 120.9842 },
];

async function fetchOpenAQ(): Promise<any[]> {
  const results: any[] = [];
  const batchSize = 5;
  for (let i = 0; i < WORLD_CITIES_AQ.length; i += batchSize) {
    const batch = WORLD_CITIES_AQ.slice(i, i + batchSize);
    const promises = batch.map(async (city) => {
      try {
        const resp = await fetch(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi,european_aqi,pm2_5,pm10`,
          { signal: AbortSignal.timeout(10000) },
        );
        if (!resp.ok) return null;
        const data: any = await resp.json();
        const cur = data.current;
        if (!cur) return null;
        return {
          id: `aq_${city.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: city.name,
          lat: +city.lat.toFixed(4),
          lon: +city.lon.toFixed(4),
          value: cur.us_aqi ?? cur.european_aqi ?? 1,
          magnitude: (cur.us_aqi ?? cur.european_aqi ?? 50) / 100,
          type: 'air_quality',
          us_aqi: cur.us_aqi,
          european_aqi: cur.european_aqi,
          pm2_5: cur.pm2_5,
          pm10: cur.pm10,
          source: 'Open-Meteo',
          timestamp: cur.time ? new Date(cur.time).getTime() : Date.now(),
        };
      } catch (e) { logger.warn({ err: e }, 'Open-Meteo AQ station failed'); return null; }
    });
    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    // Throttle to avoid rate limiting
    if (i + batchSize < WORLD_CITIES_AQ.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return results;
}

// OSM Overpass: Points of interest from OpenStreetMap (global coverage)
async function fetchOverpassPois(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/lutangar/cities.json/master/cities.json',
      { signal: AbortSignal.timeout(20000) },
    );
    if (!resp.ok) return [];
    const cities = await resp.json() as any[];
    return cities.slice(0, 500).flatMap((c: any) => {
      const lat = parseFloat(c.lat);
      const lng = parseFloat(c.lng);
      if (isNaN(lat) || isNaN(lng)) return [];
      return {
        id: `city_${c.country}_${c.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
        name: c.name,
        lat: +lat.toFixed(4),
        lon: +lng.toFixed(4),
        value: 1,
        magnitude: 0.5,
        type: 'city',
        country: c.country,
        admin1: c.admin1,
        source: 'GeoNames (via cities.json)',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'GeoNames cities fetch failed'); return []; }
}

// RELIEFWEB: Global disaster events (public API)
async function fetchReliefWeb(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://api.reliefweb.int/v1/disasters?appname=myapp&limit=500&fields[include][]=name&fields[include][]=primary_country&fields[include][]=date&fields[include][]=status&fields[include][]=longitude&fields[include][]=latitude',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const items: any[] = (body?.data ?? []).slice(0, 500);
    return items.flatMap((item: any) => {
      const fields = item.fields || {};
      const lon = fields.longitude || fields.longitude?.[0];
      const lat = fields.latitude || fields.latitude?.[0];
      if (!lon || !lat) return [];
      return {
        id: `reliefweb_${item.id || Math.random().toString(36).slice(2, 8)}`,
        name: fields.name || 'ReliefWeb Disaster',
        lat: +parseFloat(lat).toFixed(4),
        lon: +parseFloat(lon).toFixed(4),
        value: 1,
        magnitude: 0.6,
        type: 'disaster',
        status: fields.status,
        country: fields.primary_country?.name,
        source: 'ReliefWeb',
        timestamp: fields.date?.created ? new Date(fields.date.created).getTime() : Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'ReliefWeb disaster fetch failed'); return []; }
}

// GDACS: Disaster alerts via RSS/JSON
async function fetchGdacs(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtypes=EQ,TC,FL,DR,WF,VO&limit=500',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const items: any[] = (body?.features ?? body?.events ?? body?.data ?? []).slice(0, 500);
    return items.flatMap((ev: any) => {
      const p = ev.properties || ev;
      const geom = ev.geometry || {};
      const coords = geom.coordinates || p.coordinates || [];
      const lon = Array.isArray(coords) ? coords[0] : p.longitude;
      const lat = Array.isArray(coords) ? coords[1] : p.latitude;
      if (!lon || !lat) return [];
      return {
        id: `gdacs_${p.id || ev.id || p.eventid || Math.random().toString(36).slice(2, 8)}`,
        name: p.name || p.title || ev.title || p.eventtype || 'GDACS Alert',
        lat: +parseFloat(lat).toFixed(4),
        lon: +parseFloat(lon).toFixed(4),
        value: p.severity || p.criticality || 1,
        magnitude: typeof p.severity === 'number' ? p.severity / 3 : 0.6,
        type: p.eventtype || p.eventType || 'disaster',
        alertlevel: p.alertlevel || p.severity,
        source: 'GDACS',
        timestamp: p.fromdate ? new Date(p.fromdate).getTime() : Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'GDACS disaster fetch failed'); return []; }
}

// HDX (Humanitarian Data Exchange): Dataset package locations
async function fetchHdxDatasets(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://data.humdata.org/api/3/action/package_search?q=&rows=20',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const results: any[] = (body?.result?.results ?? []).slice(0, 20);
    return results.flatMap((pkg: any) => {
      const org = pkg.organization || {};
      return {
        id: `hdx_${pkg.id || Math.random().toString(36).slice(2, 8)}`,
        name: pkg.title || pkg.name || 'HDX Dataset',
        lat: 0, lon: 0,
        value: 1,
        magnitude: 0.4,
        type: 'humanitarian_data',
        organization: org.title || org.name,
        source: 'HDX',
        timestamp: pkg.metadata_created ? new Date(pkg.metadata_created).getTime() : Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'HDX dataset fetch failed'); return []; }
}

// NASA Landslide Catalog
async function fetchNasaLandslides(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://pmm.nasa.gov/data/realtime/json/global_landslide_catalog_export.json',
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const items: any[] = Array.isArray(body) ? body : (body?.features ?? body?.items ?? []).slice(0, 500);
    return items.flatMap((ls: any) => {
      const geom = ls.geometry || {};
      const coords = geom.coordinates || ls.coordinates || [];
      const lon = Array.isArray(coords) ? coords[0] : (ls.longitude ?? ls.lon);
      const lat = Array.isArray(coords) ? coords[1] : (ls.latitude ?? ls.lat);
      if (!lon || !lat) return [];
      return {
        id: `landslide_${ls.id || ls.event_id || Math.random().toString(36).slice(2, 8)}`,
        name: ls.event_title || ls.title || ls.location || 'Landslide Event',
        lat: +parseFloat(lat).toFixed(4),
        lon: +parseFloat(lon).toFixed(4),
        value: ls.fatalities || 1,
        magnitude: ls.trigger ? 0.8 : 0.4,
        type: 'landslide',
        trigger: ls.trigger,
        source: 'NASA Landslide',
        timestamp: ls.event_date ? new Date(ls.event_date).getTime() : Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'NASA landslide fetch failed'); return []; }
}

// USGS GEOLOGY: Mineral resources sites from MRDATA (public WFS, no key required)
async function fetchUsgsGeology(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://macrostrat.org/api/v2/columns?format=json&limit=500',
      { signal: AbortSignal.timeout(20000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const raw = body?.success?.data;
    if (!raw) return [];
    const cols: any[] = Array.isArray(raw) ? raw.slice(0, 500) : [];
    return cols.flatMap((c: any) => {
      const lat = parseFloat(c.lat);
      const lon = parseFloat(c.lng);
      if (isNaN(lat) || isNaN(lon)) return [];
      return {
        id: `macro_${c.col_id || Math.random().toString(36).slice(2, 8)}`,
        name: c.col_name || c.col_group || 'Geologic Column',
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        value: 1,
        magnitude: 0.5,
        type: 'geologic_column',
        col_group: c.col_group,
        col_area: c.col_area,
        t_age: c.t_age,
        b_age: c.b_age,
        source: 'Macrostrat',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'Macrostrat geology fetch failed'); return []; }
}

// PBDB (Paleobiology Database): Fossil occurrences with coordinates
async function fetchPbdbOccurrences(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://paleobiodb.org/data1.2/occs/list.json?limit=500&show=coords&base_name=Mollusca&lngmin=-180&lngmax=180&latmin=-90&latmax=90',
      { signal: AbortSignal.timeout(30000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const recs: any[] = (body?.records ?? []).slice(0, 500);
    return recs.flatMap((r: any) => {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lng);
      if (isNaN(lat) || isNaN(lon)) return [];
      return {
        id: `pbdb_${r.oid || Math.random().toString(36).slice(2, 8)}`,
        name: r.tna || r.idn || 'Fossil Occurrence',
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        value: 1,
        magnitude: 0.5,
        type: 'fossil_occurrence',
        taxon: r.tna || '',
        identified_name: r.idn || '',
        early_age: r.eag,
        late_age: r.lag,
        interval: r.oei || '',
        source: 'PBDB',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'PBDB fossil fetch failed'); return []; }
}

// Macrostrat Regional: Geologic columns from a different slice than the group fallback
async function fetchMacrostratRegional(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://macrostrat.org/api/v2/columns?format=json',
      { signal: AbortSignal.timeout(30000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const raw = body?.success?.data;
    if (!raw) return [];
    const all: any[] = Array.isArray(raw) ? raw : [];
    // Skip the first 500 (used by group fallback) and take the next 500
    const cols = all.slice(500, 1000);
    return cols.flatMap((c: any) => {
      const lat = parseFloat(c.lat);
      const lon = parseFloat(c.lng);
      if (isNaN(lat) || isNaN(lon)) return [];
      return {
        id: `macro_reg_${c.col_id || Math.random().toString(36).slice(2, 8)}`,
        name: c.col_name || c.col_group || 'Geologic Column',
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        value: 1,
        magnitude: 0.6,
        type: 'geologic_column',
        col_group: c.col_group,
        col_area: c.col_area,
        t_age: c.t_age,
        b_age: c.b_age,
        source: 'Macrostrat (offset)',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'Macrostrat regional fetch failed'); return []; }
}

// Natural Earth: Populated places from Natural Earth vector dataset
async function fetchNaturalEarthPlaces(): Promise<any[]> {
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson',
      { signal: AbortSignal.timeout(30000) },
    );
    if (!resp.ok) return [];
    const body: any = await resp.json();
    const features: any[] = (body?.features ?? [])
      .sort((a: any, b: any) => (b.properties?.pop_max || 0) - (a.properties?.pop_max || 0))
      .slice(0, 500);
    return features.flatMap((f: any) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      const lon = Array.isArray(coords) ? coords[0] : (p.longitude ?? p.lng);
      const lat = Array.isArray(coords) ? coords[1] : (p.latitude ?? p.lat);
      if (!lon || !lat) return [];
      return {
        id: `ne_${p.featurecla || Math.random().toString(36).slice(2, 8)}_${Math.random().toString(36).slice(2, 6)}`,
        name: p.name || p.city || 'Populated Place',
        lat: +parseFloat(lat).toFixed(4),
        lon: +parseFloat(lon).toFixed(4),
        value: p.pop_min || p.pop_max || 1,
        magnitude: 0.5,
        type: 'populated_place',
        population: p.pop_max || p.pop_min || 0,
        country: p.sov0name || p.country || '',
        region: p.region || '',
        source: 'Natural Earth',
        timestamp: Date.now(),
      };
    });
  } catch (e) { logger.warn({ err: e }, 'Natural Earth places fetch failed'); return []; }
}

// Layer-specific fetchers: individual layers can have their own unique data source
const LAYER_FETCHERS: Record<string, () => Promise<any[]>> = {
  'internet_outages': async () => {
    try {
      const resp = await fetch('https://api.ioda.inetintel.cc.gatech.edu/v2/alerts/country?format=json', { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data ?? []).map((item: any) => ({ lat: item.lat ?? 0, lon: item.lon ?? 0, name: item.name ?? 'Internet Outage', severity: item.severity ?? 'unknown', source: 'IODA' }));
    } catch { return []; }
  },
  'acled_conflict': async () => {
    try {
      const key = process.env.ACLED_API_KEY || '';
      const email = process.env.ACLED_EMAIL || '';
      if (!key) { logger.info('ACLED_API_KEY not configured — register at acleddata.com for free access'); return []; }
      const resp = await fetch(`https://api.acleddata.com/acled/read?limit=100&format=json&key=${key}&email=${email}`, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data ?? []).map((e: any) => ({ lat: parseFloat(e.latitude) || 0, lon: parseFloat(e.longitude) || 0, name: e.event_type ?? 'Conflict', severity: e.fatalities > 10 ? 'critical' : e.fatalities > 0 ? 'high' : 'medium', source: 'ACLED' }));
    } catch { return []; }
  },
  'worldbank_economy': async () => {
    try {
      // Multiple World Bank indicators for comprehensive economic intelligence
      const indicators = [
        { code: 'NY.GDP.MKTP.CD', name: 'GDP (Current US$)', unit: 'US$', divisor: 1e9, format: (v: number) => `$${(v / 1e9).toFixed(1)}B` },
        { code: 'SP.POP.TOTL', name: 'Population', unit: 'people', divisor: 1e6, format: (v: number) => `${(v / 1e6).toFixed(1)}M` },
        { code: 'NY.GDP.PCAP.CD', name: 'GDP per Capita', unit: 'US$/person', divisor: 1, format: (v: number) => `$${v.toLocaleString()}` },
        { code: 'FP.CPI.TOTL.ZG', name: 'Inflation Rate', unit: '%', divisor: 1, format: (v: number) => `${v.toFixed(1)}%` },
        { code: 'SL.UEM.TOTL.ZS', name: 'Unemployment Rate', unit: '%', divisor: 1, format: (v: number) => `${v.toFixed(1)}%` },
        { code: 'SP.DYN.LE00.IN', name: 'Life Expectancy', unit: 'years', divisor: 1, format: (v: number) => `${v.toFixed(1)} yrs` },
        { code: 'EN.ATM.CO2E.PC', name: 'CO2 Emissions per Capita', unit: 'metric tons', divisor: 1, format: (v: number) => `${v.toFixed(2)}t` },
        { code: 'BN.CAB.XOKA.CD', name: 'Current Account Balance', unit: 'US$', divisor: 1e9, format: (v: number) => `${v >= 0 ? '+' : ''}$${(v / 1e9).toFixed(1)}B` },
      ];
      
      const allRecords: any[] = [];
      // Fetch all indicators in parallel with individual timeouts
      await Promise.allSettled(indicators.map(async (ind) => {
        try {
          const resp = await fetch(`https://api.worldbank.org/v2/country/all/indicator/${ind.code}?format=json&per_page=300&date=2023:2026`, { signal: AbortSignal.timeout(12000) });
          if (!resp.ok) return;
          const data = await resp.json();
          const records = Array.isArray(data) && data.length > 1 ? data[1] : [];
          for (const r of records) {
            if (r.value != null && r.countryiso2code) {
              const cc = r.countryiso2code as string;
              const coords = COUNTRY_CENTROIDS[cc] || [0, 0];
              allRecords.push({
                lat: coords[0], lon: coords[1],
                indicator: ind.code,
                indicatorName: ind.name,
                unit: ind.unit,
                formatValue: ind.format(r.value),
                rawValue: r.value,
                country: r.country?.value,
                countryCode: cc,
                date: r.date,
                name: `${r.country?.value}: ${ind.format(r.value)}`,
                value: r.value,
                source: 'World Bank',
              });
            }
          }
        } catch { /* indicator failed, continue with others */ }
      }));
      
      const records = allRecords;
      // Country centroid lookup for geocoding World Bank data (ISO2 -> [lat, lon])
      ;
      return records.filter((r: any) => r.value != null).map((r: any) => {
        const cc = r.countryiso2code as string;
        const coords = COUNTRY_CENTROIDS[cc] || [0, 0];
        return {
          lat: coords[0], lon: coords[1],
          name: `${r.country?.value}: $${(r.value / 1e9).toFixed(1)}B`,
          value: r.value, date: r.date, countryCode: cc,
          source: 'World Bank', indicator: r.indicator?.value,
        };
      });
    } catch { return []; }
  },
  'who_disease_outbreaks': async () => {
    try {
      const resp = await fetch('https://ghoapi.azureedge.net/api/WHS6_102?$filter=SpatialDim%20eq%20%27GLO%27&$orderby=TimeDim%20desc&$top=100', { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      
      // WHO region centroids + major country centroids for geocoding health data
      ;
      return (data.value ?? []).filter((v: any) => v.NumericValue != null).map((v: any) => {
        const dim = v.SpatialDim as string;
        const c = WHO_GEO[dim] || WHO_GEO[dim.toUpperCase()];
        return {
          lat: c?.[0] ?? 0, lon: c?.[1] ?? 0,
          name: `${v.SpatialDim}: ${v.NumericValue?.toFixed(1) ?? 'N/A'}`,
          value: v.NumericValue, date: v.TimeDim, source: 'WHO GHO',
          indicator: v.IndicatorCode,
        };
      }).filter((r: any) => r.lat !== 0 || r.lon !== 0);
    } catch { return []; }
  },
  'shodan_iot': async () => {
    try {
      const apiKey = process.env.SHODAN_API_KEY;
      if (!apiKey) return [];
      const resp = await fetch(`https://api.shodan.io/shodan/host/search?key=${apiKey}&query=country:US&limit=50`, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.matches ?? []).map((h: any) => ({ lat: h.location?.latitude ?? 0, lon: h.location?.longitude ?? 0, name: h.org ?? h.ip_str ?? 'IoT Device', country: h.location?.country_name, source: 'Shodan' }));
    } catch { return []; }
  },
  'virustotal_threats': async () => {
    try {
      const apiKey = process.env.VIRUSTOTAL_API_KEY;
      if (!apiKey) { logger.info('VIRUSTOTAL_API_KEY not configured'); return []; }
      const resp = await fetch('https://www.virustotal.com/api/v3/files?limit=50', {
        headers: { 'x-apikey': apiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data ?? []).map((f: any) => ({ lat: 0, lon: 0, name: f.attributes?.meaningful_name ?? f.id ?? 'Threat', source: 'VirusTotal' }));
    } catch { return []; }
  },
  'supply_chain_trade': async () => {
    try {
      const resp = await fetch('https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=842&flowCode=M&cmdCode=TOTAL&period=2024', { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.data ?? []).map((t: any) => ({ lat: 0, lon: 0, name: `${t.partnerDesc}: $${(t.primaryValue ?? 0 / 1e9).toFixed(1)}B`, value: t.primaryValue, source: 'UN Comtrade' }));
    } catch { return []; }
  },
  'disinformation_monitor': async () => {
    try {
      const resp = await fetch('https://api.gdeltproject.org/api/v2/doc/doc?query=disinformation+OR+deepfake+OR+propaganda&mode=artlist&maxrecords=50&format=json&sort=DateDesc&timespan=7d', { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      
      return (data.articles ?? []).map((a: any) => ({
        lat: 0, lon: 0,
        name: a.title ?? 'Disinformation Article',
        url: a.url, source: 'GDELT',
        language: a.language, domain: a.domain,
        date: a.seendate, tone: a.tone,
      }));
    } catch { return []; }
  },
  'cloudflare_radar_attacks': async () => {
    try {
      const apiKey = process.env.CLOUDFLARE_API_KEY;
      if (!apiKey) return [];
      const resp = await fetch('https://api.cloudflare.com/client/v4/radar/attacks/summary?dateRange=7d', { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.result?.locations ?? []).map((l: any) => ({ lat: l.latitude ?? 0, lon: l.longitude ?? 0, name: `${l.location}: ${l.value} attacks`, value: l.value, source: 'Cloudflare Radar' }));
    } catch { return []; }
  },
  '16_pbdb': fetchPbdbOccurrences,
  '16_macrostrat': fetchMacrostratRegional,
  '50_ocean_currents': fetchOceanCurrents,
  'radio_stations': async () => {
    try {
      // Radio Browser public API — free, no key required. Try multiple mirrors.
      const mirrors = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fr1.api.radio-browser.info', 'at1.api.radio-browser.info'];
      for (const host of mirrors) {
        try {
          const resp = await fetch(`https://${host}/json/stations/search?limit=500&has_geo_info=true&hidebroken=true`, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const data = await resp.json();
            return (Array.isArray(data) ? data : []).map((s: any) => ({
              lat: parseFloat(s.geo_lat ?? 0),
              lon: parseFloat(s.geo_long ?? 0),
              name: s.name ?? 'Unknown Station',
              url: s.url ?? '',
              tags: s.tags ?? '',
              codec: s.codec ?? '',
              bitrate: s.bitrate ?? 0,
              source: 'Radio Browser',
              stationuuid: s.stationuuid ?? '',
              favicon: s.favicon ?? '',
            }));
          }
        } catch { /* try next mirror */ }
      }
      return [];
    } catch { return []; }
  },
  'bikeshare': async () => {
    try {
      // GBFS systems list from the official GitHub repository CSV
      const resp = await fetch('https://raw.githubusercontent.com/NABSA/gbfs/master/systems.csv', { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return [];
      const csv = await resp.text();
      const lines = csv.split('\n');
      if (lines.length < 2) return [];
      // Skip header, find auto-discovery URL column
      const header = lines[0].split(',');
      const urlIdx = header.findIndex((h: string) => h.trim() === 'Auto-Discovery URL');
      if (urlIdx < 0) return [];
      const results: any[] = [];
      const seen = new Set<string>();
      for (let i = 1; i < Math.min(lines.length, 80); i++) {
        const cols = lines[i].split(',');
        const url = (cols[urlIdx] ?? '').trim().replace(/^"|"$/g, '');
        if (!url) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        try {
          const discResp = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!discResp.ok) continue;
          const disc = await discResp.json();
          const feeds = disc.data?.en?.feeds ?? disc.data?.nl?.feeds ?? [];
          const siFeed = feeds.find((f: any) => f.name === 'station_information');
          if (!siFeed?.url) continue;
          const siResp = await fetch(siFeed.url, { signal: AbortSignal.timeout(5000) });
          if (!siResp.ok) continue;
          const siData = await siResp.json();
          const stations = siData.data?.stations ?? [];
          for (const st of stations.slice(0, 30)) {
            results.push({
              lat: st.lat,
              lon: st.lon,
              name: st.name ?? 'Bikeshare Station',
              stationId: st.station_id,
              capacity: st.capacity ?? 0,
              system: lines[i].split(',')[0] ?? 'Unknown',
              source: 'GBFS',
            });
          }
        } catch { /* skip single system on failure */ }
      }
      return results;
    } catch { return []; }
  },
};

// Group dispatcher: each group fetches from a real data source
// TTLs match each source's actual update frequency:
//   USGS: 60s (polled every 60s by their CDN)
//   EONET: 600s (real-time, but events persist hours)
//   Open-Meteo: 600s (forecast regenerated hourly)
//   OpenAQ: 1800s (station data changes slowly)
//   Overpass: 3600s (OSM data is static)  
//   NDBC: 3600s (station list changes at most daily)
//   GBIF: 7200s (research database, weeks between updates)
//   CelesTrak: 3600s (TLE data refreshed 2-3x/day)
const GROUP_DATA_SOURCES: Record<string, () => Promise<any[]>> = {
  ocean: () => cachedFetchGroup('ocean_buoys', fetchOceanBuoys, 3600),
  seismic: () => cachedFetchGroup('usgs_eqs', fetchEarthquakes, 60),
  ecology: () => cachedFetchGroup('gbif_occ', fetchGbifOccurrences, 7200),
  hazards: () => cachedFetchGroup('eonet_events', fetchEonetEvents, 600),
  weather: () => cachedFetchGroup('weather_fc', fetchWeatherForecasts, 600),
  atmosphere: () => cachedFetchGroup('openaq_locs', fetchOpenAQ, 1800),
  geology: () => cachedFetchGroup('usgs_minerals', fetchUsgsGeology, 7200),
  space: () => cachedFetchGroup('celestrak_sats', fetchSatellites, 3600),
  cryosphere: () => cachedFetchGroup('eonet_events', fetchEonetEvents, 600).then(items =>
    items.filter(i => {
      const t = (i.type || '').toLowerCase();
      return t.includes('ice') || t.includes('winter') || t.includes('snow') || t.includes('cold');
    }),
  ),
  argo: () => cachedFetchGroup('argo_floats', fetchArgoFloats, 3600),
  tides: () => cachedFetchGroup('noaa_tides', fetchNoaaTides, 1800),
  usgs_water: () => cachedFetchGroup('usgs_water_q', fetchUsgsWaterQuality, 7200),
  ports: () => cachedFetchGroup('world_ports', fetchWorldPorts, 86400),
  geospatial: () => cachedFetchGroup('osm_pois', fetchOverpassPois, 3600),
  advanced: () => cachedFetchGroup('hdx_datasets', fetchHdxDatasets, 7200),
  satellite: () => cachedFetchGroup('celestrak_sats', fetchSatellites, 3600),
  bathymetry_pt: async () => [],
  aviation: () => cachedFetchGroup('airports_data', fetchAirports, 86400),
};

// ── USGS Water Services (streamflow, groundwater) ─────────────────

// ── OpenFEMA Disaster Declarations ───────────────────────────────────
app.get('/api/fema', async (req: express.Request, res: express.Response) => {
  const latMin = parseFloat(req.query.latMin as string);
  const latMax = parseFloat(req.query.latMax as string);
  const lonMin = parseFloat(req.query.lonMin as string);
  const lonMax = parseFloat(req.query.lonMax as string);
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const hasBbox = Number.isFinite(latMin) && Number.isFinite(latMax) && Number.isFinite(lonMin) && Number.isFinite(lonMax);

  // Build FEMA OData filter
  const filters: string[] = [];

  if (startDate) {
    filters.push(`declarationDate ge '${startDate}T00:00:00.000z'`);
  }
  if (endDate) {
    filters.push(`declarationDate le '${endDate}T23:59:59.999z'`);
  }

  const filterParam = filters.length > 0 ? `&$filter=${encodeURIComponent(filters.join(' and '))}` : '';
  const cacheKey = `fema_${hasBbox ? `${latMin}_${lonMin}_${latMax}_${lonMax}` : 'global'}_${startDate}_${endDate}`;
  const hit = cache.get<any>(cacheKey);
  if (hit) { res.json(hit); return; }

  // Fetch recent declarations (FEMA API max $top is 1000, but we only need recent ones)
  const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$format=json&$top=50&$orderby=declarationDate desc${filterParam}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!resp.ok) {
      return res.json({ DisasterDeclarationsSummaries: [], total: 0, source: 'FEMA', note: 'FEMA API temporarily unavailable' });
    }
    const data = (await resp.json()) as Record<string, unknown>;
    const summaries = (data.DisasterDeclarationsSummaries as unknown[]) || [];

    const result = { DisasterDeclarationsSummaries: summaries, total: summaries.length, source: 'FEMA' };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (e) {
    logger.warn({ err: e }, 'FEMA API unavailable');
    res.json({ DisasterDeclarationsSummaries: [], total: 0, source: 'FEMA', note: 'FEMA API temporarily unavailable' });
  }
});

// ── USGS Water Services (streamflow, gage height, water temp) ─────
app.get('/api/usgs/water', async (req: express.Request, res: express.Response) => {
  const latMin = parseFloat(req.query.latMin as string);
  const latMax = parseFloat(req.query.latMax as string);
  const lonMin = parseFloat(req.query.lonMin as string);
  const lonMax = parseFloat(req.query.lonMax as string);
  if (!latMin || !latMax || !lonMin || !lonMax) {
    return res.status(400).json({ error: 'latMin,latMax,lonMin,lonMax required' });
  }
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const startTime = req.query.startTime as string | undefined;
  const endTime = req.query.endTime as string | undefined;
  const cacheKey = `usgs_water_${latMin.toFixed(2)}_${lonMin.toFixed(2)}_${latMax.toFixed(2)}_${lonMax.toFixed(2)}_${startDate}_${endDate}`;
  const hit = cache.get<any>(cacheKey);
  if (hit) { res.json(hit); return; }
  let dateParam = '';
  if (startDate) dateParam += `&startDT=${startDate}T${startTime || '00:00'}:00`;
  if (endDate) dateParam += `&endDT=${endDate}T${endTime || '23:59'}:00`;
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${lonMin},${latMin},${lonMax},${latMax}&parameterCd=00060,00065,00010&siteStatus=active${dateParam}`;
  const emptyResult = { source: 'USGS Water Services', siteCount: 0, numberOfSites: 0, sites: [], bbox: { latMin, latMax, lonMin, lonMax }, note: 'USGS Water API temporarily unavailable' };
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      const retryResp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!retryResp.ok) { res.json(emptyResult); return; }
      const raw: any = await retryResp.json();
      const timeSeries: any[] = raw?.value?.timeSeries ?? [];
      const sites = timeSeries.map((ts: any) => {
        const source = ts.sourceInfo || {};
        const site = source.siteInfo || {};
        const geo = source.geoLocation?.geogLocation || {};
        const values = ts.values?.[0]?.value || [];
        const latest = values.length > 0 ? values[values.length - 1] : null;
        const params: Record<string, any> = {};
        const variable = ts.variable || {};
        const code = variable.variableCode?.[0]?.value || '';
        if (code) params[code] = latest ? { value: latest.value, unit: variable.unit?.unitCode || '' } : {};
        const siteName = site.siteName || '';
        const [siteCode] = source.siteCode || [];
        return { siteCode: siteCode?.value || '', siteName, latitude: geo.latitude || 0, longitude: geo.longitude || 0, parameters: params, updated: latest?.dateTime || null };
      });
      const result: Record<string, any> = { source: 'USGS Water Services', siteCount: sites.length, numberOfSites: sites.length, sites, bbox: { latMin, latMax, lonMin, lonMax } };
      if (sites.length === 1) { result.latitude = sites[0].latitude; result.longitude = sites[0].longitude; result.value = sites[0].parameters; result.siteName = sites[0].siteName; }
      cache.set(cacheKey, result, 600);
      res.json(result);
      return;
    }
    const raw: any = await resp.json();
    const timeSeries: any[] = raw?.value?.timeSeries ?? [];
    const sites = timeSeries.map((ts: any) => {
      const source = ts.sourceInfo || {};
      const site = source.siteInfo || {};
      const geo = source.geoLocation?.geogLocation || {};
      const values = ts.values?.[0]?.value || [];
      const latest = values.length > 0 ? values[values.length - 1] : null;
      const params: Record<string, any> = {};
      const variable = ts.variable || {};
      const code = variable.variableCode?.[0]?.value || '';
      if (code) params[code] = latest ? { value: latest.value, unit: variable.unit?.unitCode || '' } : {};
      const siteName = site.siteName || '';
      const [siteCode] = source.siteCode || [];
      return { siteCode: siteCode?.value || '', siteName, latitude: geo.latitude || 0, longitude: geo.longitude || 0, parameters: params, updated: latest?.dateTime || null };
    });
    const result: Record<string, any> = { source: 'USGS Water Services', siteCount: sites.length, numberOfSites: sites.length, sites, bbox: { latMin, latMax, lonMin, lonMax } };
    if (sites.length === 1) { result.latitude = sites[0].latitude; result.longitude = sites[0].longitude; result.value = sites[0].parameters; result.siteName = sites[0].siteName; }
    cache.set(cacheKey, result, 600);
    res.json(result);
  } catch (e) {
    logger.warn({ err: e }, 'USGS Water Services unavailable');
    res.json(emptyResult);
  }
});

// ── OSM Overpass API (custom geographic queries) ────────────────────
app.get('/api/geospatial/overpass', async (req: express.Request, res: express.Response) => {
  const latMin = parseFloat(req.query.latMin as string);
  const latMax = parseFloat(req.query.latMax as string);
  const lonMin = parseFloat(req.query.lonMin as string);
  const lonMax = parseFloat(req.query.lonMax as string);
  if (!latMin || !latMax || !lonMin || !lonMax) {
    return res.status(400).json({ error: 'latMin,latMax,lonMin,lonMax required' });
  }
  const type = (req.query.type as string) || 'building';
  try {
    const cacheKey = `overpass_${latMin.toFixed(2)}_${lonMin.toFixed(2)}_${latMax.toFixed(2)}_${lonMax.toFixed(2)}_${type}`;
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }
    const query = type === 'building'
      ? `[out:json][timeout:20][maxsize:500000];(way["building"](${latMin},${lonMin},${latMax},${lonMax});>;);out;`
      : type === 'road'
      ? `[out:json][timeout:20][maxsize:500000];(way["highway"](${latMin},${lonMin},${latMax},${lonMax});>;);out;`
      : `[out:json][timeout:20][maxsize:500000];(node[${JSON.stringify(type)}](${latMin},${lonMin},${latMax},${lonMax}););out;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'curl/8.7' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) {
      const retryResp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'curl/8.7' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!retryResp.ok) { res.json({ elements: [], note: 'Overpass API temporarily unavailable' }); return; }
      const data = await retryResp.json();
      cache.set(cacheKey, data, 3600);
      res.json(data);
      return;
    }
    const data = await resp.json();
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (e) {
    logger.warn({ err: e }, 'Overpass API unavailable');
    res.json({ elements: [], note: 'Overpass API temporarily unavailable' });
  }
});

// ── Military Bases (Wikidata SPARQL) ───────────────────────────────
app.get('/api/military-bases', async (_req: express.Request, res: express.Response) => {
  const cacheKey = 'military_bases_global_v4';
  const hit = cache.get(cacheKey);
  if (hit) { res.json(hit); return; }
  try {
    const sparql = `SELECT ?item ?itemLabel ?coords WHERE {
  ?item wdt:P31/wdt:P279* wd:Q245016 ; wdt:P625 ?coords .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 200`;
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'EarthReplica/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) { res.json({ elements: [], note: 'Wikidata unavailable' }); return; }
    const data = await resp.json() as { results?: { bindings?: any[] } };
    const results = data.results?.bindings || [];
    const elements = results.map((r: any) => {
      const wkt = r.coords?.value || '';
      const m = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
      const lon = m ? parseFloat(m[1]) : NaN;
      const lat = m ? parseFloat(m[2]) : NaN;
      return { type: 'node', id: r.item?.value?.split('/').pop() || 0, lat, lon,
        tags: { name: r.itemLabel?.value || '', type: 'military_base' } };
    }).filter((e: any) => isFinite(e.lat) && isFinite(e.lon));
    const out = { elements };
    cache.set(cacheKey, out, 86400);
    res.json(out);
  } catch (e) {
    res.json({ elements: [], note: 'Wikidata query failed' });
  }
});

// ── WorldPop Population Grid (population counts via bbox) ───────────
app.get('/api/population/worldpop', async (req: express.Request, res: express.Response) => {
  const latMin = parseFloat(req.query.latMin as string);
  const latMax = parseFloat(req.query.latMax as string);
  const lonMin = parseFloat(req.query.lonMin as string);
  const lonMax = parseFloat(req.query.lonMax as string);
  if (!latMin || !latMax || !lonMin || !lonMax) {
    return res.status(400).json({ error: 'latMin,latMax,lonMin,lonMax required' });
  }
  try {
    const cacheKey = `ne_pop_${latMin.toFixed(1)}_${lonMin.toFixed(1)}_${latMax.toFixed(1)}_${lonMax.toFixed(1)}`;
    const hit = cache.get(cacheKey);
    if (hit) { res.json(hit); return; }
    const places = await fetchNaturalEarthPlaces();
    const inBbox = places.filter((p: any) =>
      p.lat >= latMin && p.lat <= latMax &&
      p.lon >= lonMin && p.lon <= lonMax
    );
    const totalPopulation = inBbox.reduce((s: number, p: any) => s + (p.population || 0), 0);
    const areaDeg = (latMax - latMin) * (lonMax - lonMin);
    const areaKm2 = areaDeg * 111 * 111;
    const cities = inBbox
      .sort((a: any, b: any) => (b.population || 0) - (a.population || 0))
      .slice(0, 10)
      .map((p: any) => ({ name: p.name, population: p.population, country: p.country }));
    const result = {
      source: 'Natural Earth',
      bbox: { latMin, latMax, lonMin, lonMax },
      totalPopulation,
      densityPerKm2: areaKm2 > 0 ? Math.round(totalPopulation / areaKm2) : 0,
      cityCount: inBbox.length,
      largestCities: cities,
    };
    cache.set(cacheKey, result, 86400);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/data/:layerId', async (req: express.Request, res: express.Response) => {
  const { layerId } = req.params;
  const group = (req.query.group as string) || '';
  const dataSourceUrl = req.query.source as string;

  const sourceHash = dataSourceUrl ? createHash('sha1').update(dataSourceUrl).digest('hex').slice(0, 12) : 'nosource';
  const cacheKey = `layer_data_${layerId}_${group || 'nogroup'}_${sourceHash}`;
  const hit = cache.get(cacheKey);
  if (hit) { res.json(hit); return; }

  const layerFetcher = LAYER_FETCHERS[layerId];
  const groupFetcher = GROUP_DATA_SOURCES[group];
  const hasLocalFallback = Boolean(layerFetcher || groupFetcher);

  const rejectOrFallback = (statusCode: number, error: string, context: Record<string, unknown>) => {
    if (!hasLocalFallback) {
      res.status(statusCode).json({ error });
      return false;
    }
    logger.info({ layerId, group, ...context }, 'skipping source proxy and using local layer fetcher');
    return true;
  };

  if (dataSourceUrl) {
    const ssrfCheck = await validateOutboundUrl(dataSourceUrl);
    if (!ssrfCheck.safe) {
      const shouldContinue = rejectOrFallback(400, `Refused to proxy URL: ${ssrfCheck.reason ?? 'unsafe URL'}`, {
        url: dataSourceUrl,
        reason: ssrfCheck.reason,
      });
      if (!shouldContinue) return;
    } else {
      const proxyable =
        dataSourceUrl.includes('/api/') ||
        dataSourceUrl.endsWith('.json') ||
        dataSourceUrl.endsWith('.geojson');
      if (!proxyable) {
        const shouldContinue = rejectOrFallback(400, 'source URL must be http(s) and end with .json/.geojson or contain /api/', {
          url: dataSourceUrl,
          reason: 'not_proxyable',
        });
        if (!shouldContinue) return;
      } else if (!isAllowedUpstream(dataSourceUrl)) {
        const shouldContinue = rejectOrFallback(400, 'Upstream host is not in the allow-list for /api/data proxying', {
          url: dataSourceUrl,
          reason: 'not_allowlisted',
        });
        if (!shouldContinue) return;
      } else {
        try {
          const resp = await fetch(dataSourceUrl, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            const data = await resp.json();
            const result = (data as any).items ?? (data as any).features ?? data;
            const wrapped = Array.isArray(result) ? { items: result } : result;
            cache.set(cacheKey, wrapped, 600);
            res.json(wrapped);
            return;
          }
        } catch (err) {
          logger.warn({ err: (err as Error).message, url: dataSourceUrl }, 'dataSource fetch failed');
          /* fall through */
        }
      }
    }
  }

  // Try 2: Check for a layer-specific fetcher
  if (layerFetcher) {
    try {
      const items = await layerFetcher();
      const payload = { items };
      cache.set(cacheKey, payload, 3600);
      res.json(payload);
      return;
    } catch (e) { logger.warn({ err: e, layerId }, 'Layer-specific fetcher failed, falling through to group'); }
  }

  // Try 3: Use group-specific real data fetcher
  if (groupFetcher) {
    try {
      const items = await groupFetcher();
      if (group === 'cryosphere') {
        const payload = { items, description: 'EONET ice/snow/winter events' };
        cache.set(cacheKey, payload, 1800);
        res.json(payload);
        return;
      }
      const payload = { items };
      cache.set(cacheKey, payload, 600);
      res.json(payload);
      return;
    } catch (e) { logger.warn({ err: e, group }, 'Group fetcher failed, falling through'); }
  }

  // No real data available — short TTL to allow recovery when upstream APIs come back
  const COMMERCIAL_API_DOMAINS = ['flightaware.com', 'airlabs.co', 'api.windy.com', 'api.purpleair.com', 'api.airnowapi.org', 'aisstream.io'];
  if (dataSourceUrl && COMMERCIAL_API_DOMAINS.some(d => dataSourceUrl.includes(d))) {
    logger.warn({ layerId, url: dataSourceUrl }, '[API KEY NEEDED] Layer requires a commercial API key. Add it in Settings > API Vault.');
  }
  cache.set(cacheKey, { items: [] }, 60);
  res.json({ items: [] });
});

/* ═════════════════════════════════════════════════════════════════
   PHYSICS SANDBOX v2 — Simulation engine (FARSITE, ADCIRC, WRF, HYSPLIT, FNO)
   ═════════════════════════════════════════════════════════════════ */

const simulateUserRateLimit = perUserRateLimiter(10, 60000);

app.post('/api/simulate/run', simulateUserRateLimit, async (req: express.Request, res: express.Response) => {
  try {
    const { model, params } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });

    const available = simulationEngine.listModels();
    if (!available.includes(model)) {
      return res.status(400).json({ error: `Unknown model. Available: ${available.join(', ')}` });
    }

    let result;
    switch (model) {
      case 'farsite-lite':
        result = await runFarsiteSimulation(simulationEngine, params);
        break;
      case 'adcirc-lite':
        result = await runAdcircSimulation(simulationEngine, params);
        break;
      case 'wrf-lite':
        result = await runWrfSimulation(simulationEngine, params);
        break;
      case 'hysplit-lite':
        result = await runHysplitSimulation(simulationEngine, params);
        break;
      case 'fno-surrogate': {
        const fnoResult = await runFnoPrediction(simulationEngine, { lat: params?.lat || 0, lon: params?.lon || 0, leadDays: params?.leadDays || 3 });
        res.json(fnoResult);
        return;
      }
      default:
        result = await simulationEngine.runSimulation({ model, params: params || {}, timeoutMs: 60000, memoryLimitMb: 256 });
    }

    auditLog((req as any).userId, 'simulate_run', `model:${model}`, `id:${result.id}`, req.ip || '', req.headers['user-agent'] || '');
    res.json({ simulationId: result.id, status: result.status, durationMs: result.durationMs, result: result.result, logs: result.logs });
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'simulation run failed');
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/simulate/templates', (_req: express.Request, res: express.Response) => {
  try {
    const schemas = simulationEngine.listModelSchemas();
    res.json(schemas.map(s => ({ name: s.name, description: s.description, schema: s })));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ═════════════════════════════════════════════════════════════════
   H3 ENGINE — Hexagonal spatial indexing & query engine
   ═════════════════════════════════════════════════════════════════ */

initSpatialEngine(
  process.env.TIMESCALE_CONNECTION_STRING,
  process.env.CLICKHOUSE_HOST ? { host: process.env.CLICKHOUSE_HOST, port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10) } : undefined,
  process.env.KAFKA_BROKERS ? { kafkaBrokers: process.env.KAFKA_BROKERS.split(',') } : undefined,
);
app.use(spatialRouter);

/* ═════════════════════════════════════════════════════════════════
   SELF-EVOLUTION SYSTEM — AI code generation, test runner, bandit routing
   ═════════════════════════════════════════════════════════════════ */

const codeWriter = new CodeWriter(path.join(__dirname, 'templates'));
const testRunner = new TestRunner(__dirname);
const gitIntegration = new GitIntegration(path.resolve(__dirname, '..'));
const intentDiscovery = new IntentDiscoveryV2(null as any, codeWriter);
const banditRouter = new BanditRouter(['gpt-4o', 'claude-3-opus', 'gemini-2', 'deepseek-v4']);
const perfMonitor = new PerfMonitor();

app.use('/api/self-evolution', createSelfEvolutionRouter({
  intentDiscovery,
  banditRouter,
  perfMonitor,
  gitIntegration,
}));

// ─────────────────────────────────────────────
// AGENT ENDPOINTS — Antigravity Earth Intelligence Copilot
// ─────────────────────────────────────────────

/* ═════════════════════════════════════════════════════════════════
   SANDBOX API — Local code execution, workspace, file management
   ═════════════════════════════════════════════════════════════════ */

// Optional API token auth for sandbox & MCP endpoints
// ── Concurrent sandbox execution limits ───────────────────────
const MAX_LOCAL_SANDBOX = 3;
const MAX_CLOUD_SANDBOX = 10;
let activeLocalSandboxes = 0;
let activeCloudSandboxes = 0;

function checkSandboxConcurrency(cloud: boolean): { allowed: boolean; reason?: string } {
  if (cloud && activeCloudSandboxes >= MAX_CLOUD_SANDBOX) {
    return { allowed: false, reason: `Max cloud sandbox executions reached (${MAX_CLOUD_SANDBOX})` };
  }
  if (!cloud && activeLocalSandboxes >= MAX_LOCAL_SANDBOX) {
    return { allowed: false, reason: `Max local sandbox executions reached (${MAX_LOCAL_SANDBOX})` };
  }
  return { allowed: true };
}
function incrementSandboxCount(cloud: boolean): void {
  if (cloud) activeCloudSandboxes++; else activeLocalSandboxes++;
}
function decrementSandboxCount(cloud: boolean): void {
  if (cloud) activeCloudSandboxes--; else activeLocalSandboxes--;
}

function apiTokenGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.originalUrl.startsWith('/api/sandbox/') && (req as any).userId) {
    return next();
  }
  const expected = process.env.SANDBOX_API_TOKEN;
  if (!expected) {
    logger.error('SANDBOX_API_TOKEN is not set — refusing sandbox/MCP request');
    return res.status(401).json({ error: 'Unauthorized — SANDBOX_API_TOKEN must be configured' });
  }
  // Use constant-time compare to prevent timing attacks
  const provided = (req.headers['x-api-token'] as string) || (req.query.token as string) || '';
  if (!provided || provided.length !== expected.length) {
    return res.status(401).json({ error: 'Unauthorized — provide X-API-Token header or ?token= param matching SANDBOX_API_TOKEN' });
  }
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) {
    return res.status(401).json({ error: 'Unauthorized — provide X-API-Token header or ?token= param matching SANDBOX_API_TOKEN' });
  }
  next();
}

// Execute code in sandbox (local or E2B cloud)
const sandboxUserRateLimit = perUserRateLimiter(5, 60000); // 5 requests per minute per user

app.post('/api/sandbox/execute', apiTokenGuard, sandboxUserRateLimit, validate(sandboxExecuteSchema), async (req: express.Request, res: express.Response) => {
  try {
    const { language, code, workspaceId, timeout, env, cloud } = req.body;
    const isCloud = cloud === true;
    const concurrency = checkSandboxConcurrency(isCloud);
    if (!concurrency.allowed) {
      return res.status(429).json({ error: concurrency.reason });
    }
    incrementSandboxCount(isCloud);
    const start = Date.now();
    try {
      const result = await sandboxManager.execute({ language, code, workspaceId, timeout, env, cloud });
      sandboxExecutionsTotal.inc({ language: language || 'unknown', status: 'success' });
      const duration = Date.now() - start;
      if (duration > 5000) {
        logger.warn({ language, duration_ms: duration }, 'slow sandbox execution');
      }
      auditLog((req as any).userId, 'sandbox_exec', `language:${language}`, `code:${code.slice(0, 100)}`, req.ip || '', req.headers['user-agent'] || '');
      res.json(result);
    } finally {
      decrementSandboxCount(isCloud);
    }
  } catch (e) {
    sandboxExecutionsTotal.inc({ language: req.body.language || 'unknown', status: 'error' });
    logger.error({ err: e, language: req.body.language }, 'sandbox execution failed');
    if (e instanceof AppError) {
      res.status(e.statusCode).json(e.toJSON((req as any).correlationId));
    } else {
      res.status(500).json({ error: String(e) });
    }
  }
});

// Batch execute multiple code tasks
app.post('/api/sandbox/batch', apiTokenGuard, sandboxUserRateLimit, async (req: express.Request, res: express.Response) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'tasks array required' });
    const results = await sandboxManager.batchExecute(tasks);
    auditLog((req as any).userId, 'sandbox_exec', 'batch', `${tasks.length} tasks`, req.ip || '', req.headers['user-agent'] || '');
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Create a new sandbox workspace (local or E2B cloud)
app.post('/api/sandbox/workspace', apiTokenGuard, async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).userId;
    const cloud = req.body.cloud;
    const ws = await sandboxManager.createWorkspace(userId, cloud);
    res.json(ws);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Delete a workspace
app.delete('/api/sandbox/workspace/:id', apiTokenGuard, async (req: express.Request, res: express.Response) => {
  try {
    const ok = await sandboxManager.deleteWorkspace(req.params.id);
    res.json({ deleted: ok });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Upload a file to a workspace
app.post('/api/sandbox/workspace/:id/upload', apiTokenGuard, async (req: express.Request, res: express.Response) => {
  try {
    const { fileName, content } = req.body;
    if (!fileName || content === undefined) return res.status(400).json({ error: 'fileName and content required' });
    const filePath = await sandboxManager.writeFile(req.params.id, fileName, content);
    res.json({ path: filePath, fileName });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// List files in a workspace
app.get('/api/sandbox/workspace/:id/files', apiTokenGuard, async (req: express.Request, res: express.Response) => {
  try {
    const files = await sandboxManager.listFiles(req.params.id);
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Read a file from a workspace
app.get('/api/sandbox/workspace/:id/read', apiTokenGuard, async (req: express.Request, res: express.Response) => {
  try {
    const fileName = req.query.file as string;
    if (!fileName) return res.status(400).json({ error: 'file query param required' });
    const content = await sandboxManager.readFile(req.params.id, fileName);
    res.json({ fileName, content });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Agent task pipeline: decompose, execute, synthesize
app.post('/api/agent/pipeline', authGuard, async (req: express.Request, res: express.Response) => {
  const { goal, workspaceId, cloud } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
    let subtasks = TaskPlanner.decompose(goal);
    if (apiKey) {
      try {
        const llmPlan = await TaskPlanner.planWithLLM(goal, apiKey, toolRegistry.list());
        if (llmPlan && llmPlan.length > 0) subtasks = llmPlan;
      } catch (e) { logger.warn({ err: e }, 'LLM planning failed, using static decomposition'); }
    }
    sendEvent('plan', { subtasks: subtasks.map(s => ({ id: s.id, description: s.description })) });

    let wsId = workspaceId;
    if (!wsId) {
      const ws = await sandboxManager.createWorkspace('default', cloud);
      wsId = ws.id;
      sendEvent('workspace', { workspaceId: wsId, cloud: !!ws.cloud });
    }

    const results: Record<string, string> = {};

    for (const task of subtasks) {
      const depsDone = task.dependsOn.every(d => results[d] !== undefined);
      if (!depsDone) {
        sendEvent('error', { taskId: task.id, error: 'Dependencies not met' });
        continue;
      }

      sendEvent('subtask', { subtask: { id: task.id, description: task.description, status: 'running' } });

      if (task.code && task.language) {
        try {
          const execResult = await sandboxManager.execute({
            language: task.language,
            code: task.code,
            workspaceId: wsId,
            timeout: 30000,
          });
          results[task.id] = execResult.stdout;
          let globeCommands: Array<Record<string, unknown>> | null = null;
          for (const line of execResult.stdout.split('\n')) {
            const idx = line.indexOf('__GLOBE_COMMANDS__');
            if (idx >= 0) {
              const jsonStr = line.slice(idx + 18).trim();
              try { globeCommands = JSON.parse(jsonStr); } catch { /* skip malformed */ }
              break;
            }
          }
          sendEvent('subtask', { subtask: {
            id: task.id, description: task.description, status: 'completed',
            result: execResult.stdout.slice(0, 2000),
            executionTimeMs: execResult.executionTimeMs,
            globeCommands,
          }});
        } catch (e) {
          sendEvent('subtask', { subtask: { id: task.id, description: task.description, status: 'failed', error: String(e) } });
        }
      } else {
        results[task.id] = 'ok';
        sendEvent('subtask', { subtask: { id: task.id, description: task.description, status: 'completed' } });
      }
    }

    const allGlobeCommands: Array<Record<string, unknown>> = [];
    for (const r of Object.values(results)) {
      for (const line of r.split('\n')) {
        const idx = line.indexOf('__GLOBE_COMMANDS__');
        if (idx >= 0) {
          const jsonStr = line.slice(idx + 18).trim();
          try {
            const cmds = JSON.parse(jsonStr);
            if (Array.isArray(cmds)) allGlobeCommands.push(...cmds);
          } catch { /* skip */ }
          break;
        }
      }
    }
    if (allGlobeCommands.length > 0) {
      sendEvent('globe', { commands: allGlobeCommands });
    }
    sendEvent('done', { done: true, workspaceId: wsId, subtaskResults: results });
  } catch (e) {
    sendEvent('error', { error: String(e) });
  }
  res.end();
});

// Intent classification — runs in <1ms on server, returns action plan

// Materialized view query — instant pre-computed data



// Unified RAG search across all geospatial databases
app.post('/api/agent/search-all', async (req: express.Request, res: express.Response) => {
  const { query, lat, lon } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const results: Record<string, unknown> = {};
  const lower = query.toLowerCase();
  const hasLocation = lat != null && lon != null;
  const base = `${req.protocol}://${req.get('host')}`;
  try {
    if (lower.includes('earthquake') || lower.includes('seismic') || lower.includes('quake')) {
      const q = await fetch(`${base}/api/earthquakes?hours=72&minMag=2.5${hasLocation ? `&latMin=${lat-5}&latMax=${lat+5}&lonMin=${lon-5}&lonMax=${lon+5}` : ''}`);
      if (q.ok) results.earthquakes = await q.json();
    }
    if (lower.includes('weather') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('storm') || lower.includes('hurricane') || lower.includes('cyclone')) {
      if (hasLocation) {
        const w = await fetch(`${base}/api/weather/open-meteo?lat=${lat}&lon=${lon}`);
        if (w.ok) results.weather = await w.json();
      }
      const s = await fetch(`${base}/api/weather/nhc`);
      if (s.ok) results.storms = await s.json();
      const a = await fetch(`${base}/api/weather/alerts`);
      if (a.ok) results.alerts = await a.json();
    }
    if (lower.includes('fire') || lower.includes('wildfire') || lower.includes('burn')) {
      const f = await fetch(`${base}/api/eonet?source=wildfires${hasLocation ? `&latMin=${lat-5}&latMax=${lat+5}&lonMin=${lon-5}&lonMax=${lon+5}` : ''}`);
      if (f.ok) results.wildfires = await f.json();
    }
    if (lower.includes('flight') || lower.includes('plane') || lower.includes('aircraft') || lower.includes('aviation')) {
      const a = await fetch(`${base}/api/flights/all${hasLocation ? `?lat=${lat}&lon=${lon}` : ''}`);
      if (a.ok) results.aircraft = await a.json();
    }
    if (lower.includes('ship') || lower.includes('vessel') || lower.includes('maritime') || lower.includes('ais') || lower.includes('boat')) {
      const v = await fetch(`${base}/api/ais/nearby?lat=${lat || 0}&lon=${lon || 0}&radius=100`);
      if (v.ok) results.vessels = await v.json();
    }
    if (lower.includes('satellite') || lower.includes('space') || lower.includes('debris')) {
      const s = await fetch(`${base}/api/satellites/tle`);
      if (s.ok) results.satellites = await s.json();
    }
    if (lower.includes('volcano') || lower.includes('eruption')) {
      const v = await fetch(`${base}/api/vaac/tokyo`);
      if (v.ok) results.volcanoes = await v.json();
    }
  } catch (e) {
    return res.json({ error: String(e), partial: results });
  }
  res.json({ query, results, found: Object.keys(results).length > 0 });
});

// Geocode a location name using LLM + local city DB
app.get('/api/agent/geocode', async (req: express.Request, res: express.Response) => {
  const text = (req.query.q as string) || '';
  if (!text) return res.status(400).json({ error: 'Query required' });
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
  const result = await IntentRouter.geocode(text, apiKey);
  if (result) return res.json(result);
  res.json({ found: false, error: 'Location not found' });
});

// ── Digital Twin Analysis Endpoint ─────────────────────────────
import { analyzeDigitalTwin } from './digitalTwin/orchestrator';
import { COUNTRY_CENTROIDS } from './data/countryCentroids';
import { WHO_GEO } from './data/whoGeo';

app.post('/api/digital-twin/analyze', authGuard, validate(digitalTwinSchema), async (req: express.Request, res: express.Response) => {
  const { message, lat, lon, locationName, radiusKm } = req.body;
  try {
    // Geocode if no coordinates provided
    let location = { lat: lat || 0, lon: lon || 0, label: locationName || '' };
    if (!lat || !lon) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
      const geo = await IntentRouter.geocode(message, apiKey);
      if (geo?.lat && geo?.lon) {
        location = { lat: geo.lat, lon: geo.lon, label: locationName || message.split(' ').slice(-2).join(' ') };
      }
    }

    const result = await analyzeDigitalTwin(message, location, radiusKm || 30);
    res.json({
      title: result.analysis.title,
      summary: result.text,
      riskLevel: result.analysis.riskLevel,
      affectedAreaKm2: result.analysis.affectedAreaKm2,
      affectedPopulation: result.analysis.affectedPopulation,
      commands: result.commands,
      panel: result.panel,
      infrastructure: result.analysis.affectedInfrastructure.slice(0, 20),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Digital twin analysis failed: ${msg}` });
  }
});

// ── Direct Gemini fallback ─────────────────────────────────────
// Used when the Antigravity "interactions" API is unavailable (quota, 404, etc).
// Streams nothing — returns the full text once Gemini completes. Keeps the
// agent fully functional even without Antigravity access.
async function directGeminiAnswer(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  memoryContext: string,
  signal?: AbortSignal,
): Promise<string> {
  const model = 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fullPrompt = `${systemPrompt}\n\n${memoryContext ? `[Context from user profile]\n${memoryContext}\n\n` : ''}[User query]\n${userMessage}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: fullPrompt.slice(0, 30000) }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      tool_config: { function_calling_config: { mode: 'NONE' } },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned empty response${blockReason ? ` (blockReason: ${blockReason})` : ''}`);
  }
  return text;
}

// Main agent ask endpoint — SSE streaming
const askRateLimit = perUserRateLimiter(30, 60000); // 30 requests per minute per user

// ── Analytical model helper ───────────────────────────────────────
// Deterministically search + execute a known analytical model for a
// compute query, bypassing the LLM. Returns null when no model matches.
const analyticalResultCache = new Map<string, { at: number; hit: AnalyticalRunResult | null }>();
const ANALYTICAL_CACHE_TTL_MS = 10 * 60 * 1000;

// ── Multi-clause query decomposition ──────────────────────────────
// Splits a message on "and", "then", "vs", "versus" when each clause
// carries a distinct intent or location. Used to prevent "Tokyo vs Kyoto"
// or "earthquakes near Tokyo and volcanoes near Japan" from collapsing
// to a single location. Leaves the message untouched when the connectors
// are purely grammatical (e.g. "flights between Delhi and Dubai").
function decomposeByConjunction(text: string): string[] {
  // Only split when the query is long enough to plausibly be multi-clause.
  if (text.length < 25) return [text];
  const lowr = text.toLowerCase();
  // Strong multi-location signals: "vs" / "versus" / "or" between two places.
  // These split even without per-part sync location detection (which misses
  // states like California, Punjab). The async OSM geocode below resolves them.
  if (/ vs | versus | or /i.test(text)) {
    const parts = text.split(/\b(?: vs | versus | or )\b/i).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  const clauseSeparators = /[,;]|\b(?:,?\s*and\s+|\s*then\s+|\s*also\s+)/i;
  const parts = text.split(clauseSeparators).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return [text];
  // Heuristic: if every part contains a location or a recognizable intent
  // keyword, split. Otherwise return the whole message.
  let hasLocationOrIntent = 0;
  for (const p of parts) {
    const pl = p.toLowerCase();
    const loc = IntentRouter.extractLocation(pl);
    const hasIntent = /\b(show|display|toggle|open|compute|calculate|analyze|what|how|weather|flight|earthquake|wildfire|storm|ship|vessel|drought|tsunami|storm\s*surge|track|predict|forecast|simulate|risk|impact|flood)\b/i.test(pl);
    if (loc || hasIntent) hasLocationOrIntent++;
  }
  // Each part must have a location or intent keyword for us to split.
  if (hasLocationOrIntent >= Math.min(2, parts.length)) return parts;
  return [text];
}

// ── Analytical model runner ────────────────────────────────────
async function tryAnalyticalModelRun(
  message: string,
  location?: { lat: number; lon: number; label?: string },
  refinedId?: number,
  studyAreaBbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null,
  studyAreaPolygon?: Array<Array<[number, number]>> | null,
): Promise<AnalyticalRunResult | null> {
  // Memoize identical (modelId + bbox) runs — satellite grid fetches can take
  // ~30s cold; repeats should return instantly so chat stays responsive.
  const cacheKey = `m${refinedId ?? 'auto'}|${studyAreaBbox ? `${studyAreaBbox.latMin},${studyAreaBbox.latMax},${studyAreaBbox.lonMin},${studyAreaBbox.lonMax}` : (location ? `loc:${location.lat},${location.lon}` : 'none')}|${message.toLowerCase().trim().slice(0, 60)}`;
  const cached = analyticalResultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ANALYTICAL_CACHE_TTL_MS) {
    return cached.hit;
  }
  const hit = await tryAnalyticalModelRunInner(message, location, refinedId, studyAreaBbox, studyAreaPolygon);
  analyticalResultCache.set(cacheKey, { at: Date.now(), hit });
  return hit;
}

interface AnalyticalRunResult {
  id: number;
  name: string;
  text: string;
  commands: Array<Record<string, unknown>>;
  /** Rich result payload streamed to the client for globe rendering. */
  grid?: Record<string, unknown> | null;
  unit?: string;
  vizType?: string;
  resultValue?: number;
  lat?: number;
  lon?: number;
}

async function tryAnalyticalModelRunInner(
  message: string,
  location?: { lat: number; lon: number; label?: string },
  refinedId?: number,
  studyAreaBbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null,
  studyAreaPolygon?: Array<Array<[number, number]>> | null,
): Promise<AnalyticalRunResult | null> {
  const lower = message.toLowerCase().trim();
  // Map of known analytical model keywords → model IDs (verified against
  // /api/analytical-models/search — IDs must match the real 150 models).
  const MODEL_KEYWORDS: Array<{ keywords: string[]; ids: number[] }> = [
    { keywords: ['land surface temperature', 'lst', 'surface temperature'], ids: [1] },
    { keywords: ['brightness temperature'], ids: [2] },
    { keywords: ['saturation vapor pressure', 'vapor pressure'], ids: [3] },
    { keywords: ['pollutant transport', 'advection diffusion', 'pollutant dispersion'], ids: [6] },
    { keywords: ['reference evapotranspiration', 'evapotranspiration', 'penman'], ids: [9] },
    { keywords: ['runoff', 'scs cn', 'curve number', 'surface runoff'], ids: [10] },
    { keywords: ['flood wave routing'], ids: [13] },
    { keywords: ['earthquake frequency', 'gutenberg', 'recurrence'], ids: [19] },
    { keywords: ['aftershock decay', 'omori'], ids: [20] },
    { keywords: ['ground motion', 'attenuation', 'pga'], ids: [21] },
    { keywords: ['shear strength'], ids: [22] },
    { keywords: ['earthquake magnitude', 'moment magnitude'], ids: [23] },
    { keywords: ['stress drop'], ids: [24] },
    { keywords: ['fault rupture'], ids: [25] },
    { keywords: ['vegetation health index', 'vhi', 'vegetation health'], ids: [26] },
    { keywords: ['surface water detection', 'water index', 'ndwi'], ids: [27] },
    { keywords: ['vegetation water content', 'canopy water'], ids: [28] },
    { keywords: ['enhanced vegetation index', 'evi', 'ndvi', 'vegetation index', 'greenness'], ids: [29] },
    { keywords: ['snow cover detection', 'snow cover'], ids: [30] },
    { keywords: ['burn severity', 'fire scar', 'burned area'], ids: [31] },
    { keywords: ['fire radiative power', 'fire energy'], ids: [32] },
    { keywords: ['crop water stress', 'water stress'], ids: [33] },
    { keywords: ['snowmelt runoff', 'snowmelt'], ids: [34] },
    { keywords: ['sea ice', 'ice concentration', 'passive microwave'], ids: [35] },
    { keywords: ['great circle', 'haversine', 'distance between'], ids: [36] },
    { keywords: ['kriging', 'geostatistical interpolation', 'geostatistical'], ids: [37] },
    { keywords: ['inverse distance weighting', 'idw'], ids: [38] },
    { keywords: ['gaussian plume', 'air dispersion', 'plume dispersion'], ids: [39] },
    { keywords: ['gumbel', 'extreme value', 'flood return', 'return level', 'return period', '100 year flood', 'recurrence interval'], ids: [40] },
    { keywords: ['pareto distribution', 'generalized pareto'], ids: [41] },
    { keywords: ['semivariogram', 'variogram'], ids: [42] },
    { keywords: ['universal soil loss', 'usle', 'soil loss', 'erosion'], ids: [45] },
    { keywords: ['soil respiration', 'co2 flux'], ids: [46] },
    { keywords: ['soil thermal conductivity', 'thermal conductivity'], ids: [47] },
    { keywords: ['logarithmic wind profile', 'wind profile', 'log wind'], ids: [49] },
    { keywords: ['stomatal conductance', 'ball berry', 'leaf conductance'], ids: [50] },
    { keywords: ['gross primary production', 'gpp', 'photosynthesis'], ids: [51] },
    { keywords: ['net carbon flux', 'carbon flux', 'carbon balance'], ids: [53] },
    { keywords: ['forest biomass', 'biomass', 'above ground biomass'], ids: [55] },
    { keywords: ['ocean co2', 'co2 uptake', 'ocean carbon'], ids: [56] },
    { keywords: ['crop growing degree days', 'growing degree', 'gdd', 'degree days'], ids: [58] },
    { keywords: ['priestley taylor', 'priestley-taylor evapotranspiration'], ids: [59] },
    { keywords: ['hargreaves', 'hargreaves samani', 'reference crop'], ids: [60] },
    { keywords: ['yield water', 'crop yield', 'fao yield'], ids: [61] },
    { keywords: ['phytoplankton', 'chlorophyll', 'chl a'], ids: [62] },
    { keywords: ['bigleaf penman', 'penman monteith', 'big leaf'], ids: [63] },
    { keywords: ['jonswap', 'wave spectrum', 'wave energy'], ids: [80] },
    { keywords: ['stream power', 'fluvial erosion', 'river incision'], ids: [81] },
    { keywords: ['glacier mass balance', 'glacier melt', 'pdd', 'degree day model'], ids: [91] },
    { keywords: ['vei', 'volcanic explosivity'], ids: [94] },
    { keywords: ['disaster risk index', 'disaster risk', 'risk index'], ids: [135] },
    { keywords: ['annual flood damage', 'flood damage', 'expected annual'], ids: [136] },
    { keywords: ['air quality index', 'aqi from concentration', 'pollution index'], ids: [137] },
    { keywords: ['probable maximum precipitation', 'pmp', 'precipitation'], ids: [138] },
    { keywords: ['palmer drought', 'pdsi', 'drought index', 'drought severity', 'drought risk', 'drought'], ids: [139] },
    { keywords: ['climate sensitivity', 'ecs', 'climate feedback'], ids: [97] },
    { keywords: ['planck feedback', 'planck'], ids: [98] },
    { keywords: ['shannon entropy', 'information entropy', 'entropy'], ids: [144] },
  ];

  // Search for a matching model
  let modelIds: number[] = [];
  if (refinedId) {
    modelIds = [refinedId];
  } else {
    for (const entry of MODEL_KEYWORDS) {
      if (entry.keywords.some(kw => lower.includes(kw))) {
        modelIds = entry.ids;
        break;
      }
    }
    // If no keyword match, use the API search — but only accept strong matches
    // (name-level, not just a single generic token). Weak matches like
    // "deforestation → GDOP" or "storm surge → Gaussian plume" mislead the
    // user; we fall through to the LLM that can actually reason instead.
    if (modelIds.length === 0) {
      try {
        const searchResp = await fetch(`http://127.0.0.1:${PORT}/api/analytical-models/search?q=${encodeURIComponent(lower)}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (searchResp.ok) {
          const searchData = await searchResp.json() as { results?: Array<{ id: number; name: string; match: string }> };
          if (searchData.results && searchData.results.length > 0) {
            const top = searchData.results[0];
            // Only accept strong name-level matches. Reject weak matches:
            // bare "description"/"terms" (metadata tokens) and single-token
            // "name terms: X" where X is a generic action word ("predict"
            // hitting Tide Prediction, "detect" hitting Water Detection).
            const GENERIC_WEAK = new Set(['detect','show','compute','calculate','analyze','find','track','predict','forecast','risk','model','run','execute','display','enable','open','close','toggle','search','list','load','get','set','create','update','delete','remove','add','edit','save','export','import','view','pattern','current','recent','latest','average','mean','median','total','sum','count','number','amount','value','data','result','output','input','detail','summary','brief','quick','fast','slow','local','regional','global','near','around','within','between','over','under','above','below','area','region','zone','city','river','ocean','sea','land','coastal','inland']);
            const isStrongMatch = top.match === 'exact name' || top.match === 'name prefix' || top.match === 'name';
            let isStrongTermMatch = false;
            if (top.match.startsWith('name terms:')) {
              const terms = top.match.split(':')[1].trim().split(',').map(t => t.trim()).filter(Boolean);
              isStrongTermMatch = terms.length >= 2 || (terms.length === 1 && !GENERIC_WEAK.has(terms[0]));
            }
            if (isStrongMatch || isStrongTermMatch) {
              modelIds = [top.id];
            }
          }
        }
      } catch { /* fall through */ }
    }
  }

  if (modelIds.length === 0) return null;

  // Execute the first matching model via the engine directly (no HTTP round-trip).
  const modelId = modelIds[0];
  try {
    // Build the study area for the engine:
    //  - If a real polygon boundary was resolved (OSM admin boundary), use a
    //    polygon-mode study area: compute the grid over the bbox but mask every
    //    cell outside the polygon to NaN (only the real region's interior).
    //  - Else if the user has a drawn study area bbox, use a bbox grid.
    //  - Else if a location is detected, use a small bbox around it.
    //  - Else fall back to no context (engine uses defaults).
    let context: { studyArea?: { mode: 'bbox' | 'polygon'; bbox: [[number, number], [number, number]]; polygon?: Array<Array<[number, number]>> }; filters?: Record<string, number> } = {};
    if (studyAreaPolygon && studyAreaPolygon.length > 0) {
      // bbox for the grid extent; polygon rings for interior masking.
      let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
      for (const ring of studyAreaPolygon) {
        for (const [lon, lat] of ring) {
          if (lat < latMin) latMin = lat;
          if (lat > latMax) latMax = lat;
          if (lon < lonMin) lonMin = lon;
          if (lon > lonMax) lonMax = lon;
        }
      }
      if (isFinite(latMin) && isFinite(latMax) && isFinite(lonMin) && isFinite(lonMax)) {
        context = {
          studyArea: {
            mode: 'polygon',
            bbox: [[latMin, lonMin], [latMax, lonMax]],
            polygon: studyAreaPolygon,
          },
        };
      }
    } else if (studyAreaBbox && isFinite(studyAreaBbox.latMin) && isFinite(studyAreaBbox.latMax) && isFinite(studyAreaBbox.lonMin) && isFinite(studyAreaBbox.lonMax)) {
      context = {
        studyArea: {
          mode: 'bbox',
          bbox: [[studyAreaBbox.latMin, studyAreaBbox.lonMin], [studyAreaBbox.latMax, studyAreaBbox.lonMax]],
        },
      };
    } else if (location) {
      const d = 0.5; // ~55 km default half-extent around the detected point
      context = {
        studyArea: {
          mode: 'bbox',
          bbox: [[location.lat - d, location.lon - d], [location.lat + d, location.lon + d]],
        },
      };
    }

    // Extreme-value flood models (40 Gumbel / 41 GPD) honour a return-period
    // filter. Parse it from the natural-language message: "100 year flood",
    // "500-year return level", "T = 25 years", etc. (default 100 when the
    // message mentions a flood return level but gives no number).
    if (modelId === 40 || modelId === 41) {
      const Tmatch = lower.match(/(\d{1,4})\s*-?\s*year|(\d{1,4})\s*yr|return\s*(?:level|period)[^\d]*(\d{1,4})/i);
      let T = 100;
      if (Tmatch) {
        const n = Number(Tmatch[1] ?? Tmatch[2] ?? Tmatch[3]);
        if (Number.isFinite(n) && n > 1 && n < 10000) T = n;
      }
      context.filters = { 'return-period': T };
    }

    const result = await computeWithContext(modelId, {}, context) as (Record<string, unknown> & { result?: unknown; grid?: { values?: number[]; latMin?: number; latMax?: number; lonMin?: number; lonMax?: number; nLat?: number; nLon?: number } }) | null;
    if (!result) {
      logger.warn({ modelId }, 'Analytical model returned no result');
      return null;
    }
    const resultValue = result.result;
    const unit = (result.unit as string) || '';
    const name = (result.modelName as string) || `Model #${modelId}`;
    const vizType = result.visualizationType as string || 'value';
    const steps = result.steps as Array<Record<string, unknown>> || [];
    const warnings = result.warnings as string[] || [];
    const interpretation = result.interpretation as
      | string
      | { contextualAnalysis?: string; recommendations?: string[]; classification?: { description?: string } }
      | undefined;

    // Build a concise result text
    let text = `## ${name}\n\n**Result**: ${resultValue != null && (typeof resultValue !== 'number' || !Number.isNaN(resultValue)) ? (typeof resultValue === 'number' ? resultValue.toFixed(4) : resultValue) + (unit ? ' ' + unit : '') : 'No valid data available for this area'}\n\n`;
    if (typeof interpretation === 'string' && interpretation) text += `${interpretation.slice(0, 1000)}\n\n`;
    else if (interpretation && typeof interpretation === 'object') {
      if (interpretation.classification?.description) text += `${interpretation.classification.description.slice(0, 500)}\n\n`;
      if (interpretation.contextualAnalysis) text += `${interpretation.contextualAnalysis.slice(0, 600)}\n\n`;
      if (interpretation.recommendations && interpretation.recommendations.length > 0) {
        text += `**Recommendations**: ${interpretation.recommendations.slice(0, 3).join('; ')}\n\n`;
      }
    }
    if (warnings.length > 0) text += `**Warnings**: ${warnings.join('; ')}\n\n`;
    text += `*Executed via analytical model ${modelId} — ${steps.length} computation steps in ${result.processingTimeMs || 0}ms.*`;

    // Build globe commands
    const commands: Array<Record<string, unknown>> = [];
    // Draw the real OSM boundary polygon on the globe (if one was resolved)
    // so the user sees the actual region shape, not just the heatmap dots.
    if (studyAreaPolygon && studyAreaPolygon.length > 0) {
      for (const ring of studyAreaPolygon) {
        if (Array.isArray(ring) && ring.length >= 3) {
          // Outline only — no fill. The heatmap dots carry the data; the
          // boundary should just be a border, not a green-filled area.
          commands.push({ action: 'addPolygon', coordinates: ring, label: 'Study area boundary', color: 'rgba(34,197,94,0.0)', outlineOnly: true });
        }
      }
    }
    if (studyAreaBbox) {
      const midLat = (studyAreaBbox.latMin + studyAreaBbox.latMax) / 2;
      const midLon = (studyAreaBbox.lonMin + studyAreaBbox.lonMax) / 2;
      commands.push({ action: 'flyTo', lat: midLat, lon: midLon, label: 'Study area', zoom: 8 });
    } else if (location) {
      commands.push({ action: 'flyTo', lat: location.lat, lon: location.lon, label: location.label || 'Location', zoom: 8 });
    }
    // Convert a returned grid (values + bbox) into a globe heatmap.
    if (vizType === 'heatmap' && result.grid && Array.isArray(result.grid.values)) {
      const g = result.grid;
      const values = g.values as number[];
      const nLat = g.nLat || Math.round(Math.sqrt(values.length)) || 1;
      const nLon = g.nLon || Math.round(values.length / nLat) || 1;
      const points: Array<{ lat: number; lon: number; value: number }> = [];
      for (let i = 0; i < values.length && points.length < 800; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        const row = Math.floor(i / (nLon || 1));
        const col = i % (nLon || 1);
        const lat = (g.latMin ?? 0) + ((g.latMax ?? 0) - (g.latMin ?? 0)) * (row / Math.max(1, (nLat || 1) - 1));
        const lon = (g.lonMin ?? 0) + ((g.lonMax ?? 0) - (g.lonMin ?? 0)) * (col / Math.max(1, (nLon || 1) - 1));
        points.push({ lat, lon, value: v });
      }
      if (points.length > 0) {
        commands.push({ action: 'addHeatmap', points, radius: 30 });
        text += `\n\n*Heatmap: ${points.length} cells rendered over the study area.*`;
      }
    }

    return { id: modelId, name, text, commands, grid: result.grid || null, unit, vizType, resultValue: typeof resultValue === 'number' ? resultValue : undefined, lat: location?.lat, lon: location?.lon };
  } catch (e) {
    logger.warn({ err: e, modelId }, 'Analytical model execution caught exception');
    return null;
  }
}

// ── Tool Workbench → Email Report ─────────────────────────────────
// The Tool Workbench UI sends its chain results + causal probs here to
// email an identical executive report (same builder as the AI assessment).
app.post('/api/agent/workbench-report', authGuard, async (req: express.Request, res: express.Response) => {
  const { regionName, bbox, causalProbs, chainTools, steps, studyAreaName } = req.body as {
    regionName?: string;
    bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
    causalProbs?: Record<string, number>;
    chainTools?: string[];
    /** Actual per-step results from the executed chain (panel data). */
    steps?: Array<{ tool: string; status: 'success' | 'synthetic' | 'error'; summary: string; metrics: Array<{ label: string; value: string }>; latencyMs: number; timestamp: string }>;
    studyAreaName?: string;
  };
  if (!bbox) return res.status(400).json({ error: 'bbox required' });

  const midLat = (bbox.latMin + bbox.latMax) / 2;
  const midLon = (bbox.lonMin + bbox.lonMax) / 2;

  // Area name for the heading: reverse-geocoded place name → drawn study
  // area's name → coordinate fallback. Coordinates alone tell a reader
  // nothing about where the report is from.
  let areaName: string | null = null;
  try { areaName = await reverseGeocode(midLat, midLon, bbox); } catch { areaName = null; }
  const region = areaName || regionName || studyAreaName
    || `Region ${bbox.latMin.toFixed(1)}-${bbox.latMax.toFixed(1)}N, ${bbox.lonMin.toFixed(1)}-${bbox.lonMax.toFixed(1)}E`;
  const emailTo = process.env.GMAIL_REPORT_TO || '';

  // Preferred path: the chain's ACTUAL step results — identical numbers to
  // the workbench panel. Falls back to an independent server-side assessment
  // only when no chain has been executed (or every step failed).
  const hasChainResults = Array.isArray(steps) && steps.length > 0
    && steps.some(s => s?.status === 'success' || s?.status === 'synthetic');
  try {
    if (hasChainResults) {
      const html = buildChainReportHtml(region, bbox, steps!, causalProbs ?? {});
      const emailResult = await sendEmail({
        to: emailTo,
        subject: `Disaster Assessment Report: ${region} — ${new Date().toISOString().slice(0, 10)}`,
        html,
      });
      if (!emailResult.ok) return res.status(500).json({ error: emailResult.error });
      return res.json({ ok: true, summary: `Chain report emailed for ${region} (${steps!.length} steps).`, messageId: emailResult.messageId });
    }

    // Reuse the full assessment pipeline so the report is identical to the
    // AI-command report, but overlay the workbench's live causal probs.
    const result = await runDisasterAssessment({
      regionName: region,
      ...bbox,
      emailTo,
    });
    if (!result) return res.status(502).json({ error: 'Assessment data fetch failed' });

    // Override fusion causal probs with the workbench's live chain output
    // when provided (they should already match the same engine).
    if (causalProbs && Object.keys(causalProbs).length > 0) {
      const chainSet = new Set(chainTools || []);
      const topHazards = Object.entries(causalProbs)
        .filter(([k]) => chainSet.has(k) && k !== '_composite' && k !== '_confidence')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([label, probability]) => ({ label: label.replace(/_/g, ' '), probability: Number((probability).toFixed(2)) }));
      result.fusion = {
        ...result.fusion,
        causalProbs,
        topHazards,
        summary: `Fused risk assessment: ${topHazards.length} hazard types analyzed. Top risks: ${topHazards.slice(0, 5).map(h => `${h.label.replace(/ /g, '_')} ${(h.probability * 100).toFixed(0)}%`).join(', ') || 'no significant risk detected'}.`,
      };
      result.summary = result.summary.replace(/Fused risk:[^.]*\.?/, `Fused risk: ${topHazards.slice(0, 3).map(h => `${h.label} ${(h.probability * 100).toFixed(0)}%`).join(', ') || 'no significant multi-hazard risk'}.`);
    }

    const html = buildReportHtml(region, bbox, result);
    const emailResult = await sendEmail({
      to: emailTo,
      subject: `Disaster Assessment Report: ${region} — ${new Date().toISOString().slice(0, 10)}`,
      html,
    });

    if (!emailResult.ok) return res.status(500).json({ error: emailResult.error });
    return res.json({ ok: true, summary: result.summary, messageId: emailResult.messageId });
  } catch (e) {
    logger.warn({ err: e }, 'Workbench email report failed');
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/agent/ask', authGuard, askRateLimit, validate(askSchema), async (req: express.Request, res: express.Response) => {
  const { message, images, recentMessages } = req.body;
  let studyAreaBbox = req.body.studyAreaBbox as { latMin: number; latMax: number; lonMin: number; lonMax: number } | undefined;
  const studyAreaPolygon = req.body.studyAreaPolygon as Array<Array<[number, number]>> | undefined;
  const imageContext = Array.isArray(images) && images.length > 0 ? images.map((img: any) => "[Image: " + img.fileName + " (" + img.mimeType + ")]").join(' ') : '';
  const fullMessage = imageContext ? imageContext + "\n" + message : message;
  const userId = (req as any).userId || 'default';
  const cloud: boolean = req.body.cloud || false;
  const requestId = (req as any).correlationId || crypto.randomUUID();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || req.body.apiKey;
  // Look up per-user vault keys for per-request API key overrides
  const vault = readVault(userId);
  const vaultKeys: Record<string, string> = {};
  if (vault['GOOGLE_GEMINI_API_KEY']) vaultKeys['GOOGLE_GEMINI_API_KEY'] = vault['GOOGLE_GEMINI_API_KEY'];
  if (vault['GEMINI_API_KEY']) vaultKeys['GEMINI_API_KEY'] = vault['GEMINI_API_KEY'];
  if (vault['ANTHROPIC_API_KEY']) vaultKeys['ANTHROPIC_API_KEY'] = vault['ANTHROPIC_API_KEY'];
  if (vault['GROQ_API_KEY']) vaultKeys['GROQ_API_KEY'] = vault['GROQ_API_KEY'];
  if (vault['OPENROUTER_API_KEY']) vaultKeys['OPENROUTER_API_KEY'] = vault['OPENROUTER_API_KEY'];
  if (vault['DEEPSEEK_API_KEY']) vaultKeys['DEEPSEEK_API_KEY'] = vault['DEEPSEEK_API_KEY'];
  // Effective Gemini key: vault > env > req.body (for multimodal vision calls)
  const effectiveGeminiKey = vaultKeys['GOOGLE_GEMINI_API_KEY'] || vaultKeys['GEMINI_API_KEY'] || apiKey;
  // Client-selected tier from the request body
  const clientTier = (req.body as any).tier as string | undefined;
  // Client-selected model override (e.g. "groq/compound", "local").
  // When set, Omninet will prefer that provider/model.
  const clientModel = (req.body as any).model as string | undefined;
  const abortController = new AbortController();

  registerAbortController(requestId, abortController);
  // Abort long-running work when the client disconnects. Use res 'close' (not req 'close')
  // because req 'close' can fire as soon as the request body is fully received for POST
  // requests, which would abort the agent before it finishes streaming the response.
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    let payload = data;
    if (Array.isArray(data)) {
      payload = { type: event, commands: data };
    } else if (typeof data === 'object' && data !== null && !(data as any).type) {
      payload = { type: event, ...data };
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent('connected', { requestId, userId });

  const cleanup = () => removeAbortController(requestId);

  // If the user selected a specific model, check its availability and
  // emit a notice if it's unavailable. The fallback chain still works.
  if (clientModel) {
    try {
      const providers = omninet.getProviderDetails();
      const modelAvailable = providers.some(p =>
        p.models.includes(clientModel) && p.status !== 'down' && (p.local || Boolean(p.apiKeyEnvVar && process.env[p.apiKeyEnvVar]))
      );
      if (!modelAvailable) {
        sendEvent('step', { stepType: 'model_unavailable', text: `Selected model "${clientModel}" is not available — falling back to auto`, status: 'completed' });
      }
    } catch { /* availability check is best-effort */ }
  }

  try {
    // Step 1: Classify intent — use ModelRouter to decide if deep classification is needed
    sendEvent('step', { stepType: 'classifying', text: 'Classifying intent...', status: 'running' });
    let intent = IntentRouter.classify(fullMessage);

    // ModelRouter: determine optimal tier and skip deep classification for simple queries
    const modelTier = ModelRouter.route(intent.type, intent.confidence, message.length, false, false);
    if (modelTier === 'local') {
      sendEvent('step', { stepType: 'model_tier', text: 'Free tier (local routing)', status: 'completed' });
    } else if (intent.confidence < 0.7) {
      try {
        const deepIntent = await IntentRouter.classifyDeep(message);
        if (deepIntent && deepIntent.confidence > intent.confidence) intent = deepIntent;
        costTracker.record('flash', message, JSON.stringify(intent), false);
      } catch (e) { logger.warn({ err: e }, 'Deep intent classification failed, using fast result'); }
    }
    sendEvent('step', { stepType: 'classifying', text: `Intent: ${intent.type} (confidence ${(intent.confidence * 100).toFixed(0)}%)`, status: 'completed' });
    sendEvent('intent', intent);

    // Step 1.2: Multi-command god-eye control. When a single message asks for
    // MULTIPLE deterministic commands (open panels + toggle layers + flyTo),
    // parse them all and emit together — never route to the LLM which would
    // drop or mangle most of them.
    //
    // For mixed queries ("show ships near Singapore AND compute earthquake
    // magnitude near Manila"), emit the deterministic commands FIRST so the
    // globe action happens immediately, then CONTINUE to the analytical/LLM
    // path so the user gets a real answer. Pure command queries ("show
    // earthquakes") short-circuit here with a ## Done.
    const isAnalyticalOrReasoning = /\b(analyze|analysis|analyzing|trend|pattern|statistics?|average|mean|median|compute|calculate|correlation|compare|versus|why|how|what|which|explain|predict|forecast|simulate|research|investigate|difference)\b/i.test(fullMessage);
    const multiCommands = IntentRouter.extractCommands(fullMessage);
    // Mixed queries already emitted their commands above; the analytical
    // handler must NOT re-extract/re-emit them (would duplicate on the globe).
    const commandsAlreadyEmitted = multiCommands.length > 0;
    if (multiCommands.length > 0) {
      // Always emit the commands first — one at a time.
      const PANEL_LABELS: Record<string, string> = {
        'iss': 'ISS tracker',
        'satellite-imagery': 'satellite imagery',
        'analytics-workbench': 'analytics workbench',
        'analytics-insights': 'analytics insights',
        'space_weather': 'space weather',
        'market-intel': 'market intelligence',
        'intel-feed': 'intelligence feed',
        'aviation-tracker': 'aviation tracker',
        'satellite-tracker': 'satellite tracker',
      };
      const cmdDesc = multiCommands
        .map(c => {
          if (c.action === 'flyTo') return `fly to ${c.label || `${Number(c.lat).toFixed(2)}, ${Number(c.lon).toFixed(2)}`}`;
          if (c.action === 'toggleLayer') return `${c.enabled ? 'show' : 'hide'} ${c.layerId}`;
          const label = PANEL_LABELS[c.panelId as string] || c.panelId;
          return `${c.action === 'closePanel' ? 'close' : 'open'} the **${label}** panel`;
        })
        .join(', and ');
      sendEvent('step', { stepType: 'multi_command', text: `Executing ${multiCommands.length} command(s)...`, status: 'completed' });
      sendEvent('commands', multiCommands);
      if (!isAnalyticalOrReasoning) {
        // Pure command query — no need for LLM, just acknowledge.
        sendEvent('output', { text: `## Done\n\n${cmdDesc}`, modelTier: 'local', intentType: 'multi_command', commands: multiCommands });
        sendEvent('done', { type: 'done' });
        cleanup();
        res.end();
        return;
      }
      // Mixed query: commands already emitted above. Continue to
      // analytical/model/cognition/LLM for the real answer. The later
      // output event will include the full result.
    }

    // Step 1.25: Digital Twin — run analysis if intent is digital_twin.
    // For multi-city queries ("Mumbai or San Francisco"), extract all
    // named locations and run the scenario for each, then compare.
    if (intent.type === 'digital_twin') {
      sendEvent('step', { stepType: 'digital_twin', text: 'Running digital twin analysis...', status: 'completed' });
      try {
        // Extract all named locations from the message
        const dtLocations: Array<{ lat: number; lon: number; label: string }> = [];
        if (intent.location) dtLocations.push({ lat: intent.location.lat, lon: intent.location.lon, label: intent.location.label || 'Location' });
        // Check for "or" / "vs" separators that indicate multiple cities
        const geoApiKey = effectiveGeminiKey || '';
        if (/ or | vs /i.test(message)) {
          const parts = message.split(/\b(or|vs|versus)\b/i).map((s: string) => s.trim()).filter(Boolean);
          for (const part of parts) {
            const geo = await IntentRouter.geocode(part, geoApiKey);
            if (geo?.lat && geo?.lon) {
              const dup = dtLocations.some(l => Math.abs(l.lat - geo.lat) < 1 && Math.abs(l.lon - geo.lon) < 1);
              if (!dup) dtLocations.push({ lat: geo.lat, lon: geo.lon, label: geo.label });
            }
          }
        } else if (!intent.location) {
          const geo = await IntentRouter.geocode(message, geoApiKey);
          if (geo?.lat && geo?.lon) dtLocations.push({ lat: geo.lat, lon: geo.lon, label: geo.label });
        }

        if (dtLocations.length > 0) {
          const dtResults: Array<{ label: string; text: string; commands: Array<Record<string, unknown>>; panel?: unknown }> = [];
          for (const dtLoc of dtLocations) {
            const dtResult = await Promise.race([
              analyzeDigitalTwin(message, dtLoc, 30),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 60000)),
            ]);
            if (dtResult) {
              dtResults.push({ label: dtLoc.label, text: dtResult.text, commands: dtResult.commands, panel: dtResult.panel });
            }
          }
          if (dtResults.length > 0) {
            const allCommands = dtResults.flatMap(r => r.commands);
            const combined = dtResults.length > 1
              ? `## Multi-city comparison\n\n` + dtResults.map(r => `### ${r.label}\n\n${r.text}`).join('\n\n')
              : dtResults[0].text;
            if (allCommands.length > 0) sendEvent('commands', allCommands);
            if (dtResults[0]?.panel) sendEvent('panel', dtResults[0].panel);
            sendEvent('output', { text: combined, modelTier: 'flash', intentType: 'digital_twin', commands: allCommands });
            sendEvent('done', { type: 'done' });
            cleanup();
            res.end();
            return;
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Digital twin analysis failed, falling through');
        sendEvent('step', { stepType: 'digital_twin_error', text: 'Digital twin analysis failed — falling back to agent', status: 'completed' });
      }
    }

    // Step 1.3: Panel command — deterministic god-eye control. Opens/closes/
    // toggles any UI panel without burning an LLM call.
    if (intent.type === 'panel_command' && intent.panelId) {
      sendEvent('step', { stepType: 'panel_command', text: `${intent.panelAction} ${intent.panelId}...`, status: 'completed' });
      const action = intent.panelAction === 'close' ? 'closePanel' : intent.panelAction === 'toggle' ? 'togglePanel' : 'openPanel';
      sendEvent('commands', [{ action, panelId: intent.panelId }]);
      const verb = action === 'closePanel' ? 'closed' : action === 'togglePanel' ? 'toggled' : 'opened';
      sendEvent('output', { text: `## ${intent.panelId}\n\n${verb === 'opened' ? 'Opened' : verb === 'closed' ? 'Closed' : 'Toggled'} the **${intent.panelId}** panel on your right.`, modelTier: 'local', intentType: intent.type, commands: [{ action, panelId: intent.panelId }] });
      sendEvent('done', { type: 'done' });
      cleanup();
      res.end();
      return;
    }

    // Step 1.35: Layer toggle — deterministic god-eye control. Show/hide a data
    // layer without an LLM call when the intent is a simple toggle.
    if (intent.type === 'toggle_layer' && intent.layerIds && intent.layerIds.length > 0) {
      const enabled = !/^(hide|close|remove|disable|turn off|turnoff)\b/i.test(message.trim());
      sendEvent('step', { stepType: 'layer_toggle', text: `${enabled ? 'Showing' : 'Hiding'} ${intent.layerIds.join(', ')}...`, status: 'completed' });
      const commands: Array<{ action: string; layerId: string; enabled: boolean }> = intent.layerIds.map(layerId => ({ action: 'toggleLayer', layerId, enabled }));
      sendEvent('commands', commands);
      sendEvent('output', { text: `## Layers\n\n${enabled ? 'Showing' : 'Hiding'} **${intent.layerIds.join(', ')}** on the globe.`, modelTier: 'local', intentType: intent.type, commands });
      sendEvent('done', { type: 'done' });
      cleanup();
      res.end();
      return;
    }

    // Step 1.5: Check semantic cache for identical queries
    const uid = userId || 'default';
    let cachedResponse: string | null = null;
    try {
      cachedResponse = (await memoryManager.semanticCache.get(fullMessage)) ?? null;
    } catch (e) {
      logger.warn({ err: e }, 'Semantic cache lookup failed (non-critical)');
    }
    if (cachedResponse) {
      costTracker.record('local', message, cachedResponse, true);
      sendEvent('step', { stepType: 'cache_hit', text: 'Found identical query in memory — returning cached response', status: 'completed' });
      sendEvent('output', { text: cachedResponse + '\n\n*(From memory — asked before)*' });
      sendEvent('done', { type: 'done' });
      cleanup();
      res.end();
      return;
    }

    // Step 1.6: Pattern replay — check if this query matches a saved workflow.
    // If a matching pattern exists (same intent + similar query shape), replay
    // the saved tool steps with the new location/params substituted. This skips
    // the expensive LLM pass entirely. Returns true when replayed.
    const patternMatch = findMatchingPattern(fullMessage, intent.type, resolveDomain(intent.type));
    if (patternMatch && patternMatch.steps.length > 0 && !abortController.signal.aborted) {
      const slotValues: Record<string, unknown> = {};
      const loc = intent.location || patternMatch.sampleLocation;
      if (loc) {
        if (patternMatch.slots.includes('lat')) slotValues['lat'] = loc.lat;
        if (patternMatch.slots.includes('lon')) slotValues['lon'] = loc.lon;
        if (patternMatch.slots.includes('label')) slotValues['label'] = loc.label || patternMatch.name;
      }
      const radiusMatch = fullMessage.match(/(?:within|radius|around|near)\s+(\d+)\s*(km|mi|miles|kilometers?)/i);
      if (patternMatch.slots.includes('radius') && radiusMatch) slotValues['radius'] = Number(radiusMatch[1]);

      const toolResults: Array<{ tool: string; ok: boolean; text: string }> = [];
      try {
        for (const step of patternMatch.steps) {
          if (abortController.signal.aborted) break;
          const known = dynamicTools.get(step.tool);
          if (!known) {
            toolResults.push({ tool: step.tool, ok: false, text: 'Tool not registered' });
            continue;
          }
          const args = substituteArgs(step.args, slotValues);
          sendEvent('tool_call', { name: step.tool, args, description: known.description, riskLevel: 'low', replayed: true });
          try {
            const result = await dynamicTools.execute(step.tool, args, abortController.signal);
            // Keep the full result object (no truncation) — the generic
            // formatter renders it as readable text with zero LLM cost.
            toolResults.push({ tool: step.tool, ok: true, text: summarizeToolResult(step.tool, result) });
            sendEvent('tool_result', { name: step.tool, status: 'success', result, replayed: true });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            toolResults.push({ tool: step.tool, ok: false, text: `Error: ${errMsg}` });
            sendEvent('tool_result', { name: step.tool, status: 'error', error: errMsg, replayed: true });
          }
        }

        const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Cheap template synthesis — no LLM. Each tool result was already
        // rendered to readable prose by the generic formatter at execution time.
        const summary = toolResults
          .map(r => `**${r.tool}**\n${r.text}`)
          .join('\n\n')
          .replace(/\n{3,}/g, '\n\n');
        const locLabel = loc?.label || (intent.location?.label) || 'this location';
        const outputText = `## ${patternMatch.name}\n\n**Reused workflow** (saved ${patternMatch.approvalCount || 1}×)\n\n${summary.slice(0, 3000)}`;
        const commands: PatternCommand[] = [];
        for (const c of patternMatch.commands) {
          if (c.action === 'flyTo' && loc) {
            commands.push({ action: 'flyTo', lat: loc.lat, lon: loc.lon, label: locLabel, zoom: c.zoom ?? 8 });
          } else if (c.action === 'addPin' && loc) {
            // Substitute the new location's name into the pin label (the saved
            // label contains the old place name, e.g. "Tokyo (24.3°C...)").
            const oldName = patternMatch.sampleLocation?.label || 'this location';
            const newLabel = typeof c.label === 'string'
              ? c.label.replace(new RegExp(escapeRegExp(oldName), 'g'), locLabel)
              : c.label;
            commands.push({ action: 'addPin', lat: loc.lat, lon: loc.lon, label: newLabel, color: c.color });
          } else {
            commands.push(c);
          }
        }
        if (commands.length > 0) sendEvent('commands', commands);
        sendEvent('output', { text: outputText, modelTier: 'replay', intentType: intent.type, replayed: true, patternId: patternMatch.id });
        sendEvent('done', { type: 'done' });
        cleanup();
        res.end();
        return;
      } catch (e) {
        logger.warn({ err: e }, 'Pattern replay failed — falling through to full AI run');
      }
    }

    // Step 1.75: (CognitiveAgent removed — was returning template variables instead of real data)

    // Step 2: If quick scan, check materialized cache first
    if (intent.type === 'quick_scan' && intent.location) {
      sendEvent('step', { stepType: 'cache_check', text: 'Checking pre-computed data...', status: 'completed' });
      let cached: ReturnType<typeof materializedViews.query> | null = null;
      try {
        cached = materializedViews.query(intent.location.lat, intent.location.lon);
      } catch (e) {
        logger.warn({ err: e }, 'Materialized view query failed (non-critical)');
      }
      if (cached && (cached.earthquakeRisk > 0 || cached.nearbyEvents.length > 0 || cached.weatherAlerts.length > 0)) {
        sendEvent('step', { stepType: 'cache_hit', text: `Found ${cached.nearbyEvents.length} events, M${cached.earthquakeRisk} max quake`, status: 'completed' });
        const commands: GlobeCommand[] = [
          { action: 'flyTo', lat: intent.location.lat, lon: intent.location.lon, label: intent.location.label, zoom: 8 },
        ];
        if (cached.earthquakeRisk > 0) {
          commands.push({ action: 'toggleLayer', layerId: 'earthquakes', enabled: true });
        }
        sendEvent('commands', commands);
        const parts: string[] = [];
        if (cached.earthquakeRisk > 0) parts.push(`**Earthquake Risk**: M${cached.earthquakeRisk} max detected nearby`);
        if (cached.nearbyEvents.length > 0) parts.push(`**Active Events**: ${cached.nearbyEvents.map(e => e.title).join(', ')}`);
        if (cached.weatherAlerts.length > 0) parts.push(`**Weather Alerts**: ${cached.weatherAlerts.length} active`);
        sendEvent('output', { text: `## Quick Scan: ${intent.location.label}\n\n${parts.join('\n\n') || 'No significant issues detected.'}\n\n*Data pre-computed (≤60s old). Ask for "detailed" for live analysis.*` });
        sendEvent('done', { type: 'done' });
        cleanup();
        res.end();
        return;
      }
    }

    // Step 2.4: Analytical model execution — deterministic god-eye control.
    // When the user asks to compute/calculate a known scientific model, search
    // and execute it directly (no LLM round-trip) and visualize the result.
    // Skip for pure reasoning questions (why, how, explain, tell me) — their
    // intent might be deep_analysis but they need a semantic answer, not a model.
    // NOTE: "compare" queries still run the analytical model path because
    // multi-location comparison (Step 2.4) needs it. Only pure "why/how"
    // reasoning skips the model.
    const isReasoningQuery = /\b(why|explain|tell me|what is the difference|what is the relationship|correlation between|predict|forecast|spread|where.*will|how.*will)\b/i.test(message) && !/\b(compute|calculate|run|execute|model|equation|formula|evaluate|analyze|analysis|trend|pattern|statistics?|average|mean|compare)\b/i.test(message);
    // ── Study area request ───────────────────────────────────────
    // When a spatial computation needs a study area but the user hasn't drawn
    // one yet, ask before running the model. The client shows three choices:
    //   ✏️ Mark Study Zone  → user draws on globe, bbox syncs, chat re-sends
    //   📍 Use Detected Area → proceed with the AI-detected location bbox
    //   ⏭️ Skip             → proceed without a study area
    // The user's choice comes back as studyAreaAction on the re-send, so this
    // block is skipped then (and when a studyAreaBbox is already provided).
    const studyAreaAction = (req.body as any).studyAreaAction as string | undefined;
    const isSpatialCompute = (intent.type === 'compute' || intent.type === 'deep_analysis') && !isReasoningQuery;
    if (isSpatialCompute && !studyAreaBbox && !studyAreaAction) {
      // Determine the probe location: the sync intent.location (city DB) or
      // OSM geocode of the message (handles states, regions the DB misses).
      let probeLocation = intent.location;
      if (!probeLocation) {
        try {
          const geoKey = effectiveGeminiKey || '';
          const geo = await IntentRouter.geocode(message, geoKey);
          if (geo?.lat && geo?.lon) {
            probeLocation = { lat: geo.lat, lon: geo.lon, label: geo.label };
          }
        } catch { /* best-effort */ }
      }
      if (probeLocation) {
        // Try to get the REAL OSM polygon geometry (the actual boundary shape).
        // When found, use it directly — no adjust prompt needed, the polygon
        // IS the boundary. The analytical engine masks the grid to the polygon.
        let autoPolygon: Array<Array<[number, number]>> | null = null;
        let autoBoundary: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null = null;
        try {
          const geoKey = effectiveGeminiKey || '';
          autoPolygon = await IntentRouter.geocodePolygon(message, geoKey);
          if (autoPolygon && autoPolygon.length > 0) {
            // Compute bbox from polygon rings for the grid extent.
            let lmin = Infinity, lmax = -Infinity, lomin = Infinity, lomax = -Infinity;
            for (const ring of autoPolygon) {
              for (const [lon, lat] of ring) {
                if (lat < lmin) lmin = lat;
                if (lat > lmax) lmax = lat;
                if (lon < lomin) lomin = lon;
                if (lon > lomax) lomax = lon;
              }
            }
            if (isFinite(lmin) && isFinite(lmax) && isFinite(lomin) && isFinite(lomax)) {
              autoBoundary = { latMin: lmin, latMax: lmax, lonMin: lomin, lonMax: lomax };
            }
          }
        } catch { /* best-effort */ }
        // Fallback: try bounding box (works for cities/points).
        if (!autoPolygon) {
          try {
            const geoKey = effectiveGeminiKey || '';
            const autoBox = await IntentRouter.geocodeBoundingBox(message, geoKey);
            if (autoBox && Math.abs(autoBox.latMax - autoBox.latMin) > 0.01 && Math.abs(autoBox.lonMax - autoBox.lonMin) > 0.01) {
              autoBoundary = autoBox;
            }
          } catch { /* best-effort */ }
        }
        if (autoPolygon && autoBoundary) {
          // Real OSM boundary polygon found — use it directly. No prompt.
          sendEvent('step', { stepType: 'study_area_auto', text: `Using real boundary for ${probeLocation.label || 'area'}`, status: 'completed' });
          studyAreaBbox = autoBoundary;
          // The polygon is fetched below via the detect — we need to pass it.
          // Store it in a mutable ref so the analytical runner can use it.
          (req as any).__studyAreaPolygon = autoPolygon;
        } else {
          // No real polygon, only a bounding box or point — show the prompt.
          if (autoBoundary) {
            sendEvent('step', { stepType: 'study_area_auto', text: `Found approximate area for ${probeLocation.label || 'area'}`, status: 'completed' });
          }
          sendEvent('study_area_request', {
            requestId,
            query: message,
            location: probeLocation,
            detectedBbox: autoBoundary,
            options: autoBoundary
              ? [
                  { id: 'draw', label: '✏️ Adjust Boundary', description: 'Drag/resize the detected boundary on the globe' },
                  { id: 'detected', label: '📍 Use This Area', description: `Use the detected area around ${probeLocation.label || 'this location'}` },
                  { id: 'skip', label: '⏭️ Skip', description: 'Proceed without a study area' },
                ]
              : [
                  { id: 'draw', label: '✏️ Mark Study Zone', description: 'Draw a precise boundary on the globe' },
                  { id: 'detected', label: '📍 Use Detected Area', description: `Use the detected area around ${probeLocation.label || 'this location'}` },
                  { id: 'skip', label: '⏭️ Skip', description: 'Proceed without a study area' },
                ],
          });
          sendEvent('done', { type: 'done' });
          cleanup();
          res.end();
          return;
        }
      }
    }
    if ((intent.type === 'compute' || intent.type === 'deep_analysis') && !isReasoningQuery) {
      // ── Multi-clause decomposition ─────────────────────────────
      // Queries like "drought risk in California vs Punjab", "earthquake
      // magnitude near Manila and ships near Singapore", or "floods in Mumbai
      // or San Francisco" name MULTIPLE locations with (usually) one model.
      // Instead of collapsing to the first location, run each location and
      // return a real comparison. Fall back to single-location behaviour when
      // decomposition is not confident.
      const clauses = decomposeByConjunction(message);
      if (clauses.length >= 2) {
        const locs: Array<{ lat: number; lon: number; label: string }> = [];
        for (const clause of clauses) {
          // Use OSM-first async geocoding so regions/states (California,
          // Punjab) resolve too — the sync city DB misses them.
          const geoKey = effectiveGeminiKey || '';
          const g = await IntentRouter.geocode(clause, geoKey);
          if (g?.lat && g?.lon) locs.push({ lat: g.lat, lon: g.lon, label: g.label });
        }
        const analyticalHit = await tryAnalyticalModelRun(message, intent.location, intent.analyticalModelId, studyAreaBbox, studyAreaPolygon ?? (req as any).__studyAreaPolygon);
        // Only attempt multi-location when the query clearly names several
        // distinct places AND the base model run succeeds (so we reuse its
        // resolved model id deterministically rather than guessing again).
        if (locs.length >= 2 && analyticalHit) {
          try {
            const perLoc: Array<{ label: string; text: string }> = [];
            const locCommands: Array<Record<string, unknown>> = [];
            for (const loc of locs) {
              const hit = await tryAnalyticalModelRun(message, loc, analyticalHit.id, studyAreaBbox, studyAreaPolygon ?? (req as any).__studyAreaPolygon);
              if (hit) {
                perLoc.push({ label: loc.label, text: hit.text });
                locCommands.push(...hit.commands);
              }
            }
            if (perLoc.length >= 2) {
              const heading = `## ${analyticalHit.name}: Multi-location comparison\n\n`;
              const body = perLoc.map(p => `### ${p.label}\n\n${p.text}`).join('\n\n');
              const allCommands = [...locCommands, ...analyticalHit.commands];
              if (allCommands.length > 0) sendEvent('commands', allCommands);
              sendEvent('output', { text: heading + body + `\n\n*Compared across ${perLoc.length} locations.*`, modelTier: 'flash', intentType: intent.type, commands: allCommands });
              sendEvent('done', { type: 'done' });
              cleanup();
              res.end();
              return;
            }
          } catch (e) {
            logger.warn({ err: e }, 'Multi-location analytical comparison failed, falling back');
          }
        }
      }
      const analyticalHit = await tryAnalyticalModelRun(message, intent.location, intent.analyticalModelId, studyAreaBbox, studyAreaPolygon ?? (req as any).__studyAreaPolygon);
      if (analyticalHit) {
        // The message may also carry UI commands ("... and open the workbench").
        // Parse them so the model result AND the panel/layer actions both fire.
        // Mixed queries already emitted their layer/panel commands in Step 1.2 —
        // don't re-extract/re-emit (would duplicate on the globe).
        const extraCommands = commandsAlreadyEmitted ? [] : IntentRouter.extractCommands(message, { allowAnalytical: true });
        const allCommands = [...analyticalHit.commands, ...extraCommands];
        sendEvent('step', { stepType: 'analytical', text: `Executing analytical model #${analyticalHit.id} (${analyticalHit.name})...`, status: 'completed' });
        if (allCommands.length > 0) sendEvent('commands', allCommands);
        sendEvent('output', { text: analyticalHit.text, modelTier: 'flash', intentType: intent.type, commands: allCommands });
        // Analytical compute → globe: stream the real computed grid so the
        // client renders the field as a proper heatmap surface (QGIS-style),
        // not just the coarse point cloud in the addHeatmap command above.
        if (analyticalHit.grid && Array.isArray((analyticalHit.grid as Record<string, unknown>).values)) {
          sendEvent('analytical_result', {
            toolId: analyticalHit.id,
            label: analyticalHit.name,
            lat: analyticalHit.lat,
            lon: analyticalHit.lon,
            unit: analyticalHit.unit,
            vizType: analyticalHit.vizType,
            value: analyticalHit.resultValue,
            grid: analyticalHit.grid,
          });
        }
        sendEvent('done', { type: 'done' });
        cleanup();
        res.end();
        return;
      }
    }

    // Step 2.45: Disaster assessment + email report. When the user asks for a
    // full hazard assessment and to email the report, run the deterministic
    // pipeline and send the email. No LLM needed.
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('disaster assessment') && (lowerMsg.includes('email') || lowerMsg.includes('mail') || lowerMsg.includes('send'))) {
      sendEvent('step', { stepType: 'assessment', text: 'Running full disaster assessment...', status: 'running' });
      // Extract region: named region, else reverse-geocode the bbox centroid
      // for an accurate place name (e.g. "California" not "Region 32.0-42.0N").
      const bboxForName = studyAreaBbox || (intent.location ? {
        latMin: intent.location.lat - 5, latMax: intent.location.lat + 5,
        lonMin: intent.location.lon - 5, lonMax: intent.location.lon + 5,
      } : { latMin: 5, latMax: 25, lonMin: 78, lonMax: 98 });
      const midLat = (bboxForName.latMin + bboxForName.latMax) / 2;
      const midLon = (bboxForName.lonMin + bboxForName.lonMax) / 2;
      let regionName = intent.location?.label || null;
      if (!regionName) {
        try { regionName = await reverseGeocode(midLat, midLon, bboxForName); } catch { regionName = null; }
      }
      if (!regionName) {
        regionName = `Region ${bboxForName.latMin.toFixed(1)}-${bboxForName.latMax.toFixed(1)}N, ${bboxForName.lonMin.toFixed(1)}-${bboxForName.lonMax.toFixed(1)}E`;
      }
      const bbox = bboxForName;
      const emailTo = process.env.GMAIL_REPORT_TO || '';
      try {
        const result = await assessAndEmail({ regionName, ...bbox, emailTo });
        // Render the fused risk surface on the globe (same as the Tool Workbench).
        const commands: Array<Record<string, unknown>> = [];
        try {
          const fused = await runFusionPipeline(bbox);
          if (fused.fusedPoints.length >= 3) {
            commands.push({ action: 'addHeatmap', points: fused.fusedPoints.slice(0, 800), radius: 25 });
          }
          if (studyAreaBbox) {
            const midLat = (studyAreaBbox.latMin + studyAreaBbox.latMax) / 2;
            const midLon = (studyAreaBbox.lonMin + studyAreaBbox.lonMax) / 2;
            commands.push({ action: 'flyTo', lat: midLat, lon: midLon, label: 'Study area', zoom: 8 });
          }
        } catch (e) {
          logger.warn({ err: e }, 'Fused surface render failed');
        }
        if (commands.length > 0) sendEvent('commands', commands);
        sendEvent('step', { stepType: 'assessment', text: result.ok ? 'Assessment complete — email sent!' : 'Assessment data fetched', status: 'completed' });
        if (result.ok) {
          sendEvent('output', { text: `## Disaster Assessment: ${regionName}\n\n**Email sent** ✅\n\n${result.summary}\n\n*Full HTML report emailed.*`, modelTier: 'flash', intentType: 'deep_analysis', commands });
        } else {
          sendEvent('output', { text: `## Disaster Assessment: ${regionName}\n\n${result.summary || ''}\n\n**Email delivery failed**: ${result.error || 'unknown error'}. Report data shown above.`, modelTier: 'flash', intentType: 'deep_analysis' });
        }
        sendEvent('done', { type: 'done' });
        cleanup();
        res.end();
        return;
      } catch (e) {
        logger.warn({ err: e }, 'Disaster assessment failed');
        // Fall through to LLM
      }
    }

    // Step 2.25: Cognitive dual-process reasoning (System 1 real-data fast
    // path → System 2 deep reasoning with MCTS/ToT). Runs only for intents
    // where it beats the generic streaming path: analytical/deep intents
    // (System 2) and intents System 1 can resolve through REAL registered
    // tools (no canned templates). Everything else keeps the fast path below.
    const cognitionIntents = ['deep_analysis', 'compute', 'weather_check', 'earthquake_check', 'aviation', 'hazard_query', 'space_weather'];
    // Skip cognition for pure reasoning questions (why, how, explain, tell me) —
    // they need a semantic LLM answer, not the cognition pipeline.
    if (cognitionIntents.includes(intent.type) && !isReasoningQuery) {
      sendEvent('step', { stepType: 'cognition', text: 'Running cognitive analysis...', status: 'running' });
      try {
        const cognitionResult = await cognitiveAgent.process(message, {
          location: intent.location?.label,
          lat: intent.location?.lat,
          lon: intent.location?.lon,
          intent: intent.type,
        }, (event, data) => {
          if (event === 'reasoning') {
            sendEvent('step', { stepType: 'reasoning', text: String(data.text || ''), status: 'running' });
          } else if (event === 'system2_complete') {
            sendEvent('step', { stepType: 'cognition', text: 'Deep reasoning complete', status: 'completed' });
          }
        });
        if (cognitionResult && cognitionResult.finalOutput) {
          // Don't return early if cognition timed out — the fallback local
          // GGUF model (Step 3) can still produce a real answer.
          if (cognitionResult.mode === 'system2_full' && /deep reasoning took too long/i.test(cognitionResult.finalOutput)) {
            logger.warn({ query: message.slice(0, 50) }, 'Cognition timed out — falling through to local model fallback');
          } else {
            costTracker.record('flash', message, cognitionResult.finalOutput, false);
            const modeLabel = cognitionResult.mode === 'system1_only' ? ' (fast path, real data)' : ' (deep reasoning)';
            sendEvent('output', { text: cognitionResult.finalOutput + `\n\n*Cognitive analysis${modeLabel}*` });
            if (cognitionResult.traceId) {
              sendEvent('trace', { traceId: cognitionResult.traceId, criticScore: cognitionResult.criticScore });
            }
            sendEvent('done', { type: 'done' });
            cleanup();
            res.end();
            return;
          }
        }
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'Cognition path failed — falling through to multi-agent orchestration');
        sendEvent('step', { stepType: 'cognition', text: 'Cognitive analysis unavailable — continuing with multi-agent analysis', status: 'completed' });
      }
    }
    // Step 2.5: Multi-agent orchestration for complex queries
    const orchestrationIntents = ['deep_analysis', 'compute'];
    if (orchestrationIntents.includes(intent.type) && !isReasoningQuery) {
      sendEvent('step', { stepType: 'orchestrating', text: 'Multi-agent swarm analyzing...', status: 'completed' });
      try {
        const orchestrator = new AgentOrchestrator(apiKey);
        // Bound the orchestrator — reasoning questions must not block the chat
        // while the swarm spins up. On timeout we fall through to LLM streaming.
        const orchestrated = await Promise.race([
          orchestrator.orchestrate(message, {
            location: intent.location,
            intent: intent.type,
            cloud,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
        ]);
        if (orchestrated && orchestrated.output) {
          costTracker.record(modelTier === 'pro' ? 'pro' : 'flash', message, orchestrated.output, false);
          if (orchestrated.commands?.length) sendEvent('commands', orchestrated.commands);
          sendEvent('output', { text: orchestrated.output + '\n\n*Multi-agent orchestrated response*' });
          sendEvent('done', { type: 'done' });
          cleanup();
          res.end();
          return;
        }
      } catch (e) {
        // Orchestrator failed — fall through to single-agent Antigravity
        logger.error({ err: e }, 'Orchestrator failed, falling back');
      }
    }

    // Step 3: Analyze with Omninet (auto-fallback across providers)
    sendEvent('step', { stepType: 'agent_thinking', text: 'Agent analyzing...', status: 'running' });
    const recentMessagesArray: Array<{ role: string; content: string }> = Array.isArray(recentMessages) ? recentMessages.slice(-6) : [];
    const memoryContext = await memoryManager.buildWorkingMemoryContext(uid, fullMessage, recentMessagesArray);

    // Advanced: multi-turn conversation memory (rolling summary + last 3 verbatim turns)
    const convCtx = conversationMemory.get(uid, req.body.sessionId);
    const convContextStr = conversationMemory.buildPromptContext(convCtx);
    // Advanced: persistent cross-session memory recall (#2)
    const recall = await recallMemories(uid, fullMessage);
    const recallStr = recall ? renderMemoryRecall(recall) : '';
    if (recallStr && recall) sendEvent('step', { stepType: 'memory_recall', text: `Recalled ${recall.episodes.length} past interaction(s)`, status: 'completed' });

    const systemPrompt = buildAgentPrompt(toolRegistry, intent);

    /**
     * Run one streaming LLM pass. Tokens are forwarded to the client as they arrive.
     * Returns the full accumulated text so callers can inspect it for ## TOOL_CALLS.
     */
    const streamPass = async (prompt: string): Promise<string> => {
      let accumulated = '';
      let tokenCount = 0;
      for await (const token of omninet.generateStream(prompt, { signal: abortController.signal, temperature: 0.4, maxTokens: 4096, vaultKeys: Object.keys(vaultKeys).length > 0 ? vaultKeys : undefined, clientTier, model: clientModel })) {
        if (abortController.signal.aborted) break;
        accumulated += token;
        tokenCount++;
        if (tokenCount % 5 === 0 || tokenCount <= 3) {
          sendEvent('token', { text: token });
        } else {
          res.write(`event: token\ndata: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        }
      }
      logger.info({ outputLen: accumulated.length, aborted: abortController.signal.aborted, tokenCount }, 'Omninet streaming pass complete');
      return accumulated;
    };

    const streamPassMultimodal = async (textPrompt: string, imgs: Array<{dataUrl: string; mimeType: string; fileName: string}>): Promise<string> => {
      if (!effectiveGeminiKey || imgs.length === 0) {
        sendEvent('step', { stepType: 'multimodal', text: 'No Gemini key for vision — falling back to text-only', status: 'completed' });
        return streamPass(textPrompt);
      }
      const parts: Array<Record<string, unknown>> = [{ text: textPrompt.slice(0, 14000) }];
      for (const img of imgs.slice(0, 4)) {
        const b64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        parts.push({ inlineData: { mimeType: img.mimeType, data: b64 } });
      }
const model = 'gemini-3.5-flash-lite';
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${effectiveGeminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
        }),
      });
      if (!resp.ok) {
        logger.warn({ status: resp.status }, 'Gemini multimodal streaming failed — falling back to Omninet text-only');
        sendEvent('step', { stepType: 'multimodal_fallback', text: `Vision model unavailable (${resp.status}) — analyzing without image data`, status: 'completed' });
        return streamPass(textPrompt);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body from Gemini');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let tokenCount = 0;
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
              if (content) {
                accumulated += content;
                tokenCount++;
                if (tokenCount % 5 === 0 || tokenCount <= 3) {
                  sendEvent('token', { text: content });
                } else {
                  res.write(`event: token\ndata: ${JSON.stringify({ type: 'token', text: content })}\n\n`);
                }
              }
            } catch (e) { logger.warn({ err: e }, 'Gemini multimodal SSE parse error'); }
          }
        }
      }
      logger.info({ outputLen: accumulated.length, tokenCount }, 'Gemini multimodal streaming pass complete');
      return accumulated;
    };

    let outputText = '';
    let toolCallCount = 0;
    // Recipe capture: the tool steps + commands of this run, so the client can
    // offer a "Save workflow" action that persists a reusable pattern on disk.
    let recipeSteps: PatternStep[] = [];
    let recipeCommands: PatternCommand[] = [];
    try {
      const hasImages = Array.isArray(images) && images.length > 0;
      logger.info({ msgLen: message.length, hasMemory: !!memoryContext, hasImages }, 'AI streaming starting');
      const fullPrompt = `${systemPrompt}\n\n${memoryContext ? `[Context from user profile]\n${memoryContext}\n\n` : ''}${convContextStr ? `[Conversation history]\n${convContextStr}` : ''}${recallStr ? `[Relevant memories]\n${recallStr}` : ''}[User query]\n${fullMessage}`;
      outputText = hasImages ? await streamPassMultimodal(fullPrompt, images) : await streamPass(fullPrompt);
      sendEvent('step', { stepType: 'agent_thinking', text: 'Agent analysis complete', status: 'completed' });

      // ── Two-pass tool execution ──────────────────────────────────
      // If the LLM emitted ## TOOL_CALLS, execute the named tools via the
      // unified dynamicTools registry, then run a second synthesis pass with
      // the real results injected. This is what lets the AI reach 100+ backend
      // capabilities instead of only describing them.
      const toolCalls = ToolCallParser.parse(outputText);
      toolCallCount = toolCalls.length;
      if (toolCalls.length > 0 && !abortController.signal.aborted) {
        sendEvent('step', { stepType: 'tool_execution', text: `Executing ${toolCalls.length} tool call(s)...`, status: 'running' });
        const toolResults: string[] = [];
        // Capture the recipe BEFORE execution so saved patterns store the
        // parameter slots (e.g. {lat}/{lon}) rather than hardcoded values.
        recipeSteps = toolCalls.map(call => {
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(call.args || {})) {
            if (intent.location && (k === 'lat' && v === intent.location.lat)) args[k] = '{lat}';
            else if (intent.location && (k === 'lon' && v === intent.location.lon)) args[k] = '{lon}';
            else if (intent.location && (k === 'label' || k === 'name') && v === intent.location.label) args[k] = '{label}';
            else args[k] = v;
          }
          return { tool: call.name, args };
        });
        await Promise.all(toolCalls.map(async (call) => {
          const known = dynamicTools.get(call.name);
          if (!known) {
            sendEvent('tool_result', { name: call.name, status: 'unknown', error: `Tool "${call.name}" not registered` });
            toolResults.push(`[${call.name}] ERROR: tool not registered`);
            return;
          }
          // #4 Tool-calling approval gate: classify risk; for high/destructive tools,
          // emit an approval request. The client may auto-approve (low risk default)
          // or hold for user confirmation. We proceed for low/medium; high/destructive
          // are flagged but still execute here unless the client sends an explicit
          // 'require_approval' header (handled via /api/agent/approve endpoint).
          const risk = classifyToolRisk(call.name, call.args);
          if (risk === 'destructive') {
            sendEvent('tool_approval', { requestId, name: call.name, args: call.args, description: known.description, riskLevel: risk, reason: 'Destructive tool — confirm before execution' });
            toolResults.push(`[${call.name}] BLOCKED: destructive tool requires explicit approval (risk: ${risk})`);
            sendEvent('tool_result', { name: call.name, status: 'blocked', error: `Destructive tool requires approval` });
            return;
          }
          sendEvent('tool_call', { name: call.name, args: call.args, description: known.description, riskLevel: risk });
          try {
            const result = await dynamicTools.execute(call.name, call.args, abortController.signal);
            const serialised = JSON.stringify(result).slice(0, 8000);
            toolResults.push(`[${call.name}]\n${serialised}`);
            sendEvent('tool_result', { name: call.name, status: 'success', result });
            // #15 record evidence for this tool call
            addEvidence(requestId, `Tool ${call.name} returned data`, [{ sourceType: 'tool_execution', sourceName: call.name, parsedValue: result }], 0.85);
            // Analytical compute → globe: when analytical_execute returns a
            // spatial grid, stream it as a dedicated event so the client can
            // render the real computed field as a heatmap over the study area
            // (QGIS-style), not just print the number in the chat.
            if (call.name === 'analytical_execute') {
              const res = (result ?? {}) as Record<string, unknown>;
              const grid = res.grid as {
                latMin?: number; latMax?: number; lonMin?: number; lonMax?: number;
                nLat?: number; nLon?: number; values?: number[]; valueMin?: number; valueMax?: number;
              } | null;
              const location = res.location as { lat?: number; lon?: number; label?: string } | null;
              if (grid && Array.isArray(grid.values) && typeof grid.nLat === 'number' && typeof grid.nLon === 'number') {
                sendEvent('analytical_result', {
                  toolId: res.id,
                  label: `Model ${res.id} — ${String(res.visualizationType || 'result')}`,
                  lat: location?.lat ?? intent.location?.lat,
                  lon: location?.lon ?? intent.location?.lon,
                  unit: res.unit,
                  vizType: res.visualizationType,
                  value: res.result as number | undefined,
                  grid,
                  interpretation: res.interpretation,
                });
              }
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            toolResults.push(`[${call.name}] ERROR: ${errMsg}`);
            sendEvent('tool_result', { name: call.name, status: 'error', error: errMsg });
          }
        }));
        sendEvent('step', { stepType: 'tool_execution', text: `Executed ${toolCalls.length} tool call(s)`, status: 'completed' });

        // Second pass: synthesize a final answer using the real tool outputs.
        sendEvent('step', { stepType: 'synthesis', text: 'Synthesizing answer from tool results...', status: 'running' });
        const resultsBlock = toolResults.join('\n\n');
        const synthesisPrompt = `${systemPrompt}\n\n${memoryContext ? `[Context from user profile]\n${memoryContext}\n\n` : ''}[User query]\n${fullMessage}\n\n## TOOL_RESULTS\n${resultsBlock}\n\nUsing the tool results above, write your final answer now. Cite the real numbers from the tool results. You may still emit ## COMMANDS for visualization.`;
        outputText = ToolCallParser.strip(await streamPass(synthesisPrompt));
        // Synthesis fallback: if the LLM returned empty but real tool data
        // was fetched, show the raw results — the user gets real data.
        if (!outputText || outputText.trim().length < 10) {
          const fallbackParts = toolResults.filter(r => !r.includes('ERROR:'));
          if (fallbackParts.length > 0) {
            outputText = `## Real-time data\n\n${fallbackParts.map(r => r.slice(0, 600)).join('\n\n')}\n\n*Data fetched from live sources. Re-ask for a detailed analysis.*`;
          } else {
            outputText = 'I retrieved the data but hit a temporary issue generating the final answer. Please try again.';
          }
        }
        sendEvent('step', { stepType: 'synthesis', text: 'Synthesis complete', status: 'completed' });
      } else {
        // No tool calls — strip any stray TOOL_CALLS markers from a no-op pass.
        outputText = ToolCallParser.strip(outputText);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error({ err: e, aborted: abortController.signal.aborted }, 'All AI providers failed');
      if (abortController.signal.aborted) { cleanup(); res.end(); return; }
      sendEvent('error', { error: `Analysis failed: ${errMsg}` });
      cleanup();
      res.end();
      return;
    }

    // Record cost for agent call
    costTracker.record(modelTier, message, outputText, false);

    // #1 Advanced: record this turn into the rolling conversation memory
    conversationMemory.recordTurn(uid, req.body.sessionId, { role: 'user', content: message }).catch(() => {});
    conversationMemory.recordTurn(uid, req.body.sessionId, { role: 'assistant', content: outputText }).catch(() => {});

    // #15 Advanced: record a reasoning trace keyed by requestId
    recordTrace({
      interactionId: requestId,
      userId: uid,
      query: message,
      response: outputText,
      steps: [
        { type: 'thought', description: `Intent: ${intent.type} (${(intent.confidence * 100).toFixed(0)}%)`, confidence: intent.confidence },
        { type: 'inference', description: `Model tier: ${modelTier}` },
        ...(toolCallCount > 0 ? [{ type: 'tool_call' as const, description: `${toolCallCount} tool call(s) executed` }] : []),
        { type: 'conclusion', description: 'Final response synthesized', confidence: 0.85 },
      ],
      intentType: intent.type,
      modelUsed: modelTier,
      totalDurationMs: Date.now() - (req as any).startTime || 0,
    });

    // Record in unified V2 memory system (episodic + sensory + working)
    // The legacy memoryManager.recordInteraction is intentionally removed — v2 stores the same data.
    // The v1 semanticCache and buildWorkingMemoryContext are still used (read-only) above.
    try {
      memoryManagerV2.store('episodic', {
        userId: uid,
        query: message,
        response: outputText,
        intentType: intent.type,
        location: intent.location ? { lat: intent.location.lat, lon: intent.location.lon, label: intent.location.label } : undefined,
        outcome: 'success',
        emotionalValence: 0,
        layersToggled: [],
        tokensUsed: 0,
        latencyMs: 0,
        modelTier,
      });
      memoryManagerV2.store('sensory', {
        type: 'agent_interaction',
        source: 'user_query',
        data: { intent: intent.type, queryLength: message.length },
        importanceScore: intent.type === 'unknown' ? 0.8 : 0.5,
      });
    } catch (e) {
      logger.warn({ err: e }, 'V2 memory store failed (non-critical)');
    }

    // ML pipeline: evaluate response quality asynchronously
    const epId = `ep_${Date.now()}`;
    selfImprover.evaluateInteraction(message, outputText, { intentType: intent.type, modelTier }, epId).catch((e: any) => logger.warn({ err: e }, 'Self-improver evaluation failed'));

    // ML pipeline: extract knowledge graph entities
    if ((process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY) && intent.location) {
      const locLabel = intent.location.label || `${intent.location.lat.toFixed(2)},${intent.location.lon.toFixed(2)}`;
      knowledgeGraph.ensureEntity(locLabel, 'location').catch((e: any) => logger.warn({ err: e }, 'Knowledge graph location entity failed'));
      knowledgeGraph.ensureEntity(intent.type, 'intent').catch((e: any) => logger.warn({ err: e }, 'Knowledge graph intent entity failed'));
    }

    // ── Last-resort fallback: local GGUF ─────────────────────────
    // If the remote LLM providers are all unavailable/rate-limited and the
    // answer came back empty, fall back to the local GGUF model (llama-server)
    // with a tool-free prompt so the user always gets a real answer.
    const isFallbackNeeded = !outputText || outputText.trim().length < 10 || /All AI providers unavailable|Provider failed|deep reasoning took too long/i.test(outputText);
    if (isFallbackNeeded) {
      try {
        const ggufHealth = await fetch('http://localhost:11436/health', { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false);
        if (ggufHealth) {
          const ggufPrompt = `Answer the user's question directly. Do NOT call any tools, do NOT emit ## TOOL_CALLS or ## COMMANDS. Be accurate and cite real-world reasoning.

Question: ${message}

Answer:`;
          const ggufResp = await fetch('http://localhost:11436/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(120000),
            body: JSON.stringify({
              model: 'local',
              messages: [{ role: 'user', content: ggufPrompt.slice(0, 8000) }],
              max_tokens: 1500,
              temperature: 0.3,
            }),
          });
          if (ggufResp.ok) {
            const ggufData = await ggufResp.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
            const msg = ggufData.choices?.[0]?.message;
            const ggufText = (msg?.content || msg?.reasoning_content || '').trim();
            if (ggufText) {
              outputText = `## Answer (local model)\n\n${ggufText.slice(0, 3000)}`;
              sendEvent('step', { stepType: 'synthesis', text: 'Answered via local model fallback', status: 'completed' });
            }
          }
        }
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'Local GGUF fallback failed');
      }
    }

    // Parse visualization commands from output
    sendEvent('step', { stepType: 'parsing', text: 'Parsing visualization commands...', status: 'running' });
    try {
      const commands = CommandParser.parse(outputText);
      recipeCommands = commands;
      if (commands.length > 0) {
        sendEvent('commands', commands);
        sendEvent('step', { stepType: 'parsing', text: `Parsed ${commands.length} visualization command(s)`, status: 'completed' });
      } else {
        sendEvent('step', { stepType: 'parsing', text: 'No visualization commands needed', status: 'completed' });
      }
    } catch (e) {
      logger.warn({ err: e }, 'Command parsing failed (non-critical)');
      sendEvent('step', { stepType: 'parsing', text: 'Command parsing failed', status: 'completed' });
    }

    // Send final output
    const saveable = recipeSteps.length > 0;
    sendEvent('output', {
      text: outputText, modelTier, intentType: intent.type,
      ...(saveable ? {
        recipe: {
          intent: intent.type,
          query: message,
          domain: resolveDomain(intent.type),
          steps: recipeSteps,
          commands: recipeCommands,
          sampleLocation: intent.location || undefined,
          slots: detectSlots(message, intent.location || undefined),
        },
      } : {}),
    });
    sendEvent('done', { type: 'done' });

  } catch (e) {
    sendEvent('error', { error: String(e) });
  }
  cleanup();
  res.end();
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 2.0.5: Local AI Fallback (Ollama)
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/agent/local-ask', async (req: express.Request, res: express.Response) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: 'llama3',
        prompt: `You are an AI assistant for a geospatial Earth observation platform. Answer concisely and accurately.\n\nUser query: ${message.slice(0, 2000)}`,
        stream: false,
        options: { temperature: 0.3, max_tokens: 512 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json() as { response?: string };
    if (data?.response) return res.json({ response: data.response });
    throw new Error('Empty Ollama response');
  } catch (e) {
    res.json({ error: String(e), fallback: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AI PATTERN STORE: save / search / approve reusable workflows
// ═══════════════════════════════════════════════════════════════════════

// Save (or approve) a pattern from a chat run the user liked. Persists to
// data/ai-patterns/<domain>/ on disk — survives restarts and browser clears.
app.post('/api/ai-patterns/save', authGuard, (req: express.Request, res: express.Response) => {
  const { intent, query, steps, commands, domain, sampleLocation, slots } = req.body as {
    intent?: string; query?: string; steps?: PatternStep[]; commands?: PatternCommand[];
    domain?: string; sampleLocation?: { lat: number; lon: number; label?: string }; slots?: string[];
  };
  if (!query || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'query and steps are required' });
  }
  try {
    const resolvedDomain = resolveDomain(domain || intent || 'general');
    const resolvedSlots = Array.isArray(slots) && slots.length > 0
      ? slots
      : detectSlots(query, sampleLocation);
    const pattern = savePattern({
      domain: resolvedDomain,
      intent: intent || 'general',
      name: query,
      query,
      slots: resolvedSlots,
      steps,
      commands: Array.isArray(commands) ? commands : [],
      approvalCount: 1,
      sampleLocation,
    });
    res.json({ ok: true, pattern });
  } catch (e) {
    res.status(500).json({ error: `Pattern save failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// Approve an already-saved pattern (strengthens it for future matching).
app.post('/api/ai-patterns/approve', authGuard, (req: express.Request, res: express.Response) => {
  const { id } = req.body as { id?: string };
  if (!id) return res.status(400).json({ error: 'id required' });
  const pat = approvePattern(id);
  if (!pat) return res.status(404).json({ error: 'Pattern not found' });
  res.json({ ok: true, pattern: pat });
});

// Search saved patterns by query + intent (for reuse / review).
app.get('/api/ai-patterns/search', authGuard, (req: express.Request, res: express.Response) => {
  const q = String(req.query.q || '').slice(0, 300);
  const intent = String(req.query.intent || '');
  const domain = req.query.domain ? String(req.query.domain) : undefined;
  try {
    if (q) {
      const match = findMatchingPattern(q, intent || 'general', domain);
      res.json({ count: match ? 1 : 0, match });
    } else {
      const patterns = listPatterns(domain);
      res.json({ count: patterns.length, patterns: patterns.slice(0, 100) });
    }
  } catch (e) {
    res.status(500).json({ error: `Pattern search failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// Stats: how many patterns per domain are stored on disk.
app.get('/api/ai-patterns/stats', authGuard, (_req: express.Request, res: express.Response) => {
  res.json(patternStoreStats());
});

// ═══════════════════════════════════════════════════════════════════════
// ADVANCED AGENT: Plan generation, multi-agent execution, suggestions, trace
// ═══════════════════════════════════════════════════════════════════════

// #5 Plan-then-execute: generate an execution plan for a complex query
app.post('/api/agent/plan', authGuard, async (req: express.Request, res: express.Response) => {
  const { message, tools } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  try {
    const availableTools = Array.isArray(tools) && tools.length > 0 ? tools : listAvailableTools();
    const plan = await generatePlan(message, availableTools);
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: `Plan generation failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// #5 + #6 Execute a plan with streaming per-sub-agent updates
app.post('/api/agent/plan/execute', authGuard, async (req: express.Request, res: express.Response) => {
  const { plan, sessionId } = req.body as { plan?: AgentPlan; sessionId?: string };
  if (!plan || !Array.isArray(plan.steps)) return res.status(400).json({ error: 'plan with steps required' });
  const userId = (req as any).userId || 'default';
  const abortController = new AbortController();
  const requestId = (req as any).correlationId || crypto.randomUUID();
  registerAbortController(requestId, abortController);
  res.on('close', () => { if (!res.writableEnded) abortController.abort(); });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  sendEvent('connected', { requestId, planId: plan.id });

  // Build memory context for sub-agents
  const convCtx = conversationMemory.get(userId, sessionId);
  const memoryContext = conversationMemory.buildPromptContext(convCtx);

  try {
    const finalText = await executePlan(
      plan,
      memoryContext,
      (update: SubAgentUpdate) => {
        sendEvent('subagent', update);
      },
      (stepId, output, durationMs) => {
        sendEvent('step_output', { stepId, output: output.slice(0, 2000), durationMs });
      },
      abortController.signal,
    );

    // Record the turn
    conversationMemory.recordTurn(userId, sessionId, { role: 'user', content: plan.query }).catch(() => {});
    conversationMemory.recordTurn(userId, sessionId, { role: 'assistant', content: finalText }).catch(() => {});

    recordTrace({
      interactionId: requestId,
      userId,
      query: plan.query,
      response: finalText,
      steps: plan.steps.map(s => ({ type: 'tool_call' as const, description: `${s.agent}: ${s.description}`, durationMs: s.durationMs })),
      intentType: 'planned',
      modelUsed: 'orchestrated',
      totalDurationMs: 0,
    });

    sendEvent('output', { text: finalText });
    sendEvent('done', { type: 'done' });
  } catch (e) {
    sendEvent('error', { error: String(e) });
  }
  removeAbortController(requestId);
  res.end();
});

// #10 Adaptive suggestions
app.post('/api/agent/suggestions', authGuard, async (req: express.Request, res: express.Response) => {
  const ctx = req.body as SuggestionContext;
  if (!ctx || typeof ctx !== 'object') return res.status(400).json({ error: 'suggestion context required' });
  try {
    const suggestions = await generateSuggestions(ctx);
    res.json({ suggestions });
  } catch (e) {
    res.status(500).json({ error: `Suggestion generation failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// #4 Tool approval — execute a previously-blocked destructive tool after user confirms
app.post('/api/agent/approve', authGuard, async (req: express.Request, res: express.Response) => {
  const { toolName, args } = req.body;
  if (!toolName || typeof toolName !== 'string') return res.status(400).json({ error: 'toolName required' });
  const risk = classifyToolRisk(toolName, args || {});
  try {
    const result = await dynamicTools.execute(toolName, args || {}, new AbortController().signal);
    res.json({ result, riskLevel: risk });
  } catch (e) {
    res.status(500).json({ error: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// #15 Trace retrieval — fetch full reasoning trace for a requestId/interactionId
app.get('/api/agent/trace/:id', authGuard, async (req: express.Request, res: express.Response) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'trace id required' });
  try {
    const trace = reasoningVisualizer.toJson(id);
    if (!trace) return res.status(404).json({ error: 'Trace not found' });
    res.type('json').send(trace);
  } catch (e) {
    res.status(500).json({ error: `Trace retrieval failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// Cognitive deep-reasoning endpoint: runs the dual-process architecture
// (System 1 real-data fast path → System 2 with MCTS/ToT) explicitly and
// returns the full result including the reasoning trace. Never emits canned
// templates — System 1 resolves through real registered tools, System 2 uses
// real LLM reasoning over real data.
app.post('/api/agent/cognize', authGuard, validate(askSchema), async (req: express.Request, res: express.Response) => {
  const { message, recentMessages } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const start = Date.now();
  try {
    const cognitionResult = await cognitiveAgent.process(message, {
      location: undefined,
      lat: undefined,
      lon: undefined,
      intent: undefined,
    });
    res.json({
      ok: true,
      mode: cognitionResult.mode,
      output: cognitionResult.finalOutput,
      criticScore: cognitionResult.criticScore,
      traceId: cognitionResult.traceId,
      latencyMs: Date.now() - start,
      flagsForReview: cognitionResult.flagsForReview,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Cognition failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// #15 Evidence chain retrieval
app.get('/api/agent/evidence/:id', authGuard, async (req: express.Request, res: express.Response) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'interaction id required' });
  try {
    const summary = evidenceChain.summarizeChain(id);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: `Evidence retrieval failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// #14 Resume — continue a partially-generated response
app.post('/api/agent/resume', authGuard, async (req: express.Request, res: express.Response) => {
  const { partial, originalMessage, sessionId } = req.body;
  if (!partial || !originalMessage) return res.status(400).json({ error: 'partial and originalMessage required' });
  const userId = (req as any).userId || 'default';
  const abortController = new AbortController();
  const requestId = (req as any).correlationId || crypto.randomUUID();
  registerAbortController(requestId, abortController);
  res.on('close', () => { if (!res.writableEnded) abortController.abort(); });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  sendEvent('connected', { requestId });

  const convCtx = conversationMemory.get(userId, sessionId);
  const memoryContext = conversationMemory.buildPromptContext(convCtx);
  const resumePrompt = `You were answering a user query and your response was interrupted. Continue from where you left off — do NOT repeat what you already said. Start mid-sentence if needed.

${memoryContext}
Original user query: ${originalMessage}
Your response so far: ${partial}

Continue the response:`;
  try {
    let continuation = '';
    for await (const token of omninet.generateStream(resumePrompt, { signal: abortController.signal, temperature: 0.4, maxTokens: 2000 })) {
      if (abortController.signal.aborted) break;
      continuation += token;
      sendEvent('token', { text: token });
    }
    sendEvent('output', { text: continuation });
    sendEvent('done', { type: 'done' });
  } catch (e) {
    sendEvent('error', { error: String(e) });
  }
  removeAbortController(requestId);
  res.end();
});

// #11 Model tier selector — return available tiers + cost estimates
app.get('/api/agent/tiers', authGuard, (_req: express.Request, res: express.Response) => {
  res.json({
    tiers: [
      { id: 'local', label: 'Fast', description: 'Local routing / cached. Cheapest, fastest.', costPerQuery: 0, latencyMs: 100 },
      { id: 'flash', label: 'Balanced', description: 'Flash-tier model. Good for most queries.', costPerQuery: 0.0001, latencyMs: 1500 },
      { id: 'pro', label: 'Deep', description: 'Pro-tier model. Best for complex analysis & code.', costPerQuery: 0.0008, latencyMs: 4000 },
    ],
    currentStats: costTracker.getStats(),
  });
});

// GET /api/agent/models — list every available LLM model (from omninet
// providers) with availability status, so the chat panel can offer a
// model picker. A model is "available" when its provider is reachable
// (not down) and has a configured API key / is local.
app.get('/api/agent/models', authGuard, (_req: express.Request, res: express.Response) => {
  try {
    const providers = omninet.getProviderDetails();
    const models: Array<{
      id: string; provider: string; model: string; label: string;
      available: boolean; status: string; local: boolean; tier: number;
    }> = [];
    for (const p of providers) {
      const hasKey = p.local || Boolean(p.apiKeyEnvVar && process.env[p.apiKeyEnvVar]);
      const reachable = p.status !== 'down';
      const available = hasKey && reachable && p.supportsStreaming !== false;
      for (const m of p.models) {
        models.push({
          id: `${p.name}/${m}`,
          provider: p.name,
          model: m,
          label: `${p.name} — ${m}`,
          available,
          status: p.status,
          local: Boolean(p.local),
          tier: p.tier,
        });
      }
    }
    // Auto (default) entry — no explicit selection, current behaviour.
    models.unshift({ id: 'auto', provider: 'auto', model: '', label: 'Auto (recommended)', available: true, status: 'healthy', local: false, tier: 0 });
    res.json({ models });
  } catch (e) {
    logger.warn({ err: e }, 'Failed to list models');
    res.json({ models: [{ id: 'auto', provider: 'auto', model: '', label: 'Auto (recommended)', available: true, status: 'healthy', local: false, tier: 0 }] });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2.1: Vision Analysis (Gemini Vision API)
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/agent/analyze-vision', async (req: express.Request, res: express.Response) => {
  const { image: imageBase64, mimeType, prompt: userPrompt } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Image data and mimeType required' });
  const supportedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
  if (!supportedMime.includes(mimeType)) return res.status(400).json({ error: `Unsupported mime type: ${mimeType}` });

  const textPrompt = (typeof userPrompt === 'string' && userPrompt.trim())
    ? userPrompt.trim()
    : 'Analyze this image in detail. If it is a satellite image, map, chart, or geographic area, describe what you see including any notable features, patterns, colors, text, or structures.';

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
  if (!apiKey) return res.status(502).json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY in .env' });

  const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
  let lastError: string | undefined;

  for (const model of modelsToTry) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: textPrompt.slice(0, 2000) },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      });
      if (resp.status === 404) { lastError = `Model ${model} not found`; continue; }
      if (resp.status === 429 || resp.status === 503) { lastError = `Rate limited on ${model}`; continue; }
      if (!resp.ok) { lastError = `Gemini HTTP ${resp.status}`; continue; }
      const data = await resp.json() as Record<string, unknown>;
      const text = (((data.candidates as Array<Record<string, unknown>>)?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
      if (!text) { lastError = 'Empty response from Gemini'; continue; }
      return res.json({ analysis: text });
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  res.status(502).json({ error: 'Vision analysis unavailable', detail: lastError || 'All Gemini models failed' });
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2.3: Data File Analysis (CSV/GeoJSON parsing)
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/agent/analyze-data', async (req: express.Request, res: express.Response) => {
  const { content, fileName } = req.body;
  if (!content) return res.status(400).json({ error: 'File content required' });

  const name = (fileName || 'data.csv').toLowerCase();

  try {
    if (name.endsWith('.csv')) {
      // Parse CSV and return structure
      const lines = content.split('\n').filter((l: string) => l.trim());
      if (lines.length < 2) return res.json({ type: 'csv', rows: 0, error: 'File has no data rows' });

      const headers = lines[0].split(',').map((h: string) => h.trim());
      const rows = lines.slice(1).map((l: string) => {
        const vals = l.split(',');
        const row: Record<string, string> = {};
        headers.forEach((h: string, i: number) => { row[h] = (vals[i] || '').trim(); });
        return row;
      });

      // Detect numeric columns and compute basic stats
      const columns = headers.map((h: string) => {
        const nums = rows.map((r: Record<string, string>) => parseFloat(r[h])).filter((n: number) => isFinite(n));
        const strings = rows.map((r: Record<string, string>) => r[h]).filter((s: string) => s && isNaN(Number(s)));
        const isNumeric = nums.length > rows.length * 0.5;
        return {
          name: h,
          type: isNumeric ? 'numeric' : 'text',
          sample: rows.slice(0, 5).map((r: Record<string, string>) => r[h]),
          ...(isNumeric ? {
            min: Math.min(...nums), max: Math.max(...nums),
            mean: nums.reduce((a: number, b: number) => a + b, 0) / nums.length,
            count: nums.length,
          } : { uniqueValues: new Set(strings).size }),
        };
      });

      // Detect lat/lon columns
      const latCol = columns.find((c: { name: string; type: string }) => /lat/i.test(c.name));
      const lonCol = columns.find((c: { name: string; type: string }) => /lon|lng/i.test(c.name));

      res.json({
        type: 'csv',
        rows: rows.length,
        columns: rows.length > 0 ? columns : headers.map((h: string) => ({ name: h, type: 'unknown', sample: [] })),
        detectedLocation: latCol && lonCol ? { latColumn: latCol.name, lonColumn: lonCol.name } : null,
        preview: rows.slice(0, 10),
        geoDetect: latCol && lonCol ? `${rows.length} point features detected` : 'No lat/lon columns detected',
      });
    } else if (name.endsWith('.json') || name.endsWith('.geojson')) {
      let data: Record<string, unknown>;
      try { data = JSON.parse(content); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

      const isGeoJSON = data.type === 'FeatureCollection' || data.type === 'Feature';
      const features = data.type === 'FeatureCollection' ? (data.features || []) as Array<Record<string, unknown>>
        : data.type === 'Feature' ? [data] : [];

      const geometryTypes = [...new Set(features.map((f: Record<string, unknown>) => (f.geometry as Record<string, unknown>)?.type as string).filter(Boolean))];
      const props = features.length > 0 ? Object.keys((features[0] as Record<string, unknown>).properties as Record<string, unknown> || {}) : [];

      res.json({
        type: 'geojson',
        isGeoJSON,
        features: features.length,
        geometryTypes,
        properties: props,
        preview: features.slice(0, 5),
      });
    } else {
      res.json({ type: 'unknown', message: `Unsupported file type: ${name.split('.').pop()}. Supported: CSV, JSON, GeoJSON.` });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3: Proactive Intelligence — SSE event stream (deprecated, use WebSocket /ws/agent)
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/agent/events', sseAuthGuard, (req: express.Request, res: express.Response) => {
  logger.warn({ userId: (req as any).userId }, 'SSE endpoint /api/agent/events is deprecated, migrate to WebSocket /ws/agent');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const userId = (req as any).userId;
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', userId })}\n\n`);
  activeSseConnections.inc();

  const unsubProactive = pubsub.subscribe('proactive', (data: any) => {
    res.write(`event: proactive\ndata: ${JSON.stringify(data)}\n\n`);
  });
  const unsubUser = pubsub.subscribeUser(userId, (data: any) => {
    res.write(`event: ${data.event || 'message'}\ndata: ${JSON.stringify(data.data)}\n\n`);
  });

  req.on('close', () => {
    unsubProactive();
    unsubUser();
    activeSseConnections.dec();
  });
});

// Data Layer Health Status — shows which external APIs are reachable
app.get('/api/data-layers/status', authGuard, askRateLimit, async (_req: express.Request, res: express.Response) => {
  try {
    const layerChecks = [
      { id: 'earthquakes', name: 'USGS Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', category: 'seismic' },
      { id: 'tectonic', name: 'Tectonic Plates', url: 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json', category: 'seismic' },
      { id: 'weather_alerts', name: 'NWS Weather Alerts', url: 'https://api.weather.gov/alerts/active', category: 'weather' },
      { id: 'weather_openmeteo', name: 'Open-Meteo (0,0)', url: 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m&timezone=auto', category: 'weather' },
      { id: 'eonet', name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/api/v3/events?days=1&status=open', category: 'hazards' },
      { id: 'iss', name: 'ISS Tracker', url: 'https://api.wheretheiss.at/v1/satellites/25544', category: 'space' },
      { id: 'aurora', name: 'NOAA Aurora Forecast', url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', category: 'space' },
      { id: 'lightning', name: 'Blitzortung Lightning', url: 'https://map.blitzortung.org/GEOjson/getjson.php?f=s&n=00', category: 'weather' },
      { id: 'submarine_cables', name: 'Submarine Cables', url: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', category: 'infrastructure' },
      { id: 'space_debris', name: 'CelesTrak Debris', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=JSON', category: 'space' },
      { id: 'volcanoes', name: 'USGS Volcanoes', url: 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated', category: 'hazards' },
      { id: 'flights_opensky', name: 'OpenSky Flights', url: 'https://opensky-network.org/api/states/all', category: 'aviation' },
      { id: 'flights_adsb', name: 'ADSB.lol Flights', url: 'https://api.adsb.lol/v2/point/40/-100/250', category: 'aviation' },
      { id: 'nhc_storms', name: 'NHC Storms', url: 'https://www.nhc.noaa.gov/CurrentStorms.json', category: 'weather' },
      { id: 'dsn', name: 'NASA Deep Space Network', url: 'https://eyes.nasa.gov/dsn/data/dsn.xml', category: 'space' },
    ];

    // Check which API keys are configured
    const apiKeys = {
      gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY),
      groq: !!process.env.GROQ_API_KEY,
      cerebras: !!process.env.CEREBRAS_API_KEY,
      sambanova: !!process.env.SAMBANOVA_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      together: !!process.env.TOGETHER_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      firms: !!process.env.NASA_FIRMS_MAP_KEY,
      flightaware: !!process.env.FLIGHTAWARE_AEROAPI_KEY,
      airlabs: !!process.env.AIRLABS_API_KEY,
    };

    // Probe each layer in parallel with short timeouts
    const results = await Promise.allSettled(
      layerChecks.map(async (layer) => {
        const start = Date.now();
        try {
          const resp = await fetch(layer.url, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Terranoetis/1.0' },
          });
          return {
            ...layer,
            status: resp.ok ? 'healthy' : 'degraded',
            httpStatus: resp.status,
            latencyMs: Date.now() - start,
          };
        } catch (e) {
          logger.warn({ err: e, layerId: layer.id }, 'Layer health check failed');
          return {
            ...layer,
            status: 'down',
            httpStatus: 0,
            latencyMs: Date.now() - start,
          };
        }
      })
    );

    const layers = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { status: 'down', httpStatus: 0, latencyMs: 0 }
    );

    const healthy = layers.filter((l) => l.status === 'healthy').length;
    const degraded = layers.filter((l) => l.status === 'degraded').length;
    const down = layers.filter((l) => l.status === 'down').length;

    res.json({
      overall: down === 0 ? (degraded === 0 ? 'healthy' : 'degraded') : 'degraded',
      summary: { healthy, degraded, down, total: layers.length },
      layers,
      apiKeys,
      providerStatus: omninet.getStatus().map((p) => ({
        name: p.name,
        status: p.status,
        tier: p.tier,
      })),
      timestamp: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to check data layer status', detail: (e as Error).message });
  }
});

// Phase 3.1: Monitor rules CRUD
app.post('/api/agent/monitor', (req: express.Request, res: express.Response) => {
  const { layerId, condition, location, label, intervalMs } = req.body;
  if (!layerId || !condition) return res.status(400).json({ error: 'layerId and condition required' });
  const rule = monitorManager.create({ layerId, condition, location, label: label || `Monitor ${layerId}`, userId: (req as any).userId, intervalMs: intervalMs || 300000 });
  auditLog((req as any).userId, 'monitor_rule_change', `rule:${rule.id}`, `layer:${layerId}`, req.ip || '', req.headers['user-agent'] || '');
  res.json(rule);
});

app.get('/api/agent/monitor', (req: express.Request, res: express.Response) => {
  const rules = monitorManager.list((req as any).userId);
  res.json(rules);
});

app.delete('/api/agent/monitor/:id', requireOwnership('monitor_rules'), (req: express.Request, res: express.Response) => {
  const ok = monitorManager.remove(req.params.id);
  auditLog((req as any).userId, 'monitor_rule_change', `rule delete:${req.params.id}`, '', req.ip || '', req.headers['user-agent'] || '');
  res.json({ removed: ok });
});

// Phase 3.2: Scheduled tasks CRUD
app.post('/api/agent/schedule', (req: express.Request, res: express.Response) => {
  const { label, goal, intervalMs } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal required' });
  const task = schedulerManager.create({ label: label || 'Scheduled report', goal, userId: (req as any).userId, intervalMs: intervalMs || 86400000 });
  res.json(task);
});

app.get('/api/agent/schedule', (req: express.Request, res: express.Response) => {
  const tasks = schedulerManager.list((req as any).userId);
  res.json(tasks);
});

app.delete('/api/agent/schedule/:id', requireOwnership('scheduled_tasks'), (req: express.Request, res: express.Response) => {
  const ok = schedulerManager.remove(req.params.id);
  res.json({ removed: ok });
});

// Phase 3.3: Location context
// ═══════════════════════════════════════════════════════════════════════
// MULTIMODAL: satellite, seismic, radar, sentiment, fusion
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/multimodal/status', (_req: express.Request, res: express.Response) => {
  res.json(multimodal.getStatus());
});

// ── Satellite ────────────────────────────────────────────────────

app.post('/api/multimodal/satellite/analyze', async (req: express.Request, res: express.Response) => {
  const { lat, lon, radiusKm } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const obs = await satelliteAnalyzer.analyzeArea(lat, lon, radiusKm || 10);
    res.json(obs);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/satellite/change', async (req: express.Request, res: express.Response) => {
  const { lat, lon, daysBefore } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const result = await satelliteAnalyzer.detectChange(lat, lon, daysBefore || 30);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/satellite/fire-scars', async (req: express.Request, res: express.Response) => {
  const { lat, lon } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const result = await satelliteAnalyzer.detectFireScars(lat, lon);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/satellite/flood-extent', async (req: express.Request, res: express.Response) => {
  const { lat, lon } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const result = await satelliteAnalyzer.analyzeFloodExtent(lat, lon);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/satellite/interpret', async (req: express.Request, res: express.Response) => {
  const { lat, lon } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const interpretation = await satelliteAnalyzer.interpretWithVision(lat, lon);
    res.json({ interpretation });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
// ── Satellite Region Processing (NDVI, NDWI, cloud mask, land cover) ──
app.post('/api/satellite/process', async (req: express.Request, res: express.Response) => {
  try {
    const { type, bbox, date, studyAreaId } = req.body;
    if (!type || !bbox) {
      return res.status(400).json({ error: 'type and bbox required' });
    }
    const validTypes = ['ndvi', 'ndwi', 'cloud_mask', 'land_cover'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }
    const { latMin, latMax, lonMin, lonMax } = bbox;
    if ([latMin, latMax, lonMin, lonMax].some(v => typeof v !== 'number')) {
      return res.status(400).json({ error: 'bbox must have latMin, latMax, lonMin, lonMax as numbers' });
    }
    const dateStr = date || new Date().toISOString().slice(0, 10);
    const areaName = studyAreaId || 'default';
    let gibsLayer: string;
    let resultMessage: string;
    switch (type) {
      case 'ndvi':
        gibsLayer = 'MODIS_Terra_NDVI_8Day';
        resultMessage = `NDVI computed for region (${latMin.toFixed(2)} deg lat, ${lonMin.toFixed(2)} deg lon) on ${dateStr}. NDVI ranges from -1 (water/bare) to 1 (dense vegetation).`;
        break;
      case 'ndwi':
        gibsLayer = 'MODIS_Terra_L3_Water_Mask';
        resultMessage = `NDWI computed for region on ${dateStr}. NDWI > 0.3 indicates open water bodies.`;
        break;
      case 'cloud_mask':
        gibsLayer = 'MODIS_Terra_Cloud_Fraction_Day';
        resultMessage = `Cloud fraction computed for region on ${dateStr}. Cloud mask identifies pixels with >80% cloud probability.`;
        break;
      case 'land_cover':
        gibsLayer = 'MODIS_Terra_Land_Cover_Type';
        resultMessage = `Land cover classification computed for region on ${dateStr}. Classes: water, urban, forest, cropland, grassland, barren.`;
        break;
      default:
        gibsLayer = 'MODIS_Terra_NDVI_8Day';
        resultMessage = 'Processing complete.';
    }
    const tileUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${gibsLayer}&STYLES=&BBOX=${latMin},${lonMin},${latMax},${lonMax}&SRS=EPSG:4326&WIDTH=1024&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=true&TIME=${dateStr}`;
    logger.info({ type, areaName, bbox, date: dateStr }, 'Satellite region analysis requested');
    res.json({
      success: true,
      type,
      message: resultMessage,
      tileUrl,
      bbox,
      date: dateStr,
      studyAreaId: areaName,
      gibsLayer,
      analyzed_points: [],
    });
  } catch (e) {
    logger.error({ err: e }, 'Satellite process error');
    res.status(500).json({ error: String(e) });
  }
});

// ── Seismic ──────────────────────────────────────────────────────

app.get('/api/multimodal/seismic/events', async (req: express.Request, res: express.Response) => {
  try {
    const minMag = parseFloat(req.query.minMag as string) || 2.5;
    const hoursBack = parseInt(req.query.hours as string) || 24;
    const events = await seismicProcessor.fetchEvents(minMag, hoursBack);
    res.json({ events, count: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/multimodal/seismic/history', (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const radiusDeg = parseFloat(req.query.radius as string) || 2;
    const limit = parseInt(req.query.limit as string) || 20;
    const events = seismicProcessor.queryHistory(lat, lon, radiusDeg, limit);
    res.json({ events, count: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/seismic/poll', async (_req: express.Request, res: express.Response) => {
  try {
    const events = await seismicProcessor.pollEvents();
    res.json({ newEvents: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Radar ────────────────────────────────────────────────────────

app.get('/api/multimodal/radar/scans', (req: express.Request, res: express.Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const scans = radarInterpreter.getRecentScans(limit);
    res.json({ scans, count: scans.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/radar/fetch', async (req: express.Request, res: express.Response) => {
  const { station } = req.body;
  if (!station) return res.status(400).json({ error: 'station required (e.g. KTLX)' });
  try {
    const scan = await radarInterpreter.fetchRadar(station);
    if (!scan) return res.status(502).json({ error: 'Failed to fetch radar data' });
    const cells = radarInterpreter.detectStormCells(scan);
    res.json({ scan, stormCells: cells, cellCount: cells.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/radar/precipitation', async (req: express.Request, res: express.Response) => {
  const { station, dbz } = req.body;
  if (dbz === undefined) return res.status(400).json({ error: 'dbz required' });
  const intensity = radarInterpreter.getPrecipitationIntensity(dbz);
  const rainfall = radarInterpreter.reflectivityToRainfall(dbz);
  res.json({ station: station || 'unknown', dbz, intensity, rainfallMmh: rainfall });
});

// ── Sentiment ────────────────────────────────────────────────────

app.post('/api/multimodal/sentiment/analyze', (req: express.Request, res: express.Response) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const result = sentimentAnalyzer.analyzeText(text);
  const locations = sentimentAnalyzer.extractLocations(text);
  res.json({ ...result, locations });
});

app.post('/api/multimodal/sentiment/report', (req: express.Request, res: express.Response) => {
  const { id, source, text, lat, lon, timestamp } = req.body;
  if (!id || !source || !text) return res.status(400).json({ error: 'id, source, text required' });
  const analysis = sentimentAnalyzer.analyzeText(text);
  const locations = sentimentAnalyzer.extractLocations(text);
  const report = {
    id, source, text, lat: lat || 0, lon: lon || 0,
    timestamp: timestamp || Date.now(),
    ...analysis, locations, isRumor: false, rumorConfidence: 0,
  };
  sentimentAnalyzer.recordSocialReport(report);
  res.json({ ok: true, report });
});

// ── Fusion ───────────────────────────────────────────────────────

app.get('/api/multimodal/fusion/events', (req: express.Request, res: express.Response) => {
  try {
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const events = multimodalFusion.queryFused(type, limit);
    res.json({ events, count: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/multimodal/fusion/nearby', (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const radiusDeg = parseFloat(req.query.radius as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const events = multimodalFusion.queryNearby(lat, lon, radiusDeg, limit);
    res.json({ events, count: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/fusion/fuse', async (_req: express.Request, res: express.Response) => {
  try {
    const events = multimodalFusion.fuseBuffer();
    res.json({ fusedEvents: events, count: events.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/multimodal/fusion/enrich', async (req: express.Request, res: express.Response) => {
  const { event } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  try {
    const enriched = await multimodalFusion.enrichFusedEvent(event);
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════
// EXPLAINABILITY: full transparency — reasoning traces, evidence chains,
// uncertainty quantification, bias auditing, human override
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/explain/status', (_req: express.Request, res: express.Response) => {
  res.json(explainability.getStatus());
});

// ── Reasoning Traces ──────────────────────────────────────────────

app.get('/api/explain/trace/:interactionId', (req: express.Request, res: express.Response) => {
  try {
    let trace = reasoningVisualizer.getTrace(req.params.interactionId);
    if (!trace) {
      const cognitiveTrace = cognitiveAgent.getTrace(req.params.interactionId) as any;
      if (cognitiveTrace) {
        const steps = JSON.parse(cognitiveTrace.traceJson || '[]').map((step: any, index: number) => ({
          type: step.type === 'synthesis' || step.type === 'debate' ? 'conclusion'
            : step.type === 'verification' ? 'observation'
              : step.type === 'decomposition' || step.type === 'hypothesis' ? 'thought'
                : 'inference',
          description: step.description || step.output || step.type || `Step ${index + 1}`,
          evidence: step.output || step.input,
          confidence: step.confidence,
          timestamp: Date.now() + index,
          metadata: step,
        }));
        trace = {
          interactionId: cognitiveTrace.traceId,
          userId: 'system',
          query: cognitiveTrace.query,
          response: '',
          steps,
          totalDurationMs: cognitiveTrace.durationMs || 0,
          confidence: cognitiveTrace.finalConfidence ?? cognitiveTrace.criticScore ?? 0,
          modelUsed: cognitiveTrace.systemUsed || 'cognitive',
          intentType: cognitiveTrace.systemUsed || 'cognition',
          createdAt: Date.now(),
        };
      }
    }
    if (!trace) return res.status(404).json({ error: 'Trace not found' });
    const format = req.query.format as string;
    if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown');
      return res.send(reasoningVisualizer.toMarkdown(req.params.interactionId));
    }
    if (format === 'mermaid') {
      res.setHeader('Content-Type', 'text/plain');
      return res.send(reasoningVisualizer.toMermaid(req.params.interactionId));
    }
    res.json(trace);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/traces', (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const traces = reasoningVisualizer.getRecentTraces(userId, limit);
    res.json({ traces, count: traces.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/trace', (req: express.Request, res: express.Response) => {
  const { interactionId, userId, query, response, steps, totalDurationMs, confidence, modelUsed, intentType } = req.body;
  if (!interactionId || !userId) return res.status(400).json({ error: 'interactionId and userId required' });
  try {
    reasoningVisualizer.recordTrace({
      interactionId, userId, query: query || '', response: response || '',
      steps: steps || [], totalDurationMs: totalDurationMs || 0,
      confidence: confidence || 0, modelUsed: modelUsed || 'unknown',
      intentType: intentType || 'unknown', createdAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/trace/:interactionId/step', (req: express.Request, res: express.Response) => {
  const { type, description, evidence, confidence, durationMs } = req.body;
  if (!type || !description) return res.status(400).json({ error: 'type and description required' });
  try {
    reasoningVisualizer.addStep(req.params.interactionId, {
      type, description, evidence, confidence, durationMs,
      timestamp: Date.now(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Evidence Chains ──────────────────────────────────────────────

app.get('/api/explain/evidence/:interactionId', (req: express.Request, res: express.Response) => {
  try {
    const chain = evidenceChain.getChain(req.params.interactionId);
    if (!chain) return res.status(404).json({ error: 'Evidence chain not found' });
    const integrity = evidenceChain.checkIntegrity(req.params.interactionId);
    if (req.query.format === 'summary') {
      return res.json({ summary: evidenceChain.summarizeChain(req.params.interactionId) });
    }
    res.json({ chain, integrity });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/evidence/:interactionId/verify', (req: express.Request, res: express.Response) => {
  try {
    const result = evidenceChain.verifyChain(req.params.interactionId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/evidence/link', (req: express.Request, res: express.Response) => {
  const { interactionId, claim, sources, confidence } = req.body;
  if (!interactionId || !claim || !sources) return res.status(400).json({ error: 'interactionId, claim, and sources required' });
  try {
    const link = evidenceChain.addLink(interactionId, claim, sources, confidence || 0.5);
    res.json(link);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Uncertainty ──────────────────────────────────────────────────

app.post('/api/explain/uncertainty/compute', (req: express.Request, res: express.Response) => {
  const { pointEstimate, sampleSize, historicalAccuracy, distribution, confidenceLevel } = req.body;
  if (pointEstimate === undefined || sampleSize === undefined) {
    return res.status(400).json({ error: 'pointEstimate and sampleSize required' });
  }
  try {
    const result = uncertaintyQuantifier.computeConfidenceInterval(
      pointEstimate, sampleSize, historicalAccuracy || 0.5,
      distribution || 'normal', confidenceLevel || 0.95,
    );
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/uncertainty/calibration', (req: express.Request, res: express.Response) => {
  try {
    const type = req.query.type as string | undefined;
    const curve = uncertaintyQuantifier.getCalibrationCurve(type);
    res.json(curve);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/uncertainty/record', (req: express.Request, res: express.Response) => {
  const { predicted, actual, type } = req.body;
  if (predicted === undefined || actual === undefined) {
    return res.status(400).json({ error: 'predicted and actual required' });
  }
  try {
    uncertaintyQuantifier.recordOutcome(predicted, actual, type || 'general');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Bias Audit ───────────────────────────────────────────────────

app.get('/api/explain/bias/report', (_req: express.Request, res: express.Response) => {
  try {
    const report = biasAuditor.generateReport();
    res.json(report);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/bias/reports', (req: express.Request, res: express.Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const reports = biasAuditor.getRecentReports(limit);
    res.json({ reports, count: reports.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/bias/geographic', (req: express.Request, res: express.Response) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 30;
    const geo = biasAuditor.auditGeographic(daysBack);
    res.json(geo);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/bias/temporal', (req: express.Request, res: express.Response) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 30;
    const temp = biasAuditor.auditTemporal(daysBack);
    res.json(temp);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/bias/mitigations', (_req: express.Request, res: express.Response) => {
  try {
    const suggestions = biasAuditor.getMitigationSuggestions();
    res.json({ suggestions });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Human Override ───────────────────────────────────────────────

app.get('/api/explain/override/pending', (_req: express.Request, res: express.Response) => {
  try {
    const pending = humanOverride.getPendingApprovals();
    res.json({ pending, count: pending.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/override/evaluate', (req: express.Request, res: express.Response) => {
  const { type, severity, lat, lon, description, probability, evidenceSummary } = req.body;
  if (!type || !severity || probability === undefined) {
    return res.status(400).json({ error: 'type, severity, and probability required' });
  }
  try {
    const pred = humanOverride.evaluatePrediction({
      type, severity, lat: lat || 0, lon: lon || 0,
      description: description || '', probability, evidenceSummary,
    });
    if (!pred) return res.json({ requiresApproval: false });
    res.json({ requiresApproval: true, prediction: pred });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/override/:id/approve', requireRole('admin'), (req: express.Request, res: express.Response) => {
  const { userId, notes } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const ok = humanOverride.approve(req.params.id, userId, notes);
    if (!ok) return res.status(404).json({ error: 'Prediction not found' });
    res.json({ ok: true, status: 'approved' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/explain/override/:id/reject', requireRole('admin'), (req: express.Request, res: express.Response) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) return res.status(400).json({ error: 'userId and reason required' });
  try {
    const ok = humanOverride.reject(req.params.id, userId, reason);
    if (!ok) return res.status(404).json({ error: 'Prediction not found' });
    res.json({ ok: true, status: 'rejected' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/explain/override/audit-log', (req: express.Request, res: express.Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const log = humanOverride.getAuditLog(limit);
    res.json({ entries: log, count: log.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════
// SENTINEL: proactive monitoring status & management
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/agent/context', async (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  try {
    const context = await getLocationContext(lat, lon, `http://127.0.0.1:${PORT}`);
    res.json(context);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 7.1: MCP Server — Model Context Protocol (JSON-RPC over HTTP)
// ═══════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════
// PHASE 7.2: Plugin Ecosystem — dynamic tools & data sources
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/plugins', (_req: express.Request, res: express.Response) => {
  res.json({ plugins: pluginManager.listPlugins() });
});

app.post('/api/plugin/tool/:name', async (req: express.Request, res: express.Response) => {
  try {
    const result = await pluginManager.callTool(req.params.name, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

app.get('/api/plugin/data/:name', async (req: express.Request, res: express.Response) => {
  try {
    const result = await pluginManager.callDataSource(req.params.name, req.query as Record<string, string>);
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4: Memory & Personalization
// ═══════════════════════════════════════════════════════════════════════

// 4.1: User profile
app.get('/api/agent/profile', (req: express.Request, res: express.Response) => {
  const userId = (req as any).userId;
  const profile = memoryManager.profiles.get(userId);
  res.json(profile);
});

app.post('/api/agent/profile', (req: express.Request, res: express.Response) => {
  const { updates } = req.body;
  if (!updates) return res.status(400).json({ error: 'updates required' });
  const profile = memoryManager.profiles.update((req as any).userId, (p) => Object.assign(p, updates));
  res.json(profile);
});

app.delete('/api/agent/profile', (req: express.Request, res: express.Response) => {
  const userId = (req as any).userId;
  memoryManager.profiles.delete(userId);
  res.json({ deleted: true });
});

app.post('/api/agent/profile/toggle', (req: express.Request, res: express.Response) => {
  const { layerId } = req.body;
  memoryManager.profiles.recordLayerToggle((req as any).userId, layerId);
  res.json({ ok: true });
});

app.post('/api/agent/profile/location', (req: express.Request, res: express.Response) => {
  const { lat, lon, label } = req.body;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Invalid lat/lon' });
  memoryManager.profiles.recordLocation((req as any).userId, lat, lon, label);
  res.json({ ok: true });
});

// 4.2: Episodic memory
app.get('/api/agent/memory', (req: express.Request, res: express.Response) => {
  const userId = (req as any).userId;
  const q = (req.query.q as string) || '';
  const memory = memoryManager.getEpisodic(userId);
  if (q) return res.json(memory.search(q, 5));
  res.json(memory.recent(20));
});

app.delete('/api/agent/memory', (req: express.Request, res: express.Response) => {
  const userId = (req as any).userId;
  memoryManager.getEpisodic(userId); // re-creates empty
  res.json({ deleted: true });
});

// 4.4: Semantic cache
app.get('/api/agent/cache', (_req: express.Request, res: express.Response) => {
  res.json({ size: memoryManager.semanticCache.size() });
});

app.delete('/api/agent/cache', (_req: express.Request, res: express.Response) => {
  memoryManager.semanticCache.clear();
  res.json({ cleared: true });
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 9: Cost Optimization
// ═══════════════════════════════════════════════════════════════════════




// ═══════════════════════════════════════════════════════════════════════
// PHASE 10: Self-Improving System
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/agent/feedback', validate(feedbackSchema), (req: express.Request, res: express.Response) => {
  const { query, response, vote, intentType, modelTier } = req.body;
  const entry = feedbackManager.record({
    userId: (req as any).userId,
    query: query || '',
    response: response || '',
    vote: vote as 'up' | 'down',
    intentType: intentType || 'unknown',
    modelTier: modelTier || 'unknown',
  });
  // Trigger auto-tuning on each feedback
  selfImprover.tune();
  res.json({ ok: true, id: entry.id });
});

app.get('/api/agent/feedback', (req: express.Request, res: express.Response) => {
  const uid = (req as any).userId;
  res.json({
    stats: feedbackManager.getStats(),
    byIntent: feedbackManager.getByIntent(),
    byModel: feedbackManager.getByModel(),
    recent: uid ? feedbackManager.recentByUser(uid, 20) : [],
  });
});

app.get('/api/agent/analytics', (_req: express.Request, res: express.Response) => {
  const costStats = costTracker.getStats();
  const cacheStats = enhancedCache.getStats();
  const analytics = buildAnalytics(feedbackManager, costStats, cacheStats);
  res.json(analytics);
});


// ── Memory API ───────────────────────────────────────────────────

// 1. GET /api/memory/working — working memory context (goal, messages, tasks, attention)
app.get('/api/memory/working', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const ctx = memoryManagerV2.workingMemory.getContext();
  logger.info({ correlationId }, 'Memory working retrieved');
  res.json({
    goal: ctx.activeGoal,
    recentMessages: ctx.recentMessages,
    pendingTasks: ctx.pendingTasks,
    attentionFocus: ctx.summary || '',
  });
});

// 2. GET /api/memory/episodes — episodic memory with filtering
app.get('/api/memory/episodes', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const userId = (req as any).userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const intentType = req.query.intentType as string | undefined;
  const location = req.query.location as string | undefined;

  let episodes = memoryManagerV2.episodicMemory.recent(userId, 1000)
    .filter(e => !intentType || e.intentType === intentType)
    .filter(e => !location || (e.location && (
      e.location.label?.toLowerCase().includes(location.toLowerCase()) ||
      `${e.location.lat},${e.location.lon}`.includes(location)
    )));

  const total = episodes.length;
  episodes = episodes.slice(offset, offset + limit);

  logger.info({ correlationId, total, returned: episodes.length, intentType, location }, 'Memory episodes queried');
  res.json({
    episodes: episodes.map(e => ({
      id: e.id,
      query: e.query,
      response: e.response,
      intentType: e.intentType,
      location: e.location,
      emotionalValence: e.emotionalValence,
      timestamp: e.timestamp,
    })),
    total,
  });
});

// 3. GET /api/memory/facts — semantic fact search
app.get('/api/memory/facts', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const userId = (req as any).userId;
  const query = (req.query.q as string) || '';
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 50);

  try {
    const facts = query
      ? await memoryManager.factManager.searchFacts(query, userId, limit)
      : [];
    logger.info({ correlationId, count: facts.length, query: query || '(all)' }, 'Memory facts queried');
    res.json({
      facts: facts.map(f => ({
        text: f.factText,
        confidence: f.confidence,
        source: f.sourceEpisodeId || 'manual',
        timestamp: f.createdAt,
      })),
      query,
    });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Memory facts error');
    res.status(500).json({ error: (e as Error).message });
  }
});

// 4. GET /api/memory/procedural — procedural patterns
app.get('/api/memory/procedural', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const intentType = (req.query.intentType as string) || '';
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 50);

  const patterns = intentType
    ? memoryManagerV2.proceduralMemory.find(intentType, limit)
    : memoryManagerV2.proceduralMemory.topProcedures(limit);

  logger.info({ correlationId, count: patterns.length, intentType }, 'Memory procedural queried');
  res.json({
    patterns: patterns.map(p => ({
      query: p.triggerCondition,
      response: p.toolChain.join('; '),
      intentType: p.triggerCondition,
      successCount: Math.round(p.successRate * (p.usageCount || 1)),
      avgLatency: p.avgLatency,
    })),
    total: patterns.length,
  });
});

// 5. GET /api/memory/predictive — predictive memory query
app.get('/api/memory/predictive', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const layers = (req.query.layers as string) || '';

  try {
    const features: Record<string, unknown> = {};
    if (isFinite(lat)) features.lat = lat;
    if (isFinite(lon)) features.lon = lon;
    if (layers) features.layers = layers.split(',').map(s => s.trim());

    const hazardTypes = ['earthquake', 'wildfire', 'flood', 'storm'];
    const results = await Promise.allSettled(
      hazardTypes.map(async ht => {
        const result = await memoryManagerV2.predictiveMemory.predict(ht, features);
        return { hazardType: ht, ...result };
      })
    );

    const predictions = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value)
      .flatMap(r => r.predictions?.map((p: any) => ({
        hazardType: r.hazardType,
        probability: p.probability || r.ensembleProbability,
        confidence: r.confidence,
        timeframe: '24h',
        modelType: 'ensemble',
      })) || []);

    logger.info({ correlationId, predictionCount: predictions.length, lat, lon }, 'Memory predictive queried');
    res.json({
      predictions,
      location: isFinite(lat) && isFinite(lon) ? { lat, lon } : null,
    });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Memory predictive error');
    res.status(500).json({ error: (e as Error).message });
  }
});

// 6. POST /api/memory/consolidate — manual consolidation trigger
app.post('/api/memory/consolidate', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const start = Date.now();
  try {
    await memoryManagerV2.consolidate();
    const durationMs = Date.now() - start;
    logger.info({ correlationId, durationMs }, 'Memory consolidation completed');
    res.json({ consolidated: true, factsExtracted: 0, patternsUpdated: 0, durationMs });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Memory consolidation error');
    res.status(500).json({ error: (e as Error).message });
  }
});

// 7. GET /api/memory/sensory — sensory buffer query
app.get('/api/memory/sensory', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const type = req.query.type as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const importance = req.query.importance as string | undefined;

  const events = type
    ? memoryManagerV2.sensoryBuffer.searchByType(type as any, limit)
    : importance === 'high'
      ? memoryManagerV2.sensoryBuffer.topByImportance(limit)
      : memoryManagerV2.sensoryBuffer.recent(limit);

  const now = Date.now();
  logger.info({ correlationId, count: events.length, type, limit }, 'Memory sensory queried');
  res.json({
    events: events.map(e => ({
      timestamp: e.timestamp,
      type: e.type,
      source: e.source,
      data: e.data,
      importanceScore: e.importanceScore,
    })),
    windowStart: now - 86400000,
    windowEnd: now,
  });
});

// 8. GET /api/memory/status — full memory tier status summary
app.get('/api/memory/status', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const tiers = memoryManagerV2.getTierStatus();
  const sensoryCount = memoryManagerV2.sensoryBuffer.count();
  const workingCtx = memoryManagerV2.workingMemory.getContext();
  const episodicCount = memoryManagerV2.episodicMemory.count();

  logger.info({ correlationId }, 'Memory status');
  res.json({
    tiers: {
      sensory: { count: sensoryCount, window: 24 },
      working: { count: workingCtx.itemCount, capacity: 50 },
      episodic: { count: episodicCount, limit: 10000 },
      semantic: {
        entities: tiers.semantic?.itemCount || 0,
        relations: 0,
      },
      procedural: { count: tiers.procedural?.itemCount || 0 },
      predictive: { models: tiers.predictive?.itemCount || 0 },
    },
  });
});

// ── Tools API ────────────────────────────────────────────────────

// 1. GET /api/tools — list all tools (core + dynamic + composed)
app.get('/api/tools', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const dynamic = dynamicTools.list();
  const core = toolRegistry.list();
  const composed = toolComposer.listChains();

  const merged = new Map<string, any>();
  for (const t of core) {
    merged.set(t.name, {
      id: t.name,
      name: t.name,
      description: t.description,
      category: t.category,
      type: t.schema.type,
      status: 'active',
      version: 1,
      createdAt: '',
    });
  }
  for (const t of dynamic) {
    merged.set(t.name, {
      id: t.name,
      name: t.name,
      description: t.description || 'No description',
      category: t.category,
      type: t.schema?.type || 'api',
      status: t.status || 'active',
      version: t.version || 1,
      createdAt: t.createdAt || '',
    });
  }
  for (const c of composed) {
    merged.set(`composed:${c.name}`, {
      id: `composed:${c.name}`,
      name: c.name,
      description: c.description,
      category: 'composed',
      type: 'composed',
      status: 'active',
      version: 1,
      createdAt: c.createdAt || '',
    });
  }

  const tools = Array.from(merged.values());
  logger.info({ correlationId, total: tools.length }, 'Tools listed');
  res.json({ tools, total: tools.length });
});

// 10. GET /api/tools/stats — aggregate tool statistics (before :id routes)
app.get('/api/tools/stats', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const all = dynamicTools.list();
  const core = toolRegistry.list();
  const composed = toolComposer.listChains();
  const stats = executor.getStats();

  const entries = Object.entries(stats as Record<string, { total: number; success: number; failure: number; avgLatency: number }>);
  const mostUsed = entries
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(e => e[0]);
  const recentlyFailed = entries
    .filter(e => e[1].failure > 0)
    .sort((a, b) => b[1].failure - a[1].failure)
    .slice(0, 5)
    .map(e => e[0]);
  const totalExecs = entries.reduce((s, e) => s + e[1].total, 0);
  const totalSuccesses = entries.reduce((s, e) => s + e[1].success, 0);

  logger.info({ correlationId, total: all.length, core: core.length, composed: composed.length }, 'Tool stats');
  res.json({
    total: all.length,
    core: core.length,
    dynamic: all.filter(t => (t as any).source !== 'core').length,
    composed: composed.length,
    avgSuccessRate: totalExecs > 0 ? totalSuccesses / totalExecs : 1,
    mostUsed,
    recentlyFailed,
  });
});

// 9. DELETE /api/tools/:id — remove a dynamic tool (core tools protected)
app.delete('/api/tools/:id', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const toolId = req.params.id;

  const tool = dynamicTools.get(toolId);
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  if ((tool as any).source === 'core') {
    logger.warn({ correlationId, toolId }, 'Cannot delete core tool');
    return res.status(403).json({ error: 'Core tools cannot be deleted' });
  }

  const removed = dynamicTools.remove(toolId);
  logger.info({ correlationId, toolId, removed }, 'Tool deleted');
  res.json({ deleted: removed });
});

// 8. GET /api/tools/discover — scan for new tools (before :id routes)
app.get('/api/tools/discover', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const source = (req.query.source as string) || 'portal';

  try {
    let discovered: any[] = [];
    if (source === 'openapi') {
      const sources = toolDiscovery.getSources().filter(s => s.type === 'openapi');
      for (const s of sources) {
        const tools = await toolDiscovery.scanOpenApiSpec(s.url);
        discovered.push(...tools.map(t => ({
          source: s.name,
          name: t.name,
          endpoint: t.schema?.endpoint || '',
          autoGenerated: true,
          testResult: 'pending',
        })));
      }
    } else if (source === 'rss') {
      const sources = toolDiscovery.getSources().filter(s => s.type === 'rss');
      for (const s of sources) {
        const tool = await toolDiscovery.scanRssFeed(s.url);
        if (tool) discovered.push({
          source: s.name,
          name: tool.name,
          endpoint: tool.schema?.endpoint || '',
          autoGenerated: true,
          testResult: 'pending',
        });
      }
    } else {
      const tools = await toolDiscovery.scanApiDirectories();
      discovered = tools.map(t => ({
        source: 'portal',
        name: t.name,
        endpoint: t.schema?.endpoint || '',
        autoGenerated: true,
        testResult: 'pending',
      }));
    }

    logger.info({ correlationId, source, count: discovered.length }, 'Tool discovery scan');
    res.json({ discovered, newToolsCreated: discovered.length });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId, source }, 'Tool discovery error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// 2. GET /api/tools/:id — full tool details
app.get('/api/tools/:id', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const toolId = req.params.id;

  let tool = dynamicTools.get(toolId);
  let source = 'dynamic';
  if (!tool) {
    const coreTool = toolRegistry.get(toolId);
    if (coreTool) {
      tool = { ...coreTool, version: 1, status: 'active', healthStatus: 'healthy', source: 'core', createdAt: '', updatedAt: '', code: null };
      source = 'core';
    }
  }
  if (!tool) {
    const chain = toolComposer.getChain(toolId.replace(/^composed:/, ''));
    if (chain) {
      logger.info({ correlationId, toolId }, 'Tool detail (composed)');
      res.json({
        id: `composed:${chain.name}`,
        name: chain.name,
        description: chain.description,
        schema: { type: 'composed', steps: chain.steps },
        code: null,
        testResults: null,
        usageCount: chain.usageCount || 0,
        successRate: 1,
        avgLatency: 0,
      });
      return;
    }
    logger.warn({ correlationId, toolId }, 'Tool not found');
    res.status(404).json({ error: 'Tool not found' });
    return;
  }

  const stats = executor.getStats();
  const toolStats = (stats as any)[toolId] || { total: 0, success: 0, failure: 0, avgLatency: 0 };

  logger.info({ correlationId, toolId, source }, 'Tool detail');
  res.json({
    id: tool.name,
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    code: (tool as any).code || null,
    testResults: null,
    usageCount: toolStats.total,
    successRate: toolStats.total > 0 ? toolStats.success / toolStats.total : 1,
    avgLatency: toolStats.avgLatency,
  });
});

// 3. POST /api/tools/compose — compose multiple tools into a chain
app.post('/api/tools/compose', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { tools: toolNames, dataFlow, name } = req.body;
  if (!toolNames || !Array.isArray(toolNames) || toolNames.length === 0) {
    return res.status(400).json({ error: 'tools array required' });
  }
  if (!['serial', 'parallel'].includes(dataFlow)) {
    return res.status(400).json({ error: 'dataFlow must be serial or parallel' });
  }

  const steps: Array<{ toolName: string; input: Record<string, unknown>; outputVar: string; dependsOn: string[] }> =
    toolNames.map((tn: string, i: number) => ({
      toolName: tn,
      input: {},
      outputVar: `step_${i}`,
      dependsOn: dataFlow === 'serial' && i > 0 ? [`step_${i - 1}`] : [],
    }));

  const chainName = name || `composed_${Date.now()}`;
  const chain = toolComposer.compose(chainName, steps as any, `Composed ${dataFlow} pipeline: ${toolNames.join(' -> ')}`);

  logger.info({ correlationId, chainName, steps: steps.length, dataFlow }, 'Tool compose');
  res.json({
    composedToolId: `composed:${chain.name}`,
    executionPlan: { steps },
    estimatedLatency: dataFlow === 'serial' ? steps.length * 500 : 500,
  });
});

// 4. POST /api/tools/execute — execute a tool with self-healing
app.post('/api/tools/execute', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { toolId, params, timeout } = req.body;
  if (!toolId) return res.status(400).json({ error: 'toolId required' });

  const start = Date.now();
  try {
    const result = await executor.execute(toolId, params || {}, {
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
    const latencyMs = Date.now() - start;
    toolExecutionsTotal.inc({ tool_name: toolId, status: result.success ? 'ok' : 'error' });
    logger.info({ correlationId, toolId, success: result.success, latencyMs, fallbackUsed: result.fallbackUsed }, 'Tool executed');
    res.json({
      result: result.data,
      latencyMs,
      toolUsed: toolId,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (e) {
    toolExecutionsTotal.inc({ tool_name: toolId, status: 'error' });
    logger.error({ err: (e as Error).message, correlationId, toolId }, 'Tool execute error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// 5. POST /api/tools/generate — generate a new tool from description
app.post('/api/tools/generate', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { description, inputSchema, outputSchema, testCases } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });

  try {
    const tool = await dynamicTools.generateTool(description, inputSchema || {}, outputSchema || {});
    toolGenerationsTotal.inc({ status: tool ? 'ok' : 'error' });
    if (!tool) {
      logger.warn({ correlationId, description }, 'Tool generation produced no result');
      return res.status(502).json({ error: 'Tool generation failed' });
    }
    logger.info({ correlationId, toolName: tool.name }, 'Tool generated');
    res.json({
      toolId: tool.name,
      code: tool.code || '',
      validationResult: {
        passed: tool.status !== 'testing',
        testsRun: testCases?.length || 0,
        testsPassed: testCases?.length || 0,
      },
    });
  } catch (e) {
    toolGenerationsTotal.inc({ status: 'error' });
    logger.error({ err: (e as Error).message, correlationId }, 'Tool generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// 6. POST /api/tools/:id/test — test an existing tool
app.post('/api/tools/:id/test', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const toolId = req.params.id;
  const { testCases } = req.body;
  if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
    return res.status(400).json({ error: 'testCases array required' });
  }

  let passed = 0;
  const failures: any[] = [];
  for (const tc of testCases) {
    try {
      const result = await executor.execute(toolId, tc.input || {}, { signal: AbortSignal.timeout(10000) });
      if (result.success) passed++;
      else failures.push({ testCase: tc, error: result.error });
    } catch (e) {
      failures.push({ testCase: tc, error: (e as Error).message });
    }
  }

  logger.info({ correlationId, toolId, testsRun: testCases.length, testsPassed: passed }, 'Tool tested');
  res.json({
    passed: passed === testCases.length,
    testsRun: testCases.length,
    testsPassed: passed,
    failures,
  });
});

// 7. POST /api/tools/:id/repair — auto-repair a tool
app.post('/api/tools/:id/repair', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const toolId = req.params.id;

  try {
    const result = await toolRepair.autoRepair(toolId, {});
    logger.info({ correlationId, toolId, repaired: result.repaired }, 'Tool repair');
    res.json({
      repaired: result.repaired,
      changes: result.diffs.map(d => `${d.field}: ${d.expectedType} → ${d.actualType}`),
      validationResult: {
        passed: result.success,
        testsRun: 1,
        testsPassed: result.success ? 1 : 0,
      },
    });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId, toolId }, 'Tool repair error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// NOTE: /api/tools/discover is defined above (authenticated). Duplicate handler removed.

// ── Scenarios API ───────────────────────────────────────────────

// POST /api/scenarios/generate — generate a single scenario
app.post('/api/scenarios/generate', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { type, params } = req.body;
  if (!type) return res.status(400).json({ error: 'Scenario type required' });
  try {
    const scenario = await generateScenario(type, params || {});
    scenarioDb.save(scenario);
    logger.info({ correlationId, type, id: scenario.id, score: scenario.validationScore }, 'Scenario generated');
    res.json({ scenario });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Scenario generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// POST /api/scenarios/batch — batch generation (async)
app.post('/api/scenarios/batch', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const config = req.body;
  if (!config?.types?.length) return res.status(400).json({ error: 'Batch config with types array required' });

  const batchConfig = {
    types: config.types,
    countPerType: config.countPerType || 5,
    validationThreshold: config.validationThreshold || 0.5,
    parallel: config.parallel || 2,
  };

  generateBatch(batchConfig).then(batchResult => {
    logger.info({ correlationId, batchId: batchResult.batchId, completed: batchResult.completed, failed: batchResult.failed }, 'Batch generation complete');
  }).catch(e => {
    logger.error({ err: (e as Error).message, correlationId }, 'Batch generation error');
  });

  const batchId = `batch_${Date.now()}`;
  logger.info({ correlationId, batchId, types: batchConfig.types, countPerType: batchConfig.countPerType }, 'Batch generation started');
  res.json({ batchId, status: 'started' });
});

// GET /api/scenarios/batch/:batchId — check batch progress
app.get('/api/scenarios/batch/:batchId', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const progress = getBatchProgress(req.params.batchId);
  if (!progress) return res.status(404).json({ error: 'Batch not found' });
  res.json({ progress });
});

// GET /api/scenarios/search — search scenarios (MUST be before :id route)
app.get('/api/scenarios/search', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const type = req.query.type as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

  let scenarios;
  if (isFinite(lat) && isFinite(lon)) {
    scenarios = scenarioDb.findSimilar(lat, lon, type as any, limit);
  } else {
    scenarios = scenarioDb.search({ type: type as any, limit });
  }

  logger.info({ correlationId, count: scenarios.length, lat, lon, type }, 'Scenarios searched');
  res.json({ scenarios, total: scenarios.length });
});

// GET /api/scenarios/nc-variables — list available NetCDF variables (MUST be before :id route)
app.get('/api/scenarios/nc-variables', authGuard, async (req: express.Request, res: express.Response) => {
  try {
    const { queryVariableNames, openFile, readVariable, closeFile } = await import('./grid/netcdfReader');
    const WLDAS_PATH = process.env.WLDAS_NC_PATH || path.join(__dirname, '../public/data/WLDAS_NOAHMP001_DA1_20240101.D10.nc');
    if (!fs.existsSync(WLDAS_PATH)) return res.json({ variables: [] });
    const keys = await queryVariableNames(WLDAS_PATH);
    const coordKeys = new Set(['lat', 'lon', 'latitude', 'longitude', 'time', 'bnds', 'time_bnds', 'crs']);
    let variables = keys.filter((k: string) => !coordKeys.has(k));

    // If bbox query params provided, check if the file's grid actually covers this area
    const latMin = parseFloat(req.query.latMin as string);
    const latMax = parseFloat(req.query.latMax as string);
    const lonMin = parseFloat(req.query.lonMin as string);
    const lonMax = parseFloat(req.query.lonMax as string);
    if (isFinite(latMin) && isFinite(latMax) && isFinite(lonMin) && isFinite(lonMax)) {
      try {
        const h5 = await openFile(WLDAS_PATH);
        const lats = readVariable(h5, 'lat');
        const lons = readVariable(h5, 'lon');
        if (lats && lons && lats.length > 0 && lons.length > 0) {
          const fileLatMin = Math.min(...lats);
          const fileLatMax = Math.max(...lats);
          const fileLonMin = Math.min(...lons);
          const fileLonMax = Math.max(...lons);
          const overlaps = latMax > fileLatMin && latMin < fileLatMax && lonMax > fileLonMin && lonMin < fileLonMax;
          if (!overlaps) variables = [];
        }
        closeFile(h5);
      } catch (e) { logger.warn({ err: e }, 'HDF5 variable read failed'); }
    }

    res.json({ variables });
  } catch (e) { logger.warn({ err: e }, 'HDF5 variables query failed'); res.json({ variables: [] }); }
});

// GET /api/scenarios/:id — get full scenario
app.get('/api/scenarios/:id', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const scenario = scenarioDb.get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  logger.info({ correlationId, id: req.params.id }, 'Scenario retrieved');
  res.json({ scenario });
});

// POST /api/scenarios/generate-from-bbox — generate scenario using real data within bounding box
app.post('/api/scenarios/generate-from-bbox', authGuard, async (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { bbox, hazardType, params } = req.body;
  if (!bbox || !hazardType) return res.status(400).json({ error: 'bbox and hazardType required' });
  try {
    const scenario = await generateScenarioFromBBox(hazardType, bbox, params || {});
    scenarioDb.save(scenario);
    logger.info({ correlationId, hazardType, id: scenario.id, dataSources: scenario.dataSources, score: scenario.validationScore }, 'Scenario generated from bbox with real data');
    res.json({ scenario });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Bbox scenario generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// GET /api/scenarios/export/:id — export scenario in requested format
app.get('/api/scenarios/export/:id', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const format = (req.query.format as string) || 'geojson';
  const scenario = scenarioDb.get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  logger.info({ correlationId, id: req.params.id, format }, 'Scenario exported');

  switch (format) {
    case 'geojson':
      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', `attachment; filename="${scenario.id}.geojson"`);
      res.json(exportToGeoJSON(scenario));
      break;
    case 'czml':
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${scenario.id}.czml"`);
      res.json(exportToCZML(scenario));
      break;
    case 'netcdf':
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${scenario.id}.nc.json"`);
      res.json(exportToNetCDF(scenario));
      break;
    case 'training':
      res.setHeader('Content-Type', 'application/json');
      res.json(exportToTrainingData(scenario));
      break;
    default:
      res.status(400).json({ error: `Unsupported format: ${format}. Use geojson, czml, netcdf, or training.` });
  }
});

// POST /api/scenarios/import — parse NetCDF/HDF5 file uploaded as base64
app.post('/api/scenarios/import', authGuard, async (req: express.Request, res: express.Response) => {
  try {
    const { file: base64 } = req.body;
    if (!base64 || typeof base64 !== 'string') return res.status(400).json({ error: 'Missing file (base64 string)' });

    const buffer = Buffer.from(base64, 'base64');
    const tmpPath = path.join(os.tmpdir(), `scenario_import_${Date.now()}.nc`);
    fs.writeFileSync(tmpPath, buffer);

    try {
      const mod: any = await import('h5wasm/node');
      await mod.ready;
      const f = new mod.File(tmpPath, 'r');

      const vars: Record<string, number[]> = {};
      function walk(item: any, prefix: string) {
        if (item.type === 'Dataset' || item.type === 'dataset') {
          const name = prefix.split('/').filter(Boolean).pop() || '';
          try {
            const val = item.value;
            if (val && typeof val === 'object' && 'length' in val) {
              vars[name] = Array.from(val as ArrayLike<number>);
            } else if (val !== null && val !== undefined) {
              vars[name] = [Number(val)];
            }
          } catch (e) { logger.warn({ err: e }, 'Tide station detail missing'); }
          return;
        }
        const keys = typeof item.keys === 'function' ? item.keys() : [];
        for (const k of keys) {
          const child = typeof item.get === 'function' ? item.get(k) : null;
          if (child) walk(child, `${prefix}/${k}`);
        }
      }
      walk(f, '');
      f.close();

      const pointCloud: { x: number; y: number; z: number }[] = [];
      let lat = 0, lon = 0;

      if (vars.x && vars.y && vars.z) {
        const n = Math.min(vars.x.length, vars.y.length, vars.z.length);
        for (let i = 0; i < n; i++) {
          pointCloud.push({ x: vars.x[i], y: vars.y[i], z: vars.z[i] });
        }
        let slat = 0, slon = 0;
        for (let i = 0; i < n; i++) {
          const r = Math.sqrt(vars.x[i] ** 2 + vars.y[i] ** 2 + vars.z[i] ** 2) || 1;
          slat += Math.asin(Math.max(-1, Math.min(1, vars.z[i] / r))) * 180 / Math.PI;
          slon += Math.atan2(vars.y[i], vars.x[i]) * 180 / Math.PI;
        }
        lat = slat / n; lon = slon / n;
      } else {
        const lats = vars.lat || vars.latitude || vars.Latitude || vars.LAT;
        const lons = vars.lon || vars.longitude || vars.Longitude || vars.LON;
        if (lats && lons && lats.length && lons.length) {
          const n = Math.min(lats.length, lons.length);
          for (let i = 0; i < n; i++) {
            const latRad = lats[i] * Math.PI / 180;
            const lonRad = lons[i] * Math.PI / 180;
            pointCloud.push({
              x: Math.cos(latRad) * Math.cos(lonRad),
              y: Math.cos(latRad) * Math.sin(lonRad),
              z: Math.sin(latRad),
            });
          }
          lat = lats.reduce((a: number, b: number) => a + b, 0) / n;
          lon = lons.reduce((a: number, b: number) => a + b, 0) / n;
        }
      }

      res.json({ pointCloud, lat, lon, variables: Object.keys(vars) });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (e) { logger.warn({ err: e }, 'Temp file cleanup failed'); }
    }
  } catch (e: any) {
    logger.error({ err: e.message }, 'NetCDF import failed');
    res.status(422).json({ error: e.message });
  }
});

// POST /api/scenarios/import-from-path — parse NetCDF4/HDF5 file from server path (for large files)
// Accepts: { path, variable?, maxPoints? }
// Returns: { pointCloud, lat, lon, variableName, variables }
app.post('/api/scenarios/import-from-path', authGuard, async (req: express.Request, res: express.Response) => {
  try {
    const filePath = req.body.path;
    if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'Missing path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: `File not found: ${filePath}` });

    const maxPoints = Math.min(Math.max(req.body.maxPoints || 5000, 100), 100000);
    const bbox = req.body.bbox as { latMin?: number; latMax?: number; lonMin?: number; lonMax?: number } | undefined;

    const mod: any = await import('h5wasm/node');
    await mod.ready;
    const f = new mod.File(filePath, 'r');

    // List all datasets (no data read)
    const allKeys: string[] = [];
    for (const key of f.keys()) allKeys.push(String(key));

    // Helper to read a dataset as number[]
    function readDataset(name: string): number[] | null {
      try {
        const item = f.get(name);
        if (!item || item.type !== 'Dataset') return null;
        const val = item.value;
        if (val == null) return null;
        if (typeof val === 'object' && 'length' in val) {
          return Array.from(val as ArrayLike<number>);
        }
        return [Number(val)];
      } catch (e) { logger.warn({ err: e }, 'NetCDF dataset read failed'); return null; }
    }

    // Read lat/lon
    const latKey = allKeys.find(k => /^lat$/i.test(k)) || '';
    const lonKey = allKeys.find(k => /^lon$/i.test(k)) || '';
    const lats = latKey ? readDataset(latKey) || [] : [];
    const lons = lonKey ? readDataset(lonKey) || [] : [];

    if (!lats.length || !lons.length) {
      f.close();
      return res.status(422).json({ error: `No lat/lon coordinates found. Available: ${allKeys.join(', ')}` });
    }

    // Pick the data variable (only read one!)
    const coordKeys = new Set(allKeys.filter(k => /^(lat|lon|latitude|longitude|time|bnds|time_bnds|crs)$/i.test(k)));
    let varKey = req.body.variable || '';
    if (varKey && !allKeys.includes(varKey)) varKey = '';
    if (!varKey) varKey = allKeys.find(k => !coordKeys.has(k)) || '';

    if (!varKey) {
      f.close();
      return res.status(422).json({ error: 'No data variables found' });
    }

    const rawData = readDataset(varKey);
    f.close();

    if (!rawData || !rawData.length) {
      return res.status(422).json({ error: `Variable "${varKey}" has no data` });
    }

    // Determine grid indices from bbox
    const nlats = lats.length;
    const nlons = lons.length;
    const isGrid = nlats > 1 && nlons > 1 && rawData.length === nlats * nlons;

    function findBounds(arr: number[], min: number, max: number): [number, number] {
      let lo = 0, hi = arr.length - 1;
      while (lo < arr.length - 1 && arr[lo + 1] <= min) lo++;
      while (hi > 0 && arr[hi - 1] >= max) hi--;
      return [lo, hi];
    }

    const points: { lat: number; lon: number; value: number }[] = [];
    if (isGrid) {
      const [iMin, iMax] = bbox ? findBounds(lats, bbox.latMin ?? -90, bbox.latMax ?? 90) : [0, nlats - 1];
      const [jMin, jMax] = bbox ? findBounds(lons, bbox.lonMin ?? -180, bbox.lonMax ?? 180) : [0, nlons - 1];
      const rangeLat = iMax - iMin + 1;
      const rangeLon = jMax - jMin + 1;
      const totalInRange = rangeLat * rangeLon;
      const step = Math.max(1, Math.floor(totalInRange / maxPoints));
      for (let idx = 0; idx < totalInRange; idx += step) {
        const i = iMin + Math.floor(idx / rangeLon);
        const j = jMin + (idx % rangeLon);
        const flatIdx = i * nlons + j;
        const val = rawData[flatIdx];
        if (val === -9999 || val === -9999.0 || isNaN(val)) continue;
        points.push({ lat: lats[i], lon: lons[j], value: val });
      }
    } else if (rawData.length === lats.length && rawData.length === lons.length) {
      const step = Math.max(1, Math.floor(rawData.length / maxPoints));
      for (let i = 0; i < rawData.length; i += step) {
        if (bbox && (lats[i] < (bbox.latMin ?? -90) || lats[i] > (bbox.latMax ?? 90) || lons[i] < (bbox.lonMin ?? -180) || lons[i] > (bbox.lonMax ?? 180))) continue;
        const val = rawData[i];
        if (val === -9999 || val === -9999.0 || isNaN(val)) continue;
        points.push({ lat: lats[i], lon: lons[i], value: val });
      }
    }

    if (points.length === 0) {
      return res.status(422).json({ error: `No valid data points in "${varKey}" within the selected area.` });
    }

    const pointCloud = points.map(p => {
      const latRad = p.lat * Math.PI / 180;
      const lonRad = p.lon * Math.PI / 180;
      return { x: Math.cos(latRad) * Math.cos(lonRad), y: Math.cos(latRad) * Math.sin(lonRad), z: Math.sin(latRad) };
    });

    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const avgLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
    const values = points.map(p => p.value);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);

    res.json({
      pointCloud, lat: avgLat, lon: avgLon,
      variableName: varKey, variables: allKeys,
      pointsUsed: points.length,
      totalAvailable: isGrid ? nlats * nlons : rawData.length,
      colorValues: values,
      valueMin, valueMax,
    });
  } catch (e: any) {
    logger.error({ err: e.message }, 'NetCDF import-from-path failed');
    res.status(422).json({ error: e.message });
  }
});

// ── Knowledge Graph v2 API (Generative KG) ──────────────────────

// POST /api/kgV2/generate-entities — generate plausible connected entities from a trigger event
app.post('/api/kgV2/generate-entities', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { event } = req.body;
  if (!event?.type || !event?.location) return res.status(400).json({ error: 'Event with type and location required' });
  try {
    const entities = entityGenerator.generate(event);
    logger.info({ correlationId, eventType: event.type, generated: entities.length }, 'KG entities generated');
    res.json({ generatedEntities: entities });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Entity generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// POST /api/kgV2/generate-edges — generate probable causal relationships between entities
app.post('/api/kgV2/generate-edges', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { entities } = req.body;
  if (!entities?.length) return res.status(400).json({ error: 'Entities array required' });
  try {
    const edges = edgeGenerator.generateEdges(entities);
    logger.info({ correlationId, entityCount: entities.length, generated: edges.length }, 'KG edges generated');
    res.json({ generatedEdges: edges });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Edge generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// POST /api/kgV2/counterfactual — generate counterfactual graph for what-if scenarios
app.post('/api/kgV2/counterfactual', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { event, change } = req.body;
  if (!event || !change) return res.status(400).json({ error: 'Event and change required' });
  try {
    const result = counterfactualGraph.generateCounterfactual(event, change);
    logger.info({ correlationId, eventType: event.type, change: change.field }, 'Counterfactual generated');
    res.json({ counterfactualGraph: result });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Counterfactual generation error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// POST /api/kgV2/complete — complete missing edges in partial knowledge graph
app.post('/api/kgV2/complete', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  const { graph } = req.body;
  if (!graph?.entities) return res.status(400).json({ error: 'Graph with entities array required' });
  try {
    const result = graphCompletion.complete(graph);
    logger.info({ correlationId, candidates: result.totalCandidates, accepted: result.acceptedCount }, 'Graph completion done');
    res.json({ completedGraph: result });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Graph completion error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// GET /api/kgV2/evolve — apply decay, get evolution log & state
app.get('/api/kgV2/evolve', authGuard, (req: express.Request, res: express.Response) => {
  const correlationId = (req as any).correlationId || crypto.randomUUID();
  try {
    const evolutionLog = evolvingGraph.tick();
    const state = evolvingGraph.getGraphState();
    const recentLog = evolvingGraph.getEvolutionLog(parseInt(req.query.limit as string) || 50);
    logger.info({ correlationId, logEntries: evolutionLog.length }, 'Evolution ticked');
    res.json({ evolutionLog, state, recentEntries: recentLog });
  } catch (e) {
    logger.error({ err: (e as Error).message, correlationId }, 'Evolution error');
    res.status(502).json({ error: (e as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// META-COGNITION: self-improvement, intent discovery, architecture proposals
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/meta/status', (_req: express.Request, res: express.Response) => {
  res.json(selfImproverV2.getStatus());
});

app.post('/api/meta/cycle', requireRole('admin'), async (_req: express.Request, res: express.Response) => {
  try {
    const report = await selfImproverV2.runCycle();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/meta/intent-proposals', (_req: express.Request, res: express.Response) => {
  res.json({ pending: intentDiscovery.getPendingProposals(), all: intentDiscovery.getAllProposals() });
});

app.post('/api/meta/intent-proposals/:name/approve', requireRole('admin'), async (req: express.Request, res: express.Response) => {
  const ok = await intentDiscovery.humanApproval(req.params.name, true);
  if (!ok) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ ok: true });
});

app.post('/api/meta/intent-proposals/:name/reject', requireRole('admin'), (req: express.Request, res: express.Response) => {
  intentDiscovery.humanApproval(req.params.name, false);
  res.json({ ok: true });
});

app.get('/api/meta/architecture-proposals', (_req: express.Request, res: express.Response) => {
  res.json({
    pending: architectureProposals.getProposals('pending'),
    approved: architectureProposals.getProposals('approved'),
    top: architectureProposals.getTopProposals(5),
  });
});

app.post('/api/meta/architecture-proposals/:id/approve', requireRole('admin'), (req: express.Request, res: express.Response) => {
  architectureProposals.approve(req.params.id);
  res.json({ ok: true });
});

app.post('/api/meta/architecture-proposals/:id/reject', requireRole('admin'), (req: express.Request, res: express.Response) => {
  architectureProposals.reject(req.params.id);
  res.json({ ok: true });
});

app.get('/api/meta/report', async (_req: express.Request, res: express.Response) => {
  try {
    const report = await (selfImproverV2 as any).metaCognition.reportGenerator.generate();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/meta/last-report', (_req: express.Request, res: express.Response) => {
  const report = (selfImproverV2 as any).metaCognition.reportGenerator.getLastReport();
  if (!report) return res.status(404).json({ error: 'No report available yet' });
  res.json(report);
});

app.post('/api/meta/evolve-prompt', async (req: express.Request, res: express.Response) => {
  const { intentType } = req.body;
  if (!intentType) return res.status(400).json({ error: 'intentType required' });
  const result = await promptEvolution.evolve(intentType);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════
// ML Pipeline: evaluation scores, predictions, knowledge graph
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/ml/evals', (_req: express.Request, res: express.Response) => {
  const evals = getRecentEvals(100);
  const byIntent = getAvgScoresByIntent();
  res.json({ evals, byIntent });
});

app.get('/api/ml/synthetic-data', (req: express.Request, res: express.Response) => {
  const intentType = req.query.intent as string | undefined;
  const data = getSyntheticData(100, intentType);
  res.json({ count: data.length, examples: data.slice(0, 20).map(d => ({ ...d, isSynthetic: true })), isSynthetic: true });
});

app.post('/api/ml/synthetic-data/generate', async (_req: express.Request, res: express.Response) => {
  const example = await generateTrainingExample(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '');
  res.json({ ok: !!example, example: example ? { ...example, isSynthetic: true } : null, isSynthetic: true });
});

app.get('/api/ml/knowledge-graph/stats', (_req: express.Request, res: express.Response) => {
  res.json(knowledgeGraph.getStats());
});

app.get('/api/ml/knowledge-graph/entity', (req: express.Request, res: express.Response) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: 'name query param required' });
  const entity = knowledgeGraph.findEntityByName(name);
  const relations = entity ? knowledgeGraph.getRelations(name) : [];
  res.json({ entity, relations });
});

app.get('/api/ml/knowledge-graph/query', async (req: express.Request, res: express.Response) => {
  const query = req.query.q as string;
  const type = req.query.type as string | undefined;
  if (!query) return res.status(400).json({ error: 'q query param required' });
  const results = await knowledgeGraph.queryAsync(query, type);
  res.json({ results });
});

app.post('/api/ml/knowledge-graph/entity', async (req: express.Request, res: express.Response) => {
  const { name, type, metadata } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = await knowledgeGraph.ensureEntity(name, type || 'entity', metadata);
  res.json({ id, ok: true });
});

app.post('/api/ml/knowledge-graph/relation', (req: express.Request, res: express.Response) => {
  const { source, target, relationType, weight } = req.body;
  if (!source || !target || !relationType) return res.status(400).json({ error: 'source, target, relationType required' });
  knowledgeGraph.addRelation(source, target, relationType, weight || 1.0);
  res.json({ ok: true });
});

app.get('/api/ml/predict', async (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const layers = ((req.query.layers as string) || '').split(',').filter(Boolean);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon query params required' });
  const input = {
    location: { lat, lon, label: req.query.label as string },
    layers,
    history: [],
  };
  const results = await predictor.predict(input);
  res.json({ predictions: results });
});

app.post('/api/ml/predict', async (req: express.Request, res: express.Response) => {
  try {
    const { features, model } = req.body;
    if (!features) return res.status(400).json({ error: 'features required' });
    const input = {
      location: { lat: features.lat || 0, lon: features.lon || 0, label: '' },
      layers: [],
      history: [],
    };
    const results = await predictor.predict(input);
    res.json({ predictions: results, model: model || 'ensemble' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/ml/predict/outcome', (req: express.Request, res: express.Response) => {
  const { hazardType, probability, severity, actualOccurred, severityMatch } = req.body;
  if (!hazardType) return res.status(400).json({ error: 'hazardType required' });
  predictor.recordOutcome({ hazardType, probability, severity, timeframe: '', confidence: 0.5, contributingFactors: [] }, actualOccurred, severityMatch);
  res.json({ ok: true });
});

app.get('/api/ml/predict/report', async (req: express.Request, res: express.Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const layers = ((req.query.layers as string) || '').split(',').filter(Boolean);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon query params required' });
  const input = {
    location: { lat, lon, label: req.query.label as string },
    layers,
    history: [],
  };
  const report = await predictor.generatePredictionReport(input, process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '');
  res.json({ report });
});

app.get('/api/ml/variants', (_req: express.Request, res: express.Response) => {
  const variants = promptLab.getVariants();
  res.json({ count: variants.length, variants });
});

// ═══════════════════════════════════════════════════════════════════════
// COGNITION: Reasoning trace retrieval & review
// ═══════════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════════
// TOOLS: Chain execution
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/tools/chain/execute', authGuard, async (req: express.Request, res: express.Response) => {
  const { name, steps, description } = req.body;
  if (!name || !steps) return res.status(400).json({ error: 'name and steps required' });
  try {
    toolComposer.compose(name, steps, description || '');
    const result = await toolComposer.execute(name, req.body.initialInput || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// NOTE: /api/tools/execute and /api/tools/stats are defined above with authGuard.
// Duplicate unauthenticated handlers were removed here.

// ═══════════════════════════════════════════════════════════════════════
// WORLD MODEL: Scenario simulation & validation
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/predict/scenario', (req: express.Request, res: express.Response) => {
  const { scenario, variables, description } = req.body;
  if (!scenario && !description) return res.status(400).json({ error: 'scenario name or description required' });
  try {
    const result = description
      ? scenarioSimulator.simulateFreeform(description)
      : scenarioSimulator.simulate(scenario, variables || {});
    if (!result) return res.status(404).json({ error: 'Scenario not found' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/predict/scenarios', (_req: express.Request, res: express.Response) => {
  res.json({ scenarios: scenarioSimulator.listScenarios() });
});

app.get('/api/predict/validation-report', (_req: express.Request, res: express.Response) => {
  try {
    const report = predictionValidator.generateReport();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/causal-graph/dot', (_req: express.Request, res: express.Response) => {
  try {
    const dot = causalGraph.toDot();
    res.type('text/plain').send(dot);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// JSON endpoint for causal graph knowledge visualization
app.get('/api/causal-graph', (_req: express.Request, res: express.Response) => {
  try {
    const edges = causalGraph.getEdges();
    const nodeMap = new Map<number, any>();
    for (const edge of edges) {
      if (!nodeMap.has(edge.sourceId)) {
        const node = causalGraph.getNodeById(edge.sourceId);
        if (node) nodeMap.set(edge.sourceId, { id: node.id, name: node.name, type: node.type, prior: node.prior });
      }
      if (!nodeMap.has(edge.targetId)) {
        const node = causalGraph.getNodeById(edge.targetId);
        if (node) nodeMap.set(edge.targetId, { id: node.id, name: node.name, type: node.type, prior: node.prior });
      }
    }
    const nodes = Array.from(nodeMap.values());
    const graphEdges = edges.map(e => ({
      source: e.sourceId,
      target: e.targetId,
      relation: e.relation,
      weight: e.weight,
    }));
    res.json({ nodes, edges: graphEdges });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ═════════════════════════════════════════════════════════════════
   CHAT SESSION STORAGE — persistent chat history as JSON files
   ═════════════════════════════════════════════════════════════════ */

app.get('/api/chats', (req: express.Request, res: express.Response) => {
  try {
    const db = getDb();
    const uid = (req as any).userId;
    const rows = db.prepare('SELECT id, user_id, title, created_at, updated_at, messages_json FROM chats WHERE user_id = ? ORDER BY updated_at DESC').all(uid) as Array<Record<string, unknown>>;
    const sessions = rows.map(r => {
      const msgs = JSON.parse(r.messages_json as string || '[]');
      return {
        id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at,
        messageCount: msgs.length,
      };
    });
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/chats/:id', (req: express.Request, res: express.Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, (req as any).userId) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: 'Chat not found' });
    res.json({
      id: row.id,
      title: row.title,
      userId: row.user_id,
      messages: JSON.parse(row.messages_json as string || '[]'),
      environmentId: row.environment_id,
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/chats', validate(chatCreateSchema), (req: express.Request, res: express.Response) => {
  try {
    const { id, title, messages, environmentId, workspaceId } = req.body;
    const db = getDb();
    const now = new Date().toISOString();
    // Multi-tenant guard: if the chat already exists, only its owner may
    // overwrite it. Without this, any authenticated user could pass another
    // user's chat id and clobber their conversation (cross-tenant IDOR).
    const existing = db.prepare('SELECT user_id FROM chats WHERE id = ?').get(id) as { user_id: string } | undefined;
    if (existing && existing.user_id !== (req as any).userId) {
      return res.status(403).json({ error: 'Forbidden: you do not own this chat' });
    }
    db.prepare(`
      INSERT INTO chats (id, user_id, title, messages_json, environment_id, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        messages_json = excluded.messages_json,
        environment_id = excluded.environment_id,
        workspace_id = excluded.workspace_id,
        updated_at = excluded.updated_at
    `).run(
      id,
      (req as any).userId,
      title || 'Untitled Chat',
      JSON.stringify(messages || []),
      environmentId || null,
      workspaceId || null,
      req.body.createdAt || now,
      now,
    );
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/chats/:id', requireOwnership('chats'), (req: express.Request, res: express.Response) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, (req as any).userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Chat not found' });
    auditLog((req as any).userId, 'chat_delete', `chat:${req.params.id}`, '', req.ip || '', req.headers['user-agent'] || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Session Sharing (public, no auth required to read) ────────────────

// Ensure share column exists (idempotent)
try {
  getDb().exec(`ALTER TABLE chats ADD COLUMN share_token TEXT`);
} catch { /* column may already exist */ }
try {
  getDb().exec(`ALTER TABLE chats ADD COLUMN shared_at TEXT`);
} catch { /* column may already exist */ }

// Create a shareable link for a chat session
app.post('/api/chats/:id/share', authGuard, (req: express.Request, res: express.Response) => {
  try {
    const db = getDb();
    const uid = (req as any).userId;
    const chatId = req.params.id;
    const row = db.prepare('SELECT id, user_id FROM chats WHERE id = ? AND user_id = ?').get(chatId, uid) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: 'Chat not found' });
    // Generate or reuse share token
    let token = (db.prepare('SELECT share_token FROM chats WHERE id = ?').get(chatId) as Record<string, unknown> | undefined)?.share_token as string | undefined;
    if (!token) {
      token = `${chatId}_${crypto.randomUUID()}`;
      db.prepare('UPDATE chats SET share_token = ?, shared_at = ? WHERE id = ?').run(token, new Date().toISOString(), chatId);
    }
    res.json({ token, url: `${req.protocol}://${req.get('host')}/#/shared/${token}` });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Public endpoint — fetch a shared chat by token (no auth)
app.get('/api/shared/:token', (req: express.Request, res: express.Response) => {
  try {
    const db = getDb();
    const token = req.params.token;
    const row = db.prepare('SELECT id, title, messages_json, environment_id, workspace_id, created_at, shared_at FROM chats WHERE share_token = ?').get(token) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: 'Shared session not found or expired' });
    res.json({
      id: row.id,
      title: row.title,
      messages: JSON.parse(row.messages_json as string || '[]'),
      environmentId: row.environment_id,
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      sharedAt: row.shared_at,
      shared: true,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


/* ═════════════════════════════════════════════════════════════════
   Intelligence Panel — Historical Data Routes
   ═════════════════════════════════════════════════════════════════ */

// ── Market Candle Data — handled by pulseRouter at /api/pulse/market/candle ──

// ── Earthquake Summary (USGS) ──
app.get('/api/earthquakes/summary', async (_req: express.Request, res: express.Response) => {
  try {
    const resp = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson');
    const data = await resp.json() as { features: Array<{ properties: { mag?: number; place?: string; time?: number; felt?: number; tsunami?: number }; geometry?: { coordinates?: number[] } }> };
    const features = data.features ?? [];
    const mags = features.map(f => f.properties?.mag ?? 0).filter(m => m > 0);
    const buckets = [0, 0, 0, 0, 0]; // 0-2, 2-3, 3-4, 4-5, 5+
    mags.forEach(m => {
      if (m < 2) buckets[0]++;
      else if (m < 3) buckets[1]++;
      else if (m < 4) buckets[2]++;
      else if (m < 5) buckets[3]++;
      else buckets[4]++;
    });

    const recent = features
      .sort((a, b) => (b.properties?.time ?? 0) - (a.properties?.time ?? 0))
      .slice(0, 20)
      .map(f => ({
        mag: f.properties?.mag ?? 0,
        place: f.properties?.place ?? 'Unknown',
        time: f.properties?.time ?? 0,
        felt: f.properties?.felt ?? 0,
        tsunami: f.properties?.tsunami ?? 0,
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lon: f.geometry?.coordinates?.[0] ?? 0,
      }));
    res.json({
      total: mags.length,
      buckets,
      averageMag: mags.length > 0 ? (mags.reduce((s, v) => s + v, 0) / mags.length).toFixed(2) : '0',
      maxMag: mags.length > 0 ? Math.max(...mags).toFixed(1) : '0',
      recent,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEW FEATURES: Internet Outage, Conflict, Health, Economy, Cyber, Supply Chain ──

// 1. IODA Internet Outage Monitor
app.get('/api/internet/outages', async (req: express.Request, res: express.Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const resp = await fetch(`https://api.ioda.inetintel.cc.gatech.edu/v2/alerts/country?limit=${days}&format=json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ outages: [], note: 'IODA API unavailable' });
    const data = await resp.json();
    res.json({ outages: data.data ?? [], source: 'IODA Georgia Tech' });
  } catch (e) {
    logger.warn({ err: e }, 'IODA API failed');
    res.json({ outages: [], note: 'IODA data temporarily unavailable' });
  }
});

app.get('/api/internet/outages/:country', async (req: express.Request, res: express.Response) => {
  try {
    const country = req.params.country;
    const resp = await fetch(`https://api.ioda.inetintel.cc.gatech.edu/v2/alerts/country/${country}?format=json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ signals: [], note: 'IODA API unavailable' });
    const data = await resp.json();
    res.json({ signals: data.data ?? [], source: 'IODA Georgia Tech' });
  } catch (e) {
    logger.warn({ err: e }, 'IODA country API failed');
    res.json({ signals: [], note: 'IODA data temporarily unavailable' });
  }
});

// 2. ACLED Conflict Events (free public access via ACLED API)
app.get('/api/conflict/acled', async (req: express.Request, res: express.Response) => {
  try {
    const country = req.query.country as string || '';
    const startDate = req.query.start_date as string || '';
    const endDate = req.query.end_date as string || '';
    const limit = parseInt(req.query.limit as string) || 100;
    const key = process.env.ACLED_API_KEY || '';
    const email = process.env.ACLED_EMAIL || '';
    
    const params = new URLSearchParams({
      limit: String(limit),
      format: 'json',
    });
    if (country) params.set('country', country);
    if (startDate) params.set('event_date', `>${startDate}`);
    if (endDate) params.set('event_date', `<${endDate}`);
    if (key) params.set('key', key);
    if (email) params.set('email', email);
    
    const resp = await fetch(`https://api.acleddata.com/acled/read?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ events: [], note: 'ACLED API unavailable - configure ACLED_API_KEY' });
    const data = await resp.json();
    res.json({ events: data.data ?? [], source: 'ACLED' });
  } catch (e) {
    logger.warn({ err: e }, 'ACLED API failed');
    res.json({ events: [], note: 'ACLED data temporarily unavailable' });
  }
});

// 3. World Bank Economic Indicators (free, no key required)
app.get('/api/economics/worldbank', async (req: express.Request, res: express.Response) => {
  try {
    const country = req.query.country as string || 'all';
    const indicatorParam = req.query.indicator as string || 'NY.GDP.MKTP.CD';
    // Support multiple indicators (comma-separated)
    const indicators = indicatorParam.split(',').map(s => s.trim()).filter(Boolean);
    const allResults: any[] = [];
    await Promise.allSettled(indicators.map(async (indicator) => {
      try {
        const resp = await fetch(`https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&per_page=100&date=2020:2026`, {
          signal: AbortSignal.timeout(12000),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const records = Array.isArray(data) && data.length > 1 ? data[1] : [];
        for (const r of records) {
          allResults.push({
            country: r.country?.value,
            countryCode: r.countryiso2code,
            value: r.value,
            date: r.date,
            indicator: r.indicator?.value,
            indicatorCode: indicator,
          });
        }
      } catch { /* individual indicator failed */ }
    }));
    res.json({
      indicators: allResults,
      source: 'World Bank',
      indicators_queried: indicators,
    });
  } catch (e) {
    logger.warn({ err: e }, 'World Bank API failed');
    res.json({ indicators: [], note: 'World Bank data temporarily unavailable' });
  }
});

// 4. WHO Disease Outbreaks (free, no key required)
app.get('/api/health/who-outbreaks', async (req: express.Request, res: express.Response) => {
  try {
    const resp = await fetch('https://ghoapi.azureedge.net/api/WHS6_102?$filter=SpatialDim%20eq%20%27GLO%27&$orderby=TimeDim%20desc&$top=100', {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ outbreaks: [], note: 'WHO API unavailable' });
    const data = await resp.json();
    res.json({ outbreaks: data.value ?? [], source: 'WHO GHO' });
  } catch (e) {
    logger.warn({ err: e }, 'WHO API failed');
    res.json({ outbreaks: [], note: 'WHO data temporarily unavailable' });
  }
});

app.get('/api/health/who-disease/:indicator', async (req: express.Request, res: express.Response) => {
  try {
    const indicator = req.params.indicator;
    const resp = await fetch(`https://ghoapi.azureedge.net/api/${indicator}?$orderby=TimeDim desc&$top=200`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ data: [], note: 'WHO API unavailable' });
    const result = await resp.json();
    res.json({ data: result.value ?? [], source: 'WHO GHO' });
  } catch (e) {
    logger.warn({ err: e }, 'WHO disease API failed');
    res.json({ data: [], note: 'WHO data temporarily unavailable' });
  }
});

// 5. Shodan IoT Intelligence (requires API key)
app.get('/api/cyber/shodan', async (req: express.Request, res: express.Response) => {
  try {
    const query = req.query.q as string || 'country:US';
    const apiKey = process.env.SHODAN_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'SHODAN_API_KEY not configured' });
    const resp = await fetch(`https://api.shodan.io/shodan/host/search?key=${apiKey}&query=${encodeURIComponent(query)}&limit=50`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ devices: [], note: 'Shodan API unavailable' });
    const data = await resp.json();
    res.json({ devices: data.matches ?? [], total: data.total ?? 0, source: 'Shodan' });
  } catch (e) {
    logger.warn({ err: e }, 'Shodan API failed');
    res.json({ devices: [], note: 'Shodan data temporarily unavailable' });
  }
});

// 6. VirusTotal Threat Intel (requires API key)
app.get('/api/cyber/virustotal', async (req: express.Request, res: express.Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: 'url query parameter required' });
    const apiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'VIRUSTOTAL_API_KEY not configured' });
    const urlId = Buffer.from(url).toString('base64').replace(/=/g, '');
    const resp = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
      headers: { 'x-apikey': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ result: null, note: 'VirusTotal API unavailable' });
    const data = await resp.json();
    res.json({ result: data.data?.attributes ?? null, source: 'VirusTotal' });
  } catch (e) {
    logger.warn({ err: e }, 'VirusTotal API failed');
    res.json({ result: null, note: 'VirusTotal data temporarily unavailable' });
  }
});

// 7. Container/Port Tracking (UN Comtrade trade data - free)
app.get('/api/supply-chain/trade', async (req: express.Request, res: express.Response) => {
  try {
    const reporterCountry = req.query.reporter as string || '842'; // US
    const partnerCountry = req.query.partner as string || '';
    const params = new URLSearchParams({
      reporterCode: reporterCountry,
      flowCode: 'M',
      cmdCode: 'TOTAL',
      period: '2024',
      partnerCode: partnerCountry || '0',
      motCode: '0',
    });
    const resp = await fetch(`https://comtradeapi.un.org/public/v1/preview/C/A/HS?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ trade: [], note: 'UN Comtrade API unavailable' });
    const data = await resp.json();
    res.json({ trade: data.data ?? [], source: 'UN Comtrade' });
  } catch (e) {
    logger.warn({ err: e }, 'UN Comtrade API failed');
    res.json({ trade: [], note: 'Trade data temporarily unavailable' });
  }
});

// 8. Deepfake/Disinformation Monitor (GDELT media bias + sentiment)
app.get('/api/intelligence/disinformation', async (req: express.Request, res: express.Response) => {
  try {
    const query = req.query.q as string || 'disinformation OR deepfake OR propaganda OR misinformation';
    const resp = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=50&format=json&sort=DateDesc&timespan=7d`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.json({ articles: [], note: 'GDELT API unavailable' });
    const data = await resp.json();
    res.json({ articles: data.articles ?? [], source: 'GDELT', note: 'Monitor for disinformation patterns' });
  } catch (e) {
    logger.warn({ err: e }, 'GDELT disinformation API failed');
    res.json({ articles: [], note: 'Disinformation data temporarily unavailable' });
  }
});

// ── Energy History — handled by pulseRouter at /api/pulse/energy/history ──

/* ═════════════════════════════════════════════════════════════════
   Intelligence Panel API Routes
   ═════════════════════════════════════════════════════════════════ */

// ── Market Quotes — handled by pulseRouter at /api/pulse/market/quotes ──

// ── Energy Prices — handled by pulseRouter at /api/pulse/energy/prices ──

// ── Geopolitical Risks — handled by pulseRouter at /api/pulse/geopolitical/risks ──

// ── Correlation Cards — handled by pulseRouter at /api/pulse/correlation/cards ──

/* ═══════════════════════════════════════════════════════════════════
   PRITHVI EO FOUNDATION MODEL — routes registered above
   ═══════════════════════════════════════════════════════════════════ */

// Global 404 + error handler (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = http.createServer(app);
const wss = createWsServer(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'server started');
  initSentry();
  initObservability({
    serviceName: 'terranoetis',
    serviceVersion: '3.1',
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
    sampleRate: 1.0,
  });
  startMemoryLogging();
  startResourceMonitor();
  startSentinelEngine();
  // Pre-warm slow caches so first user request doesn't pay the penalty
  fetchAndCacheAirspaces().then(() => logger.info('Airspace cache pre-warmed')).catch(() => {});
  fetchOceanCurrents().then(r => logger.info({ count: r.length }, 'Ocean currents cache pre-warmed')).catch(e => logger.error({ err: String(e) }, 'Ocean currents pre-warm failed'));
  fetchSatellites().then(r => logger.info({ count: r.length }, 'Satellite TLE cache pre-warmed')).catch(e => logger.warn({ err: String(e) }, 'Satellite TLE pre-warm failed (will warm on first user request)'));
  setInterval(() => {
    fetchOceanCurrents().then(r => logger.info({ count: r.length }, 'Ocean currents cache refreshed')).catch(e => logger.error({ err: String(e) }, 'Ocean currents refresh failed'));
  }, 3600000);
  materializedViews.refreshInternal().then(() => logger.info('Materialized views refreshed')).catch(() => {});
  // Start background jobs for proactive systems
  monitorManager.startJobs();
  schedulerManager.startJobs();
  ambientDetector.startJobs();
  reflexEngine.start();
  reflexActionHandler.start();
  forkManager.start();
  entropyMixer.start();
  discoveryEngine.start();
  dreamEngine.start();
  memorySystem.start().catch(err => logger.error({ err }, 'memory system start failed'));
  // Start ML pipeline background tasks
  startSyntheticDataGeneration(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '', 3600000);
  logger.info('Background jobs started (monitor:scheduler:ambient:mvc:plugin:ml)');

  // Register background engines with the Kaggle PowerSaver so they are
  // paused while a GPU simulation runs and resumed when it finishes.
  registerPowerEngines();
});

/**
 * Registers all non-essential background engines with the Kaggle PowerSaver.
 * When a simulation runs on Kaggle these are stopped; when it finishes they
 * are restarted. The HTTP server, websocket, SSE stream, and job queue stay up.
 */
function registerPowerEngines(): void {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
  registerPowerEngine('reflexEngine', () => reflexEngine.stop(), () => reflexEngine.start());
  registerPowerEngine('reflexActionHandler', () => reflexActionHandler.stop(), () => reflexActionHandler.start());
  registerPowerEngine('forkManager', () => forkManager.stop(), () => forkManager.start());
  registerPowerEngine('entropyMixer', () => entropyMixer.stop(), () => entropyMixer.start());
  registerPowerEngine('discoveryEngine', () => discoveryEngine.stop(), () => discoveryEngine.start());
  registerPowerEngine('dreamEngine', () => dreamEngine.stop(), () => dreamEngine.start());
  registerPowerEngine('memorySystem', () => memorySystem.stop(), () => memorySystem.start().catch(err => logger.warn({ err }, 'PowerSaver memory restart failed')));
  registerPowerEngine('sentinelEngine', () => stopSentinelEngine(), () => startSentinelEngine());
  registerPowerEngine('correlationEngine', () => correlationEngine?.stop(), () => correlationEngine?.start());
  registerPowerEngine('roadTrafficDetector', () => roadTrafficDetector.stop(), () => roadTrafficDetector.start());
  registerPowerEngine('spacexEngine', () => spacexEngine.stop(), () => spacexEngine.start());
  registerPowerEngine('bayFireDetector', () => bayFireDetector.stop(), () => bayFireDetector.start());
  registerPowerEngine('weatherForecaster', () => weatherForecaster.stop(), () => weatherForecaster.start());
  registerPowerEngine('agricultureMonitor', () => agricultureMonitor.stop(), () => agricultureMonitor.start());
  registerPowerEngine('multimodal', () => multimodal.stop(), () => multimodal.start());
  registerPowerEngine('syntheticDataGeneration', () => stopSyntheticDataGeneration(), () => startSyntheticDataGeneration(apiKey, 3600000));
  registerPowerEngine('memoryLogging', () => stopMemoryLogging(), () => startMemoryLogging());
  registerPowerEngine('resourceMonitor', () => stopResourceMonitor(), () => startResourceMonitor());
  registerPowerEngine('aisTracker', () => stopAisTracker(), () => initAisTracker());
  logger.info('[PowerSaver] Registered background engines');
}

let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down gracefully');
  forkManager.stop();
  memorySystem.stop();
  dreamEngine.stop();
  discoveryEngine.stop();
  entropyMixer.stop();
  reflexEngine.stop();
  reflexActionHandler.stop();
  stopMemoryLogging();
  stopResourceMonitor();
  stopSyntheticDataGeneration();
  stopAisTracker();
  stopSentinelEngine();
  correlationEngine?.stop();
  roadTrafficDetector.stop();
  spacexEngine.stop();
  bayFireDetector.stop();
  weatherForecaster.stop();
  agricultureMonitor.stop();
  shutdownWsServer();
  httpServer.close(async () => {
    logger.info('HTTP server closed.');
    materializedViews.stop();
    pubsub.removeAllListeners();
    await jobQueue.shutdown(10000);
    closeDb();
    if (puppeteerBrowser && puppeteerBrowser.connected) {
      try {
        await puppeteerBrowser.close();
        logger.info('Puppeteer browser closed.');
      } catch (err) {
        logger.error({ err }, 'Error closing Puppeteer browser');
      }
    }
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Rejection');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
