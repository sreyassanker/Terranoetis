# Earth System Equations — Methodology Flow & Open-Source Data Sources

> **150 equations · 26 domains · 7 parts**
> Each entry: **Paper/Article reference → Methodology flow (start to end) → Open-source data API for real inputs**

---

# PART I — Earth System Core (Equations 1–50)

---

## Domain 1: Atmospheric Science (Eqs 1–8)

### Eq 1 — Split-Window Land Surface Temperature (Rozenstein et al., 2014)
- **Reference:** Rozenstein, O. et al. (2014). "Estimation of the Land Surface Temperature from Landsat 8 TIRS." *Remote Sensing*, 6(12), 12287–12311.
- **Methodology Flow:**
  1. Acquire brightness temperatures from TIRS Band 10 (T₁₀) and Band 11 (T₁₁) in Kelvin.
  2. Compute column water vapor content (w) from meteorological data or atmospheric sounding.
  3. Calculate atmospheric transmittance for each band: τ₁₀ = −0.1146w + 1.0286; τ₁₁ = −0.1568w + 1.0083.
  4. Compute surface–atmosphere coupling coefficients: Cᵢ = εᵢτᵢ, Dᵢ = (1−τᵢ)(1+(1−εᵢ)τᵢ).
  5. Solve the SWA system using Li regression coefficients (a₁₀, b₁₀, a₁₁, b₁₁).
  6. Output: Land Surface Temperature in °C.
