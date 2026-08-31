import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 17 — Ocean Surface Heat Budget (Gill 1982, Ch. 3) ───────────
// Q_net = Q_s − Q_b − Q_h − Q_e (positive = ocean heat gain).
// Worked example: Q_s=200, Q_b=50, Q_h=20, Q_e=80 → Q_net = 200−50−20−80 = 50 W/m².
// SST tendency = Q_net/(ρc_pH) = 50/(1025·3990·50)·86400 = 0.0211 °C/day.
// Evaporation = Q_e/(ρL_v) = 80/(1000·2.5e6)·86400·1000 = 2.76 mm/day.

describe('Tool 17 — Ocean Surface Heat Budget', () => {
  it('worked example: Q_s=200, Q_b=50, Q_h=20, Q_e=80 → Q_net=50 W/m²', () => {
    const res = computeEquation(17, { Qs: 200, Qb: 50, Qh: 20, Qe: 80, H: 50 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(50, 6);
    expect(res!.unit).toBe('W/m²');
  });

  it('negative Q_net = ocean heat loss (cooling)', () => {
    const res = computeEquation(17, { Qs: 100, Qb: 150, Qh: 20, Qe: 80, H: 50 });
    expect(res!.result).toBeLessThan(0);
  });

  it('exposes sst_tendency and evaporation_rate as secondary', () => {
    const res = computeEquation(17, { Qs: 200, Qb: 50, Qh: 20, Qe: 80, H: 50 });
    const sec = res!.secondary ?? [];
    const sst = sec.find((s) => s.key === 'sst_tendency');
    const evap = sec.find((s) => s.key === 'evaporation_rate');
    expect(sst?.value).toBeCloseTo(50 / (1025 * 3990 * 50) * 86400, 6);
    expect(evap?.value).toBeCloseTo(80 / (1000 * 2.5e6) * 86400 * 1000, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(17, { Qs: '200', Qb: '50', Qh: '20', Qe: '80', H: '50' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(50, 6);
  });

  it('returns honest NaN when ERA5 fluxes are missing', () => {
    const res = computeEquation(17, { Qs: Number.NaN, Qb: Number.NaN, Qh: Number.NaN, Qe: Number.NaN, H: 50 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('no static flux constants');
  });

  it('param aliases: Qₛ→Qs, Q_b→Qb, Q_h→Qh, Q_e→Qe via normalizeInputs', () => {
    const normalized = normalizeInputs(17, { Qₛ: 200, Q_b: 50, Q_h: 20, Q_e: 80 } as unknown as Record<string, number>);
    expect(normalized['Qs']).toBe(200);
    expect(normalized['Qb']).toBe(50);
    expect(normalized['Qh']).toBe(20);
    expect(normalized['Qe']).toBe(80);
  });
});