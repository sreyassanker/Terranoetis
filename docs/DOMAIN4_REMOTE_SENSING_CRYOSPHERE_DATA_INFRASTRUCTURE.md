# Domain 4 — Remote Sensing & Cryosphere (Equations 26-35)
## Complete Scientific Data Infrastructure

---

## 1. Variable Inventory

| Variable | Eq(s) | Meaning | Units | Type | Best Dataset |
|----------|-------|---------|-------|------|-------------|
| NIR | 26,27,28,29,30,31 | Near-infrared reflectance (0.85 um) | - | Satellite | MODIS MOD13Q1 / Sentinel-2 L2A / Landsat C2 |
| Red | 26,29 | Red reflectance (0.65 um) | - | Satellite | MODIS MOD13Q1 / Sentinel-2 L2A |
| Green | 27,30 | Green reflectance (0.56 um) | - | Satellite | MODIS MOD09GA / Sentinel-2 L2A |
| SWIR | 28,30,31 | Shortwave-IR reflectance (1.6 or 2.2 um) | - | Satellite | MODIS MOD09GA / Sentinel-2 L2A |
| Blue | 29 | Blue reflectance (0.47 um) | - | Satellite | MODIS MOD09GA / Sentinel-2 L2A |
| A | 32 | Pixel area | m2 | Derived | Pixel dimensions |
| epsilon | 32 | Fire emissivity | - | Parameter | MODIS FRP ATBD |
| T_fire | 32 | Fire temperature | K | Satellite | MODIS MOD14 / VIIRS VNP14 |
| T_bg | 32 | Background temperature | K | Satellite | MODIS MOD11 / background |
| Tc | 33 | Canopy temperature | K | Satellite | Landsat / VIIRS LST |
| Twet | 33 | Wet reference temperature | K | Derived | Wet bulb + assumption |
| Tdry | 33 | Dry reference temperature | K | Derived | Air temperature + VPD |
| DDF | 34 | Degree-day factor | mm/C-day | Parameter | Literature (2-6 mm/C-day) |
| T_air | 34 | Air temperature | C | Reanalysis | ERA5 / Open-Meteo |
| T_base | 34 | Base melt temperature | C | Parameter | 0 C |
| C | 35 | Sea ice concentration | % | Satellite | OSI SAF / NSIDC CDR |
| T_water | 35 | Water brightness temperature | K | Satellite | AMSR2 TB (passive MW) |
| T_ice | 35 | Ice brightness temperature | K | Satellite | AMSR2 TB (passive MW) |

---

## 2. Eqs 26-31 — Spectral Indices (NDVI, NDWI, NBR, NDSI, EVI)

**References:**
- NDVI: Rouse et al. (1973). *NASA/GSFC Type III Final Report*
- NDWI: McFeeters (1996). *IJRS*, 17(7), 1425-1432
- NDWI-Gao: Gao (1996). *RSEnv*, 58(3), 257-266
- EVI: Huete et al. (2002). *RSEnv*, 83, 195-213
- NDSI (snow): Hall et al. (2002). *RSEnv*, 83, 132-149
- NBR: Key & Benson (2006). *USGS NPS fire monitoring*

### Shared Data Sources

All spectral indices require at-sensor or surface reflectance in specific bands from optical satellite sensors.

#### Tier 1 — MODIS (best for frequent global coverage)

| Product | Bands | Resolution | Temporal | Latency | Access |
|---------|-------|------------|----------|---------|--------|
| **MOD09GA** | B1(red), B2(NIR), B3(blue), B4(green) | 500m | Daily | ~1 day | LP DAAC, Earth Engine |
| **MOD09GQ** | B1(red), B2(NIR) | 250m | Daily | ~1 day | LP DAAC |
| **MOD13Q1** | NDVI, EVI, refl_b01, refl_b02, refl_b03, refl_b07 | 250m | 16-day | ~2-7 days | LP DAAC, ORNL DAAC |
| **MCD43A4** | NBAR BRDF-adjusted reflectance B1-B7 | 500m | Daily | ~8 days | LP DAAC |

**Best for NRT:** MODIS via LAADS DAAC (NASA LANCE system, ~3h latency for MODIS direct broadcast)

#### Tier 2 — Sentinel-2 (best for high resolution)

| Product | Bands | Resolution | Temporal | Latency | Access |
|---------|-------|------------|----------|---------|--------|
| **Sentinel-2 L2A** | B2(blue), B3(green), B4(red), B8(NIR), B11(SWIR) | 10-20m | 5-day | ~1-3h | AWS S3 (COGs, no sign) |
| **Sentinel-2 L2A** via Copernicus Data Space Ecosystem | All spectral | 10-60m | 5-day | ~1-3h | STAC API, OGC WMS/WCS |

**S3 bucket:** `s3://sentinel-cogs/sentinel-s2-l2a-cogs/` (us-west-2, no sign required)