- **Open-Source Data:** Open-Meteo forecast API (temperature_2m, humidity for water vapor proxy), NASA Landsat 8/9 TIRS bands via [USGS EarthExplorer](https://earthexplorer.usgs.gov/), [Google Earth Engine](https://earthengine.google.com/).

### Eq 2 — Planck Radiation Law (Planck, 1900)
- **Reference:** Planck, M. (1900). "Ueber das Gesetz der Energieverteilung im Normalspectrum." *Annalen der Physik*, 309(3), 553–563.
- **Methodology Flow:**
  1. Input: wavelength λ (µm), absolute temperature T (K).
  2. Compute exponent: hc/(λkT) where h=6.626×10⁻³⁴ J·s, c=2.998×10⁸ m/s, k=1.381×10⁻²³ J/K.
  3. Compute spectral radiance: B_λ(T) = (2hc²/λ⁵) × 1/(e^(hc/λkT) − 1).
  4. Output: W·sr⁻¹·m⁻³. Also derive Wien peak λ_max = 2898/T and total exitance M = σT⁴.
- **Open-Source Data:** Open-Meteo (surface temperature at any lat/lon), user-provided emissivity.

### Eq 3 — Saturation Vapor Pressure / Magnus-Tetens (Tetens, 1930)
- **Reference:** Tetens, O. (1930). "Über einige meteorologische Begriffe." *Zeitschrift für Geophysik*, 6, 297–309.
- **Methodology Flow:**
  1. Input: air temperature T (°C).
  2. Apply Magnus-Tetens formula: e_s(T) = 6.1094 × exp(17.625T/(T + 243.04)).
  3. Derive slope of saturation curve: Δ = de_s/dT = (4098 × e_s)/(T + 237.3)².
  4. Compute saturation mixing ratio: w_s = 622 × e_s/(P − e_s).
  5. Output: e_s in hPa.
- **Open-Source Data:** Open-Meteo forecast API (current temperature_2m at any location, no key needed).

### Eq 4 — Hydrostatic Equation (Holton & Hakim, 2012)
- **Reference:** Holton, J.R. & Hakim, G.J. (2012). *An Introduction to Dynamic Meteorology*, 5th ed., Ch. 2. Academic Press.
- **Methodology Flow:**
  1. Input: surface pressure P₀ (hPa), altitude z (m), mean temperature T (K).
  2. Compute scale height: H = R_d·T/g = 287.058 × T / 9.80665.
  3. Compute P(z) = P₀ × exp(−z/H).
  4. Output: Pressure at altitude in hPa.
- **Open-Source Data:** Open-Meteo (pressure_msl for P₀, temperature_2m for T), [Open Topo Data API](https://opentopodata.org/) for elevation.

### Eq 5 — Geostrophic Wind (Holton & Hakim, 2012)
- **Reference:** Holton, J.R. & Hakim, G.J. (2012). *An Introduction to Dynamic Meteorology*, 5th ed.
- **Methodology Flow:**
  1. Input: Coriolis parameter f = 2Ωsin(φ), air density ρ, pressure gradients ∂P/∂x and ∂P/∂y.
  2. Compute components: u_g = −(1/fρ)·∂P/∂y, v_g = (1/fρ)·∂P/∂x.
  3. Magnitude: |V_g| = √(u_g² + v_g²).
  4. Direction: meteorological (from) = 270° − atan2(v_g, u_g)·180/π.
  5. Output: wind speed in m/s and direction.
- **Open-Source Data:** Open-Meteo (pressure at multiple pressure levels for gradients), ERA5 reanalysis via [Copernicus CDS](https://cds.climate.copernicus.eu/) for gridded pressure fields.

### Eq 6 — Advection-Diffusion Equation (Bird, Stewart & Lightfoot, 2007)
- **Reference:** Bird, R.B., Stewart, W.E. & Lightfoot, E.N. (2007). *Transport Phenomena*, 2nd ed. Wiley.
- **Methodology Flow:**
  1. Input: wind speed u (m/s), eddy diffusivity D (m²/s), initial concentration C₀, time t (s).
  2. Compute Péclet number: Pe = u²t/(4D).
  3. Compute dilution factor: exp(−1/Pe).
  4. Peak concentration: C = C₀ × dilution.
  5. Output: concentration in µg/m³.
- **Open-Source Data:** Open-Meteo (wind_speed_10m), user-provided diffusivity and source concentration.

### Eq 7 — Bulk Richardson Number (Stull, 1988)
- **Reference:** Stull, R.B. (1988). *An Introduction to Boundary Layer Meteorology*. Kluwer Academic.
- **Methodology Flow:**
  1. Input: heights z_g, z_s; virtual potential temperatures θ_v at each height; wind speeds u at each height.
  2. Compute buoyancy term: g·Δz·Δθ_v.
  3. Compute shear term: θ_v(s)·Δu².
  4. Ri_b = buoyancy/shear.
  5. Classify: Ri < −0.01 unstable, Ri ~ 0 neutral, 0 < Ri < 0.25 weakly stable, Ri ≥ 0.25 stable.
- **Open-Source Data:** Open-Meteo (multi-level wind/temperature: wind_speed_10m, wind_speed_80m, temperature_2m, temperature_180m).

### Eq 8 — Kolmogorov −5/3 Energy Cascade (Kolmogorov, 1941)
- **Reference:** Kolmogorov, A.N. (1941). "The local structure of turbulence." *Proc. R. Soc. Lond. A*, 434, 9–13.
- **Methodology Flow:**
  1. Input: Kolmogorov constant C ≈ 1.5, TKE dissipation ε (m²/s³), wavenumber k (1/m).
  2. Compute E(k) = C · ε^(2/3) · k^(−5/3).
  3. Derive eddy length: L = 2π/k.
  4. Kolmogorov microscale: η = (ν³/ε)^(1/4).
  5. Output: energy spectrum in m³/s².
- **Open-Source Data:** ERA5 turbulence kinetic energy via [Copernicus CDS](https://cds.climate.copernicus.eu/), Open-Meteo (indirect via wind variability).

---

## Domain 2: Hydrology & Oceanography (Eqs 9–18)

### Eq 9 — FAO-56 Penman-Monteith Reference ET (Allen et al., 1998)
- **Reference:** Allen, R.G. et al. (1998). *Crop Evapotranspiration — Guidelines for Computing Water Requirements.* FAO Irrigation and Drainage Paper 56.
- **Methodology Flow:**
  1. Input: net radiation R_n, soil heat flux G, temperature T, wind speed u₂, saturation vapor pressure e_s, actual vapor pressure e_a, slope Δ, psychrometric constant γ.
  2. Convert R_n and G to MJ/m²/day (multiply by 0.0864).
  3. Compute radiation term: 0.408·Δ·(R_n − G).
  4. Compute aerodynamic term: γ·(900/(T+273))·u₂·(e_s − e_a).
  5. ET₀ = (radTerm + aeroTerm) / (Δ + γ(1 + 0.34u₂)).
  6. Output: reference ET in mm/day.
- **Open-Source Data:** Open-Meteo (`et0_fao_evapotranspiration` field directly, or shortwave_radiation + wind + humidity to compute manually).

### Eq 10 — SCS Curve Number (USDA SCS, 1954)
- **Reference:** USDA Soil Conservation Service (1954). *National Engineering Handbook, Section 4: Hydrology.*
- **Methodology Flow:**
  1. Input: precipitation P, initial abstraction I_a = 0.2S, potential retention S = 25400/CN − 254.
  2. Derive CN from land use + soil group lookup table.
  3. Compute runoff: Q = (P − I_a)² / (P − I_a + S) if P > I_a, else Q = 0.
  4. Output: direct runoff in mm.
- **Open-Source Data:** Open-Meteo (precipitation), [ESA WorldCover](https://esa-worldcover.s3.eu-central-1.amazonaws.com/) for land use, ISRIC SoilGrids for soil texture.

### Eq 11 — Manning's Equation (Manning, 1891)
- **Reference:** Manning, R. (1891). "On the flow of water in open channels and pipes." *Trans. ICEI*, 20, 161–207.
- **Methodology Flow:**
  1. Input: roughness coefficient n, hydraulic radius R (m), slope S (m/m).
  2. v = (1/n) · R^(2/3) · S^(1/2).
  3. Output: velocity in m/s.
- **Open-Source Data:** [Open Topo Data](https://opentopodata.org/) for slope, user-provided roughness from land cover classification, USGS NWIS for stream gauge data.

### Eq 12 — Rational Method (Mulvaney, 1851)
- **Reference:** Mulvaney, T.J. (1851). "On the use of self-registering rain and flood gauges." *J. ICEI*, 4, 18–31.
- **Methodology Flow:**
  1. Input: runoff coefficient C (0–1), rainfall intensity i (mm/h), catchment area A (km²).
  2. Q = C × i × A.
  3. Convert to m³/s: Q_m3s = Q / 3.6.
  4. Output: peak discharge in m³/s.
- **Open-Source Data:** Open-Meteo (precipitation intensity), land use from ESA WorldCover (for C), watershed area from [HydroSHEDS](https://www.hydrosheds.org/).

### Eq 13 — Muskingum Routing (McCarthy, 1938)
- **Reference:** McCarthy, G.T. (1938). "The unit hydrograph and flood routing." Conf. North Atlantic Division, USACE.
- **Methodology Flow:**
  1. Input: storage constant K (hours), weighting factor X (0–0.5), inflow I_t, outflow O_t.
  2. Compute weighted storage: S = K × [X·I_t + (1−X)·O_t].
  3. Output: reach storage in m³/s·h.
- **Open-Source Data:** USGS NWIS (real-time streamflow at upstream/downstream gages).

### Eq 14 — Tidal Harmonic Analysis (Pugh & Woodworth, 2014)
- **Reference:** Pugh, D. & Woodworth, P. (2014). *Sea-Level Science.* Cambridge University Press.
- **Methodology Flow:**
  1. Input: mean sea level H₀, harmonic constituent amplitudes Aᵢ and phases φᵢ.
  2. Sum constituents: h(t) = H₀ + Σ Aᵢ·cos(ωᵢt + φᵢ).
  3. Classify tide: microtidal (< 2m range), mesotidal (2–4m), macrotidal (> 4m).
  4. Output: tidal elevation in meters.
- **Open-Source Data:** [NOAA Tides & Currents API](https://tidesandcurrents.noaa.gov/api/) (verified real-time water levels and harmonic constituents), [UTide (MATLAB/Python)](https://github.com/wotjohnson/utide) for harmonic analysis.

### Eq 15 — Ekman Spiral (Ekman, 1905)
- **Reference:** Ekman, V.W. (1905). "On the influence of the Earth's rotation on ocean-currents." *Arkiv för Matematik, Astronomi och Fysik*, 2(11), 1–52.
- **Methodology Flow:**
  1. Input: wind stress τ (N/m²), seawater density ρ (kg/m³), Coriolis f, eddy viscosity A_v.
  2. Surface current: V₀ = τ / √(ρ·f·A_v).
  3. Ekman depth: D_e = π·√(2A_v/f).
  4. Direction: 45° right of wind (NH), 45° left (SH).
  5. Output: surface current in m/s, Ekman depth in m.
- **Open-Source Data:** [NOAA NDBC buoys](https://www.ndbc.noaa.gov/) (wind stress), Open-Meteo marine (wave/current), [CMEMS](https://marine.copernicus.eu/) for ocean currents.

### Eq 16 — Geostrophic Current (Gill, 1982)
- **Reference:** Gill, A.E. (1982). *Atmosphere-Ocean Dynamics.* Academic Press.
- **Methodology Flow:**
  1. Input: Coriolis f, density ρ, pressure gradient ∂p/∂x.
  2. v_g = (1/ρf) × ∂p/∂x.
  3. Compute equivalent sea surface slope: ∂η/∂x = (1/ρg) × ∂p/∂x.
  4. Output: geostrophic velocity in m/s.
- **Open-Source Data:** [CMEMS](https://marine.copernicus.eu/) (dynamic ocean topography), altimetry from [AVISO](https://www.aviso.altimetry.fr/).

### Eq 17 — Ocean Surface Heat Budget (Gill, 1982)
- **Reference:** Gill, A.E. (1982). *Atmosphere-Ocean Dynamics*, Chapter 3.
- **Methodology Flow:**
  1. Input: shortwave Q_s, longwave Q_b, sensible Q_h, latent Q_e (all W/m²).
  2. Net heat flux: Q_net = Q_s − Q_b − Q_h − Q_e.
  3. SST tendency: dSST/dt = Q_net / (ρ·c_p·H_mix) (°C/day for mixed layer depth H).
  4. Evaporation rate: E = Q_e / (ρ·L_v) in mm/day.
  5. Output: net heat flux in W/m².
- **Open-Source Data:** [NOAA OISST](https://www.ncei.noaa.gov/products/optimum-interpolation-sst) (SST), Open-Meteo (shortwave_radiation), [ERA5 ocean fluxes](https://cds.climate.copernicus.eu/).

### Eq 18 — Green-Ampt Infiltration (Green & Ampt, 1911)
- **Reference:** Green, W.H. & Ampt, G.A. (1911). "Studies on Soil Physics." *J. Agricultural Science*, 4(1), 1–24.
- **Methodology Flow:**
  1. Input: saturated hydraulic conductivity K_s, suction head ψ_f, moisture deficit Δθ, cumulative infiltration F.
  2. f = K_s × (1 + ψ_f·Δθ/F).
  3. Wetting front depth: L = F/Δθ.
  4. Output: infiltration rate in m/s.
- **Open-Source Data:** ISRIC SoilGrids (clay/sand fractions → K_s), [USDA NRCS Web Soil Survey](https://websoilsurvey.sc.egov.usgs.gov/).

---

## Domain 3: Geophysics & Seismology (Eqs 19–25)

### Eq 19 — Gutenberg-Richter Law (Gutenberg & Richter, 1944)
- **Reference:** Gutenberg, B. & Richter, C.F. (1944). "Frequency of earthquakes in California." *BSSA*, 34(4), 185–188.
- **Methodology Flow:**
  1. Input: a-value (seismicity rate), b-value (~1.0 globally), magnitude threshold M.
  2. log₁₀(N) = a − b·M.
  3. N(≥M) = 10^(a−bM) events/year.
  4. Return period: T_r = 1/N.
  5. Output: annual frequency of earthquakes ≥ M.
- **Open-Source Data:** [USGS Earthquake Catalog FDSN API](https://earthquake.usgs.gov/fdsnws/event/1/) (free, no key needed for basic queries).

### Eq 20 — Omori Law (Omori, 1894)
- **Reference:** Omori, F. (1894). "On the after-shocks of earthquakes." *J. College of Science, Imperial Univ. Tokyo*, 7, 111–120.
- **Methodology Flow:**
  1. Input: productivity K, time constant c, time since mainshock t, decay exponent p.
  2. Aftershock rate: n(t) = K / (c + t)^p.
  3. Cumulative: N(t) = K/(p−1) · [c^(1−p) − (c+t)^(1−p)].
  4. Output: aftershock rate in events/day.
- **Open-Source Data:** USGS FDSN Event API (query mainshock + aftershock sequence by time window and region).

### Eq 21 — Campbell-Bozorgnia GMPE (Campbell & Bozorgnia, 2014)
- **Reference:** Campbell, K.W. & Bozorgnia, Y. (2014). "NGA-West2 ground motion model." *Earthquake Spectra*, 30(3), 1087–1115.
- **Methodology Flow:**
  1. Input: magnitude, distance, site class (Vs30), fault type, hanging wall indicator.
  2. Sum component terms: ln(Y) = f_mag + f_dist + f_site + f_fault + f_hw.
  3. Exponentiate: PGA = exp(lnY).
  4. Estimate MMI intensity proxy.
  5. Output: peak ground acceleration in g.
- **Open-Source Data:** USGS ShakeMap API (provides Vs30, fault parameters), USGS FDSN (magnitude, hypocenter).

### Eq 22 — Mohr-Coulomb Failure (Coulomb 1776; Mohr 1900)
- **Reference:** Coulomb, C.A. (1776). *Mém. Acad. R. Sci. Paris*, 7, 343–382. Mohr, O. (1900). *Z. Ver. Dtsch. Ing.*, 44, 1524–1530.
- **Methodology Flow:**
  1. Input: cohesion c (kPa), normal stress σ_n (kPa), friction angle φ (degrees).
  2. Shear strength: τ = c + σ_n · tan(φ).
  3. Derive principal stresses at failure, active/passive earth pressure coefficients.
  4. Output: shear strength in kPa.
- **Open-Source Data:** ISRIC SoilGrids (soil properties), USGS fault database (tectonic stress context).

### Eq 23 — Seismic Moment Magnitude (Hanks & Kanamori, 1979)
- **Reference:** Hanks, T.C. & Kanamori, H. (1979). "A moment magnitude scale." *JGR Solid Earth*, 84(B5), 2348–2350.
- **Methodology Flow:**
  1. Input: seismic moment M₀ (N·m) from moment tensor catalog.
  2. M_w = (2/3)·log₁₀(M₀) − 6.07.
  3. Derive rupture area, slip, seismic energy.
  4. Output: moment magnitude M_w.
- **Open-Source Data:** USGS FDSN moment tensor catalog, [Global CMT](https://www.globalcmt.org/) (free, no key).

### Eq 24 — Brune Stress Drop (Brune, 1970)
- **Reference:** Brune, J.N. (1970). "Tectonic stress and the spectra of seismic shear waves." *JGR*, 75(26), 4997–5009.
- **Methodology Flow:**
  1. Input: seismic moment M₀, source radius r.
  2. Δσ = (7/16) · M₀/r³.
  3. Corner frequency: f_c = 0.49·β/r.
  4. Average slip: D = (7π/16)·Δσ·r/μ.
  5. Output: stress drop in Pa.
- **Open-Source Data:** USGS FDSN (moment, source parameters), [IRIS DMC](https://ds.iris.edu/) for seismograms → corner frequency.

### Eq 25 — Wells-Coppersmith Scaling (Wells & Coppersmith, 1994)
- **Reference:** Wells, D.L. & Coppersmith, K.J. (1994). "New empirical relationships among magnitude, rupture length, rupture width, rupture area." *BSSA*, 84(4), 974–1002.
- **Methodology Flow:**
  1. Input: moment magnitude M_w.
  2. Apply regression equations for each fault type (strike-slip, normal, reverse, all).
  3. log₁₀(L) = a + b·M_w (rupture length), same for width, area, displacement.
  4. Output: rupture dimensions.
- **Open-Source Data:** USGS FDSN catalog (magnitude), [USGS Quaternary Faults DB](https://www.usgs.gov/programs/earthquake-hazards/science/quaternary-fault-and-fold-database-united-states).

---

## Domain 4: Remote Sensing & Cryosphere (Eqs 26–35)

### Eq 26 — NDVI (Rouse et al., 1974)
- **Reference:** Rouse, J.W. et al. (1974). "Monitoring vegetation systems in the Great Plains with ERTS." *Proc. 3rd ERTS-1 Symposium*.
- **Methodology Flow:**
  1. Input: Near-infrared (NIR) and Red reflectance.
  2. NDVI = (NIR − Red) / (NIR + Red).
  3. Range: −1 to +1 (healthy vegetation ~ 0.6–0.9).
  4. Output: dimensionless vegetation index.
- **Open-Source Data:** [ORNL DAAC MODIS Web Service](https://modis.ornl.gov/) (MOD13Q1, 250m, 16-day NDVI), [Sentinel Hub Processing API](https://docs.sentinel-hub.com/) (on-the-fly NDVI from Sentinel-2).

### Eq 27 — NDWI McFeeters (McFeeters, 1996)
- **Reference:** McFeeters, S.K. (1996). "The use of NDWI in the delineation of open water features." *Int. J. Remote Sensing*, 17(7), 1425–1432.
- **Methodology Flow:**
  1. Input: Green and NIR reflectance.
  2. NDWI = (Green − NIR) / (Green + NIR).
  3. Output: water index (>0 indicates open water).
- **Open-Source Data:** Sentinel Hub (Green + NIR bands), Landsat via [USGS EarthExplorer](https://earthexplorer.usgs.gov/).

### Eq 28 — NDWI Gao (Gao, 1996)
- **Reference:** Gao, B.C. (1996). "NDWI — A normalized difference water index for remote sensing of vegetation liquid water." *Remote Sensing of Environment*, 58(3), 257–266.
- **Methodology Flow:**
  1. Input: NIR and SWIR reflectance.
  2. NDWI = (NIR − SWIR) / (NIR + SWIR).
  3. Output: vegetation water content index.
- **Open-Source Data:** Sentinel Hub (Sentinel-2 bands 8 and 11), MODIS (bands 2 and 6).

### Eq 29 — EVI (Huete et al., 2002)
- **Reference:** Huete, A. et al. (2002). "Overview of the radiometric and biophysical performance of the MODIS vegetation indices." *Remote Sensing of Environment*, 83(1-2), 195–213.
- **Methodology Flow:**
  1. Input: Blue, Red, NIR reflectance; gain factors G=2.5, C₁=6, C₂=7.5, L=1.
  2. EVI = G × (NIR − Red) / (NIR + C₁·Red − C₂·Blue + L).
  3. Output: Enhanced Vegetation Index (reduced atmospheric/soil noise).
- **Open-Source Data:** ORNL DAAC MODIS (MOD13Q1 EVI band directly), Sentinel Hub.

### Eq 30 — NDSI Snow Cover (Hall, Riggs & Salomonson, 1995)
- **Reference:** Hall, D.K. et al. (1995). "Development of methods for mapping global snow cover using MODIS data." *Remote Sensing of Environment*, 54(2), 127–140.
- **Methodology Flow:**
  1. Input: Green and SWIR reflectance.
  2. NDSI = (Green − SWIR) / (Green + SWIR).
  3. Snow if NDSI > 0.4.
  4. Output: snow cover binary or fractional.
- **Open-Source Data:** [MODIS MOD10A1](https://nsidc.org/data/mod10a1) (daily snow cover), Sentinel Hub.

### Eq 31 — Normalized Burn Ratio NBR (Key & Benson, 2006)
- **Reference:** Key, C.H. & Benson, N.C. (2006). "Landscape Assessment: NBR." In *FIREMON*, Gen. Tech. Rep. RMRS-GTR-164-CD.
- **Methodology Flow:**
  1. Input: NIR and SWIR reflectance.
  2. NBR = (NIR − SWIR) / (NIR + SWIR).
  3. dNBR = NBR_pre − NBR_post for burn severity.
  4. Output: burn ratio index.
- **Open-Source Data:** [USGS Fire Danger](https://www.fs.usda.gov/), [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/), Sentinel Hub (Sentinel-2).

### Eq 32 — Fire Radiative Power (Giglio, Kendall & Tucker, 2006)
- **Reference:** Giglio, L. et al. (2006). "Multi-year MODIS active fire product production and validation." *IEEE TGRS*, 44(8), 2139–2150.
- **Methodology Flow:**
  1. Input: pixel area A (m²), emissivity ε, fire brightness temperature T_fire, background T_bg.
  2. FRP = ε · σ · A · (T_fire⁴ − T_bg⁴).
  3. Output: fire radiative power in MW.
- **Open-Source Data:** [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/) (near-real-time fire hotspots with FRP), MODIS active fire products.

### Eq 33 — Crop Water Stress Index (Idso et al., 1981)
- **Reference:** Idso, S.B. et al. (1981). "Normalizing the stress-degree-day parameter." *Agricultural Meteorology*, 24, 45–55.
- **Methodology Flow:**
  1. Input: canopy temperature T_c, wet-bulb temperature T_wet, dry-bulb temperature T_dry.
  2. CWSI = (T_c − T_wet) / (T_dry − T_wet).
  3. Range: 0 (no stress) to 1 (full stress).
- **Open-Source Data:** MODIS land surface temperature (MOD11A1), Open-Meteo (air temperature), [NAWRS](https://www.nawrs.org/) for crop conditions.

### Eq 34 — Degree-Day Snowmelt (Braithwaite, 1995)
- **Reference:** Braithwaite, R.J. (1995). "Positive degree-day factors for ablation on the Greenland ice sheet." *J. Glaciology*, 41(137), 153–160.
- **Methodology Flow:**
  1. Input: degree-day factor DDF (mm/°C/day), air temperature T_air, base temperature T_base (0°C).
  2. Melt = DDF × max(0, T_air − T_base).
  3. Output: melt in mm water equivalent/day.
- **Open-Source Data:** Open-Meteo (temperature_2m), ERA5 for glacier region temperatures.

### Eq 35 — Sea Ice Concentration (Comiso, 1986)
- **Reference:** Comiso, J.C. (1986). "Characteristics of Arctic winter sea ice from satellite multispectral microwave observations." *JGR Oceans*, 91(C1), 975–994.
- **Methodology Flow:**
  1. Input: ice concentration C, water temperature, ice temperature.
  2. Apply bootstrap or NASA Team algorithm to microwave brightness temperatures.
  3. Output: sea ice concentration (0–1).
- **Open-Source Data:** [NSIDC Sea Ice Index](https://nsidc.org/data/seaice_index) (passive microwave), [OSI SAF](https://osi-saf.eumetsat.int/) (operational SIC).

---

## Domain 5: Spatial Analysis & Extreme Events (Eqs 36–42)

### Eq 36 — Haversine Distance (Sinnott, 1984)
- **Reference:** Sinnott, R.W. (1984). "Virtues of the Haversine." *Sky and Telescope*, 68(2), 158.
- **Methodology Flow:**
  1. Input: two lat/lon pairs (φ₁,λ₁) and (φ₂,λ₂).
  2. a = sin²(Δφ/2) + cos(φ₁)·cos(φ₂)·sin²(Δλ/2).
  3. d = 2R · atan2(√a, √(1−a)).
  4. Output: great-circle distance in km (R = 6371 km).
- **Open-Source Data:** Pure geometry — no external data needed. Works with any coordinate input.

### Eq 37 — Ordinary Kriging (Matheron, 1963)
- **Reference:** Matheron, G. (1963). "Principles of geostatistics." *Economic Geology*, 58(8), 1246–1266.
- **Methodology Flow:**
  1. Compute experimental semivariogram from observations.
  2. Fit theoretical model (spherical, exponential, Gaussian).
  3. Solve kriging system: Σλⱼγ(sᵢ−sⱼ) + φ = γ(sᵢ−s₀), Σλⱼ = 1.
  4. Prediction: ŷ = Σλᵢz(sᵢ).
- **Open-Source Data:** Point observations from any source; Python library: [PyKrige](https://github.com/GeoPythonFit/PyKrige).

### Eq 38 — Inverse Distance Weighting (Shepard, 1968)
- **Reference:** Shepard, D. (1968). "A two-dimensional interpolation function for irregularly-spaced data." *Proc. 1968 23rd ACM National Conference*, 517–524.
- **Methodology Flow:**
  1. Input: k nearest neighbor observations zᵢ at distances dᵢ.
  2. Weight: wᵢ = 1/dᵢ^p.
  3. ŷ = Σ(wᵢ·zᵢ) / Σ(wᵢ).
  4. Output: interpolated value.
- **Open-Source Data:** Any gridded or point observations; already implemented in the project as `interpolateIDW`.

### Eq 39 — Gaussian Plume Dispersion (Pasquill, 1974)
- **Reference:** Pasquill, F. (1974). *Atmospheric Diffusion*, 2nd ed. Ellis Horwood.
- **Methodology Flow:**
  1. Input: emission rate Q, wind speed u, stack height H, stability class, crosswind σ_y, vertical σ_z.
  2. C(x,y,0) = Q/(π·u·σ_y·σ_z) · exp(−y²/(2σ_y²)) · exp(−H²/(2σ_z²)).
  3. Output: ground-level concentration in µg/m³.
- **Open-Source Data:** Open-Meteo (wind speed), Pasquill stability from solar radiation + wind (computed), [EPA AERMOD](https://www.epa.gov/ttn/catm/MODELS3.htm) reference.

### Eq 40 — Gumbel Distribution (Gumbel, 1958)
- **Reference:** Gumbel, E.J. (1958). *Statistics of Extremes.* Columbia University Press.
- **Methodology Flow:**
  1. Input: location μ, scale β, exceedance value x.
  2. F(x) = exp(−exp(−(x−μ)/β)).
  3. Return period T: x_T = μ − β·ln(−ln(1 − 1/T)).
  4. Output: cumulative probability or quantile.
- **Open-Source Data:** Historical observations from USGS (flood), NOAA (temperature extremes), any time series.

### Eq 41 — Generalized Pareto Distribution (Pickands, 1975)
- **Reference:** Pickands III, J. (1975). "Statistical inference using extreme order statistics." *Annals of Statistics*, 3(1), 119–131.
- **Methodology Flow:**
  1. Input: shape ξ, scale β, threshold exceedance x − u.
  2. F(x) = 1 − (1 + ξ(x−u)/β)^(−1/ξ).
  3. Output: exceedance probability.
- **Open-Source Data:** Threshold exceedance data from any environmental time series; Python: `scipy.stats.genpareto`.

### Eq 42 — Semivariogram (Matheron, 1963)
- **Reference:** Matheron, G. (1963). "Principles of geostatistics." *Economic Geology*, 58(8), 1246–1266.
- **Methodology Flow:**
  1. Input: N point observations, lag distance h.
  2. γ(h) = (1/2N(h)) · Σ[z(sᵢ) − z(sᵢ+h)]².
  3. Fit model: nugget, sill, range.
  4. Output: semivariance as function of lag distance.
- **Open-Source Data:** Any spatial point dataset; Python: `pykrige.variogram_models`.

---

## Domain 6: Soil Science & Land Surface (Eqs 43–50)

### Eq 43 — Van Genuchten (van Genuchten, 1980)
- **Reference:** van Genuchten, M.Th. (1980). "A closed-form equation for predicting hydraulic conductivity." *SSSAJ*, 44(5), 892–898.
- **Methodology Flow:**
  1. Input: θ_r, θ_s, α (cm⁻¹), n, psi (cm).
  2. Effective saturation: S_e = (θ − θ_r)/(θ_s − θ_r).
  3. Hydraulic conductivity: K(S_e) = K_s · S_e^0.5 · [1 − (1 − S_e^(1/m))^m]² where m = 1 − 1/n.
  4. Output: K in cm/day.
- **Open-Source Data:** ISRIC SoilGrids (clay, sand, bulk density → derive α, n), [ROSETTA](https://www.u.arizona.edu/~yoshiko/software/ROSETTA.html) (pedotransfer functions).

### Eq 44 — Brooks-Corey (Brooks & Corey, 1964)
- **Reference:** Brooks, R.H. & Corey, A.T. (1964). *Hydraulic Properties of Porous Media.* Hydrology Papers No. 3, Colorado State Univ.
- **Methodology Flow:**
  1. Input: bubbling pressure ψ_b, pore size distribution index.
  2. K(ψ) = K_s for ψ < ψ_b; K(ψ) = K_s·(ψ_b/ψ)^λ for ψ ≥ ψ_b.
  3. Output: hydraulic conductivity as function of suction.
- **Open-Source Data:** ISRIC SoilGrids, USDA NRCS Web Soil Survey.

### Eq 45 — USLE/RUSLE (Wischmeier & Smith, 1978)
- **Reference:** Wischmeier, W.H. & Smith, D.D. (1978). *Predicting Rainfall Erosion Losses.* USDA Agric. Handbook No. 537.
- **Methodology Flow:**
  1. Input: rainfall erosivity R, soil erodibility K, slope length L, steepness S, cover C, practice P.
  2. A = R × K × L × S × C × P.
  3. Output: soil loss in tons/acre/year.
- **Open-Source Data:** [USDA RUSLE2](https://www.nrcs.usgs.gov/), [WorldClim](https://www.worldclim.org/) (precipitation → R factor), ISRIC SoilGrids (soil texture → K factor), SRTM DEM (slope → LS).

### Eq 46 — Q₁₀ Soil Respiration (Raich & Schlesinger, 1992)
- **Reference:** Raich, J.W. & Schlesinger, W.H. (1992). "The global CO₂ flux in soil respiration." *Tellus B*, 44(2), 81–99.
- **Methodology Flow:**
  1. Input: base respiration R_base, Q₁₀ coefficient, soil temperature T, base temperature T_base.
  2. R_soil = R_base · Q₁₀^((T − T_base)/10).
  3. Output: soil CO₂ flux in µmol/m²/s.
- **Open-Source Data:** Open-Meteo (soil_temperature_0cm), [FLUXNET](https://fluxnet.org/) (eddy covariance towers), [MODIS MOD17](https://lpdaac.usgs.gov/).

### Eq 47 — de Vries Thermal Conductivity (de Vries, 1963)
- **Reference:** de Vries, D.A. (1963). "Thermal properties of soils." In *Physics of Plant Environment*, North-Holland.
- **Methodology Flow:**
  1. Input: volumetric fractions and thermal conductivities of soil components (mineral, organic, water, air).
  2. k_soil = Σ(fᵢ · kᵢ) weighted by geometric or arithmetic mean.
  3. Output: thermal conductivity in W/m/K.
- **Open-Source Data:** ISRIC SoilGrids (bulk density, organic carbon → mineral/organic fractions), [SoilGrids 250m](https://soilgrids.org/).

### Eq 48 — Monin-Obukhov Similarity (Monin & Obukhov, 1954)
- **Reference:** Monin, A.S. & Obukhov, A.M. (1954). "Basic laws of turbulent mixing in the surface layer." *Trudy Geofizicheskogo Instituta*, 24(151), 163–187.
- **Methodology Flow:**
  1. Input: von Kármán constant κ=0.4, friction velocity u*, measurement height z, Obukhov length L.
  2. Stability function φ_m(ζ) where ζ = z/L.
  3. Wind profile: u(z) = (u*/κ) · [ln(z/z₀) − Ψ_m(ζ)].
  4. Output: wind profile under stable/unstable conditions.
- **Open-Source Data:** ERA5 surface fluxes (sensible heat, momentum), Open-Meteo (multi-level winds).

### Eq 49 — Logarithmic Wind Profile (Prandtl, 1925)
- **Reference:** Prandtl, L. (1925). "Über die ausgebildete Turbulenz." *Zeitschrift für Angewandte Mathematik und Mechanik*, 5(2), 136–139.
- **Methodology Flow:**
  1. Input: friction velocity u*, height z, roughness length z₀.
  2. u(z) = (u*/κ) · ln(z/z₀) where κ = 0.4.
  3. Output: wind speed at height z.
- **Open-Source Data:** Open-Meteo (wind_speed_10m + wind_speed_80m → derive u* and z₀), ESA WorldCover (land cover → z₀ lookup).

### Eq 50 — Ball-Berry Stomatal Conductance (Ball, Woodrow & Berry, 1987)
- **Reference:** Ball, J.T. et al. (1987). "A model predicting stomatal conductance." In *Progress in Photosynthesis Research*, Vol. 4, pp. 221–224.
- **Methodology Flow:**
  1. Input: max conductance g₀, slope a₁, assimilation A, relative humidity h_s, CO₂ at surface c_s.
  2. g_s = g₀ + a₁ · A · h_s / c_s.
  5. Output: stomatal conductance in mol/m²/s.
- **Open-Source Data:** [OCO-2/3](https://oco.jpl.nasa.gov/) (CO₂ concentrations), Open-Meteo (humidity), [FLUXNET](https://fluxnet.org/) (assimilation data).

---

---

# PART II — Biosphere, Agriculture & Chemistry (Equations 51–65)

---

## Domain 7: Biosphere & Carbon Cycle (Eqs 51–57)

### Eq 51 — Light Use Efficiency GPP (Monteith, 1977)
- **Reference:** Monteith, J.L. (1977). "Climate and the efficiency of crop production in Britain." *Phil. Trans. R. Soc. London B*, 281(980), 277–294.
- **Methodology Flow:** 1) Input: light use efficiency ε (g C/MJ), fPAR, PAR. 2) GPP = ε × fPAR × PAR. 3) Output: gross primary production in g C/m²/day.
- **Open-Source Data:** ORNL DAAC MODIS (MCD15A3H fPAR), Open-Meteo (shortwave_radiation → PAR = SW×2.02).

### Eq 52 — Beer-Lambert Canopy Extinction (Monsi & Saeki, 1953)
- **Reference:** Monsi, M. & Saeki, T. (1953). *Japanese J. Botany*, 14, 22–52.
- **Methodology Flow:** 1) I(z) = I₀ × exp(−k × LAI). 2) Output: radiation at canopy depth.
- **Open-Source Data:** ORNL DAAC MODIS (LAI), Open-Meteo (radiation).

### Eq 53 — Net Ecosystem Exchange (Wofsy et al., 1993)
- **Reference:** Wofsy, S.C. et al. (1993). *Science*, 260(5112), 1314–1317.
- **Methodology Flow:** 1) NEE = R_eco − GPP. 2) Positive = net CO₂ source, negative = sink.
- **Open-Source Data:** FLUXNET, AmeriFlux (direct eddy covariance NEE measurements).

### Eq 54 — FvCB Photosynthesis (Farquhar et al., 1980)
- **Reference:** Farquhar, G.D. et al. (1980). *Planta*, 149(1), 78–90.
- **Methodology Flow:** 1) Compute Rubisco-limited A_c = Vcmax×(Ci−Γ*)/(Ci+Kc(1+O/Ko)). 2) Compute RuBP-limited A_j. 3) A = min(A_c, A_j).
- **Open-Source Data:** OCO-2/3 (atmospheric CO₂), FLUXNET (Vcmax validation).

### Eq 55 — Allometric Biomass (Chave et al., 2014)
- **Reference:** Chave, J. et al. (2014). *Global Change Biology*, 20(10), 3177–3190.
- **Methodology Flow:** 1) AGB = a × ρ_wood × DBH^b. 2) Output: biomass in kg per tree.
- **Open-Source Data:** Global Forest Watch (forest cover), BIEN (trait database).

### Eq 56 — Ocean CO₂ Uptake Wanninkhof (1992)
- **Reference:** Wanninkhof, R. (1992). *JGR Oceans*, 97(C5), 7373–7382.
- **Methodology Flow:** 1) k = 0.31 × u². 2) Flux = k × K₀ × ΔpCO₂. 3) Output: CO₂ flux in mmol/m²/day.
- **Open-Source Data:** SOCAT (Surface Ocean CO₂ Atlas), NOAA PMEL.

### Eq 57 — Redfield Ratio (Redfield, 1934)
- **Reference:** Redfield, A.C. (1934). *James Johnstone Memorial Volume*, 176–192.
- **Methodology Flow:** 1) C:N:P = 106:16:1 (canonical). 2) Deviations indicate nutrient limitation.
- **Open-Source Data:** GLODAP (ocean carbon), NOAA World Ocean Atlas (nutrients).

---

## Domain 8: Agriculture & Crop Science (Eqs 58–63)

### Eq 58 — Growing Degree Days (Barger, 1969)
- **Reference:** Barger, G.L. (1969). *Weekly Weather and Crop Bulletin*, 56(16), 10.
- **Methodology Flow:** 1) GDD = max(0, min(T_avg, T_upper) − T_base). 2) Accumulate daily.
- **Open-Source Data:** Open-Meteo (daily temperature), USDA Crop Progress.

### Eq 59 — Priestley-Taylor ET (Priestley & Taylor, 1972)
- **Reference:** Priestley, C.H.B. & Taylor, R.J. (1972). *Monthly Weather Review*, 100(2), 81–92.
- **Methodology Flow:** 1) ET = α × (Δ/(Δ+γ)) × (R_n − G). 2) α=1.26 for unstressed.
- **Open-Source Data:** Open-Meteo (radiation, temp), ERA5 (surface fluxes).

### Eq 60 — Hargreaves-Samani ET (1985)
- **Reference:** Hargreaves & Samani (1985). *Applied Engineering in Agriculture*, 1(2), 96–99.
- **Methodology Flow:** 1) ET₀ = 0.0023 × R_a × (T_avg+17.8) × √(T_max−T_min).
- **Open-Source Data:** Open-Meteo (temp extremes), NASA POWER (R_a).

### Eq 61 — FAO Yield Response to Water (Allen et al., 1998)
- **Reference:** FAO Paper 56.
- **Methodology Flow:** 1) (Y_m−Y_a)/Y_m = K_y × (1−ET_a/ET_m). 2) Yield reduction from water stress.
- **Open-Source Data:** FAO AQUASTAT (crop coefficients), Open-Meteo (ET₀).

### Eq 62 — Eppley Temperature-Growth (Eppley, 1972)
- **Reference:** Eppley, R.W. (1972). *Fishery Bulletin*, 70(4), 1063–1085.
- **Methodology Flow:** 1) μ = μ_max × 1.066^T. 2) Phytoplankton growth rate.
- **Open-Source Data:** NOAA Ocean Color (SST+chlorophyll), Copernicus Marine.

### Eq 63 — Bigleaf Model (Sellers et al., 1986)
- **Reference:** Sellers, P.J. et al. (1986). *J. Atmospheric Sciences*, 43(6), 505–531.
- **Methodology Flow:** 1) λE = ρ·c_p·(es−ea)/(ra+rs). 2) H = ρ·c_p·(Ts−Ta)/ra.
- **Open-Source Data:** ERA5 (profiles), MODIS (LST), FLUXNET.

---

## Domain 9: Atmospheric Chemistry & Aerosols (Eqs 64–65)

### Eq 64 — Chapman Ozone Cycle (Chapman, 1930)
- **Reference:** Chapman, S. (1930). *Memoirs of the R. Met. Soc.*, 3(26), 103–125.
- **Methodology Flow:** 1) O₂+hν→2O, O+O₂+M→O₃+M. 2) Steady-state [O₃] from production/destruction balance.
- **Open-Source Data:** Aura MLS (stratospheric ozone), Copernicus CAMS.

