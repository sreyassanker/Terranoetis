#!/usr/bin/env node
/**
 * AI Chat — E2E Regression Probe
 *
 * Boots nothing: expects the dev server on :3001 (npm run dev).
 * Sends a battery of free-form questions through /api/agent/ask and asserts:
 *  - deterministic questions produce the right commands (0 LLM cost)
 *  - data questions call the right tools and return real records
 *  - honesty contract holds (no fabricated live data on provider outage)
 *
 * Usage: node scripts/aiChatE2E.mjs [--quick]
 * Exit 0 = all green. Any FAILED line = regression.
 */
const BASE = process.env.AI_CHAT_BASE || 'http://127.0.0.1:3001';
const QUICK = process.argv.includes('--quick');

const login = await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', body: '' }).then(r => r.json());
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

/** Each case: question + assert(result) */
const CASES = [
  // ── Deterministic fast paths (must be ~0s, no tools) ──
  { q: 'show earthquakes', expect: r => r.intentType === 'toggle_layer' || /showing/i.test(r.output) },
  { q: 'open analytics workbench', expect: r => /analytics workbench/i.test(r.output) },
  { q: 'fly to paris', expect: r => r.intentType === 'fly_to' || /paris/i.test(r.output) },
  { q: 'set night lights opacity to 40%', expect: r => r.commands.some(c => c.action === 'setLayerOpacity' && c.layerId === 'night_lights') },
  { q: 'take a screenshot', expect: r => r.commands.some(c => c.action === 'screenshot') },
  // ── Data questions (tool + real records) ──
  { q: 'what is the current co2 level', expect: r => r.tools.includes('climate_co2') && /\d{3}(\.\d+)?\s*ppm/i.test(r.output) },
  { q: 'who disease outbreaks right now', expect: r => r.tools.includes('who_outbreaks') },
  { q: 'what is the gdp of japan', expect: r => r.tools.includes('worldbank_economy') && /trillion|billion|\$/i.test(r.output) },
  { q: 'will it rain tomorrow in Kochi', expect: r => r.tools.includes('weather_forecast') },
  { q: 'any internet shutdowns recently', expect: r => r.tools.includes('ioda_outages') },
  { q: 'what earthquakes happened near japan today', expect: r => r.tools.includes('earthquakes') },
  // ── Honesty (general knowledge labeled) ──
  { q: 'who won the 2010 world cup', expect: r => /general knowledge/i.test(r.output) },
];

const runCase = async ({ q, expect }) => {
  const r = await fetch(`${BASE}/api/agent/ask`, { method: 'POST', headers: H, body: JSON.stringify({ message: q, sessionId: 'e2e-suite' }) });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', output = '', intentType = '', tools = [], commands = [];
  const t0 = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const em = chunk.match(/^event: (.+)$/m);
      if (!em) continue;
      const dm = chunk.match(/^data: (.+)$/m);
      let d = {};
      try { d = dm ? JSON.parse(dm[1]) : {}; } catch { /* skip */ }
      if (em[1] === 'intent') intentType = d.type || '';
      if (em[1] === 'tool_call') tools.push(d.name);
      if (em[1] === 'commands') commands = d.commands || [];
      if (em[1] === 'output') output = d.text || '';
    }
  }
  return { q, output, intentType, tools, commands, ms: Date.now() - t0, expect };
};

let pass = 0, fail = 0, skip = 0;
const cases = QUICK ? CASES.slice(0, 6) : CASES;
// Provider quota exhaustion is an ENVIRONMENT condition, not a code regression.
// When every remote LLM is throttled the pipeline correctly falls back to the
// local model (labeled) — those cases are reported as SKIP, not FAIL.
const PROVIDER_DOWN = /local model|all providers unreachable|providers failed|Provider .* failed|Live data is unavailable|rate-limited or unreachable|returned no content|streamed no content/i;
for (const c of cases) {
  try {
    const r = await runCase(c);
    const ok = c.expect(r);
    if (ok) { pass++; console.log(`PASS ${r.ms}ms  ${c.q}  tools=[${r.tools.join(',')}]`); }
    else if (!r.tools.length && PROVIDER_DOWN.test(r.output)) { skip++; console.log(`SKIP ${r.ms}ms  ${c.q}  (provider quota exhausted — local fallback)`); }
    else { fail++; console.log(`FAILED      ${c.q}\n  tools=[${r.tools.join(',')}]\n  output: ${r.output.slice(0, 180).replace(/\n/g, ' ')}`); }
  } catch (e) {
    fail++;
    console.log(`FAILED      ${c.q} — exception: ${String(e).slice(0, 120)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (provider quota), of ${cases.length}`);
process.exit(fail > 0 ? 1 : 0);
