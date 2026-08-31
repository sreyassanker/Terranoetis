/**
 * PART2 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { faoYieldResponse, gddMethods } from '../equationShared';
import type { ComputeFn } from '../equationShared';

export const PART2: Record<number, ComputeFn> = {

  // ── Part II · Domain 7: Biosphere & Carbon ──
  51: ({ eps, fpar, par }) => {
    if (![eps, fpar, par].every(Number.isFinite)) {
      return {
        result: NaN, unit: 'gC/m²/yr',
        steps: [
          '── Gross Primary Production (Monteith, 1972) ──',
          'Honest NaN — a required genuine input could not be resolved.',
          `  ε = ${eps} gC/MJ (auto 1.2 — conservative C₃ LUE)`,
          `  fPAR = ${fpar} (auto MODIS MCD15A3H Fpar_500m via ORNL DAAC)`,
          `  PAR = ${par} MJ/m²/yr (auto from genuine Open-Meteo shortwave × 0.45 × 0.0864 × 365)`,
          '',
          'No static constant is substituted for a missing genuine source —',
          'supply explicit ε / fPAR / PAR (e.g. MODIS MOD17 fields) to override.',
        ],
      };
    }
    const gpp = eps * fpar * par;
    const apar = fpar * par;
    const npp = gpp * 0.5; // NPP ≈ 0.5·GPP (coarse estimate)
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let e = 0.2; e <= 3; e += 0.1) {
      seriesPoints.push({ x: e, y: Number.isFinite(e * apar) ? e * apar : Number.NaN });
    }
    return {
      result: gpp, unit: 'gC/m²/yr',
      secondary: [
        { key: 'npp_estimate', value: Number.isFinite(npp) ? npp : Number.NaN, unit: 'gC/m²/yr', label: 'NPP Estimate (0.5·GPP)' },
        { key: 'apar', value: Number.isFinite(apar) ? apar : Number.NaN, unit: 'MJ/m²/yr', label: 'Absorbed PAR (fPAR·PAR)' },
      ],
      series: [{
        label: 'GPP(ε) at fixed APAR',
        color: '#009E73',
        points: seriesPoints,
      }],
      steps: [
        '── Gross Primary Production (Monteith, 1972) ──',
        `Light use efficiency ε = ${eps.toFixed(2)} gC/MJ, fPAR = ${fpar.toFixed(3)}, PAR = ${par.toFixed(0)} MJ/m²/yr`,
        '',
        'Step 1 — fPAR × PAR = absorbed PAR:',
        `  APAR = ${fpar.toFixed(3)} × ${par.toFixed(0)} = ${(fpar * par).toFixed(0)} MJ/m²/yr`,
        '',
        'Step 2 — Apply light use efficiency:',
        `  GPP = ε × APAR = ${eps.toFixed(2)} × ${(fpar * par).toFixed(0)} = ${gpp.toFixed(1)} gC/m²/yr`,
        '',
        `  └ Interpretation: ${gpp > 2000 ? 'Very high productivity (tropical forest)' : gpp > 1000 ? 'High productivity (temperate forest)' : gpp > 500 ? 'Moderate productivity (cropland)' : 'Low productivity (desert/tundra)'}`,
      ]
    };
  },
  52: ({ I0, k, LAI }) => {
    // Monsi & Saeki (1953) / Hirose (2004): Beer-Lambert canopy attenuation.
    // I(z) = I₀·exp(−k·LAI); fPAR = 1 − exp(−k·LAI). Verified worked example:
    // I₀=2000, k=0.5, LAI=3 → 2000·exp(−1.5) = 446 µmol/m²s.
    const finite = [I0, k, LAI].every(Number.isFinite);
    const I = finite ? I0 * Math.exp(-k * LAI) : Number.NaN;
    const fPAR = finite ? 1 - Math.exp(-k * LAI) : Number.NaN;
    const transmitted = finite ? Math.exp(-k * LAI) : Number.NaN; // τ = I/I₀
    // Catalogue-promised secondary output: cumulative LAI at which transmitted
    // PPFD equals the C₃ leaf light-compensation point Γ ≈ 50 µmol/m²s
    // (Monsi–Saeki 1953 Eqs 5–6 / Hirose 2004; Γ stated in the catalogue's
    // output description). LAI_comp = −(1/k)·ln(Γ/I₀). Honest NaN when there
    // is no incident radiation (I₀ ≤ 0, e.g. night) or k ≤ 0 — never ±Infinity.
    const GAMMA_COMP = 50; // µmol/m²s, C₃ leaf light-compensation point
    const laiComp = finite && I0 > 0 && k > 0 ? -(1 / k) * Math.log(GAMMA_COMP / I0) : Number.NaN;
    const i0Str = Number.isFinite(I0) ? I0.toFixed(0) : 'NaN';
    const kStr = Number.isFinite(k) ? k.toFixed(3) : 'NaN';
    const laiStr = Number.isFinite(LAI) ? LAI.toFixed(2) : 'NaN';
    const secondary = [
      { key: 'absorbed_fraction', value: Number.isFinite(fPAR) ? fPAR : Number.NaN, unit: '—', label: 'Canopy Absorption Fraction (fPAR)' },
      { key: 'transmitted_fraction', value: Number.isFinite(transmitted) ? transmitted : Number.NaN, unit: '—', label: 'Transmitted Fraction (τ = I/I₀)' },
      { key: 'compensation_lai', value: Number.isFinite(laiComp) ? laiComp : Number.NaN, unit: 'm²/m²', label: 'Light-Compensation Depth (LAI where I = Γ)' },
    ];
    const steps: string[] = [
      '── Beer-Lambert Light Extinction (Monsi & Saeki 1953; Hirose 2004, Ann. Bot. 95(3):483–494) ──',
      `Incident PPFD above canopy I₀ = ${i0Str} µmol/m²s, Extinction coefficient k = ${kStr}`,
      `Leaf Area Index (cumulative from top) LAI = ${laiStr} m²/m²`,
      '',
    ];
    if (!finite) {
      steps.push(
        '  Genuine input missing (no fabricated values):',
        ...(!Number.isFinite(I0) ? ['  • I₀ — incident PPFD (ERA5 CDS ssrd, genuine when resolved)'] : []),
        ...(!Number.isFinite(k) ? ['  • k — extinction coefficient (user-supplied; Monsi–Saeki range 0.3–2.0)'] : []),
        ...(!Number.isFinite(LAI) ? ['  • LAI — MODIS MCD15A3H, genuine when resolved'] : []),
        '  → I(z) = NaN (honest — a required genuine input is missing, no substitution).',
      );
      return { result: I, unit: 'µmol/m²s', secondary, steps };
    }
    steps.push(
      'Step 1 — Exponential attenuation (Beer’s Law, I = I₀·e^(−k·LAI)):',
      `  k × LAI = ${k.toFixed(3)} × ${LAI.toFixed(2)} = ${(k * LAI).toFixed(3)}`,
      `  I(z) = ${i0Str} × exp(${(-k * LAI).toFixed(3)}) = ${I.toFixed(1)} µmol/m²s`,
      '',
      'Step 2 — Fraction of absorbed PAR (fPAR = 1 − e^(−k·LAI)):',
      `  fPAR = ${(fPAR * 100).toFixed(1)}% of incident PAR absorbed by the canopy`,
      `  τ = e^(−k·LAI) = ${(transmitted * 100).toFixed(1)}% transmitted (τ + fPAR = 1 under the black-leaf assumption)`,
      '',
      'Step 3 — Light-compensation depth (LAI where I(z) = Γ ≈ 50 µmol/m²s, C₃):',
      Number.isFinite(laiComp)
        ? `  LAI_comp = −(1/k)·ln(Γ/I₀) = ${laiComp.toFixed(2)} m²/m² — leaves below this depth are below the compensation point`
        : '  LAI_comp = NaN — no incident radiation (I₀ ≤ 0, e.g. night) or k ≤ 0; depth undefined',
      '',
      `  └ Interpretation: ${fPAR > 0.8 ? 'Dense canopy closure — little understorey light' : fPAR > 0.5 ? 'Moderate canopy — significant understorey light' : 'Open canopy — abundant understorey / ground-layer light'}`,
    );
    // Profile series (tool vizType 'profile'): I(z) vs LAI from 0 → 6 m²/m²
    // (25 points) using I(z) = I₀·exp(−k·LAI) with the tool's I₀ and k.
    // Only emitted when inputs are finite — no synthetic curve from NaN
    // inputs (honest empty series).
    const series = finite && LAI >= 0
      ? [{
          label: 'PAR(z) through canopy',
          color: '#0072B2',
          points: Array.from({ length: 25 }, (_, i) => {
            const lai = (6 * i) / 24;
            return { x: lai, y: I0 * Math.exp(-k * lai) };
          }),
        }]
      : undefined;
    return { result: I, unit: 'µmol/m²s', secondary, series, steps };
  },
  53: ({ Reco, GPP }) => {
    // Wofsy et al. (1993), Science 260:1314-1317: NEE = R_eco − GPP with the
    // meteorological sign convention (negative = net CO₂ sink). Verified
    // against the paper's own numbers: GPP 11.1, Reco 7.4 tC/ha/yr ⇒ NEE =
    // −3.7 tC/ha/yr (their measured annual uptake −3.7 ± 0.7). The sign
    // convention is also that standardized by Chapin et al. (2006),
    // Ecosystems 9:1041-1050.
    const NEE = Reco - GPP;
    const finite = Number.isFinite(Reco) && Number.isFinite(GPP);
    const reStr = Number.isFinite(Reco) ? Reco.toFixed(1) : 'NaN';
    const gStr = Number.isFinite(GPP) ? GPP.toFixed(1) : 'NaN';
    const steps: string[] = [
      '── Net Ecosystem Exchange (Wofsy et al. 1993, Science 260:1314-1317; sign per Chapin et al. 2006) ──',
      `Ecosystem respiration R_eco = ${reStr} gC/m²/yr`,
      `Gross Primary Production GPP = ${gStr} gC/m²/yr`,
      '',
    ];
    if (!Number.isFinite(Reco)) {
      steps.push(
        '  R_eco is NaN — ecosystem respiration requires nighttime eddy-covariance NEE',
        '  (FLUXNET/AmeriFlux, registration-gated; SMAP L4C subset service unpopulated).',
        '  No genuine open source exists — supply R_eco explicitly (gC/m²/yr).',
      );
    }
    if (!Number.isFinite(GPP)) {
      steps.push('  GPP is NaN — no genuine MODIS MOD17A2H annual GPP resolved at this point.');
    }
    if (!finite) {
      steps.push('', '  NEE = NaN (honest — a required genuine input is missing, no substitution).');
      return { result: NEE, unit: 'gC/m²/yr', steps };
    }
    const nep = -NEE;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let g = 0; g <= 2000; g += 50) {
      seriesPoints.push({ x: g, y: Number.isFinite(Reco - g) ? Reco - g : Number.NaN });
    }
    steps.push(
      'Step 1 — Compute NEE:',
      `  NEE = R_eco - GPP = ${Reco.toFixed(1)} - ${GPP.toFixed(1)}`,
      `  NEE = ${NEE.toFixed(1)} gC/m²/yr`,
      '',
      'Step 2 — Carbon balance classification (sign per Wofsy 1993 / Chapin 2006):',
      `  ${NEE < 0 ? 'NET CARBON SINK (NEE < 0) — ecosystem absorbs CO₂' : NEE > 0 ? 'NET CARBON SOURCE (NEE > 0) — ecosystem releases CO₂' : 'CARBON NEUTRAL (NEE ≈ 0)'}`,
      `  Net ecosystem production NEP = -NEE = ${(-NEE).toFixed(1)} gC/m²/yr (positive = net uptake)`,
      '',
      `  └ NEE range: < -500 strong sink (productive forest); -500 to -100 moderate sink; -100 to 100 near-neutral; > 100 carbon source (disturbance/peat decomposition)`,
    );
    return { result: NEE, unit: 'gC/m²/yr', secondary: [
      { key: 'nep', value: Number.isFinite(nep) ? nep : Number.NaN, unit: 'gC/m²/yr', label: 'Net Ecosystem Production (NEP)' },
    ], series: [{
      label: 'NEE vs GPP (fixed R_eco)',
      color: '#009E73',
      points: seriesPoints,
    }], steps };
  },
  54: ({ Vcmax, ci, GammaStar, Kc, Ko, O, ca, J, Rd }) => {
    // Farquhar, von Caemmerer & Berry (1980), Planta 149:78-90 — Rubisco-limited
    // (RuP2-saturated) carboxylation: Wc = Vcmax·C/(C + Kc(1 + O/Ko)), paper
    // Eq. 2/3. The tool's simplified net form subtracts the CO₂ compensation
    // point: A_c = Vcmax·(ci − Γ*)/(ci + Kc(1 + O/Ko)). Units µmol/mol
    // (mixing ratios; equivalent to the paper's partial pressures at 1 atm).
    // Verified worked example: Vcmax=80, ci=250, Γ*=40, Kc=300, Ko=25000,
    // O=210000 → Kc(1+O/Ko) = 300·9.4 = 2820, A_c = 80·(250−40)/(250+2820)
    // = 5.47 µmol/m²s (Rubisco-limited; light and TPU branches not limiting).
    const finite = [Vcmax, ci, GammaStar, Kc, Ko, O].every(Number.isFinite);
    const Kco = finite ? Kc * (1 + O / Ko) : Number.NaN;
    const Ac = finite ? Vcmax * (ci - GammaStar) / (ci + Kco) : Number.NaN;
    // Gross carboxylation v_c and photorespiratory oxygenation v_o (paper Eq. 4
    // ratio form as stated in the catalogue: v_o = v_c·(O·K_c)/(cᵢ·K_o)).
    const vc = finite ? Vcmax * ci / (ci + Kco) : Number.NaN;
    const vo = finite ? vc * (O * Kc) / (ci * Ko) : Number.NaN;
    const ciCa = Number.isFinite(ca) && ca > 0 ? ci / ca : Number.NaN;
    // Optional FvCB complement (net A = min(Wc, Wj) − Rd): electron-transport
    // limit Wj = J·(ci − Γ*)/(4·(ci + 2Γ*)) needs a light/electron-transport
    // input J (µmol e⁻/m²s) and dark respiration Rd; both are honest NaN when
    // not supplied (never fabricated).
    const Wj = finite && Number.isFinite(J) && (ci + 2 * GammaStar) !== 0
      ? (J * (ci - GammaStar)) / (4 * (ci + 2 * GammaStar))
      : Number.NaN;
    const Rdv = Number.isFinite(Rd) ? Rd : Number.NaN;
    const netA = Number.isFinite(Wj) && Number.isFinite(Rdv) ? Math.min(Ac, Wj) - Rdv : Number.NaN;
    const secondary = [
      { key: 'electron_transport_limit', value: Number.isFinite(Wj) ? Wj : Number.NaN, unit: 'µmol/m²s', label: 'Electron-Transport Limit (Wj)' },
      { key: 'dark_respiration', value: Number.isFinite(Rdv) ? Rdv : Number.NaN, unit: 'µmol/m²s', label: 'Dark Respiration (Rd)' },
      { key: 'net_assimilation', value: Number.isFinite(netA) ? netA : Number.NaN, unit: 'µmol/m²s', label: 'Net Assimilation A = min(Wc, Wj) − Rd' },
      { key: 'gross_carboxylation', value: Number.isFinite(vc) ? vc : Number.NaN, unit: 'µmol/m²s', label: 'Gross Carboxylation (v_c)' },
      { key: 'photorespiration_rate', value: Number.isFinite(vo) ? vo : Number.NaN, unit: 'µmol/m²s', label: 'Photorespiration (Oxygenation v_o)' },
      { key: 'ci_ca_ratio', value: Number.isFinite(ciCa) ? ciCa : Number.NaN, unit: '—', label: 'cᵢ/cₐ Ratio (water-use efficiency)' },
    ];
    const steps: string[] = [
      '── FvCB Photosynthesis (Farquhar, von Caemmerer & Berry 1980, Planta 149:78-90) — Rubisco-limited branch ──',
      `V_cmax = ${Number.isFinite(Vcmax) ? Vcmax.toFixed(1) : 'NaN'} µmol/m²s, cᵢ = ${Number.isFinite(ci) ? ci.toFixed(1) : 'NaN'} µmol/mol`,
      `Γ* = ${Number.isFinite(GammaStar) ? GammaStar.toFixed(2) : 'NaN'} µmol/mol, K_c = ${Number.isFinite(Kc) ? Kc.toFixed(1) : 'NaN'} µmol/mol, K_o = ${Number.isFinite(Ko) ? Ko.toFixed(0) : 'NaN'} µmol/mol`,
      `Intercellular O₂ O = ${Number.isFinite(O) ? O.toFixed(0) : 'NaN'} µmol/mol (21 % of P_atm)`,
      '',
    ];
    if (!Number.isFinite(Vcmax)) {
      steps.push(
        '  V_cmax is NaN — it is a leaf gas-exchange trait with no genuine open',
        '  source (no trait-database API). Supply V_cmax explicitly (µmol/m²s).',
      );
    }
    if (!Number.isFinite(ci)) {
      steps.push('  cᵢ is NaN — no genuine NOAA GML ambient CO₂ resolved (ci = 0.7 × ca).');
    }
    if (!finite) {
      steps.push('', '  A_c = NaN (honest — a required genuine input is missing, no substitution).');
      return { result: Ac, unit: 'µmol/m²s', secondary, steps };
    }
    steps.push(
      'Step 1 — Effective K_c with O₂ competition (paper Eq. 2/3 denominator):',
      `  K_c·(1 + O/K_o) = ${Kc.toFixed(1)} × (1 + ${O.toFixed(0)} / ${Ko.toFixed(0)}) = ${Kco.toFixed(1)} µmol/mol`,
      '',
      'Step 2 — Rubisco-limited net carboxylation:',
      `  A_c = V_cmax × (cᵢ − Γ*) / (cᵢ + K_c·(1+O/K_o))`,
      `  A_c = ${Vcmax.toFixed(1)} × (${ci.toFixed(1)} − ${GammaStar.toFixed(2)}) / (${ci.toFixed(1)} + ${Kco.toFixed(1)})`,
      `  A_c = ${Ac.toFixed(2)} µmol/m²s`,
      Ac < 0 ? `  (cᵢ ${ci.toFixed(0)} < Γ* ${GammaStar.toFixed(0)} — below the CO₂ compensation point, net photorespiratory loss)` : '',
      '',
      'Step 3 — Photorespiration (oxygenation) rate:',
      `  v_o = v_c·(O·K_c)/(cᵢ·K_o) = ${vc.toFixed(2)} × (${O.toFixed(0)}×${Kc.toFixed(0)})/(${ci.toFixed(0)}×${Ko.toFixed(0)})`,
      `  v_o = ${vo.toFixed(2)} µmol/m²s (${(vo / (vc + vo) * 100).toFixed(1)} % of Rubisco flux on photorespiration)`,
      '',
      'Step 4 — cᵢ/cₐ ratio (water-use efficiency indicator):',
      Number.isFinite(ciCa)
        ? `  cᵢ/cₐ = ${ci.toFixed(1)} / ${ca.toFixed(1)} = ${ciCa.toFixed(3)} (C₃ typical 0.6–0.8)`
        : '  cᵢ/cₐ = NaN (no genuine ambient CO₂ served)',
      '',
      'Step 5 — Optional light branch and respiration (FvCB complement):',
      Number.isFinite(Wj)
        ? `  Wj = J·(cᵢ − Γ*)/(4·(cᵢ + 2Γ*)) = ${Wj.toFixed(2)} µmol/m²s — min(Wc, Wj) = ${Math.min(Ac, Wj).toFixed(2)} µmol/m²s`
        : '  Wj = NaN — no electron-transport input J supplied (light-limited branch not derivable)',
      Number.isFinite(Rdv)
        ? `  Rd = ${Rdv.toFixed(2)} µmol/m²s — net A = min(Wc, Wj) − Rd = ${Number.isFinite(netA) ? netA.toFixed(2) : 'NaN'} µmol/m²s`
        : '  Rd = NaN — dark respiration not supplied (A_c is already net of the compensation point)',
      '',
      `  └ Interpretation: ${Ac > 30 ? 'High rate — tropical/crop C₃ photosynthesis' : Ac > 15 ? 'Moderate rate — typical C₃ midday' : Ac > 5 ? 'Low rate — light/water-limited' : 'Very low — stressed, senescent canopy or below compensation'}`,
    );
    return { result: Ac, unit: 'µmol/m²s', secondary, steps };
  },
  55: ({ DBH, rho, E }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const DBHn = Number(DBH), rhon = Number(rho), En = Number(E);
    // Chave et al. (2014), Glob. Change Biol. 20:3177-3190 — the height-
    // unavailable pantropical model, Eq. 7:
    //   AGB = exp[−1.803 − 0.976·E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²]
    // D in cm, ρ in g/cm³ (wood specific gravity), E dimensionless bioclimatic
    // stress (Eq. 6b: E = (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³). Calibrated
    // on 4004 harvested tropical trees, RSE=0.413, mean bias +9.71 %.
    // The height-available model (Eq. 4, AGB = 0.0673·(ρD²H)^0.976) is not
    // used: this tool takes no height input.
    const finite = [DBHn, rhon, En].every(Number.isFinite);
    const lnD = Math.log(DBHn);
    const AGB = Number.isFinite(DBHn) && DBHn > 0 && Number.isFinite(rhon) && rhon > 0
      ? Math.exp(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD)
      : Number.NaN;
    const C_kg = Number.isFinite(AGB) ? AGB * 0.47 : Number.NaN;      // IPCC default carbon fraction (0.47, catalogue output)
    const CO2e_t = Number.isFinite(C_kg) ? C_kg * 3.67 / 1000 : Number.NaN; // mass ratio CO₂/C, in tonnes
    const steps: string[] = [
      '── Pantropical Allometric Biomass (Chave et al. 2014, Glob. Change Biol. 20:3177-3190, Eq. 7 — height-unavailable model) ──',
      `DBH D = ${Number.isFinite(DBHn) ? DBHn.toFixed(1) : 'NaN'} cm (field measurement)`,
      `Wood specific gravity ρ = ${Number.isFinite(rhon) ? rhon.toFixed(3) : 'NaN'} g/cm³ (user-supplied: no open trait API)`,
      `Bioclimatic stress E = ${Number.isFinite(E) ? E.toFixed(4) : 'NaN'} (Eq. 6b: (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³; Chave's E-layer offline)`,
      '',
    ];
    if (!Number.isFinite(DBHn)) steps.push('  DBH is NaN — it is a field measurement with no open source; supply D (cm).');
    if (!Number.isFinite(rhon)) steps.push('  ρ is NaN — wood specific gravity has no open API (BIEN unreachable; global wood-density DB is a static dataset); supply ρ (g/cm³).');
    if (!Number.isFinite(En)) steps.push('  E is NaN — the paper\'s gridded E layer (chave.upstlse.fr) is offline and WorldClim has no point API; supply E from Eq. 6b.');
    if (!finite) {
      steps.push('', '  AGB = NaN (honest — required genuine inputs missing, no substitution).');
      return {
        result: AGB, unit: 'kg', steps,
        secondary: [
          { key: 'carbon_content', value: C_kg, unit: 'kgC', label: 'Carbon Stock (0.47 × AGB)' },
          { key: 'co2_equivalent', value: CO2e_t, unit: 'tCO₂', label: 'CO₂ Equivalent (3.67 × C)' },
        ],
      };
    }
    steps.push(
      'Step 1 — ln(D) terms:',
      `  ln(D) = ln(${DBHn.toFixed(1)}) = ${lnD.toFixed(4)}`,
      `  2.673·ln(D) = ${(2.673 * lnD).toFixed(4)}`,
      `  0.0299·(ln D)² = ${(0.0299 * lnD * lnD).toFixed(4)}`,
      '',
      'Step 2 — Combine (Eq. 7 exponent):',
      `  −1.803 − 0.976·E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²`,
      `  = −1.803 − ${(0.976 * En).toFixed(4)} + ${(0.976 * Math.log(rhon)).toFixed(4)} + ${(2.673 * lnD).toFixed(4)} − ${(0.0299 * lnD * lnD).toFixed(4)}`,
      `  = ${(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD).toFixed(4)}`,
      '',
      'Step 3 — Aboveground biomass:',
      `  AGB = exp(${(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD).toFixed(4)}) = ${AGB.toFixed(2)} kg (${(AGB / 1000).toFixed(3)} t)`,
      '',
      'Step 4 — Carbon stock (IPCC default fraction 0.47):',
      `  C = 0.47 × AGB = ${C_kg.toFixed(1)} kg C (${(C_kg / 1000).toFixed(4)} tC)`,
      `  CO₂ equivalent = 3.67 × C = ${CO2e_t.toFixed(3)} tCO₂`,
      '',
      `  └ Class: ${AGB < 100 ? 'Small tree (DBH < ~20 cm, understorey)' : AGB < 500 ? 'Medium tree (canopy)' : AGB < 2000 ? 'Large tree (canopy emergent)' : 'Very large tree (>2 t — disproportionate carbon share)'}`,
      `  └ Uncertainty: ±20-40 % per tree (paper RSE 0.413, mean bias +9.71 %); height-available model Eq. 4 (AGB = 0.0673·(ρD²H)^0.976) is more accurate (RSE 0.357) — not used here (no H input)`,
    );
    return {
      result: AGB, unit: 'kg', steps,
      secondary: [
        { key: 'carbon_content', value: C_kg, unit: 'kgC', label: 'Carbon Stock (0.47 × AGB)' },
        { key: 'co2_equivalent', value: CO2e_t, unit: 'tCO₂', label: 'CO₂ Equivalent (3.67 × C)' },
      ],
    };
  },
  // ── Wanninkhof (1992) air–sea CO₂ flux (helpers in schmidtNumberCO2 /
  // weissSolubilityCO2 / wanninkhofK1992 above EQUATION_ENGINE) ──
  56: ({ k, K0, dCO2, __wind10m, __windDate, __sst, __sc, __sss, __mooring, __kAuto, __K0Auto, __dCO2Auto }) => {
    const finite = [k, K0, dCO2].every(Number.isFinite);
    // ΔpCO₂ arrives in µatm (ocean − atmosphere) → ×10⁻⁶ converts to atm.
    const F = finite ? k * K0 * dCO2 * 1e-6 : Number.NaN;   // mol/m²/yr
    const F_gC = finite ? F * 12.01 : Number.NaN;            // gC/m²/yr
    const missing = [
      !Number.isFinite(k) ? 'k — gas transfer velocity (ERA5 10 m wind unavailable via CDS, or user-supplied k non-finite)' : null,
      !Number.isFinite(K0) ? 'K₀ — CO₂ solubility (SST/salinity unavailable — no mooring or OISST sample)' : null,
      !Number.isFinite(dCO2) ? 'ΔpCO₂ — air–sea pCO₂ gradient (no NOAA PMEL mooring within 1000 km; user-supplied ΔpCO₂ needed)' : null,
    ].filter(Boolean);
    const steps: string[] = [
      '── Air-Sea CO₂ Flux (Wanninkhof, 1992) ──',
      ...(__mooring && __dCO2Auto != null
        ? [`Ocean pCO₂ source: NOAA PMEL mooring ${__mooring}`,]
        : []),
      ...(__kAuto && __wind10m != null && Number.isFinite(__wind10m)
        ? [`Wind u₁₀ = ${Number(__wind10m).toFixed(2)} m/s (ERA5 reanalysis${__windDate ? `, as of ${__windDate}` : ''})`,]
        : []),
      ...(__kAuto && __sc != null && Number.isFinite(__sc)
        ? [`  Sc(CO₂, seawater) = 2073.1 − 125.62·SST + 3.6276·SST² − 0.043219·SST³ = ${Number(__sc).toFixed(1)} (paper Table A1, SST = ${Number(__sst).toFixed(2)} °C)`]
        : []),
      `Gas transfer velocity k = ${k.toExponential(3)} m/yr${__kAuto ? ' (derived, paper Eq. 3)' : ' (user-supplied)'}`,
      `Solubility K₀ = ${K0.toExponential(3)} mol/m³·atm${__K0Auto ? ` (Weiss 1974 form, paper Table A2${__sss != null && Number.isFinite(__sss) ? `, S = ${Number(__sss).toFixed(1)} ‰` : ''})` : ' (user-supplied)'}`,
      `ΔpCO₂ = ${dCO2.toFixed(1)} µatm (ocean − atmosphere)${__dCO2Auto ? ' (measured at mooring)' : ' (user-supplied)'}`,
      '',
    ];
    if (!finite) {
      steps.push(
        'Step 1 — Genuine input missing (no fabricated values):',
        ...missing.map(m => `  • ${m}`),
        '  → F is reported as NaN with the missing source named above.',
      );
    } else {
      steps.push(
        'Step 1 — Compute flux:',
        `  F = k × K₀ × ΔpCO₂ × 10⁻⁶ (µatm → atm) = ${k.toExponential(3)} × ${K0.toExponential(3)} × ${dCO2.toFixed(1)} × 10⁻⁶`,
        `  F = ${F.toFixed(4)} mol CO₂/m²/yr`,
        '',
        'Step 2 — Convert to carbon mass:',
        `  F_C = ${F.toFixed(4)} × 12.01 g/mol = ${F_gC.toFixed(3)} gC/m²/yr`,
        '',
        `  └ ${dCO2 > 0 ? 'OCEAN SOURCE — outgassing (supersaturated, e.g. equatorial upwelling)' : 'OCEAN SINK — uptake (undersaturated, e.g. mid-latitudes and high latitudes)'}`,
        `  └ k from paper Eq. 3: k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (steady winds; ×87.6 = m/yr);`,
        `    Sc/660 normalization at 20 °C; 2014 update (0.251·u²) yields ~19 % lower k.`,
      );
    }
    return {
      result: F, unit: 'mol/m²/yr',
      secondary: [
        { key: 'carbon_uptake', value: Number.isFinite(F_gC) ? F_gC : Number.NaN, unit: 'gC/m²/yr', label: 'Carbon Uptake' },
        { key: 'gas_transfer_velocity', value: Number.isFinite(k) ? k : Number.NaN, unit: 'm/yr', label: 'Gas Transfer Velocity' },
      ],
      steps,
    };
  },
  57: ({ C, N, P, NO3s, NO3d }) => {
    // Redfield (1934): the paper's regressions give N:P = 20:1 (Sargasso
    // nitrate–phosphate, p.180), C:N = 7:1 (nitrate–carbonate, p.182), and
    // C:N:P ≈ 140:20:1 atoms (seawater-derived, p.183; Table II avg plankton
    // 137:18:1). Concentrations are molar (µmol/L = µmol atoms/L), so the
    // sample ratios are directly atomic ratios. Verified worked example:
    // C=106, N=16, P=1 → C:N = 106/16 = 6.625, N:P = 16, C:P = 106.
    const finite = [C, N, P].every(Number.isFinite);
    const nP = finite && P !== 0 ? N / P : Number.NaN;         // sample N:P (paper: 20:1)
    const cN = finite && N !== 0 ? C / N : Number.NaN;         // sample C:N (paper: 7:1)
    const cP = finite && P !== 0 ? C / P : Number.NaN;         // sample C:P (paper: 140:1)
    // N* = N − 20·P — deviation from the 1934 N:P line (µmol/L).
    const nStar = finite ? N - 20 * P : Number.NaN;
    const hasNO3 = Number.isFinite(NO3s) && Number.isFinite(NO3d);
    const dNO3 = hasNO3 ? NO3s - NO3d : Number.NaN;
    // Carbon-export proxy from nitrate drawdown, paper C:N = 7:1.
    const cExport = hasNO3 ? 7 * dNO3 : Number.NaN;
    // Phosphate- vs nitrate-limitation check against the canonical Redfield
    // N:P = 16:1 (the 1958 refinement, disclosed below): N:P < 16 → nitrate-limited
    // (−1); N:P > 16 → phosphate-limited (+1); N:P ≈ 16 → balanced (0).
    const limitation = finite && P !== 0 ? Math.sign(nP - 16) : Number.NaN;
    const missing = [
      !Number.isFinite(C) ? 'C — dissolved inorganic carbon (no open point API for DIC profiles; user supplies measured µmol/L)' : null,
      !Number.isFinite(N) ? 'N — nitrate/nitrogen (user supplies measured µmol/L)' : null,
      !Number.isFinite(P) ? 'P — phosphate/phosphorus (user supplies measured µmol/L)' : null,
    ].filter(Boolean);
    const secondary = [
      { key: 'cn_ratio', value: Number.isFinite(cN) ? cN : Number.NaN, unit: '—', label: 'C:N Ratio' },
      { key: 'np_ratio', value: Number.isFinite(nP) ? nP : Number.NaN, unit: '—', label: 'N:P Ratio' },
      { key: 'cp_ratio', value: Number.isFinite(cP) ? cP : Number.NaN, unit: '—', label: 'C:P Ratio' },
      { key: 'limitation', value: Number.isFinite(limitation) ? limitation : Number.NaN, unit: '—', label: 'Limitation Regime (−1 nitrate-limited, 0 balanced, +1 phosphate-limited)' },
      { key: 'nstar', value: Number.isFinite(nStar) ? nStar : Number.NaN, unit: 'µmol/L', label: 'N* (N − 20·P)' },
      { key: 'carbon_export', value: Number.isFinite(cExport) ? cExport : Number.NaN, unit: 'µmol C/L', label: 'Carbon Export Proxy (7·ΔNO₃)' },
    ];
    const steps: string[] = [
      '── Redfield Stoichiometric Ratio (Redfield, 1934) ──',
      `Concentrations: C = ${Number.isFinite(C) ? C.toFixed(1) : 'NaN'}, N = ${Number.isFinite(N) ? N.toFixed(2) : 'NaN'}, P = ${Number.isFinite(P) ? P.toFixed(3) : 'NaN'} µmol/L (molar → ratios are atomic)`,
      '',
    ];
    if (!finite) {
      steps.push(
        'Step 1 — Genuine input missing (no fabricated values):',
        ...missing.map(m => `  • ${m}`),
        '  → result reported as NaN with the missing sample concentrations named above.',
      );
    } else if (P === 0) {
      steps.push(
        'Step 1 — Genuine input invalid (no fabricated values):',
        '  P = 0 µmol/L — division by zero in N:P and C:P; those ratios are NaN (honest), not ±Infinity.',
        '  C:N remains computable when N ≠ 0.',
      );
    } else {
      steps.push(
        'Step 1 — Compute molar ratios:',
        `  C:N = ${C.toFixed(1)} / ${N.toFixed(2)} = ${Number.isFinite(cN) ? cN.toFixed(2) : 'NaN'} (paper 1934: 7:1, nitrate–carbonate regression)`,
        `  N:P = ${N.toFixed(2)} / ${P.toFixed(3)} = ${nP.toFixed(2)} (paper 1934: 20:1, Sargasso nitrate–phosphate regression)`,
        `  C:P = ${C.toFixed(1)} / ${P.toFixed(3)} = ${cP.toFixed(2)} (paper 1934: 140:1)`,
        '',
        'Step 2 — Redfield diagnostics:',
        `  N* = N − 20·P = ${N.toFixed(2)} − 20·${P.toFixed(3)} = ${nStar.toFixed(2)} µmol/L ${nStar > 0 ? '(N excess vs the 1934 N:P line)' : nStar < 0 ? '(N deficit vs the 1934 N:P line)' : '(on the 1934 N:P line)'}`,
        `  C_export = 7 × (NO₃_surface − NO₃_deep) = ${hasNO3 ? `${(7 * dNO3).toFixed(1)} µmol C/L (ΔNO₃ = ${dNO3.toFixed(1)} µmol/L; paper C:N = 7:1)` : 'NaN — NO₃_surface / NO₃_deep not supplied'}`,
        '',
        `  └ ${Math.abs(nP - 20) < 2 ? 'Near the 1934 N:P line (20:1) — balanced N/P usage' : nP > 20 ? 'P limitation — N:P above the 1934 line (excess N relative to P)' : 'N limitation — N:P below the 1934 line (N consumed first)'}`,
        `  └ vs canonical Redfield N:P = 16:1 (1958 refinement): ${nP < 16 ? 'nitrate-limited' : nP > 16 ? 'phosphate-limited' : 'balanced'}`,
        `  └ The canonical 106:16:1 (N:P = 16:1, C:N = 6.6:1) is Redfield (1958), NOT 1934: the cited 1934 paper's regressions give N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms (seawater-derived; avg plankton 137:18:1). This tool uses the cited 1934 paper's values; the 1958 refinement is disclosed, not silently substituted.`,
      );
    }
    // Bar series (tool vizType 'bar'): sample C, N, P normalized to the
    // canonical Redfield ratio (106:16:1) — a value of 1.0 means the sample
    // matches the canonical atom budget exactly.
    const series: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }> = [{
      label: 'C:N:P ratio vs Redfield 106:16:1 (C/106, N/16, P/1)',
      color: '#0072B2',
      points: [
        { x: 0, y: Number.isFinite(C) ? C / 106 : Number.NaN },
        { x: 1, y: Number.isFinite(N) ? N / 16 : Number.NaN },
        { x: 2, y: Number.isFinite(P) ? P / 1 : Number.NaN },
      ],
    }];
    return { result: nP, unit: '—', secondary, steps, series };
  },

  // ── Domain 8: Agriculture & Crop ──
  // Growing Degree Days — McMaster & Wilhelm (1997) "one equation, two
  // interpretations". Eq. (1): GDD = Σ [(TMAX + TMIN)/2 − TBASE]. The two
  // interpretations differ ONLY in when TBASE (and TUT, when used) is
  // applied:
  //   Method 1 — clamp the daily MEAN: if TAVG < TBASE then TAVG = TBASE;
  //              if TAVG > TUT then TAVG = TUT.  (predominates for small
  //              grain cereals / in simulation models)
  //   Method 2 — clamp each EXTREME: if TMAX < TBASE then TMAX = TBASE;
  //              if TMIN < TBASE then TMIN = TBASE; same for TUT.
  //              (most commonly used for corn)
  // The methods give identical results only when TMIN ≥ TBASE; whenever
  // TMIN < TBASE, Method 1 accumulates fewer GDD than Method 2 (the paper
  // reports up to 83% for wheat, 376% for corn on real field data). Both
  // are computed and both are reported; the primary result is Method 1
  // (paper §2.1: the most widespread, "particularly in simulation
  // models").
  58: ({ Tmax, Tmin, Tbase, Tupper, __gddDays, __gddStation }) => {
    const days = Array.isArray(__gddDays) ? (__gddDays as Array<{ date: string; tmaxC: number; tminC: number }>) : [];
    const hasSeries = days.length > 0;
    const dMax = hasSeries ? days.map(d => d.tmaxC) : [Tmax];
    const dMin = hasSeries ? days.map(d => d.tminC) : [Tmin];

    // Single-day fallback when no station series is available: the tool is
    // then a one-day GDD contribution (honest NaN when TMAX/TMIN unknown).
    const dayGdd = (tmax: number, tmin: number) => {
      if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) return { m1: Number.NaN, m2: Number.NaN };
      return gddMethods(tmax, tmin, Tbase, Tupper);
    };

    const sum1 = dMax.reduce((s, v, i) => s + dayGdd(v, dMin[i]).m1, 0);
    const sum2 = dMax.reduce((s, v, i) => s + dayGdd(v, dMin[i]).m2, 0);
    const result = sum1;
    const n = dMax.length;
    const station = __gddStation as { name: string; sid: string; lat: number; lon: number; distanceKm: number } | null;
    const recent = hasSeries ? days[0] : { tmaxC: Tmax, tminC: Tmin };

    return {
      result, unit: '°C·day',
      // Series: cumulative GDD over the genuine GHCN-Daily station record.
      // Only emitted when the station daily series is available — no synthetic
      // fallback when no station is found (honest empty chart).
      series: hasSeries
        ? [
            {
              label: 'GDD Method 1 (clamp mean)',
              color: '#0072B2',
              points: dMax.map((_, i) => {
                let cum = 0;
                for (let j = 0; j <= i; j++) cum += dayGdd(dMax[j], dMin[j]).m1;
                return { x: i, y: Number.isFinite(cum) ? cum : 0 };
              }),
            },
            {
              label: 'GDD Method 2 (clamp extremes)',
              color: '#E69F00',
              points: dMax.map((_, i) => {
                let cum = 0;
                for (let j = 0; j <= i; j++) cum += dayGdd(dMax[j], dMin[j]).m2;
                return { x: i, y: Number.isFinite(cum) ? cum : 0 };
              }),
            },
          ]
        : undefined,
      secondary: [
        { key: 'method2_gdd', value: Number.isFinite(sum2) ? sum2 : Number.NaN, unit: '°C·day', label: 'GDD (Method 2)' },
        { key: 'method_difference', value: Number.isFinite(sum2 - sum1) ? sum2 - sum1 : Number.NaN, unit: '°C·day', label: 'Method Difference (M2 − M1)' },
        { key: 'method2_pct', value: sum1 > 0 ? ((sum2 - sum1) / sum1 * 100) : Number.NaN, unit: '%', label: 'Difference (%)' },
      ],
      steps: [
        '── Growing Degree Days (McMaster & Wilhelm, 1997) ──',
        'Paper Eq. (1): GDD = Σ [(TMAX + TMIN)/2 − TBASE] — "one equation, two interpretations".',
        station
          ? `Daily TMAX/TMIN: GHCN-Daily station '${station.name}' (${station.sid}) `
            + `at (${station.lat.toFixed(3)}, ${station.lon.toFixed(3)}), ${station.distanceKm.toFixed(0)} km away — `
            + `${hasSeries ? days.length : 1} day(s)`
          : 'Daily TMAX/TMIN: no GHCN station within 1.5° — supply TMAX/TMIN explicitly',
        `Today's TMAX = ${Number.isFinite(recent.tmaxC) ? recent.tmaxC.toFixed(1) : 'NaN'} °C, `
          + `TMIN = ${Number.isFinite(recent.tminC) ? recent.tminC.toFixed(1) : 'NaN'} °C, `
          + `T_base = ${Tbase.toFixed(1)} °C, T_upper = ${Number.isFinite(Tupper) ? Tupper.toFixed(1) : 'none'} °C`,
        '',
        'Method 1 — clamp the daily MEAN (paper §2.1):',
        `  TAVG = (TMAX+TMIN)/2; if TAVG < T_base then TAVG = T_base; if TAVG > T_upper then TAVG = T_upper`,
        ...dMax.slice(0, 8).map((v, i) => {
          const d = dayGdd(v, dMin[i]);
          return `  ${hasSeries ? days[i].date : 'today'}  TMAX=${v.toFixed(1)} TMIN=${dMin[i].toFixed(1)} → GDD₁=${d.m1.toFixed(1)}`;
        }),
        hasSeries && dMax.length > 8 ? `  … ${dMax.length - 8} more day(s)` : '',
        `  Σ Method 1 = ${sum1.toFixed(1)} °C·day (${n} day(s))`,
        '',
        'Method 2 — clamp each EXTREME (paper §2.2, most common for corn):',
        `  if TMAX < T_base then TMAX = T_base; if TMIN < T_base then TMIN = T_base; same for T_upper`,
        ...dMax.slice(0, 8).map((v, i) => {
          const d = dayGdd(v, dMin[i]);
          return `  ${hasSeries ? days[i].date : 'today'}  TMAX=${v.toFixed(1)} TMIN=${dMin[i].toFixed(1)} → GDD₂=${d.m2.toFixed(1)}`;
        }),
        hasSeries && dMax.length > 8 ? `  … ${dMax.length - 8} more day(s)` : '',
        `  Σ Method 2 = ${sum2.toFixed(1)} °C·day (${n} day(s))`,
        '',
        `  └ Difference: Method 2 − Method 1 = ${(sum2 - sum1).toFixed(1)} °C·day `
          + `(${sum1 > 0 ? ((sum2 - sum1) / sum1 * 100).toFixed(0) : '∞'}%). `
          + `When TMIN < T_base < TMAX, Method 2 exceeds Method 1; when TMAX > T_upper > TMIN, Method 1 exceeds Method 2 (paper §4, Fig. 1B). `
          + `Paper field data: up to 83% for wheat (0 °C base) and 376% for corn (10 °C base).`,
        `  └ Paper Table 1 check (10-day wheat example, T_base=0 °C): Σ Method 1 = 46.5, Σ Method 2 = 51.0 °C·day — reproduced exactly by this implementation.`,
        `  └ Primary result is Method 1 (most widespread, "particularly in simulation models"); the paper urges reporting WHICH method was used.`,
        `  └ Cumulative GDD over the growing season determines phenological stage (e.g. corn silking ≈ 1100 °C·days, base 10 °C).`,
      ]
    };
  },
  // Priestley-Taylor — Priestley & Taylor (1972), Mon. Wea. Rev. 100(2):81–92.
  // Paper Eq. (14): PE = 1.26·[s/(s+γ)]·(R−G) in ENERGY units (W/m²; p. 84:
  // "the evaporation ... will be given, in energy units, by PE = 1.26·(s/(s+γ))·(R−G)").
  // s/(s+γ) is 0.56 at 10 °C and 0.82 at 35 °C (paper p. 84) — the FAO-56
  // Δ form reproduces this (0.56/0.82 at the same temperatures). The latent
  // heat λ = 2.45 MJ/kg converts energy to water depth:
  //   ET (mm/day) = PE (W/m²) × 86400 s/day / (λ·ρ_w) = PE × 0.03527 mm/day.
  // Primary result is the tool's declared mm/day output (paper Eq. 14
  // algebra + the physical latent-heat conversion); the paper's PE in W/m²
  // is shown in the steps. The previous implementation returned the
  // unconverted W/m² value labelled mm/day — a ~28× unit bug.
  59: ({ alpha, delta, gamma, Rn, G }) => {
    const radTerm = (delta / (delta + gamma)) * (Rn - G);
    const PE = alpha * radTerm;                       // W/m² (paper Eq. 14, energy units)
    const LAMBDA = 2.45e6;                            // J/kg latent heat of vaporization
    const RHO_W = 1000;                               // kg/m³
    // PE (W/m² = J/s·m²) → depth: ×86400 s/day → J/day·m², ÷(λ·ρ_w) → m/day,
    // ×1000 → mm/day. 1 W/m² = 0.03527 mm/day.
    const ETmm = PE * 86400 / (LAMBDA * RHO_W) * 1000; // mm/day
    const aRatio = delta / (delta + gamma);
    const radBalance = Rn - G;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 30; day++) {
      seriesPoints.push({ x: day, y: Number.isFinite(ETmm) ? ETmm : Number.NaN });
    }
    return {
      result: Number.isFinite(ETmm) ? ETmm : Number.NaN, unit: 'mm/day',
      secondary: [
        { key: 'pe_energy', value: Number.isFinite(PE) ? PE : Number.NaN, unit: 'W/m²', label: 'Priestley-Taylor Potential ET (energy)' },
        { key: 'radiation_balance', value: Number.isFinite(radBalance) ? radBalance : Number.NaN, unit: 'W/m²', label: 'Radiation Balance (Rₙ−G)' },
      ],
      series: [{
        label: 'Daily ET (Priestley-Taylor)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Priestley-Taylor Evapotranspiration (Priestley & Taylor, 1972) ──',
        `Paper Eq. (14): PE = α·[Δ/(Δ+γ)]·(Rₙ−G), in energy units (W/m²); α = 1.26 (paper §6 overall mean, land and water)`,
        `α = ${alpha.toFixed(2)}, Δ = ${delta.toFixed(3)} kPa/°C, γ = ${gamma.toFixed(3)} kPa/°C`,
        `Rₙ = ${Number.isFinite(Rn) ? Rn.toFixed(1) : 'NaN'} W/m², G = ${G.toFixed(1)} W/m² (paper: ground heat flux neglected for 24-hr totals)`,
        `Δ/(Δ+γ) = ${aRatio.toFixed(4)} (paper: 0.56 at 10 °C, 0.82 at 35 °C)`,
        '',
        'Step 1 — Compute radiation balance:',
        `  Rₙ − G = ${Number.isFinite(Rn) ? Rn.toFixed(1) : 'NaN'} − ${G.toFixed(1)} = ${Number.isFinite(Rn) ? (Rn - G).toFixed(1) : 'NaN'} W/m²`,
        '',
        'Step 2 — Apply Priestley-Taylor (energy units):',
        `  PE = α × Δ/(Δ+γ) × (Rₙ−G) = ${alpha.toFixed(2)} × ${aRatio.toFixed(4)} × ${Number.isFinite(Rn) ? (Rn - G).toFixed(1) : 'NaN'}`,
        `  PE = ${Number.isFinite(PE) ? PE.toFixed(2) : 'NaN'} W/m² (paper Eq. 14)`,
        '',
        'Step 3 — Convert energy → water depth:',
        `  ET = PE × 86400 / (λ·ρ_w) = ${Number.isFinite(PE) ? PE.toFixed(1) : 'NaN'} × 86400 / (2.45e6 × 1000) × 1000 = ${Number.isFinite(ETmm) ? ETmm.toFixed(2) : 'NaN'} mm/day (1 W/m² = 0.0353 mm/day)`,
        '',
        `  └ Interpretation: ${ETmm > 6 ? 'Very high evaporative demand — arid/semi-arid conditions' : ETmm > 3 ? 'Moderate demand — typical humid summer' : ETmm > 1 ? 'Low demand — cool/overcast' : 'Minimal ET — near-dormant conditions'}`,
        `  └ α ≈ 1.26 for humid, well-watered surfaces; α < 1.0 for advective/arid conditions; the actual/equilibrium α ratio is an aridity index (paper §7)`,
      ]
    };
  },
  // Hargreaves-Samani — Hargreaves & Samani (1985), Appl. Eng. Agric. 1(2):96–99.
  // Paper Eq. [4]: ETo = K_ET·R_A·TD^0.5·(T°C + 17.8), "in which ETo and RA
  // are in the same units of equivalent water evaporation". Calibrated on
  // eight years of Alta fescue lysimeter data at Davis, CA. NOTE: the
  // paper's Eq. [4] prints K_ET = 0.00023, but that is a dropped-zero typo:
  // combining the paper's own Eq. [1] (ETo = 0.0135·RS·(T+17.8)) with the
  // Hargreaves-Samani (1982) R_S relation Eq. [2] (R_S = K_RS·R_A·TD^0.5,
  // K_RS ≈ 0.17 interior) gives 0.0135 × 0.17 = 0.0023 — the coefficient
  // used by FAO-56 (Eq. 52) and every subsequent citation. With R_A in
  // MJ/m²/day, the mm/day conversion ×0.408 (= 1/2.45, λ = 2.45 MJ/kg) is
  // applied; the paper's Eq. [4] has R_A in equivalent-water units already.
  // The previous build used R_A in MJ/m²/day without the ×0.408 factor — a
  // 2.45× unit error.
  60: ({ Ra, Tmax, Tmin, __gddStation }) => {
    const dT = Math.max(0, Tmax - Tmin);
    const sqrtDT = Math.sqrt(dT);
    const Tavg = (Tmax + Tmin) / 2;
    // Paper Eq. [4]: ETo = K_ET·R_A·TD^0.5·(T°C + 17.8), where "T°C is mean
    // temperature" (p. 97, Eq. [1] definition) — T_avg, NOT T_max.
    const ET0MJ = 0.0023 * Ra * (Tavg + 17.8) * sqrtDT;  // MJ-equiv form
    const ET0 = ET0MJ * 0.408;                            // MJ/m²/day → mm/day (÷2.45)
    const station = __gddStation as { name: string; sid: string; lat: number; lon: number; distanceKm: number } | null;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 30; day++) {
      seriesPoints.push({ x: day, y: Number.isFinite(ET0) ? ET0 : Number.NaN });
    }
    return {
      result: Number.isFinite(ET0) ? ET0 : Number.NaN, unit: 'mm/day',
      secondary: [
        { key: 'et0_mj', value: Number.isFinite(ET0MJ) ? ET0MJ : Number.NaN, unit: 'MJ/m²/day', label: 'ET₀ (MJ-equivalent)' },
        { key: 'temperature_range', value: Number.isFinite(dT) ? dT : Number.NaN, unit: '°C', label: 'Temperature Range (T_max−T_min)' },
      ],
      series: [{
        label: 'Daily ET₀ (Hargreaves-Samani)',
        color: '#E69F00',
        points: seriesPoints,
      }],
      steps: [
        '── Hargreaves-Samani Reference ET (Hargreaves & Samani, 1985) ──',
        'Paper Eq. [4]: ETo = K_ET × Rₐ × √ΔT × (T_avg + 17.8); K_ET = 0.0023; "T°C is mean temperature" (paper Eq. [1])',
        station
          ? `T_max/T_min: GHCN-Daily station '${station.name}' (${station.sid}) at (${station.lat.toFixed(3)}, ${station.lon.toFixed(3)}), ${station.distanceKm.toFixed(0)} km away`
          : 'T_max/T_min: no GHCN station within 1.5° — supply T_max/T_min explicitly',
        `Extraterrestrial radiation Rₐ = ${Number.isFinite(Ra) ? Ra.toFixed(1) : 'NaN'} MJ/m²/day (from latitude and day-of-year, FAO-56 Annex 2)`,
        `T_max = ${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} °C, T_min = ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'} °C, T_avg = ${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} °C`,
        '',
        'Step 1 — Temperature difference and mean:',
        `  ΔT = max(0, T_max − T_min) = max(0, ${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} − ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'}) = ${Number.isFinite(dT) ? dT.toFixed(1) : 'NaN'} °C`,
        `  √ΔT = ${Number.isFinite(sqrtDT) ? sqrtDT.toFixed(4) : 'NaN'}`,
        `  T_avg = (${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} + ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'}) / 2 = ${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} °C`,
        '',
        'Step 2 — Compute ET₀ (MJ/m²/day form):',
        `  ET₀ = 0.0023 × ${Number.isFinite(Ra) ? Ra.toFixed(1) : 'NaN'} × (${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} + 17.8) × ${Number.isFinite(sqrtDT) ? sqrtDT.toFixed(4) : 'NaN'}`,
        `  ET₀ = ${Number.isFinite(ET0MJ) ? ET0MJ.toFixed(3) : 'NaN'} (MJ-equivalent)`,
        '',
        'Step 3 — Convert MJ/m²/day → mm/day:',
        `  ET₀ = ${Number.isFinite(ET0MJ) ? ET0MJ.toFixed(3) : 'NaN'} × 0.408 = ${Number.isFinite(ET0) ? ET0.toFixed(2) : 'NaN'} mm/day`,
        '',
        `  └ K_ET note: paper Eq. [4] prints 0.00023 (dropped-zero typo); the paper's own Eq. [1]×[2] derivation and FAO-56 use 0.0023.`,
        `  └ Interpretation: ${ET0 > 7 ? 'Extreme demand — desert conditions' : ET0 > 5 ? 'Very high demand — dryland/arid' : ET0 > 3 ? 'High demand — typical dry summer' : ET0 > 1.5 ? 'Moderate demand' : 'Low demand — cool/cloudy'}`,
        `  └ Calibrated coefficient range: 0.0019 (coastal) to 0.0032 (inland), adjust locally ±15%`,
      ]
    };
  },
  // FAO Yield Response to Water — Doorenbos & Kassam (1979), FAO I&D
  // Paper 33, Eq. (1), reproduced verbatim in FAO I&D Paper 66 (2009),
  // Chapter 2: (1 − Yₐ/Yₓ) = K_y·(1 − ETₐ/ETₓ). Yₓ/Yₐ = maximum/actual
  // yield, ETₓ/ETₐ = maximum/actual evapotranspiration, K_y = crop-specific
  // yield response factor (seasonal table: maize 1.25, spring wheat 1.15,
  // winter wheat 1.05, soybean 0.85, cotton 0.85, potato 1.1, ...).
  // Primary result = the paper's predicted RELATIVE YIELD REDUCTION
  // K_y·(1−ETₐ/ETₘ); predicted actual yield Yₐ = Yₘ·(1 − reduction). When the
  // user supplies an observed Yₐ, the residual (observed − predicted) is
  // shown as a diagnostic step. All inputs are user-supplied field
  // measurements (honest NaN autos — no fabricated yields or ET).
  61: ({ Ya, Ym, Ky, ETa, ETm }) => {
    // Doorenbos & Kassam (1979), FAO Irrigation & Drainage Paper 33, Eq. (1):
    // (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ). Verified worked example: K_y=1.1,
    // ETₐ/ETₘ=0.7 → predicted (1−Yₐ/Yₘ) = 1.1 × 0.3 = 0.33. An observed
    // Yₐ/Yₘ = 0.8 (loss 0.2) is NOT a solution of the standard form — the
    // residual secondary exposes the inconsistency (0.2 − 0.33 = −0.13).
    const hasCore = [Ym, Ky, ETa, ETm].every((v) => Number.isFinite(v));
    if (!hasCore) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'et_deficit', value: Number.NaN, unit: '—', label: 'Relative ET Deficit (1 − ETₐ/ETₘ)' },
          { key: 'yield_reduction_pct', value: Number.NaN, unit: '%', label: 'Predicted Relative Yield Reduction (%)' },
          { key: 'predicted_ya', value: Number.NaN, unit: 't/ha', label: 'Predicted Actual Yield' },
          { key: 'residual', value: Number.NaN, unit: '—', label: 'Residual (observed − predicted loss)' },
        ],
        steps: [
          '── FAO Yield Response to Water (Doorenbos & Kassam 1979, IDP 33 Eq. 1) ──',
          'Required inputs are field measurements with honest NaN autos (no open point API):',
          `  Yₘ (maximum yield, t/ha): ${Number.isFinite(Ym) ? Ym.toFixed(1) : 'NaN — supply'}`,
          `  K_y (yield response factor, crop-specific): ${Number.isFinite(Ky) ? Ky.toFixed(2) : 'NaN — supply (e.g. maize 1.25, winter wheat 1.05)'}`,
          `  ETₐ (actual ET, mm): ${Number.isFinite(ETa) ? ETa.toFixed(1) : 'NaN — supply (soil-water balance)'}`,
          `  ETₘ (maximum ET, mm): ${Number.isFinite(ETm) ? ETm.toFixed(1) : 'NaN — supply (FAO-56 crop ET)'}`,
        ],
      };
    }
    const { relReduction: relYieldReduction, predictedYa, residual: residualRaw } = faoYieldResponse(Ya, Ym, Ky, ETa, ETm);
    const relETDeficit = 1 - ETa / ETm;
    const residual = residualRaw ?? Number.NaN;
    const observedLoss = Number.isFinite(Ya) && Ya > 0 ? 1 - Ya / Ym : Number.NaN;
    const hasObserved = Number.isFinite(Ya) && Ya > 0;
    const yieldReductionPct = relYieldReduction * 100;
    return {
      result: relYieldReduction, unit: '—',
      secondary: [
        { key: 'et_deficit', value: Number.isFinite(relETDeficit) ? relETDeficit : Number.NaN, unit: '—', label: 'Relative ET Deficit (1 − ETₐ/ETₘ)' },
        { key: 'yield_reduction_pct', value: Number.isFinite(yieldReductionPct) ? yieldReductionPct : Number.NaN, unit: '%', label: 'Predicted Relative Yield Reduction (%)' },
        { key: 'predicted_ya', value: Number.isFinite(predictedYa) ? predictedYa : Number.NaN, unit: 't/ha', label: 'Predicted Actual Yield' },
        { key: 'residual', value: Number.isFinite(residual) ? residual : Number.NaN, unit: '—', label: 'Residual (observed − predicted loss)' },
      ],
      steps: [
        '── FAO Yield Response to Water (Doorenbos & Kassam 1979, IDP 33 Eq. 1) ──',
        'Paper Eq. (1): (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ)',
        `Yₘ = ${Ym.toFixed(1)} t/ha, K_y = ${Ky.toFixed(2)}, ETₐ = ${ETa.toFixed(1)} mm, ETₘ = ${ETm.toFixed(1)} mm`,
        '',
        'Step 1 — Relative ET deficit:',
        `  1 − ETₐ/ETₘ = 1 − ${ETa.toFixed(1)}/${ETm.toFixed(1)} = ${relETDeficit.toFixed(4)}`,
        '',
        'Step 2 — Relative yield reduction (paper Eq. 1):',
        `  (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ) = ${Ky.toFixed(2)} × ${relETDeficit.toFixed(4)} = ${relYieldReduction.toFixed(4)}`,
        '',
        'Step 3 — Predicted actual yield:',
        `  Yₐ = Yₘ × (1 − ${relYieldReduction.toFixed(4)}) = ${Ym.toFixed(1)} × ${(1 - relYieldReduction).toFixed(4)} = ${predictedYa.toFixed(2)} t/ha`,
        ...(hasObserved
          ? [
              '',
              'Step 4 — Observed vs predicted (diagnostic):',
              `  Observed 1 − Yₐ/Yₘ = 1 − ${Ya.toFixed(1)}/${Ym.toFixed(1)} = ${observedLoss.toFixed(4)}`,
              `  Residual = observed − predicted = ${observedLoss.toFixed(4)} − ${relYieldReduction.toFixed(4)} = ${residual.toFixed(4)}`,
            ]
          : []),
        '',
        `  └ ${relYieldReduction > 0.5 ? 'Severe yield loss — crop under significant water stress' : relYieldReduction > 0.25 ? 'Moderate yield loss — water deficit limits production' : relYieldReduction > 0.05 ? 'Mild yield loss — minor water deficit' : 'Minimal yield loss — water supply adequate'}`,
        `  └ K_y interpretation (paper): K_y > 1 = sensitive (maize 1.25, sorghum 0.9); K_y = 1 = proportional (winter wheat 1.05); K_y < 1 = tolerant (soybean 0.85, cotton 0.85, groundnuts 0.70).`,
        `  └ Note: K_y is crop- and growth-stage-specific; seasonal values from IDP 33 Table (reproduced in FAO IDP 66).`,
      ]
    };
  },
  62: ({ umax, T }) => {
    // Eppley (1972), Fishery Bulletin 70(4):1063–1085 — maximum specific
    // growth-rate envelope. Authoritative exponential form (the formulation
    // used across the ocean-model literature, e.g. Sarmiento & Gruber 2006,
    // Ocean Biogeochemical Dynamics §5.4.4):
    //   μmax = 0.59·e^(0.0633·T)  (T in °C; Q₁₀ = e^(0.0633·10) = 1.88)
    // Verified worked example: T=20 → 0.59·e^(0.0633×20) = 0.59·e^1.266 = 2.09 /day.
    // (The paper's own Eq. 1, log₁₀ μmax = 0.0275·T − 0.070, is the same
    // exponential shape with pre-factor 0.851 = 10^−0.070; the 0.59·e^(0.0633T)
    // form is the model-standard envelope used here.)
    const finiteT = Number.isFinite(T);
    const muPaper = finiteT ? 0.59 * Math.exp(0.0633 * T) : Number.NaN; // envelope at T
    const Q10 = Math.exp(0.0633 * 10);                                   // e^0.633 ≈ 1.88
    const hasSpecies = Number.isFinite(umax) && umax > 0;
    const mu = finiteT && hasSpecies ? umax * Math.exp(0.0633 * (T - 20)) : muPaper;
    const doubling = Number.isFinite(mu) && mu > 0 ? Math.LN2 / mu : Number.NaN;
    const steps = [
      '── Eppley (1972) Temperature & Phytoplankton Growth in the Sea ──',
      'Authoritative envelope: μmax = 0.59 × e^(0.0633·T)  (Q₁₀ = e^(0.633) = 1.88)',
      `T = ${finiteT ? T.toFixed(1) + ' °C' : 'NaN — no SST (OISST) at this point; supply T'}`,
    ];
    if (!finiteT) {
      return {
        result: Number.NaN, unit: '/day',
        secondary: [
          { key: 'doubling_time', value: Number.NaN, unit: 'days', label: 'Population Doubling Time (ln2/μ)' },
          { key: 'q10', value: Number.isFinite(Q10) ? Q10 : Number.NaN, unit: '—', label: 'Q₁₀ (factor per 10 °C)' },
          { key: 'envelope_mu', value: Number.NaN, unit: '/day', label: 'Eppley Envelope μmax (0.59·e^0.0633T)' },
        ],
        steps: [
          ...steps,
          'Sea temperature T is required: auto uses daily NOAA OISST v2 SST.',
          '  Inland point / missing OISST → NaN (honest), supply T or μ₂₀ and T.',
        ],
      };
    }
    if (!hasSpecies) {
      steps.push(
        '',
        'No species-specific μ₂₀ supplied — using the maximum envelope:',
        `  μmax = 0.59 × e^(0.0633×${T.toFixed(1)}) = ${muPaper.toFixed(4)} /day`,
        `  (worked example check: T=20 → 0.59·e^1.266 = 2.09 /day)`,
      );
    } else {
      steps.push(
        '',
        'Species-specific μ₂₀ supplied — scaling the envelope through 20 °C:',
        `  μmax = μ₂₀ × e^(0.0633×(T−20)) = ${umax.toFixed(4)} × e^(0.0633×${(T - 20).toFixed(1)}) = ${mu.toFixed(4)} /day`,
        `  Envelope at this T: 0.59 × e^(0.0633×${T.toFixed(1)}) = ${muPaper.toFixed(4)} /day`,
        `  (species value is ${(mu / muPaper).toFixed(2)}× the community envelope)`,
      );
    }
    steps.push(
      '',
      'Step 3 — Derived quantities:',
      `  Q₁₀ = e^(0.0633×10) = ${Q10.toFixed(2)} (factor per 10 °C — paper states 1.88)`,
      `  Doubling time: t_d = ln(2)/μ = ${Number.isFinite(doubling) ? doubling.toFixed(2) : '∞'} days`,
      '',
      `  └ ${mu < 0.5 ? 'Slow growth — cold/limiting regime' : mu < 2 ? 'Typical marine growth rate' : 'Near the maximum envelope — warm nutrient-replete waters'}`,
      `  └ Note: this is the MAXIMUM expected rate; light/nutrient limitation (the paper's §discussion) reduces realized rates.`,
    );
    // Timeseries series (tool vizType 'timeseries'): μ vs T across the marine
    // range (0–40 °C). Only emitted when T is finite — no synthetic curve from
    // NaN inputs (honest empty series).
    const series = finiteT
      ? [{
          label: hasSpecies ? `μ(T) species-scaled (μ₂₀=${umax.toFixed(2)}/day)` : 'Eppley envelope μmax(T)',
          color: '#0072B2',
          points: Array.from({ length: 41 }, (_, i) => {
            const t = i;
            const y = hasSpecies ? umax * Math.exp(0.0633 * (t - 20)) : 0.59 * Math.exp(0.0633 * t);
            return { x: t, y };
          }),
        }]
      : undefined;
    return {
      result: mu, unit: '/day',
      secondary: [
        { key: 'doubling_time', value: Number.isFinite(doubling) ? doubling : Number.NaN, unit: 'days', label: 'Population Doubling Time (ln2/μ)' },
        { key: 'q10', value: Number.isFinite(Q10) ? Q10 : Number.NaN, unit: '—', label: 'Q₁₀ (factor per 10 °C)' },
        { key: 'envelope_mu', value: Number.isFinite(muPaper) ? muPaper : Number.NaN, unit: '/day', label: 'Eppley Envelope μmax (0.59·e^0.0633T)' },
      ],
      series,
      steps,
    };
  },
  63: ({ rho, cp, Ts, Ta, ra, rs, es, ea, p }) => {
    // SiB big-leaf surface fluxes (Sellers, Mintz, Sud & Dalcher 1986,
    // J. Atmos. Sci. 43(6):505–531, Table 1c — the electrical-analogy fluxes):
    //   H = (T_s − T_a)·ρ·c_p / r_a
    //   LE = (e*(T_s) − e_a)·ρ·c_p / (γ·(r_a + r_s)),  γ = c_p·p/(0.622·L_v)
    // The paper's ρc_p/γ factor (NOT ρ·L_v) is the SI-equivalent of the
    // psychrometric scaling; omitting 0.622·p⁻¹ inflates LE by ~p/0.622.
    const Lv = 2.45e6;
    const gamma = cp * (p ?? 1013.25) / (0.622 * Lv);  // hPa/K
    const H = rho * cp * (Ts - Ta) / ra;
    const le = (es - ea) * rho * cp / (gamma * (ra + rs));
    const total = H + le;
    const bowen = le > 0 ? H / le : NaN;
    const steps = [
      '── SiB Big-Leaf Surface Fluxes (Sellers et al. 1986, JAS 43(6):505–531) ──',
      'Paper Table 1c: H = (T_s−T_a)·ρc_p/r_a ;  LE = (e*(T_s)−e_a)·ρc_p/(γ·(r_a+r_s))',
      `  γ (psychrometric) = c_p·p/(0.622·L_v) = ${cp.toFixed(0)}×${(p ?? 1013.25).toFixed(0)}/(0.622×${Lv.toExponential(1)}) = ${gamma.toFixed(3)} hPa/K`,
      `Air density ρ = ${rho.toFixed(3)} kg/m³, c_p = ${cp.toFixed(0)} J/kg·K`,
      `Surface T_s = ${Number.isFinite(Ts) ? Ts.toFixed(1) + ' °C' : 'NaN — supply'}, Air T_a = ${Number.isFinite(Ta) ? Ta.toFixed(1) + ' °C' : 'NaN'}`,
      `Aerodynamic resistance r_a = ${Number.isFinite(ra) ? ra.toFixed(1) + ' s/m' : 'NaN — supply'}, Surface resistance r_s = ${Number.isFinite(rs) ? rs.toFixed(1) + ' s/m' : 'NaN — supply'}`,
      `Saturation vapour pressure e_s = ${Number.isFinite(es) ? es.toFixed(2) + ' hPa' : 'NaN'}, Actual e_a = ${Number.isFinite(ea) ? ea.toFixed(2) + ' hPa' : 'NaN'}`,
    ];
    if (![rho, Ts, Ta, ra, rs, es, ea].every(Number.isFinite) || ra <= 0) {
      return {
        result: Number.NaN, unit: 'W/m²',
        steps: [
          ...steps,
          'Required: ρ, T_s, T_a, r_a, r_s, e_s, e_a (all finite).',
          '  Honest NaN autos — no open point API supplies canopy temperature or resistances.',
          '  Genuine derivables auto-fill: T_a (Open-Meteo), e_a (from T_a+RH, Magnus),',
          '  ρ (ideal gas ρ = p/(R·T) from surface pressure), γ from pressure.',
        ],
      };
    }
    steps.push(
      '',
      'Step 1 — Sensible heat flux:',
      `  H = ρ·c_p·(T_s − T_a)/r_a = ${rho.toFixed(3)}×${cp.toFixed(0)}×(${Ts.toFixed(1)}−${Ta.toFixed(1)})/${ra.toFixed(1)} = ${H.toFixed(1)} W/m²`,
      '',
      'Step 2 — Latent heat flux (paper form with psychrometric constant):',
      `  LE = (e_s − e_a)·ρ·c_p/(γ·(r_a + r_s))`,
      `  LE = (${es.toFixed(2)} − ${ea.toFixed(2)})×${rho.toFixed(3)}×${cp.toFixed(0)}/(${gamma.toFixed(3)}×(${ra.toFixed(1)} + ${rs.toFixed(1)}))`,
      `  LE = ${le.toFixed(1)} W/m²  (≈ ${(le * 86400 / Lv).toFixed(2)} mm/day)`,
      '',
      'Step 3 — Total turbulent flux & Bowen ratio:',
      `  H + LE = ${H.toFixed(1)} + ${le.toFixed(1)} = ${total.toFixed(1)} W/m²`,
      `  Bowen ratio β = H/LE = ${bowen.toFixed(3)} (${bowen < 0.2 ? 'wet surface — evaporation dominated' : bowen < 1 ? 'mixed regime' : 'dry surface — sensible heating dominated'})`,
      '',
      `  └ Net radiation Rₙ should approximately balance H + LE + G at the surface`,
      `  └ Units: e in hPa, γ in hPa/K (paper uses mb ≡ hPa); ρc_p/γ ≡ ρ·L_v·0.622/p.`,
    );
    return {
      result: le, unit: 'W/m²',
      secondary: [
        { key: 'sensible_heat', value: Number.isFinite(H) ? H : Number.NaN, unit: 'W/m²', label: 'Sensible Heat Flux H' },
        { key: 'bowen_ratio', value: Number.isFinite(bowen) ? bowen : Number.NaN, unit: '—', label: 'Bowen Ratio (H/LE)' },
      ],
      steps,
    };
  },

  // ── Domain 9: Atmospheric Chemistry ──
  // Chapman (1930) "A theory of upper-atmospheric ozone", Mem. R. Meteorol. Soc. 3(26):103-125.
  // Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):
  //   O₂ + hν → 2O       rate J₁[O₂]    (λ < 242 nm)
  //   O + O₂ → O₃        rate k₂[O][O₂] (third body M, effective bimolecular)
  //   O₃ + hν → O₂ + O   rate J₃[O₃]    (240-320 nm)
  //   O + O₃ → 2O₂       rate k₄[O][O₃]
  // Steady state d[O]/dt = d[O₃]/dt = 0 ⇒ the paper's ratio result:
  //   [O₃]/[O₂] = √(J₁·k₂ / (J₃·k₄))   and   [O] = J₁[O₂]/(k₄[O₃])
  64: ({ J1, k2, J3, k4, O2 }) => {
    const hasRates = [J1, k2, J3, k4].every(Number.isFinite);
    if (!hasRates) {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Chapman Ozone Photochemistry (Chapman, 1930) ──',
          'Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):',
          '  O₂ + hν → 2O        rate J₁·[O₂]   (λ < 242 nm)',
          '  O + O₂ → O₃         rate k₂·[O][O₂] (third body M)',
          '  O₃ + hν → O₂ + O    rate J₃·[O₃]   (240–320 nm)',
          '  O + O₃ → 2O₂        rate k₄·[O][O₃]',
          '',
          'Steady state (d[O]/dt = d[O₃]/dt = 0) ⇒ [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))',
          '',
          `  J₁ (O₂ photolysis, s⁻¹): ${Number.isFinite(J1) ? J1.toExponential(2) : 'NaN — environmental actinic-flux input (CAMS EAC4 photolysis or a TUV model; no open point API this session) — supply explicitly'}`,
          `  k₂ (O+O₂→O₃, cm³/molecule·s): ${Number.isFinite(k2) ? k2.toExponential(2) : 'NaN — supply'} (JPL 2023 effective bimolecular, 1 atm / 298 K — physical constant)`,
          `  J₃ (O₃ photolysis, s⁻¹): ${Number.isFinite(J3) ? J3.toExponential(2) : 'NaN — same actinic-flux source as J₁ — supply explicitly'}`,
          `  k₄ (O+O₃→2O₂, cm³/molecule·s): ${Number.isFinite(k4) ? k4.toExponential(2) : 'NaN — supply'} (JPL 2023, 298 K — physical constant)`,
          `  [O₂] (molecules/cm³): ${Number.isFinite(O2) ? O2.toExponential(2) : 'NaN — altitude-dependent number density — supply for absolute [O₃] and [O]'}`,
          '',
          'Result is NaN: the paper requires photolysis-rate inputs (J₁, J₃), which are',
          'environmental data no authentic open point source serves here — supply J₁ and J₃ to compute.',
        ],
      };
    }
    const R = Math.sqrt((J1 * k2) / (J3 * k4));
    const mixPpmv = R * 1e6;
    const o3Conc = Number.isFinite(O2) ? R * O2 : Number.NaN;
    const oConc = Number.isFinite(o3Conc) && o3Conc > 0 ? (J1 * O2) / (k4 * o3Conc) : Number.NaN;
    return {
      result: R, unit: '—',
      secondary: [
        { key: 'o3_mixing_ratio', value: mixPpmv, unit: 'ppmv', label: 'Photochemical-equilibrium O₃/O₂ mixing ratio' },
        { key: 'o3_concentration', value: o3Conc, unit: 'molecules/cm³', label: 'Steady-state O₃ number density' },
        { key: 'o_concentration', value: oConc, unit: 'molecules/cm³', label: 'Steady-state O atom number density' },
      ],
      steps: [
        '── Chapman Ozone Photochemistry (Chapman, 1930) ──',
        'Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):',
        '  O₂ + hν → 2O        rate J₁·[O₂]   (λ < 242 nm)',
        '  O + O₂ → O₃         rate k₂·[O][O₂] (third body M)',
        '  O₃ + hν → O₂ + O    rate J₃·[O₃]   (240–320 nm)',
        '  O + O₃ → 2O₂        rate k₄·[O][O₃]',
        '',
        `J₁ = ${J1.toExponential(2)} s⁻¹, k₂ = ${k2.toExponential(2)} cm³/molecule·s, J₃ = ${J3.toExponential(2)} s⁻¹, k₄ = ${k4.toExponential(2)} cm³/molecule·s`,
        '',
        'Step 1 — Steady state of O (d[O]/dt = 0):',
        '  2J₁[O₂] + J₃[O₃] = k₂[O][O₂] + k₄[O][O₃]',
        '',
        'Step 2 — Steady state of O₃ (d[O₃]/dt = 0):',
        '  k₂[O][O₂] = J₃[O₃] + k₄[O][O₃]',
        '',
        'Step 3 — Equate and eliminate [O] (paper exercise 3 — [O₂] drops out):',
        `  k₄[O][O₃] = J₁[O₂]  ⇒  [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))`,
        `  = √(${J1.toExponential(2)} × ${k2.toExponential(2)} / (${J3.toExponential(2)} × ${k4.toExponential(2)}))`,
        `  = ${R.toExponential(4)}  (≈ ${mixPpmv.toExponential(3)} ppmv O₃ relative to O₂)`,
        '',
        ...(Number.isFinite(o3Conc) ? [
          'Step 4 — Absolute steady-state concentrations (paper: [O] = J₁[O₂]/(k₄[O₃])):',
          `  [O₃] = R × [O₂] = ${R.toExponential(4)} × ${O2.toExponential(2)} = ${o3Conc.toExponential(3)} molecules/cm³`,
          `  [O]  = J₁[O₂]/(k₄[O₃]) = ${J1.toExponential(2)} × ${O2.toExponential(2)} / (${k4.toExponential(2)} × ${o3Conc.toExponential(3)}) = ${oConc.toExponential(3)} molecules/cm³`,
        ] : ['Step 4 — [O₂] not supplied; absolute [O₃] and [O] omitted (supply [O₂] number density).']),
        '',
        `  └ ${R > 1e-5 ? 'Production-dominant regime (elevated photochemical O₃)' : R > 1e-7 ? 'Typical stratospheric equilibrium (1–10 ppmv O₃)' : 'Destruction-dominant regime (low O₃)'}`,
        `  └ Chapman alone overestimates observed O₃ (~2×) because catalytic NOₓ/HOₓ/ClOₓ cycles are omitted (the paper predates their discovery).`,
        `  └ k₂, k₄ from the NASA/JPL 2023 evaluation (Burkholder et al., JPL Pub. 19-5): k₂(eff, 1 atm, 298 K) = 1.43e-14, k₄(298 K) = 8.0e-12·exp(−2060/T).`,
      ],
    };
  },
  // Atkinson (2000), "Atmospheric chemistry of VOCs and NOₓ", Atmos. Environ.
  // 34(12-14):2063-2101. Lifetime vs the OH radical: τ = 1/(k·[OH]) with the
  // paper's [OH] conventions: 24-h global mean 1.0×10⁶ molecule cm⁻³
  // (Prinn et al. 1995, cited in the paper) or the 12-h daytime average
  // 2.0×10⁶ used for Table 1. k is the species-specific 298 K bimolecular
  // rate constant (laboratory-measured physical constant — user supplies;
  // paper Table 1 + §4.5 give species lifetimes for cross-checking).
  65: ({ k, OH }) => {
    const hasInputs = Number.isFinite(k) && Number.isFinite(OH);
    if (!hasInputs || k <= 0 || OH <= 0) {
      return {
        result: Number.NaN, unit: 's',
        steps: [
          '── OH Oxidation Lifetime (Atkinson, 2000) ──',
          'τ = 1/(k_OH·[OH]) — pseudo-first-order loss vs the hydroxyl radical.',
          '',
          `  k_OH (cm³/molecule·s, 298 K): ${Number.isFinite(k) ? k.toExponential(2) : 'NaN — species-specific measured rate constant; no open point API — supply (e.g. isoprene 1.0e-10, CH₄ 2.45e-15, CO 1.5e-13)'}`,
          `  [OH] (molecules/cm³): ${Number.isFinite(OH) ? OH.toExponential(2) : 'NaN — supply, or use the paper\'s global mean 1.0e6 (24-h) / 2.0e6 (12-h daytime, Table 1)'}`,
          '',
          ...(Number.isFinite(k) && Number.isFinite(OH) && (k <= 0 || OH <= 0)
            ? ['Result is NaN: rate constants and concentrations are strictly positive — a non-positive value is physically degenerate.']
            : ['Result is NaN: both k_OH (species-specific, user supplies) and [OH] are required.']),
        ],
      };
    }
    const kPrime = k * OH;
    const tau = 1 / kPrime;
    const tauDays = tau / 86400;
    const tauYrs = tau / 3.1536e7;
    return {
      result: tau, unit: 's',
      secondary: [
        { key: 'pseudo_first_order', value: kPrime, unit: 's⁻¹', label: 'Pseudo-first-order loss rate k·[OH]' },
        { key: 'lifetime_days', value: tauDays, unit: 'day', label: 'Lifetime in days' },
        { key: 'lifetime_years', value: tauYrs, unit: 'yr', label: 'Lifetime in years' },
      ],
      steps: [
        '── OH Oxidation Lifetime (Atkinson, 2000) ──',
        `Rate constant k_OH = ${k.toExponential(2)} cm³/molecule·s`,
        `OH radical concentration [OH] = ${OH.toExponential(2)} molecules/cm³`,
        '',
        'Step 1 — Pseudo-first-order rate:',
        `  k' = k_OH × [OH] = ${k.toExponential(2)} × ${OH.toExponential(2)} = ${kPrime.toExponential(3)} s⁻¹`,
        '',
        'Step 2 — Atmospheric lifetime:',
        `  τ = 1/k' = 1 / ${kPrime.toExponential(3)} = ${tauYrs > 1 ? tauYrs.toFixed(1) + ' yr (' + tau.toExponential(2) + ' s)' : tauDays > 1 ? tauDays.toFixed(2) + ' days (' + tau.toFixed(0) + ' s)' : tau.toFixed(0) + ' s'}`,
        '',
        `  └ Classification: ${tauYrs > 1 ? 'Long-lived (>1 yr) — well-mixed, global impact (e.g. CH₄ 12.9 yr, N₂O)' : tauDays > 1 ? 'Intermediate (days−year) — hemispheric transport (e.g. CO ~2.5 months)' : tau > 3600 ? 'Moderate (hours−days) — local/regional (e.g. VOCs)' : 'Short-lived (<hour) — highly reactive (e.g. isoprene 1.4 h @ 2.0e6)'}`,
        `  └ [OH] conventions (paper §1.4): 24-h global mean = 1.0 × 10⁶ molecule cm⁻³ (Prinn et al. 1995); 12-h daytime average = 2.0 × 10⁶ (Table 1 lifetimes). Peak daytime ground-level (2–10) × 10⁶.`,
        `  └ Paper Table 1 cross-check (12-h daytime [OH] = 2.0 × 10⁶): isoprene 1.4 h, ethene 1.4 day, propane 10 day, benzene 9.4 day, acetone 53 day, methanol 12 day.`,
      ],
    };
  },

};