### Eq 65 — Pollutant Lifetime (Seinfeld & Pandis, 2016)
- **Reference:** Seinfeld & Pandis (2016). *Atmospheric Chemistry and Physics.* Wiley.
- **Methodology Flow:** 1) τ = 1/(k × [OH]). 2) Output: lifetime in hours.
- **Open-Source Data:** OpenAQ (pollutant concentrations), Open-Meteo air quality.

---

# PART III — Ocean & Coastal Advanced (Equations 66–80)

---

## Domain 10: Ocean Dynamics & Circulation (Eqs 66–73)

### Eq 66 — Sverdrup Balance (Sverdrup, 1947)
- **Reference:** Sverdrup, H.U. (1947). *PNAS*, 33(11), 318–326.
- **Methodology Flow:** 1) M_y = (1/β) × curl(τ). 2) Meridional integrated transport.
- **Open-Source Data:** ERA5 wind stress (CDS), OSCAR currents.

### Eq 67 — Stommel Western Boundary Current (Stommel, 1948)
- **Reference:** Stommel, H. (1948). *Trans. AGU*, 29(2), 202–206.
- **Methodology Flow:** 1) β·∂ψ/∂x = A_H·∇⁴ψ + curl(τ)/ρ. 2) Western intensification.
- **Open-Source Data:** ERA5 wind stress, CMEMS surface currents.

