# Analytical Models

Terranoetis ships **150 scientific equation engines** organized across **7 parts** and **26 domains**. Every model is grounded in primary literature and math-verified against its source — no machine learning, no black boxes. Each model carries a full citation; **82 resolve to a DOI**, and the remainder are books (ISBN), government/standards documents, or classic pre-DOI papers, each explicitly flagged in the source with its reference PDF archived under `docs/Research papers/`.

---

## Table of Contents

- [Architecture](#architecture)
- [Visualization Types](#visualization-types)
- [Parts & Domains](#parts--domains)
- [Key Features](#key-features)
- [7-Stage Quality Control](#7-stage-quality-control)

---

## Architecture

Before execution, the **context engine** (`contextEngine.ts`) enriches inputs from live data feeds (weather, terrain, ocean, seismic, air quality, satellite thermal). Each tool then runs through the **7-stage workflow** defined in `toolWorkflows.ts`:

1. **Input validation** — range, type, and physical-plausibility checks
2. **Preprocessing** — unit conversion, derived-parameter computation
3. **Computation** — the source equation (`engine.ts`)
4. **Post-processing** — classification, unit normalisation
5. **Quality control** — result sanity checks, outlier detection
6. **Uncertainty estimation** — error propagation / empirical RMSE
7. **Interpretation** — contextual analysis + scientific recommendations

---

## Visualization Types

Each tool declares a `vizType`; the client renders it via Recharts (charts) or Cesium (field surfaces):

| Type | Description |
|---|---|
| **scalar** | Single computed value with unit + interpretation |
| **timeseries / bar / histogram / scatter / distribution / gauge / profile / spectrum** | Recharts visualizations |
| **heatmap / contour / vector** | IDW-interpolated field surfaces over the study area (Cesium) |
| **Grid** | Structured data grid for downstream GIS fusion |
| **Report** | PDF export with charts and methodology |

---

## Parts & Domains

### Part I — Earth System Core (Tools 1–50) · 6 Domains

| Domain | Tools | Topics |
|---|---|---|
| Atmospheric Science | 1–8 | Land surface temperature, brightness temperature, saturation vapor pressure, atmospheric pressure profile, geostrophic wind, pollutant transport, atmospheric stability, turbulent energy spectrum |
| Hydrology & Oceanography | 9–18 | Evapotranspiration, runoff (SCS-CN), open channel flow, peak discharge, flood wave routing, tide prediction, wind-driven current, ocean current, marine heat budget, infiltration |
| Geophysics & Seismology | 19–25 | Earthquake frequency (Gutenberg-Richter), aftershock decay (Omori), ground motion prediction (GMPE), shear strength, moment magnitude, stress drop, fault rupture scaling |
| Remote Sensing & Cryosphere | 26–35 | Vegetation health index, surface water detection, vegetation water content, enhanced vegetation index, snow cover, burn severity (NBR), fire radiative power, crop water stress, snowmelt runoff, sea ice analysis |
| Spatial Analysis & Extreme Events | 36–42 | Great circle distance, kriging, IDW interpolation, Gaussian plume dispersion, Gumbel extreme value analysis, Pareto peaks-over-threshold, semivariogram analysis |
| Soil Science & Land Surface | 43–50 | Soil water retention (van Genuchten), soil hydraulic model, universal soil loss equation (USLE), soil respiration (Q₁₀), soil thermal conductivity, surface layer stability (Monin-Obukhov), logarithmic wind profile, stomatal conductance |

### Part II — Biosphere, Agriculture & Chemistry (Tools 51–65) · 3 Domains

| Domain | Tools | Topics |
|---|---|---|
| Biosphere & Carbon Cycle | 51–57 | Gross primary production (LUE model), canopy light extinction (Beer-Lambert), net carbon flux, C3 photosynthesis (Farquhar), forest biomass estimation, ocean CO₂ uptake, ocean nutrient ratios |
| Agriculture & Crop Science | 58–63 | Growing degree days, Priestley-Taylor evapotranspiration, Hargreaves-Samani ET, FAO yield-water response, phytoplankton temperature growth, Bigleaf Penman-Monteith |
| Atmospheric Chemistry & Aerosols | 64–65 | Stratospheric ozone equilibrium, pollutant lifetime estimation |

### Part III — Ocean & Coastal Advanced (Tools 66–80) · 2 Domains

| Domain | Tools | Topics |
|---|---|---|
| Ocean Dynamics & Circulation | 66–73 | Wind-driven ocean transport, westward-intensified gyre flow (Stommel), western boundary current structure, thermohaline flow, seawater density (TEOS-10), ocean mixing diffusivity, mixed layer deepening, fully developed sea state |
| Coastal & Wave Mechanics | 74–80 | Coastal wave runup, shoreline retreat (Bruun Rule), breaking wave height (McCowan), longshore sediment transport (CERC), wave dispersion (Airy), Stokes drift, JONSWAP wave spectrum |

### Part IV — Geomorphology, Limnology & Cryosphere (Tools 81–95) · 3 Domains

| Domain | Tools | Topics |
|---|---|---|
| Geomorphology & Mass Wasting | 81–87 | Erosion from stream power, river network scaling (Hack's law), fractal coastline dimension, slope stability (infinite slope), avalanche runout distance, stream power index, topographic wetness index |
| Limnology & Freshwater | 88–90 | Lake evaporation, lake thermal stability, unit hydrograph (linear reservoir) |
| Cryosphere Advanced & Volcanology | 91–95 | Glacier ablation (temperature-index), permafrost active layer depth (Stefan), firn densification, eruption volume from VEI, volcanic plume rise height |

### Part V — Climate & Atmosphere Advanced (Tools 96–110) · 3 Domains

| Domain | Tools | Topics |
|---|---|---|
| Climate Dynamics & Feedback | 96–101 | Global energy balance model, equilibrium climate sensitivity, Planck feedback parameter, Rossby wave phase speed, baroclinic instability condition, baroclinic growth rate (Eady) |
| Atmospheric Dynamics & Turbulence | 102–107 | Quasi-geostrophic potential vorticity, turbulent velocity field decomposition (Reynolds), Ekman layer depth, convective velocity scale (Deardorff), frontogenesis rate, vorticity tendency |
| Cloud Physics & Precipitation | 108–110 | Equilibrium saturation over droplet (Köhler), drop size distribution, radar reflectivity → rain rate (Z-R) |

### Part VI — Space Environment & Satellite (Tools 111–130) · 4 Domains

| Domain | Tools | Topics |
|---|---|---|
| Geodesy & Reference Frames | 111–115 | Earth rotation matrix (IAU-2006), solid earth tide displacement, geopotential from spherical harmonics, 7-parameter Helmert transform, orthometric height from GPS |
| Thermosphere, Ionosphere & Magnetosphere | 116–122 | Thermospheric density profile (NRLMSISE-00), ionospheric electron density (IRI-2016), Joule heating rate, scintillation index S4, magnetopause standoff distance, pressure-corrected Dst, plasma Debye length |
| Satellite Dynamics & Space Debris | 123–127 | Satellite drag acceleration, orbital decay from drag, conjunction collision probability, Kessler debris cascade, relative orbit motion (Clohessy-Wiltshire) |
| Solar-Terrestrial & GNSS | 128–130 | Kp geomagnetic index, GNSS dilution of precision (DOP), tropospheric delay for GNSS |

### Part VII — Advanced Engineering & Risk (Tools 131–150) · 5 Domains

| Domain | Tools | Topics |
|---|---|---|
| Groundwater & Subsurface | 131–134 | Steady-state well discharge (Thiem), transient well drawdown (Theis), straight-line well test (Jacob), infiltration capacity over time (Horton) |
| Hazard, Risk & Disaster Engineering | 135–140 | Disaster risk index, expected annual flood damage, air quality index, probable maximum precipitation (PMP), Palmer drought severity index (PDSI), dam breach parameters |
| Data Assimilation & State Estimation | 141–144 | Ensemble Kalman filter (EnKF), optimal interpolation, 4D-Var assimilation cost, Shannon information entropy |
| Signal Processing & Communications | 145–147 | Free-space RF path loss (Friis), ionospheric delay (Klobuchar), frequency shift from relative velocity (Doppler) |
| Mathematical Frameworks | 148–150 | Hohmann transfer Δv, Lagrange point positions, mutual information between variables |

---

## Key Features

- **150 non-ML equations** — every model is derived from a peer-reviewed paper, textbook, or authoritative standard
- **26 domains** — atmospheric, oceanic, seismic, cryospheric, space, and beyond
- **7-part structure** — logically grouped from Earth system core to advanced engineering
- **7-stage workflow** — input validation → preprocessing → computation → post-processing → quality control → uncertainty estimation → interpretation
- **Real-data context** — every model receives live context (weather, terrain, ocean, seismic) from 30+ data feeds
- **Literature-indexed** — 82 models cite a resolvable DOI; the rest cite books (ISBN), standards, or pre-DOI classics, each flagged in-source with its reference PDF archived under `docs/Research papers/`

---

## 7-Stage Workflow

Defined in `server/analytical-models/toolWorkflows.ts` (preceded by live-data context enrichment in `contextEngine.ts`):

| Stage | Description |
|---|---|
| 1. Input validation | Range, type, and physical-plausibility checks |
| 2. Preprocessing | Unit conversion, derived-parameter computation |
| 3. Computation | The source equation (`engine.ts`) |
| 4. Post-processing | Classification, unit normalisation |
| 5. Quality control | Result sanity checks, outlier detection |
| 6. Uncertainty estimation | Error propagation / empirical RMSE |
| 7. Interpretation | Contextual analysis + scientific recommendations |