#### Tier 3 — Landsat (best for long-term historical)

| Product | Bands | Resolution | Temporal | Access |
|---------|-------|------------|----------|--------|
| **Landsat 8/9 C2 L2** | B2-B7 (30m), B10-B11 (100m TIR) | 30m | 16-day | EarthExplorer, AWS S3, GEE |

### Derived Index Equations

| Index | Formula | Primary Data Source |
|-------|---------|-------------------|
| **NDVI** | (NIR - Red) / (NIR + Red) | MOD13Q1 (band `250m_16_days_NDVI`); Sentinel-2 (B8-B4)/(B8+B4) |
| **NDWI** | (Green - NIR) / (Green + NIR) | Sentinel-2 (B3-B8)/(B3+B8); Landsat (B3-B5)/(B3+B5) |
| **NDWI-Gao** | (NIR - SWIR) / (NIR + SWIR) | Sentinel-2 (B8-B11)/(B8+B11) |
| **EVI** | 2.5 * (NIR-Red)/(NIR+6*Red-7.5*Blue+1) | MOD13Q1 (band `250m_16_days_EVI`) |
| **NDSI** | (Green - SWIR) / (Green + SWIR) | MODIS (B4-B6)/(B4+B6); Sentinel-2 (B3-B11)/(B3+B11) |
| **NBR** | (NIR - SWIR) / (NIR + SWIR) | Same as NDWI-Gao; pre-fire and post-fire differenced |

### NRT Capability

- **MODIS**: Daily global, ~3h latency via LANCE. Good for NRT vegetation/fire/snow monitoring
- **Sentinel-2**: 5-day revisit, ~1-3h latency via AWS COGs (STAC API for discovery)
- **Landsat**: 16-day revisit, ~14h latency. Only suitable for non-NRT work

---

## 3. Eq 32 — Fire Radiative Power (FRP)

**Reference:** Wooster, M.J. et al. (2003). *RSEnv*, 87, 83-97.

### Variables

| Variable | Source |
|----------|--------|
| **A** (pixel area) | Derived from pixel geometry |
| **epsilon** (emissivity) | ~0.85 (fire ATBD standard) |
| **T_fire** (fire temp) | **MODIS MOD14/MYD14** or **VIIRS VNP14** |
| **T_bg** (background temp) | Near-pixel non-fire background |

### Primary Fire Datasets

| Product | Sensor | Resolution | Latency | Access |
|---------|--------|------------|---------|--------|
| **MODIS MOD14/MYD14** | Terra/Aqua | 1km | ~1h (LANCE) | LAADS DAAC, FIRMS |
| **VIIRS VNP14** | S-NPP/NOAA-20 | 375m (I-band) | ~1h | LAADS DAAC, FIRMS |
| **VIIRS VNP14IMG** | S-NPP/NOAA-20 | 375m | ~1h | LAADS DAAC |
| **FIRMS** | Aggregated | 375m-1km | ~3h | REST API (key required) |

**FIRMS API:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{lat}/{lon}/{radius}`

### FRP Calculation

FRP (MW) = A * epsilon * sigma * (T_fire^4 - T_bg^4)

Where sigma = 5.670374419e-8 W/m2/K4, and result is converted to MW.

---

## 4. Eq 33 — Crop Water Stress Index (CWSI)

**Reference:** Jackson, R.D. et al. (1981). *Water Resources Research*, 17, 1133-1138.

| Variable | Source |
|----------|--------|
| **Tc** (canopy temp) | Landsat/VIIRS LST at vegetated pixels |
| **Twet** (wet reference) | Wet-bulb temperature from air T + RH |
| **Tdry** (dry reference) | Air temperature + vapor pressure deficit |

**Best source for canopy temperature:**
- Landsat Collection 2 Level-2 Surface Temperature (30m, 16-day)
- VIIRS VNP21A1 Day/Night LST (1km, daily)
- ECOSTRESS (70m, 3-5 day repeat, 1:30 PM overpass)

---

## 5. Eq 34 — Snowmelt Runoff (Degree-Day)

**Reference:** Martinec, J. (1975). *IAHS-AISH Publ.*, 104, 131-143.

| Variable | Source |
|----------|--------|
| **DDF** (degree-day factor) | Literature: 2-6 mm/C-day (snow), 4-8 mm/C-day (ice) |
| **T_air** (air temperature) | ERA5 / Open-Meteo |
| **T_base** (base temp) | 0 C (parameter) |

**Snow data:**
- **MODIS MOD10A1** (500m, daily snow cover): fractional snow cover
- **IMERG** (0.1 deg, 30-min): precipitation phase
- **ERA5-Land** (0.1 deg, hourly): snow depth, snow melt, snow water equivalent

---

## 6. Eq 35 — Passive Microwave Sea Ice Analysis

**Reference:** Comiso, J.C. (1986). *JGR*, 91(C8), 9769-9780.

### Variables

| Variable | Meaning | Source |
|----------|---------|--------|
| **C** | Sea ice concentration (0-1) | OSI SAF / NSIDC CDR |
| **T_water** | Open water brightness temp | AMSR2 37V channel |
| **T_ice** | Sea ice brightness temp | AMSR2 37H channel |

### Primary Sea Ice Datasets

| Dataset | Provider | Resolution | Temporal | Latency | Coverage | Access |
|---------|----------|------------|----------|---------|----------|--------|
| **OSI-408-a** (AMSR2) | EUMETSAT OSI SAF | 10 km | Daily | ~5h | Global | FTP |
| **OSI-401-a** (SSMIS) | EUMETSAT OSI SAF | 25 km | Daily | ~3h | Global | FTP |
| **G02202 V6** (NSIDC CDR) | NOAA/NSIDC | 25 km | Daily | ~1 mo | Polar | HTTPS |
| **G10016 V4** (NRT CDR) | NOAA/NSIDC | 25 km | Daily | ~1d | Polar | HTTPS |
| **AMSR2 L3** | JAXA | 10 km | Daily | ~1d | Polar | JAXA G-Portal |

### NRT Access

- **OSI SAF**: OSI-408-a (AMSR2, ~5h latency) via FTP: `osisaf.met.no` or `ftp://osisaf.met.no`
- **NSIDC NRT**: G10016 (last 3 months) via HTTPS: `https://noaadata.apps.nsidc.org/`
- **PolarWatch ERDDAP**: Aggregate view, subsetting capability