### Eq 68 — Munk Viscous Boundary Layer (Munk, 1950)
- **Reference:** Munk, W.H. (1950). *J. Meteorology*, 7(2), 79–93.
- **Methodology Flow:** 1) δ_M = (A_H/β)^(1/3). 2) Boundary layer width.
- **Open-Source Data:** ERA5 (wind fields), AVISO altimetry.

### Eq 69 — Stommel Box Model Thermohaline (Stommel, 1961)
- **Reference:** Stommel, H. (1961). *Tellus*, 13(2), 224–230.
- **Methodology Flow:** 1) Two-box density model. 2) Determine thermal vs haline circulation regime.
- **Open-Source Data:** Argo floats (T/S profiles), WOA climatology.

### Eq 70 — TEOS-10 Seawater Density (2010)
- **Reference:** IOC, SCOR & IAPSO (2010). UNESCO Manuals and Guides No. 56.
- **Methodology Flow:** 1) SA→absolute salinity. 2) 75-term polynomial equation of state. 3) Density from (S_A, Θ, p).
- **Open-Source Data:** Argo floats, Copernicus Marine, Python gsw library.

### Eq 71 — Osborn-Cox Turbulent Diffusivity (Osborn & Cox, 1972)
- **Reference:** Osborn & Cox (1972). *Geophysical Fluid Dynamics*, 3(1), 321–345.
- **Methodology Flow:** 1) K_ρ = γ × ε / N². 2) Diapycnal diffusivity.
- **Open-Source Data:** Argo profiles, microstructure profiler data.

