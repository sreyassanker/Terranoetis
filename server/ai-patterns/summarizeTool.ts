/**
 * Generic readable formatter for tool results.
 *
 * Renders ANY tool result object into clean, human-readable markdown:
 * - Lists render as real markdown bullets (`- `) so they start from the left
 * - Important values (names, magnitudes, statuses) are **bold**
 * - Works for every tool with no per-tool special-casing.
 */

const SKIP_KEYS = new Set([
  'id', 'timestamp', 'query', 'lat', 'lon', 'type', 'status',
  'source', 'updatedAt', 'createdAt', 'requestId', 'correlationId', 'meta',
  'utcOffsetSeconds', 'timezone', 'timezoneAbbreviation', 'generationtimeMs',
]);

/** URL-bearing keys — rendered as clickable markdown links, not skipped. */
const URL_KEYS = new Set(['url', 'textUrl', 'link', 'linkUrl', 'href']);

/** Keys whose nested object is unit/metadata metadata, not data — skip when a data twin exists. */
const UNITS_KEYS = new Set(['current_units', 'hourly_units', 'daily_units', 'units']);

/** Fields that carry primary importance — their value is bolded. */
const IMPORTANT_KEYS = new Set([
  'mag', 'magnitude', 'place', 'name', 'title', 'volcano', 'callsign', 'area',
  'temperature', 'temperature_2m', 'temperature_c', 'aqi', 'risk', 'risklevel',
  'severity', 'intensity', 'advisoryNumber', 'advisory_number', 'status',
  'wind_speed', 'wind_speed_10m', 'precipitation', 'precipitation_mm',
  'pressure', 'pressure_msl', 'elevation', 'depth', 'height', 'probability',
  'count', 'total', 'active', 'cancelled', 'delayed',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v.length > 160 ? v.slice(0, 157) + '…' : v;
  return '';
}

/** Format a URL value as an inline clickable markdown link. */
function fmtLink(key: string, v: unknown): string {
  const url = String(v);
  if (!/^https?:\/\//i.test(url)) return '';
  const k = key.toLowerCase();
  const text = k === 'texturl' || k === 'linkurl' || k === 'href'
    ? 'View details'
    : k === 'url' || k === 'link'
      ? 'View'
      : label(key);
  return `[${text}](${url})`;
}

function label(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Render a single "• Label: value" line with the label bolded and value bolded when important. */
function kvLine(key: string, value: unknown): string {
  const s = fmtScalar(value);
  if (!s) return '';
  const val = IMPORTANT_KEYS.has(key.toLowerCase()) ? `**${s}**` : s;
  return `- **${label(key)}**: ${val}`;
}

/**
 * Convert a tool result into readable text.
 * - Arrays of objects → one markdown bullet per item
 * - Objects → one "- Label: value" per meaningful field
 * - Nested objects/arrays are flattened one level then capped
 */
export function summarizeToolResult(_tool: string, result: unknown): string {
  const r = result as Record<string, unknown>;

  // Top-level array of items (e.g. earthquakes.features, advisories, flights)
  if (Array.isArray(result)) {
    if (result.length === 0) return 'No data found.';
    return result.slice(0, 8).map((item, i) => renderItem(item, i)).join('\n');
  }

  // Common wrapper keys — drill into the first meaningful collection
  const wrapperKeys = ['advisories', 'features', 'events', 'items', 'results', 'data', 'aircraft', 'objects', 'list', 'rows'];
  for (const wk of wrapperKeys) {
    const w = r[wk];
    if (Array.isArray(w) && w.length > 0) {
      const heading = wk === 'data' || wk === 'items' ? '' : `**${label(wk)}**\n`;
      return heading + w.slice(0, 8).map((item, i) => renderItem(item, i)).join('\n');
    }
  }

  // Flat scalar-ish object (weather, iss, single record)
  const lines: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (SKIP_KEYS.has(k)) continue;
    // Skip metadata/units blocks when a data twin exists (e.g. current_units + current)
    if (UNITS_KEYS.has(k) && isObj(v)) continue;
    if (URL_KEYS.has(k)) {
      const link = fmtLink(k, v);
      if (link) lines.push(`- ${link}`);
      continue;
    }
    if (isObj(v)) {
      // Single nested object (e.g. current, position) — inline its fields
      for (const [k2, v2] of Object.entries(v)) {
        if (SKIP_KEYS.has(k2) || UNITS_KEYS.has(k2)) continue;
        if (URL_KEYS.has(k2)) {
          const link = fmtLink(k2, v2);
          if (link) lines.push(`- ${link}`);
          continue;
        }
        if (Array.isArray(v2)) continue;
        const s = kvLine(k2, v2);
        if (s) lines.push(s);
      }
    } else if (!Array.isArray(v)) {
      const s = kvLine(k, v);
      if (s) lines.push(s);
    }
  }
  if (lines.length === 0) return JSON.stringify(result).slice(0, 800);
  return lines.slice(0, 20).join('\n');
}

function renderItem(item: unknown, index: number): string {
  if (isObj(item)) {
    // GeoJSON-style nested wrapper (needed to reach properties.mag etc.)
    const inner = (item.properties || item.attributes || item.fields || item) as Record<string, unknown>;

    // Choose the best display fields for an item (bolded as the primary label)
    const titleCandidates = ['name', 'title', 'place', 'volcano', 'callsign', 'id', 'source', 'area'];
    const titleVal = titleCandidates.map(c => inner[c]).find(v => v !== undefined && v !== null && v !== '');
    const title = titleVal ? `**${fmtScalar(titleVal)}**` : `**Item ${index + 1}**`;

    const meta: string[] = [];
    let itemLink = '';
    // Check both the item itself and inner for URL keys
    const urlSources = [item, inner];
    for (const source of urlSources) {
      for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
        if (SKIP_KEYS.has(k)) continue;
        if (URL_KEYS.has(k)) {
          const link = fmtLink(k, v);
          if (link && !itemLink) itemLink = link;
          continue;
        }
      }
    }
    for (const [k, v] of Object.entries(inner)) {
      if (SKIP_KEYS.has(k)) continue;
      if (URL_KEYS.has(k)) continue; // already checked above
      if (k === titleCandidates.find(c => inner[c] === v)) continue; // don't duplicate title
      if (Array.isArray(v)) continue;
      const s = fmtScalar(v);
      if (s && s.length < 60) {
        meta.push(IMPORTANT_KEYS.has(k.toLowerCase()) ? `**${label(k)}**: ${s}` : `${label(k)}: ${s}`);
      }
    }
    const metaStr = meta.length > 0 ? ` — ${meta.slice(0, 4).join(' · ')}` : '';
    const linkStr = itemLink ? ` ${itemLink}` : '';
    return `- ${title}${metaStr}${linkStr}`;
  }
  const s = fmtScalar(item);
  return s ? `- **${s}**` : '';
}
