/**
 * PART3 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { G_GRAV, RHO_SAND, RHO_SW, SAND_POROSITY, teos10SoundSpeed, teos10SpecVol } from '../equationShared';
import type { ComputeFn } from '../equationShared';

export const PART3: Record<number, ComputeFn> = {

  // ── Part III · Domain 10: Ocean Dynamics ──
  // Sverdrup (1947), PNAS 33(11):318-326. Eq (13): β·M_y = curl_z(τ) with
  // β = 2Ωcosφ/R (eq 12); M is the depth-integrated mass transport, so the
  // volume transport per unit width is v = curl_z(τ)/(ρ₀·β) in m²/s.
  // Ekman pumping w_Ek = curl_z(τ)/(ρ₀·f) with f = 2Ωsinφ.
  66: ({ beta, rho0, curlTau_z, f, W }) => {
    const hasCurl = Number.isFinite(curlTau_z);
    // β = 2Ωcosφ/R → 0 within ~0.1° of the poles; the balance is degenerate there.
    const betaDegenerate = !Number.isFinite(beta) || Math.abs(beta) < 1e-14;
    if (!hasCurl || betaDegenerate) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'planetary_beta', value: Number.isFinite(beta) ? beta : Number.NaN, unit: 'm⁻¹s⁻¹', label: 'Planetary vorticity gradient β = 2Ωcosφ/R (paper eq 12)' },
          { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f = 2Ωsinφ' },
          { key: 'ekman_pumping', value: Number.NaN, unit: 'm/s', label: 'Ekman pumping velocity w_Ek = (∇×τ)_z/(ρ₀·f)' },
          { key: 'total_transport_sv', value: Number.NaN, unit: 'Sv', label: 'Total basin transport v × W (1 Sv = 10⁶ m³/s)' },
        ],
        steps: [
          '── Sverdrup Transport (Sverdrup, 1947, PNAS 33(11):318-326) ──',
          'Paper eq (13): β·M_y = curl_z(τ); volume transport per unit width v = curl_z(τ)/(ρ₀·β).',
          '',
          `  β = 2Ωcosφ/R = ${Number.isFinite(beta) ? beta.toExponential(3) : 'NaN'} /m·s (eq 12, from the request latitude)`,
          `  ρ₀ = ${Number.isFinite(rho0) ? rho0.toFixed(0) : 'NaN'} kg/m³ (reference seawater density)`,
          `  (∇×τ)_z = ${hasCurl ? curlTau_z.toExponential(3) : 'NaN — spatial derivative of the wind-stress field; no genuine point source this session — supply (e.g. ASCAT/CCMP wind-product curl) in N/m³'}`,
          '',
          ...(betaDegenerate
            ? ['Result is NaN: β = 2Ωcosφ/R → 0 within ~0.1° of the poles; the Sverdrup relation is degenerate there (finite NaN, never ±∞).']
            : ['Result is NaN: the paper requires the wind-stress curl (∇×τ)_z — supply it to compute (β, ρ₀ are genuine from latitude/constant).']),
        ],
      };
    }
    const v = curlTau_z / (rho0 * beta); // m²/s, meridional volume transport per unit width
    const wEk = (Number.isFinite(f) && Math.abs(f) > 1e-12) ? curlTau_z / (rho0 * f) : Number.NaN;
    const totalSv = (Number.isFinite(W) && W > 0) ? (v * W) / 1e6 : Number.NaN;
    return {
      result: v, unit: 'm²/s',
      secondary: [
        { key: 'planetary_beta', value: Number.isFinite(beta) ? beta : Number.NaN, unit: 'm⁻¹s⁻¹', label: 'Planetary vorticity gradient β = 2Ωcosφ/R (paper eq 12)' },
        { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f = 2Ωsinφ' },
        { key: 'ekman_pumping', value: wEk, unit: 'm/s', label: 'Ekman pumping velocity w_Ek = (∇×τ)_z/(ρ₀·f)' },
        { key: 'total_transport_sv', value: totalSv, unit: 'Sv', label: 'Total basin transport v × W (1 Sv = 10⁶ m³/s)' },
      ],
      steps: [
        '── Sverdrup Transport (Sverdrup, 1947, PNAS 33(11):318-326) ──',
        `Planetary vorticity gradient β = 2Ωcosφ/R = ${beta.toExponential(3)} /m·s (paper eq 12)`,
        `Reference density ρ₀ = ${rho0.toFixed(0)} kg/m³`,
        `Wind stress curl (∇×τ)_z = ${curlTau_z.toExponential(3)} N/m³`,
        '',
        'Step 1 — Vorticity balance (paper eq 13, d/dy(9a) − d/dx(9b) + continuity):',
        '  β·M_y = curl_z(τ) = ∂τ_y/∂x − ∂τ_x/∂y',
        '',
        'Step 2 — Meridional volume transport per unit width:',
        `  v = curl_z(τ)/(ρ₀·β) = ${curlTau_z.toExponential(3)} / (${rho0.toFixed(0)} × ${beta.toExponential(3)})`,
        `  v = ${v.toExponential(4)} m²/s`,
        '',
        ...(Number.isFinite(wEk) ? [
          'Step 3 — Ekman pumping at the base of the Ekman layer:',
          `  w_Ek = curl_z(τ)/(ρ₀·f) = ${curlTau_z.toExponential(3)} / (${rho0.toFixed(0)} × ${f.toExponential(3)}) = ${wEk.toExponential(3)} m/s`,
        ] : ['Step 3 — Ekman pumping: f = 2Ωsinφ → 0 at the equator (balance fails, paper §); w_Ek omitted as NaN.']),
        ...(Number.isFinite(totalSv) ? [
          'Step 4 — Total meridional transport across the basin width:',
          `  V_total = v × W = ${v.toExponential(4)} × ${W.toExponential(2)} = ${totalSv.toExponential(3)} Sv`,
        ] : ['Step 4 — Supply the basin width W (m) for the total transport in Sv (1 Sv = 10⁶ m³/s).']),
        '',
        `  └ ${v > 0 ? 'Northward interior transport — positive curl_z(τ) (cyclonic, subpolar gyre regime)' : v < 0 ? 'Southward interior transport — negative curl_z(τ) (anticyclonic, subtropical gyre regime)' : 'Zero — no wind-stress curl'}`,
        `  └ Validity (paper): interior ocean, away from the equator (f→0) and the western boundary currents; steady state.`,
      ],
    };
  },
  // Stommel (1948), "The westward intensification of wind-driven ocean
  // currents", Trans. AGU 29(2):202-206. Model eq (9): ∇²ψ + α·∂ψ/∂x =
  // γ·sin(πy/b) with α = D·β/R and γ = F·π/(R·b) (eq 6); closed-form
  // solution (19)-(20): ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) with
  // A = −α/2 ± √(α²/4 + (π/b)²), p = (1−e^{BL})/(e^{AL}−e^{BL}), q = 1−p;
  // velocities (21)-(22): u = ∂ψ/∂y, v = −∂ψ/∂x. Boundary-layer width δ = 1/α.
  // All quantities in one consistent unit system (paper: cgs).
  67: ({ beta, D, b, L, R, F, x, y }) => {
    const hasAll = [beta, D, b, L, R, F, x, y].every(Number.isFinite);
    if (!hasAll || D <= 0 || b <= 0 || L <= 0 || R <= 0) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'max_transport', value: Number.NaN, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
          { key: 'max_velocity', value: Number.NaN, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
          { key: 'jet_position_km', value: Number.NaN, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
          { key: 'wbc_width_km', value: Number.NaN, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
          { key: 'alpha', value: Number.NaN, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
          { key: 'gamma', value: Number.NaN, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
        ],
        steps: [
          '── Stommel Westward Intensification (Stommel, 1948, Trans. AGU 29(2):202-206) ──',
          'Model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b),  α = D·β/R,  γ = F·π/(R·b)',
          '',
          `  β (s⁻¹m⁻¹) = ${Number.isFinite(beta) ? beta.toExponential(2) : 'NaN — supply or auto from latitude'}`,
          `  D (depth, m) = ${Number.isFinite(D) ? D.toFixed(0) : 'NaN — basin depth'}`,
          `  b (basin N-S width, m) = ${Number.isFinite(b) ? b.toExponential(2) : 'NaN — basin width'}`,
          `  L (basin E-W length, m) = ${Number.isFinite(L) ? L.toExponential(2) : 'NaN — basin length'}`,
          `  R (friction, s⁻¹) = ${Number.isFinite(R) ? R.toExponential(2) : 'NaN — friction coefficient'}`,
          `  F (max wind stress, N/m²) = ${Number.isFinite(F) ? F.toExponential(2) : 'NaN — wind amplitude'}`,
          `  (x, y) (m) = (${Number.isFinite(x) ? x.toExponential(2) : 'NaN'}, ${Number.isFinite(y) ? y.toExponential(2) : 'NaN'})`,
          '',
          'Result is NaN: all model parameters are required (basin geometry and friction are',
          'model configuration — user supplies; defaults are the paper\'s own numerical example).',
        ],
      };
    }
    const alpha = (D * beta) / R;
    const gamma = (F * Math.PI) / (R * b);
    const nb = Math.PI / b;
    const root = Math.sqrt(alpha * alpha / 4 + nb * nb);
    const A = -alpha / 2 + root;
    const B = -alpha / 2 - root;
    const eAL = Math.exp(A * L), eBL = Math.exp(B * L);
    // e^{BL} underflows to 0 for a strongly-intensified WBC (physically fine:
    // the eastern decay e^{Bx} is negligible at the eastern boundary).
    const p = (1 - eBL) / (eAL - eBL);
    const q = 1 - p;
    const ex = Math.exp(A * x), eBx = Math.exp(B * x);
    const g = p * ex + q * eBx - 1;
    const psi = gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * g;
    const u = gamma * (b / Math.PI) * Math.cos(Math.PI * y / b) * g;
    const v = -gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * (p * A * ex + q * B * eBx);
    const deltaKm = (1 / alpha) / 1000;
    // The transport maximum sits where the x-envelope g(x) = p·e^{Ax}+q·e^{Bx}−1
    // is extremal: g'(x*) = 0 ⇒ x* = ln(−q·B/(p·A))/(A−B) (A > 0, B < 0 for the
    // western-intensified WBC). |ψ_max| at x* (y = b/2) is the WBC transport
    // scale; |v| peaks at the western wall. β = 0 (symmetric) has no jet, so
    // x* = 0 → honest NaN for the jet metrics.
    const xStar = Number.isFinite(p) && Number.isFinite(q) && p * A > 0 && -q * B > 0 && Math.abs(A - B) > 0
      ? Math.log(-q * B / (p * A)) / (A - B)
      : Number.NaN;
    const gMax = Number.isFinite(xStar) && xStar > 0
      ? p * Math.exp(A * xStar) + q * Math.exp(B * xStar) - 1
      : Number.NaN;
    const psiMax = Number.isFinite(gMax)
      ? Math.abs(gamma * b * b / (Math.PI * Math.PI) * gMax)
      : Number.NaN;
    const jetKm = Number.isFinite(xStar) ? xStar / 1000 : Number.NaN;
    const vMax = Number.isFinite(v) ? Math.abs(v) : Number.NaN;
    if (![psi, u, v].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'max_transport', value: Number.isFinite(psiMax) ? psiMax : Number.NaN, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
          { key: 'max_velocity', value: Number.isFinite(vMax) ? vMax : Number.NaN, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
          { key: 'jet_position_km', value: Number.isFinite(jetKm) ? jetKm : Number.NaN, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
          { key: 'wbc_width_km', value: Number.isFinite(deltaKm) ? deltaKm : Number.NaN, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
          { key: 'alpha', value: alpha, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
          { key: 'gamma', value: gamma, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
        ],
        steps: [
          '── Stommel Westward Intensification (Stommel, 1948) ──',
          'The solution overflowed: α·L (or |B|·L) is so large that e^{αL} exceeds double precision.',
          `  α = D·β/R = ${alpha.toExponential(3)}, L = ${L.toExponential(2)} → α·L = ${(alpha * L).toExponential(3)}`,
          'Reduce αL (smaller basin, smaller β, or larger friction R) to compute.',
        ],
      };
    }
    return {
      result: psi, unit: 'm²/s',
      secondary: [
        { key: 'max_transport', value: psiMax, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
        { key: 'max_velocity', value: vMax, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
        { key: 'jet_position_km', value: jetKm, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
        { key: 'wbc_width_km', value: deltaKm, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
        { key: 'u_velocity', value: u, unit: 'm/s', label: 'Zonal velocity u = ∂ψ/∂y' },
        { key: 'v_velocity', value: v, unit: 'm/s', label: 'Meridional velocity v = −∂ψ/∂x' },
        { key: 'alpha', value: alpha, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
        { key: 'gamma', value: gamma, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
      ],
      steps: [
        '── Stommel Westward Intensification (Stommel, 1948, Trans. AGU 29(2):202-206) ──',
        'Model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b) — β-effect vs linear bottom friction −R·u, −R·v.',
        '',
        'Step 1 — Model parameters (paper eq 6):',
        `  α = D·β/R = ${D.toExponential(2)} × ${beta.toExponential(2)} / ${R.toExponential(2)} = ${alpha.toExponential(4)} (m⁻¹ in consistent units)`,
        `  γ = F·π/(R·b) = ${F.toExponential(2)} × π / (${R.toExponential(2)} × ${b.toExponential(2)}) = ${gamma.toExponential(4)} s⁻¹`,
        '',
        'Step 2 — Separation constants (eq 15: X″ + αX′ − n²X = 0, n = π/b):',
        `  A = −α/2 + √(α²/4 + (π/b)²) = ${A.toExponential(4)}`,
        `  B = −α/2 − √(α²/4 + (π/b)²) = ${B.toExponential(4)}`,
        '',
        'Step 3 — Boundary constants (eq 20, ψ = 0 at x = 0 and x = L):',
        `  p = (1 − e^{BL})/(e^{AL} − e^{BL}) = ${p.toExponential(4)},  q = 1 − p = ${q.toExponential(4)}`,
        '',
        'Step 4 — Streamfunction at (x, y) (eq 19):',
        `  ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) = ${psi.toExponential(4)} m²/s`,
        '',
        'Step 5 — Velocities (eqs 21-22):',
        `  u = ∂ψ/∂y = ${u.toExponential(4)} m/s,   v = −∂ψ/∂x = ${v.toExponential(4)} m/s`,
        '',
        `  └ Boundary-layer width δ = 1/α = ${deltaKm.toFixed(0)} km — ${alpha > 0 ? 'the e^{Bx} term concentrates the flow at the WESTERN boundary (westward intensification)' : 'β = 0 (non-rotating case, paper Fig 2) — symmetric circulation, no intensification'}`,
        `  └ Paper example (cgs): D = 2×10⁴ cm, b = 2π×10⁸ cm, L = 10⁹ cm, R = 0.02 s⁻¹, F = 1 dyne/cm², β = 10⁻¹³ s⁻¹cm⁻¹ → α = 10⁻⁷ cm⁻¹, WBC < 100 km, max northward velocity 240 cm/s.`,
        `  └ Gulf Stream at Florida Strait: width ~100 km, speed ~2 m/s, transport ~30 Sv (the observed WBC).`,
      ],
    };
  },
  68: ({ AH, beta, curlTau, x, r }) => {
    // Munk (1950) “On the wind-driven ocean circulation”, J. Meteorology 7(2):79–93.
    // Zonal-wind solution: k = (β/A_H)^(1/3) is the Coriolis-friction wave number;
    // the response function X_w(x) = 1 − e^(−kx/2)·[cos(√3kx/2) + (1/√3)·sin(√3kx/2)]
    // (paper eq 20, western-boundary limit) reproduces the paper's Table 1 extrema
    // exactly (X_w: 0.45/1.17/1.09/0.97 at x/L_w = 1/6, 3/6, 4/6, 1; X'_w/k:
    // 0.55/0.00/−0.09/0.00), with L_w = 4π/(√3k) the oscillation wavelength (eq 24)
    // and the countercurrent = exp(−π/√3) ≈ 17% of the main current. The interior
    // solution pivots to X = 1 − x/r (paper §4). Streamfunction (eq 22/26):
    // ψ(x) = curl_z(τ)·r·X_w(x)/β with the paper's transport scale −1.17·r·curl.
    const eps = 1e-14;
    if (!Number.isFinite(curlTau)) {
      const kNaN = beta > 0 && AH > 0 ? Math.cbrt(beta / AH) : Number.NaN;
      return {
        result: Number.NaN, unit: 'm²/s',
        steps: [
          '── Munk Viscous Western Boundary Layer (Munk, 1950) ──',
          'Model: A_H·∇⁴ψ − β·∂ψ/∂x = curl_z(τ) with lateral (eddy) viscosity.',
          '  k = (β/A_H)^(1/3) = Coriolis-friction wave number',
          `  δ_M = 1/k ≈ ${Number.isFinite(kNaN) ? (1 / kNaN).toFixed(0) : 'N/A'} m — Munk layer width`,
          `  L_w = 4π/(√3k) ≈ ${Number.isFinite(kNaN) ? ((4 * Math.PI) / (Math.sqrt(3) * kNaN)).toFixed(0) : 'N/A'} m — oscillation wavelength`,
          '',
          'INPUT: wind-stress curl (∇×τ)_z is a SPATIAL DERIVATIVE of the wind-stress',
          'field (∂τ_y/∂x − ∂τ_x/∂y) — no genuine point source serves it this session.',
          'Supply the curl (e.g. from ASCAT/CCMP/CERA-20C stress fields) to compute ψ.',
          'Result: NaN (honest — no substitute for the missing curl).',
        ]
      };
    }
    if (!(beta > eps)) {
      return {
        result: Number.NaN, unit: 'm²/s',
        steps: [
          '── Munk Viscous Western Boundary Layer (Munk, 1950) ──',
          `β = ${beta.toExponential(2)} ≤ 0 — the Munk solution requires β > 0`, // (β→0 at the poles)
          'Result: NaN (honest — degenerate β).',
        ]
      };
    }
    const k = Math.cbrt(beta / AH);
    const Lw = (4 * Math.PI) / (Math.sqrt(3) * k);
    const u = (Math.sqrt(3) * k * x) / 2;
    const Xw = 1 - Math.exp(-(k * x) / 2) * (Math.cos(u) + (1 / Math.sqrt(3)) * Math.sin(u));
    const XwPrime = (2 * k / Math.sqrt(3)) * Math.exp(-(k * x) / 2) * Math.sin(u);
    // Interior pivot: X → 1 − x/r for x beyond the western layer (paper §4).
    const X = x <= 0 ? 0 : Xw * (1 - x / r);
    const psi = (curlTau / beta) * r * X;
    const vel = -(curlTau / beta) * r * XwPrime;  // v = −∂ψ/∂x from the western-layer shape
    return {
      result: psi, unit: 'm²/s',
      secondary: [
        { key: 'velocity_v', value: vel, unit: 'm/s', label: 'Meridional velocity v(x)' },
        { key: 'munk_width', value: 1 / k, unit: 'm', label: 'Munk layer width δ_M = 1/k' },
        { key: 'wavelength', value: Lw, unit: 'm', label: 'Oscillation wavelength L_w = 4π/(√3k)' },
        { key: 'countercurrent_ratio', value: Math.exp(-Math.PI / Math.sqrt(3)), unit: '—', label: 'Countercurrent / main current (paper: 17%)' },
        { key: 'Xw', value: Xw, unit: '—', label: 'Response function X_w(x)' },
      ],
      steps: [
        '── Munk Viscous Western Boundary Layer (Munk, 1950, J. Meteor. 7(2):79–93) ──',
        `Lateral eddy viscosity A_H = ${AH.toExponential(1)} m²/s, β = ${beta.toExponential(2)} /m·s`,
        `Evaluation point x = ${x.toExponential(1)} m from the western wall, basin width r = ${r.toExponential(1)} m`,
        '',
        'Step 1 — Coriolis-friction wave number (paper eq 13/16):',
        `  k = (β/A_H)^(1/3) = (${beta.toExponential(2)}/${AH.toExponential(1)})^(1/3)`,
        `    = ${k.toExponential(4)} m⁻¹ (paper: 0.016 km⁻¹ for A = 5×10⁷ cm²/s at 35°N)`,
        '',
        'Step 2 — Munk layer width and oscillation wavelength (eq 24):',
        `  δ_M = 1/k = ${(1 / k).toFixed(0)} m (${(1 / k / 1000).toFixed(1)} km)`,
        `  L_w = 4π/(√3·k) = ${(Lw / 1000).toFixed(1)} km`,
        '',
        'Step 3 — Response function X_w(x) (paper eq 20, western-boundary limit):',
        `  X_w = 1 − e^(−kx/2)·[cos(√3kx/2) + (1/√3)·sin(√3kx/2)] = ${Xw.toFixed(4)}`,
        `  X'_w/k = (2/√3)·e^(−kx/2)·sin(√3kx/2) = ${(XwPrime / k).toFixed(4)}`,
        '  (Table 1 cross-check: X_w extrema 0.45/1.17/1.09/0.97 at x/L_w = 1/6, 3/6, 4/6, 1 ✓)',
        '',
        'Step 4 — Streamfunction (paper eq 22/26):',
        `  ψ(x) = curl_z(τ)·r·X(x)/β, with X = X_w·(1 − x/r) (interior pivot to 1 − x/r)`,
        `  = ${curlTau.toExponential(2)} × ${r.toExponential(1)} × ${X.toFixed(4)} / ${beta.toExponential(2)}`,
        `  = ${psi.toExponential(4)} m²/s`,
        '',
        `  └ Countercurrent: exp(−π/√3) = ${Math.exp(-Math.PI / Math.sqrt(3)).toFixed(3)} ≈ 17% of the main current (paper: 17%, observed 19%)`,
        `  └ Transport scale (eq 26): western current = 1.17·r·curl_z(τ) — independent of A_H ✓`,
        `  └ Gulf Stream: computed 36 vs observed 74 ×10⁶ metric t/s from mean Atlantic zonal winds (paper Table 2)`,
      ]
    };
  },
  69: ({ lambda, delta, R }) => {
    // Stommel (1961) “Thermohaline Convection with Two Stable Regimes of Flow”,
    // Tellus 13(2):224–230. Two-vessel (symmetric) model, non-dimensional:
    //   dx/dt = δ(1−x) − |f|x,  dy/dt = (1−y) − |f|y,  λ·f = Rx − y
    // (x = S/S̄ salinity, y = T/T̄ temperature, f = q/c flow, δ = d/c exchange ratio,
    //  R = βS̄/αT̄ density-effect ratio, λ = dimensionless flow-feedback constant).
    // Equilibrium (paper §5): y = 1/(1+|f|), x = δ/(δ+|f|), with the cubic
    //   λ·f = R·δ/(δ+|f|) − 1/(1+|f|).  Real roots = the flow regimes; stability
    // via the paper's appendix linearization (Poincaré conditions, Stoker 1950).
    // Paper's own example (fig 6/7): R = 2, δ = 1/6, λ = 1/5 → three roots
    // f ≈ −1.1 (stable node a), −0.30 (saddle b), +0.23 (stable spiral c) —
    // i.e. TWO stable regimes (the paper's title). Necessary condition for three
    // equilibria: R·δ < 1 for R > 1 (or R·δ > 1 for 0 < R < 1), λ small enough.
    if (!(lambda > 0) || !(delta > 0) || !(R > 0)) {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Stommel (1961) Two-Vessel Thermohaline Model ──',
          `λ = ${lambda}, δ = ${delta}, R = ${R} — all three must be positive.`,
          'Result: NaN (honest — degenerate parameters).',
        ]
      };
    }
    // Solve λ·f = Rδ/(δ+|f|) − 1/(1+|f|) for f ∈ [−Fmax, Fmax] by bracketing scan + bisection.
    const Fmax = 20;
    const g = (f: number) => lambda * f - (R * delta / (delta + Math.abs(f)) - 1 / (1 + Math.abs(f)));
    const roots: number[] = [];
    const N = 4000;
    let prev = g(-Fmax);
    for (let i = 1; i <= N; i++) {
      const f0 = -Fmax + (2 * Fmax * i) / N;
      const g0 = g(f0);
      if (prev * g0 < 0 || g0 === 0) {
        let lo = -Fmax + (2 * Fmax * (i - 1)) / N, hi = f0;
        for (let b = 0; b < 80; b++) {
          const mid = (lo + hi) / 2;
          if (g(mid) * g(lo) <= 0) hi = mid; else lo = mid;
        }
        const root = (lo + hi) / 2;
        if (!roots.some((r) => Math.abs(r - root) < 1e-6)) roots.push(root);
      }
      prev = g0;
    }
    roots.sort((a, b) => a - b);

    const equilibria = roots.map((f) => {
      const x = delta / (delta + Math.abs(f));
      const y = 1 / (1 + Math.abs(f));
      const s = f > 0 ? 1 : -1; // sign of f; ∂|f|/∂(x,y) = s·(R/λ, −1/λ)
      const J11 = -delta - Math.abs(f) - x * s * R / lambda;
      const J12 = x * s / lambda;
      const J21 = -y * s * R / lambda;
      const J22 = -1 - Math.abs(f) + y * s / lambda;
      const tr = J11 + J22;
      const det = J11 * J22 - J12 * J21;
      const disc = tr * tr - 4 * det;
      let kind: string;
      if (det < 0) kind = 'saddle (unstable)';
      else if (disc >= 0) kind = tr < 0 ? 'stable node' : 'unstable node';
      else kind = tr < 0 ? 'stable spiral' : 'unstable spiral';
      return { f, x, y, tr, det, kind, stable: det > 0 && tr < 0 };
    });
    const nStable = equilibria.filter((e) => e.stable).length;
    const cond = R * delta;
    const threePossible = R > 1 ? cond < 1 : (R > 0 && R < 1 ? cond > 1 : false);

    return {
      result: nStable, unit: 'stable regimes',
      secondary: equilibria.map((e, i) => ({
        key: `equilibrium_${i + 1}`, value: e.f, unit: '—',
        label: `Flow f = ${e.f.toFixed(3)} — ${e.kind} (x=${e.x.toFixed(3)}, y=${e.y.toFixed(3)})`,
      })),
      // Timeseries series (tool vizType 'timeseries'): the equilibrium flow
      // values f (roots of the Stommel cubic λ·f = R·δ/(δ+|f|) − 1/(1+|f|)),
      // one point per regime — shows the distinct flow branches.
      series: [{
        label: 'Stommel equilibrium flow f (roots of λ·f = R·δ/(δ+|f|) − 1/(1+|f|))',
        color: '#0072B2',
        points: equilibria.map((e, i) => ({ x: i, y: Number.isFinite(e.f) ? e.f : Number.NaN })),
      }],
      steps: [
        '── Stommel (1961) Two-Vessel Thermohaline Model (Tellus 13(2):224–230) ──',
        `Exchange ratio δ = ${delta.toFixed(4)} (d/c), density-effect ratio R = ${R.toFixed(2)} (βS̄/αT̄),`,
        `flow-feedback constant λ = ${lambda.toFixed(4)}`,
        '',
        'Step 1 — Equilibrium relations (paper §5):',
        '  y = 1/(1+|f|),  x = δ/(δ+|f|)   (f = q/c dimensionless flow)',
        '  coupled by the capillary flow law  λ·f = Rx − y',
        '',
        'Step 2 — Solve the equilibrium cubic for the flow regimes f:',
        `  λ·f = R·δ/(δ+|f|) − 1/(1+|f|)  →  ${roots.length} real root(s):`,
        ...equilibria.map((e) =>
          `    f = ${e.f.toFixed(3)}  (x = ${e.x.toFixed(3)}, y = ${e.y.toFixed(3)}) → ${e.kind}`),
        '',
        'Step 3 — Stability (paper appendix: Poincaré conditions, Stoker 1950):',
        `  trace = ${equilibria.map((e) => e.tr.toFixed(2)).join(', ')};  det = ${equilibria.map((e) => e.det.toFixed(2)).join(', ')}`,
        `  → ${nStable} stable regime(s), ${roots.length - nStable} unstable (saddle/unstable)`,
        '',
        `  └ Three-equilibria condition: R·δ = ${cond.toFixed(3)} ${threePossible ? '< 1 (R>1) — three equilibria possible if λ small enough' : '— violates R·δ<1 (R>1) or R·δ>1 (0<R<1) — only one regime'}`,
        `  └ Paper example (fig 7): R=2, δ=1/6, λ=1/5 → f = −1.1 (stable node), −0.30 (saddle), +0.23 (stable spiral) — TWO stable regimes ✓`,
        `  └ Hysteresis (paper §6): a slight increase in λ past the critical value annihilates the temperature-dominated branch; the system jumps to the salinity-dominated regime and stays there even after λ is restored.`,
      ]
    };
  },
  70: ({ S, Theta, p }) => {
    // Absolute Salinity S_A (g/kg), Conservative Temperature Θ (°C), sea pressure p (dbar).
    // 75-term specific-volume polynomial (Roquet et al. 2015, Table K.1) — the same
    // computational form as the GSW library's gsw_specvol(). ρ = 1/v; v < 0 or NaN → honest NaN.
    const v = teos10SpecVol(S, Theta, p);
    const rho = Number.isFinite(v) && v > 0 ? 1 / v : Number.NaN;
    const c = teos10SoundSpeed(S, Theta, p);
    const sigmaT = Number.isFinite(rho) ? rho - 1000 : Number.NaN;
    const v0 = teos10SpecVol(S, Theta, 0);
    const sigmaTheta = Number.isFinite(v0) && v0 > 0 ? 1 / v0 - 1000 : Number.NaN;
    return {
      result: rho, unit: 'kg/m³',
      secondary: [
        { key: 'sound_speed', value: c, unit: 'm/s', label: 'TEOS-10 sound speed c' },
        { key: 'sigma_t', value: sigmaT, unit: 'kg/m³', label: 'In-situ density anomaly σ_t' },
        { key: 'sigma_theta', value: sigmaTheta, unit: 'kg/m³', label: 'Potential density anomaly σ_θ' },
      ],
      // Profile series (tool vizType 'profile'): in-situ density ρ vs depth z
      // (0–500 m, 20 points) from the tool's own TEOS-10 specific-volume
      // polynomial (ρ = 1/v), with pressure p ≈ depth z (1 dbar ≈ 1 m).
      series: [{
        label: 'In-situ density ρ(z) (TEOS-10 specific volume)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const z = i * (500 / 19);
          const vAtZ = teos10SpecVol(S, Theta, z);
          const rhoAtZ = Number.isFinite(vAtZ) && vAtZ > 0 ? 1 / vAtZ : Number.NaN;
          return { x: z, y: Number.isFinite(rhoAtZ) ? rhoAtZ : Number.NaN };
        }),
      }],
      steps: [
        '── TEOS-10 Seawater Density (IOC/SCOR/IAPSO 2010; Roquet et al. 2015) ──',
        `Absolute Salinity S_A = ${Number.isFinite(S) ? S.toFixed(2) : 'N/A'} g/kg`,
        `Conservative Temperature Θ = ${Number.isFinite(Theta) ? Theta.toFixed(2) : 'N/A'} °C (ITS-90)`,
        `Sea pressure p = ${Number.isFinite(p) ? p.toFixed(0) : 'N/A'} dbar (≈ ${Number.isFinite(p) ? (p / 10).toFixed(0) : '—'} m depth)`,
        '',
        'Step 1 — Specific volume from the 75-term polynomial (gsw_specvol):',
        '  v(S_A, Θ, p) = Σ c_ijk · x_s^i · y_s^j · z^k   with x_s = √(s_f·(S_A+24)), y_s = Θ/40, z = p/10⁴',
        `  v = ${Number.isFinite(v) && v > 0 ? v.toExponential(4) : 'N/A'} m³/kg`,
        '',
        'Step 2 — In-situ density (ρ = 1/v):',
        `  ρ = ${Number.isFinite(rho) ? rho.toFixed(4) : 'N/A'} kg/m³`,
        `  σ_t = ρ − 1000 = ${Number.isFinite(sigmaT) ? sigmaT.toFixed(3) : 'N/A'} kg/m³ (sigma-t)`,
        '',
        'Step 3 — Potential density anomaly (adiabatically to p = 0):',
        `  σ_θ = ρ(S_A, Θ, 0) − 1000 = ${Number.isFinite(sigmaTheta) ? sigmaTheta.toFixed(3) : 'N/A'} kg/m³`,
        '',
        'Step 4 — TEOS-10 sound speed (c² = −v²/(∂v/∂p)):',
        `  c = ${Number.isFinite(c) ? c.toFixed(1) : 'N/A'} m/s`,
        '',
        `  └ Water mass: ${Number.isFinite(sigmaTheta) ? (sigmaTheta < 23 ? 'Light surface water (tropical warm pool)' : sigmaTheta < 26 ? 'Subtropical mode water' : sigmaTheta < 27.5 ? 'Central/thermocline water' : 'Deep/intermediate water (σθ > 27.5)') : '—'}`,
        `  └ Reference: S_A = 35.16504 g/kg (SSO), Θ = 25 °C, p = 0 → ρ = 1023.3431 kg/m³ (canonical TEOS-10 value)`,
        `  └ Valid range: S_A 0–42 g/kg, Θ −18 to +40 °C, p 0–10000 dbar; outside → NaN (honest no-fill)`,
        `  └ Open-ocean S_A ≈ S_P within ~0.05 g/kg; the composition correction δS_A requires regional data and is not applied here`,
      ]
    };
  },
  71: ({ kappa, gradVar, dTdz, gamma, eps, N2 }) => {
    // Osborn & Cox (1972) eq (25) + eq (5): the fine-structure (Osborn-Cox) method.
    // The paper balances turbulent heat flux against molecular dissipation of
    // temperature variance: <w'θ'>·(∂θ̄/∂z) ≈ −κ·<(∇θ')²> (eq 25), and defines the
    // eddy coefficient A via Q = ρc_p<w'θ'> = ρAc_p(∂θ̄/∂z) (eq 5), so
    //   A = κ·<(∇θ')²> / (∂θ̄/∂z)²
    // κ is the molecular thermal diffusivity (~1.4e-7 m²/s); <(∇θ')²> is the
    // temperature-gradient variance from microstructure (no open point API → NaN),
    // and ∂θ̄/∂z is the mean vertical temperature gradient.
    const kappaOk = Number.isFinite(kappa) && kappa > 0;
    const gradVarOk = Number.isFinite(gradVar) && gradVar >= 0;
    const dTdzOk = Number.isFinite(dTdz) && Math.abs(dTdz) > 0;
    const A = kappaOk && gradVarOk && dTdzOk ? kappa * gradVar / (dTdz * dTdz) : Number.NaN;
    const gradVarValid = Number.isFinite(gradVar) && gradVar >= 0;
    // Osborn (1980) dissipation method (companion, clearly labelled): K_ρ = γ·ε/N²
    const N2ok = Number.isFinite(N2) && N2 > 0;
    const Krho = Number.isFinite(gamma) && Number.isFinite(eps) && N2ok ? gamma * eps / N2 : Number.NaN;
    const mixingEff = Number.isFinite(A) ? (A > 1e-4 ? 'Energetic' : A > 1e-5 ? 'Moderate' : 'Weak') : 'N/A';
    const sigma_theta = Number.isFinite(A) ? A : Number.NaN;
    return {
      result: A, unit: 'm²/s',
      secondary: [
        { key: 'k_rho_osborn1980', value: Krho, unit: 'm²/s', label: 'K_ρ = γ·ε/N² (Osborn 1980 dissipation method — companion)' },
        { key: 'sigma_theta', value: sigma_theta, unit: 'm²/s', label: 'Fine-structure diffusivity (Osborn-Cox 1972)' },
      ],
      steps: [
        '── Osborn-Cox Fine-Structure Diffusivity (Osborn & Cox, 1972) ──',
        `Molecular thermal diffusivity κ = ${Number.isFinite(kappa) ? kappa.toExponential(2) : 'N/A'} m²/s (≈ 1.4×10⁻⁷)`,
        `Temperature-gradient variance <(∇θ')²> = ${gradVarValid ? gradVar.toExponential(2) : 'N/A'} K²/m²`,
        `Mean vertical temperature gradient ∂θ̄/∂z = ${dTdzOk ? dTdz.toExponential(2) : 'N/A'} K/m`,
        '',
        'Step 1 — Balance of turbulent heat flux and molecular dissipation (paper eq 25):',
        '  <w\'θ\'>·(∂θ̄/∂z) ≈ −κ·<(∇θ\')²>',
        '',
        'Step 2 — Eddy coefficient A (paper eq 5: Q = ρc_p<w\'θ\'> = ρAc_p·∂θ̄/∂z):',
        `  A = κ·<(∇θ')²> / (∂θ̄/∂z)² = ${Number.isFinite(kappa) ? kappa.toExponential(2) : 'N/A'} × ${gradVarValid ? gradVar.toExponential(2) : 'N/A'} / ${dTdzOk ? dTdz.toExponential(2) : 'N/A'}²`,
        `  A = ${Number.isFinite(A) ? A.toExponential(3) : 'N/A'} m²/s`,
        '',
        'Step 3 — Mixing regime classification:',
        `  ${mixingEff} turbulent mixing`,
        `  ${Number.isFinite(A) ? (A > 1e-4 ? '→ Topography-enhanced mixing (rough bathymetry, straits)' : A > 1e-5 ? '→ Background thermocline mixing' : '→ Very weak — quiescent regime') : '→ —'}`,
        '',
        `  └ Paper example (San Diego Trough, 275–300 m): <(∇θ')²> = 3.6×10⁻⁷ K²/cm², ∂θ̄/∂z = 9×10⁻⁵ K/cm, κ = 1.4×10⁻³ cm²/s → A = 0.06 cm²/s (paper Table 1: (2±1)×(0.06±0.01))`,
        `  └ Companion Osborn (1980) method K_ρ = γ·ε/N² = ${Number.isFinite(Krho) ? Krho.toExponential(3) : 'N/A'} m²/s (requires ε; honest NaN when missing)`,
        `  └ <(∇θ')²> is a microstructure measurement — no open point API → honest NaN until supplied`,
      ]
    };
  },
  72: ({ g, rho0, drho, h, dV }) => {
    // Price, Weller & Pinkel (1986) PWP mixed layer — the bulk Richardson number
    // criterion (paper eq 9): R_b = g·Δρ·h/(ρ₀·(ΔV)²) ≥ 0.65 for stability.
    // "If R_b < 0.65, then the mixed layer entrains successively deeper levels
    // until (9) is satisfied" (paper §4.2) — i.e. DEEPENING occurs for R_b < 0.65,
    // the interface is stable for R_b ≥ 0.65. Δ( ) = jump across the ML base.
    // The third mixing process (paper §4.2, eq 10) relaxes the gradient Richardson
    // number R_g = g·(∂ρ/∂z)/(ρ₀·(∂V/∂z)²) toward its critical value 0.25 in the
    // stratified fluid below the mixed layer.
    const gOk = Number.isFinite(g) && g > 0;
    const rhoOk = Number.isFinite(rho0) && rho0 > 0;
    const drhoOk = Number.isFinite(drho) && drho >= 0;
    const hOk = Number.isFinite(h) && h > 0;
    const dVOk = Number.isFinite(dV) && Math.abs(dV) > 0;
    const Rb = gOk && rhoOk && drhoOk && hOk && dVOk
      ? (g * drho * h) / (rho0 * dV * dV) : Number.NaN;
    const deepens = Number.isFinite(Rb) ? Rb < 0.65 : false;
    const regime = Number.isFinite(Rb)
      ? (Rb < 0.65 ? 'entraining (deepening)' : 'stable (no deepening)')
      : 'N/A';
    // Timeseries series (tool vizType 'timeseries'): mixed-layer depth h(t)
    // evolution under PWP entrainment. While R_b < 0.65 (paper eq 9) the layer
    // entrains toward the depth where R_b = 0.65:
    //   h* = 0.65·ρ₀·ΔV²/(g·Δρ),   approached on the |ΔV| velocity timescale.
    // Stable inputs (R_b ≥ 0.65) → constant h (no deepening).
    const wE = dVOk ? Math.abs(dV) : Number.NaN;                    // velocity jump |ΔV| (entrainment scale)
    const hStar = gOk && rhoOk && drhoOk && drho > 0 && Number.isFinite(wE) && wE > 0
      ? (0.65 * rho0 * wE * wE) / (g * drho) : Number.NaN;           // depth at which R_b = 0.65
    const tau = hOk && Number.isFinite(hStar) && Number.isFinite(wE) && wE > 0
      ? Math.max(Math.abs(hStar - h) / wE, 1) : Number.NaN;          // model-time to reach equilibrium
    const series = [
      {
        label: 'Mixed-layer depth h(t) under PWP entrainment (R_b → 0.65)',
        color: '#0072B2',
        points: Array.from({ length: 25 }, (_, i) => {
          const t = i; // time steps 0…24
          const frac = Number.isFinite(tau) ? Math.min(1, t / tau) : 0;
          const ht = Number.isFinite(hStar) && hOk ? h + (hStar - h) * frac : Number.NaN;
          return { x: t, y: Number.isFinite(ht) ? ht : Number.NaN };
        }),
      },
    ];
    return {
      result: deepens ? 1 : 0, unit: '—',
      secondary: [
        { key: 'Rb', value: Rb, unit: '—', label: 'Bulk Richardson number R_b = g·Δρ·h/(ρ₀·ΔV²) (paper eq 9)' },
        { key: 'entrainment', value: deepens ? 1 : 0, unit: '—', label: 'Mixed layer deepening (R_b < 0.65)' },
      ],
      series,
      steps: [
        '── Price-Weller-Pinkel Mixed Layer (Price, Weller & Pinkel, 1986) ──',
        `Gravity g = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} m/s², reference density ρ₀ = ${Number.isFinite(rho0) ? rho0.toFixed(0) : 'N/A'} kg/m³`,
        `Density jump across the ML base Δρ = ${drhoOk ? drho.toExponential(2) : 'N/A'} kg/m³`,
        `Mixed-layer depth h = ${hOk ? h.toFixed(1) : 'N/A'} m`,
        `Velocity jump across the ML base ΔV = ${dVOk ? dV.toExponential(2) : 'N/A'} m/s`,
        '',
        'Step 1 — Bulk Richardson number (paper eq 9):',
        `  R_b = g·Δρ·h / (ρ₀·ΔV²) = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} × ${drhoOk ? drho.toExponential(2) : 'N/A'} × ${hOk ? h.toFixed(1) : 'N/A'} / (${rhoOk ? rho0.toFixed(0) : 'N/A'} × ${dVOk ? dV.toExponential(2) : 'N/A'}²)`,
        `  R_b = ${Number.isFinite(Rb) ? Rb.toFixed(3) : 'N/A'}`,
        '',
        'Step 2 — Deepening criterion (paper §4.2):',
        `  ${Number.isFinite(Rb) ? (Rb < 0.65 ? `R_b (${Rb.toFixed(3)}) < 0.65 → MIXED LAYER ENTRAINS / DEEPENS (shear instability erodes the thermocline until eq 9 is satisfied)` : `R_b (${Rb.toFixed(3)}) ≥ 0.65 → STABLE, no deepening (interface resists mixing)`) : 'R_b unavailable — supply ΔV (velocity jump) or Δρ (density jump)'}`,
        '',
        'Step 3 — Third mixing process (paper §4.2, eq 10): gradient Richardson number',
        '  R_g = g·(∂ρ/∂z)/(ρ₀·(∂V/∂z)²) ≥ 0.25 is relaxed in the stratified fluid below the ML',
        `  └ Regime: ${regime}`,
        `  └ Δ( ) = difference between the mixed layer and the level just beneath (paper §4.3)`,
        `  └ The 0.65 bulk threshold is the DIM criterion of Price et al. (1978); the 0.25 gradient value is the Miles-Howard critical Ri (Turner 1973; Thompson 1980; Adamec et al. 1981)`,
      ]
    };
  },
  73: ({ U, omega, g, __wind10m, __windDate }) => {
    // Pierson & Moskowitz (1964) eq (12) — the fully-developed wind-sea spectrum:
    //   S(ω) dω = (α·g²/ω⁵)·e^(−β·(ω₀/ω)⁴) dω,  with α = 8.10×10⁻³, β = 0.74,
    //   ω₀ = g/U (U = wind speed at the weather-ship height). Both α and β are
    //   fixed by the paper (eq 12 discussion). Derived: peak ω_p = (4β/5)^(1/4)·g/U
    //   = 0.877·g/U; total variance m₀ = α·g²/(4β·ω₀⁴) = α·U⁴/(4β·g²); significant
    //   wave height H_s = 4·√m₀ = 4·√(α/(4β))·U²/g = 0.209·U²/g (the classic P-M
    //   relation); peak period T_p = 2π/ω_p = 2π·(5/(4β))^(1/4)·U/g = 7.16·U/g.
    const gOk = Number.isFinite(g) && g > 0;
    const UOk = Number.isFinite(U) && U > 0;
    const omegaOk = Number.isFinite(omega) && omega > 0;
    const w0 = gOk && UOk ? g / U : Number.NaN;
    const wp = gOk && UOk ? Math.pow(4 * 0.74 / 5, 0.25) * g / U : Number.NaN;
    const Tp = Number.isFinite(wp) && wp > 0 ? 2 * Math.PI / wp : Number.NaN;
    const m0 = gOk && UOk ? 8.10e-3 * Math.pow(U, 4) / (4 * 0.74 * g * g) : Number.NaN;
    const Hs = Number.isFinite(m0) && m0 >= 0 ? 4 * Math.sqrt(m0) : Number.NaN;
    const S = gOk && UOk && omegaOk
      ? (8.10e-3 * g * g) / Math.pow(omega, 5) * Math.exp(-0.74 * Math.pow(w0 / omega, 4))
      : Number.NaN;
    return {
      result: S, unit: 'm²·s',
      secondary: [
        { key: 'Hs', value: Hs, unit: 'm', label: 'Significant wave height H_s = 4√m₀ (fully developed)' },
        { key: 'Tp', value: Tp, unit: 's', label: 'Peak wave period T_p = 2π/ω_p' },
        { key: 'wp', value: wp, unit: 'rad/s', label: 'Peak angular frequency ω_p = (4β/5)^(1/4)·g/U' },
      ],
      // Spectrum series (tool vizType 'spectrum'): S(ω) vs ω across 0.1–10
      // rad/s (40 log-spaced points) from the tool's own Pierson-Moskowitz
      // eq 12. Only emitted when g and U are finite (honest empty otherwise).
      series: gOk && UOk
        ? [{
            label: `Pierson-Moskowitz spectrum S(ω), U = ${U.toFixed(1)} m/s`,
            color: '#0072B2',
            points: Array.from({ length: 40 }, (_, i) => {
              const omega = 0.1 * Math.pow(100, i / 39); // 0.1 → 10 rad/s, log-spaced
              const Sval = (8.10e-3 * g * g) / Math.pow(omega, 5) * Math.exp(-0.74 * Math.pow((g / U) / omega, 4));
              return { x: omega, y: Number.isFinite(Sval) ? Sval : Number.NaN };
            }),
          }]
        : undefined,
      steps: [
        '── Pierson-Moskowitz Spectrum (Pierson & Moskowitz, 1964, eq 12) ──',
        `Wind speed U = ${UOk ? U.toFixed(2) : 'N/A'} m/s (19.5 m weather-ship reference height; α, β fixed by the paper)`,
        ...(__wind10m != null && Number.isFinite(__wind10m)
          ? [`  └ auto: genuine ERA5 10 m wind ${__wind10m.toFixed(2)} m/s${__windDate ? ` (as of ${__windDate})` : ''} converted to the paper's 19.5 m reference height via the neutral log profile (z₀ = 0.0002 m open ocean)`]
          : []),
        `Gravity g = ${gOk ? g.toFixed(2) : 'N/A'} m/s²`,
        `Evaluation frequency ω = ${omegaOk ? omega.toFixed(4) : 'N/A'} rad/s (default: the peak ω_p)`,
        '',
        'Step 1 — Spectral form (paper eq 12):',
        '  S(ω) = (α·g²/ω⁵)·e^(−β·(ω₀/ω)⁴),  α = 8.10×10⁻³, β = 0.74, ω₀ = g/U',
        `  ω₀ = g/U = ${Number.isFinite(w0) ? w0.toExponential(3) : 'N/A'} rad/s`,
        `  S(ω) = ${Number.isFinite(S) ? S.toExponential(3) : 'N/A'} m²·s`,
        '',
        'Step 2 — Peak frequency (dS/dω = 0):',
        `  ω_p = (4β/5)^(1/4)·g/U = ${Number.isFinite(wp) ? wp.toFixed(4) : 'N/A'} rad/s → T_p = ${Number.isFinite(Tp) ? Tp.toFixed(2) : 'N/A'} s`,
        '',
        'Step 3 — Significant wave height (H_s = 4√m₀, m₀ = α·U⁴/(4β·g²)):',
        `  H_s = ${Number.isFinite(Hs) ? Hs.toFixed(3) : 'N/A'} m  (= 0.209·U²/g — the classic P-M relation)`,
        '',
        `  └ Valid for fully developed seas: unlimited fetch and duration (the paper's assumption)`,
        `  └ Paper data range: 20–40 knots (10.29–20.58 m/s) from weather-ship spectra (Moskowitz 1964)`,
        `  └ U is the weather-ship wind (the paper: "The spectral form given by (12) will describe the spectrum of a fully developed wind sea for a wind measured at 19.5 meters")`,
      ]
    };
  },
  // ── Domain 11: Coastal & Wave ──
  74: ({ H0, T0, betaF, g, __hAuto, __tAuto, __betaAuto, __waveDate }) => {
    // Stockdon et al. (2006), Coastal Engineering 53(7):573-588.
    // Eq (1): deep-water wavelength L₀ = gT₀²/2π. Iribarren number
    // ξ₀ = β_f/√(H₀/L₀) selects the regime:
    //   ξ₀ < 0.3  (dissipative): Eq (16) η̄_d = 0.016(H₀L₀)^{1/2},
    //                Eq (17) S_d = 0.046(H₀L₀)^{1/2}, Eq (18)
    //                R₂ = 0.043(H₀L₀)^{1/2} — NO slope dependence.
    //   ξ₀ ≥ 0.3  (intermediate/reflective, all sites):
    //                Eq (10) η̄ = 0.35·β_f·(H₀L₀)^{1/2},
    //                Eq (11) S_inc = 0.75·β_f·(H₀L₀)^{1/2},
    //                Eq (12) S_IG = 0.06·(H₀L₀)^{1/2},
    //                combined swash S = √(S_inc² + S_IG²),
    //                Eq (19) R₂ = 1.1·(η̄ + S/2) with
    //                0.563 ≈ 0.75² and 0.004 ≈ 0.06².
    const L0 = g * T0 * T0 / (2 * Math.PI);
    const h0l0 = Math.sqrt(H0 * L0);
    const iribarren = betaF > 0 ? betaF / Math.sqrt(H0 / L0) : Number.NaN;
    const dissipative = Number.isFinite(iribarren) && iribarren < 0.3;
    const setup = dissipative ? 0.016 * h0l0 : 0.35 * betaF * h0l0;
    const sInc = 0.75 * betaF * h0l0;
    const sIg = 0.06 * h0l0;
    const swash = dissipative ? 0.046 * h0l0 : Math.sqrt(sInc * sInc + sIg * sIg);
    // Dissipative branch: paper Eq (18) fixes R₂ = 0.043·(H₀L₀)^{1/2}
    // directly (the printed coefficient; 1.1·(0.016+0.046/2)=0.0429 is the
    // un-rounded value). All-sites: paper Eq (9)/Eq (19) R₂ = 1.1·(η̄ + S/2).
    const R2 = dissipative ? 0.043 * h0l0 : 1.1 * (setup + 0.5 * swash);
    const finite = Number.isFinite(R2);
    return {
      result: R2, unit: 'm',
      secondary: [
        { key: 'setup', value: setup, unit: 'm', label: 'Wave setup η̄ at the shoreline (Eq 10/16)' },
        { key: 'swash', value: swash, unit: 'm', label: 'Significant swash S (combined; Eq 11-12/17)' },
        { key: 'iribarren', value: iribarren, unit: '—', label: 'Iribarren number ξ₀ = β_f/√(H₀/L₀) (regime selector)' },
      ],
      steps: [
        '── Stockdon Wave Runup (Stockdon et al., 2006) ──',
        `Deep-water significant wave height H₀ = ${H0.toFixed(2)} m${__hAuto ? ' (auto: genuine ERA5 swh)' : ''}`,
        `Deep-water peak period T₀ = ${T0.toFixed(1)} s${__tAuto ? ' (auto: genuine ERA5 pp1d)' : ''}${__waveDate ? ` (as of ${__waveDate})` : ''}`,
        `Foreshore beach slope β_f = ${betaF.toFixed(4)}${__betaAuto ? ' (auto: SRTM30m slope at the point)' : ''}`,
        '',
        'Step 1 — Deep-water wavelength (paper Eq 1):',
        `  L₀ = gT₀²/2π = ${g.toFixed(2)} × ${T0.toFixed(1)}² / (2π) = ${L0.toFixed(1)} m`,
        '',
        'Step 2 — Iribarren number (regime selector):',
        `  ξ₀ = β_f / √(H₀/L₀) = ${Number.isFinite(iribarren) ? iribarren.toFixed(3) : 'N/A'} → ${dissipative ? 'DISSIPATIVE regime (ξ₀ < 0.3): slope-independent model, Eqs (16)-(18)' : 'INTERMEDIATE/REFLECTIVE regime (ξ₀ ≥ 0.3): all-sites model, Eqs (10)-(12), (19)'}`,
        '',
        'Step 3 — Setup at the shoreline:',
        dissipative
          ? `  η̄_d = 0.016·(H₀L₀)^{1/2} = 0.016 × ${h0l0.toFixed(2)} = ${setup.toFixed(3)} m  (paper Eq 16)`
          : `  η̄ = 0.35·β_f·(H₀L₀)^{1/2} = 0.35 × ${betaF.toFixed(4)} × ${h0l0.toFixed(2)} = ${setup.toFixed(3)} m  (paper Eq 10)`,
        '',
        'Step 4 — Significant swash:',
        ...(dissipative
          ? [`  S_d = 0.046·(H₀L₀)^{1/2} = 0.046 × ${h0l0.toFixed(2)} = ${swash.toFixed(3)} m  (paper Eq 17)`]
          : [
              `  S_inc = 0.75·β_f·(H₀L₀)^{1/2} = 0.75 × ${betaF.toFixed(4)} × ${h0l0.toFixed(2)} = ${sInc.toFixed(3)} m  (paper Eq 11)`,
              `  S_IG  = 0.06·(H₀L₀)^{1/2}   = 0.06 × ${h0l0.toFixed(2)} = ${sIg.toFixed(3)} m  (paper Eq 12)`,
              `  S = √(S_inc² + S_IG²) = √(${sInc.toFixed(3)}² + ${sIg.toFixed(3)}²) = ${swash.toFixed(3)} m`,
            ]),
        '',
        'Step 5 — 2% exceedance runup:',
        dissipative
          ? `  R₂ = 0.043·(H₀L₀)^{1/2} = 0.043 × ${h0l0.toFixed(2)} = ${finite ? R2.toFixed(2) : 'N/A'} m  (paper Eq 18)`
          : `  R₂ = 1.1 × (η̄ + S/2) = 1.1 × (${setup.toFixed(3)} + ${(swash / 2).toFixed(3)}) = ${finite ? R2.toFixed(2) : 'N/A'} m  (paper Eq 9/19)`,
        '',
        `  └ ${!finite ? 'No genuine wave/slope data — honest NaN' : dissipative ? 'Dissipative beach (ξ₀ < 0.3): runup scales with √(H₀L₀) only, no slope dependence' : R2 < 1 ? 'Low runup — sheltered or dissipative conditions' : R2 < 3 ? 'Moderate runup — intermediate beach' : R2 < 6 ? 'High runup — reflective beach, storm overwash potential' : 'Extreme runup — dune erosion / overtopping likely'}`,
        `  └ Paper validation: 10 field experiments, rms error 38 cm (bias −17 cm); 2% exceedance of the runup distribution`,
      ]
    };
  },
  75: ({ L, S, B, hstar, __sAuto, __hstarAuto, __bAuto, __lAuto, __slrNote, __waveDate, __slopeDeg }) => {
    // Bruun (1962), "Sea-level rise as a cause of shore erosion". J. Wtrwy.
    // Harb. Div. 88(1):117-130. doi:10.1061/jwheau.0000252.
    //   R = S·L/(B + h*)   — canonical form, equivalently R = S/tanβ with
    //   L = (B + h*)/tanβ at the average active-profile slope (SCOR 1991 /
    //   Wikipedia restatement; Zhang et al. 2004 re-derivation).
    // Honest NaN when any required datum is missing/invalid (zero-fallback:
    // no static geometry or SLR constants in place of genuine data).
    const denom = B + hstar;
    const R = Number.isFinite(L) && Number.isFinite(S) && Number.isFinite(denom) && denom > 0
      ? (L * S) / denom
      : Number.NaN;
    const finite = Number.isFinite(R);
    const R_mm = finite ? R * 1000 : Number.NaN;
    const factor = Number.isFinite(L) && Number.isFinite(denom) && denom > 0 ? L / denom : Number.NaN;
    const retreat2100 = finite ? R * 80 : Number.NaN; // 2020–2100 at the current rate
    const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'N/A');
    const sStr = Number.isFinite(S) ? `${(S * 1000).toFixed(2)} mm/yr (${S.toExponential(2)} m/yr)` : 'N/A';
    const autoNote = (flag: boolean | undefined, src: string) => (flag ? ` (auto: ${src})` : ' (user input)');
    return {
      result: R, unit: 'm/yr',
      secondary: [
        { key: 'retreat_factor', value: factor, unit: '—', label: 'Bruun factor R/S = L/(B+h*) — retreat per metre of sea-level rise' },
        { key: 'total_retreat', value: retreat2100, unit: 'm', label: 'Total shoreline retreat 2020–2100 (80 yr at the current rate)' },
      ],
      // Timeseries series (tool vizType 'timeseries'): cumulative shoreline
      // retreat R(t) = L·S·t/(B+h*) over 0–100 yr (20 points). Emitted only
      // when the annual retreat R is finite (honest empty otherwise).
      series: finite
        ? [{
            label: 'Cumulative shoreline retreat R(t) = L·S·t/(B+h*)',
            color: '#0072B2',
            points: Array.from({ length: 20 }, (_, i) => {
              const t = i * (100 / 19);
              return { x: t, y: Number.isFinite(R) ? R * t : Number.NaN };
            }),
          }]
        : undefined,
      steps: [
        '── Bruun Shoreline Retreat (Bruun, 1962) ──',
        `Sea-level rise rate S = ${sStr}${autoNote(__sAuto, 'genuine NOAA CO-OPS tide-gauge trend')}`,
        ...(__slrNote ? [`  └ ${__slrNote}`] : []),
        `Closure depth h* = ${fmt(hstar)} m${autoNote(__hstarAuto, 'Hallermeier 1981: h* = 1.57·H_s from genuine CDS ERA5 swh')}${__waveDate ? ` (as of ${__waveDate})` : ''}`,
        `Berm/dune height B = ${fmt(B, 2)} m${autoNote(__bAuto, 'SRTM30m terrain elevation at the point')}`,
        `Active profile length L = ${fmt(L, 0)} m${autoNote(__lAuto, 'L = (B + h*)/tanβ at the genuine SRTM30m slope' + (__slopeDeg ? `, β = ${__slopeDeg.toFixed(2)}°` : ''))}`,
        '',
        'Step 1 — Compute the retreat rate:',
        `  R = (L × S) / (B + h*) = (${fmt(L, 0)} × ${Number.isFinite(S) ? S.toExponential(2) : 'N/A'}) / (${fmt(B, 1)} + ${fmt(hstar, 1)})`,
        `  R = ${fmt(R, 3)} m/yr (${Number.isFinite(R_mm) ? R_mm.toFixed(0) : 'N/A'} mm/yr)`,
        Number.isFinite(S) && S > 0
          ? `  Bruun factor R/S = L/(B + h*) = ${fmt(L, 0)} / ${fmt(denom, 1)} = ${fmt(factor, 0)}  (also = 1/tanβ = ${__slopeDeg ? fmt(1 / Math.tan(__slopeDeg * Math.PI / 180), 0) : 'N/A'} — the slope form R = S/tanβ)`
          : '  Bruun factor undefined when S = 0',
        '',
        'Step 2 — Cumulative retreat to 2100 (2020–2100):',
        `  ΔR = R × 80 = ${fmt(retreat2100, 1)} m at the current rate`,
        '',
        `  └ ${!finite ? 'Missing genuine data (S / wave / terrain) — honest NaN' : R < 0.1 ? 'Low retreat rate — stable coast or low SLR' : R < 0.5 ? 'Moderate retreat — requires monitoring' : R < 2 ? 'Rapid retreat — active erosion management needed' : 'Severe retreat — immediate adaptation required'}`,
        `  └ Bruun Rule assumes the profile translates up-and-landward preserving its equilibrium shape; no longshore transport, sediment supply, or hard structures (Cooper & Pilkey 2004 critique)`,
      ]
    };
  },
  76: ({ db, __dbAuto = true, __gebcoElev = null }) => {
    // McCowan (1894): the highest solitary wave of permanent type in water
    // of mean depth h rises to crest height c = 1.78h, so the maximum wave
    // height is c − h = 0.78h (paper eq 34). The breaking criterion
    // H_b = 0.78·d_b is the same relation evaluated at the breaking depth.
    const finite = Number.isFinite(db) && db > 0;
    const Hb = finite ? 0.78 * db : Number.NaN;
    // Paper eq (35): the highest wave travels at V = √(1.56·g·h), ~25 %
    // faster than a low solitary wave (√(g·h)).
    const Vmax = finite ? Math.sqrt(1.56 * G_GRAV * db) : Number.NaN;
    const srcLine = __dbAuto === false
      ? `Water depth at breaking d_b = ${finite ? db.toFixed(2) : 'N/A'} m (user input)`
      : __gebcoElev != null
        ? `Water depth at breaking d_b = ${finite ? db.toFixed(2) : 'N/A'} m (auto: GEBCO 2020 bathymetry, ground elevation ${__gebcoElev.toFixed(1)} m)`
        : 'Water depth at breaking d_b = N/A — no genuine bathymetry (honest NaN)';
    return {
      result: Hb, unit: 'm',
      secondary: [
        { key: 'breaker_index', value: finite ? 0.78 : Number.NaN, unit: '—', label: 'Breaker index γ_b = H_b/d_b (McCowan 1894 eq 34)' },
        { key: 'wave_speed', value: Vmax, unit: 'm/s', label: 'Celerity of the highest wave V = √(1.56·g·d_b) (paper eq 35)' },
        { key: 'crest_angle', value: 120, unit: '°', label: 'Crest angle of the highest wave — two branches cutting at 120° (paper §3/§5)' },
      ],
      steps: [
        '── McCowan Highest Wave (McCowan, 1894, Phil. Mag. Ser. 5 38(233):351–358) ──',
        srcLine,
        'Paper result: the highest solitary wave of permanent type in water of',
        'mean depth h reaches crest height c = 1.78h, so the maximum wave height',
        'is c − h = 0.78h (paper eq 34).',
        '',
        ...(finite
          ? [
            'Step 1 — Breaking wave height at the McCowan limit:',
            `  H_b = γ_b × d_b = 0.78 × ${db.toFixed(2)}`,
            `  H_b = ${Hb.toFixed(2)} m`,
            '',
            'Step 2 — Paper derived quantities:',
            '  Crest is a blunt wedge — two branches cutting at 120° (§3/§5);',
            '  radius of curvature at the crest ≈ 30× the depth (§5)',
            `  Celerity of the highest wave V = √(1.56·g·d_b) = ${Vmax.toFixed(2)} m/s — about 25 % faster than a low wave (√(g·d_b)) (eq 35)`,
          ]
          : [
            '  Missing/non-positive breaking depth — honest NaN (the criterion',
            '  requires a positive water depth at breaking; no static depth, no proxy).',
          ]),
        '',
        `  └ γ_b = H_b/d_b = ${finite ? (Hb / db).toFixed(3) : 'N/A'} — derived for a horizontal bed (endless rectangular channel of uniform depth)`,
        '  └ On natural sloping beaches γ_b varies with the Iribarren number (≈ 0.4–1.2); 0.78 is the canonical intermediate value',
        '  └ Breaker type (spilling/plunging/surging) needs the beach-slope / Iribarren input this tool does not take',
        '  └ In deep water (d_b ≫ L/2) depth-limited breaking no longer governs — Stokes wave-steepness limits height first',
      ]
    };
  },
  77: ({ K, Hsb, thetaB, __hAuto = true, __thetaAuto = true, __thetaNote = null, __deepWaterForm = false, __waveDate = null }) => {
    // CERC longshore sediment transport — Shore Protection Manual (1984),
    // Vol 1, Ch 4 (Littoral Processes), §V Energy Flux Method:
    //   eq 4-44 (breaking height):  P_ls = 0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b)
    //   eq 4-45 (deep-water H_0s):  P_ls = 0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀)
    //   eq 4-48: I_l = K·P_ls, K = 0.39 (SPM design value; Komar & Inman
    //             1970 use 0.77 with deep-water H_o — the factor ~2 gap is
    //             the significant-height vs deep-water difference, SPM text)
    //   eq 4-35/4-49: Q = I_l/((ρs−ρ)·g·(1−n))   (Table 4-8: ρs=2650, ρ=1025, 1−n=0.6)
    //   eq 4-50a: Q(yr) = 1290·P_ls m³/yr  (dimensional design constant)
    const finite = Number.isFinite(K) && K > 0
      && Number.isFinite(Hsb) && Hsb > 0
      && Number.isFinite(thetaB);
    const sin2t = finite ? Math.sin(2 * thetaB) : Number.NaN;
    // Deep-water form (eq 4-45) applies when H comes from genuine ERA5 swh
    // (the paper's H_0s); the breaking form (eq 4-44) when the user supplies
    // a breaking height H_b.
    const cosA = finite ? Math.cos(thetaB) : 0;
    const cEff = __deepWaterForm ? 0.05 * Math.pow(Math.max(cosA, 0), 0.25) : 0.0884;
    const Pls = finite
      ? cEff * RHO_SW * Math.pow(G_GRAV, 1.5) * Math.pow(Hsb, 2.5) * sin2t
      : Number.NaN; // J/(s·m) — longshore energy flux factor
    const I = finite ? K * Pls : Number.NaN; // N/s — immersed-weight rate (eq 4-48)
    const denom = (RHO_SAND - RHO_SW) * G_GRAV * (1 - SAND_POROSITY); // (2650−1025)·9.80665·0.6
    const Q = finite ? I / denom : Number.NaN; // m³/s (eq 4-35/4-49)
    const Qyr = finite ? 1290 * Pls : Number.NaN; // m³/yr (eq 4-50a)
    const hLine = __hAuto
      ? `Significant wave height H = ${finite ? Hsb.toFixed(2) : 'N/A'} m (auto: genuine CDS ERA5 swh — treated as the paper's deep-water H_0s)${__waveDate ? ` (as of ${__waveDate})` : ''}`
      : `Breaking significant wave height H_b = ${finite ? Hsb.toFixed(2) : 'N/A'} m (user input — breaking form)`;
    const thetaLine = __thetaAuto
      ? `Breaker angle θ = ${finite ? (thetaB * 180 / Math.PI).toFixed(1) : 'N/A'}°${__thetaNote ? ` (${__thetaNote})` : ' — no genuine shoreline/wave-direction → honest NaN'}`
      : `Breaker angle θ_b = ${finite ? (thetaB * 180 / Math.PI).toFixed(1) : 'N/A'}° (user input, from the shore-normal; sin(2θ) form)`;
    return {
      result: Q, unit: 'm³/s',
      secondary: [
        { key: 'energy_flux', value: Pls, unit: 'J/(s·m)', label: 'Longshore energy flux factor P_ls (SPM eq 4-44/4-45)' },
        { key: 'immersed_weight', value: I, unit: 'N/s', label: 'Immersed-weight transport rate I_l = K·P_ls (eq 4-48)' },
        { key: 'transport_annual', value: Qyr, unit: 'm³/yr', label: 'Annual volumetric transport Q = 1290·P_ls (eq 4-50a)' },
      ],
      steps: [
        '── CERC Longshore Sediment Transport (SPM 1984, Vol 1 Ch 4 §V) ──',
        hLine,
        thetaLine,
        `CERC coefficient K = ${finite ? K.toFixed(3) : 'N/A'} (SPM design value 0.39; Komar & Inman 1970: 0.77 with deep-water H_o)`,
        '',
        ...(finite
          ? [
            'Step 1 — Longshore energy flux factor (Table 4-10):',
            `  P_ls = ${__deepWaterForm ? `0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀)` : `0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b)`}`,
            `  P_ls = ${cEff.toFixed(4)} × ${RHO_SW} × ${Math.pow(G_GRAV, 1.5).toFixed(2)} × ${Math.pow(Hsb, 2.5).toFixed(3)} × ${sin2t.toFixed(4)}`,
            `  P_ls = ${Pls.toFixed(1)} J/(s·m)`,
            '',
            'Step 2 — Immersed-weight rate (eq 4-48):',
            `  I_l = K × P_ls = ${K.toFixed(3)} × ${Pls.toFixed(1)} = ${I.toFixed(1)} N/s`,
            '',
            'Step 3 — Volumetric transport (eq 4-35/4-49):',
            `  Q = I_l / ((ρs−ρ)·g·(1−n)) = ${I.toFixed(1)} / (${RHO_SAND - RHO_SW} × ${G_GRAV} × 0.6)`,
            `  Q = ${Q.toFixed(4)} m³/s`,
            '',
            'Cross-check — SPM design relation eq 4-50a:',
            `  Q(yr) = 1290 × P_ls = ${Qyr.toExponential(3)} m³/yr (= ${Q.toFixed(4)} m³/s × 3.156e7 s/yr)`,
          ]
          : ['  Missing/non-positive H or θ — honest NaN (the energy-flux method',
             '  needs a genuine wave height and a genuine breaker angle; no proxy).']),
        '',
        `  └ ${!finite ? '—' : Math.abs(Qyr) < 5e4 ? 'Low transport (<50,000 m³/yr)' : Math.abs(Qyr) < 3e5 ? 'Moderate transport (50,000–300,000 m³/yr)' : Math.abs(Qyr) < 1e6 ? 'High transport (300,000–1,000,000 m³/yr)' : 'Very high transport (>10⁶ m³/yr)'}`,
        `  └ Direction: ${finite && sin2t > 0 ? 'positive (one side of the shore-normal)' : finite && sin2t < 0 ? 'negative (the other side)' : '—'}`,
        `  └ SPM-stated accuracy: ±50 % on Q from the energy-flux method (Fig 4-37 scatter); K calibrates the site`,
        `  └ Units: ρs=2650, ρ=1025 kg/m³, 1−n=0.6 (SPM Table 4-8); the eq 4-50a constant 1290 is dimensional (rounded from g=9.8)`,
      ]
    };
  },
  78: ({ g, k, h, __hAuto = true, __gebcoElev = null }) => {
    // Airy (1845) linear wave theory dispersion relation — Shore Protection
    // Manual (1984) Vol 1 Ch 2 eqs 2-1/2-2/2-3 (the authoritative textbook
    // restatement; Airy 1845 is pre-DOI): C² = (g/ω)·tanh(kh), equivalently
    // ω² = g·k·tanh(kh) with k = 2π/L, ω = 2π/T (SPM defines k = 2π/L and
    // ω = 2π/T in the text following eq 2-3). Regime classification per the
    // SPM's d/L table (eqs 2-5/2-6/2-10): deep water d/L > 1/2 (kh > π,
    // tanh ≈ 1); transitional 1/25 < d/L < 1/2; shallow water d/L < 1/25
    // (kh < 2π/25, tanh(kh) ≈ kh). The engine solves the FORWARD problem
    // (ω from k, h) — the same relation the SPM tabulates in Appendix C.
    const finite = Number.isFinite(g) && g > 0
      && Number.isFinite(k) && k > 0
      && Number.isFinite(h) && h > 0;
    const kh = finite ? k * h : Number.NaN;
    const tanhKh = finite ? Math.tanh(kh) : Number.NaN;
    const omega2 = finite ? g * k * tanhKh : Number.NaN;
    const omega = finite ? Math.sqrt(omega2) : Number.NaN;
    const T = finite ? 2 * Math.PI / omega : Number.NaN;
    const c = finite ? omega / k : Number.NaN;
    const L = finite ? 2 * Math.PI / k : Number.NaN;
    // Group velocity (SPM Ch 2): C_g = C/2·[1 + 2kh/sinh(2kh)] — the rate at
    // which wave energy propagates; deep water C_g = C/2, shallow C_g = C.
    const Cg = finite ? c / 2 * (1 + 2 * kh / Math.sinh(2 * kh)) : Number.NaN;
    const regime = finite
      ? kh > Math.PI
        ? 'Deep water (d/L > 1/2, kh > π): C = √(g/k) = gT/2π, C_g = C/2 — waves independent of depth'
        : kh < 2 * Math.PI / 25
          ? 'Shallow water (d/L < 1/25, kh < 2π/25): C = √(gh), C_g = C — non-dispersive, depth-limited'
          : 'Transitional water (1/25 < d/L < 1/2): full tanh form required (SPM eqs 2-2/2-3)'
      : null;
    const hLine = __hAuto
      ? __gebcoElev != null
        ? `Water depth h = ${finite ? h.toFixed(1) : 'N/A'} m (auto: GEBCO 2020 bathymetry, ground elevation ${__gebcoElev.toFixed(1)} m)`
        : 'Water depth h = N/A — no genuine bathymetry (honest NaN)'
      : `Water depth h = ${finite ? h.toFixed(1) : 'N/A'} m (user input)`;
    return {
      result: omega, unit: 'rad/s',
      secondary: [
        { key: 'kh', value: kh, unit: '—', label: 'Relative-depth parameter kh (SPM Ch 2 d/L table)' },
        { key: 'wave_celerity', value: c, unit: 'm/s', label: 'Phase speed C = ω/k (SPM eqs 2-2/2-3)' },
        { key: 'wavelength', value: L, unit: 'm', label: 'Wavelength L = 2π/k (SPM eq 2-1)' },
        { key: 'wave_period', value: T, unit: 's', label: 'Wave period T = 2π/ω' },
        { key: 'group_velocity', value: Cg, unit: 'm/s', label: 'Group velocity C_g = C/2·[1 + 2kh/sinh(2kh)] (SPM Ch 2)' },
      ],
      steps: [
        '── Airy Wave Dispersion Relation (Airy, 1845; SPM 1984 Vol 1 Ch 2, eqs 2-1/2-2/2-3) ──',
        `Gravity g = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} m/s², Wavenumber k = ${Number.isFinite(k) ? k.toExponential(3) : 'N/A'} rad/m`,
        hLine,
        '',
        ...(finite
          ? [
            'Step 1 — Compute kh (SPM relative-depth parameter):',
            `  kh = ${k.toExponential(3)} × ${h.toFixed(1)} = ${kh.toFixed(3)}`,
            `  tanh(kh) = ${tanhKh.toFixed(4)}`,
            '',
            'Step 2 — Dispersion relation (SPM eq 2-3, ω² = g·k·tanh(kh)):',
            `  ω² = ${g.toFixed(2)} × ${k.toExponential(3)} × ${tanhKh.toFixed(4)}`,
            `  ω = √${omega2.toFixed(4)} = ${omega.toFixed(4)} rad/s`,
            '',
            'Step 3 — Wave parameters:',
            `  Period T = 2π/ω = ${T.toFixed(2)} s`,
            `  Celerity c = ω/k = ${c.toFixed(3)} m/s`,
            `  Wavelength L = 2π/k = ${L.toFixed(1)} m`,
            `  Group velocity C_g = ${Cg.toFixed(3)} m/s (energy travels at ${(Cg / c * 100).toFixed(0)} % of c)`,
            `  Regime: ${regime}`,
          ]
          : [
            '  Missing or non-positive g / k / h — honest NaN (the dispersion',
            '  relation needs a positive wavenumber and a positive water depth).',
            '',
            '  └ —',
          ]),
      ]
    };
  },
  79: ({ omega, ka, z, h, g }) => {
    // Stokes (1847) Stokes drift — the net Lagrangian mean horizontal velocity
    // of a linear (Airy) wave. Standard form:
    //   u_s(z) = (a²·ω·k · cosh(2k(z+h))) / (2·sinh²(kh))
    // with a = wave amplitude, k = wavenumber (full dispersion ω² = g·k·tanh(kh)
    // when a water depth h is supplied; deep-water limit k = ω²/g), ω = 2π/T.
    // Surface value (z=0): u_s(0) = (a²·ω·k·cosh(2kh))/(2·sinh²(kh)).
    // Deep-water limit (kh → ∞): u_s(z) → a²·ω·k·exp(2kz), u_s(0) → a²·ω·k.
    // Shallow-water limit (kh → 0): u_s(0) → (a²·ω·k)/(2(kh)²) — coth(kh)/kh → 1.
    // `ka` carries the wave amplitude a (mapped from user input `ka`); h and g
    // are optional (h = water depth for the full dispersion, g overrides g₀).
    const grav = Number.isFinite(g) && g > 0 ? g : G_GRAV;
    const a = ka;
    const hasH = Number.isFinite(h) && h > 0;
    const valid = Number.isFinite(omega) && omega > 0
      && Number.isFinite(a) && a >= 0
      && Number.isFinite(z) && z <= 0;
    let k = Number.NaN;
    if (valid) {
      const kDeep = (omega * omega) / grav;   // deep-water seed: ω² = gk
      if (hasH) {
        // Solve the full dispersion relation ω² = g·k·tanh(kh) for k by Newton
        // iteration from the deep-water seed (k·h > 0).
        k = kDeep;
        for (let i = 0; i < 40; i++) {
          const kh = k * h;
          const th = Math.tanh(kh);
          const f = grav * k * th - omega * omega;
          const df = grav * (th + k * h * (1 - th * th));
          const dk = f / df;
          k -= dk;
          if (Math.abs(dk) < 1e-14 * k) break;
        }
      } else {
        k = kDeep;
      }
    }
    const kh = valid && hasH ? k * h : Number.NaN;
    const usSurf = valid
      ? hasH
        ? (a * a * omega * k * Math.cosh(2 * kh)) / (2 * Math.sinh(kh) * Math.sinh(kh))
        : a * a * omega * k
      : Number.NaN;
    const us = valid
      ? hasH
        ? (a * a * omega * k * Math.cosh(2 * k * (z + h))) / (2 * Math.sinh(kh) * Math.sinh(kh))
        : usSurf * Math.exp(2 * k * z)
      : Number.NaN;
    const L = valid && k > 0 ? 2 * Math.PI / k : Number.NaN;
    const c = valid && k > 0 ? omega / k : Number.NaN;
    const eFold = valid && k > 0 ? 1 / (2 * k) : Number.NaN;
    const driftRatio = valid && Number.isFinite(usSurf) && usSurf !== 0 ? us / usSurf : Number.NaN;
    // Depth profile series (vizType 'profile'): u_s(z) from the surface (z=0)
    // down to the e-folding depth (deep water) or the sea floor (finite depth).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (valid && k > 0) {
      const zFloor = hasH ? Math.max(z, -h) : -3 * eFold;
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const zi = -((0 - zFloor) * i / N);  // negative below surface
        const ui = hasH
          ? (a * a * omega * k * Math.cosh(2 * k * (zi + h))) / (2 * Math.sinh(kh) * Math.sinh(kh))
          : a * a * omega * k * Math.exp(2 * k * zi);
        if (Number.isFinite(ui)) seriesPoints.push({ x: zi, y: ui });
      }
    }
    return {
      result: us, unit: 'm/s',
      secondary: [
        { key: 'wavelength', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Wavelength L = 2π/k' },
        { key: 'phase_speed', value: Number.isFinite(c) ? c : Number.NaN, unit: 'm/s', label: 'Wave celerity c = ω/k' },
        { key: 'surface_drift', value: Number.isFinite(usSurf) ? usSurf : Number.NaN, unit: 'm/s', label: 'Surface Stokes drift u_s(0)' },
        { key: 'deep_water_limit', value: valid ? a * a * omega * k : Number.NaN, unit: 'm/s', label: 'Deep-water surface limit a²·ω·k (kh→∞)' },
        { key: 'drift_depth_ratio', value: driftRatio, unit: '—', label: 'u_s(z)/u_s(0) — depth attenuation ratio' },
        { key: 'efolding_depth', value: Number.isFinite(eFold) ? eFold : Number.NaN, unit: 'm', label: 'e-folding depth z_e = 1/(2k)' },
        { key: 'kh', value: Number.isFinite(kh) ? kh : Number.NaN, unit: '—', label: 'Relative-depth parameter kh (h/L·2π)' },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Stokes drift u_s(z) vs depth', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: valid
        ? [
          '── Stokes Drift (Stokes, 1847) ──',
          `Wave angular frequency ω = ${omega.toFixed(4)} rad/s (T = ${(2 * Math.PI / omega).toFixed(2)} s)`,
          `Wave amplitude a = ${a.toExponential(3)} m, gravity g = ${grav.toFixed(2)} m/s²`,
          hasH
            ? `Wavenumber k = ${k.toExponential(3)} rad/m from ω² = g·k·tanh(kh), h = ${h.toFixed(1)} m (kh = ${kh.toFixed(3)})`
            : `Wavenumber k = ω²/g = ${k.toExponential(3)} rad/m (deep-water dispersion)`,
          `Depth below surface z = ${z.toFixed(1)} m (negative below surface)`,
          '',
          'Step 1 — Surface Stokes drift (z=0):',
          hasH
            ? `  u_s(0) = (a²·ω·k·cosh(2kh))/(2·sinh²(kh)) = ${usSurf.toExponential(3)} m/s (${(usSurf * 100).toFixed(2)} cm/s)`
            : `  u_s(0) = a²·ω·k = (${a.toExponential(3)}² × ${omega.toFixed(4)} × ${k.toExponential(3)}) = ${usSurf.toExponential(3)} m/s (${(usSurf * 100).toFixed(2)} cm/s)`,
          '',
          'Step 2 — Depth attenuation:',
          hasH
            ? `  u_s(z) = (a²·ω·k·cosh(2k(z+h)))/(2·sinh²(kh)) = ${us.toExponential(3)} m/s (${(us * 100).toExponential(3)} cm/s)`
            : `  u_s(z) = u_s(0) × exp(2kz) = ${us.toExponential(3)} m/s (${(us * 100).toExponential(3)} cm/s)`,
          '',
          `  └ e-folding depth: z_e = 1/(2k) = ${eFold.toFixed(1)} m (depth where drift = 37% of surface)`,
          `  └ Deep/shallow limit: kh = ${Number.isFinite(kh) ? kh.toFixed(3) : '∞ (deep water)'} — ${Number.isFinite(kh) && kh > Math.PI ? 'deep water (u_s → a²ωk·e^{2kz})' : Number.isFinite(kh) && kh < Math.PI / 25 ? 'shallow water (u_s → a²ωk/(2(kh)²)·cosh(2k(z+h)))' : 'transitional water'}`,
          `  └ Stokes transport: M_S = ∫u_s dz (volume transport in wave direction)`,
        ]
        : [
          '── Stokes Drift (Stokes, 1847) ──',
          'Requires a finite positive angular frequency ω, a finite positive wave',
          `amplitude a (${Number.isFinite(ka) ? ka.toExponential(3) : 'N/A'}), and a depth z ≤ 0 (${Number.isFinite(z) ? z : 'N/A'}).`,
          'Result: NaN (honest — no fabricated drift).',
        ],
    };
  },
  80: ({ alpha, g2, fm, fpm, gamma }) => {
    // JONSWAP (Hasselmann et al., 1973, eq 16):
    //   S(f) = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−5/4·(f_p/f)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]
    //   = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−5/4·(f/f_p)⁴] ... note the exponent: the
    //   peak-enhancement factor exp[−5/4·(f/f_p)⁻⁴] = exp[−5/4·(f_p/f)⁴] must
    //   → 1 for f ≫ f_p so the Phillips f⁻⁵ tail reappears (NOT → 0).
    // with σ = 0.07 for f ≤ f_p and σ = 0.09 for f > f_p (the σ step).
    // The (2π)⁻⁴ converts from the angular-frequency form S(ω) = αg²ω⁻⁵…
    // to ordinary-frequency S(f) — without it the result is (2π)⁴ ≈ 1559× too large.
    const fp = fpm;          // peak frequency (Hz)
    const f = fm;            // frequency at which to evaluate (Hz)
    const valid = Number.isFinite(alpha) && Number.isFinite(g2) && Number.isFinite(f)
      && Number.isFinite(fp) && Number.isFinite(gamma)
      && alpha > 0 && g2 > 0 && f > 0 && fp > 0 && gamma > 0;
    // JONSWAP σ step, evaluated on a spectral point (0.07 below/at peak, 0.09 above)
    const sigmaAt = (fi: number): number => (fi <= fp ? 0.07 : 0.09);
    // S(fi) — single spectral density value at a frequency fi (Hz)
    const spectrumAt = (fi: number): number => {
      const s = sigmaAt(fi);
      const peakEnhance = Math.exp(-1.25 * Math.pow(fi / fp, -4));
      const gaussExp = Math.exp(-Math.pow(fi - fp, 2) / (2 * s * s * fp * fp));
      const gammaFactor = Math.pow(gamma, gaussExp);
      return alpha * Math.pow(g2, 2) * Math.pow(2 * Math.PI, -4) * Math.pow(fi, -5) * peakEnhance * gammaFactor;
    };
    if (!valid) {
      return {
        result: Number.NaN, unit: 'm²/Hz',
        secondary: [
          { key: 'peak_frequency', value: Number.isFinite(fp) && fp > 0 ? fp : Number.NaN, unit: 'Hz', label: 'Peak frequency f_p' },
          { key: 'peak_spectral_density', value: Number.NaN, unit: 'm²/Hz', label: 'Peak spectral density S(f_p)' },
          { key: 'sig_wave_height', value: Number.NaN, unit: 'm', label: 'Significant wave height H_s = 4·√m₀ (from the spectrum)' },
          { key: 'phillips_alpha', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: '—', label: 'Phillips constant α' },
        ],
        steps: [
          '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
          'Requires positive α, g, f, f_p and γ (the peak-enhancement factor).',
          `  α = ${alpha}, g = ${g2}, f = ${f}, f_p = ${fp}, γ = ${gamma}`,
          'Result: NaN (honest — a degenerate spectrum).',
        ],
      };
    }
    const sigma = f <= fp ? 0.07 : 0.09;   // JONSWAP σ step at the evaluation point
    const peakEnhance = Math.exp(-1.25 * Math.pow(f / fp, -4));
    const gaussExp = Math.exp(-Math.pow(f - fp, 2) / (2 * sigma * sigma * fp * fp));
    const gammaFactor = Math.pow(gamma, gaussExp);
    const S = alpha * Math.pow(g2, 2) * Math.pow(2 * Math.PI, -4) * Math.pow(f, -5) * peakEnhance * gammaFactor;
    // Spectrum series (vizType 'spectrum'): S(f) over f from 0.5·f_p to 4·f_p
    // (log-spaced for a clean plot), plus the peak point exactly at f_p.
    const fMin = fp * 0.5;
    const fMax = fp * 4;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 120; i++) {
      const fi = fMin * Math.pow(fMax / fMin, i / 120);
      if (Number.isFinite(fi) && fi > 0) {
        seriesPoints.push({ x: fi, y: spectrumAt(fi) });
      }
    }
    seriesPoints.push({ x: fp, y: S });
    seriesPoints.sort((a, b) => a.x - b.x);
    // Significant wave height H_s = 4·√m₀ from the spectrum: m₀ = ∫S(f)df via
    // the trapezoidal rule over the series band (the dominant energy band).
    let m0 = 0;
    for (let i = 1; i < seriesPoints.length; i++) {
      m0 += 0.5 * (seriesPoints[i].x - seriesPoints[i - 1].x) * (seriesPoints[i].y + seriesPoints[i - 1].y);
    }
    const Hs = m0 >= 0 ? 4 * Math.sqrt(m0) : Number.NaN;
    return {
      result: S, unit: 'm²/Hz',
      secondary: [
        { key: 'peak_frequency', value: fp, unit: 'Hz', label: 'Peak frequency f_p' },
        { key: 'peak_spectral_density', value: S, unit: 'm²/Hz', label: 'Peak spectral density S(f_p)' },
        { key: 'sig_wave_height', value: Number.isFinite(Hs) ? Hs : Number.NaN, unit: 'm', label: 'Significant wave height H_s = 4·√m₀ (from the spectrum)' },
        { key: 'phillips_alpha', value: alpha, unit: '—', label: 'Phillips constant α' },
        { key: 'peak_enhancement', value: gamma, unit: '—', label: 'Peak enhancement factor γ (JONSWAP)' },
      ],
      series: [{
        label: 'JONSWAP S(f)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
        `Phillips constant α = ${alpha.toExponential(2)}, g = ${g2.toFixed(2)} m/s²`,
        `Peak frequency f_p = ${fp.toExponential(2)} Hz, Evaluation f = ${f.toExponential(2)} Hz`,
        `Peak enhancement γ = ${gamma.toFixed(2)}, σ = ${sigma} (JONSWAP step: 0.07 if f≤f_p, 0.09 if f>f_p)`,
        '',
        'Step 1 — Phillips f⁻⁵ tail with (2π)⁻⁴ conversion:',
        `  α·g²·(2π)⁻⁴·f⁻⁵ = ${alpha.toExponential(2)} × ${g2.toFixed(2)}² × ${(1/Math.pow(2*Math.PI,4)).toExponential(4)} × ${Math.pow(f, -5).toExponential(3)}`,
        `  = ${(alpha * g2 * g2 * Math.pow(2*Math.PI, -4) * Math.pow(f, -5)).toExponential(3)} m²/Hz`,
        '',
        'Step 2 — Peak enhancement exp[−1.25(f/f_p)⁻⁴] (→ 1 as f ≫ f_p, restoring the Phillips tail):',
        `  = ${peakEnhance.toExponential(3)}`,
        '',
        'Step 3 — Gaussian broadening exp[−(f−f_p)²/(2σ²f_p²)]:',
        `  = ${gaussExp.toExponential(3)} (σ=${sigma})`,
        `  γ^broadening = ${gamma.toFixed(2)}^${gaussExp.toExponential(2)} = ${gammaFactor.toExponential(3)}`,
        '',
        'Step 4 — Spectral density:',
        `  S(f) = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−1.25(f/f_p)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]`,
        `  S(${f.toExponential(2)}) = ${S.toExponential(3)} m²/Hz`,
        '',
        `  └ At the peak (f=f_p): Gaussian exponent = 0 → γ^1 = γ; S(f_p) = αg²(2π)⁻⁴f_p⁻⁵·exp(−1.25)·γ = ${S.toExponential(3)} m²/Hz`,
        `  └ H_s = 4·√(∫S(f)df) = ${Number.isFinite(Hs) ? Hs.toFixed(2) : 'N/A'} m over the band [${fMin.toFixed(3)}, ${fMax.toFixed(3)}] Hz`,
        `  └ γ = 1 collapses JONSWAP to the Pierson–Moskowitz spectrum; γ > 1 sharpens the peak`,
      ]
    };
  },

};
