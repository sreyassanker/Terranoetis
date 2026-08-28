/**
 * AI Pattern Store — on-disk workflow memory.
 *
 * Persists reusable "recipes" (tool steps + parameter slots + visualization
 * commands) as JSON files under:
 *
 *   data/ai-patterns/<domain>/<name>.json
 *
 * A pattern is captured from a chat run that the user liked (approved).
 * Later, when a new query matches a pattern (embedding + intent similarity),
 * the server can replay the saved steps with new slot values substituted —
 * avoiding a full expensive LLM run.
 *
 * Domains mirror the tool-registry categories (weather, seismic, aviation, ...).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { logger } from '../observability/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Project root: <repo>/server/ai-patterns -> <repo>
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BASE_DIR = path.join(PROJECT_ROOT, 'data', 'ai-patterns');

export interface PatternStep {
  /** Tool name from the registry, e.g. weather_forecast */
  tool: string;
  /** Args — literal values or {slot} placeholders */
  args: Record<string, unknown>;
}

export interface PatternCommand {
  action: string;
  label?: string;
  lat?: number | string;
  lon?: number | string;
  layerId?: string;
  [k: string]: unknown;
}

export interface AiPattern {
  id: string;
  domain: string;
  intent: string;
  name: string;
  query: string;
  slots: string[];
  steps: PatternStep[];
  commands: PatternCommand[];
  approvalCount: number;
  createdAt: string;
  updatedAt: string;
  /** Example lat/lon captured at save time (used for slot extraction) */
  sampleLocation?: { lat: number; lon: number; label?: string };
}

function ensureBaseDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

function domainDir(domain: string): string {
  const safe = domain.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(BASE_DIR, safe);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pattern';
}

/** Normalise a domain — "general" queries fall back to the matched intent. */
export function resolveDomain(intent: string, fallback = 'general'): string {
  const KNOWN: string[] = [
    'analytical', 'aviation', 'compute', 'energy', 'eo', 'hazards', 'intelligence',
    'maritime', 'multimodal', 'navigation', 'ocean', 'osint', 'scenarios', 'seismic',
    'simulation', 'space', 'weather',
  ];
  for (const k of KNOWN) {
    if (intent.includes(k)) return k;
  }
  return fallback;
}

/**
 * Detect the parameter slots of a pattern from the original query + intent
 * location. These are the fields that vary between runs (location, radius, ...).
 */
export function detectSlots(
  query: string,
  sampleLocation?: { lat: number; lon: number; label?: string },
): string[] {
  const slots = new Set<string>();
  const lower = query.toLowerCase();
  if (sampleLocation || /\b(in|near|at|for|around)\b.*(tokyo|paris|delhi|kyoto|london|new york|kochi|sf|san francisco|mumbai|chennai|bangalore|seattle|la|los angeles|berlin|rome|beijing|shanghai)/.test(lower)) {
    slots.add('lat');
    slots.add('lon');
    slots.add('label');
  }
  if (/\b(radius|within|km|miles)\b/.test(lower)) slots.add('radius');
  if (/\b(days|day|24h|48h|week|month)\b/.test(lower)) slots.add('hours');
  if (/\b(drought|flood|fire|storm|earthquake|tsunami)\b/.test(lower)) slots.add('hazard');
  return Array.from(slots);
}

/** Substitute slot placeholders in a step's args using concrete values. */
export function substituteArgs(
  args: Record<string, unknown>,
  slotValues: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
      const slot = v.slice(1, -1);
      out[k] = slotValues[slot] !== undefined ? slotValues[slot] : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function savePattern(pattern: Omit<AiPattern, 'id' | 'createdAt' | 'updatedAt'>): AiPattern {
  ensureBaseDir();
  const dir = domainDir(pattern.domain);
  fs.mkdirSync(dir, { recursive: true });

  const id = `pat_${pattern.domain}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const full: AiPattern = {
    ...pattern,
    id,
    createdAt: now,
    updatedAt: now,
  };

  const filename = `${slugify(pattern.name || pattern.intent)}-${id.slice(-8)}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(full, null, 2), 'utf-8');
  logger.info({ id, domain: pattern.domain, steps: pattern.steps.length }, 'AI pattern saved');
  return full;
}

/** Approve an existing pattern by id — bumps approvalCount and updates timestamp. */
export function approvePattern(id: string): AiPattern | null {
  const pat = getPattern(id);
  if (!pat) return null;
  pat.approvalCount = (pat.approvalCount || 0) + 1;
  pat.updatedAt = new Date().toISOString();
  writePattern(pat);
  return pat;
}

/** Find a pattern by id across all domains. */
export function getPattern(id: string): AiPattern | null {
  for (const file of listFiles()) {
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf-8')) as AiPattern;
      if (p.id === id) return p;
    } catch { /* skip corrupt */ }
  }
  return null;
}

/** Return all patterns, optionally filtered by domain. */
export function listPatterns(domain?: string): AiPattern[] {
  const out: AiPattern[] = [];
  for (const file of listFiles(domain)) {
    try {
      out.push(JSON.parse(fs.readFileSync(file, 'utf-8')) as AiPattern);
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.approvalCount - a.approvalCount || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Find the best matching pattern for a query.
 * Matching = same intent type (or intent alias) + simple token-overlap score.
 * Returns null when no pattern scores above the threshold.
 */
export function findMatchingPattern(
  query: string,
  intent: string,
  domain?: string,
  threshold = 0.25,
): AiPattern | null {
  const candidates = domain ? listPatterns(domain) : listPatterns();
  if (candidates.length === 0) return null;

  const qTokens = new Set(query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
  let best: AiPattern | null = null;
  let bestScore = 0;

  for (const pat of candidates) {
    // Intent gating: same intent family only (unless pattern is generic)
    if (pat.intent !== intent && !(pat.intent === 'general' || intent === 'general')) continue;

    const pTokens = new Set(pat.query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
    let overlap = 0;
    for (const t of pTokens) if (qTokens.has(t) && t.length > 2) overlap++;
    const score = overlap / Math.max(1, Math.min(qTokens.size, pTokens.size));

    // Location-independent: "weather in tokyo" vs "weather in paris" — the
    // location token should not hurt the match, so ignore known place tokens.
    if (score > bestScore) {
      bestScore = score;
      best = pat;
    }
  }

  if (best && bestScore >= threshold) return best;
  return null;
}

function listFiles(domain?: string): string[] {
  ensureBaseDir();
  const out: string[] = [];
  if (domain) {
    const dir = domainDir(domain);
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) out.push(path.join(dir, f));
    }
    return out;
  }
  for (const d of fs.readdirSync(BASE_DIR)) {
    const dir = path.join(BASE_DIR, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) out.push(path.join(dir, f));
    }
  }
  return out;
}

function writePattern(pat: AiPattern): void {
  const dir = domainDir(pat.domain);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${slugify(pat.name || pat.intent)}-${pat.id.slice(-8)}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(pat, null, 2), 'utf-8');
}

export function patternStoreStats(): { baseDir: string; domains: Record<string, number>; total: number } {
  const domains: Record<string, number> = {};
  let total = 0;
  if (fs.existsSync(BASE_DIR)) {
    for (const d of fs.readdirSync(BASE_DIR)) {
      const dir = path.join(BASE_DIR, d);
      if (!fs.statSync(dir).isDirectory()) continue;
      const count = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
      if (count > 0) { domains[d] = count; total += count; }
    }
  }
  return { baseDir: BASE_DIR, domains, total };
}
