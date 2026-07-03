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
  { id: 'ocean', label: 'Ocean', icon: '◈', color: '#1ea947' },
  { id: 'argo', label: 'ARGO Floats', icon: '◈', color: '#0d7bbf' },
  { id: 'tides', label: 'Tides', icon: '◈', color: '#2596be' },
  { id: 'usgs_water', label: 'Water Quality', icon: '◈', color: '#2e86ab' },
  { id: 'ports', label: 'World Ports', icon: '◈', color: '#1a6d8a' },
  { id: 'aviation', label: 'Aviation', icon: '◆', color: '#731eaf' },
  { id: 'satellite', label: 'Satellite', icon: '◇', color: '#b6a31d' },
  { id: 'weather', label: 'Weather', icon: '▣', color: '#1ca1bc' },
  { id: 'hazards', label: 'Hazards', icon: '◉', color: '#c31b76' },
  { id: 'space', label: 'Space', icon: '◎', color: '#46c91a' },
  { id: 'geospatial', label: 'Geospatial', icon: '◰', color: '#2119d0' },
  { id: 'atmosphere', label: 'Atmosphere', icon: '◐', color: '#d75818' },
  { id: 'geology', label: 'Geology', icon: '▤', color: '#17de93' },
  { id: 'ecology', label: 'Ecology', icon: '▥', color: '#d415e5' },
  { id: 'cryosphere', label: 'Cryosphere', icon: '◒', color: '#beeb14' },
  { id: 'advanced', label: 'Advanced', icon: '▦', color: '#1882ee' },
];

