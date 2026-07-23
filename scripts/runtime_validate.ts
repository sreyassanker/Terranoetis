/**
 * RUNTIME VALIDATION SUITE — All 150 Analytical Tools
 * Executes each tool through computeWithContext() with real API interception.
 */
import { computeWithContext } from '../server/analytical-models/contextEngine';
import { writeFileSync } from 'fs';

interface ApiCall { url: string; status: number | string; ok: boolean; bytes: number; host: string; }
const apiCalls: ApiCall[] = [];
const origFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const host = (() => { try { return new URL(url).host; } catch { return url.slice(0, 40); } })();
  const call: ApiCall = { url: url.slice(0, 160), status: 'pending', ok: false, bytes: 0, host };
  apiCalls.push(call);
  try {
    const resp = await origFetch(input as RequestInfo, init);
    call.status = resp.status; call.ok = resp.ok;
    try { const c = resp.clone(); call.bytes = (await c.text()).length; } catch { /* */ }
    return resp;
  } catch (e) {
    call.status = 'error'; throw e;
  }
};

const TOOL_INPUTS: Record<number, Record<string, number>> = {
  1: { T10: 300, T11: 298, eps10: 0.97, eps11: 0.98, w: 1.5 }, 2: { λ: 10, T: 300 },
  3: { T: 20 }, 4: { P0: 1013.25, z: 1000, T: 288 }, 5: { dPdx: 0.001, dPdy: 0.001, f: 0.0001, ρ: 1.2 },
  6: { u: 5, D: 100, C0: 100, t: 3600 }, 7: { zg: 100, zs: 2, thvz: 305, thvs: 300, uz: 10, us: 2 },
  8: { C: 1.5, ε: 0.001, k: 0.01 }, 9: { Rn: 150, G: 10, T: 25, u2: 2, es: 3.17, ea: 1.5, delta: 0.15, gamma: 0.067 },
  10: { P: 50, Ia: 10, S: 100 }, 11: { n: 0.03, R: 1.5, S: 0.001 }, 12: { C: 0.5, i: 10, A: 10 },
  13: { K: 6, X: 0.2, It: 100, Ot: 80 }, 14: { H0: 2 }, 15: { τ: 0.1, ρ: 1025, f: 0.0001, Av: 0.1 },
  16: { f: 0.0001, dpdx: 1e-5, ρ: 1025 }, 17: { Qs: 200, Qb: 50, Qh: 20, Qe: 80 },
  18: { Ks: 1e-5, psiW: 0.2, psi0: 0.5, dTheta: 0.2, F: 0.1 }, 19: { a: 4, b: 1, M: 5 },
  20: { K: 100, c: 0.1, t: 1, p: 1.1 }, 21: { mag: 1, dist: -1, site: 0, fault: 0, hw: 0 },
  22: { c: 10, sigmaN: 100, tanPhi: 0.6 }, 23: { M0: 1e18 }, 24: { M0: 1e18, r: 1000 }, 25: { Mw: 6 },
  26: { NIR: 0.4, Red: 0.1 }, 27: { Green: 0.2, NIR: 0.3 }, 28: { NIR: 0.4, SWIR: 0.1 },
  29: { NIR: 0.4, Red: 0.1, Blue: 0.05 }, 30: { Green: 0.6, SWIR: 0.1 }, 31: { NIR: 0.4, SWIR: 0.1 },
  32: { A: 10000, ε: 0.98, Tfire: 800, Tbg: 300 }, 33: { Tc: 35, Twet: 25, Tdry: 40 },
  34: { DDF: 5, Tair: 5, Tbase: 0 }, 35: { C: 0.5, Twater: 0, Tice: -5 },
  36: { lat1: 35.68, lon1: 139.76, lat2: 34.69, lon2: 135.50 },
  37: { z: 1, weights: 1, idx: 0 }, 38: { zs: 1, weights: 1, idx: 0 },
  39: { Q: 1000, u: 5, σy: 50, σz: 30, y: 0 }, 40: { μ: 100, β: 20, x: 100 },
  41: { ξ: 0.1, β: 20, x: 100 }, 42: { z: 1, N: 10, h: 1 },
  43: { thetaR: 0.05, thetaS: 0.4, alpha: 0.01, n: 1.5, psi: -10 }, 44: { psib: -0.3, psi: -1 },
  45: { R: 5000, K: 0.03, LS: 2, C: 0.2, P: 1 }, 46: { Rbase: 2, Q10: 2, T: 20, Tbase: 10 },
  47: { ki: 1, fractions: 1 }, 48: { kappa: 0.4, ustar: 0.3, z: 10, L: -50, zeta: -0.2 },
  49: { ustar: 0.3, z: 10, z0: 0.1 }, 50: { g0: 10, a1: 9, A: 15, hs: 0.7, cs: 380 },
  51: { ε: 1.2, fPAR: 0.5, PAR: 2000 }, 52: { I0: 1500, k: 0.5, LAI: 4 },
  53: { R_eco: 800, GPP: 1200 }, 54: { Vcmax: 80, ci: 250, GammaStar: 40, Kc: 300, Ko: 300000, O: 210000 },
  55: { a: 0.05, DBH: 30 }, 56: { k: 1000, K0: 30, dCO2: 10 }, 57: { C: 106, N: 16, P: 1 },
  58: { Tavg: 20, Tbase: 10, Tupper: 30 }, 59: { alpha: 1.26, delta: 0.15, gamma: 0.067, Rn: 150, G: 10 },
  60: { Ra: 25, Tmax: 30, Tmin: 15 }, 61: { Ya: 5, Ym: 8, Ky: 1.1, ETa: 400, ETm: 600 },
  62: { umax: 0.8, T: 20 }, 63: { ρ: 1.2, cp: 1005, Ts: 30, Ta: 25, ra: 50, rs: 100, es: 30, ea: 15 },
  64: { O2: 8, hnu: 1 }, 65: { k: 1e-12, OH: 1e-6 },
  66: { β: 2e-11, rho0: 1025, curlτz: 1e-7 }, 67: { β: 2e-11, ψ: 1e7, x: 1e6, curlτ: 1e-7, R: 10, visc: 100 },
  68: { β: 2e-11, ψ: 1e7, x: 1e6, curlτ: 1e-7, visc: 1e5 }, 69: { λ: 0.1, Tstar: 20, T: 15, q: 0.5 },
  70: { S: 35, Theta: 10, p: 0 }, 71: { gamma: 0.2, ε: 1e-8, N2: 1e-4 }, 72: { Ri: 0.5 },
  73: { g: 9.81, alpha: 0.0081, fm: 0.1, fpm: 0.15 }, 74: { etaU: 0.5, Sw: 0.8, Ssig: 0.6 },
  75: { Lstar: 500, S: 0.003, B: 2, hstar: 8 }, 76: { H: 2, db: 3 }, 77: { K: 0.39, Hsb: 1.5, thetaB: 0.35 },
  78: { g: 9.81, k: 0.1, h: 10 }, 79: { omega: 0.628, ka: 1, z: 0 }, 80: { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.15, gamma: 3.3 },
  81: { K: 0.01, A: 10000, m: 0.5, S: 0.01 }, 82: { c: 2.5, A: 100, h: 0.6 }, 83: { L: 100, s: 10 },
  84: { cprime: 10, gammaz: 100, cosB: 0.866, u: 20, tanPhi: 0.577, sinB: 0.5, cosB2: 0.75 },
  85: { mu: 0.3, sigmaN: 100, xi: 500 }, 86: { As: 500, tanB: 0.05 }, 87: { As: 500, tanB: 0.05 },
  88: { Km: 0.7, ew: 25, ea: 15, u: 10 }, 89: { A: 1, z: 20, rms: 0.5 }, 90: { n: 3, K: 6, t: 24, Q0: 100 },
  91: { accum: 0.5, DDF: 0.005, Tpos: 800, days: 365 }, 92: { K: 2, DDF: 1500, L: 334000, λ: 2 },
  93: { k: 11, b: 100, rhoI: 917, rhoF: 550 }, 94: { V: 4 }, 95: { Qdot: 1e6, rhoAir: 1.2, α: 0.1 },
  96: { C: 2.09e7, T: 288, Q: 342, α: 0.3, I: 240, D: 0.6, divDT: 0 }, 97: { dF: 3.7, lambda0: 1.2, f: 0 },
  98: { dRdT: -3.2 }, 99: { β: 2e-11, kx: 1e-6, ky: 1e-6 }, 100: { dpdy: -1e-11, f: 1e-4, N: 0.01, dudy: 1e-3 },
  101: { f: 1e-4, N: 0.01, dudy: 1e-3 }, 102: { ψ: 1e7, f: 1e-4, dpy: 1e-11, dpp: 1e-12 },
  103: { ubar: 10, uprime: 2 }, 104: { Km: 100, f: 1e-4 }, 105: { g: 9.81, thetaVbar: 300, wthetaV: 0.2, zi: 1000 },
  106: { dTheta: 5, D: 1e-7, cos2beta: 0.5, delta: 0.5, dB: 0, dudy: 1e-3 },
  107: { zeta: 1e-4, f: 1e-4, dudx: 1e-5, dudy: 1e-5, dvdx: 1e-5, dvdy: 1e-5 },
  108: { a: 0.01, r: 1e-6, b: 1e-18 }, 109: { N0: 8000, Lambda: 4100, D: 0.001 }, 110: { a: 200, R: 10 },
  111: { Rx: 1, Ry: 0, Rz: 0, P: 1, N: 0, W: 1 }, 112: { hn: 0.6, Vn: 1, g: 9.81 },
  113: { GM: 3.986e14, r: 7000000, n: 2, Cnm: 1e-6, Snm: 0, Pnm: 1 }, 114: { S: 1, R: 1, X: 0, T: 0 },
  115: { h: 100, N: 30 }, 116: { ni: 1, mi: 1 }, 117: { Ne: 1e12 }, 118: { J: 0.01, E: 0.05 },
  119: { Imean: 1, Istd: 0.3 }, 120: { Pdyn: 2, Bz: 0 }, 121: { Dst: -50, Pdyn: 2, b: 5.2, c: 21 },
  122: { eps0: 8.854e-12, kB: 1.38e-23, Te: 1000, ne: 1e12 }, 123: { ρ: 2e-12, CD: 2.2, A: 10, m: 1000, v: 7500 },
  124: { ρ: 2e-12, CD: 2.2, A: 10, v: 7500, m: 1000 }, 125: { A1: 10, A2: 10, sigmax: 1000, sigmay: 1000, d: 100 },
  126: { ρ2: 1e-10, sigma: 1e-7, v: 7500, N: 10000, L: 100, β: 1e-30, γ: 0.01 }, 127: { n: 0.001, ax: 0.001, ay: 0, az: 0 },
  128: { wi: 1, Ki: 3 }, 129: { traceH: 9 }, 130: { P: 1013.25, T: 288, e: 10, Sc: 0.5 },
  131: { T: 500, h1: 10, h2: 15, r1: 0.15, r2: 100 }, 132: { T: 500, S: 0.001, t: 1000 },
  133: { T: 500, S: 0.001, t: 1000 }, 134: { f0: 75, ft: 10, k: 1.2, t: 60 }, 135: { H: 0.5, V: 0.3, E: 0.8 },
  136: { Parr: 1e6 }, 137: { I_Hi: 100, I_Lo: 50, BP_Hi: 100, BP_Lo: 0, C_p: 75 },
  138: { Xbar: 100, Kp: 5, sigmaX: 30 }, 139: { Xim1: 0, Zi: 0 }, 140: { K0: 1.3, Vres: 1e6, hb: 30 },
  141: { xf: 20, Pf: 10, y: 2, R: 4, xb: 0, H: 1 }, 142: { xb: 0, H: 1, y: 1, R: 1, B: 1 },
  143: { xb: 0, x: 0, y: 1, B: 100, H: 1, R: 10 }, 144: { px: 0.5, py: 0.5, Hxy: 0.25 },
  145: { f: 2.4e9, d: 20200e3, Gt: 20, Gr: 0 }, 146: { Ai: 50, x: 60 }, 147: { f0: 5e9, v: 300, c: 3e8 },
  148: { GM: 3.986e14, r1: 7000000, r2: 42000000 }, 149: { m1: 5.97e24, m2: 7.34e22 },
  150: { px: 0.5, py: 0.5, pxy: 0.25 },
};

