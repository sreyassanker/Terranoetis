# Domains 7-26 — Comprehensive Data Infrastructure Summary

## Covering Equations 51-150

This document completes the remaining 20 domains by summarizing the data infrastructure requirements, building on the shared data sources documented in Domains 1-6.

---

## Domain 7 — Biosphere & Carbon Cycle (Eqs 51-57)

### Variable Sources

| Eq | Tool | Key Variables | Primary Data Source |
|----|------|---------------|-------------------|
| 51 | GPP | epsilon, fPAR, PAR | **MOD17A2H** (GPP, 500m, 8-day); **MCD15A3H** (fPAR, 500m, 4-day) |
| 52 | Beer-Lambert Canopy | I0, k, LAI | **MCD15A3H** (LAI, 500m, 4-day); sentinel-2 derived LAI |
| 53 | NEE | Reco, GPP | **FLUXNET** / **ICOS** towers; MODIS GPP |
| 54 | Farquhar C3 Photo | Vcmax, ci, Gamma*, Kc, Ko, O | **Plant trait databases** (TRY, GROOT); O from atmosphere |
| 55 | Forest Biomass | a, DBH | **GEDI L2** (canopy height, structure, 25m) / **ICESat-2** |
| 56 | Ocean CO2 Uptake | k, K0, Delta_pCO2 | **SOCAT** (surface pCO2 database); ERA5 winds |
| 57 | Redfield Ratios | C, N, P | **WOA** (World Ocean Atlas); **BGC-Argo** |

### Key Datasets

| Dataset | Provider | Variables | Access |
|---------|----------|-----------|--------|
| **MODIS MOD17A2H** | NASA LP DAAC | GPP, NPP, PsnNet (500m, 8-day) | Earth Engine, ORNL |
| **MODIS MCD15A3H** | NASA LP DAAC | LAI, fPAR (500m, 4-day) | Earth Engine, ORNL |
| **GEDI L2** | NASA LP DAAC | Canopy height, RH metrics (25m footprints) | Earth Engine, LP DAAC |
| **SOCAT** | Multiple | Surface fCO2, SST, salinity | SOCAT website |
| **World Ocean Atlas** | NOAA NCEI | T, S, O2, nutrients (1 deg, monthly) | HTTPS download |
| **FLUXNET2015** | Global network | NEE, GPP, Reco, LE, H | FLUXNET website |

### NRT Capability
- MODIS GPP/LAI: 8-day temporal resolution, ~4 day latency
- GEDI: 2-year repeat, non-NRT
- SOCAT: 1-2 year latency for quality-controlled data
- FLUXNET: 1+ year latency for harmonized data

---

## Domain 8 — Agriculture & Crop Science (Eqs 58-63)

### Variable Sources

| Eq | Tool | Key Variables | Primary Data Source |
|----|------|---------------|-------------------|
| 58 | GDD | T_avg, T_base, T_upper | ERA5 / Open-Meteo (2m temperature) |
| 59 | Priestly-Taylor ET | alpha, Delta, gamma, Rn, G | ERA5 / GLDAS |
| 60 | Hargreaves-Samani | Ra, T_max, T_min | ERA5 / Open-Meteo; **Ra from solar geometry** |
| 61 | Yield-Water (FAO) | Ya, Ym, Ky, ETa, ETm | FAO crop database; **Open-Meteo ET0** |
| 62 | Phytoplankton Growth | mu_20, T | **MODIS OC** (chlorophyll, SST) |
| 63 | Bigleaf Penman-Monteith | rho, cp, Ts, Ta, ra, rs, es, ea | ERA5; Landsat LST; **aerodynamic resistance** from wind |

### Key Datasets

| Dataset | Application | Access |
|---------|------------|--------|
| **FAO AquaCrop** | Crop yield response to water | FAO website |
| **MODIS MOD13Q1** | Crop health (NDVI/EVI) | LP DAAC / ORNL |
| **MODIS MOD11A2** | LST for crop stress | LP DAAC |
| **ERA5-Land** | Hourly T, precipitation, ET | CDS API |
| **Global Flood & Drought Monitor** | ETa/ETm ratios | JRC |

