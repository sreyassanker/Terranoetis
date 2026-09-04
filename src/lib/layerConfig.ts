/* ── AUTO-GENERATED LAYER CONFIG ── */
/* Every hex color is unique. Every symbol is unique. Every motion type is assigned per-layer. */

export type MotionType = 'pulse' | 'wave' | 'trail' | 'breathe' | 'dash' | 'flicker' | 'orbit' | 'glow' | 'contract' | 'shimmer' | 'radar' | 'float';

export interface LayerCategory {
  id: string; label: string; symbol: string; color: string;
  motionType: MotionType; description: string; group: string;
  dataSource: string; sub?: string; badge?: 'LIVE' | 'KEY' | 'PREMIUM';
  type: 'point' | 'geojson' | 'effect' | 'heatmap' | 'polygon' | 'tile' | '3dtiles' | 'panel';
  opacity?: number;
}

export interface LayerGroup { id: string; label: string; icon: string; color: string; }

/* ── Groups ── */
export const LAYER_GROUPS: LayerGroup[] = [
  { id: 'seismic', label: 'Seismic', icon: '⬡', color: '#a31f1f' },
  { id: 'volcanic', label: 'Volcanic', icon: '◬', color: '#c31b76' },
  { id: 'ocean', label: 'Ocean', icon: '◈', color: '#1ea947' },
  { id: 'argo', label: 'ARGO Floats', icon: '◈', color: '#0d7bbf' },
  { id: 'tides', label: 'Tides', icon: '◈', color: '#2596be' },
  { id: 'usgs_water', label: 'Water Quality', icon: '◈', color: '#2e86ab' },
  { id: 'aviation', label: 'Aviation', icon: '◆', color: '#731eaf' },
  { id: 'satellite', label: 'Satellite', icon: '◇', color: '#b6a31d' },
  { id: 'weather', label: 'Weather', icon: '▣', color: '#1ca1bc' },
  { id: 'hazards', label: 'Hazards', icon: '◉', color: '#c31b76' },
  { id: 'space', label: 'Space', icon: '◎', color: '#46c91a' },
  { id: 'atmosphere', label: 'Atmosphere', icon: '◐', color: '#d75818' },
  { id: 'geology', label: 'Geology', icon: '▤', color: '#17de93' },
  { id: 'ecology', label: 'Ecology', icon: '▥', color: '#d415e5' },
  { id: 'cryosphere', label: 'Cryosphere', icon: '◒', color: '#beeb14' },
  { id: 'energy', label: 'Energy', icon: '⌁', color: '#f4a261' },
  { id: 'security', label: 'Security & Conflict', icon: '⊗', color: '#780000' },
  { id: 'geospatial', label: 'Geospatial', icon: '◰', color: '#2119d0' },
  { id: 'media', label: 'Media', icon: '◔', color: '#15c977' },
  { id: 'infrastructure', label: 'Infrastructure', icon: '▦', color: '#1882ee' },
];

