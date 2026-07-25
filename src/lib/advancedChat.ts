/**
 * Advanced AI Chat — client-side helpers
 * ───────────────────────────────────────
 * #3  Streaming markdown reflow (incremental, flicker-free)
 * #7  Artifact parsing (tables/charts/sliders from agent output)
 * #10 Adaptive suggestion fetching
 * #11 Model tier selection
 * #13 Recharts data extraction
 * #14 Resume mid-stream
 */
import type { ArtifactData } from '@/lib/chatStore';
import { authHeaders } from '@/context/AuthContext';

// ─── #3: Incremental streaming markdown ────────────────────────────────────

/**
 * Tracks the parse state of a streaming markdown buffer so we don't
 * re-parse the entire document on every token. We only re-render the
 * "active block" (the one currently being appended to).
 *
 * Strategy: find the last complete block boundary (double newline or
 * code fence close) and only re-parse from there. The already-finalized
 * prefix is cached as HTML.
 */
export class StreamingMarkdownRenderer {
  private cachedPrefixHtml = '';
  private lastBoundary = 0;

  /** Reset state for a new message. */
  reset(): void {
    this.cachedPrefixHtml = '';
    this.lastBoundary = 0;
  }

  /**
   * Render a streaming buffer to HTML.
   * `fullBuffer` is the complete accumulated text so far.
   * `baseRenderer` renders a full markdown string to HTML (the existing richRender).
   */
  render(fullBuffer: string, baseRenderer: (md: string) => string): string {
    if (!fullBuffer) return '';
    // Find the last safe boundary to split at.
    // A boundary is: end of a fenced code block, or a double newline
    // followed by a block-level marker (heading, list, table).
    let boundary = 0;
    // Look for completed code fences ``` ... ```
    const fenceMatches = [...fullBuffer.matchAll(/```[\s\S]*?```/g)];
    if (fenceMatches.length > 0) {
      const lastFence = fenceMatches[fenceMatches.length - 1];
      if (lastFence.index !== undefined) {
        boundary = lastFence.index + lastFence[0].length;
      }
    }
    // Look for paragraph breaks before block markers
    const blockMarker = /\n\n(#{1,6}\s|[-*]\s|\d+\.\s|\|)/g;
    let m: RegExpExecArray | null;
    while ((m = blockMarker.exec(fullBuffer)) !== null) {
      if (m.index > boundary) boundary = m.index;
    }

    const prefix = fullBuffer.slice(0, boundary);
    const active = fullBuffer.slice(boundary);

    // Only re-render the prefix if the boundary advanced
    if (boundary > this.lastBoundary) {
      this.cachedPrefixHtml = baseRenderer(prefix);
      this.lastBoundary = boundary;
    } else if (boundary === 0) {
      // No boundary found yet — render whole thing (small buffer)
      this.cachedPrefixHtml = '';
    }

    const activeHtml = baseRenderer(active);
    return this.cachedPrefixHtml + activeHtml;
  }
}

// ─── #7 + #13: Artifact extraction from agent output ──────────────────────

/**
 * Parse markdown tables and chart directives from agent output into
 * structured ArtifactData for inline rendering.
 */
export function extractArtifacts(markdown: string): { cleanedContent: string; artifacts: ArtifactData[] } {
  const artifacts: ArtifactData[] = [];
  let cleaned = markdown;

  // Extract markdown tables
  const tableRegex = /(?:^|\n)(\|[^\n]+\|\n\|[\s:|-]+\|\n(?:\|[^\n]+\|\n?)+)/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(markdown)) !== null) {
    const tableBlock = tableMatch[1].trim();
    const lines = tableBlock.split('\n').map(l => l.trim());
    if (lines.length < 2) continue;
    // Split by | and drop empty edges (table borders)
    const parseRowSimple = (row: string): string[] => {
      const parts = row.split('|').map(s => s.trim());
      // drop first/last if empty (table borders)
      if (parts.length > 0 && parts[0] === '') parts.shift();
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      return parts;
    };
    const headerCells = parseRowSimple(lines[0]);
    const dataRows = lines.slice(2).map(line => {
      const cells = parseRowSimple(line);
      const obj: Record<string, string | number> = {};
      headerCells.forEach((h, i) => {
        const val = cells[i] ?? '';
        const num = Number(val);
        obj[h] = !isNaN(num) && val !== '' && /^-?\d+\.?\d*$/.test(val) ? num : val;
      });
      return obj;
    });
    artifacts.push({
      kind: 'table',
      title: `Table (${dataRows.length} rows)`,
      columns: headerCells,
      rows: dataRows,
    });
    cleaned = cleaned.replace(tableMatch[0], `\n[ARTIFACT:table:${artifacts.length - 1}]\n`);
  }

  // Extract chart directives: ```chart\n{json}\n``` or ## CHART directives
  const chartRegex = /```chart\n([\s\S]*?)```/g;
  let chartMatch: RegExpExecArray | null;
  while ((chartMatch = chartRegex.exec(markdown)) !== null) {
    try {
      const spec = JSON.parse(chartMatch[1].trim());
      if (spec.labels && spec.values) {
        artifacts.push({
          kind: 'chart',
          title: spec.title || 'Chart',
          chartType: spec.type || 'bar',
          labels: spec.labels,
          values: spec.values,
          lat: spec.lat,
          lon: spec.lon,
        });
        cleaned = cleaned.replace(chartMatch[0], `\n[ARTIFACT:chart:${artifacts.length - 1}]\n`);
      }
    } catch { /* skip malformed */ }
  }

  return { cleanedContent: cleaned, artifacts };
}