### Eq 72 — Price-Weller-Pinkel Mixed Layer (1986)
- **Reference:** Price, Weller & Pinkel (1986). *JGR Oceans*, 91(C7), 8411–8427.
- **Methodology Flow:** 1) Bulk Ri = 0.65 criterion. 2) Incremental deepening with wind/heat flux.
- **Open-Source Data:** Argo (mixed layer depth), ERA5 (wind, heat flux).

### Eq 73 — Pierson-Moskowitz Sea State (Pierson & Moskowitz, 1964)
- **Reference:** Pierson & Moskowitz (1964). *JGR*, 69(24), 5181–5190.
- **Methodology Flow:** 1) S(f) = (αg²/(2π)⁴f⁵)×exp(−β(f₀/f)⁴). 2) Fully developed wave spectrum.
- **Open-Source Data:** ERA5 ocean waves (CDS), NDBC buoys.

---

## Domain 11: Coastal & Wave Mechanics (Eqs 74–80)

### Eq 74 — Wave Runup Stockdon (Stockdon et al., 2006)
- **Reference:** Stockdon et al. (2006). *Coastal Engineering*, 53(7), 573–588.
- **Methodology Flow:** 1) R₂ = 1.1×(η̄+0.5×√(S_w²+S_ig²)). 2) 2% exceedance runup.
- **Open-Source Data:** ERA5 wave hindcast, USACE WIS.

### Eq 75 — Bruun Rule (Bruun, 1962)
- **Reference:** Bruun, P. (1962). *J. Waterways and Harbors Div.*, 88(1), 117–130.
- **Methodology Flow:** 1) R = L*×S/(S_f+S). 2) Shoreline retreat per sea level rise.
- **Open-Source Data:** USGS Coastal Change, NOAA sea level trends.

### Eq 76 — McCowan Wave Breaking (McCowan, 1894)
- **Reference:** McCowan, J. (1894). *Phil. Mag. Series 5*, 38(233), 351–358.
- **Methodology Flow:** 1) H/h = γ_b ≈ 0.78. 2) Breaking criterion.
- **Open-Source Data:** GEBCO bathymetry, ERA5 wave fields.

### Eq 77 — CERC Longshore Sediment Transport (USACE, 1984)
- **Reference:** CERC (1984). *Shore Protection Manual.* USACE.
- **Methodology Flow:** 1) Q_l = K × H_sb^(5/2) × sin(2θ_b). 2) Longshore transport.
- **Open-Source Data:** USACE WIS (wave climate).

### Eq 78 — Airy Wave Theory (Airy, 1845)
- **Reference:** Airy, G.B. (1845). *Encyclopaedia Metropolitana*, Vol. 5.
- **Methodology Flow:** 1) ω² = gk×tanh(kh). 2) Dispersion relation → phase speed.
- **Open-Source Data:** NDBC buoys, ERA5 wave.

### Eq 79 — Stokes Drift (Stokes, 1847)
- **Reference:** Stokes, G.G. (1847). *Trans. Cambridge Phil. Soc.*, 8, 441–455.
- **Methodology Flow:** 1) u_s = a²ωk×cosh(2k(z+h))/(2sinh²(kh)). 2) Surface drift velocity.
- **Open-Source Data:** ERA5 wave, Argo surface drift.

### Eq 80 — JONSWAP Wave Spectrum (Hasselmann et al., 1973)
- **Reference:** Hasselmann et al. (1973). *Deutsche Hydrographische Zeitschrift.*
- **Methodology Flow:** 1) JONSWAP = PM × γ^(exp(...)). 2) Peak-enhanced spectrum.
- **Open-Source Data:** ERA5 wave spectra, NDBC (observed spectra).

---

# PART IV — Geomorphology, Limnology & Cryosphere (Equations 81–95)

---

## Domain 12: Geomorphology & Mass Wasting (Eqs 81–87)

