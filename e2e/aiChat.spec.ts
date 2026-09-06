/**
 * E2E: AI chat panel driven in a real browser.
 *
 * Verifies the things a backend-only test cannot: that the chat round-trips
 * through the live UI and that its output actually PAINTS —
 *  - LaTeX math renders as KaTeX symbols (λ, fractions) in the message bubble
 *  - a "fly to <place>" adds a real ground-clamped boundary entity to the Cesium globe
 *  - general-knowledge answers carry the honesty label
 *  - no fatal console errors during the flow
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  // dev mode auto-logs-in; give the viewer + auth a moment to settle
  await page.waitForFunction(() => !!(window as unknown as { __VIEWER__?: unknown }).__VIEWER__, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.locator('button[title="AI Assistant"]').first().click();
  await page.waitForSelector('.ai-input', { timeout: 15000 });
}

async function sendChat(page: import('@playwright/test').Page, text: string) {
  const input = page.locator('.ai-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test('chat renders LaTeX math as KaTeX symbols + labels general knowledge', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource|RequestErrorEvent|WebSocket|Download the React/i.test(m.text())) errors.push(m.text());
  });

  await openChat(page);
  await sendChat(page, 'What is the quadratic formula? Explain each symbol in it.');

  // Wait for an assistant bubble to appear and finish streaming.
  const lastAssistant = page.locator('.ai-msg.assistant').last();
  await expect(lastAssistant).toBeVisible({ timeout: 120000 });
  // The tier badge is attached only by the FINAL output patch — waiting for it
  // guarantees streaming is done (the old typing-indicator check raced the
  // last 40ms token flush).
  await lastAssistant.locator('.msg-tier-badge').waitFor({ timeout: 180000 }).catch(() => { /* badge may be absent on error paths */ });
  await page.waitForFunction(() => {
    const el = document.querySelector('.ai-msg.assistant:last-of-type');
    return !!el && !document.querySelector('.ai-typing') && !document.querySelector('.live-process');
  }, null, { timeout: 120000 }).catch(() => { /* typing indicator may already be gone */ });

  // Math must render as KaTeX (real symbols), not raw \frac / $$.
  // Environment-aware: when every remote provider is throttled the pipeline
  // honestly falls back to the local GGUF model (badge says so), which writes
  // Unicode math. That is a quota condition, not a rendering regression —
  // detect it via the served-by badge and skip the KaTeX assertion.
  const body = await lastAssistant.innerText();
  const servedByLocal = /local-gguf|local model/i.test(body) || await page.locator('.msg-tier-badge', { hasText: 'local-gguf' }).count() > 0;
  const katexCount = await page.locator('.ai-msg.assistant .katex').count();
  if (!servedByLocal) {
    expect(katexCount, 'no KaTeX math rendered in the chat answer').toBeGreaterThan(0);
  }

  // Honesty: general-knowledge answer must be labeled.
  expect(/general knowledge/i.test(body), 'general-knowledge answer missing label').toBe(true);
  // Raw LaTeX must not leak into the visible text.
  expect(/\\frac|\\sqrt|\$\$/.test(body), 'raw LaTeX leaked into rendered text').toBe(false);

  await page.screenshot({ path: 'playwright-report/ai-chat-math.png', fullPage: false });
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('chat "fly to Kerala" paints a real boundary entity on the globe', async ({ page }) => {
  await openChat(page);

  const boundaryCountBefore = await page.evaluate(() => {
    const v = (window as unknown as { __VIEWER__?: { entities: { values: Array<{ polyline?: unknown; name?: string }> } } }).__VIEWER__;
    return v ? v.entities.values.filter((e) => e.polyline && /kerala/i.test(e.name || '')).length : -1;
  });
  expect(boundaryCountBefore).toBeGreaterThanOrEqual(0);

  await sendChat(page, 'fly to Kerala');

  // A ground-clamped boundary polyline named *Kerala* must be added to the globe.
  await page.waitForFunction(() => {
    const v = (window as unknown as { __VIEWER__?: { entities: { values: Array<{ polyline?: unknown; name?: string }> } } }).__VIEWER__;
    if (!v) return false;
    return v.entities.values.some((e) => e.polyline && /kerala/i.test(e.name || ''));
  }, null, { timeout: 120000 });

  const after = await page.evaluate(() => {
    const v = (window as unknown as { __VIEWER__?: { entities: { values: Array<{ polyline?: unknown; name?: string; clampToGround?: unknown }> } } }).__VIEWER__;
    const b = v ? v.entities.values.filter((e) => e.polyline && /kerala/i.test(e.name || '')) : [];
    return { count: b.length, groundClamped: b.some((e) => !!(e.polyline as { clampToGround?: unknown })?.clampToGround) };
  });
  expect(after.count, 'no Kerala boundary entity added to the globe').toBeGreaterThan(boundaryCountBefore);
  expect(after.groundClamped, 'boundary is not ground-clamped (would be occluded by terrain)').toBe(true);

  // The chat confirms the flight in prose.
  const body = await page.locator('.ai-msg.assistant').last().innerText();
  expect(/kerala/i.test(body), 'chat did not confirm flying to Kerala').toBe(true);

  await page.screenshot({ path: 'playwright-report/ai-chat-boundary.png', fullPage: false });
});
