# Domain 5 — Spatial Analysis & Extreme Events (Equations 36-42)
## Complete Scientific Data Infrastructure

---

## 1. Variable Inventory

| Variable | Eq(s) | Meaning | Units | Type | Best Dataset |
|----------|-------|---------|-------|------|-------------|
| lat1,lon1,lat2,lon2 | 36 | Point coordinates | degrees | User input | User |
| z | 37,38 | Measured values at points | variable | Various | In-situ / satellite |
| lambda_i | 37 | Kriging weights | - | Derived | Semivariogram |
| w_i | 38 | IDW weights | - | Derived | Distance-based |
| Q | 39 | Pollutant emission rate | g/s | User/Inventory | Emissions database |
| u | 39 | Wind speed | m/s | NWP | ERA5 / Open-Meteo |
| sigma_y | 39 | Horizontal dispersion coefficient | m | Parameterized | Pasquill-Gifford |
| sigma_z | 39 | Vertical dispersion coefficient | m | Parameterized | Pasquill-Gifford |
| y | 39 | Crosswind distance | m | User | Input |
| mu | 40 | Location parameter (Gumbel) | - | Derived | Extreme value analysis |
| beta | 40 | Scale parameter (Gumbel) | - | Derived | Extreme value analysis |
| x | 40,41 | Variable of interest | variable | Various | Various |
| xi | 41 | Shape parameter (GPD) | - | Derived | Extreme value analysis |
| h | 42 | Lag distance | m | Derived | Spatial configuration |

### Key Shared Data Sources

| Dataset | Applications | Resolution | Access |
|---------|-------------|------------|--------|
| SRTM/NASADEM (30m) | Elevation for distance, slope | 30m | Earth Explorer / Open Topo Data |
| ERA5 wind fields | Gaussian plume dispersion | 0.25 deg, hourly | CDS API |
| ECMWF ERA5 reanalysis | Extreme value analysis (climate) | 0.25 deg, hourly | CDS API |
| USGS Water Data | Streamflow extremes | Point | NWIS REST API |
| GPM IMERG | Precipitation extremes | 0.1 deg, 30-min | PPS / GES DISC |

---

## 2. Data Sources by Equation

### Eq 36 — Great Circle Distance (Haversine)
- Input: lat1, lon1, lat2, lon2 (user-supplied coordinates)
- No external data needed

### Eq 37-38 — Kriging / IDW Interpolation
- **z**: User-measured or satellite-derived point values
- **Semivariogram**: Fitted to spatial structure of z values
- Data sources: any point-based observation (weather stations, buoys, sample points)

### Eq 39 — Gaussian Plume Air Dispersion
- **Q**: User-specified emission rate or from emissions inventory
- **u**: ERA5 10m wind speed (hourly, 0.25 deg) or Open-Meteo
- **sigma_y, sigma_z**: Pasquill-Gifford stability class → from wind speed + solar radiation (Open-Meteo: shortwave_radiation, cloud_cover)

### Eq 40-41 — Gumbel / Generalized Pareto Extreme Value Analysis
- Long-term time series (30+ years recommended) of the variable of interest
- **Precipitation extremes**: GPM IMERG Final (2000+, 0.1 deg, 30-min)
- **Temperature extremes**: ERA5 (1950+, 0.25 deg, hourly)
- **Flood extremes**: USGS NWIS / GRDC stream gauge records
- **Wind extremes**: ERA5 (1940+)
- **Sea level extremes**: NOAA tide gauges / GESLA-3

### Eq 42 — Semivariogram Analysis
- **z**: Point measurements at positions with lag h
- Data from spatial observation networks

---

## 3. References

1. Haversine formula: Sinnott, R.W. (1984). *Sky & Telescope*, 68(2), 159.
2. Kriging: Krige, D.G. (1951). *J. Chem. Met. Min. Soc. S. Africa*, 52, 119-139.
3. Gaussian plume: Pasquill, F. (1961). *Met. Mag.*, 90, 33-49.
4. Gumbel distribution: Gumbel, E.J. (1958). *Statistics of Extremes*. Columbia Univ. Press.
5. Generalized Pareto: Pickands, J. (1975). *Ann. Stat.*, 3, 119-131.
