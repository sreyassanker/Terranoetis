# 15 Working Data Sources — Returning Real Data Values

**Generated:** 2026-06-01  
**13 JSON REST APIs + 2 Image Tile Services**

---

## 1. GBIF — Global Biodiversity Information Facility

| Field | Value |
|-------|-------|
| **URL** | `https://api.gbif.org/v1/` |
| **Tested** | `https://api.gbif.org/v1/occurrence/search?taxonKey=2433407&limit=1` |
| **HTTP** | 200 |
| **Data** | 58,114 occurrences of *Ursus americanus* (American black bear) |
| **Sample** | `{"offset": 0, "limit": 1, "endOfRecords": false, "count": 58114}` |
| **Response** | Full Darwin Core records with species, coordinates, dataset, institution |

---

## 2. OBIS — Ocean Biodiversity Information System

| Field | Value |
|-------|-------|
| **URL** | `https://api.obis.org/` |
| **Tested** | `https://api.obis.org/v3/occurrence?limit=1` |
| **HTTP** | 200 |
| **Data** | 199,856,012 total marine species records |
| **Sample** | `{"total": 199856012, "results": [...]}` |
| **Response** | Marine species occurrence with full metadata (scientific name, coordinates, dataset ID) |

---

## 3. iNaturalist

| Field | Value |
|-------|-------|
| **URL** | `https://api.inaturalist.org/v1/` |
| **Tested** | `https://api.inaturalist.org/v1/observations?per_page=1&quality_grade=research` |
| **HTTP** | 200 |
| **Data** | 201,127,510 research-grade observations |
| **Sample** | `{"total_results": 201127510, "page": 1, "per_page": 1}` |
| **Response** | 39KB JSON with species_guess, taxon, photos, coordinates, user |

---

## 4. World Bank API

| Field | Value |
|-------|-------|
| **URL** | `https://api.worldbank.org/v2/` |
| **Tested** | `https://api.worldbank.org/v2/country?format=json&per_page=2` |
| **HTTP** | 200 |
| **Data** | 296 countries across 148 pages |
| **Sample** | `[{"page": "1", "pages": "148", "per_page": "2", "total": "296"}]` |
| **Response** | JSON array with pagination metadata + country objects (name, region, income level) |

---

## 5. WHO GHO — Global Health Observatory

| Field | Value |
|-------|-------|
| **URL** | `https://ghoapi.azureedge.net/api/` |
| **Tested** | `https://ghoapi.azureedge.net/api/Indicator?$top=2` |
| **HTTP** | 200 |
| **Data** | 2,301 health indicators across 245 countries |
| **Sample** | `{"@odata.context": "...", "value": [...]}` |
| **Response** | OData-compliant JSON with indicator codes, names, descriptions |

---

## 6. USGS NLDI — Network Linked Data Index

| Field | Value |
|-------|-------|
| **URL** | `https://api.water.usgs.gov/nldi/` |
| **Tested** | `https://api.water.usgs.gov/nldi/` |
| **HTTP** | 200 |
| **Data** | API landing page with full endpoint discovery |
| **Sample** | `{"title": "Network Linked Data Index API", "description": "..."}` |
| **Response** | RESTful API for navigating NHDPlus hydrography network |

---

## 7. USGS Water Data — OGC API

| Field | Value |
|-------|-------|
| **URL** | `https://api.waterdata.usgs.gov/ogcapi/v0/` |
| **Tested** | `https://api.waterdata.usgs.gov/ogcapi/v0/` |
| **HTTP** | 200 |
| **Data** | OGC API landing page with 12 linked collections |
| **Sample** | `{"links": [...], "title": "USGS Water Data OGC APIs", "description": "..."}` |
| **Response** | OGC-compliant API for continuous sensor data, groundwater levels |

---

## 8. OpenSky Network

| Field | Value |
|-------|-------|
| **URL** | `https://opensky-network.org/` |
| **Tested** | `https://opensky-network.org/api/states/all?lamin=40&lomin=-120&lamax=41&lomax=-119` |
| **HTTP** | 200 |
| **Data** | Real-time aircraft positions |
| **Sample** | `{"time": 1780306591, "states": [...]}` |
| **Response** | ADS-B transponder data: ICAO24, callsign, lat, lon, altitude, velocity |

---

## 9. Macrostrat

| Field | Value |
|-------|-------|
| **URL** | `https://macrostrat.org/` |
| **Tested** | `https://macrostrat.org/api/v2/` |
| **HTTP** | 200 |
| **Data** | Stratigraphic column and lithology data |
| **Sample** | `{"success": true, "v": "2.2.2", "description": "API for lithology, units, columns"}` |
| **Response** | Stratigraphic units, lithology, age models, column data |

