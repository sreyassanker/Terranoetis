# Domain 1 — Atmospheric Science (Equations 1–8)
## Operational Reference: Real-World Data Sources & Practical Execution

---

### Overview
Each equation is wired to fetch real-world atmospheric data (temperature, pressure, humidity, wind) from the study area using **Open-Meteo** (free, no API key). Results are displayed both in the tool panel and as a labeled pin on the 3D globe at the study area location.

---

### Eq 1: Split-Window Algorithm (Landsat 8/9 Land Surface Temperature Retrieval)
**Symbol:** `Ts = A₀ + A₁·T₁₀ − A₂·T₁₁`  
**Output:** Land surface temperature (°C)  
**Real data override:**
- `T₁₀`, `T₁₁` (brightness temps) ← from `temperature_2m` + 273.15 (K) as proxy when no satellite data
- `ε₁₀`, `ε₁₁` (emissivity) ← 0.97 / 0.98 defaults (vegetation/soil)
- `w` (column water vapor) ← estimated from `relative_humidity_2m`
**Algorithm (Rozenstein et al. 2014):**
```
Cᵢ = εᵢ · τᵢ
Dᵢ = (1 − τᵢ)[1 + (1 − εᵢ)τᵢ]
E₀ = D₁₁C₁₀ − D₁₀C₁₁
E₁ = D₁₁(1 − C₁₀ − D₁₀) / E₀
E₂ = D₁₀(1 − C₁₁ − D₁₁) / E₀
A  = D₁₀ / E₀
A₀ = E₁·a₁₀ + E₂·a₁₁
A₁ = 1 + A + E₁·b₁₀
A₂ = A + E₂·b₁₁
Ts = A₀ + A₁·T₁₀ − A₂·T₁₁
```
**Transmittance (US Standard 1976):**
- `τ₁₀ = −0.1146·w + 1.0286`
- `τ₁₁ = −0.1568·w + 1.0083`
**Planck constants (0–60°C):** `a₁₀=−64.4661, b₁₀=0.4398`, `a₁₁=−68.8678, b₁₁=0.4755`
**Reference:** Rozenstein, Qin, Derimian & Karnieli (2014) — *Sensors*, 14(4), 5768–5780 — DOI: [10.3390/s140405768](https://doi.org/10.3390/s140405768)

---

### Eq 2: Planck Radiation Law
**Symbol:** `B(λ, T) = (2hc²/λ⁵) · 1/(e^{hc/λkT} - 1)`  
**Output:** Spectral radiance (W·m⁻²·sr⁻¹·µm⁻¹) at given wavelength  
**Real data override:**
- `T` ← `temperature_2m` from Open-Meteo + 273.15 (K)
- `λ` ← user-selectable wavelength (default 10 µm, thermal IR window)
**Source:** MODIS band 31 (10.78–11.28 µm), VIIRS M15 (10.50–12.40 µm)
**Reference:** Planck, M. (1900) — DOI: 10.1002/andp.19003090310

---

### Eq 3: Clausius-Clapeyron (Magnus-Tetens Saturation Vapor Pressure)
**Symbol:** `eₛ(T) = 0.61094 · exp(17.625T / (T + 243.04))`  
**Output:** Saturation vapor pressure (kPa)  
**Real data override:**
- `T` ← `temperature_2m` (°C) from Open-Meteo
**Validation:** Compare with ERA5 reanalysis 2 m dewpoint
**Reference:** Tetens, O. (1930) — *Zeitschrift für Geophysik*, 6, 297–309

---

### Eq 4: Hydrostatic Equation
**Symbol:** `P(z) = P₀ · exp(-z / H)` where `H = RT/Mg`  
**Output:** Pressure (hPa) at given altitude  
**Real data override:**
- `P₀` (surface pressure) ← `pressure_msl` from Open-Meteo
- `T` (mean temperature) ← `temperature_2m` + 273.15 (K)
- `z` (altitude) ← from `elevation` category filter or user input
**Source:** ECMWF ERA5 pressure levels for profile validation
**Reference:** Holton & Hakim (2012) — *An Introduction to Dynamic Meteorology*, Chapter 2

---

### Eq 5: Geostrophic Wind
**Symbol:** `u_g = -(1/ρf) ∂P/∂y`, `v_g = (1/ρf) ∂P/∂x`  
**Output:** Geostrophic wind components (m·s⁻¹)  
**Real data override:**
- `ρ` (air density) ← computed from `pressure_msl` and `temperature_2m` from Open-Meteo
- `f` (Coriolis parameter) ← computed from study area latitude
- `∂P/∂x`, `∂P/∂y` (pressure gradient) ← default 0.001 hPa/m, can be overridden
**Source:** ERA5 ML model levels (137 level) for gradient computation
**Reference:** Holton & Hakim (2012) — *An Introduction to Dynamic Meteorology*

---

### Eq 6: Advection-Diffusion Equation
**Symbol:** `∂C/∂t = D ∇²C - u · ∇C + S`  
**Output:** Concentration at time t (mg·m⁻³) — analytic with 1D initial pulse  
**Real data override:**
- `u` (wind speed) ← `wind_speed_10m` from Open-Meteo
- `D` (diffusivity) ← derived from stability class (category filter)
**Source:** NOAA HYSPLIT trajectory model for validation
**Reference:** Bird, Stewart & Lightfoot (2007) — *Transport Phenomena*

---

### Eq 7: Bulk Richardson Number
**Symbol:** `Ri_B = (g/θᵥ) · (z_g - z_s)(θᵥ(z_g) - θᵥ(z_s)) / (u(z_g) - u(z_s))²`  
**Output:** Dimensionless stability parameter  
**Real data override:**
- `θᵥ` (virtual potential temperature) ← computed from `temperature_2m` and `relative_humidity_2m`
- `u(z)` (wind at height) ← extrapolated from `wind_speed_10m`
**Classification:** Ri_B < 0 (unstable), 0 < Ri_B < 0.25 (neutral), Ri_B > 0.25 (stable)
**Reference:** Stull, R.B. (1988) — *An Introduction to Boundary Layer Meteorology*

---

### Eq 8: Kolmogorov Energy Cascade
**Symbol:** `E(k) = C ε^{2/3} k^{-5/3}`  
**Output:** Energy spectral density (m³·s⁻²) at given wavenumber  
**Real data override:**
- `C` (Kolmogorov constant) ← 1.5 (universal, from field data)
- `ε` (TKE dissipation rate) ← default 0.001 m²·s⁻³, sensitive to `wind_speed_10m`
**Source:** Sonic anemometer field campaigns (e.g., CASES-99, BLLAST)
**Reference:** Kolmogorov, A.N. (1941) — DOI: 10.1098/rspa.1991.0075

---

### Data Sources Summary

| Data Field | API Source | Resolution | Coverage |
|-----------|-----------|-----------|----------|
| Temperature (2 m) | Open-Meteo / ERA5 | ~0.25° / hourly | Global |
| Relative Humidity (2 m) | Open-Meteo / ERA5 | ~0.25° / hourly | Global |
| Pressure (MSL) | Open-Meteo | ~0.25° / hourly | Global |
| Wind Speed (10 m) | Open-Meteo | ~0.25° / hourly | Global |
| Wind Direction (10 m) | Open-Meteo | ~0.25° / hourly | Global |
| Precipitation | Open-Meteo | ~0.25° / hourly | Global |
| Elevation | Open-Meteo / SRTM | 30–90 m | Global |

### Globe Visualization
Each tool's output is rendered on the 3D globe as a **yellow pin marker** with a label showing the computed value and unit at the study area centroid. The entity persists until the next tool run, replacing the previous result.