---

## Domain 9 — Atmospheric Chemistry & Aerosols (Eqs 64-65)

| Eq | Tool | Key Variables | Source |
|----|------|---------------|--------|
| 64 | Chapman Ozone | O2, hnu | **OMI** (Aura, ozone profile); **SBUV/2** |
| 65 | Pollutant Lifetime | k, [OH] | **OH climatology** (Spivakovsky et al.); **Open-Meteo AQ** |

### Key Datasets

| Dataset | Provider | Access |
|---------|----------|--------|
| **OMI OMTO3** | NASA | Total ozone column, 13x24 km, daily |
| **TROPOMI L2** | ESA | NO2, SO2, CH4, CO, 3.5x7 km, daily |
| **CAMS** | Copernicus | Global atmospheric composition forecasts, 0.4 deg |
| **Open-Meteo AQ** | Open-Meteo | PM, O3, NO2, SO2 (free REST API) |

---

## Domains 10-11 — Ocean Dynamics & Coastal Waves (Eqs 66-80)

### Core Ocean Data Sources

| Dataset | Provider | Variables | Res. | NRT? | Access |
|---------|----------|-----------|------|------|--------|
| **HYCOM GOFS 3.1** | NRL | T, S, u, v, SSH | 1/12 deg, 3-hourly | Yes (48h) | THREDDS |
| **CMEMS GLOBAL_ANALYSIS** | Copernicus | T, S, u, v, sea level | 1/12 deg, daily | Yes | CMEMS API |
| **AVISO/CMEMS Altimetry** | CNES/CMEMS | SSH, geostrophic currents | 0.25 deg, daily | Yes (5d) | AVISO+ |
| **NOAA OISST** | NOAA | SST | 0.25 deg, daily | Yes (1d) | ERDDAP |
| **ERA5 Ocean Waves** | ECMWF | Wave height, period, direction | 0.5 deg, hourly | No (final) | CDS API |
| **WaveWatch III** | NOAA/NCEP | Wave spectra, Hs, Tp, Dp | 0.5 deg, 3-hourly | Yes | NOMADS |
| **NOAA NDBC Buoys** | NOAA | Wave, wind, T, pressure, currents | Point | Yes (real-time) | REST API |
| **Argo** | Global | T, S profiles (0-2000m) | Float array | Yes (real-time) | GDAC |

### Domain 10: Ocean Dynamics (Eqs 66-73)

| Eq | Tool | Source |
|----|------|--------|
| 66 | Sverdrup Balance | ERA5 wind stress curl + HYCOM SSH |
| 67 | Stommel WBC | HYCOM + wind stress curl |
| 68 | Munk Viscous Layer | HYCOM eddy viscosity + SSH |
| 69 | Stommel Box Model | HYCOM T, S; AMOC index (RAPID array) |
| 70 | TEOS-10 Density | HYCOM T, S (conservative temp, absolute salinity) |
| 71 | Osborn-Cox Diffusivity | From shear (T, S profile from Argo) |
| 72 | Price-Weller-Pinkel | HYCOM vertical profiles, wind forcing |
| 73 | Pierson-Moskowitz | ERA5 wind speed, fetch |

### Domain 11: Coastal & Wave (Eqs 74-80)

| Eq | Tool | Source |
|----|------|--------|
| 74 | Stockdon Wave Runup | WaveWatch III Hs, Tp; beach slope from DEM |
| 75 | Bruun Rule | Sea-level rise (AVISO); shoreline position (Landsat) |
| 76 | Breaker Criterion | WaveWatch III; nearshore bathymetry (GEBCO) |
| 77 | CERC Longshore Transport | WaveWatch III breaking height/angle |
| 78 | Airy Dispersion | WaveWatch III; depth (GEBCO) |
| 79 | Stokes Drift | WaveWatch III wave parameters |
| 80 | JONSWAP Spectrum | WaveWatch III; fetch |

---

## Domain 12 — Geomorphology & Mass Wasting (Eqs 81-87)