const SA_POINT = { mode: 'point' as const, point: [35.68, 139.76] as [number, number] };
const SA_BBOX = { mode: 'bbox' as const, bbox: [[35.43, 139.51], [35.93, 140.01]] as [[number, number], [number, number]] };
const SA_2PT = { mode: 'two-points' as const, twoPoints: [[35.68, 139.76], [34.69, 135.50]] as [[number, number], [number, number]] };
const BBOX_TOOLS = new Set([1,5,6,16,17,26,27,28,29,30,31,32,34,35,37,38,42,51,53,55,58,66,67,68,69,73,80,84,86,87,99,100,101,102,107,141,142,143]);

const BENCHMARKS: Record<number, { description: string; expected: number; tolerance: number; unit: string }> = {
  3: { description: 'Tetens e_s(20C)=23.4 hPa', expected: 23.4, tolerance: 0.5, unit: 'hPa' },
  23: { description: 'Hanks-Kanamori Mw(1e18)=3.79', expected: 3.79, tolerance: 0.1, unit: 'Mw' },
  25: { description: 'Wells-Coppersmith A(Mw=6)=112 km2', expected: 112, tolerance: 20, unit: 'km2' },
  26: { description: 'NDVI(0.4,0.1)=0.6', expected: 0.6, tolerance: 0.01, unit: '—' },
  36: { description: 'Haversine Tokyo-Osaka~396 km', expected: 396, tolerance: 5, unit: 'km' },
  57: { description: 'Redfield C/N/P=6.625', expected: 6.625, tolerance: 0.1, unit: '—' },
  76: { description: 'Komar H_b(d=3)=2.34 m', expected: 2.34, tolerance: 0.05, unit: 'm' },
  78: { description: 'Airy omega(k=0.1,h=10)=0.989', expected: 0.989, tolerance: 0.02, unit: 'rad/s' },
  120: { description: 'Shue R_mp(P=2,Bz=0)~10.2', expected: 10.2, tolerance: 1, unit: 'RE' },
  122: { description: 'Debye(Te=1000,ne=1e12)~0.0074', expected: 0.0074, tolerance: 0.001, unit: 'm' },
};