### Eq 81 — Stream Power Law (Howard & Kerby, 1983)
- **Reference:** Howard & Kerby (1983). *GSA Bulletin*, 94(6), 739–752.
- **Methodology Flow:** 1) E = K × A^m × S^n. 2) Erosion rate from drainage area and slope.
- **Open-Source Data:** SRTM DEM, OpenTopography.

### Eq 82 — Hack's Law (Hack, 1957)
- **Reference:** Hack, J.T. (1957). *USGS Prof. Paper*, 294-B.
- **Methodology Flow:** 1) L = c × A^h. 2) Length-area scaling.
- **Open-Source Data:** SRTM DEM (flow accumulation).

### Eq 83 — Richardson Fractal Dimension (Richardson, 1961)
- **Reference:** Richardson, L.F. (1961). *General Systems*, 6, 139–187.
- **Methodology Flow:** 1) L(s) = L₁×s^(1−D). 2) Fractal dimension from log-log slope.
- **Open-Source Data:** Spatial boundary data at multiple scales.

### Eq 84 — Infinite Slope Stability (Campbell, 1975)
- **Reference:** Campbell, R.H. (1975). *USGS Prof. Paper*, 851.
- **Methodology Flow:** 1) FS = (c'+(γz·cos²β−u)×tanφ)/(γz·sinβ×cosβ). 2) Factor of safety.
- **Open-Source Data:** ISRIC SoilGrids, SRTM DEM, USGS landslide hazards.

### Eq 85 — Voellmy Friction Model (Voellmy, 1955)
- **Reference:** Voellmy, A. (1955). *Schweizerische Bauzeitung*, 73.
- **Methodology Flow:** 1) τ = μσ_N + ρv²/ξ. 2) Avalanche resistance.
- **Open-Source Data:** SLF avalanche database, SRTM DEM.

### Eq 86 — Stream Power Index (Moore et al., 1991)
- **Reference:** Moore et al. (1991). *Hydrological Processes*, 5(1), 3–30.
- **Methodology Flow:** 1) SPI = ln(A_s × tanB). 2) Topographic wetness.
- **Open-Source Data:** SRTM DEM (TauDEM/GRASS).

### Eq 87 — Topographic Wetness Index (Beven & Kirkby, 1979)
- **Reference:** Beven & Kirkby (1979). *Hydrological Sciences Bulletin*, 24(1), 43–69.
- **Methodology Flow:** 1) TWI = ln(a/tanB). 2) Higher = wetter.
- **Open-Source Data:** SRTM DEM, HydroSHEDS.

---

## Domain 13: Limnology & Freshwater (Eqs 88–90)

### Eq 88 — Lake Evaporation Meyer's (Meyer, 1915)
- **Reference:** Meyer, A.F. (1915). *Trans. ASCE*, 79.
- **Methodology Flow:** 1) E = K_m×(e_w−e_a)×(1+0.5u). 2) Lake evaporation.
- **Open-Source Data:** Open-Meteo (wind, humidity), USGS lake monitoring.

### Eq 89 — Schmidt Stability Number (Schmidt, 1928)
- **Reference:** Schmidt, W. (1928). *Geografiska Annaler*, 10, 145–177.
- **Methodology Flow:** 1) S = (g/A₀)×∫A(z)(ρ_z−ρ_m)(z−z_v)dz. 2) Stratification stability.
- **Open-Source Data:** LakeATLAS (morphology), local temp profiles.

### Eq 90 — Nash Cascade Linear Reservoirs (Nash, 1957)
- **Reference:** Nash, J.E. (1957). *IUGG Assembly*, Toronto.
- **Methodology Flow:** 1) U(t) = (1/K)(t/K)^(n−1)exp(−t/K)/Γ(n). 2) Unit hydrograph.
- **Open-Source Data:** USGS NWIS (streamflow).

---

## Domain 14: Cryosphere Advanced & Volcanology (Eqs 91–95)

### Eq 91 — Glacier Mass Balance PDD (Braithwaite & Olesen, 1989)
- **Reference:** Braithwaite & Olesen (1989). In *Glacier Fluctuations and Climatic Change*.
- **Methodology Flow:** 1) Ablation = DDF×Σmax(0,T_i). 2) Mass balance = accumulation − ablation.
- **Open-Source Data:** Open-Meteo (temp), GLIMS (glacier outlines), WGMS.

### Eq 92 — Stefan Permafrost Active Layer (Stefan, 1891)
- **Reference:** Stefan, J. (1891). *Sitzungsber. Akad. Wiss. Wien*, 98.
- **Methodology Flow:** 1) d = √(2K·DDF/(Lρ)). 2) Maximum thaw depth.
- **Open-Source Data:** GTN-P (permafrost temp), ERA5 (temp).

### Eq 93 — Herron-Langway Firn Densification (1980)
- **Reference:** Herron & Langway (1980). *J. Glaciology*, 25(93), 373–385.
- **Methodology Flow:** 1) Empirical dρ/dt from (ρ, T). 2) Firn density profile.
- **Open-Source Data:** SPOTvelocities, ice core data from PANGAEA.

### Eq 94 — VEI Volume Relationship (Newhall & Self, 1982)
- **Reference:** Newhall & Self (1982). *JGR*, 87, 1231–1238.
- **Methodology Flow:** 1) log₁₀(V) ≈ VEI−4. 2) Eruption volume from VEI.
- **Open-Source Data:** Smithsonian GVP, USGS VHP.

### Eq 95 — Morton-Taylor-Turner Buoyant Plume (1956)
- **Reference:** Morton, Taylor & Turner (1956). *Proc. R. Soc. London A*, 234(1196), 1–23.
- **Methodology Flow:** 1) z ∝ (Q_dot/ρ_air)^(1/3) × x^(2/3). 2) Plume rise.
- **Open-Source Data:** VAAC advisories, GOES/Himawari satellite.

---

# PART V — Climate & Atmosphere Advanced (Equations 96–110)

---

## Domain 15: Climate Dynamics & Feedback (Eqs 96–101)

### Eq 96 — Budyko-Sellers Energy Balance (Budyko 1969; Sellers 1969)
- **Reference:** Budyko (1969) *Tellus*; Sellers (1969) *J. Applied Meteorology*.
- **Methodology Flow:** 1) C·dT/dt = (S/4)(1−α) − I − D∇²T. 2) Equilibrium temperature.
- **Open-Source Data:** CERES (radiation budget), NASA GISS (temp anomalies).

### Eq 97 — Climate Sensitivity (Manabe & Wetherald, 1967)
- **Reference:** Manabe & Wetherald (1967). *J. Atmospheric Sciences*, 24(3), 241–259.
- **Methodology Flow:** 1) ΔT_eq = ΔF/(λ₀(1−f)). 2) ECS for 2×CO₂.
- **Open-Source Data:** IPCC AR6, Climate Explorer (KNMI).

### Eq 98 — Planck Feedback Parameter (Pierrehumbert, 2010)
- **Reference:** Pierrehumbert (2010). *Principles of Planetary Climate.* Cambridge.
- **Methodology Flow:** 1) λ₀ = 4σT³ ≈ 3.2 W/m²/K. 2) Planck feedback.
- **Open-Source Data:** Pure radiative physics — no external data.

### Eq 99 — Rossby Wave Dispersion (Rossby et al., 1939)
- **Reference:** Rossby et al. (1939). *J. Marine Research*, 2(1), 38–55.
- **Methodology Flow:** 1) ω = −βk/(k²+l²+1/L_R²). 2) Westward propagation.
- **Open-Source Data:** ERA5 (geopotential height).

### Eq 100 — Charney-Stern Theorem (Charney & Stern, 1962)
- **Reference:** Charney & Stern (1962). *J. Atmospheric Sciences*, 19(2), 159–172.
- **Methodology Flow:** 1) dq/dy must change sign → necessary for instability.
- **Open-Source Data:** ERA5 (PV gradients).

### Eq 101 — Eady Growth Rate (Eady, 1949)
- **Reference:** Eady, E.T. (1949). *Tellus*, 1(3), 33–52.
- **Methodology Flow:** 1) σ_max = 0.3098×f×|∂U/∂z|/N. 2) Baroclinic instability growth.
- **Open-Source Data:** ERA5 (wind shear, temp gradient, N).

---

## Domain 16: Atmospheric Dynamics & Turbulence (Eqs 102–107)

### Eq 102 — Quasi-Geostrophic Potential Vorticity (Charney, 1948)
- **Reference:** Charney (1948). *Geofysiske Publikasjoner*, 17(2), 1–17.
- **Methodology Flow:** 1) q = ∇²ψ + f + (f₀²/N²)∂²ψ/∂z². 2) QG PV conservation.
- **Open-Source Data:** ERA5 (geopotential, temp, wind).

### Eq 103 — Reynolds Decomposition (Reynolds, 1895)
- **Reference:** Reynolds (1895). *Phil. Trans. R. Soc. London A*, 186.
- **Methodology Flow:** 1) u = ū + u'. 2) Reynolds stress = −ρ⟨u'w'⟩.
- **Open-Source Data:** FLUXNET (high-freq), ERA5 (TKE).

### Eq 104 — Ekman Layer Depth (Ekman, 1905)
- **Reference:** Ekman (1905). *Arkiv för Matematik*, 2(11).
- **Methodology Flow:** 1) D_E = π√(2K_m/f). 2) Boundary layer depth.
- **Open-Source Data:** ERA5 (eddy viscosity), Argo (ocean mixed layer).

### Eq 105 — Deardorff Convective Velocity Scale (Deardorff, 1970)
- **Reference:** Deardorff (1970). *J. Atmospheric Sciences*, 27(8), 1211–1213.
- **Methodology Flow:** 1) w* = (g/θ_V × ⟨wθ⟩₀ × z_i)^(1/3).
- **Open-Source Data:** ERA5 (surface heat flux, BL height).

### Eq 106 — Petterssen Frontogenesis (Petterssen, 1936)
- **Reference:** Petterssen (1936). *Geofysiske Publikasjoner*, 11(6), 1–27.
- **Methodology Flow:** 1) F = d(∇θ)/dt from deformation and divergence.
- **Open-Source Data:** ERA5 (temp, wind).