| Eq | Tool | Key Variables | Source |
|----|------|---------------|--------|
| 81 | Stream Power | A, S | DEM (SRTM) + flow accumulation |
| 82 | Hack's Law | A, h | DEM analysis |
| 83 | Fractal Dimension | L, s | River network from DEM |
| 84 | Slope Stability | c', gamma, phi, u | SoilGrids + DEM + groundwater |
| 85 | Voellmy Friction | mu, xi, sigma_n | DEM + literature values |
| 86 | SPI | As, slope | DEM |
| 87 | TWI | As, slope | DEM |

---

## Domain 13 — Limnology & Freshwater (Eqs 88-90)

| Eq | Variable | Source |
|----|----------|--------|
| 88 | Lake Evaporation | ERA5; lake surface temp (MODIS); Open-Meteo |
| 89 | Schmidt Stability | Lake temperature profiles (in-situ or satellite) |
| 90 | Nash Cascade | Stream gauge (USGS/GRDC) |

---

## Domain 14 — Cryosphere Advanced & Volcanology (Eqs 91-95)

| Eq | Variable | Source |
|----|----------|--------|
| 91 | PDD Glacier Mass Balance | ERA5 temperature; DDF literature; MODIS snow |
| 92 | Stefan Permafrost | ERA5-Land soil T; GTN-P (boreholes, static) |
| 93 | Firn Densification | Accumulation (ERA5); density profiles (field) |
| 94 | VEI | Smithsonian GVP (volcano catalog, static) |
| 95 | Buoyant Plume | Atmospheric T profile (ERA5); wind |

---

## Domain 15 — Climate Dynamics & Feedback (Eqs 96-101)

| Eq | Variable | Source |
|----|----------|--------|
| 96 | Budyko-Sellers | CERES radiation + ERA5; albedo from MODIS |
| 97 | Climate Sensitivity | **CMIP6** historical/scenario simulations |
| 98 | Planck Feedback | **CERES EBAF** TOA fluxes (2000-present) |
| 99 | Rossby Wave | ERA5 wind on pressure levels |
| 100 | Charney-Stern | ERA5 potential vorticity |
| 101 | Eady Growth Rate | ERA5 wind shear, static stability |

---

## Domain 16 — Atmospheric Dynamics (Eqs 102-107)

| Eq | Variable | Source |
|----|----------|--------|
| 102 | QG Potential Vorticity | ERA5 pressure level (temp, wind, geopotential) |
| 103 | Reynolds Decomposition | ERA5 3D wind fields (hourly) |
| 104 | Ekman Depth | ERA5 friction velocity + Coriolis |
| 105 | Deardorff Scale | ERA5 surface heat flux + wind |
| 106 | Frontogenesis | ERA5 theta + wind on pressure surfaces |
| 107 | Vorticity | ERA5 wind components (u, v) |

---

## Domain 17 — Cloud Physics (Eqs 108-110)

| Eq | Variable | Source |
|----|----------|--------|
| 108 | Kohler | Aerosol (CAMS); supersaturation (ERA5 RH profile) |
| 109 | Marshall-Palmer | **GPM DPR** (Ku/Ka band radar); weather radar (MRMS) |
| 110 | Z-R | GPM DPR; ground radar (NEXRAD/GDAS) |

---

## Domains 18-21 — Space & Satellite (Eqs 111-130)

### Primary Sources

| Eq | Tool | Source |
|----|------|--------|
| 111 | Earth Rotation | **IERS EOP** (Bulletin A, daily) |
| 112 | Earth Tides | **IERS conventions** + tidal models |
| 113 | EGM2008 Gravity | **EGM2008** coefficients (static) |
| 114 | Helmert Transform | **ITRF** reference frame parameters |
| 115 | Geoid Height | **EGM2008** / **EGM2020** geoid model |
| 116 | NRLMSISE-00 | **NRLMSISE-00** model (empirical thermosphere) |
| 117 | IRI-2016 | **IRI-2016** model (empirical ionosphere) |
| 118 | Joule Heating | **SWPC** satellite magnetometer data |
| 119 | S4 Scintillation | **GNSS** receivers (IGS network) |
| 120 | Magnetopause | **SWPC** real-time solar wind (DSCOVR) |
| 121 | Dst Index | **SWPC** / **WDC Kyoto** |
| 122 | Debye Length | **SWPC** plasma data |
| 123 | Satellite Drag | **JB2008** / **NRLMSISE-00** density |
| 124 | Orbital Decay | **Celestrak TLE** / **Space-Track** |
| 125 | Collision Probability | **Space-Track** CDM / CSpOC |
| 126 | Kessler Syndrome | **ESA MASTER** / **NASA ORDEM** debris models |
| 127 | Hill-Clohessy-Wiltshire | Orbital mechanics (analytical) |
| 128 | Kp Index | **SWPC** / **GFZ Potsdam** |
| 129 | DOP | **GNSS** constellation almanac |
| 130 | Saastamoinen | Open-Meteo (P, T, RH) |