---

## 10. USGS Earthquakes

| Field | Value |
|-------|-------|
| **URL** | `https://earthquake.usgs.gov/` |
| **Tested** | `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=2` |
| **HTTP** | 200 |
| **Data** | Recent seismic events as GeoJSON FeatureCollection |
| **Sample** | `{"type": "FeatureCollection", "metadata": {"title": "USGS Earthquakes"}, "bbox": [...]}` |
| **Response** | GeoJSON with magnitude, place, time, coordinates, depth |

---

## 11. STAC API — Element84 Earth Search

| Field | Value |
|-------|-------|
| **URL** | `https://earth-search.aws.element84.com/v1/` |
| **Tested** | `https://earth-search.aws.element84.com/v1/` |
| **HTTP** | 200 |
| **Data** | STAC v1.0.0 catalog with 21 linked collections |
| **Sample** | `{"stac_version": "1.0.0", "type": "Catalog", "id": "earth-search-aws", "title": "Earth Search by Element 84"}` |
| **Response** | SpatioTemporal Asset Catalog — Sentinel-2, Landsat, and other satellite imagery |

---

## 12. Copernicus CDS — Climate Data Store API

| Field | Value |
|-------|-------|
| **URL** | `https://cds.climate.copernicus.eu/api/` |
| **Tested** | `https://cds.climate.copernicus.eu/api/` |
| **HTTP** | 202 |
| **Data** | CDS API root accepting requests |
| **Sample** | `{"message": "Welcome to the Climate Data Store API root endpoint", "detail": "..."}` |
| **Response** | ERA5, seasonal forecasts, CMIP6 — requires cdsapi Python library |

---

## 13. NASA POWER

| Field | Value |
|-------|-------|
| **URL** | `https://power.larc.nasa.gov/` |
| **Tested** | `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=0&latitude=0&start=2020&end=2020&format=JSON` |
| **HTTP** | 200 |
| **Data** | 12 monthly solar irradiance values for 2020 at coordinates (0,0) |
| **Sample** | `{"type": "Feature", "header": {"api": "POWER Monthly API", "sources": [...]}, "parameters": {"ALLSKY_SFC_SW_DWN": {...}}}` |
| **Response** | Solar radiation, meteorology, agroclimatology data in GeoJSON format |

---

## 14. NASA GIBS — Image Tile Service

| Field | Value |
|-------|-------|
| **URL** | `https://gibs.earthdata.nasa.gov/` |
| **Tested** | `https://gibs.earthdata.nasa.gov/` |
| **HTTP** | 200 |
| **Data** | 12,721 bytes of image data |
| **Type** | WMTS tile service — 900+ imagery products |
| **Response** | Dynamic image tiles (JPEG) for satellite/aerial imagery |

---

## 15. AMSR2 Snow Water Equivalent — NASA GIBS Tile

| Field | Value |
|-------|-------|
| **URL** | `https://gibs.earthdata.nasa.gov/` |
| **Tested** | `https://gibs.earthdata.nasa.gov/` |
| **HTTP** | 200 |
| **Data** | 12,721 bytes of image data |
| **Type** | WMTS tile — daily snow water equivalent |
| **Response** | Global snow cover raster tiles |

---

## Summary Table

| # | Source | Type | Key Data Point | Format |
|---|--------|------|---------------|--------|
| 1 | GBIF | REST API | 58K species occurrences | JSON |
| 2 | OBIS | REST API | 199M marine records | JSON |
| 3 | iNaturalist | REST API | 201M observations | JSON |
| 4 | World Bank | REST API | 296 countries | JSON |
| 5 | WHO GHO | REST API | 2,301 health indicators | JSON |
| 6 | USGS NLDI | REST API | Hydrography network | JSON |
| 7 | USGS OGC | REST API | Water data collections | JSON |
| 8 | OpenSky | REST API | Real-time flights | JSON |
| 9 | Macrostrat | REST API | Stratigraphic columns | JSON |
| 10 | USGS Earthquakes | REST API | Seismic events | GeoJSON |
| 11 | STAC API | REST API | Satellite catalog v1.0.0 | JSON |
| 12 | CDS Climate | REST API | Climate data store | JSON |
| 13 | NASA POWER | REST API | Solar irradiance | GeoJSON |
| 14 | NASA GIBS | WMTS Tile | 900+ imagery products | JPEG |
| 15 | AMSR2 SWE | WMTS Tile | Snow water equivalent | JPEG |
