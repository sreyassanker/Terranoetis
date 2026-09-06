import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for the "intent event must not drive the globe" rule.
 *
 * The server is the single source of truth for globe actions: it emits explicit
 * `commands` events (flyTo fit-to-area, addPolygon, toggleLayer, scoped
 * addGeoJSON). The client must NOT additionally fly/toggle from the raw
 * `intent` event — doing so zoomed to a bare point (undoing the fit) and turned
 * on the GLOBAL data layer the server deliberately stripped for place-scoped
 * queries (e.g. whole-world ships for "ships near Tokyo").
 *
 * There is no jsdom hook harness in this repo, so we assert on the source: the
 * `intent` branch of the SSE handler must not call toggleLayer/focusLocation.
 */
describe('useChat intent-event handling is informational only', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../hooks/useChat.ts'), 'utf-8');

  it('does not toggle layers or fly from the intent event', () => {
    const m = src.match(/if \(data\.type === 'intent'\)\s*\{([\s\S]*?)\n\s*\}/);
    expect(m, 'intent branch exists').toBeTruthy();
    const body = m![1];
    expect(body).not.toMatch(/toggleLayer\s*\(/);
    expect(body).not.toMatch(/focusLocation\s*\(/);
    expect(body).not.toMatch(/isLayerEnabled\s*\(/);
  });

  it('still executes server commands as the authoritative globe driver', () => {
    expect(src).toMatch(/executeAgentCommands\(data\.commands\)/);
  });
});
