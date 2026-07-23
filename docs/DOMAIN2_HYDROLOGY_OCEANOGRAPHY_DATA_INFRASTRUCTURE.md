# Domain 2 — Hydrology & Oceanography (Equations 9-18)
## Complete Scientific Data Infrastructure

> Based on original research papers and official documentation from NASA, NOAA, ECMWF, FAO, USGS, ESA, and peer-reviewed literature.

---

## Table of Contents
1. [Variable Inventory](#1-variable-inventory)
2. [Eq 9 — FAO-56 Penman-Monteith Reference ET](#2-eq-9--fao-56-penman-monteith-reference-et)
3. [Eq 10 — SCS Curve Number Runoff](#3-eq-10--scs-curve-number-runoff)
4. [Eq 11 — Manning's Open Channel Flow](#4-eq-11--mannings-open-channel-flow)
5. [Eq 12 — Rational Method Peak Discharge](#5-eq-12--rational-method-peak-discharge)
6. [Eq 13 — Muskingum Flood Routing](#6-eq-13--muskingum-flood-routing)
7. [Eq 14 — Tide Prediction (Harmonic Analysis)](#7-eq-14--tide-prediction-harmonic-analysis)
8. [Eq 15 — Ekman Wind-Driven Current](#8-eq-15--ekman-wind-driven-current)
9. [Eq 16 — Geostrophic Current](#9-eq-16--geostrophic-current)
10. [Eq 17 — Ocean Surface Heat Budget](#10-eq-17--ocean-surface-heat-budget)
11. [Eq 18 — Green-Ampt Infiltration](#11-eq-18--green-ampt-infiltration)
12. [Data Availability Matrix](#12-data-availability-matrix)
13. [References](#13-references)

---

## 1. Variable Inventory

### Complete Variable List

| Variable | Eq(s) | Physical Meaning | Units | Source Type | Best Dataset |
|----------|-------|------------------|-------|-------------|--------------|
| Rn | 9, 59 | Net radiation at surface | W/m2 | Reanalysis | ERA5 / GLDAS |
| G | 9, 59 | Soil heat flux density | W/m2 | Reanalysis | GLDAS |
| T | 9 | Air temperature at 2m | deg C | Observed | ERA5 / Open-Meteo |
| u2 | 9 | Wind speed at 2m height | m/s | Observed | ERA5 / Open-Meteo |
| es | 9 | Saturation vapor pressure | kPa | Derived | Magnus-Tetens |
| ea | 9 | Actual vapor pressure | kPa | Derived | From RH |
| Delta | 9 | Slope of saturation vapor pressure curve | kPa/C | Derived | From T |
| gamma | 9 | Psychrometric constant | kPa/C | Derived | From P |
| P | 10, 12 | Precipitation | mm | Satellite/Gauge | GPM IMERG / ERA5 |
| Ia | 10 | Initial abstraction | mm | Derived | 0.2*S |
| S | 10 | Potential retention | mm | Derived | From CN |
| CN | 10 | Curve number | - | Static lookup | Land cover + soil |
| n | 11 | Manning's roughness coefficient | - | Static lookup | Land cover |
| R | 11 | Hydraulic radius | m | Derived/field | Channel geometry |
| S | 11 | Channel slope | m/m | DEM | SRTM / NASADEM |
| C | 12 | Runoff coefficient | - | Static lookup | Land cover + soil |
| i | 12 | Rainfall intensity | mm/h | Satellite | GPM IMERG |
| A | 12 | Catchment area | km2 | DEM | HydroSHEDS |
| K | 13 | Storage constant | hours | Calibrated | Stream gauge |
| X | 13 | Weighting factor | - | Calibrated | Stream gauge |
| It | 13 | Inflow at time t | m3/s | Gauge | USGS NWIS |
| Ot | 13 | Outflow at time t | m3/s | Gauge | USGS NWIS |
| H0 | 14 | Mean sea level | m | Tide gauge/sat | AVISO / NOAA |
| amplitude | 14 | Tidal constituent amplitude | m | Derived | FES2014 / TPXO |
| tau | 15 | Wind stress | N/m2 | Derived | ERA5 / scatterometer |
| rho | 15, 16 | Seawater density | kg/m3 | Derived | TEOS-10 / HYCOM |
| f | 15, 16 | Coriolis parameter | 1/s | Derived | Geographic calc |
| Av | 15 | Eddy viscosity | m2/s | Model | HYCOM |
| dp/dx | 16 | Pressure gradient | Pa/m | Derived | HYCOM / AVISO SSH |
| Qs | 17 | Shortwave radiation flux | W/m2 | Satellite | CERES / ERA5 |
| Qb | 17 | Longwave radiation flux | W/m2 | Satellite | CERES / ERA5 |
| Qh | 17 | Sensible heat flux | W/m2 | Reanalysis | ERA5 / OAFlux |
| Qe | 17 | Latent heat flux | W/m2 | Reanalysis | ERA5 / OAFlux |
| Ks | 18 | Saturated hydraulic conductivity | m/s | Static soil | SoilGrids |
| psi_w | 18 | Wetting front suction head | m | Static soil | SoilGrids |
| psi_0 | 18 | Initial matric potential | m | Static soil | SoilGrids |
| delta_theta | 18 | Moisture deficit | - | Derived | Soil moisture |
| F(t) | 18 | Cumulative infiltration | m | Derived | Time integration |

---

## 2. Eq 9 — FAO-56 Penman-Monteith Reference ET

**Reference:** Allen, R.G. et al. (1998). Crop Evapotranspiration — Guidelines for Computing Water Requirements. FAO Irrigation and Drainage Paper 56.

### Required Variables

| Variable | Meaning | Units | Source | Dataset | Access |
|----------|---------|-------|--------|---------|--------|
| **Rn** | Net radiation at crop surface | W/m2 | Reanalysis/satellite | **ERA5** (ssr, str) or **GLDAS** (Swnet_tavg + Lwnet_tavg) or **CERES** | CDS API / GES DISC |
| **G** | Soil heat flux density | W/m2 | Land surface model | **GLDAS-2.1 Noah** (Qg_tavg) | GES DISC |
| **T** | Air temperature at 2m | deg C | Reanalysis/obs | **ERA5** (t2m) or **Open-Meteo** | CDS API / REST |
| **u2** | Wind speed at 2m | m/s | Reanalysis/obs | **ERA5** (si10 → u2 conversion) | CDS API |
| **es** | Saturation vapor pressure | kPa | Derived | From T using Magnus-Tetens | Derived |
| **ea** | Actual vapor pressure | kPa | Derived | es * RH/100 | Derived |
| **Delta** | Slope of es curve | kPa/C | Derived | 4098*es/(T+237.3)^2 | Derived |
| **gamma** | Psychrometric constant | kPa/C | Derived | 0.665e-3 * P | Derived |

### Candidate Datasets (ranked)

**Tier 1 — ERA5 (highest scientific quality):**
- Net radiation: `ssr` (surface net solar radiation, J/m2, accumulation), `str` (surface net thermal radiation, J/m2)
- Convert to W/m2: divide by accumulation period (3600 s for hourly)
- Temperature: `t2m` (K)
- Wind: `si10` (10m wind speed, m/s) → convert to 2m: u2 = u10 * 4.87 / ln(67.8*10 - 5.42)
- Vapor pressure: from `d2m` (2m dewpoint temperature) or `q` (specific humidity)
- Spatial: 0.25 deg global, hourly, 1940-present
- Access: Copernicus CDS API (free, registration required)
- Latency: ~3 months (final), ~5 days (ERA5T)

**Tier 2 — Open-Meteo (best for NRT):**
- Directly provides `et0_fao_evapotranspiration` (mm/day) as computed output
- Also provides `shortwave_radiation`, `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`
- Free REST API, no key required
- Latency: real-time (forecast) / hourly (ERA5 archive)

**Tier 3 — GLDAS (best for land surface energy balance):**
- `SWnet_tavg` + `LWnet_tavg` → net radiation
- `Qg_tavg` → soil heat flux
- 0.25 deg, 3-hourly, 2000-present
- Access: NASA GES DISC (Earthdata login)

---

## 3. Eq 10 — SCS Curve Number Runoff

**Reference:** USDA Soil Conservation Service (1954). National Engineering Handbook, Section 4: Hydrology.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **P** (precipitation) | **GPM IMERG** (Final Run) | 0.1 deg, 30-min, 2000-present, ~3.5 mo latency |
| | **Open-Meteo** (NRT) | Forecast/ERA5, hourly |
| | **ERA5** | Total precipitation, hourly, 0.25 deg |
| **CN** (curve number) | **ESA WorldCover** (land use) + **ISRIC SoilGrids** (soil type) | Lookup table per USDA NEH-4 |
| **Ia, S** | Derived | S = 25400/CN - 254, Ia = 0.2*S |

### Land Cover for CN

| Dataset | Details |
|---------|---------|
| **ESA WorldCover 2021** | 10 m resolution, 11 land cover classes, open license |
| **MODIS MCD12Q1** | 500 m, yearly, IGBP classification |
| **Copernicus CGLS-LC100** | 100 m, yearly, 2015-2019 |

Access: ESA WorldCover via REST API (`worldcover.esa.int/api/v1/classify`)

### Soil Data for CN

| Dataset | Details |
|---------|---------|
| **ISRIC SoilGrids v2.0** | 250 m, global, texture (clay/sand/silt %) |
| **USDA NRCS Web Soil Survey** | US only, detailed SSURGO |
| **FAO Harmonized World Soil Database** | ~1 km, 30 cm depth |

### CN Lookup Table
The standard NRCS CN lookup combines:
1. Hydrologic soil group (A, B, C, D) from SoilGrids texture
2. Land cover class from WorldCover
3. Antecedent moisture condition (AMC I/II/III) from prior 5-day precipitation

---

## 4. Eq 11 — Manning's Open Channel Flow

**Reference:** Manning, R. (1891). On the flow of water in open channels and pipes. *Trans. ICEI*, 20, 161-207.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **n** (roughness) | Lookup from land cover | Chow (1959) tables, ESA WorldCover |
| **R** (hydraulic radius) | Channel geometry / field | Cross-section surveys or regional curves |
| **S** (slope) | **NASADEM** / **SRTM** | 30 m DEM → slope from stream profile |

---

## 5. Eq 12 — Rational Method Peak Discharge

**Reference:** Mulvaney, T.J. (1851). On the use of self-registering rain and flood gauges. *J. ICEI*, 4, 18-31.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **C** (runoff coefficient) | Lookup: land cover + slope + soil | Standard engineering tables |
| **i** (rainfall intensity) | **GPM IMERG** (mm/h), 0.1 deg, 30-min | OR ** IDF curves** (local engineering) |
| **A** (catchment area) | **HydroSHEDS** / **MERIT Hydro** | 90 m / 3 arc-sec global drainage areas |

**Key datasets:**
- **HydroSHEDS** (hydrological data and maps based on SHuttle Elevation Derivatives at multiple Scales): 15 arc-sec (450 m) to 3 arc-sec (90 m), drainage direction/accumulation
- **MERIT Hydro**: 3 arc-sec (90 m) global hydrography, improved over HydroSHEDS
- **Catchment boundaries**: HydroBASINS (HydroSHEDS derived basins)

---

## 6. Eq 13 — Muskingum Flood Routing

**Reference:** McCarthy, G.T. (1938). The unit hydrograph and flood routing. Conf. North Atlantic Division, USACE.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **K** (storage constant) | Calibrated from stream gauge | USGS NWIS or global GRDC |
| **X** (weighting factor) | Calibrated (0-0.5) | Default 0.2 for natural channels |
| **It** (inflow time series) | **USGS NWIS** or **GRDC** | Real-time streamflow |
| **Ot** (outflow time series) | **USGS NWIS** | Real-time downstream stage |

**Stream gauge data:**
- **USGS NWIS** (US only): REST API, 15-min streamflow, 00060 parameter code
- **Global Runoff Data Centre (GRDC)**: 9,500+ stations globally, daily/monthly, registration required
- **WMO Global Telecommunication System (GTS)**: real-time river levels

---

## 7. Eq 14 — Tide Prediction (Harmonic Analysis)

**Reference:** Pugh, D. & Woodworth, P. (2014). Sea-Level Science. Cambridge University Press.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **H0** (mean sea level) | **AVISO** satellite altimetry or **NOAA tide gauges** | |
| **Amplitude** (constituents) | **FES2014** global tide model or **TPXO9** | Harmonic constituents |

**Tide data sources:**

| Dataset | Provider | Type | Resolution | Coverage | Access |
|---------|----------|------|------------|----------|--------|
| **FES2014** | AVISO+/CNES | Global tide model (finite element) | 1/16 deg | Global ocean | AVISO FTP |
| **TPXO9** | Oregon State | Global inverse tide model | 1/30 deg | Global ocean | OSU THREDDS |
| **GOT4.10c** | NASA GSFC | Empirical tide model | 0.5 deg | Global ocean | NASA |
| **EOT20** | DGFI-TUM | Empirical ocean tide model | 0.125 deg | Global | Open access |
| **NOAA Tides & Currents** | NOAA NOS | Tide gauge observations | Point | US coasts | REST API |
| **GESLA-3** | Multiple | Global tide gauge compendium | Point | Global coasts | Open |

**NOAA Tides & Currents API:**
- `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` with `date`, `station`, `product=predictions`, `datum=MLLW`, `units=metric`
- Returns harmonic constituents: `product=constituents`

---

## 8. Eq 15 — Ekman Wind-Driven Current

**Reference:** Ekman, V.W. (1905). On the influence of the Earth's rotation on ocean-currents. *Arkiv for Matematik, Astronomi och Fysik*, 2(11), 1-52.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **tau** (wind stress) | Derived from wind: tau = rho_air * Cd * u10^2 | Cd = 0.0013 (Large & Pond) |
| **rho** (seawater density) | **HYCOM** or **TEOS-10** from T,S profiles | |
| **f** (Coriolis) | Derived from latitude | |
| **Av** (eddy viscosity) | **HYCOM** or parameterized: Av ~ 0.01 m2/s | Typical range 0.001-0.1 |

**Wind data for wind stress:**
- **ERA5**: 10m u/v wind components, surface stress (`ewss`, `nsss` accumulations), 0.25 deg, hourly
- **Open-Meteo Marine API**: wind_wave_height (proxy), ocean_current_velocity
- **HYCOM**: 3-hourly surface fields, 1/12 deg, NRT (48h latency)
- **CCMP Wind**: Cross-Calibrated Multi-Platform wind, 0.25 deg, 6-hourly, 1987-present

**Seawater density from HYCOM:**
- Temperature, salinity at surface → density via TEOS-10
- HYCOM provides `water_temp` and `salinity` at standard levels
- Access: HYCOM THREDDS (OPeNDAP), NRT and reanalysis

---

## 9. Eq 16 — Geostrophic Current

**Reference:** Gill, A.E. (1982). Atmosphere-Ocean Dynamics. Academic Press.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **dp/dx** (pressure gradient) | Derived from sea surface height (SSH) | AVISO / CMEMS altimetry |
| **rho** (seawater density) | **HYCOM** / **WOA** | |
| **f** (Coriolis) | From latitude | |

**Sea Surface Height / Dynamic Topography:**

| Dataset | Provider | Resolution | Latency | Access |
|---------|----------|------------|---------|--------|
| **CMEMS SEALEVEL_GLO_PHY_L4_MY_008_047** | Copernicus | 0.25 deg, daily | ~2 months | CMEMS |
| **AVISO DT2018** | AVISO+/CNES | 0.25 deg, daily | ~5 days | AVISO FTP |
| **NOAA OISST** | NOAA NCEI | 0.25 deg, daily | ~1 day | ERDDAP |
| **Jason-3/G2/FY-3E** | NASA/NOAA | Along-track, 10-day repeat | ~6h | PODAAC |

**Geostrophic velocity calculation:**
- u_g = -(g/f) * d(SSH)/dy
- v_g = (g/f) * d(SSH)/dx
- g = 9.80665 m/s2

---

## 10. Eq 17 — Ocean Surface Heat Budget

**Reference:** Gill, A.E. (1982). Atmosphere-Ocean Dynamics, Chapter 3.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **Qs** (shortwave) | **CERES** SYN1deg | 1 deg, 3-hourly, all-sky + clear-sky |
| | **ERA5** (msdrswrf) | Mean surface downward shortwave radiation flux |
| **Qb** (longwave) | **CERES** SYN1deg | 1 deg, 3-hourly |
| | **ERA5** (msdwlwrf) | Mean surface downward longwave radiation flux |
| **Qh** (sensible) | **ERA5** (sshf) | Surface sensible heat flux (negative upward) |
| | **OAFlux** | Objectively Analyzed air-sea heat fluxes, 1 deg, daily |
| **Qe** (latent) | **ERA5** (slhf) | Surface latent heat flux |
| | **OAFlux** | |

**Key Ocean Heat Budget Datasets:**

| Dataset | Variables | Resolution | Period | Access |
|---------|-----------|------------|--------|--------|
| **CERES EBAF-Surface** | SW↑↓, LW↑↓, net radiation | 1 deg, monthly | 2000-present | CERES website |
| **ERA5** | All surface fluxes | 0.25 deg, hourly | 1940-present | CDS API |
| **OAFlux v3** | Qh, Qe, evaporation | 1 deg, daily | 1958-present | WHOI OAFlux |
| **GLDAS-2.1** | Net radiation, heat fluxes | 0.25 deg, 3-hourly | 2000-present | GES DISC |

**Net heat flux:**
- Q_net = Qs(1-alpha) + Qb_in - Qb_out - Qh - Qe
- SST tendency: dSST/dt = Q_net / (rho * cp * H_mix)

---

## 11. Eq 18 — Green-Ampt Infiltration

**Reference:** Green, W.H. & Ampt, G.A. (1911). Studies on Soil Physics. *J. Agricultural Science*, 4(1), 1-24.

### Required Variables

| Variable | Source | Details |
|----------|--------|---------|
| **Ks** (sat. hydraulic conductivity) | **ISRIC SoilGrids** | Derived from texture, bulk density, SOC |
| **psi_w** (wetting front suction) | **ISRIC / USDA tables** | From texture class and porosity |
| **psi_0** (initial matric potential) | Derived from soil moisture | From SoilGrids or satellite SM |
| **delta_theta** (moisture deficit) | Derived | theta_s - theta_i (from SoilGrids + SM) |
| **F(t)** (cumulative infiltration) | Time integration | Re-derived each time step |

**Soil hydraulic parameters from SoilGrids:**
- Clay, sand, silt fractions → estimated Ks using pedotransfer functions (Rosetta, Saxton-Rawls)
- Saturated water content theta_s from bulk density: theta_s = 1 - BD/2.65
- Field capacity and wilting point from texture

**Pedotransfer function (Saxton & Rawls, 2006):**
```
theta_s = 0.332 - 0.0007251*%sand + 0.0001276*%silt + ... (simplified)
psi_w = exp(5.340 + 0.185*%clay - 2.484*porosity) / 100  (meters)
Ks = exp(12.012 - 0.0755*%sand + ... ) / 3600000  (m/s, simplified)
```

**SoilGrids access:**
- REST API: `https://rest.isric.org/soilgrids/v2.0/properties/query?lon={lon}&lat={lat}&property={clay,sand,silt,soc,bdod,cec}&depth=0-5cm`
- Returns mean and uncertainty for each property

---

## 12. Data Availability Matrix

| Variable | Real-Time (<1h) | NRT (1h-1d) | Historical (days) | Static |
|----------|----------------|-------------|-------------------|--------|
| Precipitation (IMERG Early) | No | Yes (4h) | Yes | No |
| Precipitation (IMERG Final) | No | No | Yes (3.5mo) | No |
| ERA5 surface fluxes | No | No | Yes (3mo) | No |
| ERA5T (NRT) | No | Yes (5d) | No | No |
| Open-Meteo forecast | Yes | Yes | Yes (ERA5 archive) | No |
| GLDAS evapotranspiration | No | Yes (1.5mo EP) | Yes | No |
| GPM IMERG precipitation | No | Yes (4h Early) | Yes (Final) | No |
| USGS streamflow (NWIS) | Yes | Yes (15-min) | Yes | No |
| GRDC streamflow | No | No | Yes (months) | No |
| CMEMS sea surface height | No | Yes (2d NRT) | Yes | No |
| HYCOM ocean currents | No | Yes (48h) | Yes | No |
| AVISO altimetry | No | Yes (5d) | Yes | No |
| CERES radiation | No | No | Yes (months) | No |
| OAFlux heat fluxes | No | No | Yes (months) | No |
| SoilGrids (soil properties) | No | No | No | **Yes (static)** |
| ESA WorldCover (land cover) | No | No | No | **Yes (2021)** |
| HydroSHEDS / MERIT Hydro | No | No | No | **Yes (static)** |
| FES2014 tidal constituents | No | No | No | **Yes (static)** |
| NOAA tide predictions | Yes (forecast) | Yes | Yes | No |
| NASADEM elevation | No | No | No | **Yes (static)** |

### NRT Capability Gaps

1. **Evapotranspiration (Eq 9)** — No direct NRT satellite ET product exists at field scale. **Open-Meteo provides ET0** as computed output. GLDAS Early Product has ~1.5mo latency.

2. **Soil heat flux G (Eq 9)** — Not directly measured by satellites. Must use land surface models (GLDAS, ERA5-Land). Only available historically.

3. **Curve Number (Eq 10)** — Static lookup table. CN varies with antecedent moisture but no global NRT CN product exists.

4. **Tidal harmonics (Eq 14)** — Static constituent database (FES2014). Real-time tide prediction is computed from these constituents, not measured in real time.

5. **Ocean heat fluxes (Eq 17)** — Satellite net radiation available in NRT (CERES has latency). Surface turbulent fluxes (Qh, Qe) require bulk formulae with NRT winds and humidity.

---

## 13. References

### Original Research Papers

1. Allen, R.G. et al. (1998). Crop Evapotranspiration — Guidelines for Computing Water Requirements. FAO Irrigation and Drainage Paper 56. FAO Rome.
2. USDA Soil Conservation Service (1954). National Engineering Handbook, Section 4: Hydrology.
3. Manning, R. (1891). On the flow of water in open channels and pipes. *Trans. ICEI*, 20, 161-207.
4. Mulvaney, T.J. (1851). On the use of self-registering rain and flood gauges. *J. ICEI*, 4, 18-31.
5. McCarthy, G.T. (1938). The unit hydrograph and flood routing. Conf. North Atlantic Division, USACE.
6. Pugh, D. & Woodworth, P. (2014). Sea-Level Science. Cambridge University Press.
7. Ekman, V.W. (1905). On the influence of the Earth's rotation on ocean-currents. *Arkiv for Matematik, Astronomi och Fysik*, 2(11), 1-52.
8. Gill, A.E. (1982). Atmosphere-Ocean Dynamics. Academic Press.
9. Green, W.H. & Ampt, G.A. (1911). Studies on Soil Physics. *J. Agricultural Science*, 4(1), 1-24.

### Dataset Documentation

10. Huffman, G.J. et al. (2023). GPM IMERG Final Precipitation L3. NASA GES DISC. DOI: 10.5067/GPM/IMERGDF/DAY/07
11. Hersbach, H. et al. (2020). The ERA5 global reanalysis. *QJRMS*, 146, 1999-2049. DOI: 10.1002/qj.3803
12. Beaudoing, H. & Rodell, M. (2020). GLDAS Noah L4 V2.1. NASA GES DISC. DOI: 10.5067/E7TYRXPJKWOQ
13. Hulley, G. et al. (2015). ASTER GED. *GRL*, 42. DOI: 10.1002/2015GL065564
14. Zanaga, D. et al. (2022). ESA WorldCover 10m 2021. DOI: 10.5281/zenodo.7254221
15. Poggio, L. et al. (2021). SoilGrids 2.0. *SOIL*, 7, 217-240. DOI: 10.5194/soil-7-217-2021
16. Yamazaki, D. et al. (2019). MERIT Hydro. *Water Resources Research*, 55. DOI: 10.1029/2019WR024873
17. Lyard, F. et al. (2021). FES2014 global ocean tide atlas. *Ocean Dynamics*, 71, 57-81.
18. Saxton, K.E. & Rawls, W.J. (2006). Soil water characteristic estimates by texture and organic matter. *SSSAJ*, 70, 1569-1578.