### Limitation

No simple REST API for point-based sea ice queries. Sea ice data is in polar stereographic NetCDF/HDF5 grids. Must download and extract for given lat/lon. Reprojection from polar stereographic to geographic coordinates required.

---

## 7. Data Availability Matrix

| Variable/Index | Real-Time | NRT | Historical | Static |
|---------------|-----------|-----|------------|--------|
| MODIS NDVI/EVI (MOD13Q1) | No | Yes (3h LANCE) | Yes (2000+) | No |
| MODIS surface refl (MOD09) | No | Yes (3h LANCE) | Yes (2000+) | No |
| Sentinel-2 L2A reflectance | No | Yes (~3h AWS) | Yes (2015+) | No |
| Landsat C2 SR/ST | No | Yes (~14h) | Yes (1982+) | No |
| VIIRS fire (VNP14) | No | Yes (~1h) | Yes (2012+) | No |
| FIRMS fire data | No | Yes (~3h) | Yes | No |
| ECOSTRESS LST | No | No | Yes (2018+) | No |
| OSI SAF sea ice (AMSR2) | No | Yes (~5h) | Yes (2016+) | No |
| NSIDC sea ice CDR | No | No | Yes (1978+) | No |
| ERA5-Land snow | No | Yes (ERA5T ~5d) | Yes (1950+) | No |
| MODIS snow cover (MOD10A1) | No | Yes (3h) | Yes (2000+) | No |

---

## 8. References

1. Rouse, J.W. et al. (1973). Monitoring vegetation systems in the Great Plains with ERTS. *NASA SP-351*, 309-317.
2. McFeeters, S.K. (1996). The use of NDWI for water body mapping. *IJRS*, 17(7), 1425-1432.
3. Gao, B.-C. (1996). NDWI—A normalized difference water index for remote sensing. *RSEnv*, 58(3), 257-266.
4. Huete, A. et al. (2002). Overview of the radiometric and biophysical performance of the MODIS vegetation indices. *RSEnv*, 83, 195-213.
5. Hall, D.K. et al. (2002). MODIS snow-cover products. *RSEnv*, 83, 132-149.
6. Key, C.H. & Benson, N.C. (2006). Landscape assessment: NBR. *USDA FIREMON Fire Effects Monitoring Protocol*.
7. Wooster, M.J. et al. (2003). Retrieval of biomass combustion rates and totals from fire radiative power. *RSEnv*, 87, 83-97.
8. Jackson, R.D. et al. (1981). Canopy temperature as a crop water stress indicator. *WWR*, 17(4), 1133-1138.
9. Martinec, J. (1975). Snowmelt-runoff model for stream flow forecasts. *Hydrological Sciences Bulletin*, 20(3), 373-384.
10. Comiso, J.C. (1986). Characteristics of Arctic winter sea ice from satellite multispectral microwave observations. *JGR*, 91(C8), 9769-9780.
11. Didan, K. (2021). MOD13Q1 V6.1. NASA LP DAAC. DOI: 10.5067/MODIS/MOD13Q1.061
12. Sentinel-2 L2A COGs. AWS Registry of Open Data.
13. OSI SAF (2023). Global Sea Ice Concentration AMSR2. DOI: 10.15770/EUM_SAF_OSI_NRT_2023
14. NOAA/NSIDC (2024). G10016 NRT Sea Ice CDR V4. NSIDC.