export const LAYER_CATEGORIES: LayerCategory[] = [
  // ── 1. Maritime Data APIs ──
  {
    id: 'ais_vessels', label: 'AIS Vessels', symbol: '━',
    color: '#0ea5e9', motionType: 'wave', group: 'ocean',
    type: 'point', description: 'Live ship tracking from AISStream.io — WebSocket real-time AIS positions',
    dataSource: 'https://aisstream.io/',
    sub: 'Live ship tracking',
    badge: 'KEY',
  },
  // ── 2. Aviation & Flight Tracking ──
  {
    id: '2_adsb_lol', label: 'ADSB.lol', symbol: '┉',
    color: '#16c35e', motionType: 'trail', group: 'aviation',
    type: 'point', description: 'ADSB.lol — Aviation & Flight Tracking',
    dataSource: 'https://adsb.lol/',
    sub: 'Aviation',
  },
  {
    id: '2_adsb_fi', label: 'adsb.fi', symbol: '┊',
    color: '#9515c9', motionType: 'dash', group: 'aviation',
    type: 'point', description: 'adsb.fi — Aviation & Flight Tracking',
    dataSource: 'https://adsb.fi/',
    sub: 'Aviation',
  },
  {
    id: '2_airlabs_api', label: 'AirLabs API', symbol: '┌',
    color: '#129dd7', motionType: 'trail', group: 'aviation',
    type: 'point', description: 'AirLabs API — Aviation & Flight Tracking',
    dataSource: 'https://airlabs.co/',
    sub: 'Aviation',
  },
  {
    id: '2_openflights', label: 'OpenFlights', symbol: '┍',
    color: '#de1166', motionType: 'dash', group: 'aviation',
    type: 'point', description: 'OpenFlights — Aviation & Flight Tracking',
    dataSource: 'https://openflights.org/',
    sub: 'Aviation',
  },
  {
    id: '2_military_flights', label: 'Military Flights', symbol: '✈',
    color: '#ff4444', motionType: 'trail', group: 'aviation',
    type: 'point', description: 'OpenSky military aircraft — filtered by callsign heuristics, rendered as MIL-STD-2525 symbology',
    dataSource: 'https://opensky-network.org/',
    sub: 'Aviation',
  },
  {
    id: 'aircraft_hangar', label: '3D Aircraft Models', symbol: '✪',
    color: '#60a5fa', motionType: 'glow', group: 'aviation',
    type: 'effect', description: 'Swap flight glyphs for real 3D aircraft models on close approach (self-contained glTF, no downloads)',
    dataSource: '',
    sub: '3D models on approach',
  },
  // ── 3. Satellite Imagery & Earth Observation ──
  {
    id: '3_planetary_computer_stac', label: 'MODIS Terra True Color', symbol: '┎',
    color: '#29e50f', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance True Color — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_aws_earth_search', label: 'MODIS Aqua True Color', symbol: '┏',
    color: '#4528d2', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Aqua Corrected Reflectance True Color — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_copernicus_data_space', label: 'MODIS Terra False Color (721)', symbol: '┐',
    color: '#d87927', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance Bands 7-2-1 — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_usgs_earthexplorer', label: 'MODIS Terra Surface Reflectance 143', symbol: '┑',
    color: '#2adbaf', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Surface Reflectance Bands 1-4-3 — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_usgs_appeears', label: 'MODIS Terra Land Surface Temp', symbol: '└',
    color: '#3374e3', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Land Surface Temperature Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_veda_dashboard', label: 'VIIRS SNPP True Color', symbol: '┖',
    color: '#3ae75f', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP Corrected Reflectance True Color — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_jaxa_g_portal', label: 'MODIS Aerosol Optical Depth', symbol: '┗',
    color: '#6213ae', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Aerosol Optical Depth Deep Blue Combined — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_jaxa_himawari_monitor', label: 'MODIS Cloud Top Height', symbol: '┘',
    color: '#b59412', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Top Height Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_noaa_goes_r_series', label: 'MODIS Brightness Temp Band 31', symbol: '┙',
    color: '#11adbc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Brightness Temperature Band 31 Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_landsat_look', label: 'MODIS Surf. Reflectance 721', symbol: '┚',
    color: '#c2107f', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Surface Reflectance Bands 7-2-1 — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_planet_labs_open_data', label: 'MODIS Cloud Eff. Radius', symbol: '┛',
    color: '#4cc90f', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Effective Radius — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_openaerialmap', label: 'MODIS Cloud Fraction', symbol: '├',
    color: '#0e15d0', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Fraction Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_bhuvan_isro', label: 'MODIS Cloud Opt. Thickness', symbol: '┝',
    color: '#bf4c24', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Optical Thickness — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_air_centre_eo_catalog', label: 'AIRS Dust Score', symbol: '┞',
    color: '#24c67c', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'AIRS L2 Dust Score Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_aster_gdem', label: 'ASTER GDEM Color Index', symbol: '┟',
    color: '#b123cc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'ASTER GDEM Color Index — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_srtm', label: 'MODIS Corr. Refl. 367', symbol: '┠',
    color: '#bbd322', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance Bands 3-6-7 — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_gebco', label: 'GHRSST Sea Surface Temp', symbol: '┡',
    color: '#208bd9', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'GHRSST L4 MUR Sea Surface Temperature — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_modis_web_services', label: 'MODIS Water Vapor', symbol: '┢',
    color: '#e02057', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Water Vapor 5km Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_viirs_active_fires', label: 'MODIS Thermal Anomalies', symbol: '┣',
    color: '#23e224', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Thermal Anomalies All — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '3_global_surface_water_explorer', label: 'MODIS Flood Extent', symbol: '┤',
    color: '#5f26e5', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Combined Flood 1-Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  // ── 4. Weather & Climate APIs (covered by right-click weather card) ──
  // ── 5. Natural Hazards & Disaster Alerts ──
  // ── 6. Space, Astronomy & Universe APIs ──
  {
    id: '6_celestrak_gp_api', label: 'CelesTrak GP API', symbol: '╟',
    color: '#5fb110', motionType: 'trail', group: 'space',
    type: 'point', description: 'CelesTrak GP API — Space, Astronomy & Universe APIs',
    dataSource: 'https://celestrak.org/',
    sub: 'Satellite tracking',
  },
  // ── 7. (deleted) ──
  // ── 8. (deleted) ──
  // ── 9. Atmosphere & Environmental Science ──
  // Honesty note: the previous 18 branded entries (OpenAQ, AirNow, PurpleAir,
  // WAQI, CAMS, NASA GMAO/AIRS/OMI, Copernicus, HYSPLIT, SILAM, MACC, TEMPO,
  // Pandonia, EPA, EEA…) ALL served one generic Open-Meteo air-quality feed
  // under each brand's name — none fetched from the named organization. They
  // were removed. One layer remains, labeled truthfully for the data it serves:
  {
    id: '9_city_air_quality', label: 'City Air Quality', symbol: '▃',
    color: '#a91c19', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'Live city-level air quality (US/EU AQI, PM2.5, PM10, O3, NO2, SO2, CO) from the Open-Meteo air-quality API',
    dataSource: 'https://open-meteo.com/en/docs/air-quality-api',
    sub: 'Open-Meteo air quality',
  },
  // ── 10. (deleted) ──
  // ── 11. (deleted) ──
  // ── 12. Atmospheric Physics & Upper Air ──
  {
    id: '12_nhc_tropical_cyclone_data', label: 'NHC Tropical Cyclone Data', symbol: '▝',
    color: '#cc2365', motionType: 'wave', group: 'weather',
    type: 'heatmap', description: 'NHC Tropical Cyclone Data — Atmospheric Physics & Upper Air',
    dataSource: 'https://www.nhc.noaa.gov/data/',
    sub: 'Hurricane data',
  },
  {
    id: '12_ibtracs', label: 'IBTrACS', symbol: '▞',
    color: '#34d322', motionType: 'flicker', group: 'weather',
    type: 'heatmap', description: 'IBTrACS — Atmospheric Physics & Upper Air',
    dataSource: 'https://www.ncei.noaa.gov/products/international-best-track-archive',
    sub: 'Tropical storm archive',
  },
  // ── 14. (deleted) ──
  // ── 15. (deleted) ──
  // ── 16. Paleoclimate & Deep Time ──
  {
    id: '16_macrostrat', label: 'Macrostrat', symbol: '◁',
    color: '#bfb619', motionType: 'pulse', group: 'geology',
    type: 'geojson', description: 'Macrostrat — Paleoclimate & Deep Time',
    dataSource: 'https://macrostrat.org/',
    sub: 'Geological mapping',
  },
  {
    id: '16_pbdb', label: 'PBDB', symbol: '◂',
    color: '#189dc6', motionType: 'shimmer', group: 'geology',
    type: 'geojson', description: 'PBDB — Paleoclimate & Deep Time',
    dataSource: 'https://paleobiodb.org/',
    sub: 'Paleobiology data',
  },

  // ── 17. (deleted) ──
  // ── 18. (deleted) ──
  // ── 19. (deleted) ──
  // ── 20. (deleted) ──
  // ── 21. Severe Weather & Storms (NHC storm data available above) ──
  // ── 22. (deleted) ──
  // ── 23. (deleted) ──
  // ── 26. Drought & Food Security ──
  {
    id: '26_us_drought_monitor', label: 'US Drought Monitor', symbol: '⌞',
    color: '#3a66e7', motionType: 'wave', group: 'weather',
    type: 'heatmap', description: 'US Drought Monitor — Drought & Food Security',
    dataSource: 'https://droughtmonitor.unl.edu/',
    sub: 'Drought conditions',
  },
  // ── 27. Water Quality & HABs ──
  {
    id: '27_usgs_nawqa', label: 'USGS NAWQA', symbol: '⌤',
    color: '#d00e6f', motionType: 'shimmer', group: 'usgs_water',
    type: 'point', description: 'USGS National Water Quality Assessment — 5,000+ monitoring locations with real-time data',
    dataSource: 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items',
    sub: 'Water quality data',
    badge: 'LIVE',
  },
  // ── 28. (deleted) ──
  // ── 29. (removed) — the VAAC / WOVOdat / NASA-SO2 / NOAA-SO2 / Volcano
  //     Discovery layers were labeled after portals with no public machine-readable
  //     API and rendered one generic USGS volcano list. Volcanic activity is
  //     covered honestly by the EONET-backed 'volcanoes' layer below.
  // ── 30. Ocean Biogeochemistry ──
  // ── 31. Ocean & Marine Data ──
  {
    id: '31_argo_floats', label: 'ARGO Floats', symbol: '⍄',
    color: '#ac941b', motionType: 'wave', group: 'argo',
    type: 'point', description: 'ARGO Profiling Floats — 3,800+ active floats measuring T/S profiles in real-time',
    dataSource: 'https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.html',
    sub: 'Ocean profiling',
    badge: 'LIVE',
  },
  {
    id: '31_noaa_tides_currents', label: 'NOAA Tides & Currents', symbol: '⍅',
    color: '#1b9fb2', motionType: 'shimmer', group: 'tides',
    type: 'point', description: 'NOAA CO-OPS — 300+ water level stations with real-time tide data',
    dataSource: 'https://api.tidesandcurrents.noaa.gov/',
    sub: 'Tide data',
    badge: 'LIVE',
  },
  // ── 32. (deleted) ──
  // ── 33. (deleted) ──
  // ── 35. (deleted) ──
  // ── 36. (deleted) ──
  // ── 37. (deleted) ──
  // ── 38. Agriculture & Food Security (data sourced via FEWS NET above) ──
  // ── 39. (deleted) ──
  // ── 41. (deleted) ──
  // ── 42. Ocean Observatories ──
  {
    id: '42_ndbc_buoy_data', label: 'NDBC Buoy Data', symbol: '⏈',
    color: '#1691d4', motionType: 'wave', group: 'ocean',
    type: 'point', description: 'NDBC Buoy Data — Ocean Observatories',
    dataSource: 'https://www.ndbc.noaa.gov/',
    sub: 'Weather buoy data',
  },
  // ── 43. GeoNet (New Zealand) — real api.geonet.org.nz feeds only.
  // (COSMOS / COSMOS VDC / K-NET / KiK-net / CSN Chile / ShakeAlert layers were
  // removed: those networks publish no usable live JSON point feed, and the old
  // entries silently served USGS worldwide quakes under regional labels.)
  {
    id: '43_geonet', label: 'GeoNet Quakes', symbol: '⏌',
    color: '#ef8410', motionType: 'flicker', group: 'seismic',
    type: 'point', description: 'GeoNet — live New Zealand earthquakes (api.geonet.org.nz quake feed)',
    dataSource: 'https://api.geonet.org.nz/quake',
    sub: 'New Zealand earthquakes',
  },
  {
    id: '43_geonet_volcano', label: 'GeoNet Volcano', symbol: '⏍',
    color: '#2ed7b7', motionType: 'radar', group: 'seismic',
    type: 'point', description: 'GeoNet — New Zealand volcano alert levels (api.geonet.org.nz volcano VAL feed)',
    dataSource: 'https://api.geonet.org.nz/volcano/val',
    sub: 'NZ volcano alert levels',
  },
  // ── 44. (deleted) ──
  // ── 45. (deleted) ──
  // ── 46. (deleted) ──
  // ── 47. Coral Reefs & Marine Ecosystems ──
  // ── 48. (deleted) ──
  // ── 49. (deleted) ──
  // ── 50. Seafloor Mapping & Bathymetry ──
  {
    id: '50_gebco', label: 'GEBCO Grid', symbol: '⏾',
    color: '#1d86b6', motionType: 'float', group: 'ocean',
    type: 'tile', description: 'GEBCO 2024 Global Gridded Bathymetry — 450m resolution, WMS tile layer',
    dataSource: 'https://wms.gebco.net/',
    sub: 'Bathymetry tiles',
  },
  {
    id: '50_emodnet_bathymetry', label: 'EMODnet Bathymetry', symbol: '⏿',
    color: '#1db673', motionType: 'glow', group: 'ocean',
    type: 'tile', description: 'EMODnet Digital Bathymetry (DTM) — European marine observation data network, WMS',
    dataSource: 'https://ows.emodnet-bathymetry.eu/wms',
    sub: 'Bathymetry tiles',
    opacity: 0.7,
  },
  // ids below are legacy (EMODnet/GlobColour); both render GIBS chlorophyll
  // via App.tsx getNasaGibsProvider, so the catalog reflects the real product.
  {
    id: '50_emodnet_chemistry', label: 'VIIRS Chlorophyll-a', symbol: '⏀',
    color: '#b61d65', motionType: 'glow', group: 'ocean',
    type: 'tile', description: 'VIIRS SNPP chlorophyll-a concentration — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '50_globcolour', label: 'MODIS Aqua Chlorophyll-a', symbol: '⏄',
    color: '#3db81e', motionType: 'float', group: 'ocean',
    type: 'tile', description: 'MODIS Aqua chlorophyll-a concentration — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
    badge: 'LIVE',
  },
  {
    id: '50_ocean_currents', label: 'Ocean Currents', symbol: '↗',
    color: '#1ea1b6', motionType: 'float', group: 'ocean',
    type: 'point', description: 'Open-Meteo Marine — Global surface current velocity & direction',
    dataSource: 'https://open-meteo.com/',
    sub: 'Surface currents',
    badge: 'LIVE',
  },
  // ── 53. (deleted) ──
  // ── 54. Coastal Erosion & Monitoring ──
  // ── 56. Climate Teleconnections ──
  {
    id: '57_noaa_cpc', label: 'NOAA CPC', symbol: '∟',
    color: '#990fc9', motionType: 'dash', group: 'weather',
    type: 'heatmap', description: 'NOAA CPC — Climate Teleconnections',
    dataSource: 'https://www.cpc.ncep.noaa.gov/',
    sub: 'Climate prediction',
  },
  // ── 58. Wildfire & Smoke Management (synthetic wildfire layer available separately) ──
  // ── 59. (deleted) ──
  // ── 60. (deleted) ──
  // ── 63. (deleted) ──
  // ── 64. Weather Radar & Nowcasting ──
  {
    id: '64_nexrad_level_ii', label: 'NEXRAD Level-II', symbol: '∿',
    color: '#a6271c', motionType: 'flicker', group: 'weather',
    type: 'heatmap', description: 'NEXRAD Level-II — Weather Radar & Nowcasting',
    dataSource: 'https://registry.opendata.aws/noaa-nexrad/',
    sub: 'Weather radar',
  },
  // ── 65. (deleted) ──
  // ── 67. (deleted) ──
  // ── 69. Satellite Altimetry & Sea Level ──
  // ── 70. Imagery tile set (ids are legacy portal names; every layer below
  //         is rendered from NASA GIBS WMS — see App.tsx getNasaGibsProvider) ──
  {
    id: '70_comet', label: 'VIIRS Thermal Anomalies 375m', symbol: '≦',
    color: '#c50d71', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP Thermal Anomalies 375m All — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_comet_licsar', label: 'MODIS Cloud Phase IR', symbol: '≧',
    color: '#48b623', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Phase Infrared Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_licsar', label: 'MODIS Sea Ice Daily', symbol: '≨',
    color: '#2822bc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra L3 Sea Ice Daily — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_asf_sar_data', label: 'AIRS Carbon Monoxide', symbol: '≩',
    color: '#c25721', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'AIRS L2 Carbon Monoxide 500hPa Volume Mixing Ratio Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_unavco_sar', label: 'MODIS NDSI Snow Cover', symbol: '≪',
    color: '#20c98a', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra NDSI Snow Cover — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_squeesar', label: 'VIIRS Sea Surface Temp', symbol: '≫',
    color: '#c11fd0', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP L2 Sea Surface Temperature Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: '70_mintpy', label: 'MODIS EVI 8-Day', symbol: '≬',
    color: '#b0d61e', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra EVI 8-Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  // ── 71. (deleted) ──
  // ── Synthetic / Derived Layers ──
  {
    id: 'earthquakes', label: 'Earthquakes', symbol: '≲',
    color: '#29ede5', motionType: 'radar', group: 'seismic',
    type: 'point', description: 'Real-time earthquake data from USGS',
    dataSource: 'https://earthquake.usgs.gov/earthquakes/feed/',
    badge: 'LIVE',
    sub: 'USGS Real-Time',
  },
  {
    id: 'tectonic', label: 'Tectonic Plates', symbol: '≳',
    color: '#ef2cbe', motionType: 'pulse', group: 'seismic',
    type: 'geojson', description: 'Plate boundary network with active fault zones highlighted',
    dataSource: 'https://github.com/fraxen/tectonicplates',
    sub: 'USGS Plates',
  },
  {
    id: 'seismic_waves', label: 'Seismic Wave Propagation', symbol: '≴',
    color: '#88f130', motionType: 'flicker', group: 'seismic',
    type: 'effect', description: 'P-wave, S-wave, and surface wave propagation from earthquake epicenters',
    dataSource: '',
    sub: 'Click earthquake to trigger',
  },
  {
    id: 'heatmap', label: 'Seismic Heatmap', symbol: '≶',
    color: '#a9301e', motionType: 'pulse', group: 'seismic',
    type: 'heatmap', description: 'Density heatmap computed from earthquake epicenters',
    dataSource: '',
  },
  {
    id: 'flight_tracks', label: 'Flight Tracks', symbol: '≷',
    color: '#1eaf5b', motionType: 'dash', group: 'aviation',
    type: 'point', description: 'Live flight tracking from ADSB.lol',
    dataSource: 'https://adsb.lol/',
  },
  {
    id: 'airports', label: 'Major Airports', symbol: '≸',
    color: '#891db6', motionType: 'orbit', group: 'aviation',
    type: 'point', description: 'World major airports dataset',
    dataSource: 'https://github.com/mwgg/Airports',
  },
  {
    id: 'airspaces', label: 'Airspace Boundaries', symbol: '≹',
    color: '#bcbc1c', motionType: 'trail', group: 'aviation',
    type: 'geojson', description: 'Airspace boundary polygons from OpenAIP',
    dataSource: '',
  },
  {
    id: 'space_debris', label: 'Space Debris', symbol: '≻',
    color: '#c91a63', motionType: 'trail', group: 'space',
    type: 'point', description: 'Orbital debris tracking from CelesTrak',
    dataSource: 'https://celestrak.org/',
    sub: 'CelesTrak GP (1500+ objects)',
  },
  {
    id: 'nasa_dsn', label: 'NASA Deep Space Network', symbol: '≼',
    color: '#30d019', motionType: 'orbit', group: 'space',
    type: 'point', description: 'Active deep-space tracking stations',
    dataSource: '',
    badge: 'LIVE',
    sub: 'Active deep-space tracking',
  },
  {
    id: 'space_weather', label: 'Space Weather', symbol: '≽',
    color: '#3818d7', motionType: 'glow', group: 'space',
    type: 'point', description: 'Real-time space weather from NOAA SWPC',
    dataSource: 'https://services.swpc.noaa.gov/',
    badge: 'LIVE',
    sub: 'NOAA SWPC',
  },
  {
    id: 'lightning_strikes', label: 'Lightning Strikes', symbol: '≾',
    color: '#de7217', motionType: 'flicker', group: 'weather',
    type: 'point', description: 'Real-time lightning detection',
    dataSource: '',
    badge: 'LIVE',
    sub: 'Real-Time Lightning',
  },
  {
    id: 'aurora_oval', label: 'Polar Auroral Oval', symbol: '≿',
    color: '#15e5b1', motionType: 'glow', group: 'space',
    type: 'point', description: 'NOAA Ovation aurora forecast',
    dataSource: '',
    sub: 'NOAA SWPC Ovation Model',
  },

  {
    id: 'smoke_dispersion', label: 'Smoke Dispersion', symbol: '⊁',
    color: '#a6ee18', motionType: 'flicker', group: 'hazards',
    type: 'effect', description: 'Wind-driven plume from active fires',
    dataSource: '',
    sub: 'EONET active fire sources',
  },
  {
    id: 'wildfires', label: 'Wildfires', symbol: '⊂',
    color: '#1b6af0', motionType: 'dash', group: 'hazards',
    type: 'point', description: 'Active fire detection from EONET',
    dataSource: '',
    sub: 'EONET fire events',
  },
  {
    id: 'severe_storms', label: 'Severe Storms', symbol: '⊃',
    color: '#d93744', motionType: 'wave', group: 'hazards',
    type: 'point', description: 'Severe weather events from EONET',
    dataSource: '',
    sub: 'EONET storm events',
  },
  {
    id: 'volcanoes', label: 'Volcanoes', symbol: '⊄',
    color: '#3adc5c', motionType: 'flicker', group: 'volcanic',
    type: 'point', description: 'Open volcanic activity events from NASA EONET',
    dataSource: 'https://eonet.gsfc.nasa.gov/',
    sub: 'EONET volcano events',
  },
  {
    id: 'dust', label: 'Dust Storms', symbol: '⊆',
    color: '#e1c041', motionType: 'breathe', group: 'hazards',
    type: 'point', description: 'Dust storm events from EONET',
    dataSource: '',
    sub: 'EONET dust events',
  },
  {
    id: 'seaLakeIce', label: 'Icebergs & Sea Ice', symbol: '⊇',
    color: '#199ca9', motionType: 'float', group: 'hazards',
    type: 'point', description: 'EONET sea and lake ice events',
    dataSource: '',
    sub: 'Antarctic iceberg calving & sea ice events',
  },
  {
    id: 'disaster_alerts', label: 'Disaster Alerts', symbol: '⊈',
    color: '#af1876', motionType: 'flicker', group: 'hazards',
    type: 'point', description: 'Global disaster alerts from GDACS',
    dataSource: 'https://www.gdacs.org/',
    badge: 'LIVE',
    sub: 'GDACS Alerts',
  },
  {
    id: 'disaster_near_me', label: 'Disasters Near Me', symbol: '⊉',
    color: '#4cb518', motionType: 'pulse', group: 'hazards',
    type: 'point', description: 'Location-based disaster alerts from EONET',
    dataSource: '',
    sub: 'Requires location',
  },
  {
    id: 'flood_extent', label: 'Flood Extent Mapping', symbol: '⊊',
    color: '#171dbc', motionType: 'radar', group: 'hazards',
    type: 'tile', description: 'MODIS Combined Flood 1-Day — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
    badge: 'KEY',
  },
  {
    id: 'live_media', label: 'Live Media', symbol: '▶',
    color: '#ef4444', motionType: 'breathe', group: 'media',
    type: 'point', description: 'YouTube crisis-video search (server topic feed) — placed at the location named in the title when identifiable (approximate)',
    dataSource: 'https://www.youtube.com/results',
    badge: 'LIVE',
    sub: 'YouTube crisis videos',
  },
  {
    id: 'tomtom_traffic', label: 'Street Traffic', symbol: '⊖',
    color: '#f97316', motionType: 'glow', group: 'infrastructure',
    type: 'point', description: 'Street-level traffic flow with congestion coloring — TomTom Flow Segment Data API (v4)',
    dataSource: 'https://api.tomtom.com/traffic/services/4/flowSegmentData',
    sub: 'Live street-level flow',
    badge: 'KEY',
  },
  {
    id: 'radio_stations', label: 'World Radio', symbol: '≡',
    color: '#22d3ee', motionType: 'pulse', group: 'infrastructure',
    type: 'point', description: 'Geolocated world radio stations (Radio Browser API)',
    dataSource: 'https://www.radio-browser.info/',
    badge: 'LIVE',
    sub: 'Geolocated radio broadcasters',
  },
  {
    id: 'bikeshare', label: 'Bikeshare', symbol: '≣',
    color: '#4ade80', motionType: 'pulse', group: 'infrastructure',
    type: 'point', description: 'Live bikeshare station availability (GBFS)',
    dataSource: 'https://gbfs.org/',
    badge: 'LIVE',
    sub: 'Live station availability',
  },
  {
    id: 'detection_overlay', label: 'Detection Overlay', symbol: '⊛',
    color: '#38bdf8', motionType: 'glow', group: 'media',
    type: 'effect', description: 'Screen-space bounding boxes + IDs on live entities (client-side)',
    dataSource: '',
    sub: 'Screen-space detection mesh',
  },
  {
    id: 'population_impact', label: 'Population Impact Zones', symbol: '⊎',
    color: '#bed712', motionType: 'float', group: 'geospatial',
    type: 'polygon', description: 'Top urban centres with live population — Open-Meteo Geocoding API (GeoNames)',
    dataSource: 'https://geocoding-api.open-meteo.com/v1/search',
    sub: 'Live population overlay',
  },
  {
    id: 'submarine_cables', label: 'Undersea Fiber Cables', symbol: '⊏',
    color: '#1188de', motionType: 'orbit', group: 'infrastructure',
    type: 'geojson', description: 'Global submarine cable network — TeleGeography cable-geo API',
    dataSource: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
  },
  {
    id: 'animal_migrations', label: 'Animal Migrations', symbol: '⊐',
    color: '#e50f4d', motionType: 'breathe', group: 'ecology',
    type: 'point', description: 'Animal migration tracking from Movebank',
    dataSource: 'https://www.movebank.org/',
    sub: 'Movebank API',
  },
  {
    id: 'nasa_gibs', label: 'VIIRS NOAA-20 True Color', symbol: '⊒',
    color: '#5c27d8', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'VIIRS NOAA-20 Corrected Reflectance True Color — NASA GIBS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'night_lights', label: 'VIIRS Black Marble', symbol: '⊓',
    color: '#db922a', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'VIIRS Black Marble nighttime lights — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'aerosol_index', label: 'Aerosol Index', symbol: '⊔',
    color: '#2ddec8', motionType: 'glow', group: 'atmosphere',
    type: 'tile', description: 'OMPS Aerosol Index — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'dust_score', label: 'Dust (MERRA-2)', symbol: '⊕',
    color: '#e030c2', motionType: 'breathe', group: 'atmosphere',
    type: 'tile', description: 'MERRA-2 dust surface mass concentration — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'sea_ice', label: 'Sea Ice', symbol: '❄',
    color: '#91e333', motionType: 'float', group: 'cryosphere',
    type: 'tile', description: 'MODIS sea ice concentration — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'temp_anomaly', label: 'Surface Air Temp (AIRS)', symbol: '⊘',
    color: '#e7423a', motionType: 'breathe', group: 'atmosphere',
    type: 'tile', description: 'AIRS L2 surface air temperature (day) — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'precipitation', label: 'Precipitation', symbol: '⊙',
    color: '#13ae48', motionType: 'flicker', group: 'weather',
    type: 'tile', description: 'IMERG precipitation rate — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'wind', label: 'Ocean Wind Speed', symbol: '⊚',
    color: '#7912b5', motionType: 'dash', group: 'weather',
    type: 'tile', description: 'CYGNSS L3 ocean-surface wind speed (daily) — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'pressure', label: 'Pressure', symbol: '⭘',
    color: '#bcae11', motionType: 'wave', group: 'weather',
    type: 'tile', description: 'MERRA-2 surface pressure (monthly) — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'co_index', label: 'CO Column (MOPITT)', symbol: '⊜',
    color: '#109cc2', motionType: 'shimmer', group: 'atmosphere',
    type: 'tile', description: 'MOPITT CO daily total column (day) — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'so2_index', label: 'SO2 Lower Troposphere', symbol: '⊝',
    color: '#c90f6b', motionType: 'glow', group: 'atmosphere',
    type: 'tile', description: 'OMPS lower-troposphere SO2 column — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'land_cover', label: 'Land Cover', symbol: '⊞',
    color: '#35d00e', motionType: 'float', group: 'ecology',
    type: 'tile', description: 'MODIS Combined IGBP land cover (annual) — NASA GIBS WMS',
    dataSource: 'https://gibs.earthdata.nasa.gov/',
    sub: 'NASA GIBS WMS',
  },
  {
    id: 'dt_buildings', label: 'OSM Buildings', symbol: '⊟',
    color: '#3224bf', motionType: 'dash', group: 'geospatial',
    type: '3dtiles', description: 'OSM buildings 3D tiles',
    dataSource: '',
  },

  // ── Energy & Resources — honest, machine-readable sources only. Layers
  //     without a real data path (chokepoints, pipelines, storage facilities,
  //     fuel shortages) were removed — no fabricated/placeholder data.
  {
    id: 'electricity_grid', label: 'Electricity Grid', symbol: '⊑',
    color: '#28d229', motionType: 'radar', group: 'energy',
    type: 'point', description: 'Real-time electricity carbon intensity by zone (Electricity Maps)',
    dataSource: 'https://www.electricitymaps.com/',
    sub: 'Electricity Maps API',
  },
  {
    id: 'eu_gas_storage', label: 'EU Gas Storage', symbol: '◧',
    color: '#264653', motionType: 'breathe', group: 'energy',
    type: 'point', description: 'European gas storage fill levels by country (GIE AGSI+)',
    dataSource: 'https://agsi.gie.eu/api',
    sub: 'GIE AGSI+ (key)',
  },

  // ── NEW LAYERS: Risk & Security ──
  {
    id: 'sanctions_pressure', label: 'Sanctions Pressure', symbol: '⊗',
    color: '#780000', motionType: 'contract', group: 'security',
    type: 'point', description: 'Global sanctions regime — OFAC, EU, UN sanctions by country',
    dataSource: 'https://www.treasury.gov/',
    sub: 'OFAC/EU/UN Sanctions',
  },
  {
    id: 'military_bases', label: 'Military Bases', symbol: '▲',
    color: '#555555', motionType: 'glow', group: 'security',
    type: 'point', description: 'Military installations worldwide from Wikidata SPARQL (Q245016)',
    dataSource: 'https://query.wikidata.org/sparql',
    sub: 'Wikidata SPARQL',
  },

  // ── NEW LAYERS: Conflict & Geopolitics ──
  // (gpsjam, iran_events, oref_alerts, infra_outages removed — no public,
  // machine-readable, license-clean source; infra outages is covered by the
  // wired 'internet_outages' IODA layer.)
  {
    id: 'ucdp_conflict', label: 'Armed Conflict Events', symbol: '⚔',
    color: '#9d0208', motionType: 'pulse', group: 'security',
    type: 'point', description: 'UCDP armed conflict events — requires UCDP_ACCESS_TOKEN',
    dataSource: 'https://ucdpapi.pcr.uu.se/api/',
    sub: 'UCDP API',
    badge: 'LIVE',
  },

  // ── Satellite Data Enrichment Layers ──
  {
    id: 'satnogs_db', label: 'SatNOGS Frequencies', symbol: '▥',
    color: '#f59e0b', motionType: 'orbit', group: 'space',
    type: 'panel', description: 'Satellite transmitter frequencies and modes from SatNOGS DB — cross-reference NORAD IDs with radio data',
    dataSource: 'https://db.satnogs.org/api/',
    sub: 'Satellite radio frequencies',
    badge: 'LIVE',
  },
  {
    id: 'ucs_satellite_db', label: 'UCS Satellite Catalog', symbol: '▤',
    color: '#3b82f6', motionType: 'orbit', group: 'space',
    type: 'panel', description: 'UCS Satellite Database — detailed satellite metadata: purpose, operator, country, launch date, mass',
    dataSource: 'https://www.ucs.org/resources/satellite-database',
    sub: 'Satellite metadata catalog',
    badge: 'KEY',
  },
];


export const LEGACY_DEFAULTS: Record<string, { on?: boolean; badge?: string; sub?: string; opacity?: number }> = {
  earthquakes: { badge: 'LIVE', sub: 'USGS Real-Time' },
  tectonic: { badge: 'KEY', sub: 'USGS Plates' },
  flight_tracks: { sub: 'ADSB.lol Live' },
  space_debris: { sub: 'CelesTrak GP (1500+ objects)' },
  ais_vessels: { badge: 'KEY', sub: 'AISStream Real-Time' },
  live_media: { badge: 'LIVE', sub: 'YouTube news videos', on: false },
  lightning_strikes: { badge: 'LIVE', sub: 'Real-Time Lightning' },
  aurora_oval: { opacity: 0.8, sub: 'NOAA Ovation Forecast' },
  flood_extent: { badge: 'KEY' },
  nasa_gibs: { opacity: 0.8 },
  night_lights: { opacity: 0.8 },
  sea_ice: { opacity: 0.7 },
  precipitation: { opacity: 0.6 },
  wind: { opacity: 0.6 },
  heatmap: { opacity: 0.7 },
  airspaces: { sub: 'OpenAIP Airspace' },
  submarine_cables: { sub: 'Submarine Cable Map' },
  seaLakeIce: { sub: 'EONET sea ice events' },
  satnogs_db: { badge: 'LIVE', sub: 'SatNOGS transmitter frequencies', on: false },
  ucs_satellite_db: { badge: 'KEY', sub: 'UCS satellite metadata catalog', on: false },
  '50_ocean_currents': { badge: 'LIVE', sub: 'Open-Meteo surface currents' },
};


export function getLayerById(id: string): LayerCategory | undefined {
  return LAYER_CATEGORIES.find(lc => lc.id === id);
}