### Eq 107 — Vorticity Equation (Holton & Hakim, 2012)
- **Reference:** Holton & Hakim (2012). *Dynamic Meteorology*, 5th ed., Ch. 5.
- **Methodology Flow:** 1) dζ/dt = −(ζ+f)×D + tilting + friction.
- **Open-Source Data:** ERA5 (wind fields).

---

## Domain 17: Cloud Physics & Precipitation (Eqs 108–110)

### Eq 108 — Köhler Equation (Köhler, 1936)
- **Reference:** Köhler (1936). *Trans. Faraday Society*, 32, 1152–1161.
- **Methodology Flow:** 1) S/S₀ = exp(2σ/(ρ_LRTr))×(1−a/r³). 2) Critical supersaturation.
- **Open-Source Data:** CloudNet, ACE-ENA (aerosol/cloud).

### Eq 109 — Marshall-Palmer Drop Size Distribution (1948)
- **Reference:** Marshall & Palmer (1948). *J. Meteorology*, 5(4), 165–166.
- **Methodology Flow:** 1) N(D) = N₀×exp(−ΛD). 2) Λ = 41×R^(−0.21).
- **Open-Source Data:** NOAA NEXRAD (radar), DARDAR (satellite).

### Eq 110 — Z-R Relationship (Marshall & Palmer, 1948)
- **Reference:** Same as 109.
- **Methodology Flow:** 1) Z = 200 × R^1.6. 2) Rainfall from radar reflectivity.
- **Open-Source Data:** NOAA NEXRAD Level II, GPM IMERG.

---

# PART VI — Space Environment & Satellite (Equations 111–130)

---

## Domain 18: Geodesy & Reference Frames (Eqs 111–115)

### Eq 111 — IERS Earth Rotation Matrix (Petit & Luzum, 2010)
- **Reference:** IERS Conventions (2010). Tech. Note 36.
- **Methodology Flow:** 1) R = R₃(−ERA)×R₁(y_p)×R₂(x_p). 2) Terrestrial→celestial transform.
- **Open-Source Data:** IERS EOP 14 C04, CDDIS/NASA.

### Eq 112 — Earth Tides Love Numbers (Wahr, 1981)
- **Reference:** Wahr (1981). *Geophysical Journal International*, 64(3), 679–703.
- **Methodology Flow:** 1) Displacement from Love numbers h_n, k_n, l_n and tidal potential.
- **Open-Source Data:** IERS, NAIF/SPICE (planetary ephemerides).

### Eq 113 — EGM2008 Gravity Field (Pavlis et al., 2012)
- **Reference:** Pavlis et al. (2012). *JGR Solid Earth*, 117, B04406.
- **Methodology Flow:** 1) V(r,φ,λ) via spherical harmonics. 2) g = −∇V.
- **Open-Source Data:** NGA EGM2008, Python harmonica library.

### Eq 114 — Helmert 7-Parameter Transformation (Heiskanen & Moritz, 1967)
- **Reference:** Heiskanen & Moritz (1967). *Physical Geodesy.*
- **Methodology Flow:** 1) [x'] = s×R×[x]+T. 2) Frame transformation.
- **Open-Source Data:** IERS transformation params, pyproj.

### Eq 115 — Geoid Height (Heiskanen & Moritz, 1967)
- **Reference:** Same as 114.
- **Methodology Flow:** 1) N = h−H. 2) Or Stokes integral.
- **Open-Source Data:** EGM2008 geoid grids.

---

## Domain 19: Thermosphere, Ionosphere & Magnetosphere (Eqs 116–122)

### Eq 116 — NRLMSISE-00 Thermosphere (Picone et al., 2002)
- **Reference:** Picone et al. (2002). *JGR*, 107(A12).
- **Methodology Flow:** 1) Neutral density/temperature from (alt, lat, lon, F10.7, ap).
- **Open-Source Data:** NOAA SWPC (F10.7, Kp), NRLMSISE-00 code, NASA CCMC.

### Eq 117 — IRI-2016 Ionosphere (Bilitza et al., 2017)
- **Reference:** Bilitza et al. (2017). *Space Weather*, 15, 418–429.
- **Methodology Flow:** 1) Electron density N_e profile from (alt, loc, time, R12, IG12).
- **Open-Source Data:** IRI website (free code), NOAA SWPC.

### Eq 118 — Joule Heating (Richmond, 1986)
- **Reference:** Richmond (1986). *J. Atmospheric and Terrestrial Physics*, 48(11-12).
- **Methodology Flow:** 1) Q_J = σ_P × |E|².
- **Open-Source Data:** NASA CCMC, NOAA SWPC.

### Eq 119 — Ionospheric Scintillation S4 (Yeh & Liu, 1982)
- **Reference:** Yeh & Liu (1982). *Proceedings of the IEEE*, 70(4), 324–360.
- **Methodology Flow:** 1) S4 = √(⟨I²⟩−⟨I⟩²)/⟨I⟩.
- **Open-Source Data:** NASA SCINDA, GNSS receivers.

### Eq 120 — Magnetopause Standoff Shue (Shue et al., 1998)
- **Reference:** Shue et al. (1998). *JGR*, 103(A8), 17691–17700.
- **Methodology Flow:** 1) R₀ = f(P_dyn, B_z). 2) Magnetopause standoff.
- **Open-Source Data:** OMNIWeb (solar wind P_dyn, B_z).

### Eq 121 — Dst Ring Current Index (Sugiura, 1964)
- **Reference:** Sugiura (1964). *Annals of the IGY*, 35.
- **Methodology Flow:** 1) Dst from low-latitude H-component anomalies.
- **Open-Source Data:** WDC Kyoto (official Dst), OMNIWeb.

### Eq 122 — Debye Length (Debye & Hückel, 1923)
- **Reference:** Debye & Hückel (1923). *Physikalische Zeitschrift*, 24.
- **Methodology Flow:** 1) λ_D = √(ε₀k_BT_e/(n_ee²)).
- **Open-Source Data:** IRI (n_e), NRLMSISE-00 (T).

---

## Domain 20: Satellite Dynamics & Space Debris (Eqs 123–127)

### Eq 123 — Satellite Drag Force (King-Hele, 1987)
- **Reference:** King-Hele (1987). *Satellite Orbits in an Atmosphere.* Blackie.
- **Methodology Flow:** 1) F = 0.5×ρ×C_D×A×v². 2) Drag deceleration.
- **Open-Source Data:** NRLMSISE-00, Space-Track.org, CelesTrak.

### Eq 124 — Orbital Decay Rate (King-Hele, 1987)
- **Reference:** King-Hele (1987), Ch. 4.
- **Methodology Flow:** 1) da/dt = −ρ×C_D×(A/m)×v×a.
- **Open-Source Data:** NRLMSISE-00, CelesTrak TLEs.

### Eq 125 — Collision Probability (Foster & Estes, 1992)
- **Reference:** Foster & Estes (1992). NASA JSC-25898.
- **Methodology Flow:** 1) P_c ≈ (A₁+A₂)/(2πσ_xσ_y)×exp(−d²/(2σ²)).
- **Open-Source Data:** ESA SOCIS, Space-Track.

### Eq 126 — Kessler Syndrome Debris Growth (Kessler & Cour-Palais, 1978)
- **Reference:** Kessler & Cour-Palais (1978). *JGR*, 83(A6), 2637–2646.
- **Methodology Flow:** 1) dN/dt = γN²σv − removal. 2) Critical density threshold.
- **Open-Source Data:** ESA MASTER, NASA ORDEM.

### Eq 127 — Hill-Clohessy-Wiltshire (Hill 1878; C&W 1960)
- **Reference:** Hill (1878); Clohessy & Wiltshire (1960).
- **Methodology Flow:** 1) Linearized relative motion equations. 2) State transition matrix.
- **Open-Source Data:** CelesTrak, Python poliastro.

---

## Domain 21: Solar-Terrestrial & GNSS (Eqs 128–130)

### Eq 128 — Kp Geomagnetic Index (Bartels, 1949)
- **Reference:** Bartels (1949). *IATME Bulletin*, 12b, 97–120.
- **Methodology Flow:** 1) H-range from 13 stations → K per station → weighted Kp.
- **Open-Source Data:** NOAA SWPC (real-time Kp JSON), GFZ Potsdam.

### Eq 129 — DOP Dilution of Precision (Kaplan & Hegarty, 2006)
- **Reference:** Kaplan & Hegarty (2006). *Understanding GPS*, 2nd ed. Artech House.
- **Methodology Flow:** 1) DOP = √(trace((H^TH)⁻¹)). 2) From satellite geometry.
- **Open-Source Data:** GPS.GPS.GOV, IGS RINEX.

### Eq 130 — Saastamoinen Tropospheric Delay (Saastamoinen, 1972)
- **Reference:** Saastamoinen (1972). *AGU Geophysical Monograph*, 15, 247–251.
- **Methodology Flow:** 1) ZHD = 0.002277P/(1−0.00266cos2φ). 2) ZWD = 0.002277(1255/(T+0.05))e. 3) Slant = (ZHD+ZWD)/sinE.
- **Open-Source Data:** Open-Meteo (P,T,e), VMF3, IGS troposphere products.

---

# PART VII — Advanced Engineering & Risk (Equations 131–150)

---

## Domain 22: Groundwater & Subsurface (Eqs 131–134)

### Eq 131 — Thiem Equation (Thiem, 1906)
- **Reference:** Thiem, G. (1906). *Hydrologische Methoden.*
- **Methodology Flow:** 1) Q = 2πT×(h₂−h₁)/ln(r₂/r₁). 2) Steady radial flow.
- **Open-Source Data:** USGS NWIS (groundwater levels).

### Eq 132 — Theis Transient Drawdown (Theis, 1935)
- **Reference:** Theis (1935). *Trans. AGU*, 16(2), 519–524.
- **Methodology Flow:** 1) s = Q/(4πT)×W(u). 2) Well function W(u).
- **Open-Source Data:** USGS NWIS, Python flopy.

