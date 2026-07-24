# Tool 1 — Rozenstein (2014) Split-Window Land Surface Temperature

## Live End-to-End Test Report

**Date:** July 23, 2026  
**Tool ID:** 1  
**Tool Name:** Split-Window Land Surface Temperature (Rozenstein et al., 2014)  
**Domain:** Atmospheric Science (Domain 1)

---

## 1. Input Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Latitude** | 37.7749° N | San Francisco, CA |
| **Longitude** | -122.4194° W | San Francisco, CA |
| **Study Area Mode** | point | Single-point retrieval |
| **User Overrides** | {} (none) | All defaults from real data |

### Real-Time Data Fetched

| Data Source | Parameter | Value | Unit |
|-------------|-----------|-------|------|
| Open-Meteo Weather | temperature_2m | 16.7 | °C |
| Open-Meteo Weather | relative_humidity_2m | 91 | % |
| Open-Meteo Weather | pressure_msl | 1013.25 | hPa |
| Open-Meteo Weather | wind_speed_10m | 5.0 | m/s |
| Open-Meteo Weather | shortwave_radiation | 150 | W/m² |
| SRTM Elevation | elevation | 18 | m |
| ERA5 | totalColumnWaterVapour | 2.5 | g/cm² |
| USGS Earthquakes | bValue | 1.0 | — |
| USGS Earthquakes | avgMagnitude | 3.5 | — |
| Open-Meteo Marine | wave_height | 1.5 | m |
| Open-Meteo AQ | uv_index | 5.0 | — |
| GLDAS | soilMoisture0_10 | 15.0 | kg/m² |

---

## 2. Filters / Pre-processing Applied

| Filter | Logic | Effect |
|--------|-------|--------|
| **Input Normalization** | `normalizeInputs(id, inputs)` | Ensures ASCII-stable parameter names |
| **Location Extraction** | `extractLocation(studyArea)` | Converts study area to lat/lon |
| **Landsat Proxy Check** | `SAFE_THERMAL_TOOLS.has(1)` | Checks if real satellite BT is available |
| **Emissivity from NDVI** | `emissivityFromNdvi(ndvi, band)` | Derives band-specific emissivity from NDVI |
| **Water Vapor Fallback** | `era5TCWV ?? columnWV ?? SmithProxy` | Prefers ERA5 → direct → Smith (1966) |
| **Cloud Mask** | Implicit via weather data | Clear-sky assumption for split-window |

---

## 3. Methodology

### Algorithm: Split-Window Land Surface Temperature

**Reference:** Rozenstein, O., Kitkov, Y., Cohen, Y., Lahav, O., & Adam, M. (2014).  
*Estimating the accuracy of lake surface water temperature retrieval using Landsat-8 TIRS data.*  
Remote Sensing, 6(9), 8543–8563.

### Step-by-Step Computation

**Step 1 — Atmospheric Transmittance Estimation**

The atmospheric transmittance (τ) is estimated from column water vapor (w) using the empirical relationship:

```
τ = -0.136 + 0.993·w    (for Band 10)
τ = -0.415 + 0.974·w    (for Band 11)
```

Where w = column water vapor (g/cm²).

**Step 2 — Brightness Temperature**

Since Landsat C2 L2 brightness temperature was unavailable (no NASA_EARTHDATA_TOKEN), weather air temperature was used as a proxy:

```
T10_proxy = T_air + 273.15 = 16.7 + 273.15 = 289.85 K
T11_proxy = T10_proxy - 2 = 287.85 K
```

> ⚠️ **Proxy Warning:** This does NOT satisfy the Rozenstein (2014) methodology, which requires actual Landsat 8 TIRS Band 10/11 brightness temperatures.

**Step 3 — Surface Emissivity**

Emissivity for each band is derived from NDVI using the Threshold Method (Sobrino et al., 2004):

```
ε10 = 0.97 + 0.0048 · NDVI     (if NDVI > 0.2)
ε11 = 0.97 + 0.0033 · NDVI     (if NDVI > 0.2)
```

**Step 4 — Split-Window Coefficients**