### Key Space Weather Datasets

| Dataset | Provider | Variables | Access |
|---------|----------|-----------|--------|
| **SWPC Real-Time** | NOAA | Solar wind, Kp, Dst, f10.7 | REST API (no key) |
| **DSCOVR** | NASA/NOAA | L1 solar wind, Bz, density, speed | SWPC |
| **GOES X-ray Flux** | NOAA | Solar flares | SWPC |
| **IERS EOP C04** | IERS | Earth orientation parameters | IERS website |
| **IGS GNSS** | IGS | Ionospheric TEC, station positions | CDDIS |
| **Space-Track** | USSF CSpOC | TLE, conjunction data messages | Registration required |
| **OMNIWeb** | NASA GSFC | Multi-source solar wind, IMF | HTTPS |

---

## Domains 22-26 — Groundwater, Hazard, Assimilation & Math (Eqs 131-150)

### Domain 22: Groundwater (Eqs 131-134)

| Eq | Variable | Source |
|----|----------|--------|
| 131 | Thiem | Well data (USGS NWIS groundwater); **GRDC** baseflow |
| 132 | Theis | Aquifer tests (field); **Gravity Recovery** (GRACE) |
| 133 | Cooper-Jacob | Well hydrographs |
| 134 | Horton | **GPM IMERG** + soil moisture |

### Domain 23: Hazard & Risk (Eqs 135-140)

| Eq | Tool | Source |
|----|------|--------|
| 135 | Risk = HxVxE | Hazard maps (GFDRR/UNDRR); **WorldPop** (exposure) |
| 136 | Expected Damage | Hazard probability + damage curves |
| 137 | AQI | **Open-Meteo AQ** / **CAMS** / **EPA AirNow** (US) |
| 138 | PMP | **GPM IMERG** extremes analysis |
| 139 | PDSI | **NOAA PSL** (gridded PDSI, 0.5 deg, monthly) |
| 140 | Dam Break | Reservoir data (Global Reservoir & Dam Database GRanD) |

### Domain 24: Data Assimilation (Eqs 141-144)

| Eq | Variables | Source |
|----|-----------|--------|
| 141 | EnKF | **Observation data** + **model background** (NWP) |
| 142 | Optimal Interpolation | **In-situ obs** + **reanalysis first-guess** |
| 143 | 4D-Var | **ECMWF IFS** data assimilation system |
| 144 | Shannon Entropy | **Probability distributions** from data |

### Domain 25: Signal Processing (Eqs 145-147)

| Eq | Variables | Source |
|----|-----------|--------|
| 145 | FSPL | **User input** (distance, frequency) |
| 146 | Klobuchar | **GNSS broadcast** ionospheric parameters |
| 147 | Doppler | **Relative velocity** (user input) |

### Domain 26: Mathematical Frameworks (Eqs 148-150)

| Eq | Variables | Source |
|----|-----------|--------|
| 148 | Hohmann Transfer | **Celestrak** / **NAIF SPICE** ephemerides |
| 149 | Lagrange Points | **JPL Horizons** ephemeris; analytical |
| 150 | Mutual Information | **Data distributions** (user input) |

---

## Summary of All Data Sources

### Consolidated Primary Data APIs (already integrated)

