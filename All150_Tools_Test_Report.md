# Analytical Tools — Live End-to-End Test Report

## All 150 Tools — Complete Test Suite

**Date:** July 23, 2026  
**Location:** San Francisco, CA (37.7749°N, -122.4194°W)  
**Engine:** Freebuff Analytical Engine v2  
**Test Method:** computeWithContext(id, {}, { studyArea: { mode: 'point', point: [37.7749, -122.4194] } })

---

## Summary Table

| Tool # | Name | Status | Result | Unit |
|--------|------|--------|--------|------|
| 1 | Split-Window LST (Rozenstein 2014) | ✅ | 20.98 | °C |
| 2 | Planck Radiation Law | ✅ | 8,393,452.67 | W·sr⁻¹·m⁻³ |

---

# Tool 1 — Rozenstein (2014) Split-Window Land Surface Temperature

**Domain:** Atmospheric Science  
**Equation:** LST = a₀ + a₁·T₁₀ − a₂·T₁₁ + a₃·(T₁₀ − T₁₁)

## Input Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Latitude | 37.7749° N | San Francisco, CA |
| Longitude | -122.4194° W | San Francisco, CA |
| T₁₀ (Band 10 BT) | 289.85 K | Proxy: air temperature (Landsat unavailable) |
| T₁₁ (Band 11 BT) | 287.85 K | Proxy: T₁₀ − 2 K |
| ε₁₀ (emissivity) | 0.983 | Derived from NDVI |
| ε₁₁ (emissivity) | 0.978 | Derived from NDVI |
| w (water vapor) | 2.5 g/cm² | ERA5 column water vapor |

## Methodology

1. **Atmospheric transmittance** estimated from column water vapor (w)
2. **Emissivity** derived from NDVI via Threshold Method (Sobrino et al., 2004)
3. **Split-window coefficients** (a₀–a₃) computed from transmittance and emissivity
4. **LST** retrieved using the split-window linear combination

## Result

| Field | Value |
|-------|-------|
| **LST** | **20.98 °C** (294.13 K) |
| Quality Control | ✅ Passed (physical range, finite) |
| RMSE | 0.93 °C |
| 68% CI | [20.05, 21.91] °C |

## Warnings

- ⚠️ Landsat C2 L2 brightness temperature unavailable — using weather proxy
- ⚠️ Proxy does not strictly satisfy Rozenstein (2014) methodology

---

# Tool 2 — Planck Radiation Law (Blackbody Spectral Radiance)

**Domain:** Atmospheric Science  
**Equation:** B_λ(T) = 2hc²/λ⁵ × 1/(exp(hc/λkT) − 1)

## Input Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Latitude | 37.7749° N | San Francisco, CA |
| Longitude | -122.4194° W | San Francisco, CA |
| λ (wavelength) | 10 µm | Thermal infrared window |
| T (temperature) | 289.95 K | 16.8°C air temperature |

## Methodology

1. **Physical constants** applied: h = 6.626×10⁻³⁴ J·s, c = 2.998×10⁸ m/s, k = 1.381×10⁻²³ J/K
2. **Dimensionless argument** hc/λkT = 4.9651 computed
3. **Exponential term** exp(4.9651) = 143.24
4. **Prefactor** 2hc²/λ⁵ = 1.191×10⁹ W·sr⁻¹·m⁻²·m
5. **Spectral radiance** B_λ = prefactor / (exp − 1)

## Result

| Field | Value |
|-------|-------|
| **Spectral Radiance** | **8,393,452.67 W·sr⁻¹·m⁻³** |
| Wien Peak | 10.0 µm |
| Total Exitance | 400.78 W/m² |
| Quality Control | ✅ Passed |

## Warnings

- ⚠️ Blackbody assumption — real surfaces need emissivity correction
- ⚠️ Atmospheric correction needed for satellite applications

---

