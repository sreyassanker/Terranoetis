# Domain 3 — Geophysics & Seismology (Equations 19-25)
## Complete Scientific Data Infrastructure

---

## 1. Variable Inventory

| Variable | Eq(s) | Physical Meaning | Units | Type | Best Dataset |
|----------|-------|------------------|-------|------|-------------|
| a | 19 | Seismicity rate parameter (Gutenberg-Richter) | - | Derived (catalog) | USGS ComCat |
| b | 19 | b-value (Gutenberg-Richter slope, ~1.0) | - | Derived (catalog) | USGS ComCat |
| M | 19 | Earthquake magnitude | - | Observed | USGS ComCat |
| K | 20 | Aftershock productivity (Omori) | - | Derived (catalog) | USGS ComCat |
| c | 20 | Omori time offset | days | Derived | USGS ComCat |
| t | 20 | Time since mainshock | days | Input | User |
| p | 20 | Omori decay exponent | - | Derived (~1.0) | Literature |
| M_ag | 21 | Earthquake magnitude (GMPE) | - | Observed | USGS ComCat |
| D_st | 21 | Source-to-site distance | km | Derived | Hypocenter + location |
| S_te | 21 | Site classification | - | Static | USGS Vs30 |
| F_lt | 21 | Fault type | - | Derived | GCMT focal mech |
| H_w | 21 | Hanging wall flag | - | Derived | Fault geometry |
| c | 22 | Cohesion (Mohr-Coulomb) | MPa | Lab/static | Rock mechanics DB |
| sigma_n | 22 | Normal stress | MPa | Derived | Depth + density |
| tan_phi | 22 | Friction coefficient | - | Lab/static | Byerlee's law |
| M0 | 23 | Seismic moment | N-m | Observed | GCMT catalog |
| r | 24 | Source radius | m | Derived | Stress drop model |
| M_w | 25 | Moment magnitude | - | Observed | GCMT/USGS |

---

## 2. Eq 19 — Gutenberg-Richter Frequency-Magnitude

**Reference:** Gutenberg, B. & Richter, C.F. (1944). Frequency of earthquakes in California. *BSSA*, 34(4), 185-188.

### Input Variables

- **M** (magnitude): from earthquake catalog
- **a, b**: derived from catalog by maximum likelihood (Aki, 1965)

### Primary Dataset: USGS ComCat

| Attribute | Value |
|-----------|-------|
| **Dataset** | ANSS Comprehensive Earthquake Catalog (ComCat) |
| **Provider** | USGS Earthquake Hazards Program |
| **API** | FDSN Event Web Service |
| **Coverage** | Global, 1973-present |
| **Magnitude types** | Mw, Ms, mb, Ml, Md, etc. |
| **Min magnitude** | Variable by region (~2.5 global, ~1.0 regional) |
| **Real-time** | Yes (GeoJSON feeds, sub-minute) |
| **Historical** | Yes (1638-present, variable completeness) |
| **Access** | REST API, no key required |
| **Rate limit** | 20,000 events/query, ~1 req/s recommended |

**API endpoints:**
- Realtime: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{type}.geojson` (type=hour, day, week, month)
- Catalog: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=...&endtime=...&minmagnitude=2.5`
- Comprehensive: ComCat with `format=geojson&eventid=...`

**Deriving a and b:**
- Maximum likelihood: b = log10(e) / (mean(M) - Mc), where Mc = magnitude of completeness
- a = log10(N) + b*Mc (per year)
- Aki (1965) MLE estimator is the standard

### Supplementary: ISC Bulletin

| Attribute | Value |
|-----------|-------|
| **Dataset** | ISC Bulletin |
| **Provider** | International Seismological Centre |
| **Coverage** | Global, 1904-present |
| **Completeness** | Mc ~4.5 for 1960s, ~3.5 for 1990s, ~2.5 for 2000s |
| **Access** | HTTP `www.isc.ac.uk/cgi-bin/web-db-run` |
| **Format** | QuakeML, CSV, ISF |
| **Use When** | USGS catalog insufficient for pre-1973 events |

---

## 3. Eq 20 — Omori Aftershock Decay

**Reference:** Omori, F. (1894). On the aftershocks of earthquakes. *J. Coll. Sci. Imp. Univ. Tokyo*, 7, 111-200.

### Input Variables

- **K, c, p**: derived from post-mainshock catalog
- **t**: time since mainshock

### Data

Same USGS ComCat catalog as Eq 19. After a mainshock:
- Query ComCat for events within space-time window (e.g., 3 fault radii, 365 days)
- Fit modified Omori: n(t) = K / (t + c)^p
- Standard values: p ~ 0.9-1.2, c ~ 0.01-0.1 days

---

## 4. Eq 21 — Ground Motion Prediction Equation (GMPE)

**Reference:** Various (Boore et al. 2014 NGA-West2, Abrahamson et al. 2014)

### Input Variables

