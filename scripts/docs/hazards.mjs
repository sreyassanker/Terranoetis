// ═══════════════════════════════════════════════════════════════════════
// Structured, source-cited data for the seven hazard capability pages.
// Every number below traces to a file:line in this repository and, where
// marked MEASURED, to an executed run (see ../methodology.html#evidence-runs).
// ═══════════════════════════════════════════════════════════════════════
import { src, srcRaw, tagMeasured } from './site.mjs';

const E = 'kaggle-kernels/earthquake-sim/main.py';
const F = 'kaggle-kernels/fire-sim/main.py';
const D = 'kaggle-kernels/flood-sim/main.py';
const H = 'kaggle-kernels/hurricane-sim/main.py';
const T = 'kaggle-kernels/tsunami-sim/main.py';
const SV = 'kaggle-kernels/tsunami-sim/swe_solver.py';
const V = 'kaggle-kernels/volcano-sim/main.py';
const L = 'kaggle-kernels/landslide-sim/main.py';
const C = 'src/services/kaggleSim.ts';
const SE = 'src/components/scenarios/ScenarioEditor.tsx';
const SR = 'server/kaggle/simRunner.ts';
const RT = 'server/kaggle/routes.ts';

const gridNote = `Every run shares these wire fields: <code>lat</code>, <code>lon</code> (study-box centroid), <code>grid_size</code> (int 64–2048) and <code>extent_km</code> (≤ 40,000) ${src(C, '20-24,417-422')}. The editor hard-codes <code>grid_size: 256</code> — no grid selector exists in the UI ${src(SE, '350,465,511,544')}. Wind speeds shown in the UI in km/h are divided by 3.6 before the wire ${src(C, '434,441,501')}.`;

export const COMMON_GRID_SECTION = {
  kind: 'table', caption: 'Shared request envelope (validated at the client boundary before dispatch)',
  cols: ['Wire field', 'Type / bounds', 'Meaning', 'Source'],
  rows: [
    ['<code>type</code>', 'one of 7 scenario literals', 'Selects the discriminated-union branch', src(C, '28-240')],
    ['<code>lat</code>, <code>lon</code>', '−90…90 / −180…180', 'Study-box centroid (georeference; kernels use them only as metadata or for Coriolis)', src(C, '20-21')],
    ['<code>grid_size</code>', 'int 64…2048 (UI fixed 256)', 'Square cell count per side', src(C, '22')],
    ['<code>extent_km</code>', '&gt; 0 … 40,000', 'Square domain side length, centred on the bbox centroid; ≥ 1 km floor', src(C, '23,263-272')],
  ],
};

