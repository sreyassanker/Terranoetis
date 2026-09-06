/**
 * Tool-call argument normalization + validation (P2 — typed tool calling).
 *
 * The agent's `## TOOL_CALLS` protocol asks the LLM to emit `{"name","args"}`
 * whose keys match each tool's declared `schema.params`. In practice models
 * send `latitude` for `lat`, `min_magnitude` for `minMag`, `{"lat":"35.6"}` as
 * strings, or hallucinated out-of-range coordinates — and the old pipeline
 * passed all of that straight to the endpoint, which silently ignored unknown
 * keys and returned empty/400. This module makes the contract explicit:
 *
 *   1. normalize keys to the tool's declared parameter names (case-insensitive,
 *      snake_case→camelCase, and a synonym map),
 *   2. coerce numeric-looking values for numeric params,
 *   3. validate coordinate ranges and drop genuinely-unknown keys,
 *   4. return structured notes so the caller can feed errors back to the model.
 *
 * Pure + dependency-free → unit-testable without a provider.
 */

export interface ToolLike {
  name: string;
  schema?: { params?: Record<string, string> };
}

export interface NormalizedCall {
  args: Record<string, unknown>;
  /** Keys that were renamed to a canonical declared param. */
  renames: string[];
  /** Unknown keys that were dropped (not declared by the tool). */
  dropped: string[];
  /** Hard problems the model should be told about (empty = safe to execute). */
  errors: string[];
}

// Common model-sent synonyms → the canonical param names used across the catalog.
const SYNONYMS: Record<string, string> = {
  latitude: 'lat', longitude: 'lon', lng: 'lon', long: 'lon',
  min_latitude: 'minLat', max_latitude: 'maxLat', min_longitude: 'minLon', max_longitude: 'maxLon',
  north: 'maxLat', south: 'minLat', east: 'maxLon', west: 'minLon',
  min_magnitude: 'minMag', magnitude: 'minMag', mag: 'minMag', minmag: 'minMag',
  start_time: 'starttime', end_time: 'endtime', starttime_iso: 'starttime', endtime_iso: 'endtime',
  radius_km: 'radius', radius_kilometers: 'radius', distance_km: 'radius', dist: 'radius',
  num_results: 'limit', max_results: 'limit', count: 'limit', max: 'limit',
  country_code: 'country', iso: 'country', iso2: 'country', iso3: 'country',
  indicator_code: 'indicator', series: 'series_id', seriesid: 'series_id',
};

const NUMERIC_PARAM = /(lat|lon|lng|mag|radius|km|distance|hours|days|limit|count|depth|temp|speed|zoom|year|month|value|amount|price|prob|percent|elev|bearing|azimuth|population|n$|num)/i;

/** A comparable key: lowercase with underscores removed (so min_mag == minMag == MINMAG). */
function normKey(s: string): string { return s.toLowerCase().replace(/_/g, ''); }

/** Build a lookup from every normalized variant of a tool's declared params → canonical. */
function declaredIndex(params: Record<string, string>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const key of Object.keys(params)) idx.set(normKey(key), key);
  return idx;
}

function isNumericish(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v));
}

export function normalizeToolCall(tool: ToolLike, rawArgs: Record<string, unknown>): NormalizedCall {
  const declared = tool.schema?.params || {};
  const hasDeclared = Object.keys(declared).length > 0;
  const index = declaredIndex(declared);
  const out: NormalizedCall = { args: {}, renames: [], dropped: [], errors: [] };

  for (const [rawKey, rawVal] of Object.entries(rawArgs || {})) {
    const key = rawKey;
    // 1. exact declared match, else normalized (case/snake-insensitive) match
    let canonical = declared[key] ? key : index.get(normKey(key));
    // 2. synonym map, then re-check declared
    if (!canonical && SYNONYMS[key.toLowerCase()]) {
      const syn = SYNONYMS[key.toLowerCase()];
      canonical = declared[syn] ? syn : index.get(normKey(syn));
    }

    if (!canonical) {
      // Unknown key. If the tool declares params, drop it (and note it) so we
      // don't send garbage to the endpoint; if it declares none, pass through.
      if (hasDeclared) { out.dropped.push(rawKey); continue; }
      canonical = key;
    } else if (canonical !== rawKey) {
      out.renames.push(`${rawKey}→${canonical}`);
    }

    let val: unknown = rawVal;
    // 3. numeric coercion for numeric-looking params
    if (isNumericish(val) && NUMERIC_PARAM.test(canonical)) val = Number((val as string).trim());
    // 4. coordinate range validation (match the canonical param name shape)
    const kl = canonical.toLowerCase();
    const isLat = kl === 'lat' || kl === 'latitude' || /(^|[^a-z])lat([a-z]|$)/.test(kl) || kl.endsWith('lat') || kl.startsWith('lat');
    const isLon = kl === 'lon' || kl === 'lng' || kl === 'longitude' || /(^|[^a-z])(lon|lng)([a-z]|$)/.test(kl) || kl.endsWith('lon') || kl.startsWith('lon');
    if (typeof val === 'number' && Number.isFinite(val)) {
      if (isLat && (val < -90 || val > 90)) out.errors.push(`${canonical}=${val} out of latitude range [-90,90]`);
      if (isLon && (val < -180 || val > 180)) out.errors.push(`${canonical}=${val} out of longitude range [-180,180]`);
    }

    // don't clobber a canonical key already set from a different raw key
    if (out.args[canonical] === undefined) out.args[canonical] = val;
  }

  return out;
}