// ─── #10: Adaptive suggestions ─────────────────────────────────────────────

export interface SuggestionContextClient {
  visibleLayers: string[];
  cameraBounds?: { north: number; south: number; east: number; west: number };
  recentQueries: string[];
  activeAlerts: number;
  recentDiscoveries: string[];
}

export async function fetchSuggestions(ctx: SuggestionContextClient): Promise<string[]> {
  try {
    const resp = await fetch('/api/agent/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeadersSafe() },
      body: JSON.stringify(ctx),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.suggestions)) return data.suggestions;
    }
  } catch { /* fall through */ }
  return [];
}

// ─── #11: Model tier ────────────────────────────────────────────────────────

export interface ModelTier {
  id: string;
  label: string;
  description: string;
  costPerQuery: number;
  latencyMs: number;
}

export interface TierStats {
  totalCost?: number;
  totalQueries?: number;
  todayCost?: number;
}

export async function fetchTiers(): Promise<{ tiers: ModelTier[]; currentStats: TierStats | null }> {
  try {
    const resp = await fetch('/api/agent/tiers', { headers: authHeadersSafe() });
    if (resp.ok) return await resp.json();
  } catch { /* fall through */ }
  return {
    tiers: [
      { id: 'local', label: 'Fast', description: 'Cached/local', costPerQuery: 0, latencyMs: 100 },
      { id: 'flash', label: 'Balanced', description: 'Flash tier', costPerQuery: 0.0001, latencyMs: 1500 },
      { id: 'pro', label: 'Deep', description: 'Pro tier', costPerQuery: 0.0008, latencyMs: 4000 },
    ],
    currentStats: null,
  };
}

// ─── #14: Resume ────────────────────────────────────────────────────────────

export async function resumeStream(
  partial: string,
  originalMessage: string,
  sessionId: string | null,
  onToken: (text: string) => void,
  onDone: (fullContinuation: string) => void,
  onError: (err: string) => void,
): Promise<void> {
  try {
    const resp = await fetch('/api/agent/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeadersSafe() },
      body: JSON.stringify({ partial, originalMessage, sessionId }),
    });
    if (!resp.ok || !resp.body) { onError(`Resume failed (${resp.status})`); return; }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'token' && data.text) { full += data.text; onToken(data.text); }
          if (data.type === 'output' && data.text) { onDone(data.text); return; }
          if (data.type === 'error') { onError(data.error || 'Resume error'); return; }
        } catch { /* skip */ }
      }
    }
    if (full) onDone(full);
  } catch (e) {
    onError(String(e));
  }
}

// ─── #4: Tool approval ──────────────────────────────────────────────────────

export async function approveTool(toolName: string, args: Record<string, unknown>): Promise<{ result: unknown; riskLevel: string }> {
  const resp = await fetch('/api/agent/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeadersSafe() },
    body: JSON.stringify({ toolName, args }),
  });
  if (!resp.ok) throw new Error(`Approval failed (${resp.status})`);
  return resp.json();
}

// ─── #5: Plan generation ────────────────────────────────────────────────────

export async function generatePlanClient(message: string): Promise<unknown> {
  const resp = await fetch('/api/agent/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeadersSafe() },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) throw new Error(`Plan generation failed (${resp.status})`);
  return resp.json();
}

// ─── #15: Trace retrieval ──────────────────────────────────────────────────

export interface TraceRecord {
  interactionId?: string;
  userId?: string;
  query?: string;
  response?: string;
  modelUsed?: string;
  intentType?: string;
  confidence?: number;
  totalDurationMs?: number;
  steps?: Array<{ type: string; description: string; durationMs?: number }>;
}

export async function fetchTrace(traceId: string): Promise<TraceRecord | null> {
  try {
    const resp = await fetch(`/api/agent/trace/${encodeURIComponent(traceId)}`, { headers: authHeadersSafe() });
    if (resp.ok) return await resp.json();
  } catch { /* fall through */ }
  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function authHeadersSafe(): Record<string, string> {
  try {
    return { ...authHeaders() };
  } catch {
    return {};
  }
}