interface ToolResult {
  toolId: number; status: 'Runtime Passed' | 'Runtime Passed with Warnings' | 'Runtime Failed';
  result?: number; unit?: string; finite: boolean; apiCalls: ApiCall[]; dataSourcesUsed: string[];
  warnings: string[]; validation?: any; qualityControl?: any; uncertainty?: any; interpretation?: any;
  preprocessingNotes?: string[]; visualizationType?: string; dataQualityScore?: number; processingTimeMs?: number;
  proxyUsed: boolean; proxyDetails?: string; benchmark?: any; error?: string;
}

async function runTool(id: number, inputs: Record<string, number>): Promise<ToolResult> {
  apiCalls.length = 0;
  const calls: ApiCall[] = [];
  try {
    const sa = BBOX_TOOLS.has(id) ? SA_BBOX : (id === 36 ? SA_2PT : SA_POINT);
    const time = { granularity: 'instant' as const, start: '2024-06-15', end: '2024-06-15' };
    const res = await computeWithContext(id, inputs, { studyArea: sa, time });
    calls.push(...apiCalls);
    if (!res) return { toolId: id, status: 'Runtime Failed', finite: false, apiCalls: calls, dataSourcesUsed: [], warnings: ['null result'], proxyUsed: false };
    const finite = Number.isFinite(res.result);
    const proxyUsed = res.warnings?.some(w => w.includes('proxy') || w.includes('does NOT satisfy') || w.includes('unavailable')) ?? false;
    const proxyDetails = res.warnings?.find(w => w.includes('proxy') || w.includes('does NOT satisfy') || w.includes('unavailable'));
    let benchmark: any;
    const bm = BENCHMARKS[id];
    if (bm && finite) {
      const error = Math.abs(res.result - bm.expected);
      benchmark = { description: bm.description, expected: bm.expected, actual: res.result, passed: error <= bm.tolerance, error };
    }
    let status: ToolResult['status'] = 'Runtime Passed';
    if (!finite) status = 'Runtime Failed';
    else if (proxyUsed || (res.warnings && res.warnings.length > 0)) status = 'Runtime Passed with Warnings';
    return {
      toolId: id, status, result: res.result, unit: res.unit, finite, apiCalls: calls,
      dataSourcesUsed: res.dataSource ? res.dataSource.split(', ') : [], warnings: res.warnings ?? [],
      validation: res.validation, qualityControl: res.qualityControl, uncertainty: res.uncertainty,
      interpretation: { hasClassification: !!res.interpretation?.classification, hasRecommendations: (res.interpretation?.recommendations?.length ?? 0) > 0 },
      preprocessingNotes: res.preprocessingNotes, visualizationType: res.visualizationType,
      dataQualityScore: res.dataQualityScore, processingTimeMs: res.processingTimeMs, proxyUsed, proxyDetails, benchmark,
    };
  } catch (e) {
    calls.push(...apiCalls);
    return { toolId: id, status: 'Runtime Failed', finite: false, apiCalls: calls, dataSourcesUsed: [], warnings: [], proxyUsed: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const allIds = Object.keys(TOOL_INPUTS).map(Number).sort((a, b) => a - b);
console.log(`\n${'═'.repeat(90)}\n  RUNTIME VALIDATION SUITE — ${allIds.length} tools\n${'═'.repeat(90)}\n`);
const allResults: ToolResult[] = [];
const t0 = Date.now();

for (const id of allIds) {
  const r = await runTool(id, TOOL_INPUTS[id]);
  allResults.push(r);
  const icon = r.status === 'Runtime Passed' ? '\x1b[32m✓\x1b[0m' : r.status === 'Runtime Passed with Warnings' ? '\x1b[33m⚠\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const val = r.finite ? (r.result ?? 0).toExponential(3) : 'NaN';
  const bm = r.benchmark ? (r.benchmark.passed ? ' BM✓' : ' BM✗') : '';
  console.log(`${icon} Eq ${String(id).padStart(3)} | result=${val.padEnd(12)} | APIs=${String(r.apiCalls.length).padStart(2)} | ${r.status}${bm}`);
}
console.log('\n');
const totalTime = Date.now() - t0;
const passed = allResults.filter(r => r.status === 'Runtime Passed');
const warned = allResults.filter(r => r.status === 'Runtime Passed with Warnings');
const failed = allResults.filter(r => r.status === 'Runtime Failed');

console.log(`${'═'.repeat(90)}\n  RUNTIME VALIDATION SUMMARY\n${'═'.repeat(90)}`);
console.log(`  Total tools executed:   ${allResults.length}`);
console.log(`  Runtime Passed:         ${passed.length}`);
console.log(`  Passed with Warnings:   ${warned.length}`);
console.log(`  Runtime Failed:         ${failed.length}`);
console.log(`  Pass rate:              ${(((passed.length + warned.length) / allResults.length) * 100).toFixed(1)}%`);
console.log(`  Total runtime:          ${(totalTime / 1000).toFixed(1)}s`);

const hosts = new Map<string, { calls: number; ok: number; errors: number }>();
for (const r of allResults) for (const c of r.apiCalls) {
  if (!hosts.has(c.host)) hosts.set(c.host, { calls: 0, ok: 0, errors: 0 });
  const h = hosts.get(c.host)!; h.calls++; if (c.ok) h.ok++; if (!c.ok) h.errors++;
}
console.log(`\n  API HOSTS CONTACTED:`);
for (const [host, s] of [...hosts.entries()].sort((a, b) => b[1].calls - a[1].calls))
  console.log(`    ${host.padEnd(45)} ${s.calls} calls (${s.ok} ok, ${s.errors} err)`);

const proxyTools = allResults.filter(r => r.proxyUsed);
console.log(`\n  PROXY VARIABLES DETECTED AT RUNTIME:`);
if (proxyTools.length === 0) console.log(`    None — no proxy variables used at runtime.`);
for (const r of proxyTools) console.log(`    ⚠ Eq ${r.toolId}: ${r.proxyDetails?.slice(0, 120) ?? 'proxy'}`);

const bmR = allResults.filter(r => r.benchmark);
const bmP = bmR.filter(r => r.benchmark.passed);
console.log(`\n  NUMERICAL BENCHMARK VALIDATION: ${bmP.length}/${bmR.length} passed`);
for (const r of bmR) {
  const icon = r.benchmark.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`    ${icon} Eq ${String(r.toolId).padStart(3)}: ${r.benchmark.description} | exp=${r.benchmark.expected}, act=${r.benchmark.actual.toExponential(4)}, err=${r.benchmark.error.toExponential(2)}`);
}

if (failed.length > 0) {
  console.log(`\n  FAILED TOOLS:`);
  for (const r of failed) console.log(`    ✗ Eq ${r.toolId}: ${r.error ?? 'unknown'}`);
}

const stages = {
  validation: allResults.filter(r => r.validation !== undefined).length,
  qualityControl: allResults.filter(r => r.qualityControl !== undefined).length,
  uncertainty: allResults.filter(r => r.uncertainty !== undefined).length,
  interpretation: allResults.filter(r => r.interpretation !== undefined).length,
  preprocessingNotes: allResults.filter(r => r.preprocessingNotes !== undefined).length,
  visualizationType: allResults.filter(r => r.visualizationType !== undefined).length,
  dataQualityScore: allResults.filter(r => r.dataQualityScore !== undefined).length,
};
console.log(`\n  WORKFLOW STAGE EXECUTION:`);
for (const [s, c] of Object.entries(stages)) console.log(`    ${s.padEnd(22)} ${c}/${allResults.length} (${((c / allResults.length) * 100).toFixed(0)}%)`);

const report = {
  timestamp: new Date().toISOString(),
  summary: { totalTools: allResults.length, runtimePassed: passed.length, passedWithWarnings: warned.length, runtimeFailed: failed.length, passRate: (((passed.length + warned.length) / allResults.length) * 100).toFixed(1) + '%', totalRuntimeSec: (totalTime / 1000).toFixed(1), proxyVariablesDetected: proxyTools.length, benchmarksRun: bmR.length, benchmarksPassed: bmP.length },
  apiHosts: Object.fromEntries([...hosts.entries()].map(([h, s]) => [h, s])),
  workflowStages: stages,
  perToolResults: allResults.map(r => ({ toolId: r.toolId, status: r.status, result: r.result, unit: r.unit, finite: r.finite, apiCallCount: r.apiCalls.length, apiCalls: r.apiCalls.map(c => ({ host: c.host, url: c.url, status: c.status, ok: c.ok, bytes: c.bytes })), dataSourcesUsed: r.dataSourcesUsed, warnings: r.warnings, validation: r.validation, qualityControl: r.qualityControl, uncertaintyMethod: r.uncertainty?.method, hasClassification: r.interpretation?.hasClassification, hasRecommendations: r.interpretation?.hasRecommendations, visualizationType: r.visualizationType, dataQualityScore: r.dataQualityScore, processingTimeMs: r.processingTimeMs, proxyUsed: r.proxyUsed, proxyDetails: r.proxyDetails, benchmark: r.benchmark, error: r.error })),
};
writeFileSync('/Users/sreyassanker/Downloads/Realtime_v2/RUNTIME_VALIDATION_REPORT.json', JSON.stringify(report, null, 2));
console.log(`\n  JSON report saved: RUNTIME_VALIDATION_REPORT.json\n${'═'.repeat(90)}\n`);
process.exit(failed.length > 0 ? 1 : 0);
