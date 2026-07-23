# Domain 1 — Atmospheric Science (Equations 1-8)
## Complete Scientific Data Infrastructure

> Based on original research papers and official documentation from NASA, NOAA, ECMWF, USGS, ESA, and peer-reviewed literature.

---

## Table of Contents
1. [Variable Inventory & Data Dependency Graph](#1-variable-inventory--data-dependency-graph)
2. [Eq 1 — Split-Window Land Surface Temperature](#2-eq-1--split-window-landsat-surface-temperature)
3. [Eq 2 — Planck Radiation Law](#3-eq-2--planck-radiation-law)
4. [Eq 3 — Saturation Vapor Pressure (Magnus-Tetens)](#4-eq-3--saturation-vapor-pressure-magnus-tetens)
5. [Eq 4 — Hydrostatic Equation](#5-eq-4--hydrostatic-equation)
6. [Eq 5 — Geostrophic Wind Analysis](#6-eq-5--geostrophic-wind-analysis)
7. [Eq 6 — Pollutant Transport (Advection-Diffusion)](#7-eq-6--pollutant-transport-advection-diffusion)
8. [Eq 7 — Atmospheric Stability (Bulk Richardson Number)](#8-eq-7--atmospheric-stability-bulk-richardson-number)
9. [Eq 8 — Turbulent Energy Spectrum (Kolmogorov)](#9-eq-8--turbulent-energy-spectrum-kolmogorov)
10. [Data Availability Matrix](#10-data-availability-matrix)
11. [Implementation Architecture](#11-implementation-architecture)
12. [References](#12-references)

---

## 1. Variable Inventory & Data Dependency Graph

### Summary of All Variables

| Variable | Eq(s) | Physical Meaning | Units | Source Type | NRT? | Best Dataset |
|----------|-------|------------------|-------|-------------|------|--------------|
| T10 | 1 | TIRS Band 10 brightness temperature | K | Satellite (Landsat) | No** | Landsat 8/9 C2 L2 |
| T11 | 1 | TIRS Band 11 brightness temperature | K | Satellite (Landsat) | No** | Landsat 8/9 C2 L2 |
| eps10 | 1 | Band 10 surface emissivity | - | Static raster | Yes | ASTER GED v41 |
| eps11 | 1 | Band 11 surface emissivity | - | Static raster | Yes | ASTER GED v41 |
| w | 1, 7 | Total column water vapor | cm | Satellite / Reanalysis | Yes | MOD07 / ERA5 |
| lambda | 2 | Wavelength | um | User input | N/A | N/A |
| T | 2, 3, 4 | Air temperature (2m) | K / C | Obs/Reanalysis | Yes | ERA5 / Open-Meteo |
| P0 | 4 | Surface pressure | hPa | Obs/Reanalysis | Yes | ERA5 / Open-Meteo |
| z | 4 | Altitude / elevation | m | DEM | Yes* | SRTM / NASADEM |
| dP/dx | 5 | Zonal pressure gradient | Pa/m | Derived (NWP) | Yes | ERA5 pressure levels |
| dP/dy | 5 | Meridional pressure gradient | Pa/m | Derived (NWP) | Yes | ERA5 pressure levels |
| f | 5 | Coriolis parameter | 1/s | Derived (lat) | N/A | Geographic calc |
| rho | 5 | Air density | kg/m3 | Derived | Yes | Ideal gas law |
| u | 6 | Wind speed | m/s | Obs/Reanalysis | Yes | ERA5 / Open-Meteo |
| D | 6 | Eddy diffusivity | m2/s | Param (stability) | N/A | Pasquill-Gifford |
| C0 | 6 | Initial concentration | ug/m3 | User/Inventory | N/A | User / Emissions |
| t | 6 | Time | s | User | N/A | N/A |
| zg, zs | 7 | Heights above surface | m | DEM/input | N/A | SRTM / user |
| theta_v | 7 | Virtual potential temperature | K | Derived | Yes | ERA5 / Open-Meteo |
| u(z) | 7 | Wind speed at height z | m/s | NWP / Derived | Yes | ERA5 wind profiles |
| C | 8 | Kolmogorov constant | - | Universal constant | N/A | Literature |
| epsilon | 8 | TKE dissipation rate | m2/s3 | Reanalysis | Yes | ERA5 / MERRA-2 |
| k | 8 | Wavenumber | 1/m | Derived / user | N/A | User |

** Landsat has 16-day revisit; NRT access via direct broadcast possible but requires local antenna

---

## 2. Eq 1 — Split-Window Land Surface Temperature

**Reference:** Rozenstein, O. et al. (2014). Estimation of Land Surface Temperature from Landsat 8 TIRS. *Remote Sensing*, 6(12), 12287-12311. DOI: 10.3390/rs61212287

### Variable Inventory

| Variable | Meaning | Units | Type | Required Resolution | Source |
|----------|---------|-------|------|-------------------|--------|
| **T10** | Brightness temperature, TIRS Band 10 (10.6-11.19 um) | K | Observed (satellite) | 30-100 m, 16-day revisit | **Landsat 8/9 Collection 2 Level-2** |
| **T11** | Brightness temperature, TIRS Band 11 (11.5-12.51 um) | K | Observed (satellite) | 30-100 m, 16-day revisit | **Landsat 8/9 Collection 2 Level-2** |
| **eps10** | Surface emissivity, Band 10 | - | Derived (static) | 100 m-1 km, static (2000-2008) | **ASTER GED v3/v41** |
| **eps11** | Surface emissivity, Band 11 | - | Derived (static) | 100 m-1 km, static (2000-2008) | **ASTER GED v3/v41** |
| **w** | Total column water vapor | cm | Observed / Reanalysis | 1-5 km (MODIS) or 0.25 deg (ERA5) | **MOD07_L2** or **ERA5** |

### Primary Scientific Datasets

#### 2.1 Landsat 8/9 TIRS Brightness Temperatures (T10, T11)

| Attribute | Value |
|-----------|-------|
| **Dataset** | Landsat Collection 2 Level-2 Science Products (L2SP) |
| **Provider** | USGS / NASA |
| **Product** | Landsat 8-9 OLI/TIRS C2 L2 |
| **DOI** | 10.5066/P9OGBGM6 |
| **Band 10** | 10.6-11.19 um, 100 m TIR (resampled to 30 m) |
| **Band 11** | 11.5-12.51 um, 100 m TIR (resampled to 30 m) |
| **Spatial resolution** | 30 m (multispectral), 100 m TIR (resampled to 30 m) |
| **Temporal resolution** | 16-day revisit (8-day with Landsat 8+9 combined) |
| **Coverage** | Global land (path/row grid) |
| **Latency** | 14-16 hours (Landsat 9: 4-6 hours to Tier 1) |
| **Accuracy** | ST product accuracy ~1-2 K (RMSE vs ground) |
| **Historical** | 2013-present (L8); 2022-present (L9) |
| **License** | Open (USGS free and open policy) |

**Access methods:**
- **USGS EarthExplorer** (HTTPS download, scene-based)
- **Google Earth Engine** (COG, cloud-optimized)
- **AWS Open Data** (us-west-2, requester-pays)
- **Microsoft Planetary Computer** (STAC API)
- **USGS M2M API** (REST API for automated access)
- **AppEEARS** (LP DAAC, area-based subsetting)

**Preprocessing required:**
- The Level-2 product already contains **Surface Temperature** (ST band) — this is the USGS-provided product, not the Rozenstein split-window algorithm
- For Rozenstein's algorithm, you need **Level-1 TOA Brightness Temperature** bands, not the Level-2 ST
- Conversion from Level-1 DN to TOA BT uses MTL.txt coefficients:
  - L_lambda = ML * Qcal + AL (radiance)
  - T_BT = K2 / ln(K1 / L_lambda + 1)
- Atmospheric correction per Rozenstein using w (TCWV) needed
- **Cloud masking** using QA band (pixel_qa)
- Water vapor transmittance: tau10 = -0.1146*w + 1.0286; tau11 = -0.1568*w + 1.0083

**Alternative datasets for brightness temperatures:**
- **VIIRS VNP21** (750 m, 2x daily, global) — M14 (8.55 um), M15 (10.76 um), M16 (12 um)
- **MODIS MOD11_L2** (1 km, 2x daily, global) — bands 31 (11 um), 32 (12 um)
- **GOES-16/17/18 ABI** (2 km, 5-10 min, hemispheric) — bands 14 (11.2 um), 15 (12.3 um)
- **ECMWF ERA5** skin temperature (0.25 deg, hourly) — for non-satellite proxy

#### 2.2 Surface Emissivity (eps10, eps11)

| Attribute | Value |
|-----------|-------|
| **Dataset** | ASTER Global Emissivity Dataset (GED) |
| **Provider** | NASA JPL / LP DAAC |
| **Product** | AG100 (100 m), AG1KM (1 km), AG5KMMOH (0.05 deg monthly) |
| **DOI** | 10.5067/COMMUNITY/ASTER_GED/AG100.003 |
| **Spatial resolution** | 100 m (AG100), 1 km (AG1KM), 0.05 deg (monthly) |
| **Temporal** | Static mean 2000-2008 (AG100, AG1KM); Monthly 2000-2015 (AG5KMMOH v41) |
| **Coverage** | Global non-frozen land masses |
| **Accuracy** | ~0.015 (1.5%) per band; validated against lab spectra |
| **Bands** | 5 ASTER TIR bands: 8.3, 8.65, 9.1, 10.6, 11.3 um |
| **Adjustment needed** | Must spectrally adjust ASTER GED to Landsat TIRS band response |

**Access methods:**
- **LP DAAC** (HTTPS, Earthdata Login)
- **NASA Earthdata Search**
- **AppEEARS** (area subset, multiple formats)
- **AWS Cloud** (LPCLOUD bucket)

**Preprocessing:**
- Spectral adjustment from ASTER bands to TIRS bands 10 and 11 using spectral response functions
- Landsat-specific emissivity retrieval from ASTER GED using linear regression:
  - eps10 = 0.9888 + 0.0198 * NDVI_veg (alternative: ASTER GED spectrally convolved)
  - eps11 = 0.9912 + 0.0172 * NDVI_veg
- NDVI from Landsat OLI bands 5 (NIR) and 4 (Red)

**Alternative:**
- MODIS MOD21 (1 km, 2x daily) — TES algorithm, bands 29, 31, 32
- VIIRS VNP21 (750 m, 2x daily) — TES algorithm, bands M14, M15, M16
- UWIREM (University of Wisconsin emissivity database)

#### 2.3 Total Column Water Vapor (w)

| Attribute | Value |
|-----------|-------|
| **Primary dataset** | MODIS MOD07_L2 / MYD07_L2 (Atmospheric Profiles) |
| **Provider** | NASA LAADS DAAC |
| **Spatial resolution** | 5 km (5x5 1 km FOVs) |
| **Temporal resolution** | 2x daily (Terra ~10:30, Aqua ~13:30) |
| **Accuracy** | RMSE 2.9 mm vs microwave radiometer; bias ~0.3 cm |
| **Coverage** | Global clear-sky |
| **Variable** | Water_Vapor (cm) or Water_Vapor_Direct (cm) |

**Alternative:**
- **ERA5** total column water vapor (`tcwv`) — 0.25 deg, hourly, global, all-sky — CDS API
- **AIRS L2** (Aqua, 50 km, 2x daily) — totH2OStd — GES DISC
- **Open-Meteo** relative_humidity_2m (proxy only) — free REST API, no key needed
- **GNSS** zenith wet delay (GPS/MET) — point-based, high accuracy

**Access methods for ERA5:**
- **Copernicus CDS API** (Python, GRIB/NetCDF)
- **Open-Meteo Archive API** (REST, subset of ERA5)
- **Google Earth Engine** (ERA5 dataset)
- **AWS Registry of Open Data** (ERA5 in Zarr)

**Preprocessing for w:**
- If using Open-Meteo RH as proxy: w ~ 0.1 * exp(17.625*T/(T+243.04)) * RH / P (approximate, ~20% error)
- MOD07 requires cloud-free conditions; ERA5 provides all-sky
- ERA5 has ~3-month latency for final product; ERA5T (near-real-time) available with ~5-day latency

---

## 3. Eq 2 — Planck Radiation Law

**Reference:** Planck, M. (1900). Ueber das Gesetz der Energieverteilung im Normalspectrum. *Annalen der Physik*, 309(3), 553-563.

### Variable Inventory

| Variable | Meaning | Units | Type | Source |
|----------|---------|-------|------|--------|
| **lambda** | Wavelength | um | User-specified | User input (typical: 10 um) |
| **T** | Absolute temperature | K | Observed / Reanalysis | ERA5 / Open-Meteo / MODIS |

### Primary Datasets

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** 2m temperature (hourly, 0.25 deg, global, 1940-present) |
| **NRT** | **Open-Meteo** hourly forecast (temperature_2m, free, no key) |
| **Satellite** | **MODIS MOD11_L2** / **VIIRS VNP21** for surface temperature |
| **Variable** | T in K (T_C + 273.15) |

**Access:**
- Open-Meteo API: `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m`
- ERA5 via CDS API: parameter `t2m` (var 167) on single levels
- MODIS MOD11A1 (1 km, daily, tile-based) via LP DAAC

---

## 4. Eq 3 — Saturation Vapor Pressure (Magnus-Tetens)

**Reference:** Tetens, O. (1930). Uber einige meteorologische Begriffe. *Zeitschrift fur Geophysik*, 6, 297-309.

### Variable Inventory

| Variable | Meaning | Units | Type | Source |
|----------|---------|-------|------|--------|
| **T** | Air temperature | deg C | Observed | ERA5 / Open-Meteo |

**Equation:** `es(T) = 6.1094 * exp(17.625*T / (T + 243.04))` in hPa

### Primary Dataset

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** 2m temperature (t2m) |
| **NRT** | **Open-Meteo** (temperature_2m) |
| **Satellite** | **MODIS MOD07_L2** temperature profile at surface |
| **Accuracy** | ~0.3 hPa (temperature error of 0.5 K ~ 3% vapor pressure error) |

**Access:** Same as Eq 2.

---

## 5. Eq 4 — Hydrostatic Equation

**Reference:** Holton, J.R. & Hakim, G.J. (2012). *An Introduction to Dynamic Meteorology*, 5th ed., Ch. 2. Academic Press.

### Variable Inventory

| Variable | Meaning | Units | Type | Best Source |
|----------|---------|-------|------|-------------|
| **P0** | Surface pressure | hPa | Observed | ERA5 / Open-Meteo (pressure_msl) |
| **z** | Target altitude | m | User / DEM | SRTM / NASADEM / user |
| **T** | Mean temperature | K | Derived | ERA5 / Open-Meteo (temperature_2m) |

### Primary Dataset: Surface Pressure

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** surface pressure (sp, var 134) / mean sea level pressure (msl, var 151) |
| **NRT** | **Open-Meteo** (pressure_msl, surface_pressure) |
| **Spatial resolution** | 0.25 deg (ERA5), ~11 km (Open-Meteo GFS-driven) |
| **Temporal resolution** | Hourly |
| **Accuracy** | ~0.1 hPa RMSE vs radiosondes |

### Elevation Data

| Attribute | Value |
|-----------|-------|
| **Primary** | **NASADEM** (SRTM + corrections) |
| **Provider** | NASA LP DAAC |
| **Resolution** | 30 m (1 arc-second) |
| **Coverage** | 60N-56S global land |
| **NRT** | **Open Topo Data API** (SRTM 30m, free) |
| **Alternative** | **Copernicus GLO-30** (30 m, global) via AWS Open Data |
| **Alternative** | **ASTER GDEM v3** (30 m, global, 83N-83S) |

**Access for elevation:**
- Open Topo Data: `https://api.opentopodata.org/v1/srtm30m?locations={lat},{lon}`
- AWS Open Data: Copernicus GLO-30 in COG format on us-west-2
- Earth Engine: NASADEM as ImageCollection

---

## 6. Eq 5 — Geostrophic Wind Analysis

**Reference:** Holton, J.R. & Hakim, G.J. (2012). *An Introduction to Dynamic Meteorology*, 5th ed. Academic Press.

### Variable Inventory

| Variable | Meaning | Units | Type | Best Source |
|----------|---------|-------|------|-------------|
| **dP/dx** | Zonal pressure gradient | Pa/m | Derived | ERA5 pressure levels (geopotential) |
| **dP/dy** | Meridional pressure gradient | Pa/m | Derived | ERA5 pressure levels (geopotential) |
| **f** | Coriolis parameter | 1/s | Derived (from latitude) | Geographic calculation |
| **rho** | Air density | kg/m3 | Derived | Ideal gas law: rho = P / (Rd * T) |

### Primary Dataset

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** pressure level data — geopotential (z), temperature (t) at 850, 700, 500 hPa |
| **Provider** | ECMWF / Copernicus C3S |
| **CDS dataset** | `reanalysis-era5-pressure-levels` |
| **Spatial resolution** | 0.25 deg (native ~31 km) |
| **Temporal** | Hourly analysis, 1940-present |
| **Pressure levels** | 1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 225, 200, 175, 150, 125, 100, 70, 50, 30, 20, 10, 7, 5, 3, 2, 1 hPa |

**To compute pressure gradient:**
1. Convert geopotential (z) to pressure: P = reference_pressure * exp(-z / (Rd * T_mean))
2. Compute finite differences: dP/dx ~ (P(i+1,j) - P(i-1,j)) / (2 * dx)
3. dx = 111320 * cos(lat) * dlon (meters)

**Alternative:**
- **Open-Meteo** with pressure_at_surface at multiple nearby points (for approximate gradient)
- **NCEP GDAS** (0.25 deg, 4x daily, 3-hr forecast, near-real-time)
- **GFS forecast** (0.25 deg, 4x daily, up to 16-day forecast)

**Preprocessing:**
- Geopotential height to pressure conversion
- Finite difference gradient computation
- Spatial resampling if needed

---

## 7. Eq 6 — Pollutant Transport (Advection-Diffusion)

**Reference:** Bird, R.B., Stewart, W.E. & Lightfoot, E.N. (2007). *Transport Phenomena*, 2nd ed. Wiley.

### Variable Inventory

| Variable | Meaning | Units | Type | Best Source |
|----------|---------|-------|------|-------------|
| **u** | Wind speed | m/s | Observed/NWP | ERA5 / Open-Meteo |
| **D** | Eddy diffusivity | m2/s | Parameterized | Derived from stability (Pasquill-Gifford) |
| **C0** | Initial/source concentration | ug/m3 | User / Inventory | User input / Emissions inventory |
| **t** | Time since release | s | User | User input |

### Primary Dataset

| Attribute | Value |
|-----------|-------|
| **Wind speed** | **ERA5** 10m wind speed (si10), or **Open-Meteo** (wind_speed_10m) |
| **Wind profiles** | **ERA5** pressure level u/v components (u, v) at multiple levels |
| **Alternative** | **NCEP GDAS** (1 deg, 3-hourly, ARL HYSPLIT format) |

**Eddy diffusivity parameterization (Pasquill-Gifford):**
- D = f(stability_class, downwind_distance)
- Stability class determined from wind speed + solar radiation / cloud cover
- Available from Open-Meteo: shortwave_radiation, cloud_cover

**Alternative for transport modeling:**
- **NOAA HYSPLIT** model (online or offline) — uses GDAS meteorological data
- **Open-Meteo Air Quality API** — PM2.5, PM10, O3, NO2 (for C0 validation)

---

## 8. Eq 7 — Atmospheric Stability (Bulk Richardson Number)

**Reference:** Stull, R.B. (1988). *An Introduction to Boundary Layer Meteorology*. Kluwer Academic.

### Variable Inventory

| Variable | Meaning | Units | Type | Best Source |
|----------|---------|-------|------|-------------|
| **zg, zs** | Heights | m | Input / DEM | User / SRTM |
| **theta_v(z)** | Virtual potential temperature at height z | K | Derived | ERA5 profiles + humidity |
| **u(z)** | Wind speed at height z | m/s | Observed | ERA5 wind profiles |
| **g** | Gravity | m/s2 | Constant | 9.80665 |

### Primary Dataset

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** model level (137 levels) or pressure level data |
| **Variables** | Temperature (t), specific humidity (q), u-component (u), v-component (v) at 2 m, 50 m, 100 m, 200 m levels |
| **NRT** | **Open-Meteo** (temperature_80m, wind_speed_80m — limited levels) |
| **Alternative** | **NCEP GDAS** soundings (pressure levels from 1000 to 20 hPa) |

**Derivation:**
- Virtual potential temperature: theta_v ~ T * (1000/P)^(Rd/cp) * (1 + 0.61*q)
- Bulk Richardson: Ri_B = (g * dz * d(theta_v)) / (theta_v_mean * du^2)

---

## 9. Eq 8 — Turbulent Energy Spectrum (Kolmogorov)

**Reference:** Kolmogorov, A.N. (1941). The local structure of turbulence in incompressible viscous fluid. *Proc. R. Soc. Lond. A*, 434, 9-13.

### Variable Inventory

| Variable | Meaning | Units | Type | Best Source |
|----------|---------|-------|------|-------------|
| **C** | Kolmogorov constant | - | Universal | 1.5 (empirical, literature) |
| **epsilon** | TKE dissipation rate | m2/s3 | Reanalysis / Parameterized | ERA5 / MERRA-2 |
| **k** | Wavenumber | 1/m | Derived | User / from eddy size |

### Primary Dataset: TKE Dissipation Rate

| Attribute | Value |
|-----------|-------|
| **Primary** | **ERA5** — TKE (kinetic energy) tendency due to turbulence (not directly available as dissipation) |
| **MERRA-2** | `tavg3_3d_trb_Np` (M2T3NPTRB) — TKE dissipation diagnostics |
| **MERRA-2 variable** | `DKDT_TRB` — vertically integrated kinetic energy tendency across turbulence (W/m2) |
| **Spatial resolution** | 0.5 x 0.625 deg (MERRA-2), 0.25 deg (ERA5) |
| **Temporal** | 3-hourly (MERRA-2), hourly (ERA5) |
| **Coverage** | 1980-present |

**MERRA-2 turbulence diagnostics:**
- Collection: `tavg3_3d_trb_Np` (M2T3NPTRB)
- Variables: `DKDT_TRB` (TKE dissipation due to turbulence)
- Access: NASA GES DISC, Earthdata login

**Alternative parameterization:**
- epsilon ~ u*^3 / (kappa * z) where u* is friction velocity, kappa=0.4
- ERA5 surface variables: friction velocity (zust, var 236)
- Open-Meteo: wind_speed_10m (proxy, limited)

**Preprocessing:**
- MERRA-2 data in NetCDF format via GES DISC
- 3-hourly temporal resolution sufficient for spectral analysis (hourly ideal)

---

## 10. Data Availability Matrix

| Variable | Real-Time (latency < 1h) | Near-Real-Time (1h-1d) | Historical (latency > 1d) | Only Historical | Static |
|----------|--------------------------|------------------------|---------------------------|-----------------|--------|
| T10 (Landsat BT) | No | No | Yes (14-16h latency) | Yes | No |
| T11 (Landsat BT) | No | No | Yes (14-16h latency) | Yes | No |
| VIIRS BT bands | No | Yes (2-3h latency, CLASS) | Yes | No | No |
| MODIS BT bands | No | No | Yes (LAADS, ~1d) | Yes | No |
| GOES ABI BT bands | Yes (AWS S3, 5-10 min) | Yes | Yes | No | No |
| eps10, eps11 | No | No | No | Yes (static mean) | **Yes (2000-2008)** |
| NDVI (for emissivity) | No | Yes (MODIS/VIIRS) | Yes | No | No |
| w (TCWV from MODIS) | No | No | Yes (~1d latency) | Yes (clear-sky only) | No |
| w (TCWV from ERA5) | No | Yes (ERA5T ~5d) | Yes (final ~3mo) | No | No |
| T (2m from ERA5) | No | Yes (ERA5T ~5d) | Yes (final ~3mo) | No | No |
| T (2m from Open-Meteo) | **Yes** (forecast) | **Yes** | Yes (ERA5 archive) | No | No |
| P0 (Open-Meteo) | **Yes** | **Yes** | Yes | No | No |
| Elevation | No | No | No | No | **Yes (SRTM/NASADEM)** |
| dP/dx, dP/dy | No | Yes (ERA5T ~5d) | Yes (ERA5 final) | No | No |
| u, v wind (ERA5) | No | Yes (ERA5T ~5d) | Yes | No | No |
| u, v wind (Open-Meteo) | **Yes** | **Yes** | Yes | No | No |
| epsilon (TKE) | No | No | Yes (MERRA-2 ~3wk) | Yes | No |

### Summary of NRT Capability Gaps

1. **Landsat TIRS BT (T10, T11)** — Cannot be obtained in near-real-time. Minimum 4-6 hours processing, 16-day revisit. For NRT LST needs, use **VIIRS VNP21** (750 m, 2x daily, ~2h latency) or **GOES ABI** (2 km, 5-10 min, hemispheric).

2. **ASTER GED emissivity (eps10, eps11)** — Static dataset (2000-2008 baseline). Cannot capture dynamic changes (snow, fire, agriculture). Use NDVI-based dynamic adjustment or VIIRS VNP21 TES for real-time emissivity.

3. **Total column water vapor (w)** — MOD07 unavailable in NRT (requires LAADS processing). ERA5T has 5-day latency. For NRT, use **GNSS ZTD** (where available) or **Open-Meteo RH proxy** (lower accuracy).

4. **TKE dissipation rate (epsilon)** — Only available from reanalysis (MERRA-2, ERA5) with 3-week latency. For NRT, parameterize from surface wind speed and roughness.

---

## 11. Implementation Architecture

### Data Acquisition Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                      Data Acquisition Layer                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  NRT Sources (latency < 1 hr):                                   │
│  ┌──────────────────────┐  ┌──────────────────────────┐         │
│  │ Open-Meteo REST API  │  │ GOES-16/18 AWS S3 Bucket │         │
│  │ (forecast + current) │  │ (ABI L1b Radiances,      │         │
│  │ No auth required     │  │  CMI, LST products)      │         │
│  └──────────┬───────────┘  └────────────┬─────────────┘         │
│             │                           │                         │
│  Daily Sources (latency 1-24 hr):                               │
│  ┌──────────────────────┐  ┌──────────────────────────┐         │
│  │ USGS EarthExplorer   │  │ NOAA CLASS / PolarWatch   │         │
│  │ (Landsat C2 L2,      │  │ (VIIRS SDR/EDR, OISST,   │         │
│  │ via M2M API)         │  │  OSI SAF sea ice)        │         │
│  └──────────┬───────────┘  └────────────┬─────────────┘         │
│             │                           │                         │
│  Reanalysis Sources (latency 3mo+):                             │
│  ┌──────────────────────┐  ┌──────────────────────────┐         │
│  │ ECMWF CDS API        │  │ NASA GES DISC            │         │
│  │ (ERA5, hourly,       │  │ (MERRA-2, TKE,           │         │
│  │  0.25 deg, 1940+)    │  │  atmospheric profiles)   │         │
│  └──────────┬───────────┘  └────────────┬─────────────┘         │
│             │                           │                         │
│  Static Datasets:                                               │
│  ┌──────────────────────┐  ┌──────────────────────────┐         │
│  │ LP DAAC AppEEARS     │  │ ISRIC SoilGrids REST     │         │
│  │ (ASTER GED, NASADEM, │  │ (soil properties,        │         │
│  │  MODIS/VIIRS LST)    │  │  texture class)          │         │
│  └──────────────────────┘  └──────────────────────────┘         │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Variable Mapping Layer (contextEngine.ts)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Variable Mapping Layer                         │
│                                                                   │
│  Raw API Data           →    Derived Variables    →    Eq Inputs │
│  ─────────────                 ─────────────────       ───────── │
│  temperature_2m                T_K = T_C + 273.15     T         │
│  pressure_msl                  rho = P/(Rd*T)         rho        │
│  wind_speed_10m                dP/dx, dP/dy           dP/dx      │
│  relative_humidity_2m          theta_v                theta_v    │
│  shortwave_radiation           w (water vapor proxy)  w          │
│  cloud_cover                   Stability class        D          │
│  satellite BT bands            tau10, tau11           T10, T11   │
│  ASTER GED emissivity          eps adjusted to TIRS   eps10      │
│  NDVI                          Dynamic emissivity     eps11      │
│  MERRA-2 TKE dissipation       epsilon                epsilon    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Data Flow per Tool

#### Eq 1 (LST) — Multi-Tier Data Strategy

```
Tier 1 (Highest accuracy, non-NRT):
  Landsat 8/9 L2 ST (USGS) → Already computed LST
  OR Landsat L1 TOA BT + ASTER GED + ERA5 w → Rozenstein algorithm

Tier 2 (Medium accuracy, daily):
  VIIRS VNP21 L2 (750m, 2x daily) → NASA LAADS / LP DAAC
  OR MODIS MOD11_L2 (1km, 2x daily) → LAADS

Tier 3 (NRT, hourly), with lower accuracy:
  GOES ABI bands 14+15 (2km, 5-10 min) → AWS S3
  Algorithm: split-window with coefficients from GOES ATBD

Tier 4 (Reanalysis proxy):
  ERA5 skin temperature (0.25 deg, hourly) → CDS API
  Valid for large-scale studies, NOT for local-scale LST
```

#### Eq 5 (Geostrophic Wind) — Implementation Flow

```
1. Fetch ERA5 pressure level geopotential at 850 hPa (or closest to surface)
2. Compute pressure field: P = 1000 * exp(-z / (Rd * T_v))
3. Compute gradients using centered finite differences
4. Compute Coriolis: f = 2 * 7.2921e-5 * sin(lat)
5. Compute density: rho = P / (Rd * T)
6. u_g = -1/(rho*f) * dP/dy,  v_g = 1/(rho*f) * dP/dx

NRT Alternative (lower accuracy):
  Open-Meteo pressure at 3+ nearby grid points → 2nd order gradient
```

#### Eq 8 (Kolmogorov Spectrum) — Implementation Flow

```
1. Check if MERRA-2 TKE dissipation (M2T3NPTRB.DKDT_TRB) is available
2. If not, parameterize epsilon from ERA5/Open-Meteo:
   - u* from wind profile: u* = u_10 * kappa / ln(10/z0)
   - epsilon = u*^3 / (kappa * z)
3. Compute E(k) = C * epsilon^(2/3) * k^(-5/3)
4. Output spectral density at user-specified k

Limitation: Parameterized epsilon has ~50% uncertainty vs sonic anemometer
```

### Derived-Variable Workflows

#### Virtual Potential Temperature (Eq 7)

```
theta_v = T * (1000/P)^(0.286) * (1 + 0.61*q)
where q = specific humidity from ERA5 / MOD07
P = pressure at height (from ERA5 pressure levels)
```

#### Water Vapor from Relative Humidity (for when MOD07/ERA5 unavailable)

```
e = 6.1094 * exp(17.625 * T / (T + 243.04))   [saturation vapor pressure]
e_actual = e * (RH/100)
w = 0.1 * integral of (e_actual * P_profile) through column (approximate)
Best effort only — errors > 20% in moist atmospheres
```

#### Wind Speed at Arbitrary Heights (Eq 7)

```
Logarithmic profile:
u(z) = u_10 * ln(z/z0) / ln(10/z0)
where z0 = roughness length from land cover (0.001-1 m)
Limitation: valid only in neutral surface layer
```

---

## 12. Scientific Limitations

### Known Limitations & Mitigations

| Limitation | Affected Eq(s) | Impact | Mitigation |
|------------|---------------|--------|------------|
| ASTER GED static (2000-2008) | 1 | ~0.015 emissivity error over changed surfaces | NDVI-based dynamic adjustment or VIIRS VNP21 TES |
| Landsat 16-day revisit | 1 | Temporal gaps | VIIRS (2x daily) or GOES (sub-hourly) for time-series |
| MODIS MOD07 clear-sky only | 1, 7 | Missing data under clouds | ERA5 (all-sky) as fallback |
| ERA5 ~0.25 deg resolution | 4, 5, 7, 8 | Misses local gradients | Statistical downscaling with DEM |
| Open-Meteo RH-based water vapor | 1 | ~20% error in moist atmospheres | Only use as last resort; prefer MOD07/ERA5 |
| MERRA-2 TKE dissipation ~3wk latency | 8 | Not NRT | Parameterize from wind profiles |
| GOES ABI only covers Western Hemisphere | 1, 2 | Limited geographic coverage | HIMAWARI AHI (Asia-Pacific), MSG SEVIRI (Europe/Africa) |
| Landsat TIRS stray light correction | 1 | Band 11 calibration issues post-2017 | Use Band 10 only with single-channel algorithm; or use VIIRS |
| Arctic amplification of emissivity errors | 1 | Larger errors over snow/ice | Use separate snow/ice emissivity database |

### Variables That Cannot Be Obtained Globally

1. **Localized TKE dissipation rate (epsilon) in real time** — No satellite directly measures TKE dissipation. MERRA-2 provides 3-hourly reanalysis estimates. For field-scale measurements, sonic anemometers are required.

2. **Actual surface emissivity at Landsat pixel scale in NRT** — ASTER GED is static. VIIRS VNP21 can provide NRT emissivity but at 750 m, not 30 m. No 30 m NRT emissivity product exists globally.

3. **Pressure gradient at mesoscale (dP/dx, dP/dy) from observations** — Required for geostrophic wind but surface pressure networks are sparse. Must use NWP/reanalysis gradient.

---

## Data Availability Matrix

| Data Source | Eq(s) | API Type | Auth Required | Rate Limit | Cost | Recommended Access Method |
|-------------|-------|----------|--------------|------------|------|--------------------------|
| Open-Meteo (weather) | 2,3,4,5,6,7 | REST | No | 10k/day free | Free | `fetch()` client-side |
| Open-Meteo (archive) | 2,3,4,5,6,7 | REST | No | 10k/day free | Free | `fetch()` for ERA5 subset |
| Open-Meteo (marine) | 15-17,66-80 | REST | No | 10k/day free | Free | `fetch()` |
| Open-Meteo (air quality) | 6,64,65,137 | REST | No | 10k/day free | Free | `fetch()` |
| USGS EarthExplorer M2M | 1 | REST | USGS key | Reasonable | Free | HTTPS/JSON API |
| USGS EarthExplorer (Landsat) | 1 | HTTPS download | USGS login | Unrestricted | Free | EarthExplorer UI or API |
| Google Earth Engine | 1 | REST/Python | EE account | Reasonable | Free for research | ee.ImageCollection |
| NASA LAADS (MODIS) | 1,7 | HTTPS | Earthdata | Unrestricted | Free | wget/curl |
| NASA GES DISC (MERRA-2) | 8 | HTTPS/OPeNDAP | Earthdata | Unrestricted | Free | Python (earthaccess) |
| ECMWF CDS (ERA5) | 1,4,5,6,7,8 | CDS API (Python) | CDS login | Reasonable | Free | cdsapi Python library |
| LP DAAC AppEEARS | 1 | REST (task-based) | Earthdata | Reasonable | Free | REST API |
| AWS Open Data (Landsat) | 1 | S3 | No (requester-pays) | Unlimited | Data transfer cost | S3 SDK (us-west-2) |
| AWS Open Data (GOES) | 1,2 | S3 | No | Unlimited | Data transfer cost | S3 SDK (us-east-1) |
| AWS Open Data (ERA5) | 4,5,6,7,8 | S3 (Zarr) | No | Unlimited | Data transfer cost | xarray + s3fs |
| Microsoft Planetary Computer | 1,26-33 | STAC API | No | Reasonable | Free | pystac-client |

---

## 12. References

### Original Research Papers

1. Rozenstein, O., Qin, Z., Derimian, Y., & Karnieli, A. (2014). Derivation of land surface temperature for Landsat-8 TIRS using a split window algorithm. *Remote Sensing*, 6(12), 12287-12311. DOI: 10.3390/rs61212287
2. Planck, M. (1900). Ueber das Gesetz der Energieverteilung im Normalspectrum. *Annalen der Physik*, 309(3), 553-563.
3. Tetens, O. (1930). Uber einige meteorologische Begriffe. *Zeitschrift fur Geophysik*, 6, 297-309.
4. Holton, J.R. & Hakim, G.J. (2012). *An Introduction to Dynamic Meteorology*, 5th ed. Academic Press.
5. Bird, R.B., Stewart, W.E. & Lightfoot, E.N. (2007). *Transport Phenomena*, 2nd ed. Wiley.
6. Stull, R.B. (1988). *An Introduction to Boundary Layer Meteorology*. Kluwer Academic.
7. Kolmogorov, A.N. (1941). The local structure of turbulence in incompressible viscous fluid for very large Reynolds numbers. *Proc. R. Soc. Lond. A*, 434, 9-13. DOI: 10.1098/rspa.1991.0075

### Official Documentation

8. USGS (2024). Landsat 8-9 OLI/TIRS Collection 2 Level-2 Science Products. DOI: 10.5066/P9OGBGM6
9. Hulley, G. et al. (2015). The ASTER Global Emissivity Database (ASTER GED): Mapping Earth's emissivity at 100 meter spatial resolution. *Geophysical Research Letters*, 42. DOI: 10.1002/2015GL065564
10. Seemann, S.W. et al. (2003). Operational retrieval of atmospheric temperature, moisture, and ozone from MODIS infrared radiances. *J. Applied Meteorology*, 42, 1072-1091.
11. Borbas, E. et al. (2011). MODIS Atmospheric Profile Retrieval Algorithm Theoretical Basis Document, Collection 6.
12. Hersbach, H. et al. (2020). The ERA5 global reanalysis. *Quarterly J. Royal Meteorological Society*, 146, 1999-2049. DOI: 10.1002/qj.3803
13. Gelaro, R. et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). *J. Climate*, 30, 5419-5454. DOI: 10.1175/JCLI-D-16-0758.1
14. Hulley, G. et al. (2019). VIIRS Land Surface Temperature and Emissivity Product (VNP21) User Guide. NASA LP DAAC.
15. NOAA (2017). GOES-R Series ABI Level 1b Radiances Dataset. NOAA NCEI. DOI: 10.7289/V5BV7DSR

### Data Access Documentation

16. Copernicus Climate Data Store. (2023). ERA5 hourly data on pressure levels from 1940 to present. DOI: 10.24381/cds.bd0915c6
17. Copernicus Climate Data Store. (2023). ERA5 hourly data on single levels from 1940 to present. DOI: 10.24381/cds.adbb2d47
18. NASA GMAO (2015). MERRA-2 tavg3_3d_trb_Np: 3d, 3-Hourly, Time-Averaged, Pressure-Level, Turbulence Diagnostics. DOI: 10.5067/9SC1VNTW1TV8
19. NASA JPL (2014). ASTER Global Emissivity Dataset, 100-meter, HDF5. DOI: 10.5067/COMMUNITY/ASTER_GED/AG100.003
20. USGS (2024). Landsat Collection 2 Level-2 Science Product Guide. DOI: 10.5066/P9OGBGM6
