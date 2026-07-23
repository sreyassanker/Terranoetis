# Domain 6 — Soil Science & Land Surface (Equations 43-50)
## Complete Scientific Data Infrastructure

---

## 1. Variable Inventory

| Variable | Eq(s) | Meaning | Units | Type | Best Dataset |
|----------|-------|---------|-------|------|-------------|
| theta_r | 43 | Residual water content | m3/m3 | Static soil | SoilGrids + PTF |
| theta_s | 43 | Saturated water content | m3/m3 | Static soil | SoilGrids + PTF |
| alpha | 43 | van Genuchten shape parameter | 1/m | Static soil | SoilGrids + PTF |
| n | 43 | van Genuchten pore-size index | - | Static soil | SoilGrids + PTF |
| psi | 43,44 | Soil matric potential | m | Derived | - |
| psi_b | 44 | Brooks-Corey bubbling pressure | m | Static soil | SoilGrids + PTF |
| R | 45 | Rainfall erosivity factor | MJ/mm/ha/h/yr | Derived | GPM IMERG |
| K | 45 | Soil erodibility factor | - | Static soil | SoilGrids |
| LS | 45 | Slope length-steepness factor | - | Derived | DEM (SRTM) |
| C | 45 | Cover-management factor | - | Derived | Land cover / NDVI |
| P | 45 | Support practice factor | - | Static | Land use map |
| R_base | 46 | Base respiration rate | umol/m2/s | Field/literature | Literature values |
| Q10 | 46 | Temperature sensitivity | - | Literature | Literature (~2.0) |
| T | 46 | Soil temperature | C | Reanalysis | GLDAS / ERA5-Land |
| k_i | 47 | Thermal conductivity of component i | W/m/K | Literature | Literature tables |
| f_i | 47 | Volume fraction of component i | - | Derived | Soil moisture + texture |
| kappa | 48 | von Karman constant | - | Constant | 0.41 |
| u_star | 48 | Friction velocity | m/s | Derived | Wind + roughness |
| z | 48,49 | Height above surface | m | User/DEM | Input |
| L | 48 | Obukhov length | m | Derived | Surface fluxes |
| z0 | 49 | Roughness length | m | Static | Land cover |
| g0 | 50 | Stomatal conductance intercept | mol/m2/s | Literature | Ball-Berry model |
| a1 | 50 | Stomatal slope parameter | - | Literature | Grass ~9, trees ~6 |
| A | 50 | Net assimilation rate | umol/m2/s | Derived | GPP model (Eq 51) |
| hs | 50 | Surface relative humidity | - | Derived | RH at leaf surface |
| cs | 50 | CO2 concentration at leaf surface | ppm | Literature/obs | ~400 ppm |

---

## 2. Primary Data Sources

### Soil Hydraulic Parameters (Eqs 43-44)

**ISRIC SoilGrids v2.0** — REST API at point locations:
- Clay, sand, silt fractions → pedotransfer functions (Saxton-Rawls / Rosetta)

**Pedotransfer Functions:**
- van Genuchten parameters from texture + BD + SOC using Rosetta (Schaap et al. 2001)
- Brooks-Corey parameters from texture

**Key access:** `https://rest.isric.org/soilgrids/v2.0/properties/query?lon={lon}&lat={lat}&property=clay,sand,silt,soc,bdod,cec`

### Universal Soil Loss Equation (Eq 45)

| Factor | Source | Resolution | Access |
|--------|--------|------------|--------|
| **R** (rainfall erosivity) | GPM IMERG (30-min, 0.1 deg) → EI30 calculation | 0.1 deg | NASA GES DISC |
| | Global R-factor maps (Panagos et al. 2017) | 1 km | ESDB / JRC |
| **K** (soil erodibility) | SoilGrids → K from texture + OM + permeability | 250 m | ISRIC REST |
| **LS** (slope length) | SRTM/NASADEM → LS calculation in GIS | 30 m | Earth Engine |
| **C** (cover) | MODIS NDVI → C = exp(-2*NDVI/(1-NDVI)) | 250 m, 16-day | ORNL DAAC |
| **P** (practice) | Global cropland management maps | 1 km | Literature |

### Soil Respiration (Eq 46)

- **T**: GLDAS soil temperature (0-10 cm), 0.25 deg, 3-hourly
- **R_base**: Site-specific or literature (~2-5 umol/m2/s at 10C)
- **Q10**: ~2.0 for most soils (Davidson & Janssens 2006)

### Soil Thermal Conductivity (Eq 47)

- **f_i**: Derived from SoilGrids texture + GLDAS soil moisture
- **k_i**: Literature values for mineral, organic, water, ice, air components
- **Johansen (1975)** model recommended

### Monin-Obukhov & Wind Profile (Eqs 48-49)

- **u_star**: ERA5 friction velocity (`zust`, var 236, single level), 0.25 deg, hourly
- **L**: ERA5 surface sensible heat flux + u_star → compute L
- **z0**: From land cover (MODIS MCD12Q1 or ESA WorldCover)
- **kappa**: 0.41 (constant)

### Ball-Berry Stomatal Conductance (Eq 50)

- **g0, a1**: Plant functional type specific (literature)
- **A**: GPP estimate (Eq 51) from MODIS gross primary productivity (MOD17A2H, 500m, 8-day)
- **hs**: Relative humidity at leaf surface (~= RH at 2m for well-watered conditions)
- **cs**: Atmospheric CO2 (OCO-2 satellite ~1-2 ppm accuracy, or fixed 400 ppm)

---

## 3. Data Availability Matrix

| Variable | Real-Time | NRT | Historical | Static |
|----------|-----------|-----|------------|--------|
| SoilGrids (texture) | No | No | No | **Yes (static)** |
| GLDAS soil moisture | No | Yes (EP ~1.5mo) | Yes | No |
| GLDAS soil temperature | No | Yes (EP ~1.5mo) | Yes | No |
| ERA5 friction velocity | No | No | Yes (final ~3mo) | No |
| MODIS NDVI | No | Yes (LANCE ~3h) | Yes (2000+) | No |
| MODIS GPP (MOD17) | No | Yes | Yes (2000+) | No |
| GPM IMERG rainfall | No | Yes (Late, 14h) | Yes (Final, 3.5mo) | No |
| ESA WorldCover | No | No | No | **Yes (2021)** |

---

## 4. References

1. van Genuchten, M.Th. (1980). *SSSAJ*, 44, 892-898.
2. Brooks, R.H. & Corey, A.T. (1964). *Hydrology Paper No. 3*, Colorado State Univ.
3. Wischmeier, W.H. & Smith, D.D. (1978). *USDA Agriculture Handbook No. 537*.
4. Ball, J.T. et al. (1987). *Plant, Cell & Environment*, 10, 259-265.
5. Monin, A.S. & Obukhov, A.M. (1954). *Trudy Geofiz. Inst. AN SSSR*, 24, 163-187.
6. Johansen, O. (1975). *PhD Thesis*, Univ. Trondheim.
7. Saxton, K.E. & Rawls, W.J. (2006). *SSSAJ*, 70, 1569-1578.
8. Schaap, M.G. et al. (2001). *J. Hydrology*, 251, 163-176.
9. Panagos, P. et al. (2017). *Scientific Reports*, 7, 41830.
10. Davidson, E.A. & Janssens, I.A. (2006). *Nature*, 440, 165-173.
11. Poggio, L. et al. (2021). SoilGrids 2.0. *SOIL*, 7, 217-240. DOI: 10.5194/soil-7-217-2021
