# Tool 2 — Planck Radiation Law

## Live End-to-End Test Report

**Date:** July 23, 2026  
**Tool ID:** 2  
**Tool Name:** Planck Radiation Law (Blackbody Spectral Radiance)  
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
| Open-Meteo Weather | temperature_2m | 16.8 | °C |
| Open-Meteo Weather | relative_humidity_2m | 88 | % |
| Open-Meteo Weather | pressure_msl | 1013.25 | hPa |
| Open-Meteo Weather | wind_speed_10m | 16.3 | m/s |
| Open-Meteo Weather | shortwave_radiation | 150 | W/m² |
| SRTM Elevation | elevation | 18 | m |
| USGS Earthquakes | bValue | 1.0 | — |
| Open-Meteo Marine | wave_height | 0.86 | m |
| Open-Meteo Marine | wave_period | 9.4 | s |
| Open-Meteo AQ | pm2_5 | 4.2 | µg/m³ |
| Open-Meteo AQ | us_aqi | 26 | — |

---

## 2. Filters / Pre-processing Applied

| Filter | Logic | Effect |
|--------|-------|--------|
| **Input Normalization** | `normalizeInputs(id, inputs)` | Ensures ASCII-stable parameter names |
| **Location Extraction** | `extractLocation(studyArea)` | Converts study area to lat/lon |
| **Wavelength Default** | `u('λ', 10)` | Uses 10 µm (thermal IR window) when not provided |
| **Temperature Conversion** | `T_air + 273.15` | Converts °C to Kelvin for Planck function |
| **Parameter Validation** | Checks λ > 0, T > 0 | Prevents division by zero or negative wavelength |

---

## 3. Methodology

### Algorithm: Planck's Blackbody Radiation Law

**Reference:** Planck, M. (1901).  
*On the law of distribution of energy in the normal spectrum.*  
Annalen der Physik, 309(3), 553–563.

### Step-by-Step Computation

**Step 1 — Input Parameters**

```
Wavelength (λ) = 10 µm = 10 × 10⁻⁶ m
Temperature (T) = 289.95 K (16.8°C + 273.15)
```

**Step 2 — Physical Constants**

| Constant | Symbol | Value | Unit |
|----------|--------|-------|------|
| Planck's constant | h | 6.626 × 10⁻³⁴ | J·s |
| Speed of light | c | 2.998 × 10⁸ | m/s |
| Boltzmann constant | k | 1.381 × 10⁻²³ | J/K |

**Step 3 — Compute hc/λkT (Dimensionless Argument)**

```
hc/λkT = (6.626e-34 × 2.998e8) / (10e-6 × 1.381e-23 × 289.95)
       = 1.9864e-25 / 4.004e-17
       = 4.9651
```

**Step 4 — Compute Exponential Term**

```
exp(hc/λkT) = exp(4.9651) = 143.24
```

**Step 5 — Compute Prefactor (2hc²/λ⁵)**

```
2hc²/λ⁵ = 2 × 6.626e-34 × (2.998e8)² / (10e-6)⁵
         = 2 × 6.626e-34 × 8.988e16 / 1e-25
         = 1.1910e-16 / 1e-25
         = 1.1910e9  W·sr⁻¹·m⁻²·m
```

**Step 6 — Compute Spectral Radiance (Planck Function)**

```
B_λ(T) = (2hc²/λ⁵) × 1/(exp(hc/λkT) − 1)
       = 1.1910e9 × 1/(143.24 − 1)
       = 1.1910e9 × 1/142.24
       = 8,393,452.67  W·sr⁻¹·m⁻³
```

**Step 7 — Wien Displacement Peak**

```
λ_max = b/T = 2897.8 / 289.95 = 10.0 µm
```

**Step 8 — Stefan-Boltzmann Total Exitance**

```
M = σ × T⁴ = 5.670e-8 × (289.95)⁴ = 400.78 W/m²
```

**Final Result:**

```
B_λ(10µm, 289.95K) = 8,393,452.67 W·sr⁻¹·m⁻³
```

---

## 4. Results

| Field | Value |
|-------|-------|
| **Spectral Radiance** | **8,393,452.67 W·sr⁻¹·m⁻³** |
| **Unit** | W·sr⁻¹·m⁻³ |
| **Wavelength** | 10 µm (thermal infrared) |
| **Temperature** | 289.95 K (16.8°C) |
| **Wien Peak** | 10.0 µm |
| **Total Exitance** | 400.78 W/m² |
| **Data Sources** | open-meteo-weather, open-meteo-marine, open-meteo-aq, usgs-earthquakes, srtm-elevation |

### Quality Control

| Check | Status | Details |
|-------|--------|---------|
| Valid Result | ✅ Pass | result is finite and positive |
| Physical Wavelength | ✅ Pass | 10 µm is in thermal IR window (8–14 µm) |
| Positive Temperature | ✅ Pass | 289.95 K > 0 K |
| Wien Peak Consistency | ✅ Pass | λ_max = 10.0 µm matches input wavelength |

### Uncertainty Estimate

| Metric | Value |
|--------|-------|
| **Method** | Analytical (exact for perfect blackbody) |
| **RMSE** | N/A — function is exact for ideal blackbody |
| **Real-World Uncertainty** | Depends on surface emissivity (ε < 1) |
| **Key Uncertainty Sources** | Surface emissivity, atmospheric absorption, non-blackbody behavior |

### Interpretation

| Field | Value |
|-------|-------|
| **Classification** | Very High |
| **Interpretation** | The spectral radiance at 10 µm for a 290 K surface is ~8.4 MW·sr⁻¹·m⁻³. This is consistent with typical thermal infrared emission from temperate land surfaces. The Wien peak at 10 µm confirms the thermal IR window is optimal for LST retrieval. |
| **Recommendations** | For real satellite applications, multiply by surface emissivity (ε ≈ 0.95–0.98) to convert blackbody radiance to actual surface radiance. |

---

## 5. Warnings & Limitations

| Warning | Severity | Details |
|---------|----------|---------|
| λ parameter not user-provided | ⚠️ Low | Using auto-fetched/default value of 10 µm. User can override with specific band wavelength. |
| Blackbody assumption | ⚠️ Medium | Real surfaces are not perfect blackbodies. Apply emissivity correction: L_actual = ε × B_λ(T). |
| Atmospheric correction needed | ⚠️ Medium | Satellite-measured radiance includes atmospheric effects. Apply atmospheric correction for surface retrieval. |

---

## 6. Recommendations for Production Use

1. **Apply emissivity correction** — Multiply by surface emissivity (ε ≈ 0.95–0.98 for most land surfaces) to convert blackbody radiance to actual surface radiance.
2. **Use band-specific wavelengths** — For Landsat 8 TIRS, use λ₁₀ = 10.9 µm (Band 10) or λ₁₁ = 12.0 µm (Band 11).
3. **Apply atmospheric correction** — Use MODTRAN or similar radiative transfer code to correct for atmospheric absorption and emission.
4. **Validate against calibrated sources** — Compare with laboratory blackbody measurements or satellite-derived brightness temperatures.

---

## 7. Reference

Planck, M. (1901). On the law of distribution of energy in the normal spectrum.  
*Annalen der Physik*, 309(3), 553–563.  
DOI: [10.1002/andp.19003090310](https://doi.org/10.1002/andp.19003090310)

---

*Report generated by Freebuff Analytical Engine — Live Test Suite*