export const HAZARDS = {
  // ═══════════════════════════════ EARTHQUAKE ════════════════════════════
  earthquake: {
    path: 'capabilities/earthquake.html',
    title: 'Earthquake ground motion (BSSA14 GMPE ShakeMap)',
    desc: 'Scenario ShakeMap: Boore–Stewart–Seyhan–Atkinson NGA-West2 ground-motion prediction equation with linear + nonlinear site response and USGS instrumental intensity, computed locally on CPU.',
    wireType: 'earthquake_swarm',
    proseMd: 'earthquake.md',
    mode: 'Local CPU (python3) — no Kaggle token required',
    status: 'MEASURED — executed directly and end-to-end through the job API',
    runCite: `${src(SR, '126-141')} (LOCAL_SIM_TYPES)`,
    intro: `The scenario is a 2D seismic-hazard computation, not a wave-physics animation: the kernel evaluates the median ground-motion prediction equation (GMPE) of Boore, Stewart, Seyhan &amp; Atkinson (NGA-West2 base case, BSSA14 / PEER 2013/05) on a regular grid around a user-pinned epicentre, applies linear and nonlinear site response for the chosen Vs30, converts to Modified Mercalli Intensity with the USGS instrumental rules, and writes PGA / PGV / Sa(1 s) / MMI grids plus an animated PGA series timed by S-wave arrival.`,
    headerQuote: {
      quote: `PGA, PGV and Sa(1.0 s): the Boore, Stewart, Seyhan & Atkinson NGA-West2 GMPE (BSSA14; PEER 2013/05, published as Boore et al. 2014, BSSA 104(2), doi:10.1785/0120130065). … ln Y = FE(M,mech) + FP(R,M) + FS(VS30,M,R) with the full linear + nonlinear site response; unspecified fault mechanism; base-case (no regional anelastic / basin-depth terms). Validity: M 3-9.7, shallow crustal, VS30 150-1500 m/s.`,
      cite: src(E, '14-21'),
    },
    equations: [
      { formula: 'R = R_hyp = sqrt(R_epi² + depth²)          [km]', caption: 'Point-source hypocentral distance (no fault-geometry Rjb/Rrup terms).', cite: src(E, '12,272-273') },
      { formula: 'ln Y = FE(M) + FP(R, M) + FS(VS30, M, R)   [ln of cm/s² or cm/s]', caption: 'BSSA14 additive form for PGA, PGV and Sa(1.0 s).', cite: src(E, '72-81,102-124') },
      { formula: 'FE = e0 + e4·(M−Mh) + e5·(M−Mh)²   (M ≤ Mh);  FE = e0 + e6·(M−Mh)   (M > Mh)', caption: 'Magnitude scaling, base case (unspecified mechanism — fault-type terms e1–e3 are stored but unused).', cite: src(E, '109-113,85-93') },
      { formula: 'FP = [c1 + c2·(M−Mref)]·ln(R/Rref) + c3·(R−Rref)', caption: 'Attenuation; R floored at 0.1 km.', cite: src(E, '108,115') },
      { formula: 'lnFlin = c·ln(min(VS30, Vc)/Vref);  lnFnl = f1 + f2·ln((PGA_r+f3)/f3),  f2 = f4·[exp(f5·(min(VS30,760)−360)) − exp(f5·(760−360))]', caption: 'Linear + nonlinear site response; PGA_r is the Vs30 = 760 m/s reference-rock PGA.', cite: src(E, '120-129,94-99') },
      { formula: 'MMI = max(MMI_PGA, MMI_PGV)                [unitless, 1…10]', caption: 'USGS instrumental intensity: Worden et al. 2012 (doi:10.1785/0120110156) + global GMICE Caprio et al. 2015 (doi:10.1785/0120140286).', cite: src(E, '23-25,144-153,282') },
    ],
    coefficients: {
      caption: 'BSSA14 base-case coefficients, read from the PEER 2013/05 appendix tables. Order e0,e1,e2,e3,e4,e5,e6,Mh,c1,c2,c3,Mref,Rref,h.',
      cols: ['IM', 'e0', 'e4', 'e5', 'e6', 'Mh', 'c1', 'c2', 'c3', 'Mref', 'Rref', 'h'],
      rows: [
        ['PGA', '0.4473', '1.431', '0.05053', '−0.1662', '5.5', '−1.134', '0.1917', '−0.00809', '4.5', '1.0', '4.5'],
        ['PGV', '5.037', '1.073', '−0.1536', '0.2252', '6.2', '−1.243', '0.1489', '−0.00344', '4.5', '1.0', '5.3'],
        ['Sa(1 s)', '0.3932', '1.5004', '−0.18983', '0.17895', '6.2', '−1.193', '0.10248', '−0.00121', '4.5', '1.0', '5.74'],
      ],
      cite: src(E, '85-93'),
    },
    siteCoeffs: {
      caption: 'Site-response coefficients (c, Vc, Vref, f1, f3, f4, f5); reference rock VS30_REF = 760 m/s.',
      cols: ['IM', 'c', 'Vc', 'Vref', 'f1', 'f3', 'f4', 'f5'],
      rows: [
        ['PGA', '−0.5150', '925.00', '760.0', '0.0', '0.1', '−0.1500', '−0.00701'],
        ['PGV', '−0.8050', '950.00', '760.0', '0.0', '0.1', '−0.1000', '−0.00844'],
        ['Sa(1 s)', '−1.0361', '967.51', '760.0', '0.0', '0.1', '−0.1052', '−0.00844'],
      ],
      cite: src(E, '83,94-99'),
    },
    mmiTables: {
      caption: 'MMI upper bounds used by the intensity mapping. PGA in g; PGV bounds in cm/s (medians also tabulated).',
      cols: ['Quantity', 'Values'],
      rows: [
        ['PGA upper bounds, MMI 2…10 [g]', '<code>0.000464, 0.00135, 0.00297, 0.0276, 0.115, 0.215, 0.401, 0.747, 1.39</code>'],
        ['PGV upper bounds, MMI 2…10 [cm/s]', '<code>0.0215, 0.135, 1.41, 4.65, 9.64, 20.0, 41.4, 85.8, 178.0</code>'],
        ['PGV medians, MMI 1…10 [cm/s]', '<code>0.010, 0.054, 0.437, 2.56, 6.70, 13.9, 28.8, 59.6, 123.6, 267.0</code>'],
      ],
      cite: src(E, '150-153'),
    },
    paramsCaption: 'Earthquake parameters: UI control → wire field → unit → valid range → default → physical meaning.',
    params: [
      ['Mag (mainshock) <span class="cite">slider</span>', '<code>magnitude</code>', 'M (moment/local)', 'UI 3.0–9.5 step 0.1, default 8.0; wire 3.0–9.7; kernel raises outside 3.0–9.7', 'UI 8.0 · kernel 6.5', 'Mainshock magnitude driving GMPE magnitude scaling', `${src(SE, '62-68')} ${src(C, '94')} ${src(E, '238,244-245')}`],
      ['Depth (mainshock) <span class="cite">slider</span>', '<code>depth_km</code>', 'km', 'UI 1–300 (auto-overwritten to clamp(5, 50, 5·M) by the form derivation); wire 0.5–700; kernel validates 0.5–700', 'UI 30 · kernel 12', 'Hypocentral depth; enters R_hyp', `${src(SE, '62-68')} ${src(C, '95,600')} ${src(E, '239,246-247')}`],
      ['Site Vs30 (NEHRP) <span class="cite">slider</span>', '<code>vs30</code> (optional)', 'm/s', '150–1500 step 10', '760', 'Time-averaged shear velocity to 30 m; drives linear + nonlinear site amplification', `${src(SE, '62-68')} ${src(C, '97')} ${src(E, '242,248-249')}`],
      ['Min Magnitude / Min Depth <span class="cite">sliders</span>', '— (not sent)', 'M / km', '1–8 / 0–100', '2.5 / 5', 'Catalog context shown in the panel; the wire carries only the mainshock pair', `${src(SE, '62-68')} ${src(C, '455-464')}`],
      ['Epicentre (globe click)', '<code>epi_frac_x</code>, <code>epi_frac_y</code> (optional)', 'fraction of box', '0–1, clamped', '0.5, 0.5', 'Column = x eastward, row = y southward; GMPE distance field radiates from this cell', `${src(C, '98-106')} ${src(E, '262-267')}`],
    ],
    outputs: [
      ['<code>pga_cm_s2.npy</code>', 'cm/s²', 'Peak ground acceleration grid (median prediction)', src(E, '409-420')],
      ['<code>pgv_cm_s.npy</code>', 'cm/s', 'Peak ground velocity grid', src(E, '409-420')],
      ['<code>sa_1s_cm_s2.npy</code>', 'cm/s²', '5 %-damped spectral acceleration at T = 1.0 s', src(E, '409-420')],
      ['<code>mmi.npy</code>', 'MMI 1–10 (float)', 'Instrumental Modified Mercalli intensity grid (max of PGA- and PGV-derived)', src(E, '282,409-420')],
      ['<code>snapshots_pga.npy</code> + <code>snapshot_times.npy</code>', 'cm/s²; s', 'PGA reveal frames timed by S-arrival (t = R_hyp / Vs, Vs = 3.5 km/s, smoothstep onset)', src(E, '297-314,303')],
      ['<code>metadata.json</code>', '—', 'params (incl. cell_size_m, epi fracs), model/source strings, final_stats, validation results', src(E, '319-335,425-433')],
    ],
    validity: {
      quote: `'point-source hypocentral distance used for the GMPE Rjb term — no fault-geometry directivity or finite-rupture effects' · 'unspecified fault mechanism; base-case only (no regional anelastic attenuation or basin-depth z1 terms)' · 'Sa reported at T=1.0 s only' · 'Worden-2012/Caprio-2015 intensity relations calibrated on California/global datasets and saturate for great-earthquake near-fields'`,
      cite: src(E, '344-353'),
    },
    gate: `Before emitting any field the kernel runs a GMPE sanity gate (attenuation monotonicity, M6.5 @ 10 km PGA in (100, 500) cm/s², soft-site amplification &gt; 1, PGV/PGA ratio 0.05–0.2 s, MMI band round-trip). On failure it refuses to emit: <em>"GMPE sanity gate failed — refusing to emit a ShakeMap from mis-wired attenuation relations."</em> ${src(E, '194-232,400-404')}`,
    measured: [
      ['Kernel, M 7.5 · 12 km · Vs30 760 · 100 km box · 256²', 'max PGA 251.0 cm/s², max PGV 27.5 cm/s, max MMI 7.0, area(MMI ≥ 6) 4,439 km²; kernel compute 0.0083 s; total wall 0.12 s (incl. interpreter start)'],
      ['Boundary cases', 'M 3.0 / 0.5 km / Vs30 150 and M 9.7 / 700 km / Vs30 1500 both complete; M 2.9 rejected with "magnitude 2.9 outside the 3.0-9.7 GMPE validity range"; depth 750 km rejected with "depth_km 750.0 outside 0.5-700 km"'],
      ['End-to-end via POST /api/kaggle/simulate', 'job sim_44d5c7d7 (M 7.2, 128², 100 km box): status running→complete 166 ms after submission; result metadata cites "BSSA14 … doi:10.1785/0120130065"; grid + GeoTIFF endpoints returned HTTP 200 (296,648-byte npy; valid 128×128 TIFF)'],
      ['DOI resolvability', 'https://doi.org/10.1785/0120130065 responds 302 (resolvable) — observed 2026-09-09'],
    ],
    repro: `# 1) via the running server (same path the web UI uses):\nnpm run dev:server    # Express on :3001\n\ncurl -s -X POST http://localhost:3001/api/kaggle/simulate \\\n  -H 'Content-Type: application/json' -d '{\n    "type":"earthquake_swarm","lat":36.1,"lon":139.7,\n    "grid_size":128,"extent_km":100,"magnitude":7.2,\n    "depth_km":15,"vs30":760,"epi_frac_x":0.4,"epi_frac_y":0.5 }'\n# → {"jobId":"sim_…","status":"running","streamUrl":"/api/kaggle/simulate/…/stream"}\n\ncurl -s http://localhost:3001/api/kaggle/simulate/<jobId>/results\ncurl -s -o pga.npy http://localhost:3001/api/kaggle/simulate/<jobId>/grid/pga_cm_s2\n\n# 2) kernel directly (honours TERRANOETIS_OUT_DIR):\ncd kaggle-kernels/earthquake-sim && mkdir -p /tmp/eq && \\\n  echo '{"grid_size":128,"magnitude":7.5,"depth_km":12,"vs30":760,"extent_km":100}' > /tmp/eq/params.json && \\\n  (cd /tmp/eq && TERRANOETIS_OUT_DIR=/tmp/eq python3 <repo>/kaggle-kernels/earthquake-sim/main.py)`,
  },

  // ═══════════════════════════════ WILDFIRE ═══════════════════════════════
  wildfire: {
    path: 'capabilities/wildfire.html',
    title: 'Wildfire spread (Rothermel 1972 + Anderson 13)',
    desc: 'Rothermel surface-fire rate-of-spread over Anderson NFFL fuel models with Byram fireline intensity, Simard equilibrium moisture and stochastic directional spread, computed locally on CPU.',
    wireType: 'wildfire_spread',
    proseMd: 'wildfire.md',
    mode: 'Local CPU (python3) — no Kaggle token required',
    status: 'MEASURED — executed directly (3 parameter sets incl. boundary cases)',
    runCite: `${src(SR, '126-141')}`,
    intro: `The kernel is a surface-fire cellular spread model: Rothermel's (1972) rate-of-spread formulation over the Anderson (1982) thirteen NFFL fuel models, evaluated per cell from slope, aspect, midflame wind and moisture, then propagated with a wind/slope-elongated directional probability. Byram (1959) fireline intensity, Simard (1968) equilibrium moisture content and a simplified Albini (1979) spotting term accompany the front. It reports ROS in m/s and intensity in kW/m.`,
    headerQuote: {
      quote: `Rothermel (1972) surface fire rate-of-spread model over the Anderson (1982) 13 NFFL fuel models, with a directional (wind/slope-elongated) time-marching spread algorithm on a raster grid.\nPhysics references:\n  - Rothermel, R. C. (1972) USDA Forest Service RP INT-115.\n  - Anderson, H. E. (1982) USDA Forest Service GTR INT-122 (NFFL fuel models).\n  - Byram, G. M. (1959) fireline intensity I = H * w * R.`,
      cite: src(F, '1-10'),
    },
    equations: [
      { formula: 'R [ft/min] = K_ROS · I_R · ξ · (1 + φ_Ew + φ_Es) / (σ_b · ε · Q_ig)', caption: 'Rothermel core rate of spread; converted to m/s via ×0.3048/60.', cite: src(F, '327-339') },
      { formula: 'I_R = γ′ · (W_d·h_d·η_Md + W_l·h_l·η_Ml) · η_S', caption: 'Reaction intensity (air volume basis).', cite: src(F, '322-324') },
      { formula: "γ_max = σ^1.5 / (495.0 + 0.0594·σ^1.5);  A = clip(1/(4.774σ^0.1 − 7.27), 0.5, 3.0);  γ′ = γ_max·(β/β_opt)^A·exp(A(1−β/β_opt));  β_opt = 3.348·σ^−0.8189", caption: 'Optimum packing ratio and surface-to-volume heat-release skew.', cite: src(F, '284-290') },
      { formula: 'φ_Ew = C·U^B·(β/β_opt)^−E;  B = 0.02526·σ^0.54;  C = 7.47·exp(−0.133·σ^0.55);  E = 0.715·exp(−3.59e−4·σ)', caption: 'Wind term; U = effective midflame wind (vector sum of wind and up-slope component), ft/min per Rothermel.', cite: src(F, '293-310') },
      { formula: 'φ_Es = 5.275 · β^−0.3 · tan²θ', caption: 'Slope term (θ clipped to 0–45°; tan clipped at 89.9°).', cite: src(F, '297-299') },
      { formula: 'η_M = 1 − 2.59r + 5.11r² − 3.52r³  (r = M/FM, clipped [0,1]);  η_S = 0.174·S_e^−0.19;  ε = exp(−138/σ);  Q_ig = max(250 + 1116·M_d, 1) BTU/lb', caption: 'Moisture damping, mineral damping, effective heating number, ignition heat; live moisture-of-extinction floor per Rothermel 1972 eq. 88.', cite: src(F, '256-272,314-315,327') },
      { formula: 'I [kW/m] = H_eff · w_load · R[ft/min] · 0.0577', caption: 'Byram (1959) fireline intensity. The code comment records a prior unit error: "The previous code used 3.155e-3 kW/m, i.e. 18.3× too small — Byram (1959) is reproduced only with the full 0.0577 factor."', cite: src(F, '349-355') },
      { formula: 'P(ignition) = 1 − exp(−R_dir·Δt / dist)   per neighbour, 8-cell stencil', caption: 'Stochastic directional ignition; R_dir from the Anderson ellipse with eccentricity from LB = R_head/R_back ∈ [1,12].', cite: src(F, '342-347,589-593') },
      { formula: 'spot prob = min(0.6, 0.05 + 0.03·U);  spot distance = cell·(5 + 3·U)·U(0.5,2)  (downwind)', caption: 'Simplified Albini (1979) spotting ("both the leap distance and the ignition odds grow with midflame wind speed").', cite: src(F, '599-617') },
    ],
    coefficients: {
      caption: 'Rothermel constants and K_ROS self-calibration. At import the kernel computes the raw (K=1) fm2 no-wind/no-slope ROS and scales it so the published FARSITE reference 0.105 m/s (8 % dead-fuel moisture) is reproduced; every other coefficient stays tabulated.',
      cols: ['Name', 'Value', 'Meaning', 'Source'],
      rows: [
        ['K_ROS_TARGET_FM2', '0.105 m/s', 'Published fm2 reference ROS used to calibrate the model-form constant', src(F, '365-371')],
        ['K_ROS (computed)', '29.90 in observed run', 'Only empirical freedom in the model (per code comment)', src(F, '374-387')],
        ['_ST, _SE, _RHO_P', '0.0555, 0.010, 32.0 lb/ft³', 'Stoichiometric excess, mineral damping, particle density', src(F, '120')],
        ['Live-fuel heats h1 = hl', '8000 BTU/lb', 'Rothermel/Anderson default live heat content', src(F, '122')],
        ['Simard EMC clip', '[0.01, 0.60]', 'Equilibrium dead-fuel moisture fraction bounds', src(F, '182-195')],
        ['Anderson 13 table', 'fm1…fm13 (w0, σ, depth, mx, h′)', 'Full published fuel-model coefficients', src(F, '117-148')],
      ],
    },
    paramsCaption: 'Wildfire parameters (UI keys → wire fields).',
    params: [
      ['Wind Speed <span class="cite">slider</span>', '<code>wind_speed_ms</code> = km/h ÷ 3.6', 'm/s', 'UI 0–120 km/h; wire 0–60 m/s', 'UI 20 km/h · kernel 10 m/s', 'Midflame wind input; also "blows FROM" per meteorological convention', `${src(SE, '77-88')} ${src(C, '62,441')} ${src(F, '396-397')}`],
      ['Wind Direction <span class="cite">slider</span>', '<code>wind_dir_deg</code>', '°, clockwise from N (FROM)', 'UI 0–360 step 5; wire 0–360', 'UI 270 · kernel 270', 'Spread vector uses dir+180°', `${src(SE, '77-88')} ${src(C, '63')} ${src(F, '302,397')}`],
      ['Relative Humidity <span class="cite">slider</span>', '<code>humidity_pct</code>', '%', 'UI 1–100; wire 0–100', 'UI 15 · kernel 20', 'Drives Simard EMC unless dead_moisture override given', `${src(SE, '77-88')} ${src(C, '64')} ${src(F, '398,479-481')}`],
      ['Fuel Type <span class="cite">select</span>', '<code>fuel_type</code>', 'grass|shrub|forest|urban', 'enum; mapped to Anderson fm 2/5/8/1', 'forest', 'Unknown strings rejected at the boundary', `${src(SE, '81-85')} ${src(C, '66,446-452')} ${src(F, '150-161')}`],
      ['Duration <span class="cite">slider</span>', '<code>duration_hours</code>', 'h', 'UI 1–168; wire ≤ 720', 'UI 72 · kernel 2', 'Simulation length', `${src(SE, '77-88')} ${src(C, '65')} ${src(F, '399')}`],
      ['Terrain (study-box sample)', '<code>terrain</code> + <code>terrain_gs</code>', 'm above ellipsoid', '≤ 65,536 cells; gs 2–256; server compacts to base64', '—', 'Real globe relief; kernel derives slope/aspect from it', `${src(C, '69-80')} ${src(SR, '456-495')}`],
      ['dead_moisture / live_moisture / temperature_c', 'same names (optional)', 'fraction; fraction; °C', '0–0.6; 0–2; −40…60', 'kernel: Simard-derived / fuel table / 25', 'Scientific overrides — not exposed as UI sliders (wire-only)', `${src(C, '81-85')} ${src(F, '404-405,409,479-481')}`],
    ],
    outputs: [
      ['<code>fire_state.npy</code>', '0 unburned · 1 burning · 2 burned', 'Final combustion state grid', src(F, '546,737')],
      ['<code>fire_intensity.npy</code>', '0…1 continuous', 'Per-cell combustion intensity (0.15 residual on burned)', src(F, '633-641,738')],
      ['<code>fuel_map.npy</code>', 'load multiplier 0–1.2', 'Per-cell fuel-load field', src(F, '220,739')],
      ['<code>terrain_slope.npy</code>', 'degrees', 'Slope grid (stored under final key "terrain")', src(F, '666,740')],
      ['<code>fireline_intensity_npy.npy</code>', 'kW/m', 'Byram intensity', src(F, '741')],
      ['<code>rate_of_spread_npy.npy</code>', 'm/s', 'Directional ROS field', src(F, '742')],
      ['<code>snapshots_state/intensity.npy</code> + <code>snapshot_times.npy</code>', '—; h', '20-frame animation series', src(F, '743-752')],
      ['<code>metadata.json</code>', '—', 'model "rothermel_anderson13", terrain_source, final burned stats', src(F, '680-685,759-764')],
    ],
    validity: {
      quote: `the kernel must never silently invent topography for a study area the user has already drawn on the globe · Previously fuel_type was silently dropped and every run used fm2. · slow-ROS fuels (e.g. fm8 forest-floor duff) … burned out before igniting anything — the fire stalled at the ignition cell. Residence = clamp(flame-flush, cell-backing-sweep, 240 min). · WUI structure fuels are outside the Anderson-13 system`,
      cite: src(F, '425-426,151-152,527-532,158-160'),
    },
    gate: `A non-fatal validation prints the no-wind/no-slope ROS of the active fuel against the 0.105 m/s reference (± 0.01) — "PASS" or "CHECK" ${src(F, '501-508')}. Wall-clock cap default 480 s bounds the march ${src(F, '407,568-570')}.`,
    measured: [
      ['Calibration fuel (fm2 grass, no wind)', 'ROS_nowind_noslope = 0.103 m/s vs reference 0.105 → PASS (observed stdout)'],
      ['Representative fm8 (forest) run: 128², 8 m/s, RH 20 %, 6 h, 40 km box, seed 42', 'K_ROS = 29.90; mean R = 0.370 m/s, max R = 0.503 m/s, mean I = 4,072 kW/m; burned 25 cells (0.15 % of grid); wall 1.06 s. [VALIDATE] prints "CHECK" for non-fm2 fuels because the reference applies to fm2 — expected behaviour, non-fatal.'],
      ['Boundary calm-humid (0 m/s wind, RH 100 %, grass)', 'Completes in 0.40 s; minimal advance (moisture damping η_M → 0 near saturation)'],
      ['Boundary hot-dry (15 m/s, RH 5 %, shrub, T = 40 °C, dead moisture 0.04)', 'Completes in 0.60 s; fire starts and advances'],
    ],
    repro: `curl -s -X POST http://localhost:3001/api/kaggle/simulate \\\n  -H 'Content-Type: application/json' -d '{\n    "type":"wildfire_spread","lat":34.5,"lon":-117.5,"grid_size":128,\n    "extent_km":40,"wind_speed_ms":8,"wind_dir_deg":270,\n    "humidity_pct":20,"duration_hours":6,"fuel_type":"forest","seed":42 }'\n\n# direct kernel run:\ncd /tmp && mkdir fire && cp <repo>/kaggle-kernels/fire-sim/main.py fire/ && cd fire && \\\n  echo '{"grid_size":64,"wind_speed_ms":0,"fuel_type":"grass","humidity_pct":15,"duration_hours":1,"extent_km":10,"seed":1}' > params.json && \\\n  TERRANOETIS_OUT_DIR=$PWD python3 main.py | grep VALIDATE`,
  },

  // ═══════════════════════════════ HURRICANE ══════════════════════════════
  hurricane: {
    path: 'capabilities/hurricane.html',
    title: 'Hurricane landfall (Holland 1980 wind + SWE surge + waves + rainfall + runoff)',
    desc: 'Parametric Holland gradient-wind field coupled to a 2D nonlinear shallow-water surge model with JONSWAP/SMB waves, Lonfat-2007 rainfall and SCS-CN runoff; local CPU kernel.',
    wireType: 'hurricane_landfall',
    proseMd: 'hurricane.md',
    mode: 'Local CPU (python3) — no Kaggle token required',
    status: 'MEASURED — executed directly (3 parameter sets incl. Cat 5 and Cat 1 boundaries); internal physics gate PASS observed',
    runCite: `${src(SR, '126-141')}`,
    intro: `The landfall scenario combines a parametric vortex wind field (Holland 1980 with the Atkinson–Hollan B estimate and Coriolis term, advected along a track that passes the pinned landfall point at mid-duration) with a depth-averaged nonlinear shallow-water surge solver forced by wind stress and bottom pressure, empirical wave growth (JONSWAP/Stokes–Moum–Bretschneider capped at Pierson–Moskowitz with USACE breaking/setup rules), Lonfat-shaped parametric rainfall, and USDA TR-55 SCS-CN runoff.`,
    headerQuote: {
      quote: `Wind: Holland (1980, MWR 108:1212) gradient-wind balance with Coriolis:\n    V(r) = sqrt( V_c^2 + (f·r/2)^2 ) − f·r/2,\n    V_c^2 = (B·Δp/ρ)·x·e^(−x),  x = (R_max/r)^B\nB from the observed Vmax–Δp relation (Atkinson & Hollan 2012, BAMS):\n    B = e·ρ·Vmax^2/Δp, clipped to [1.0, 2.5].`,
      cite: src(H, '10-14'),
    },
    equations: [
      { formula: 'V(r) = sqrt(V_c² + (f·r/2)²) − f·r/2,   V_c² = (B·Δp/ρ)·x·e^(−x),   x = (R_max/r)^B', caption: 'Holland gradient wind; r floored at 0.1 km; f = 2Ω·sin(lat), Ω = 7.2921159e-5 rad/s.', cite: src(H, '160-170,138-143,156') },
      { formula: 'p(r) = p_c + Δp·exp(−(R_max/r)^B)', caption: 'Holland pressure field; the inverse-barometer ocean response is implicit in the momentum forcing and is not re-added to the output.', cite: src(H, '20,154-157,27-29') },
      { formula: 'τ = ρ_a·C_d·|U|·U ÷ (ρ_w·h_stress),  C_d = 1.5e-3', caption: 'Wind stress on the surge; drag saturation per Powell et al. 2003 (BAMS); base value Large &amp; Pond 1981 (JPO 11:324). h_stress floored at 1 m.', cite: src(H, '25-27,519-529,108-110') },
      { formula: 'Manning n = 0.03 bottom friction, damping-limited to ±0.9|u|/dt; current cap 10 m/s', caption: 'Shelf/channel roughness constant.', cite: src(H, '549-560,111') },
      { formula: 'H_s = 1.6e−3 · U_A · √F,  U_A = 0.71·U10,  capped at H_s ≤ 0.0248·U_A²', caption: 'Fetch-limited JONSWAP/SMB growth with Pierson–Moskowitz fully-developed cap; USACE CEM EM 1110-2-1100 Part II-1.', cite: src(H, '30-36,117-119,173-182') },
      { formula: 'H_b = 0.78·d;  setup η_s ≈ 0.19·H_b', caption: 'Depth-limited breaking (γ = 0.78, USACE CEM Part II-1) and wave setup (USACE Eq. II-4-24 radiation-stress result).', cite: src(H, '35-38,112-116,501-502') },
      { formula: 'rate(r) = 1.2·Vmax · (r/r_peak) · ((500−r)/(500−r_peak))^1.5 mm/h,  r_peak = max(100 km, R_max),  0 beyond 500 km', caption: 'Lonfat et al. 2007 (JGR 112, doi:10.1029/2006JD007557 — as cited in code: MWR 135:3086) PHRaM/R-CLIPER-shaped footprint; validation reference Tuleya et al. 2007, WAF 22:56.', cite: src(H, '39-48,124-126,185-199') },
      { formula: 'Q = (P − 0.2S)² / (P + 0.8S),  S = (1000/CN − 10)·25.4 mm;  Q ≤ P', caption: 'USDA TR-55 SCS Curve Number runoff, applied incrementally; CN land: 77 (suburban) on land, 99 on water — of five coded CN values only these two are used by the terrain classifier.', cite: src(H, '49-51,131-136,202-209,426-427') },
    ],
    coefficients: {
      caption: 'Named constants (value — meaning — source).',
      cols: ['Constant', 'Value', 'Meaning / provenance', 'Source'],
      rows: [
        ['RHO_AIR', '1.15 kg/m³', 'Air density for stress/IB', src(H, '105')],
        ['RHO_WATER', '1025.0 kg/m³', 'Seawater density', src(H, '106')],
        ['G', '9.81 m/s²', 'Gravity', src(H, '107')],
        ['C_DRAG', '0.0015', 'Saturated high-wind drag (Powell 2003; Large & Pond 1981)', src(H, '108-110')],
        ['N_MANING', '0.03', 'Typical shelf/channel Manning n', src(H, '111')],
        ['GAMMA_BREAKER', '0.78', 'USACE CEM "(H/d)max = 0.78 agrees best with observations"', src(H, '112-113')],
        ['K_SETUP', '0.19', 'Wave setup coefficient (USACE Eq II-4-24)', src(H, '114-116')],
        ['JONSWAP_CH', '1.6e-3', 'SMB/JONSWAP fetch-growth coefficient', src(H, '117-118')],
        ['PM_LIMIT', '0.0248', 'Pierson–Moskowitz cap coefficient', src(H, '119')],
        ['cat_winds', '{1:43, 2:50, 3:58, 4:70, 5:90} m/s', 'Saffir–Simpson threshold wind per category', src(H, '351-352')],
        ['Ω (OMEGA_EARTH)', '7.2921159e-5 rad/s', 'Earth rotation for Coriolis', src(H, '138-143')],
      ],
    },
    paramsCaption: 'Hurricane parameters. Category drives derived pressure/radius via derivePhysicsFormOverrides.',
    params: [
      ['Saffir–Simpson Category <span class="cite">slider</span>', '<code>category</code>', 'cat (int)', 'UI &amp; wire 1–5', '3', 'Peak wind 43/50/58/70/90 m/s (kernel table)', `${src(SE, '69-76')} ${src(C, '140,604-612')} ${src(H, '351-352')}`],
      ['Forward Speed <span class="cite">slider</span>', '<code>forward_speed_kmh</code>', 'km/h', 'UI 5–60; wire 2–80', 'UI 15 · kernel 30', 'Track translation speed (asymmetric wind + accumulation)', `${src(SE, '69-76')} ${src(C, '141')} ${src(H, '342')}`],
      ['Central Pressure <span class="cite">slider</span>', '<code>central_pressure_hpa</code>', 'hPa', 'UI 880–1010 (overwritten to 1010−20·cat); wire 860–1020', 'UI 950 · kernel 960', 'Sets Δp, hence B and the whole radial profile', `${src(SE, '69-76')} ${src(C, '142,609')} ${src(H, '343')}`],
      ['Radius of Max Winds <span class="cite">slider</span>', '<code>radius_max_wind_km</code>', 'km', 'UI 10–200 (overwritten to max(20, 30+15·cat)); wire 5–300', 'UI 50 · kernel 50', 'Eyewall radius; needs ≤ ~R_max/2 cell size to be resolved', `${src(SE, '69-76')} ${src(C, '143,611')} ${src(H, '344')}`],
      ['Track Heading <span class="cite">slider + auto checkbox</span>', '<code>heading_deg</code> (optional)', '°, clockwise from N', 'UI 0–360 step 5; wire 0–360; omitted in auto mode', '270', 'Auto mode: kernel auto-aims the storm from the water centroid toward the pinned point', `${src(SE, '71-76,770-781')} ${src(C, '146-151,493')} ${src(H, '393-400')}`],
      ['Hours to Landfall <span class="cite">slider</span>', '<code>duration_hours</code> = 2 × landfallTime', 'h', 'UI 6–96 (wire ≤ 720)', 'UI 24', 'The eye crosses the pinned point at mid-duration, so the run spans equal approach + inland halves', `${src(SE, '69-76')} ${src(C, '144,477-494')} ${src(H, '376-381')}`],
      ['Landfall point (globe click)', '<code>track_frac_x/y</code> (optional)', 'fraction 0–1', 'clamped', '0.5, 0.5', 'Column = east, row = south; default box centre', `${src(C, '152-159')} ${src(H, '382-383')}`],
      ['Terrain (auto-sampled)', '<code>terrain</code> + <code>terrain_gs</code>', 'm (negative = below sea)', '≤ 65,536 cells', '—', 'Real relief/bathymetry replaces the synthetic coastal profile', `${src(C, '160-167')}`],
    ],
    outputs: [
      ['<code>wind_speed.npy</code>', 'm/s', 'Total 10 m wind (gradient + translation)', src(H, '724-745')],
      ['<code>wind_direction.npy</code>', 'rad', 'atan2 of east/north wind components', src(H, '724-745')],
      ['<code>surge_height.npy</code>', 'm', 'Composite water level: η + setup over ocean, inundation depth over land (NHC/USGS composite convention)', src(H, '612-615')],
      ['<code>wave_setup.npy</code> / <code>wave_height.npy</code>', 'm / m (Hs)', 'Setup and significant wave height', src(H, '724-745')],
      ['<code>rainfall.npy</code> / <code>runoff.npy</code>', 'mm (cumulative)', 'Rain accumulation and SCS-CN runoff', src(H, '582-591,724-745')],
      ['<code>inundation.npy</code>', 'm above ground', 'On-land flooding depth', src(H, '724-745')],
      ['<code>terrain.npy</code>', 'm', 'Effective terrain used', src(H, '724-745')],
      ['<code>snapshots_wind/surge.npy</code> + <code>snapshot_times.npy</code>', '—; h', '≈20-frame series', src(H, '724-745')],
      ['<code>metadata.json</code>', '—', 'model "holland_1980_wind + nonlinear_2d_swe_surge", physics/sources strings, limits', src(H, '654-674')],
    ],
    validity: {
      quote: `'point-vortex Holland field — no eyewall fine structure, constant Vmax (no intensification/decay)' · 'fetch = distance to nearest coast (upper-bound proxy)' · 'wave setup empirical (USACE Eq II-4-24, ≈0.19·H_b) — no wave propagation' · 'rainfall parametric surrogate of the Lonfat-2007 PHRaM radial structure (no shear/topography Fourier terms), not microphysical' · 'no tides, no river routing (backwater excluded)' · 'equirectangular grid — valid ≤ ~500 km domain'`,
      cite: src(H, '663-674'),
    },
    gate: `The kernel refuses to emit fields if its physics gate fails — <em>"Hurricane physics gate failed — refusing to emit fields from mis-wired parametric relations."</em> Checks: V(R_max) ≈ V_max ± 15 %, B ∈ [1, 2.5], inverse-barometer 0.9–1.1 cm/hPa, CN75 @ 100 mm in (30, 50) mm, SCS zero below 0.2 S, wave growth vs PM cap, rain peak 40–130 mm/h with zero eye/500 km. ${src(H, '285-335,717-720')}`,
    measured: [
      ['Physics gate (every run, observed stdout)', '"B=2.29 V(Rmax)=69.0 m/s (target 70) | IB=0.99 cm/hPa | CN75@100mm=41.1 mm | waves 18.0→31.3 cap 5.00 m | rain peak=84mm/h eye=0 edge=0 → PASS"'],
      ['Representative Cat 4 (950 hPa, 40 km RMW, 6 h, 240 km box)', 'max wind 77.0 m/s (right-front asymmetry above the 70 m/s threshold), coastal water 1.15 m, inundation 0.39 m, rainfall 482 mm, runoff 402 mm; wall 1.47 s'],
      ['Boundary Cat 5 with 5 km RMW on 2.5 km cells', 'max wind 32.2 m/s — eyewall under-resolved by the grid ("coarse-grid dilution"); a real Cat 5 wind requires RMW ≳ 2× cell size. Documented behaviour, not an error'],
      ['Boundary Cat 1 with 1020 hPa central pressure', 'max wind 1.6 m/s — Holland Δp floor (5 hPa) dominates; demonstrates that pressure, not category label, drives the field'],
    ],
    repro: `curl -s -X POST http://localhost:3001/api/kaggle/simulate \\\n  -H 'Content-Type: application/json' -d '{\n    "type":"hurricane_landfall","lat":25.0,"lon":-80.0,"grid_size":96,\n    "extent_km":240,"category":4,"forward_speed_kmh":30,\n    "central_pressure_hpa":950,"radius_max_wind_km":40,"duration_hours":6 }'\n\n# direct kernel:\ncd /tmp && mkdir h && cp <repo>/kaggle-kernels/hurricane-sim/main.py h/ && cd h && \\\n  echo '{"grid_size":96,"category":4,"central_pressure_hpa":950,"radius_max_wind_km":40,"forward_speed_kmh":30,"duration_hours":6,"extent_km":240}' > params.json && \\\n  TERRANOETIS_OUT_DIR=$PWD python3 main.py | grep VERIFY`,
  },

  // ═══════════════════════════════ FLOOD ══════════════════════════════════
  flood: {
    path: 'capabilities/flood.html',
    title: 'Flood inundation (local-inertial shallow water)',
    desc: 'Rainfall-driven 2D local-inertial shallow-water inundation with Audusse hydrostatic reconstruction, semi-implicit Manning friction and WorldCover-derived roughness; runs on Kaggle (GPU accelerator requested).',
    wireType: 'flood_inundation',
    proseMd: 'flood.md',
    mode: 'Kaggle kernel push→poll→download (numpy-only code; the kernel metadata requests the GPU accelerator)',
    status: 'PHYSICS MEASURED locally (solver completed; mass balance closure 0.0000 %)',
    runCite: `${src(SR, '126-141')} (not in LOCAL_SIM_TYPES) ${src('kaggle-kernels/flood-sim/kernel-metadata.json', 'enable_gpu=true')}`,
    intro: `Rainfall-runoff inundation over real (or, when no terrain is supplied, procedurally generated) topography. The solver is the local-inertial (diffusive-inertial) form of the 2D shallow-water equations with a uniform rainfall source — the approach family of LISFLOOD-FP, SFINCS and RIM2D — discretised with Rusanov (local Lax–Friedrichs) fluxes with Audusse hydrostatic reconstruction and a semi-implicit Bates-2010 Manning friction update.`,
    headerQuote: {
      quote: `Solves the 2D local-inertial (diffusive-inertial) shallow water equations with a spatially uniform rainfall source term — the approach used by LISFLOOD-FP, SFINCS, and RIM2D. … Solver: Rusanov (local Lax-Friedrichs) for continuity with hydrostatic reconstruction (Audusse et al. 2004), semi-implicit Bates (2010) formulation for Manning friction.`,
      cite: src(D, '5-20'),
    },
    equations: [
      { formula: '∂h/∂t = rainfall_rate − infiltration + flux divergence', caption: 'Continuity with rain source (h = surface water depth).', cite: src(D, '12,524-543') },
      { formula: '∂(hu)/∂t = −g·h·∇η − g·n²·u|u|/h^(4/3),   u_new = (u + dt·pressure) / (1 + dt·g·n²·|u|/h^(4/3))', caption: 'Local-inertial momentum with semi-implicit Manning friction (Bates 2010).', cite: src(D, '584-599') },
      { formula: 'infiltration = 10 mm/hr × (1 − 0.7·soil_saturation)', caption: 'Constant-loss rate labelled "Green-Ampt" in the source — a fixed base loss modulated by saturation, not the full Green–Ampt infiltration equation (no wetting-front redistribution). Labeled honestly here.', cite: src(D, '57,470-471') },
      { formula: 'n(cell) = WorldCover-class lookup; default 0.035', caption: 'Manning roughness from ESA WorldCover v200 class codes; roughness "from Chow (1959) + common flood-model lookup tables (LISFLOOD-FP / HEC-RAS)".', cite: src(D, '56,61-84') },
      { formula: 'dt = min(0.5·dx/(√(g·h_max)+V_MAX), 1.0 s),  V_MAX = 5 m/s', caption: 'Adaptive CFL with physical velocity cap; positivity-preserving face limiter with tracked clip-loss volume.', cite: src(D, '503-507,554-579,59') },
    ],
    coefficients: {
      caption: 'WorldCover v200 → Manning n lookup (class: n [s/m^1/3]).',
      cols: ['WorldCover class', '10', '20', '30', '40', '50', '60', '70', '80', '90', '95', '100'],
      rows: [['n', '0.100', '0.070', '0.035', '0.040', '0.015', '0.025', '0.025', '0.030', '0.060', '0.150', '0.050']],
      cite: src(D, '72-84'),
    },
    paramsCaption: 'Flood parameters.',
    params: [
      ['Total Rainfall <span class="cite">slider</span>', '<code>rainfall_mm</code>', 'mm (event total)', 'UI 50–2000; wire 10–3000; kernel applies unvalidated', 'UI 500 · kernel 400', 'Spatially uniform rain depth', `${src(SE, '102-108')} ${src(C, '34')} ${src(D, '372')}`],
      ['Soil Saturation <span class="cite">slider</span>', '<code>soil_saturation</code>', 'fraction', '0–1', 'UI 0.8 · kernel 0.8', 'Scales infiltration loss and initial ponded depth (h_init = 0.02·S)', `${src(SE, '102-108')} ${src(C, '36')} ${src(D, '374,485-486')}`],
      ['Duration <span class="cite">slider</span>', '<code>duration_hours</code>', 'h', 'UI 1–168 (auto-derived from rainfall/catchment); wire ≤ 720', 'UI 72 · kernel 12', 'Rain event length', `${src(SE, '102-108')} ${src(C, '35,640')} ${src(D, '373')}`],
      ['Wind Speed <span class="cite">slider</span>', '<code>wind_speed_ms</code> (optional) = km/h÷3.6', 'm/s', 'UI 0–100 km/h; wire 0–60', 'UI 40 km/h', 'Advisory field — not used in the solver momentum terms', `${src(SE, '102-108')} ${src(C, '38,434')}`],
      ['Catchment Area <span class="cite">slider</span>', '— (not sent)', 'km²', 'UI 100–20,000', '2000', 'UI-only hint for derived runoff/duration suggestions', `${src(SE, '102-108')} ${src(C, '631-641')}`],
      ['dam_breach', '<code>dam_breach</code>', '—', 'literal <code>true</code> required by the schema', 'true', 'Contract constant only — the kernel contains no dam-breach hydrograph; inundation is rainfall-driven', `${src(C, '37')}`],
      ['terrain / landcover (server-sampled)', '<code>terrain(+_gs)</code>, <code>landcover(+_gs)</code>', 'm; WorldCover codes', '≤ 65,536 cells each', 'auto', 'Server auto-samples land cover for flood runs when absent', `${src(C, '41-55')} ${src(SR, '520-563')}`],
    ],
    outputs: [
      ['<code>water_depth_final.npy</code>', 'm', 'Final flood depth', src(D, '789-807')],
      ['<code>velocity_x/y.npy</code>', 'm/s', 'Depth-averaged velocity', src(D, '789-807')],
      ['<code>terrain.npy</code>', 'm', 'Elevation used', src(D, '789-807')],
      ['<code>snapshots_depth.npy</code> + <code>snapshot_times.npy</code>', 'm; hours', 'Animation series', src(D, '789-807')],
      ['<code>metadata.json</code>', '—', 'model "local_inertial_swe", solver "bates_2010_semi_implicit", mass_balance block', src(D, '702-722,809-819')],
    ],
    validity: {
      quote: `'covers the entire DEM domain (not just valleys downstream of a breach)' · solver attribution: 'Rusanov (local Lax-Friedrichs) for continuity with hydrostatic reconstruction (Audusse et al. 2004), semi-implicit Bates (2010) formulation for Manning friction.' · boundary: 'the boundary can remove water but can never create it. (np.minimum = drain only.)' · truncation warning: '[WARNING] Simulation truncated at t=…h — results are partial'`,
      cite: src(D, '8-9,18-20,614-617,698-700'),
    },
    gate: `Two fatal conservation gates run before the simulation (each raises and aborts): a closed-box mass-conservation test (tol 1e-9) and a lake-at-rest well-balanced test (tol 1e-6, 10 % sloped bed): <em>"Water would spontaneously flow on sloped terrain."</em> ${src(D, '121-366,771-783')}`,
    measured: [
      ['Local direct run (64², 300 mm rain, 4 h, sat 0.8, 20 km box)', 'Solver completed: max depth 4.01 m, flooded 78.2 % of grid; mass balance rainfall 120.0 M m³, infiltration 7.04 M, outflow 7.73 M, clip-loss 0.000 M, closure error 0.0000 %; wall 7.5 s. Both conservation gates ran first (stdout).'],
      ['Minimum-rain edge (10 mm, 1 h)', 'max depth 0.00 m, flooded 0 % — infiltration absorbed all rainfall; closure 0.0000 %'],
      ['Output limitation observed', 'The npy/metadata write step fails off-Kaggle with "Read-only file system: \'/kaggle\'" because the output dir is hard-coded (main.py:786) — this is why flood is NOT in LOCAL_SIM_TYPES; the web pipeline runs it on Kaggle where /kaggle/working exists'],
    ],
    repro: `# Physics (computation) locally — output writing intentionally fails off-Kaggle:\ncd /tmp && mkdir fl && cp <repo>/kaggle-kernels/flood-sim/main.py fl/ && cd fl && \\\n  echo '{"grid_size":64,"rainfall_mm":300,"duration_hours":4,"soil_saturation":0.8,"extent_km":20,"wallclock_max_sec":120}' > params.json && \\\n  python3 main.py | grep -E "VERIFY|MASS BALANCE|DONE"\n\n# Full pipeline requires ~/.kaggle/kaggle.json (see deployment page):\ncurl -s -X POST http://localhost:3001/api/kaggle/simulate \\\n  -H 'Content-Type: application/json' -d '{"type":"flood_inundation","lat":29.76,"lon":-95.37,"grid_size":256,"extent_km":20,"rainfall_mm":300,"duration_hours":4,"soil_saturation":0.8,"dam_breach":true}'`,
  },

  // ═══════════════════════════════ TSUNAMI ════════════════════════════════
  tsunami: {
    path: 'capabilities/tsunami.html',
    title: 'Tsunami propagation (finite-volume SWE, HLL + minmod)',
    desc: 'Okada-style dislocation source over real GEBCO 2020 bathymetry with a nonlinear shallow-water HLL/minmod finite-volume solver. Includes this review\'s measured flat-bed stability and sloped-bed instability results.',
    wireType: 'tsunami_wave',
    proseMd: 'tsunami.md',
    mode: 'Kaggle kernel (numpy-only, CPU accelerator instance)',
    status: 'SOLVER MEASURED locally in-process (conservation gate PASS; flat-bed propagation stable; REAL-GEBCO runs diverge — see Known limitation)',
    runCite: `${src(SR, '126-141')} (not in LOCAL_SIM_TYPES) ${src(T, '228-229')}`,
    intro: `A tsunami scenario starts from a finite-fault seafloor displacement (simplified Okada-1985-in-spirit rectangular dip-slip patch with moment-magnitude scaling) and propagates the free surface with a nonlinear shallow-water finite-volume solver (MUSCL/minmod reconstruction, HLL fluxes, semi-implicit Manning friction) over real GEBCO 2020 bathymetry sampled server-side; a synthetic bathymetry fallback is explicitly disabled.`,
    headerQuote: {
      quote: `Initial source: simplified Okada-style elastic dislocation uplift — vertical seafloor displacement from finite-fault slip transferred to the water surface (Okada 1985 in spirit; here a rectangular fault patch with dip-slip lobes, and moment-magnitude scaling).`,
      cite: src(T, '10-13'),
    },
    equations: [
      { formula: '∂η/∂t + ∇·(H·u) = 0;   ∂u/∂t + … = −g·∇η;   c = √(g·H)', caption: 'Header form (H = still-water depth + η). The implemented solver is the NONLINEAR conservative SWE (h·u² and g·h²/2 fluxes), not the linearised form.', cite: `${src(T, '7-9')} ${src(SV, '64-75')}` },
      { formula: 'M0 = 10^(1.5·M + 9.1) N·m;  amp = seafloor_displacement_m · √(M0/M0_ref) / 5.6,  M0_ref = 10^(1.5·8+9.1)', caption: 'Moment scaling of the surface displacement (normalised to the requested displacement at M 8).', cite: src(T, '262-267') },
      { formula: 'L_half = 20·10^(0.5(M−8)) km;  W_half = max(0.4·L_half, 8) km;  slip = clip(1−(along/L)²,0,1)·clip(1−(across/W)²,0,1)·tanh(across/(0.5·W))', caption: 'Rupture dimensions ("Wells &amp; Coppersmith style") and dip-slip uplift/subsidence lobes; strike default 135°; applied to ocean cells (bathy &gt; 50 m) only.', cite: src(T, '274-287,260,94') },
      { formula: 'Face flux: MUSCL minmod reconstruction; HLL with sl = min(u−c), sr = max(u+c);  dt = 0.9·dx/(√2·c_max)', caption: 'Update scheme and main-loop timestep (the solver\'s own estimate_cfl_dt uses safety 0.45 — the kernel main path passes its own dt).', cite: src(SV, '34-36,77-113') },
      { formula: 'friction = g·n²·|u|/H^(4/3), clipped ≤ 0.05 s⁻¹, applied as (1+dt·friction)⁻¹; n = 0.03', caption: 'Semi-implicit Manning damping.', cite: src(SV, '200-206') },
      { formula: '∂(hu)/∂t += −dt·g·H·∂b/∂x (central difference)', caption: 'Explicit bathymetry source term — NOT hydrostatically re-balanced per face; see Known limitation.', cite: src(SV, '188-193') },
    ],
    coefficients: {
      caption: 'Constants and defaults.', cols: ['Name', 'Value', 'Meaning', 'Source'], rows: [
        ['g', '9.81 m/s²', 'Gravity', src(T, '232')],
        ['manning_n', '0.03', 'Basal roughness', `${src(T, '307')} ${src(SV, '163')}`],
        ['ocean threshold', 'bathy &gt; 50 m', 'Source applied only on ocean cells', src(T, '94,254')],
        ['default dx', '5 km (when no extent_km)', 'Cell size', src(T, '233-234')],
        ['dt (default)', '0.9·dx/(√2·√(g·H_max))', 'CFL-style timestep from deep-water celerity', src(T, '236-238')],
        ['strike default', '135°', 'Rupture orientation', src(T, '260')],
      ],
    },
    paramsCaption: 'Tsunami parameters.',
    params: [
      ['Earthquake Magnitude <span class="cite">slider</span>', '<code>magnitude</code>', 'M', 'UI 5–9.5 step 0.1; wire 5–9.7', 'UI 8.5 · kernel 8.5', 'Sets M0, rupture L/W and amplitude', `${src(SE, '109-113')} ${src(C, '113')} ${src(T, '191,262-276')}`],
      ['Max Wave Height <span class="cite">slider</span>', '<code>seafloor_displacement_m</code>', 'm', 'UI 1–30 m (hidden derived value preferred: clamp(1, 40, 5·10^(M−6))); wire &gt;0, ≤ 40', 'derived at M 8.5 → 40 m; kernel 5', 'Near-field vertical displacement reference amplitude', `${src(SE, '109-113')} ${src(C, '114,473,660')} ${src(T, '192')}`],
      ['Hypocenter Depth <span class="cite">slider</span>', '— (not sent)', 'km', 'UI 5–100', '20', 'Panel context + arrival-time hint only; long-wave physics is depth-independent', `${src(SE, '109-113')} ${src(C, '663-664')}`],
      ['duration_minutes', '<code>duration_minutes</code>', 'min', 'wire ≤ 720; builder fixes 30', 'kernel 30', 'Propagation window', `${src(C, '115,474')} ${src(T, '193')}`],
      ['Bathymetry', '<code>bathymetry(+_gs)</code> → <code>bathy_b64/min/span</code>', 'm positive-down', 'Required: run raises without real GEBCO', 'auto server-sampled', 'GEBCO 2020 via api.opentopodata.org/v1/gebco2020 (64² default)', `${src(C, '116-124')} ${src('server/kaggle/bathymetry.ts', '10,28')} ${src(T, '227-230')}`],
      ['benchmark_stations (optional)', 'array ≤16', '—', 'row/col + observed eta(t) series', '—', 'Compare modeled η(t) with observed gauge series', src(C, '125-133')],
    ],
    outputs: [
      ['<code>water_height.npy</code>', 'm (η)', 'Final free-surface elevation grid', src(T, '421-425')],
      ['<code>bathymetry.npy</code>', 'm', 'Depth grid used (positive-down)', src(T, '421-425')],
      ['<code>snapshots_height.npy</code> + <code>snapshot_times.npy</code>', 'm; min', 'Propagation frames', src(T, '421-425')],
      ['<code>metadata.json</code> + <code>validation.json</code> + <code>benchmark.json</code>', '—', 'model "okada_finite_fault_dislocation", solver "finite_volume_swe_hll_minmod", final stats, benchmark comparison', src(T, '336-364,430-438')],
    ],
    validity: {
      quote: `'Real GEBCO bathymetry is required for tsunami simulations; synthetic fallback is disabled.' · the linear-in-form header describes c = sqrt(g·H) propagation; implementation integrates the nonlinear conservative SWE · internal conservation proof states: 'Flat bathymetry (constant depth) — no source terms, pure wave propagation.'`,
      cite: `${src(T, '228-229')} ${src(T, '7-9')} ${src(SV, '235')}`,
    },
    gate: `main() runs the closed-box conservation proof (flat 2000 m bathy, 500 steps, tol 1e-9) before the simulation and refuses non-conservative runs: <em>"Tsunami solver failed closed-box conservation check (|Δ|=…). Refusing to run a non-conservative simulation."</em> ${src(T, '406-417')}`,
    measured: [
      ['Conservation gate (re-executed)', '[VERIFY] closed-box gs=64 steps=500: init=8194010.359005 final=8194010.359005 |Δ|=0.00e+00 → PASS'],
      ['Flat-bed propagation (4000 m constant bathy, 96²/300 km, dt = 3 s → CFL 0.27, 20 min)', 'Stable for the duration: 1.21 m uplift → max η 0.64 m radiated; energy 0.07 GJ; wall 0.6 s'],
      ['Flat bed, kernel default dt (96²/300 km, dt = 0.9·dx/(√2·c) = 10.04 s, printed “CFL 0.90 (OK)”, 20 min)', 'Diverges (max |η| ~ 10²³⁰ m): the kernel’s own dt formula exceeds the ~0.5 stability bound of second-order (MUSCL/HLL) updates; its estimate_cfl_dt uses safety 0.45 but main() passes its own dt'],
      ['Flat bed, small box (48² at dt = 3 s)', 'Stable for ~40 steps, then monotonic growth from periodic wrap-around coupling at the roll-based face divergence: 0.27 → 22 m by 20 min'],
      ['Sloped synthetic bed (dt = 3 s)', 'Diverges at low CFL — the explicit bathymetry source drives unbounded growth on any slope'],
      ['REAL GEBCO 2020 (16×16 sampled off Tohoku, 38.5°N 143.5°E, via the same api.opentopodata.org/v1/gebco2020 endpoint the server uses; M 8.5, 5 m, 20 min, 300 km box)', 'Diverges at both default dt (7.25 s, “CFL 0.90 (OK)”) and dt = 3 s (CFL 0.37): final max_wave ~10³⁰⁰ m, E = nan'],
    ],
    knownLimitation: `This review reproduced three distinct unbounded-growth mechanisms in the standalone kernel: (1) the default main-loop timestep uses a 0.9 CFL that second-order MUSCL/HLL updates cannot satisfy (flat bed still diverged at CFL 0.90; the solver's own <code>estimate_cfl_dt</code> applies safety 0.45 but main() overrides it); (2) the roll-based face divergence wraps opposite domain edges together, so waves grow after boundary interaction even on a flat bed in a small box; (3) on any non-flat bathymetry — including a real GEBCO 2020 sample — the explicit central-difference source term drives divergence at every tested timestep (max |η| → 10^300 m, energy NaN). The closed-box conservation proof deliberately uses a flat bed where the source vanishes, so it cannot detect (2) or (3). Until the scheme gains a well-balanced source treatment (e.g. the Audusse reconstruction the flood kernel uses) and a transmissive boundary, tsunami output must be treated as UNVALIDATED. Production runs go through Kaggle where this review could not execute them.`,    repro: `# Conservation gate + flat-bed propagation + diverging real-bed case:\ncd /tmp && mkdir ts && cp <repo>/kaggle-kernels/tsunami-sim/{main.py,swe_solver.py} ts/ && cd ts\npython3 - <<'PY'\nimport base64, json, numpy as np, subprocess, os\nv = np.full((16,16), 4000.0)          # flat bed  — stable\n# v = (np.mgrid[0:16,0:16][1]/15)*-4000+4000   # sloped bed — diverges\nspan=v.max()-v.min(); u16=np.round((v-v.min())/max(span,1e-9)*65534).astype('<u2')\njson.dump({'grid_size':96,'magnitude':8.5,'seafloor_displacement_m':5,'duration_minutes':20,\n  'extent_km':300,'dt_s':3.0,'bathy_gs':16,'bathy_b64':base64.b64encode(u16.tobytes()).decode(),\n  'bathy_min':float(v.min()),'bathy_span':float(span)}, open('params.json','w'))\nPY\nTERRANOETIS_OUT_DIR=$PWD python3 main.py | grep -E "VERIFY|DONE"   # writes fail off-Kaggle: hard-coded /kaggle/working (main.py:421)`,
  },

  // ═══════════════════════════════ VOLCANO ════════════════════════════════
  volcano: {
    path: 'capabilities/volcano.html',
    title: 'Volcanic eruption (lava SWE + buoyant plume + ash PDE)',
    desc: 'Conservative Rusanov lava shallow-water flow with Arrhenius/Bingham rheology and cooling, Morton–Taylor plume column, and advection–diffusion–settling ash transport. Benchmarked 4/4 against Pinatubo 1991 and Kilauea 2018.',
    wireType: 'volcanic_eruption',
    proseMd: 'volcano.md',
    mode: 'Kaggle kernel (numpy-only, CPU accelerator instance); local in-process use for calibration & Monte-Carlo',
    status: 'MEASURED locally — benchmark suite 4/4 PASS re-executed 2026-09-09',
    runCite: `${src(SR, '126-141')} ${src('server/kaggle/localRunner.ts', '1-15')} ${src(V, '607-680,1383')}`,
    intro: `The eruption scenario couples three physics modules: (1) lava flow as a 2D conservative shallow-water system with Rusanov fluxes, Arrhenius temperature-dependent viscosity, Bingham yield strength, Stefan–Boltzmann radiation, crust insulation and enthalpy-porosity solidification; (2) the eruption column as a 1D Morton–Taylor buoyant plume integrated to neutral buoyancy; and (3) ash as a vertically integrated advection–diffusion–settling PDE over a height-resolved wind field, with Schiller–Naumann particle drag. Terrain is REAL ONLY — the kernel refuses to run without sampled relief.`,
    headerQuote: {
      quote: `Lava flow — 2D conservative shallow-water equations solved with a Rusanov (local Lax-Friedrichs) flux … The Rusanov face flux telescopes to exact mass conservation (verified by verify_closed_box). … Eruption column — 1D Morton-Taylor buoyant plume with turbulent entrainment … Terrain — REAL ONLY. … if real relief is absent the run fails fast with a legible error rather than fabricating a cone.`,
      cite: src(V, '4-40'),
    },
    equations: [
      { formula: '∂(hu)/∂t + ∇·(hu⊗u) = −g·h·∇η + g·h·sinθ − (η(T)·u)/(ρ·h) − τ_y/ρ', caption: 'Lava momentum: pressure + gravity − viscous (Arrhenius η(T)) − Bingham yield.', cite: src(V, '9-12') },
      { formula: '∂T/∂t + u·∇T = κ∇²T − h_c(T−T_amb)/(ρc_p h) − εσ(T⁴−T_amb⁴)/(ρc_p h) − (L_f/c_p)·dφ/dt', caption: 'Temperature advection–diffusion with convective + radiative cooling and latent heat of solidification.', cite: src(V, '15-18') },
      { formula: 'd(ρwR²)/dz = 2αρ_a wR;  dw/dz = g(ρ_a−ρ)/ρ_a − (w/R)·dR/dz;  dT/dz = −g/c_p − (2α/R)(T−T_a)', caption: 'Morton, Taylor &amp; Turner (1956) plume equations; α = 0.1; height where w → 0; exit velocity capped at 200 m/s with flux-conserving vent widening.', cite: src(V, '21-26,200-262') },
      { formula: '∂C/∂t + u_wx·∂C/∂x + u_wy·∂C/∂y = K·∇²C + Ṡ(x,y,t) − v_t·C/H_col', caption: 'Ash column-mass transport: upwind advection (conservative flux form), exact Gaussian-blur diffusion (σ = √(2KΔt)), Stokes/Schiller–Naumann settling, permanent deposition.', cite: src(V, '28-36') },
      { formula: 'v = ((ρ_p−ρ_f)·g·d²)/(18μ) [Stokes];  Cd = (24/Re)(1+0.15·Re^0.687) [Schiller–Naumann, Re &lt; 800], iterated', caption: 'Terminal velocity; the code notes Stokes is valid only Re &lt; 0.5 and that 316 µm ash sits at Re ≈ 60, so the correction matters.', cite: src(V, '265-296') },
      { formula: 'M0-style scaling: MER = mass_erupt(VEI)·mass_scale/(t·0.5);  vent radius by VEI {0:60 m … 8:600 m}', caption: 'VEI bins are order-of-magnitude: mass_erupt ≈ 1.2·10^(VEI+7) kg "at bulk density ~1200 kg/m³ (loose tephra)"; col_height/lava_vol/ash_mass per VEI.', cite: src(V, '139-152,117-121,775-777,976') },
    ],
    coefficients: {
      caption: 'Named physical constants (value — meaning).', cols: ['Constant', 'Value', 'Meaning', 'Source'], rows: [
        ['RHO_LAVA', '2600 kg/m³', 'Basaltic lava density', src(V, '74')],
        ['C_P_LAVA', '1200 J/(kg·K)', 'Specific heat', src(V, '75')],
        ['K_THERMAL', '1.5 W/(m·K)', 'Conductivity', src(V, '76')],
        ['ETA_REF @ T_REF', '300 Pa·s @ 1450 K', 'Arrhenius reference viscosity', src(V, '77-78')],
        ['E_A', '180 kJ/mol', 'Activation energy (range 100–400 noted in comment)', src(V, '79')],
        ['T_LIQ / T_SOLID / T_CRUST', '1450 / 1320 / 1360 K', 'Liquidus, solidus, crust-onset (tholeiitic basalt)', src(V, '80-83')],
        ['L_FUSION', '400 kJ/kg', 'Latent heat', src(V, '84')],
        ['H_COEFF', '25 W/(m²·K)', 'Convective transfer', src(V, '85')],
        ['σ_SB / ε', '5.67e-8 / 0.9', 'Stefan–Boltzmann / emissivity', src(V, '89-90')],
        ['CRUST_INSULATION', '0.92 (92 % loss cut)', 'Keszthelyi &amp; Self 1998 crust effect', src(V, '74-79 header comment lines 91-97')],
        ['τ_y', '1000 → 20,000 Pa', 'Bingham yield, eruption → near-solid', src(V, '98-99')],
        ['D_ASH_DEFAULT', '316 µm', 'Median coarse-ash diameter → v_t ≈ 1.25 m/s (Stokes-regime note says ≈3 m/s at defaults)', src(V, '127-128')],
        ['RHO_AIR / μ_air', '1.2 kg/m³ / 1.8e-5 Pa·s', 'Settling medium', src(V, '124-125')],
        ['lapse rate Γ', '0.0065 K/m', 'Tropospheric profile for the plume', src(V, '126')],
        ['α (entrainment)', '0.1', 'Morton–Taylor coefficient', src(V, '223')],
      ],
    },
    paramsCaption: 'Volcano parameters.',
    params: [
      ['Volcanic Explosivity Index <span class="cite">slider</span>', '<code>vei</code>', 'VEI int', 'UI &amp; wire 0–8', 'UI 3 · kernel 3', 'Selects the order-of-magnitude mass/lava/ash bin', `${src(SE, '89-101')} ${src(C, '174')} ${src(V, '143-152')}`],
      ['Wind Speed / Direction <span class="cite">sliders</span>', '<code>wind_speed_ms</code>, <code>wind_dir_deg</code>', 'm/s; ° FROM', 'UI 0–120 km/h, 0–360; wire 0–60, 0–360', 'UI 36 km/h / 260° · kernel 10 / 270', 'Ash transport (height-resolved bins)', `${src(SE, '89-101')} ${src(C, '175-176')} ${src(V, '340-341')}`],
      ['Duration <span class="cite">slider</span>', '<code>duration_hours</code>', 'h', 'UI 1–168 (overwritten 8·VEI); wire ≤ 720', 'UI 48 · kernel 2', 'Eruption window (source active first half)', `${src(SE, '89-101')} ${src(C, '177,617')} ${src(V, '765,923')}`],
      ['Lava Yield Scale <span class="cite">slider</span>', '<code>yield_scale</code>', 'multiplier', 'UI 0.05–3; wire 0.01–10', 'UI 0.3 · kernel 1.0', 'Multiplies Bingham τ_y — calibration knob', `${src(SE, '89-101')} ${src(C, '202')} ${src(V, '100-105,781-782')}`],
      ['Lava Volume Scale <span class="cite">slider</span>', '<code>mass_scale</code>', 'multiplier', 'UI 0.5–5; wire 0.1–100', 'UI 2 · kernel 1.0', 'Perturbs erupted mass within the VEI bin (2–5× spread noted)', `${src(SE, '89-101')} ${src(C, '204')} ${src(V, '768-777')}`],
      ['Ash Particle Diameter <span class="cite">slider</span>', '<code>ash_particle_diameter_m</code> = µm/1e6', 'm', 'UI 50–2000 µm; wire 50e-6–2e-3', 'UI 316 µm', 'Drives terminal settling velocity', `${src(SE, '89-101')} ${src(C, '189,509')} ${src(V, '896')}`],
      ['Ash Cloud Diffusivity <span class="cite">slider</span>', '<code>ash_diffusivity_m2_s</code>', 'm²/s', 'UI &amp; wire 10–5000', 'UI 500 · kernel 500', 'Sub-grid turbulent eddy diffusion', `${src(SE, '89-101')} ${src(C, '191')} ${src(V, '901')}`],
      ['Wind-Shear Factor <span class="cite">slider</span>', '<code>ash_wind_shear_factor</code>', 'fraction', 'UI &amp; wire 0–1', 'UI 0.5 · kernel 0.5', 'Low-level wind fraction of free stream', `${src(SE, '89-101')} ${src(C, '193')} ${src(V, '902')}`],
      ['Vent (globe click; snapped to crater floor)', '<code>vent_frac_x/y</code>', 'fraction 0–1', 'clamped; floor-scan within 1.5 km', '0.5, 0.5', 'Column + lava source location', `${src(C, '194-200,320-362')} ${src(V, '785-788')}`],
      ['Terrain (required)', '<code>terrain(+_gs)</code> / <code>terrain_b64</code>', 'm above ellipsoid', 'must be present or the run raises', '—', 'Real sampled relief; NO synthetic fallback', `${src(V, '800-826')}`],
    ],
    outputs: [
      ['<code>column_height.npy</code>', 'm', 'Ash-column height field (VEI table height × radial decay)', src(V, '1015-1019,1393')],
      ['<code>ash_deposit.npy</code>', 'kg/m² (renderer shows mm via bulk ρ 1000 kg/m³)', 'Cumulative deposit', src(V, '127-129,1394')],
      ['<code>ash_column.npy</code>', 'kg/m²', 'Airborne column mass at t_end', src(V, '1395')],
      ['<code>lava_thickness.npy</code> / <code>lava_temp.npy</code>', 'm / K', 'Lava thickness and temperature', src(V, '1396-1397')],
      ['<code>terrain.npy</code> + <code>snapshots_column/ash/lava.npy</code> + <code>snapshot_times.npy</code>', 'm; —; h', 'Animation series (up to 60 frames)', src(V, '1398-1411')],
      ['<code>metadata.json</code>', '—', 'model/solver/plume/ash strings, settling velocity, plume_height_m, eruption_mass_rate_kg_s', src(V, '1318-1333')],
    ],
    validity: {
      quote: `'Terrain — REAL ONLY. … There is NO synthetic cone fallback: if real relief is absent the run fails fast with a legible error rather than fabricating a cone.' · 'Real eruptions of the SAME VEI bin differ 2–5× in ejected volume (Newhall & Self note the bins are order-of-magnitude).' · 'Stokes law (Cd = 24/Re) is valid only for Re < 0.5; for coarse ash (d ~ 316 µm) Re ≈ 60, so the Schiller–Naumann correction is essential.'`,
      cite: `${src(V, '37-40,822-826')} ${src(V, '769-773')} ${src(V, '272-276')}`,
    },
    gate: `Before emitting, main() runs the flat closed-box conservation proof (gs = 64, 2000 steps, tol 1e-3); the suite also carries verify_steep_closed_box (well-balanced + mass on 30° slopes). ${src(V, '607-680,1383-1386')}`,
    measured: [
      ['Benchmark suite re-executed 2026-09-09 (run_benchmarks.py)', '4/4 PASS — B1 flat closed-box mass; B2 steep-terrain well-balanced mass; B3 Pinatubo 1991 ash isopach vs observed thickness–distance axes; B4 Kilauea 2018: modelled runout 15.0 km vs observed ~13.5 km, mass budget True, downslope True'],
      ['Representative VEI 3 ×2 mass, 12 h, 20 km box on synthetic cone terrain (test input)', 'MER 5.56e+5 kg/s; Morton–Taylor plume integrates to 788 m while the VEI table column (10,000 m) drives ash-column height — both reported; ash budget Δ = 7.6e-15 relative, lava mass Δ = 0.0; wall 70.6 s at 156 m cells (crater pooling at this coarse resolution)'],
      ['Boundary VEI 5, 800 µm ash, K = 1000, shear 0.8, 96² / 40 km', 'MER 2.22e8 kg/s; M-T plume 27,920 m (table 40,000 m); v_t(800 µm) = 3.17 m/s; both budgets PASS (Δ ≤ 2e-14); wall 3.6 s'],
      ['Output limitation', 'main() writes to /kaggle/working unconditionally — local calibration/Monte-Carlo instead imports simulate_volcano() in-process via localRunner.ts; standalone local main.py runs reach the final budgets but fail at the write step (observed: Read-only file system \'/kaggle\')'],
    ],
    repro: `# The regression gate the docs cite (fast, in-process):\ncd <repo>/kaggle-kernels/volcano-sim/benchmarks && python3 run_benchmarks.py\n# → 'RESULT: 4/4 benchmarks passed'\n\n# Server-side ensemble (no Kaggle token needed):\ncurl -s -X POST http://localhost:3001/api/kaggle/volcano/quantify \\\n  -H 'Content-Type: application/json' -d '{ "request": {…volcanic_eruption params with terrain…}, "samples": 16 }'`,
  },

  // ═══════════════════════════════ LANDSLIDE ══════════════════════════════
  landslide: {
    path: 'capabilities/landslide.html',
    title: 'Landslide debris flow (Voellmy–Salm depth-averaged)',
    desc: 'Mohr–Coulomb failure with earthquake/rainfall/volcanic triggers and a Voellmy-friction depth-averaged debris-flow solver; convergence-validated with a calibration endpoint against observed runout.',
    wireType: 'landslide',
    proseMd: 'landslide.md',
    mode: 'Kaggle kernel (numpy, CPU instance); local in-process for calibration & Monte-Carlo',
    status: 'MEASURED locally — convergence/conservation script PASS re-executed',
    runCite: `${src(SR, '126-141')} ${src('server/kaggle/localRunner.ts', '1-15')}`,
    intro: `Slope failure begins with a Mohr–Coulomb infinite-slope assessment over a susceptibility field (with Newmark-style seismic, effective-stress rainfall, and lahar triggers), converts susceptible steep cells into an initial debris mass, and routes it with the depth-averaged Voellmy–Salm equations using Rusanov mass fluxes and a semi-implicit momentum update. μ and ξ are free calibration parameters — the platform ships an endpoint to fit them against an observed runout.`,
    headerQuote: {
      quote: `Voellmy-Salm friction law:\n  τ_b/ρ = μ_c·g·h·cos²θ  +  g·u·|u|/ξ\n  where μ_c = tan φ_res is the residual (dynamic) basal friction and\n  ξ (m/s²) is Voellmy's turbulent coefficient. Debris: φ_res ≈ 14°, ξ ≈ 300.`,
      cite: src(L, '11-14'),
    },
    equations: [
      { formula: '∂h/∂t + ∇·(h·u) = 0;   ∂(hu)/∂t + ∇·(hu⊗u) = −g·h·∇(h+z) − τ_b/ρ', caption: 'Depth-averaged debris-flow SWE (mass via Lax-Friedrichs, momentum semi-implicit Euler).', cite: src(L, '7-10,518-537,579-629') },
      { formula: 'τ_b/ρ = μ·g·h·cos²θ + g·u·|u|/ξ  (μ capped by driving stress — yield behaviour)', caption: 'Voellmy–Salm total basal stress; Coulomb term only reduces when driving stress exceeds it.', cite: src(L, '593-624') },
      { formula: 'FS = (c + σ′·tanφ) / (γ·h·sinθ),  σ′ = γ_soil·h_soil·cosθ·0.5', caption: 'Infinite-slope Mohr–Coulomb factor of safety assuming 50 % saturation; γ_soil = 18,000 N/m³, h_soil = 2 m.', cite: src(L, '226-235,228-230') },
      { formula: 'seismic: fs_seismic = fs − a/(g·sinθ)  (Newmark criterion a_max &gt; g(FS−1)sinθ);  rainfall: fs·(1 − 0.7·rain_factor);  volcanic: exp(−r/0.25·gs)·(slope&gt;15°)', caption: 'Trigger mechanisms on the susceptibility field.', cite: src(L, '241-271') },
      { formula: 'ln PGA[g] = 3.586 + 0.707·M − 1.093·ln(r+10) − 0.0053·(r+10)  [site term 0.25·ln(760/760) ≡ 0]', caption: '"Simplified Campbell–Bozorgnia" PGA field feeding the trigger; r in km floored at 1; epicentre fixed at (0.7gs, 0.3gs). No site amplification — the term is identically zero.', cite: src(L, '187-189,372') },
      { formula: 'E = min(entrainment_rate·|u|·dt·(1 − h/(h+ent_ref)), bed)', caption: 'Hungr/McDougall-type velocity-proportional entrainment, self-limiting, default OFF (rate 0).', cite: src(L, '556-577,314-315') },
    ],
    coefficients: {
      caption: 'Named constants and defaults.', cols: ['Name', 'Value', 'Meaning', 'Source'], rows: [
        ['G', '9.81 m/s²', 'Gravity', src(L, '54')],
        ['RHO_DEBRIS', '2000 kg/m³', 'Bulk debris density (sediment + water)', src(L, '55')],
        ['φ_res / μ_default', '14° / tan φ ≈ 0.249', 'Residual friction angle (μ = 0.25 UI default)', src(L, '68-69')],
        ['ξ_default', '300 m/s²', 'Turbulent coefficient (range 100–1000 in comment: "ξ=300 gives ~6–11 m/s on realistic slopes")', src(L, '59-70')],
        ['φ / c defaults', '35° / 500 Pa', 'Mohr–Coulomb strength (overridable per run)', src(L, '73-74')],
        ['PGA / rain thresholds', '0.15 g / 150 mm', 'Trigger defaults', src(L, '77-78')],
        ['V_MAX / CFL', '30 m/s / 0.15', 'Velocity cap and inner substep criterion', src(L, '326-327,503-509')],
        ['Source construction', 'sus &gt; 0.4, slope &gt; 25°, radius 0.32·gs, h = sus·(slope/30)·6 ∈ [2,15] m, capped at 5 % of grid', 'Localized failure mass (rationale comments for each guard)', src(L, '391-421')],
      ],
    },
    paramsCaption: 'Landslide parameters.',
    params: [
      ['Trigger Type <span class="cite">select</span>', '<code>trigger_type</code>', 'enum', 'earthquake | rainfall | volcanic', 'earthquake', 'Which failure mechanism maps rainfall/PGA fields to susceptibility', `${src(SE, '114-134')} ${src(C, '211')} ${src(L, '298')}`],
      ['Earthquake Magnitude <span class="cite">slider</span>', '<code>magnitude</code>', 'M', 'UI 4–9.5; wire 3–9.7', 'UI 6.5 · kernel 6.5', 'Feeds the PGA field only under earthquake trigger', `${src(SE, '114-134')} ${src(C, '212')} ${src(L, '299')}`],
      ['PGA Threshold <span class="cite">slider</span>', '<code>pga_threshold</code>', 'g', 'UI 0.05–0.5 (auto-lowered with M); wire 0.01–1', 'UI 0.15 · kernel 0.15', 'Cell activates when local PGA exceeds it', `${src(SE, '114-134')} ${src(C, '213,625')} ${src(L, '300')}`],
      ['Total Rainfall <span class="cite">slider</span>', '<code>rainfall_mm</code>', 'mm', 'UI 50–2000; wire 0–3000', 'UI 200 · kernel 200', 'Rain-trigger susceptibility via effective-stress loss (≤ 70 %)', `${src(SE, '114-134')} ${src(C, '214')} ${src(L, '302,252-260')}`],
      ['Friction Angle / Cohesion <span class="cite">sliders</span>', '<code>friction_angle</code>, <code>cohesion</code>', '°; Pa', 'UI 20–50 / 0–2000; wire 10–60 / 0–5000', '35° / 500 Pa', 'Mohr–Coulomb strength in the FS criterion', `${src(SE, '114-134')} ${src(C, '215-216')} ${src(L, '304-305')}`],
      ['Voellmy μ <span class="cite">slider</span>', '<code>mu</code>', '—', 'UI 0.05–0.5; wire 0.01–1', 'UI 0.25 · kernel tan 14° ≈ 0.249', 'Dry (dynamic) Coulomb friction — free calibration parameter', `${src(SE, '114-134')} ${src(C, '230')} ${src(L, '311')}`],
      ['Voellmy ξ <span class="cite">slider</span>', '<code>xi</code>', 'm/s²', 'UI 50–1500; wire 10–5000', 'UI 300 · kernel 300', 'Turbulent friction coefficient — free calibration parameter', `${src(SE, '114-134')} ${src(C, '232')} ${src(L, '312')}`],
      ['Bed Entrainment Rate / Erodible Depth <span class="cite">sliders</span>', '<code>entrainment_rate</code>, <code>erodible_depth_m</code>', '1/s; m', 'UI 0–0.01 / 0–20; wire 0–0.1 / 0–50', 'UI 0 / 5 · kernel 0 / 0 (off)', 'Velocity-proportional growth of the flow by bed erosion (default disabled)', `${src(SE, '114-134')} ${src(C, '233-236')} ${src(L, '314-315,556-577')}`],
      ['Duration <span class="cite">slider</span>', '<code>duration_hours</code>', 'h', 'UI 0.5–48; wire ≤ 720; kernel also caps simulated time at 300 s', 'UI 2 · kernel 2', 'Flow routing window', `${src(SE, '114-134')} ${src(C, '217')} ${src(L, '303,435-442')}`],
      ['Terrain (optional)', '<code>terrain(+_gs)</code>', 'm', '≤ 65,536 cells', '—', 'Real relief; otherwise a deterministic synthetic ridge (seed 42)', `${src(C, '218-224')} ${src(L, '81-103')}`],
    ],
    outputs: [
      ['<code>landslide_depth.npy</code>', 'm', 'Final debris thickness', src(L, '875-895')],
      ['<code>landslide_velocity.npy</code>, <code>velocity_x/y.npy</code>', 'm/s', 'Speed and components', src(L, '875-895')],
      ['<code>runout_distance.npy</code>', 'km field', 'Distance from the depth-weighted source centroid', src(L, '457-463')],
      ['<code>susceptibility.npy</code> / <code>trigger_map.npy</code> / <code>slope.npy</code>', '0–1 / g or mm / °', 'Failure susceptibility and trigger field (PGA in g for earthquake runs, else rainfall mm)', src(L, '744,875-895')],
      ['<code>snapshots_depth/velocity/vx/vy.npy</code> + <code>snapshot_times.npy</code>', '—; s', 'Animation series', src(L, '875-895')],
      ['<code>metadata.json</code>', '—', 'model "depth_averaged_debris_flow", friction_law "voellmy", solver "lax_friedrichs", total volume + outflow ledger', src(L, '772-775,756-761')],
    ],
    validity: {
      quote: `'The genuine conservation proof is the closed-box test (verify_closed_box) and the grid-convergence script, not this algebraic bookkeeping.' · axis-mapping note: 'The old mapping was swapped, which on *real* terrain would drive debris across the slope instead of down it' · susceptibility raw mask note: 'The raw mask (susceptibility > 0.3) covers ~99% of the grid, so the "pile" is a grid-wide slab that blows up and renders as a hollow rim.' · "Certified-grade" debris-flow modelling requires the free parameters to be fit to a real slide, not guessed … Sample runout resources: Hungr et al. (2001) runout databases`,
      cite: `${src(L, '712-714,465-475,391-393')} ${src('kaggle-kernels/landslide-sim/calibrate.py', '4-14')}`,
    },
    gate: `The closed-box verifier exists in main.py but is NOT invoked by main() (unlike flood/tsunami/volcano); the authoritative gates are validate_convergence.py (conservation 1e-8, runout refinement ≤ 0.25, upsampling RMSE ≤ max(10 %, 30 m)) and the /api/kaggle/calibrate grid fit. ${src(L, '808-857')} ${src('kaggle-kernels/landslide-sim/validate_convergence.py', '19-21,35-98')}`,
    measured: [
      ['Grid-convergence script re-executed 2026-09-09', 'PASS — conservation |Δ| = 0 with and without entrainment; runout 3.74→2.87→2.95 km over gs 64→128→256 (fixed 5.12 km domain, dx 80→40→20 m); area refinement Δ1 = 1.386 → Δ2 = 0.050 (gate ≤ 0.25); terrain upsample RMSE 20.6 m = 1.5 % of 1,381 m relief; exit 0'],
      ['Representative quake-trigger run (128², M 6.5, μ 0.25, ξ 300, 5 min sim)', 'max depth 157 m (coarse-grid pooling), max velocity 26.2 m/s, runout 4.0 km, affected 5.1 km², volume 24.5 M m³; in-domain mass ledger drift 1.56 % (boundary exchange ledger reported separately); wall 2.7 s'],
      ['Rain + entrainment run (96², 300 mm, rate 0.005/s, bed 4 m)', 'max depth 216 m, velocity 21.6 m/s, runout 6.2 km, affected 25.5 km²; entrained +126 M m³ accounted; mass drift 0.0000 %; wall 2.0 s'],
      ['Calibration endpoint semantics', 'μ×ξ grid search {0.15…0.40}×{100…800} minimising |runout − observed| (calibrate.py:24-25,64) — exercised by the server localRunner (spawned python3, in-process)'],
    ],
    repro: `# Convergence/conservation gates (in-process, no Kaggle):\ncd <repo>/kaggle-kernels/landslide-sim && python3 validate_convergence.py\n# → 'PASS — all gates OK'\n\n# Calibrate μ×ξ to an observed runout (documented-event value required):\npython3 calibrate.py --observed-runout-km 2.9 --grid-size 128\n\n# Server-side UQ:\ncurl -s -X POST http://localhost:3001/api/kaggle/landslide/quantify \\
  -H 'Content-Type: application/json' -d '{ "request": {…landslide params…}, "samples": 16 }'`,
  },
};