| Variable | Source | Details |
|----------|--------|---------|
| **M_ag** (magnitude) | USGS ComCat | Moment magnitude Mw preferred |
| **D_st** (distance) | Epicentral/hypocentral distance | From event lat/lon/depth to site |
| **S_te** (site class) | **USGS Vs30** (Global) | Vs30 = time-averaged shear wave velocity to 30m |
| **F_lt** (fault type) | **GCMT** focal mechanism | Strike-slip, normal, reverse |
| **H_w** (hanging wall) | Fault geometry | From finite fault model |

### Vs30 (Site Classification)

| Dataset | Provider | Resolution | Coverage | Access |
|---------|----------|------------|----------|--------|
| **USGS Global Vs30** | USGS | ~1 km | Global | HTTPS download |
| **Heath et al. (2020)** | USGS | ~250 m | CONUS | Open access |
| **Allen & Wald (2009)** | USGS | 30 arc-sec | Global | Open access |

### Focal Mechanisms

| Dataset | Provider | Period | Access |
|---------|----------|--------|--------|
| **GCMT Catalog** | LDEO/Columbia | 1976-present, ~6mo latency | `globalcmt.org` |
| **USGS W-phase** | USGS NEIC | 2008-present, NRT | ComCat integrated |
| **ISC Focal Mechanisms** | ISC | 1904-present | `isc.ac.uk` |

---

## 5. Eq 22 — Mohr-Coulomb Shear Strength

**Reference:** Coulomb, C.A. (1776). Essai sur une application des regles de maximis et minimis a quelques problemes de statique. *Mem. Acad. Roy. Sav.*, 7.

### Input Variables

| Variable | Source | Details |
|----------|--------|---------|
| **c** (cohesion) | Rock mechanics database | Typical: 0-50 MPa for intact rock, 0 for joints |
| **sigma_n** (normal stress) | Derived from depth + density | rho*g*z |
| **phi** (friction angle) | Byerlee's law | mu = 0.6-0.85 for most rocks |

### Standard Parameters

- **Byerlee's law**: tau = 0.85*sigma_n for sigma_n < 200 MPa, tau = 50 + 0.6*sigma_n for sigma_n > 200 MPa
- Cohesion ~ 0 for pre-existing faults
- Intact rock cohesion from lab tests (literature values)

---

## 6. Eqs 23-25 — Seismic Moment, Stress Drop, Fault Scaling

**Reference:** Kanamori, H. (1977). The energy release in great earthquakes. *JGR*, 82, 2981-2987.

### M0 from GCMT

M0 (seismic moment, N-m) is the primary GCMT output. Directly from:
- NDK file format: scalar moment in dyne-cm (convert: 1 dyne-cm = 1e-7 N-m)
- Mw = (2/3)*(log10(M0) - 9.1) for M0 in N-m
- API: `www.globalcmt.org/CMTsearch` or `ds.iris.edu/spudbeta/momenttensor`

### Stress Drop (Eq 24)

- r = source radius from Brune (1970): r = 0.37 * Vs / fc
- Vs = shear wave velocity (~3-4 km/s)
- fc = corner frequency from source spectrum
- Not directly available from catalogs; requires waveform analysis
- **Default assumption**: stress drop = 3 MPa (median global)
- **IRIS SPUD** provides source parameters for some events

---

## 7. Data Availability Matrix

| Variable | Real-Time | NRT | Historical | Static/Lab |
|----------|-----------|-----|------------|------------|
| USGS ComCat | **Yes (GeoJSON feeds)** | **Yes** | **Yes (1973+)** | No |
| ISC Bulletin | No | No | **Yes (1904+)** | No |
| GCMT moments | No | Quick CMT (<48h) | Yes (1976+) | No |
| USGS W-phase | No | **Yes (30 min)** | Yes | No |
| Vs30 site class | No | No | No | **Yes (static)**
| Fault type | No | No | Yes (GCMT) | No |
| Rock cohesion | No | No | No | **Lab values** |
| Byerlee friction | No | No | No | **Laboratory** |

---

## 8. References

1. Gutenberg, B. & Richter, C.F. (1944). *BSSA*, 34(4), 185-188.
2. Omori, F. (1894). *J. Coll. Sci. Imp. Univ. Tokyo*, 7, 111-200.
3. Kanamori, H. (1977). *JGR*, 82, 2981-2987.
4. Aki, K. (1965). *BSSA*, 55, 299-320.
5. Coulomb, C.A. (1776). *Mem. Acad. Roy. Sav.*, 7.
6. Byerlee, J.D. (1978). *Pure Appl. Geophys.*, 116, 615-626.
7. Boore, D.M. et al. (2014). *PEER Report 2013/22*, NGA-West2.
8. USGS (2024). ComCat Documentation. `earthquake.usgs.gov/data/comcat/`
9. ISC (2024). ISC Bulletin. `isc.ac.uk`
10. Ekstrom, G. et al. (2012). *PEPI*, 204-205, 1-48.
11. USGS Global Vs30 Mosaic. `earthquake.usgs.gov/data/vs30/`
