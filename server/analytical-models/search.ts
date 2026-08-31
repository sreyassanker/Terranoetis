import { TOOLS_PART1, TOOLS_PART2, TOOLS_PART3, TOOLS_PART4, type ToolWorkflowDef } from './perToolDefs';

const ALL_TOOL_DEFS: Record<number, ToolWorkflowDef> = {
  ...TOOLS_PART1,
  ...TOOLS_PART2,
  ...TOOLS_PART3,
  ...TOOLS_PART4,
};

/** Look up a single tool definition by ID (used by the detail route). */
export function getAnalyticalModelDef(id: number): ToolWorkflowDef | undefined {
  return ALL_TOOL_DEFS[id];
}

/** Total count of implemented equation engines (always 150). */
export function getAnalyticalModelCount(): number {
  return Object.keys(ALL_TOOL_DEFS).length;
}

/** Natural-language search over the 150 equation engines. Matches the tool name
 *  AND its scientific metadata (methodology, assumptions, limitations,
 *  references, preprocessing notes) so queries like "100 year flood return
 *  level" resolve to the right equation. Relevance-ranked: exact name >
 *  name prefix > name substring > name terms > metadata phrase > metadata terms.
 *  Pure function — no express, no routes, no side effects. */
export function searchAnalyticalModels(
  query: string,
  limit = 20,
  defs: Record<number, ToolWorkflowDef> = ALL_TOOL_DEFS,
): { results: Array<{ id: number; name: string; vizType: string; match: string }>; count: number; total: number; query: string } {
  const q = (query || '').toLowerCase().trim();
  const capped = Math.min(50, Math.max(1, limit));
  if (!q) {
    const all = Object.entries(defs).map(([id, def]) => ({ id: Number(id), name: def.name, vizType: def.vizType, match: '' }));
    return { results: all, count: all.length, total: all.length, query: q };
  }

  const tokens = q.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(t => t.length > 0 && t !== 'the' && t !== 'and' && t !== 'for' && t !== 'over');
  const queryPhrase = q.replace(/-/g, ' ');

  interface Scored { id: number; name: string; vizType: string; match: string; score: number; }
  const scored: Scored[] = [];

  for (const [idStr, def] of Object.entries(defs)) {
    const id = Number(idStr);
    const name = def.name.toLowerCase();
    const metadata = def.metadata;
    const haystack = [
      name,
      metadata?.methodology?.toLowerCase() ?? '',
      (metadata?.assumptions ?? []).join(' ').toLowerCase(),
      (metadata?.limitations ?? []).join(' ').toLowerCase(),
      (metadata?.references ?? []).join(' ').toLowerCase(),
      (metadata?.preprocessingNotes ?? []).join(' ').toLowerCase(),
    ];

    let score = 0;
    let match = '';
    const nameNorm = def.name.replace(/-/g, ' ').toLowerCase();

    if (nameNorm === queryPhrase) { score += 100; match = 'exact name'; }
    else if (nameNorm.startsWith(queryPhrase)) { score += 60; match = 'name prefix'; }
    else if (name.includes(q)) { score += 40; match = 'name'; }

    if (score < 40 && tokens.length > 0) {
      const nameHits = tokens.filter(t => name.includes(t));
      if (nameHits.length > 0) {
        score += 25 + 8 * nameHits.length;
        match = `name terms: ${nameHits.join(', ')}`;
      }
    }

    if (score < 40) {
      const phraseHits = haystack.filter(h => h.includes(q));
      if (phraseHits.length > 0) { score += 18; match = 'description'; }
    }
    if (tokens.length > 0) {
      const metaText = haystack.join(' ');
      const metaHits = tokens.filter(t => metaText.includes(t));
      if (metaHits.length >= 2) {
        score += 6 + 3 * metaHits.length;
        if (!match) match = `terms: ${metaHits.join(', ')}`;
      }
    }

    if (score > 0) {
      scored.push({ id, name: def.name, vizType: def.vizType, match, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, capped).map(({ id, name, vizType, match }) => ({ id, name, vizType, match }));
  return { results, count: results.length, total: scored.length, query: q };
}