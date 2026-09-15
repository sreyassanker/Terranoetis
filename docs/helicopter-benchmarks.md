# Helicopter Sim — Physics Benchmarks & Calibration

Reference: the AH-64E **Apache Guardian** flight model in
`src/rendering/helicopterSim.ts`. Every number below is traceable to
`docs/helicopter/` (FAA-H-8083-21B, DoD SAR AH-64E Dec 2022, DOT&E FY16/17/19,
DTIC-ADA528155 rotorcraft survivability, NASA/Harris V/STOL) or pinned by unit
tests in `src/__tests__/helicopterSim.test.ts`.

## Airframe geometry (vs real AH-64E)

| Quantity | Sim | AH-64E reference | Source |
|---|---|---|---|
| Rotor radius | 7.31 m | 7.315 m | manufacturer (README link set) |
| Rotor speed Nf 100 % | 269 rpm (Ω = 28.2 rad/s) | 269 rpm | RFM class data |
| Blades main / tail | 4 / 2 | 4 / 2 | DoD SAR |
| Length / disk dia. (model) | 17.5 m / 14.6 m | 17.5 m / 14.65 m | DoD SAR |
| Hover-datum mass | 5,200 kg (`MASS_REF`) | ~5,165 kg empty | manufacturer |
| Gross-weight range | 4,200 – 9,500 kg (`setMassKg`) | 9,500 kg combat ≈ upper band | manufacturer |
| Fuel | **infinite by design** (product decision) | 2,152 kg internal | — |

## Aerodynamic structure (FAA H-8083-21B Ch. 2/3/4/5/11)

| Phenomenon | Implementation | Check |
|---|---|---|
| Cyclic → rotor-disk tilt (dissymmetry of lift + flapping lag), thrust normal to disk | `diskFwd/diskLat` 1st-order lag `FLAP_RATE`, `aThrust·sin δ` | units: thrust-vector accel builds over seconds |
| Torque yaw (CCW rotor → nose right), TR thrust rightward → translating tendency drift | `TR_K·(trNeeded − trThrust)`, `TT_K·trThrust` | units + live: drift right at trim, power-up yaws right |
| Translational thrust (TR efficiency ↑ at speed → left yaw, FAA 2-22) | `TR_TRANS` ramp above 9 m/s | units: cruise yaw trim |
| Transverse flow / ETL blowback: right-roll + nose-up 8–24 kt | `tf` Gaussian terms on attitude targets | units + live: hands-off roll-right, left cyclic corrects |
| ETL: +13 % thrust from 15→24 kt EAS | `tlFactor` exp curve | units: monotonic `etlPct` |
| Ground effect IGE vs OGE | `1 + 0.26·e^(−AGL/0.85R)` | units + live: IGE hovers at DA where OGE cannot |
| VRS ("settling with **power**"): self-sustaining, escape through the band | `vrsDepth` state, thrust derate ×(1−0.55·depth) | units + live: deepens, recovers only with airspeed/lower coll |
| Autorotation energy: NR ↔ sink trade, aft-cyclic NR rise, stored-energy flare | `drive = 0.03·sink·(1.15−coll)`, `load = (0.10+0.55·coll)·Nf²`, inertia ×0.13 | units + live: ~100 % NR @ ~3,200 fpm slot |
| Retreating-blade stall (high load, aft disk, μ, gross weight) → buffet, nose-up, left roll, lift loss | `rbsIndex` from CT proxy + n-load + μ² + aft tilt + mass | units + live: cruise→aft-cyclic onset, recovery by nose-down/lower coll |

## Powerplant (DoD SAR / DOT&E AH-64E)

- Twin **T700-701D**: per-engine gas producers `ngL/ngR` drive a shared Nf.
- FADEC schedules total shaft torque: **87 % twin continuous / 66 % OEI
  contingency**; ITT redline 870 °C — demand above limits bleeds rpm, never
  destroys hardware (no-destruction policy).
- Hover: TRQ ≈ 80 %, ITT ≈ 640 °C. OEI from hover: Nf droops ~80-90 %,
  survivor ITT ~750 °C, controlled descent to the IGE cushion.
- Hot day (live OAT via open-meteo at spawn): lower σ → lower ROC; full
  collective cannot hover IGE at max gross ~2,200 m DA.

## Air data & environment

- ISA troposphere to 11 km; live surface OAT shifts density (σ·Tstd/Tact).
- IAS = CAS, EAS, TAS, GS fully split by σ and wind triangle.
- **Vne is an airspeed placard** (TAS ≤ Vne/√σ), not a ground-track clamp:
  a tailwind makes GS exceed 150 kt while IAS is bounded.
- Boundary layer: log wind profile referenced to 10 m, read at rotor hub
  (gear + 5.5 m), capped 1.3×; OU turbulence (`setTurbulence`) ≈ σ 4.2 m/s at
  full intensity, 1.6 s correlation, bounded ±14 m/s.
- 105°/s total yaw authority (YAW_AUTH), pitch bank clamps remain visual
  authority limits, no load-factor enforcement (heuristic; documented gap).

## Envelope numbers

| Limit | Sim | Real-ish |
|---|---|---|
| Vne | 150 kt IAS | 150-160 kt placard |
| Max level ROC (sea level, 5.2 t) | ~2,900 fpm | ~2,500 fpm (slightly optimistic) |
| Auto slot | Nf 95-104 %, 2,900-3,900 fpm | ~100 %, 3,000-4,000 fpm |
| OEI hover | IGE yes at moderate weight, OGE marginal at DA | same qualitative story |

## Known honest gaps (documented, by design)

1. No blade-element-momentum / dynamic-inflow state — flapping & inflow are
   first-order surrogates.
2. No hydraulic/rotational asymmetry failures, no damage or destruction
   (product policy), no weapons/sensor systems (out of scope by decision).
3. No icing/humidity/precipitation; wind is single-vector + log shear (no
   terrain-shaded gust fields).
4. Engine fuel state is intentionally infinite.

## Regression pins

`src/__tests__/helicopterSim.test.ts` (59 tests, twin-engine / autorotation /
wind / envelope suites included) and the live Playwright contract:
`e2e/heliSituationMatrix.spec.ts` (12 realistic Guardian situations),
`e2e/heliStep{1..5}*.spec.ts` (20 verification tests),
`e2e/heliFullFlight.spec.ts` (23-phase flight card), plus the 15 legacy
controls/camera/cockpit specs — 48 live tests total, all green.

Run:
```bash
npx vitest run src/__tests__
npx playwright test --workers=1   # heli specs, serial (headless Cesium is heavy)
```