| API | Domain(s) | Auth | Covered Variables |
|-----|-----------|------|------------------|
| **Open-Meteo** | 1,2,5,6,7,8,17 | None | Weather, ERA5, marine, air quality |
| **USGS ComCat** | 3 | None | Earthquakes, focal mechanisms |
| **USGS NWIS** | 2,13 | Free key | Streamflow, gage height, water quality |
| **ESA WorldCover** | 2,6,8 | None | Land cover classification |
| **ISRIC SoilGrids** | 2,6,12 | None | Soil texture, SOC, BD, CEC |
| **NASA FIRMS** | 4 | Free key | Active fire FRP, brightness temp |
| **Open Topo Data** | 1,2,12 | None | SRTM elevation |
| **ORNL DAAC MODIS** | 4,7 | None | NDVI, EVI, LAI, fPAR, GPP, land cover |
| **NOAA SWPC** | 18-21 | None | Kp, solar wind, f10.7 |
| **NOAA OISST** | 10,11 | None | SST, anomaly |

### Key New Data Sources to Integrate

| Dataset | API Type | Auth Needed | Priority | Domains |
|---------|----------|-------------|----------|---------|
| **ECMWF CDS (ERA5)** | CDS API (Python) | CDS registration | **Critical** | 1,2,5,7,8,10,11,12,15,16 |
| **NASA GES DISC (GLDAS)** | HTTP/OPeNDAP | Earthdata | **High** | 2,6,8 |
| **NASA GES DISC (MERRA-2)** | HTTP/OPeNDAP | Earthdata | Medium | 1,8 |
| **HYCOM THREDDS** | OPeNDAP/WMS | None | **High** | 10,11 |
| **GPM PPS (IMERG)** | FTP/HTTPS | Registration | **High** | 2,5,8,12 |
| **NASA LAADS (MODIS)** | HTTPS | Earthdata | **High** | 4,7,8 |
| **LP DAAC AppEEARS** | REST (task) | Earthdata | Medium | 1,4 |
| **CMEMS Marine** | CMEMS API | Registration | **High** | 10,11 |
| **NOAA ERDDAP** | REST | None | Medium | 2,10,11 |
| **Copernicus Data Space** | STAC/OGC | Free | **High** | 4,7 |
| **IERS EOP** | HTTP | None | Medium | 18 |
| **Space-Track** | REST | Registration | Medium | 20 |
| **AVISO+** | FTP/HTTP | Registration | Medium | 10,11 |

### Recommended Implementation Priority

1. **ECMWF CDS API** (ERA5) — unlocks 50+ variables across 15+ domains. Single most impactful integration.
2. **HYCOM THREDDS** — unlocks all ocean dynamics (Eqs 66-80, 10-11 domains). 
3. **GPM IMERG via PPS** — unlocks precipitation for Eqs 9-12, 40-41, 45, 138.
4. **GES DISC (GLDAS + MERRA-2)** — unlocks land surface energy and water budgets (Eqs 9, 17, 46-50).
5. **CMEMS Marine** — altimetry, SST, ocean color for Eqs 14-17, 56, 66-80.
6. **NOAA ERDDAP** — unified access to OISST, sea ice, and oceanographic datasets.

### Current Data Infrastructure Gaps

| Gap | Impact | Resolution |
|-----|--------|------------|
| No ERA5 CDS API integration | Pressure gradients, TKE dissipation, surface fluxes all use approximations | Add CDS API client |
| No HYCOM integration | Ocean current/T/S profiles use Open-Meteo marine (low res) | Add THREDDS OPeNDAP |
| Open-Meteo archive is ERA5 subset | Higher-temporal resolution raw ERA5 unavailable | Add CDS API |
| No GPM IMERG in codebase | Precipitation uses Open-Meteo (1 deg GFS-driven, not 0.1 deg satellite) | Add PPS FTP/HTTPS |
| Sea ice placeholder | Eq 35 throws error; no sea ice concentration available | Add OSI SAF FTP or NSIDC |
| Glacier/permafrost placeholders | Eqs 91-92 throw errors; no glacier MB or permafrost data | Add RGI/GLIMS + GTN-P datasets |
| Drought placeholder | Eq 139 throws error; no PDSI | Add NOAA PSL ERDDAP |
| Volcano placeholder | History-only, no NRT volcano monitoring | Add Smithsonian GVP + USGS VHP |