export const LAYER_CATEGORIES: LayerCategory[] = [
  // ── 1. Maritime Data APIs ──
  {
    id: '1_world_port_index', label: 'World Port Index', symbol: '┆',
    color: '#5daf18', motionType: 'wave', group: 'ports',
    type: 'point', description: 'World Port Index — Maritime Data APIs',
    dataSource: 'https://msi.nga.mil/',
    sub: 'Maritime data',
  },
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
    id: '2_flightaware_aeroapi', label: 'FlightAware AeroAPI', symbol: '┋',
    color: '#d0d013', motionType: 'orbit', group: 'aviation',
    type: 'point', description: 'FlightAware AeroAPI — Aviation & Flight Tracking',
    dataSource: 'https://flightaware.com/commercial/aeroapi/',
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
  // ── 3. Satellite Imagery & Earth Observation ──
  {
    id: '3_planetary_computer_stac', label: 'MODIS Terra True Color', symbol: '┎',
    color: '#29e50f', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance True Color — Satellite Earth Observation',
    dataSource: 'https://planetarycomputer.microsoft.com/',
    sub: 'Satellite catalog',
  },
  {
    id: '3_aws_earth_search', label: 'MODIS Aqua True Color', symbol: '┏',
    color: '#4528d2', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Aqua Corrected Reflectance True Color — Satellite Earth Observation',
    dataSource: 'https://element84.com/',
    sub: 'Cloud satellite data',
  },
  {
    id: '3_copernicus_data_space', label: 'MODIS Terra False Color (721)', symbol: '┐',
    color: '#d87927', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance Bands 7-2-1 — Satellite Earth Observation',
    dataSource: 'https://dataspace.copernicus.eu/',
    sub: 'ESA satellite data',
  },
  {
    id: '3_usgs_earthexplorer', label: 'MODIS Terra Surface Reflectance 143', symbol: '┑',
    color: '#2adbaf', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Surface Reflectance Bands 1-4-3 — Satellite Earth Observation',
    dataSource: 'https://earthexplorer.usgs.gov/',
    sub: 'Earth data explorer',
  },
  {
    id: '3_usgs_appeears', label: 'MODIS Terra Land Surface Temp', symbol: '└',
    color: '#3374e3', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Land Surface Temperature Day — Satellite Earth Observation',
    dataSource: 'https://appeears.earthdatacloud.nasa.gov/',
    sub: 'Earth data access',
  },
  {
    id: '3_veda_dashboard', label: 'VIIRS SNPP True Color', symbol: '┖',
    color: '#3ae75f', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP Corrected Reflectance True Color — Satellite Earth Observation',
    dataSource: 'https://www.earthdata.nasa.gov/dashboard/',
    sub: 'NASA data dashboard',
  },
  {
    id: '3_jaxa_g_portal', label: 'MODIS Aerosol Optical Depth', symbol: '┗',
    color: '#6213ae', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Aerosol Optical Depth Deep Blue Combined — Satellite Earth Observation',
    dataSource: 'https://gportal.jaxa.jp/',
    sub: 'Japanese satellite data',
  },
  {
    id: '3_jaxa_himawari_monitor', label: 'MODIS Cloud Top Height', symbol: '┘',
    color: '#b59412', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Top Height Day — Satellite Earth Observation',
    dataSource: 'https://www.eorc.jaxa.jp/ptree/',
    sub: 'Himawari satellite',
  },
  {
    id: '3_noaa_goes_r_series', label: 'MODIS Brightness Temp Band 31', symbol: '┙',
    color: '#11adbc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Brightness Temperature Band 31 Day — Satellite Earth Observation',
    dataSource: 'https://www.goes-r.gov/',
    sub: 'GOES satellite data',
  },
  {
    id: '3_landsat_look', label: 'MODIS Surf. Reflectance 721', symbol: '┚',
    color: '#c2107f', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Surface Reflectance Bands 7-2-1 — Satellite Earth Observation',
    dataSource: 'https://landsatlook.usgs.gov/',
    sub: 'Landsat imagery',
  },
  {
    id: '3_planet_labs_open_data', label: 'MODIS Cloud Eff. Radius', symbol: '┛',
    color: '#4cc90f', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Effective Radius — Satellite Earth Observation',
    dataSource: 'https://www.planet.com/open-data/',
    sub: 'Daily satellite imagery',
  },
  {
    id: '3_openaerialmap', label: 'MODIS Cloud Fraction', symbol: '├',
    color: '#0e15d0', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Fraction Day — Satellite Earth Observation',
    dataSource: 'https://openaerialmap.org/',
    sub: 'Open aerial imagery',
  },
  {
    id: '3_bhuvan_isro', label: 'MODIS Cloud Opt. Thickness', symbol: '┝',
    color: '#bf4c24', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Optical Thickness — Satellite Earth Observation',
    dataSource: 'https://bhuvan.nrsc.gov.in/',
    sub: 'Indian satellite data',
  },
  {
    id: '3_air_centre_eo_catalog', label: 'AIRS Dust Score', symbol: '┞',
    color: '#24c67c', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'AIRS L2 Dust Score Day — Satellite Earth Observation',
    dataSource: 'https://services.aircentre.org/eo-catalog/collections',
    sub: 'Atlantic EO data',
  },
  {
    id: '3_aster_gdem', label: 'ASTER GDEM Color Index', symbol: '┟',
    color: '#b123cc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'ASTER GDEM Color Index — Satellite Earth Observation',
    dataSource: 'https://asterweb.jpl.nasa.gov/gdem.asp',
    sub: 'Global elevation model',
  },
  {
    id: '3_srtm', label: 'MODIS Corr. Refl. 367', symbol: '┠',
    color: '#bbd322', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Corrected Reflectance Bands 3-6-7 — Satellite Earth Observation',
    dataSource: 'https://srtm.csi.cgiar.org/',
    sub: 'Shuttle radar data',
  },
  {
    id: '3_gebco', label: 'GHRSST Sea Surface Temp', symbol: '┡',
    color: '#208bd9', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'GHRSST L4 MUR Sea Surface Temperature — Satellite Earth Observation',
    dataSource: 'https://www.gebco.net/',
    sub: 'Global bathymetry',
  },
  {
    id: '3_modis_web_services', label: 'MODIS Water Vapor', symbol: '┢',
    color: '#e02057', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Water Vapor 5km Day — Satellite Earth Observation',
    dataSource: 'https://modis.gsfc.nasa.gov/data/',
    sub: 'MODIS satellite data',
  },
  {
    id: '3_viirs_active_fires', label: 'MODIS Thermal Anomalies', symbol: '┣',
    color: '#23e224', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Thermal Anomalies All — Satellite Earth Observation',
    dataSource: 'https://www.earthdata.nasa.gov/learn/find-data/near-real-time/firms',
    sub: 'Active fire detection',
  },
  {
    id: '3_global_surface_water_explorer', label: 'MODIS Flood Extent', symbol: '┤',
    color: '#5f26e5', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Combined Flood 1-Day — Satellite Earth Observation',
    dataSource: 'https://global-surface-water.appspot.com/',
    sub: 'Surface water data',
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
  {
    id: '9_openaq', label: 'OpenAQ', symbol: '▃',
    color: '#a91c19', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'OpenAQ — Atmosphere & Environmental Science',
    dataSource: 'https://openaq.org/',
    sub: 'Air quality data',
  },
  {
    id: '9_world_aqi_api', label: 'World AQI API', symbol: '▄',
    color: '#18af47', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'World AQI API — Atmosphere & Environmental Science',
    dataSource: 'https://aqicn.org/api/',
    sub: 'Air quality index',
  },
  {
    id: '9_lightning_alerts_openweather', label: 'Lightning Alerts (OpenWeather)', symbol: '▅',
    color: '#7718b5', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'Lightning Alerts (OpenWeather) — Atmosphere & Environmental Science',
    dataSource: 'https://openweathermap.org/api/lightning',
    sub: 'Atmospheric data',
  },
  {
    id: '9_copernicus_atmosphere', label: 'Copernicus Atmosphere', symbol: '▆',
    color: '#bcab17', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'Copernicus Atmosphere — Atmosphere & Environmental Science',
    dataSource: 'https://atmosphere.copernicus.eu/',
    sub: 'Atmospheric data',
  },
  {
    id: '9_nasa_gmao', label: 'NASA GMAO', symbol: '▇',
    color: '#16a2c3', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'NASA GMAO — Atmosphere & Environmental Science',
    dataSource: 'https://gmao.gsfc.nasa.gov/',
    sub: 'Global modeling data',
  },
  {
    id: '9_airs_nasa', label: 'AIRS (NASA)', symbol: '█',
    color: '#c91573', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'AIRS (NASA) — Atmosphere & Environmental Science',
    dataSource: 'https://airs.jpl.nasa.gov/',
    sub: 'Atmospheric infrared',
  },
  {
    id: '9_omi_nasa', label: 'OMI (NASA)', symbol: '▉',
    color: '#3fd013', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'OMI (NASA) — Atmosphere & Environmental Science',
    dataSource: 'https://ozoneaq.gsfc.nasa.gov/',
    sub: 'Ozone monitoring',
  },
  {
    id: '9_epa_airdata', label: 'EPA AirData', symbol: '▊',
    color: '#1e12d7', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'EPA AirData — Atmosphere & Environmental Science',
    dataSource: 'https://www.epa.gov/outdoor-air-quality-data',
    sub: 'US air quality',
  },
  {
    id: '9_airnow_api', label: 'AirNow API', symbol: '▋',
    color: '#de5911', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'AirNow API — Atmosphere & Environmental Science',
    dataSource: 'https://www.airnowapi.org/',
    sub: 'US air quality',
  },
  {
    id: '9_european_environment_agency', label: 'European Environment Agency', symbol: '▌',
    color: '#0fe599', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'European Environment Agency — Atmosphere & Environmental Science',
    dataSource: 'https://www.eea.europa.eu/',
    sub: 'Atmospheric data',
  },
  {
    id: '9_purpleair_api', label: 'PurpleAir API', symbol: '▍',
    color: '#c728d2', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'PurpleAir API — Atmosphere & Environmental Science',
    dataSource: 'https://api.purpleair.com/',
    sub: 'Community air quality',
  },
  {
    id: '9_waqi', label: 'WAQI', symbol: '▎',
    color: '#b0d827', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'WAQI — Atmosphere & Environmental Science',
    dataSource: 'https://waqi.info/',
    sub: 'Atmospheric data',
  },
  {
    id: '9_cams_global_reanalysis', label: 'CAMS Global Reanalysis', symbol: '▏',
    color: '#2a7fdb', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'CAMS Global Reanalysis — Atmosphere & Environmental Science',
    dataSource: 'https://ads.atmosphere.copernicus.eu/',
    sub: 'Atmospheric reanalysis',
  },
  {
    id: '9_hysplit', label: 'HYSPLIT', symbol: '▐',
    color: '#de2d4e', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'HYSPLIT — Atmosphere & Environmental Science',
    dataSource: 'https://www.ready.noaa.gov/',
    sub: 'Air trajectory model',
  },
  {
    id: '9_silam', label: 'SILAM', symbol: '░',
    color: '#30e043', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'SILAM — Atmosphere & Environmental Science',
    dataSource: 'https://silam.fmi.fi/',
    sub: 'Air quality modeling',
  },
  {
    id: '9_macc', label: 'MACC', symbol: '▒',
    color: '#7933e3', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'MACC — Atmosphere & Environmental Science',
    dataSource: 'https://atmosphere.copernicus.eu/',
    sub: 'Atmospheric data',
  },
  {
    id: '9_tempo', label: 'TEMPO', symbol: '▓',
    color: '#e5af37', motionType: 'glow', group: 'atmosphere',
    type: 'heatmap', description: 'TEMPO — Atmosphere & Environmental Science',
    dataSource: 'https://tempo.si.edu/',
    sub: 'Air quality satellite',
  },
  {
    id: '9_pandonia', label: 'Pandonia', symbol: '▔',
    color: '#3ae7e4', motionType: 'breathe', group: 'atmosphere',
    type: 'heatmap', description: 'Pandonia — Atmosphere & Environmental Science',
    dataSource: 'https://www.pandonia-global-network.org/',
    sub: 'Pandora instrument data',
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
  // ── 29. Volcanic Hazards & Ash ──
  {
    id: '29_tokyo_vaac', label: 'Tokyo VAAC', symbol: '⌱',
    color: '#b40e84', motionType: 'orbit', group: 'aviation',
    type: 'point', description: 'Tokyo VAAC — Volcanic Hazards & Ash',
    dataSource: 'https://ds.data.jma.go.jp/svd/vaac/data/',
    sub: 'Volcanic ash advisory',
  },
  {
    id: '29_anchorage_vaac', label: 'Anchorage VAAC', symbol: '⌲',
    color: '#55bb0c', motionType: 'trail', group: 'aviation',
    type: 'point', description: 'Anchorage VAAC — Volcanic Hazards & Ash',
    dataSource: 'https://www.weather.gov/vaac/',
    sub: 'Volcanic ash advisory',
  },
  {
    id: '29_washington_vaac', label: 'Washington VAAC', symbol: '⌳',
    color: '#2132ac', motionType: 'dash', group: 'aviation',
    type: 'point', description: 'Washington VAAC — Volcanic Hazards & Ash',
    dataSource: 'https://www.nhc.noaa.gov/',
    sub: 'Volcanic ash advisory',
  },
  {
    id: '29_wovodat', label: 'WOVOdat', symbol: '⌴',
    color: '#b33820', motionType: 'orbit', group: 'aviation',
    type: 'point', description: 'WOVOdat — Volcanic Hazards & Ash',
    dataSource: 'https://www.wovodat.org/',
    sub: 'Volcano observatory data',
  },
  {
    id: '29_nasa_so2_monitoring', label: 'NASA SO2 Monitoring', symbol: '⌵',
    color: '#1fb966', motionType: 'trail', group: 'aviation',
    type: 'point', description: 'NASA SO2 Monitoring — Volcanic Hazards & Ash',
    dataSource: 'https://so2.gsfc.nasa.gov/',
    sub: 'Volcanic SO2 data',
  },
  {
    id: '29_noaa_so2_portal', label: 'NOAA SO2 Portal', symbol: '⌶',
    color: '#971fbf', motionType: 'dash', group: 'aviation',
    type: 'point', description: 'NOAA SO2 Portal — Volcanic Hazards & Ash',
    dataSource: 'https://satepsanone.nesdis.noaa.gov/pub/OMI/OMISO2/',
    sub: 'Volcanic hazards',
  },
  {
    id: '29_volcano_discovery', label: 'Volcano Discovery', symbol: '⌷',
    color: '#bfc61e', motionType: 'orbit', group: 'aviation',
    type: 'point', description: 'Volcano Discovery — Volcanic Hazards & Ash',
    dataSource: 'https://www.volcanodiscovery.com/',
    sub: 'Volcanic activity',
  },
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
  // ── 43. Strong Motion & EQ Engineering ──
  {
    id: '43_cosmos', label: 'COSMOS', symbol: '⏉',
    color: '#da145b', motionType: 'flicker', group: 'seismic',
    type: 'point', description: 'COSMOS — Strong Motion & EQ Engineering',
    dataSource: 'https://www.strongmotion.org/',
    sub: 'Strong motion data',
  },
  {
    id: '43_cosmos_vdc', label: 'COSMOS VDC', symbol: '⏊',
    color: '#20e113', motionType: 'radar', group: 'seismic',
    type: 'point', description: 'COSMOS VDC — Strong Motion & EQ Engineering',
    dataSource: 'https://www.strongmotioncenter.org/vdc/',
    sub: 'Strong motion data',
  },
  {
    id: '43_k_net_kik_net', label: 'K-NET / KiK-net', symbol: '⏋',
    color: '#4211e8', motionType: 'pulse', group: 'seismic',
    type: 'point', description: 'K-NET / KiK-net — Strong Motion & EQ Engineering',
    dataSource: 'https://www.kyoshin.bosai.go.jp/',
    sub: 'Japan strong motion',
  },
  {
    id: '43_geonet', label: 'GeoNet', symbol: '⏌',
    color: '#ef8410', motionType: 'flicker', group: 'seismic',
    type: 'point', description: 'GeoNet — Strong Motion & EQ Engineering',
    dataSource: 'https://www.geonet.org.nz/',
    sub: 'New Zealand geohazards',
  },
  {
    id: '43_geonet_data', label: 'GeoNet Data', symbol: '⏍',
    color: '#2ed7b7', motionType: 'radar', group: 'seismic',
    type: 'point', description: 'GeoNet Data — Strong Motion & EQ Engineering',
    dataSource: 'https://www.geonet.org.nz/data',
    sub: 'NZ geohazard data',
  },
  {
    id: '43_csn_chile', label: 'CSN Chile', symbol: '⏎',
    color: '#da31c8', motionType: 'pulse', group: 'seismic',
    type: 'point', description: 'CSN Chile — Strong Motion & EQ Engineering',
    dataSource: 'https://evtdb.csn.uchile.cl/',
    sub: 'Chile seismic data',
  },
  {
    id: '43_shakealert', label: 'ShakeAlert', symbol: '⏏',
    color: '#9add34', motionType: 'flicker', group: 'seismic',
    type: 'point', description: 'ShakeAlert — Strong Motion & EQ Engineering',
    dataSource: 'https://www.shakealert.org/',
    sub: 'Early earthquake warning',
  },
  {
    id: '43_usgs_shakemap', label: 'USGS ShakeMap', symbol: '⏐',
    color: '#376cdf', motionType: 'radar', group: 'seismic',
    type: 'point', description: 'USGS ShakeMap — Strong Motion & EQ Engineering',
    dataSource: 'https://earthquake.usgs.gov/data/shakemap/',
    sub: 'Shaking intensity maps',
  },
  {
    id: '43_usgs_dyfi', label: 'USGS DyFI', symbol: '⏑',
    color: '#e23a3e', motionType: 'pulse', group: 'seismic',
    type: 'point', description: 'USGS DyFI — Strong Motion & EQ Engineering',
    dataSource: 'https://earthquake.usgs.gov/data/dyfi/',
    sub: 'Earthquake felt reports',
  },
  // ── 44. (deleted) ──
  // ── 45. (deleted) ──
  // ── 46. (deleted) ──
  // ── 47. Coral Reefs & Marine Ecosystems ──
  // ── 48. (deleted) ──
  // ── 49. (deleted) ──
  // ── 50. Seafloor Mapping & Bathymetry ──
  {
    id: '50_emodnet_bathymetry_pt', label: 'EMODnet Bathymetry (Points)', symbol: '⏺',
    color: '#1d26b6', motionType: 'float', group: 'bathymetry_pt',
    type: 'point', description: 'EMODnet Bathymetry — Seafloor Mapping & Bathymetry',
    dataSource: 'https://emodnet.ec.europa.eu/bathymetry',
    sub: 'European bathymetry',
  },
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
  {
    id: '50_emodnet_chemistry', label: 'EMODnet Chemistry', symbol: '⏀',
    color: '#b61d65', motionType: 'glow', group: 'ocean',
    type: 'tile', description: 'EMODnet Chemistry — Nutrients, chlorophyll, dissolved oxygen concentrations, WMS',
    dataSource: 'https://ows.emodnet-chemistry.eu/wms',
    sub: 'Chemistry tiles',
  },
  {
    id: '50_globcolour', label: 'GlobColour Chlorophyll', symbol: '⏄',
    color: '#3db81e', motionType: 'float', group: 'ocean',
    type: 'tile', description: 'GlobColour — Global ocean chlorophyll concentration, 4km, 8-day composite, WMS',
    dataSource: 'https://hermes.acri.fr/cgi-bin/mapserv?map=/data/globcolour/wms/globcolour.map',
    sub: 'Chlorophyll tiles',
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
  // ── 70. InSAR & Ground Deformation ──
  {
    id: '70_comet', label: 'VIIRS Thermal Anomalies 375m', symbol: '≦',
    color: '#c50d71', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP Thermal Anomalies 375m All — InSAR & Ground Deformation',
    dataSource: 'https://comet.nerc.ac.uk/',
    sub: 'Earthquake geology data',
  },
  {
    id: '70_comet_licsar', label: 'MODIS Cloud Phase IR', symbol: '≧',
    color: '#48b623', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra Cloud Phase Infrared Day — InSAR & Ground Deformation',
    dataSource: 'https://comet.nerc.ac.uk/COMET-LiCS-portal/',
    sub: 'InSAR data',
  },
  {
    id: '70_licsar', label: 'MODIS Sea Ice Daily', symbol: '≨',
    color: '#2822bc', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'MODIS Terra L3 Sea Ice Daily — InSAR & Ground Deformation',
    dataSource: 'https://comet.nerc.ac.uk/COMET-LiCS-portal/',
    sub: 'InSAR data portal',
  },
  {
    id: '70_asf_sar_data', label: 'AIRS Carbon Monoxide', symbol: '≩',
    color: '#c25721', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'AIRS L2 Carbon Monoxide 500hPa Volume Mixing Ratio Day — InSAR & Ground Deformation',
    dataSource: 'https://asf.alaska.edu/',
    sub: 'Radar satellite data',
  },
  {
    id: '70_unavco_sar', label: 'MODIS NDSI Snow Cover', symbol: '≪',
    color: '#20c98a', motionType: 'breathe', group: 'satellite',
    type: 'tile', description: 'MODIS Terra NDSI Snow Cover — InSAR & Ground Deformation',
    dataSource: 'https://www.unavco.org/data/imaging/sar/',
    sub: 'SAR data',
  },
  {
    id: '70_squeesar', label: 'VIIRS Sea Surface Temp', symbol: '≫',
    color: '#c11fd0', motionType: 'glow', group: 'satellite',
    type: 'tile', description: 'VIIRS SNPP L2 Sea Surface Temperature Day — InSAR & Ground Deformation',
    dataSource: 'https://www.tre-altamira.com/',
    sub: 'Ground deformation',
  },
  {
    id: '70_mintpy', label: 'MODIS EVI 8-Day', symbol: '≬',
    color: '#b0d61e', motionType: 'orbit', group: 'satellite',
    type: 'tile', description: 'MODIS Terra EVI 8-Day — InSAR & Ground Deformation',
    dataSource: 'https://github.com/insarlab/MintPy',
    sub: 'InSAR processing',
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
    color: '#15e5b1', motionType: 'glow', group: 'atmosphere',
    type: 'point', description: 'NOAA Ovation aurora forecast',
    dataSource: '',
    sub: 'NOAA SWPC Ovation Model',
  },

  {
    id: 'smoke_dispersion', label: 'Smoke Dispersion', symbol: '⊁',
    color: '#a6ee18', motionType: 'flicker', group: 'weather',
    type: 'effect', description: 'Wind-driven plume from active fires',
    dataSource: '',
    sub: 'EONET active fire sources',
  },
  {
    id: 'wildfires', label: 'Wildfires', symbol: '⊂',
    color: '#1b6af0', motionType: 'dash', group: 'weather',
    type: 'point', description: 'Active fire detection from EONET',
    dataSource: '',
    sub: 'EONET fire events',
  },
  {
    id: 'severe_storms', label: 'Severe Storms', symbol: '⊃',
    color: '#d93744', motionType: 'wave', group: 'weather',
    type: 'point', description: 'Severe weather events from EONET',
    dataSource: '',
    sub: 'EONET storm events',
  },
  {
    id: 'volcanoes', label: 'Volcanoes', symbol: '⊄',
    color: '#3adc5c', motionType: 'flicker', group: 'weather',
    type: 'point', description: 'Volcanic activity from EONET',
    dataSource: '',
    sub: 'EONET volcano events',
  },
  {
    id: 'dust', label: 'Dust Storms', symbol: '⊆',
    color: '#e1c041', motionType: 'breathe', group: 'atmosphere',
    type: 'point', description: 'Dust storm events from EONET',
    dataSource: '',
    sub: 'EONET dust events',
  },
  {
    id: 'seaLakeIce', label: 'Icebergs & Sea Ice', symbol: '⊇',
    color: '#199ca9', motionType: 'float', group: 'cryosphere',
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
    type: 'tile', description: 'MODIS Combined Flood 1-Day from NASA GIBS',
    dataSource: '',
    badge: 'KEY',
  },
  {
    id: 'india_cctv', label: 'Live Webcams', symbol: '⊌',
    color: '#15c977', motionType: 'orbit', group: 'advanced',
    type: 'point', description: 'Open live public webcams worldwide',
    dataSource: '',
    badge: 'LIVE',
    sub: 'Open live public webcams worldwide',
  },
  {
    id: 'intel_feed', label: 'Intel Feed', symbol: '⊍',
    color: '#b113d0', motionType: 'pulse', group: 'advanced',
    type: 'panel', description: 'Real-time events from all sources',
    dataSource: '',
    badge: 'LIVE',
    sub: 'Aggregated alert feed',
  },
  {
    id: 'live_media', label: 'Live Media', symbol: '▶',
    color: '#ef4444', motionType: 'breathe', group: 'advanced',
    type: 'point', description: 'YouTube news videos auto-placed by geo extraction',
    dataSource: '',
    badge: 'LIVE',
    sub: 'YouTube news videos',
  },
  {
    id: 'population_impact', label: 'Population Impact Zones', symbol: '⊎',
    color: '#bed712', motionType: 'float', group: 'geospatial',
    type: 'polygon', description: '50-city population overlay',
    dataSource: '',
    sub: 'Major cities overlay',
  },
  {
    id: 'submarine_cables', label: 'Undersea Fiber Cables', symbol: '⊏',
    color: '#1188de', motionType: 'orbit', group: 'advanced',
    type: 'geojson', description: 'Global submarine cable network from Telegeography',
    dataSource: 'https://www.submarinecablemap.com/',
  },
  {
    id: 'animal_migrations', label: 'Animal Migrations', symbol: '⊐',
    color: '#e50f4d', motionType: 'breathe', group: 'ecology',
    type: 'point', description: 'Animal migration tracking from Movebank',
    dataSource: 'https://www.movebank.org/',
    sub: 'Movebank API',
  },
  {
    id: 'electricity_grid', label: 'Electricity Grid', symbol: '⊑',
    color: '#28d229', motionType: 'radar', group: 'advanced',
    type: 'point', description: 'Global electricity grid carbon intensity',
    dataSource: 'https://energydata.info/',
    sub: 'Energydata.info',
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
    type: 'tile', description: 'VIIRS Black Marble nighttime lights from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'aerosol_index', label: 'Aerosol Index', symbol: '⊔',
    color: '#2ddec8', motionType: 'glow', group: 'atmosphere',
    type: 'tile', description: 'OMPS Aerosol Index from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'dust_score', label: 'Dust Score', symbol: '⊕',
    color: '#e030c2', motionType: 'breathe', group: 'atmosphere',
    type: 'tile', description: 'MODIS Terra Aerosol optical thickness',
    dataSource: '',
  },
  {
    id: 'sea_ice', label: 'Sea Ice', symbol: '⊖',
    color: '#91e333', motionType: 'float', group: 'cryosphere',
    type: 'tile', description: 'AMSR2 sea ice concentration from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'temp_anomaly', label: 'Temperature Anomaly', symbol: '⊘',
    color: '#e7423a', motionType: 'breathe', group: 'atmosphere',
    type: 'tile', description: 'AIRS temperature anomaly from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'precipitation', label: 'Precipitation', symbol: '⊙',
    color: '#13ae48', motionType: 'flicker', group: 'weather',
    type: 'tile', description: 'IMERG precipitation from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'wind', label: 'Wind Speed', symbol: '⊚',
    color: '#7912b5', motionType: 'dash', group: 'weather',
    type: 'tile', description: 'Wind speed from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'pressure', label: 'Pressure', symbol: '⊛',
    color: '#bcae11', motionType: 'wave', group: 'weather',
    type: 'tile', description: 'GEOS pressure from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'co_index', label: 'CO Index', symbol: '⊜',
    color: '#109cc2', motionType: 'shimmer', group: 'atmosphere',
    type: 'tile', description: 'CAMS CO from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'so2_index', label: 'SO2 Index', symbol: '⊝',
    color: '#c90f6b', motionType: 'glow', group: 'atmosphere',
    type: 'tile', description: 'OMPS SO2 from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'land_cover', label: 'Land Cover', symbol: '⊞',
    color: '#35d00e', motionType: 'float', group: 'ecology',
    type: 'tile', description: 'MODIS land cover from NASA GIBS',
    dataSource: '',
  },
  {
    id: 'dt_buildings', label: 'Digital Twin Buildings', symbol: '⊟',
    color: '#3224bf', motionType: 'dash', group: 'geospatial',
    type: '3dtiles', description: 'OSM buildings digital twin',
    dataSource: '',
  },

  // ── NEW LAYERS: Energy & Resources (from Reference) ──
  {
    id: 'energy_chokepoints', label: 'Energy Chokepoints', symbol: '⧖',
    color: '#e63946', motionType: 'pulse', group: 'geospatial',
    type: 'point', description: 'Critical maritime energy chokepoints (Strait of Hormuz, Malacca, Suez, etc.)',
    dataSource: 'https://www.eia.gov/',
    sub: 'EIA Chokepoint Data',
    badge: 'KEY',
  },
  {
    id: 'energy_pipelines_oil', label: 'Oil Pipelines', symbol: '┃',
    color: '#2d2d2d', motionType: 'dash', group: 'geospatial',
    type: 'geojson', description: 'Global oil pipeline network — flow directions and capacity',
    dataSource: 'https://www.eia.gov/',
    sub: 'EIA Pipeline Data',
  },
  {
    id: 'energy_pipelines_gas', label: 'Gas Pipelines', symbol: '┃',
    color: '#457b9d', motionType: 'dash', group: 'geospatial',
    type: 'geojson', description: 'Global natural gas pipeline network — LNG and pipeline routes',
    dataSource: 'https://www.eia.gov/',
    sub: 'EIA Pipeline Data',
  },
  {
    id: 'energy_storage', label: 'Storage Facilities', symbol: '⬢',
    color: '#6d6875', motionType: 'breathe', group: 'geospatial',
    type: 'point', description: 'Oil and gas storage facilities — tank farms, LNG terminals',
    dataSource: 'https://www.eia.gov/',
    sub: 'EIA Storage Data',
  },
  {
    id: 'spr_levels', label: 'Strategic Petroleum Reserve', symbol: '◼',
    color: '#1d3557', motionType: 'glow', group: 'geospatial',
    type: 'panel', description: 'US SPR levels and release schedules — strategic reserve tracking',
    dataSource: 'https://www.energy.gov/',
    sub: 'SPR Data',
    badge: 'LIVE',
  },
  {
    id: 'refinery_utilization', label: 'Refinery Utilization', symbol: '⊡',
    color: '#e76f51', motionType: 'flicker', group: 'geospatial',
    type: 'panel', description: 'US refinery inputs and utilization rates — crude processing capacity',
    dataSource: 'https://www.eia.gov/',
    sub: 'EIA Refinery Data',
  },
  {
    id: 'eu_gas_storage', label: 'EU Gas Storage', symbol: '◧',
    color: '#264653', motionType: 'breathe', group: 'geospatial',
    type: 'point', description: 'European gas storage fill levels by country — energy security indicator',
    dataSource: 'https://agsi.gie.eu/',
    sub: 'GIE AGSI Data',
  },
  {
    id: 'electricity_prices', label: 'Electricity Prices', symbol: '⚡',
    color: '#f4a261', motionType: 'glow', group: 'geospatial',
    type: 'panel', description: 'European electricity spot prices by region — day-ahead market',
    dataSource: 'https://transparency.entsoe.eu/',
    sub: 'ENTSO-E Data',
  },
  {
    id: 'electricity_mix', label: 'Electricity Generation Mix', symbol: '⏻',
    color: '#2a9d8f', motionType: 'pulse', group: 'geospatial',
    type: 'panel', description: 'Country electricity generation by fuel type — fossil, renewable, nuclear shares',
    dataSource: 'https://ember-climate.org/',
    sub: 'Ember Climate Data',
  },
  {
    id: 'jodi_oil', label: 'JODI Oil Data', symbol: '▮',
    color: '#3d405b', motionType: 'wave', group: 'geospatial',
    type: 'panel', description: 'Joint Organisations Data Initiative — monthly oil supply/demand by country',
    dataSource: 'https://www.jodidb.org/',
    sub: 'JODI Oil',
  },
  {
    id: 'jodi_gas', label: 'JODI Gas Data', symbol: '▮',
    color: '#588157', motionType: 'wave', group: 'geospatial',
    type: 'panel', description: 'Joint Organisations Data Initiative — monthly gas supply/demand by country',
    dataSource: 'https://www.jodidb.org/',
    sub: 'JODI Gas',
  },
  {
    id: 'iea_oil_stocks', label: 'IEA Oil Stocks', symbol: '◫',
    color: '#bc6c25', motionType: 'breathe', group: 'geospatial',
    type: 'panel', description: 'IEA oil stock levels and days of cover — IEA obligation tracking',
    dataSource: 'https://www.iea.org/',
    sub: 'IEA Stocks',
  },
  {
    id: 'energy_intelligence', label: 'Energy Intelligence', symbol: '◉',
    color: '#9b2226', motionType: 'flicker', group: 'geospatial',
    type: 'panel', description: 'Aggregated energy sector intelligence — supply disruptions, policy changes',
    dataSource: 'Internal aggregation',
    sub: 'Energy Intel Feed',
    badge: 'LIVE',
  },
  {
    id: 'fuel_shortages', label: 'Fuel Shortages', symbol: '⚠',
    color: '#ae2012', motionType: 'pulse', group: 'geospatial',
    type: 'point', description: 'Reported fuel shortages and supply disruptions globally',
    dataSource: 'Multiple sources',
    sub: 'Fuel Shortage Alerts',
    badge: 'LIVE',
  },

  // ── NEW LAYERS: Risk & Security ──
  {
    id: 'cii_risk_scores', label: 'Country Instability Index', symbol: '◈',
    color: '#d62828', motionType: 'glow', group: 'geospatial',
    type: 'panel', description: 'Country Instability Index — composite risk scoring for 190+ countries',
    dataSource: 'Internal CII Model',
    sub: 'CII Risk Scores',
    badge: 'KEY',
  },
  {
    id: 'sanctions_pressure', label: 'Sanctions Pressure', symbol: '⊗',
    color: '#780000', motionType: 'contract', group: 'geospatial',
    type: 'point', description: 'Global sanctions regime — OFAC, EU, UN sanctions by country',
    dataSource: 'https://www.treasury.gov/',
    sub: 'OFAC/EU/UN Sanctions',
  },
  {
    id: 'sanctions_counts', label: 'Sanctions Entity Counts', symbol: '⊗',
    color: '#c1121f', motionType: 'flicker', group: 'geospatial',
    type: 'panel', description: 'Number of sanctioned entities per country — sanctions density map',
    dataSource: 'https://www.treasury.gov/',
    sub: 'Sanctions Entity Data',
  },
  {
    id: 'gpsjam', label: 'GPS Jamming', symbol: '⊞',
    color: '#e85d04', motionType: 'radar', group: 'geospatial',
    type: 'heatmap', description: 'GPS/GNSS jamming and spoofing events — aviation safety indicator',
    dataSource: 'https://gpsjam.org/',
    sub: 'GPS Jamming Data',
    badge: 'LIVE',
  },
  {
    id: 'military_bases', label: 'Military Bases', symbol: '▲',
    color: '#555555', motionType: 'glow', group: 'geospatial',
    type: 'point', description: 'Active military installations worldwide — bases, ports, airfields',
    dataSource: 'Open source intelligence',
    sub: 'Military Installations',
  },

  // ── NEW LAYERS: Conflict & Geopolitics ──
  {
    id: 'ucdp_conflict', label: 'Armed Conflict Events', symbol: '⚔',
    color: '#9d0208', motionType: 'pulse', group: 'geospatial',
    type: 'point', description: 'UCDP armed conflict events — battles, attacks, violence against civilians',
    dataSource: 'https://ucdp.uu.se/',
    sub: 'Uppsala Conflict Data Program',
    badge: 'LIVE',
  },
  {
    id: 'iran_events', label: 'Iran Regional Events', symbol: '◆',
    color: '#370617', motionType: 'flicker', group: 'geospatial',
    type: 'point', description: 'Iran-focused geopolitical events — military, protests, nuclear',
    dataSource: 'Multiple OSINT sources',
    sub: 'Iran Intel Feed',
    badge: 'LIVE',
  },
  {
    id: 'oref_alerts', label: 'Israel OREF Alerts', symbol: '⚠',
    color: '#dc2f02', motionType: 'pulse', group: 'geospatial',
    type: 'point', description: 'Israel Home Front Command rocket alerts — real-time threat data',
    dataSource: 'https://www.oref.org.il/',
    sub: 'OREF Alert System',
    badge: 'LIVE',
  },

  // ── NEW LAYERS: Climate & Environment ──
  {
    id: 'climate_anomalies', label: 'Climate Anomalies', symbol: '◐',
    color: '#ff7b00', motionType: 'shimmer', group: 'atmosphere',
    type: 'tile', description: 'Global temperature anomalies — departure from baseline average',
    dataSource: 'https://www.ncdc.noaa.gov/',
    sub: 'NOAA Climate Data',
  },
  {
    id: 'co2_monitoring', label: 'CO2 Monitoring', symbol: '◑',
    color: '#8ac926', motionType: 'breathe', group: 'atmosphere',
    type: 'tile', description: 'Atmospheric CO2 concentration — Mauna Loa and global stations',
    dataSource: 'https://gml.noaa.gov/',
    sub: 'NOAA GML CO2',
  },
  {
    id: 'ocean_ice', label: 'Ocean Ice Cover', symbol: '◒',
    color: '#caf0f8', motionType: 'contract', group: 'cryosphere',
    type: 'tile', description: 'Arctic and Antarctic sea ice extent — daily concentration maps',
    dataSource: 'https://nsidc.org/',
    sub: 'NSIDC Sea Ice',
  },
  {
    id: 'climate_news', label: 'Climate News Feed', symbol: '☰',
    color: '#52b788', motionType: 'float', group: 'geospatial',
    type: 'panel', description: 'Aggregated climate change news and reports — policy, science, impacts',
    dataSource: 'Multiple climate news sources',
    sub: 'Climate News Aggregator',
  },

  // ── NEW LAYERS: Displacement & Migration ──
  {
    id: 'displacement', label: 'Population Displacement', symbol: '◍',
    color: '#7209b7', motionType: 'wave', group: 'geospatial',
    type: 'panel', description: 'UNHCR and IDMC displacement data — refugees, IDPs, returns',
    dataSource: 'https://www.unhcr.org/',
    sub: 'UNHCR/IDMC Displacement',
    badge: 'KEY',
  },

  // ── NEW LAYERS: Infrastructure & Resilience ──
  {
    id: 'infra_outages', label: 'Infrastructure Outages', symbol: '⊘',
    color: '#5a189a', motionType: 'flicker', group: 'geospatial',
    type: 'point', description: 'Internet and power infrastructure outages — network disruptions',
    dataSource: 'https://radar.cloudflare.com/',
    sub: 'Cloudflare Radar / Downdetector',
    badge: 'LIVE',
  },
  {
    id: 'resilience_ranking', label: 'Country Resilience', symbol: ' ◈',
    color: '#3a0ca3', motionType: 'glow', group: 'geospatial',
    type: 'panel', description: 'Country infrastructure resilience ranking — supply chain robustness',
    dataSource: 'Internal resilience model',
    sub: 'Resilience Index',
  },
  {
    id: 'customs_trade', label: 'Customs & Trade Data', symbol: '▣',
    color: '#4361ee', motionType: 'wave', group: 'geospatial',
    type: 'panel', description: 'International customs and trade flow data — import/export volumes',
    dataSource: 'https://comtradeapi.un.org/',
    sub: 'UN Comtrade',
  },

  // ── NEW LAYERS: Markets & Economy ──
  {
    id: 'macro_signals', label: 'Macro Economic Signals', symbol: '◈',
    color: '#4895ef', motionType: 'pulse', group: 'geospatial',
    type: 'panel', description: 'Recession probability, yield curve, unemployment claims — macro regime detection',
    dataSource: 'https://fred.stlouisfed.org/',
    sub: 'FRED Economic Data',
    badge: 'KEY',
  },
  {
    id: 'prediction_markets', label: 'Prediction Markets', symbol: '◱',
    color: '#4cc9f0', motionType: 'float', group: 'geospatial',
    type: 'panel', description: 'Polymarket and Metaculus prediction odds — geopolitical and economic events',
    dataSource: 'https://polymarket.com/',
    sub: 'Polymarket/Metaculus',
  },
  {
    id: 'gold_data', label: 'Gold Markets', symbol: '◆',
    color: '#ffd60a', motionType: 'glow', group: 'geospatial',
    type: 'panel', description: 'Gold price, central bank reserves, ETF flows — safe haven indicator',
    dataSource: 'https://www.gold.org/',
    sub: 'World Gold Council',
  },

  // ── NEW LAYERS: Cyber ──
  {
    id: 'cyber_threats', label: 'Cyber Threat Intelligence', symbol: '⊘',
    color: '#7209b7', motionType: 'radar', group: 'geospatial',
    type: 'panel', description: 'Aggregated cyber threat indicators — malware, phishing, DDoS by region',
    dataSource: 'https://otx.alienvault.com/',
    sub: 'AlienVault OTX',
    badge: 'LIVE',
  },

  // ── NEW LAYERS: Health ──
  {
    id: 'air_quality_health', label: 'Health Air Quality', symbol: '◐',
    color: '#06d6a0', motionType: 'shimmer', group: 'atmosphere',
    type: 'heatmap', description: 'PM2.5 and AQI health impact data — WHO guideline exceedances',
    dataSource: 'https://www.who.int/',
    sub: 'WHO Air Quality',
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
  intel_feed: { badge: 'LIVE', sub: 'Aggregated alert feed' },
  live_media: { badge: 'LIVE', sub: 'YouTube news videos', on: true },
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
  floods: { sub: 'EONET flood events' },
  landslides: { sub: 'NASA landslide reports' },
  seaLakeIce: { sub: 'EONET sea ice events' },
  satnogs_db: { badge: 'LIVE', sub: 'SatNOGS transmitter frequencies', on: false },
  ucs_satellite_db: { badge: 'KEY', sub: 'UCS satellite metadata catalog', on: false },
};


export function getLayerById(id: string): LayerCategory | undefined {
  return LAYER_CATEGORIES.find(lc => lc.id === id);
}

export function getLayerColor(id: string): string | undefined {
  return getLayerById(id)?.color;
}