### Eq 133 — Cooper-Jacob Approximation (Cooper & Jacob, 1946)
- **Reference:** Cooper & Jacob (1946). *Trans. AGU*, 27(4), 526–534.
- **Methodology Flow:** 1) Semi-log straight line analysis. 2) T and S from pump test.
- **Open-Source Data:** USGS NWIS.

### Eq 134 — Horton Infiltration (Horton, 1940)
- **Reference:** Horton (1940). *SSSAJ*, 5, 399–417.
- **Methodology Flow:** 1) f(t) = f_c+(f₀−f_c)e^(−kt). 2) Exponential decay.
- **Open-Source Data:** ISRIC SoilGrids, Open-Meteo.

---

## Domain 23: Hazard, Risk & Disaster Engineering (Eqs 135–140)

### Eq 135 — Risk = Hazard × Vulnerability × Exposure (UNISDR, 2004)
- **Reference:** UNISDR (2004). *Living with Risk.*
- **Methodology Flow:** 1) Risk = H×V×E. 2) Composite risk score.
- **Open-Source Data:** EM-DAT, FEMA NFHL, GHSL.

### Eq 136 — Expected Annual Damage (USACE, 2006)
- **Reference:** USACE EM 1110-2-1619.
- **Methodology Flow:** 1) EAD = ∫D(P)dP. 2) Damage-frequency integration.
- **Open-Source Data:** FEMA BCA tools, USGS flood frequency.

### Eq 137 — AQI Breakpoint (US EPA, 1999)
- **Reference:** EPA-454/R-99-010.
- **Methodology Flow:** 1) AQI = [(I_hi−I_lo)/(BP_hi−BP_lo)]×(C−BP_lo)+I_lo.
- **Open-Source Data:** OpenAQ, AirNow API, WAQI.

### Eq 138 — Probable Maximum Precipitation (Chow, 1964)
- **Reference:** Chow (Ed.) (1964). *Handbook of Applied Hydrology.*
- **Methodology Flow:** 1) PMP = X̄+K_p×σ_X. 2) Frequency factor method.
- **Open-Source Data:** NOAA Atlas 14, WMO.

### Eq 139 — Palmer Drought Severity Index (Palmer, 1965)
- **Reference:** Palmer (1965). *Meteorological Drought.* USWB Research Paper 45.
- **Methodology Flow:** 1) Water balance → Z-index → PDSI (−4 to +4).
- **Open-Source Data:** PRISM, CRU TS, Open-Meteo ERA5.

### Eq 140 — Froehlich Dam Breach (Froehlich, 2008)
- **Reference:** Froehlich (2008). *J. Hydraulic Engineering*, 134(12), 1708–1721.
- **Methodology Flow:** 1) Q_peak = K₀×√(g×h_b×V_res). 2) Breach hydrograph.
- **Open-Source Data:** USACE National Levee Database, NOAA dam safety.

---

## Domain 24: Data Assimilation & State Estimation (Eqs 141–144)

### Eq 141 — Ensemble Kalman Filter (Evensen, 1994)
- **Reference:** Evensen (1994). *JGR*, 99(C5), 10143–10162.
- **Methodology Flow:** 1) K = P_fH^T(HP_fH^T+R)⁻¹. 2) x_a = x_f+K(y−Hx_f).
- **Open-Source Data:** DART (NCAR), Pangeo.

### Eq 142 — Optimal Interpolation (Lorenz, 1969)
- **Reference:** Lorenz (1969). *J. Atmospheric Sciences*, 26(4), 636–646.
- **Methodology Flow:** 1) x_a = x_b+BH^T(HBH^T+R)⁻¹(y−Hx_b).
- **Open-Source Data:** ERA5 (analysis product).

### Eq 143 — 4D-Var Cost Function (Le Dimet & Talagrand, 1986)
- **Reference:** Le Dimet & Talagrand (1986). *Tellus A*, 38(2), 97–110.
- **Methodology Flow:** 1) J(x₀) = ½(x₀−x_b)^TB⁻¹(x₀−x_b) + ½Σ(H_kM(x_k)−y_k)^TR⁻¹(...).
- **Open-Source Data:** ECMWF, JEDI framework.

### Eq 144 — Shannon Information Entropy (Shannon, 1948)
- **Reference:** Shannon (1948). *Bell System Technical Journal*, 27(3).
- **Methodology Flow:** 1) H = −Σp(x)log₂p(x). 2) Uncertainty measure.
- **Open-Source Data:** Any probability distribution; scipy.stats.entropy.

---

## Domain 25: Signal Processing & Communications (Eqs 145–147)

### Eq 145 — Free-Space Path Loss (Friis, 1946)
- **Reference:** Friis (1946). *Proc. IRE*, 34(5), 254–256.
- **Methodology Flow:** 1) FSPL(dB) = 20log₁₀(d_km)+20log₁₀(f_GHz)+92.45.
- **Open-Source Data:** CelesTrak (satellite orbits), user frequency.

### Eq 146 — Klobuchar Ionospheric Delay (Klobuchar, 1987)
- **Reference:** Klobuchar (1987). *IEEE Trans. Aerospace*, AES-23(3), 325–331.
- **Methodology Flow:** 1) Vertical delay from α/β coefficients. 2) Slant mapping.
- **Open-Source Data:** GPS nav message, IGS TEC maps.

### Eq 147 — Doppler Shift (Doppler, 1842)
- **Reference:** Doppler (1842). *Abh. K. Böhm. Gesellschaft.*
- **Methodology Flow:** 1) Δf = f₀×v/c. 2) Redshift/blueshift.
- **Open-Source Data:** NASA Horizons (ephemerides), GNSS Doppler.

---

## Domain 26: Mathematical Frameworks (Eqs 148–150)

### Eq 148 — Hohmann Transfer (Hohmann, 1925)
- **Reference:** Hohmann (1925). *Die Erreichbarkeit der Himmelskörper.*
- **Methodology Flow:** 1) a_t = (r₁+r₂)/2. 2) ΔV₁, ΔV₂, transfer time T = π√(a_t³/μ).
- **Open-Source Data:** NASA Horizons, Python poliastro.

### Eq 149 — Lagrange Points L1–L5 (Lagrange, 1772)
- **Reference:** Lagrange (1772). *Prix Académie Royale.*
- **Methodology Flow:** 1) Solve 5th-order polynomial. 2) L4/L5 at ±60° from secondary.
- **Open-Source Data:** JPL Solar System Dynamics, poliastro.

### Eq 150 — Mutual Information (Shannon, 1948)
- **Reference:** Same as Eq 144.
- **Methodology Flow:** 1) I(X;Y) = Σp(x,y)log₂(p(x,y)/(p(x)p(y))). 2) Statistical dependence.
- **Open-Source Data:** Any paired data; sklearn.feature_selection.

---

# APPENDIX A — Complete Open-Source Data Source Registry

| Source | URL | API Type | Key Required? | Best For Equations |
|--------|-----|----------|---------------|-------------------|
| **Open-Meteo** | open-meteo.com | REST/JSON | No | 1–9, 34, 46, 49, 58–60, 130 |
| **ERA5 (Copernicus CDS)** | cds.climate.copernicus.eu | CDS API | Free account | 5, 17, 48, 73, 96–107 |
| **USGS Earthquake Catalog** | earthquake.usgs.gov/fdsnws/ | REST/GeoJSON | No | 19–25 |
| **NASA FIRMS** | firms.modaps.eosdis.nasa.gov | REST/JSON | Map key (free) | 32 |
| **ORNL DAAC MODIS** | modis.ornl.gov | REST/JSON | No | 26–31, 51–52 |
| **Sentinel Hub** | docs.sentinel-hub.com | Process API | Free tier | 26–31, 35 |
| **ISRIC SoilGrids** | rest.isric.org | REST/JSON | No | 10, 18, 43–45, 84 |
| **NOAA Tides & Currents** | tidesandcurrents.noaa.gov | REST | Token (free) | 14 |
| **NDBC Buoys** | ndbc.noaa.gov | REST/Text | No | 15, 73, 78–80 |
| **NOAA SWPC** | swpc.noaa.gov | REST/JSON | No | 120–121, 128 |
| **NASA CCMC** | ccmc.gsfc.nasa.gov | Web API | Free account | 116–118 |
| **Space-Track** | space-track.org | REST | Free registration | 123–127 |
| **CelesTrak** | celestrak.org | REST | No | 123–127, 145 |
| **IGS** | igs.org | FTP/REST | No | 111, 130 |
| **USGS NWIS** | waterservices.usgs.gov | REST/JSON | API key (free) | 13, 88, 90, 131–133 |
| **OpenAQ** | openaq.org | REST | No | 65, 137 |
| **FLUXNET** | fluxnet.org | Data portal | Account | 46, 53, 103 |
| **Argo** | argo.ucsd.edu | NetCDF | No | 69, 70, 72 |
| **Smithsonian GVP** | volcano.si.edu | CSV/REST | No | 94 |
| **GLIMS** | glims.org | REST | No | 91 |
| **EM-DAT** | emdat.be | CSV | Account | 135 |
| **NASA POWER** | power.larc.nasa.gov | REST | No | 60 |
| **NASA Horizons** | ssd.jpl.nasa.gov/horizons | REST | No | 148, 149 |
| **NGA EGM2008** | earth-info.nga.mil | FTP | No | 113, 115 |
| **IERS** | datacenter-iers.org | FTP | No | 111, 112 |
| **WAQI** | aqicn.org | REST | Token (free) | 137 |
| **Copernicus Marine** | marine.copernicus.eu | CDS API | Free account | 16, 62, 70 |
| **GPM IMERG** | gpm.nasa.gov | REST | No | 110 |
| **GEBCO** | gebco.net | NetCDF | No | 76 |
| **HydroSHEDS** | hydrosheds.org | Shapefile | No | 12, 87 |
| **OpenTopography** | opentopodata.org | REST | No | 4, 81 |
| **DART (NCAR)** | www2.acom.ucar.edu/dart | Software | No | 141 |

---

*Generated: July 21, 2026 — 150 equations, 26 domains, 7 parts, 40+ open-source data sources.*