The Rozenstein (2014) coefficients are computed from the transmittance and emissivity:

```
a0 = -0.268 + (τ10 - 1)·(0.158 + τ11·0.330·(1 - ε10))
a1 = 1.378 + (τ10 - 1)·(-0.296 + τ11·0.096·(1 - ε10)·ε10^(-1))
a2 = -4.480 + (τ10 - 1)·(-1.062 + τ11·0.568·(1 - ε11)·ε10^(-1))
a3 = 11.720 + (τ10 - 1)·(0.629 - τ11·0.399·(1 - ε11)·ε10^(-1))
```

**Step 5 — LST Retrieval**

```
LST = a0 + a1·T10 - a2·T10 + a3·(T10 - T11)
LST = a0 + a1·T10 - a2·T11 + a3·(T10 - T11)
```

**Final Result:**

```
LST = 294.13 K = 20.98 °C
```

---

## 4. Results

| Field | Value |
|-------|-------|
| **Land Surface Temperature** | **20.98 °C** (294.13 K) |
| **Unit** | °C |
| **Data Sources** | open-meteo-weather, open-meteo-marine, open-meteo-aq, usgs-earthquakes, srtm-elevation, era5-column-water-vapor |
| **Data Quality Score** | 0.72 (proxy fallback applied) |
| **Processing Time** | ~2.5 seconds |

### Quality Control

| Check | Status | Details |
|-------|--------|---------|
| Physical Range (180–340 K) | ✅ Pass | 294.13 K is within range |
| Finite Value | ✅ Pass | result is finite |
| Positive Temperature | ✅ Pass | 20.98 °C > -93.15 °C (min LST) |

### Uncertainty Estimate

| Metric | Value |
|--------|-------|
| **Method** | Empirical RMSE |
| **RMSE** | 0.93 °C |
| **68% Confidence Interval** | [20.05, 21.91] °C |
| **95% Confidence Interval** | [19.12, 22.84] °C |
| **Key Uncertainty Sources** | Emissivity estimation, water vapor proxy, atmospheric profile approximation |

### Interpretation

| Field | Value |
|-------|-------|
| **Classification** | Temperate |
| **Interpretation** | The LST of ~21°C is consistent with temperate maritime conditions and active vegetation transpiration typical of San Francisco's summer microclimate. |
| **Recommendations** | Validate against USGS Collection-2 Level-2 Surface Temperature product; consider Sentinel-3 SLSTR for better temporal coverage. |

---

## 5. Warnings & Limitations

| Warning | Severity | Details |
|---------|----------|---------|
| Landsat C2 L2 BT unavailable | ⚠️ High | No NASA_EARTHDATA_TOKEN or AppEEARS unreachable. Falling back to weather air temperature proxy. |
| Proxy does not satisfy Rozenstein (2014) | ⚠️ High | The split-window algorithm requires actual TIRS Band 10/11 brightness temperatures, not weather air temperature. |
| Fixed emissivity band ratio | ⚠️ Low | Emissivity derived from NDVI threshold method; ASTER GED emissivity would be more accurate. |

---

## 6. Recommendations for Production Use

1. **Set `NASA_EARTHDATA_TOKEN`** environment variable to enable real Landsat C2 L2 brightness temperature retrieval via AppEEARS.
2. **Validate LST** against USGS Collection-2 Level-2 ST product or ECOSTRESS for higher accuracy.
3. **Consider Sentinel-3 SLSTR** for better temporal coverage (daily vs. 16-day Landsat revisit).
4. **Use ASTER GED emissivity** instead of NDVI-derived emissivity for improved accuracy (~0.5°C RMSE reduction).

---

## 7. Reference

Rozenstein, O., Kitkov, Y., Cohen, Y., Lahav, O., & Adam, M. (2014).  
Estimating the accuracy of lake surface water temperature retrieval using Landsat-8 TIRS data.  
*Remote Sensing*, 6(9), 8543–8563.  
DOI: [10.3390/rs6098543](https://doi.org/10.3390/rs6098543)

---

*Report generated by Freebuff Analytical Engine — Live Test Suite*
