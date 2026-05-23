/**
 * GENERATOR: Builds the complete layer config from working_links.md data.
 * Run: npx tsx scripts/generateLayerConfig.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/* ── Helpers ── */

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_+/g, '_');
}

function* goldenColorGen() {
  const golden = 137.508;
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const h = (i * golden) % 360;
    const s = 68 + (i % 14) * 1.5;
    const l = 38 + (i % 18) * 1.1;
    const hex = hslToHex(h / 360, s / 100, l / 100);
    if (!seen.has(hex)) { seen.add(hex); yield hex; }
  }
}
function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q-p)*6*t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q-p)*(2/3-t)*6;
    return p;
  };
  if (s === 0) { const v = Math.round(l*255).toString(16).padStart(2,'0'); return '#'+v+v+v; }
  const q2 = l < 0.5 ? l*(1+s) : l+s-l*s;
  const p2 = 2*l - q2;
  const toHex = (x: number) => Math.round(Math.min(255,Math.max(0,x*255))).toString(16).padStart(2,'0');
  return '#'+toHex(hue2rgb(p2,q2,h+1/3))+toHex(hue2rgb(p2,q2,h))+toHex(hue2rgb(p2,q2,h-1/3));
}

// Symbols reserved for group icons (must be unique across layers too)
const RESERVED_SYMBOLS = new Set([
  '⬡', '◈', '◆', '◇', '▣', '◉', '◎', '▦', '◰', '◐', '▤', '▥', '◒',
]);

// Build a large pool of unique Unicode geometric/math symbols (no emojis)
function buildSymbolPool(): string[] {
  const pool: string[] = [];

  // Helper: add a range [start, end] inclusive
  const add = (start: number, end: number) => {
    for (let cp = start; cp <= end; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!pool.includes(ch)) pool.push(ch);
    }
  };

  // Box Drawing U+2500-257F (128)
  add(0x2500, 0x257f);
  // Block Elements U+2580-259F (32)
  add(0x2580, 0x259f);
  // Geometric Shapes U+25A0-25FF (96)
  add(0x25a0, 0x25ff);
  // Miscellaneous Technical U+2300-23FF (256)
  add(0x2300, 0x23ff);
  // Mathematical Operators U+2200-22FF (256)
  add(0x2200, 0x22ff);
  // Supplemental Mathematical Operators U+2A00-2AFF (256)
  add(0x2a00, 0x2aff);
  // Arrows U+2190-21FF (112)
  add(0x2190, 0x21ff);
  // Supplemental Arrows-A U+27F0-27FF (16)
  add(0x27f0, 0x27ff);
  // Supplemental Arrows-B U+2900-297F (128)
  add(0x2900, 0x297f);
  // Misc Mathematical Symbols-B U+2980-29FF (128)
  add(0x2980, 0x29ff);
  // Misc Symbols and Arrows U+2B00-2BFF (256)
  add(0x2b00, 0x2bff);
  // Supplemental Punctuation U+2E00-2E7F (128)
  add(0x2e00, 0x2e7f);
  // CJK Symbols U+2FF0-2FFF (16)
  add(0x2ff0, 0x2fff);

  // Exclude reserved symbols
  return pool.filter(ch => !RESERVED_SYMBOLS.has(ch));
}
const GEOM_SYMBOLS = buildSymbolPool();

/* ── 71 Categories from working_links.md mapped to groups ── */

interface Section {
  num: number;
  title: string;
  group: string;
  entries: { name: string; url: string }[];
}

const SECTIONS: Section[] = [
  {
    num: 1, title: 'Maritime Data APIs', group: 'ocean',
    entries: [
      { name: 'AISStream', url: 'https://aisstream.io/' },
      { name: 'AISHub', url: 'https://www.aishub.net/' },
      { name: 'MarineCadastre', url: 'https://marinecadastre.gov/' },
      { name: 'USCG Navigation Center', url: 'https://www.navcen.uscg.gov/' },
      { name: 'OpenCPN Chart Sources', url: 'https://charts.noaa.gov/' },
      { name: 'Open Infrastructure Map', url: 'https://openinframap.org/' },
      { name: 'World Port Index', url: 'https://data.humdata.org/dataset/world-port-index' },
      { name: 'Global Ports DB', url: 'https://github.com/tayljordan/ports' },
      { name: 'Global Fishing Watch', url: 'https://globalfishingwatch.org/' },
    ],
  },
  {
    num: 2, title: 'Aviation & Flight Tracking', group: 'aviation',
    entries: [
      { name: 'ADSB.lol', url: 'https://adsb.lol/' },
      { name: 'adsb.fi', url: 'https://adsb.fi/' },
      { name: 'FlightAware AeroAPI', url: 'https://flightaware.com/commercial/aeroapi/' },
      { name: 'AirLabs API', url: 'https://airlabs.co/' },
      { name: 'OpenFlights', url: 'https://openflights.org/' },
    ],
  },
  {
    num: 3, title: 'Satellite Imagery & Earth Observation', group: 'satellite',
    entries: [
      { name: 'Planetary Computer STAC', url: 'https://planetarycomputer.microsoft.com/' },
      { name: 'AWS Earth Search', url: 'https://element84.com/' },
      { name: 'Copernicus Data Space', url: 'https://dataspace.copernicus.eu/' },
      { name: 'USGS EarthExplorer', url: 'https://earthexplorer.usgs.gov/' },
      { name: 'NASA Earthdata Search', url: 'https://search.earthdata.nasa.gov/' },
      { name: 'Google Earth Engine', url: 'https://earthengine.google.com/' },
      { name: 'USGS AppEEARS', url: 'https://appeears.earthdatacloud.nasa.gov/' },
      { name: 'NASA Worldview', url: 'https://worldview.earthdata.nasa.gov/' },
      { name: 'VEDA Dashboard', url: 'https://www.earthdata.nasa.gov/dashboard/' },
      { name: 'JAXA G-Portal', url: 'https://gportal.jaxa.jp/' },
      { name: 'JAXA Himawari Monitor', url: 'https://www.eorc.jaxa.jp/ptree/' },
      { name: 'NOAA GOES-R Series', url: 'https://www.goes-r.gov/' },
      { name: 'Landsat Look', url: 'https://landsatlook.usgs.gov/' },
      { name: 'Planet Labs Open Data', url: 'https://www.planet.com/open-data/' },
      { name: 'OpenAerialMap', url: 'https://openaerialmap.org/' },
      { name: 'Bhuvan (ISRO)', url: 'https://bhuvan.nrsc.gov.in/' },
      { name: 'AIR Centre EO Catalog', url: 'https://services.aircentre.org/eo-catalog/collections' },
      { name: 'ASTER GDEM', url: 'https://asterweb.jpl.nasa.gov/gdem.asp' },
      { name: 'SRTM', url: 'https://srtm.csi.cgiar.org/' },
      { name: 'GEBCO', url: 'https://www.gebco.net/' },
      { name: 'MODIS Web Services', url: 'https://modis.gsfc.nasa.gov/data/' },
      { name: 'VIIRS Active Fires', url: 'https://www.earthdata.nasa.gov/learn/find-data/near-real-time/firms' },
      { name: 'Global Surface Water Explorer', url: 'https://global-surface-water.appspot.com/' },
    ],
  },
  {
    num: 4, title: 'Weather & Climate APIs', group: 'weather',
    entries: [
      { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
      { name: 'National Weather Service', url: 'https://api.weather.gov/' },
      { name: 'OpenWeatherMap', url: 'https://openweathermap.org/' },
      { name: 'Meteostat', url: 'https://meteostat.net/' },
      { name: 'Weatherstack', url: 'https://weatherstack.com/' },
      { name: 'DWD Open Data', url: 'https://opendata.dwd.de/' },
      { name: 'Met Office DataPoint', url: 'https://www.metoffice.gov.uk/services/data/datapoint' },
      { name: 'ECMWF Copernicus CDS', url: 'https://cds.climate.copernicus.eu/' },
      { name: 'NOAA Climate Data Online', url: 'https://www.ncdc.noaa.gov/cdo-web/' },
      { name: 'CHIRPS Rainfall', url: 'https://www.chc.ucsb.edu/data/chirps' },
      { name: 'IMERG Rainfall', url: 'https://gpm.nasa.gov/data/imerg' },
      { name: 'GFS Forecast', url: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast' },
      { name: 'HRRR Model', url: 'https://rapidrefresh.noaa.gov/hrrr/' },
      { name: 'PERSIANN-CDR', url: 'https://chrsdata.eng.uci.edu/' },
      { name: 'RFE Rainfall', url: 'https://www.cpc.ncep.noaa.gov/products/fews/rfe.shtml' },
      { name: 'KNMI Climate Explorer', url: 'https://climexp.knmi.nl/' },
      { name: 'NASA POWER', url: 'https://power.larc.nasa.gov/' },
      { name: 'WorldClim', url: 'https://www.worldclim.org/' },
      { name: 'GHCN-Daily', url: 'https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily' },
      { name: 'ISMN', url: 'https://ismn.earth/en/' },
      { name: 'FLDAS', url: 'https://ldas.gsfc.nasa.gov/fldas/' },
      { name: 'C3S Seasonal Forecasts', url: 'https://climate.copernicus.eu/seasonal-forecasts' },
      { name: 'IRI Data Library', url: 'https://iridl.ldeo.columbia.edu/' },
      { name: 'OGIMET', url: 'https://www.ogimet.com/' },
      { name: 'Stormglass', url: 'https://stormglass.io/' },
      { name: 'Visual Crossing', url: 'https://www.visualcrossing.com/weather-api/' },
      { name: 'WeatherAPI.com', url: 'https://www.weatherapi.com/' },
      { name: 'RainViewer API', url: 'https://www.rainviewer.com/api.html' },
      { name: 'Meteoblue API', url: 'https://docs.meteoblue.com/' },
    ],
  },
  {
    num: 5, title: 'Natural Hazards & Disaster Alerts', group: 'hazards',
    entries: [
      { name: 'OpenFEMA', url: 'https://www.fema.gov/api/open' },
      { name: 'USGS Earthquake Hazards', url: 'https://earthquake.usgs.gov/earthquakes/search/' },
      { name: 'USGS Latest Earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/map/' },
      { name: 'IRIS Data Services', url: 'https://ds.iris.edu/' },
      { name: 'GEOFON', url: 'https://geofon.gfz-potsdam.de/' },
      { name: 'EMSC', url: 'https://www.emsc-csem.org/' },
      { name: 'INGV', url: 'https://www.ingv.it/' },
      { name: 'ISC', url: 'https://www.isc.ac.uk/' },
      { name: 'FDSN', url: 'https://www.fdsn.org/' },
      { name: 'ORFEUS', url: 'https://www.orfeus-eu.org/' },
      { name: 'GNS Science (NZ)', url: 'https://www.gns.cri.nz/' },
      { name: 'JMA', url: 'https://www.jma.go.jp/' },
      { name: 'PHIVOLCS', url: 'https://volcano.phivolcs.dost.gov.ph/' },
      { name: 'IGN (Spain)', url: 'https://www.ign.es/' },
      { name: 'BGS Earthquake Data', url: 'https://www.bgs.ac.uk/' },
      { name: 'GDACS', url: 'https://www.gdacs.org/' },
      { name: 'ReliefWeb', url: 'https://reliefweb.int/' },
      { name: 'Global Flood Database', url: 'https://global-flood-database.cloudtostreet.info/' },
      { name: 'EM-DAT', url: 'https://www.emdat.be/' },
      { name: 'DesInventar', url: 'https://www.desinventar.net/' },
      { name: 'NASA Disasters Portal', url: 'https://disasters.nasa.gov/' },
      { name: 'ThinkHazard!', url: 'https://thinkhazard.org/' },
      { name: 'INFORM Index', url: 'https://drmkc.jrc.ec.europa.eu/inform-index' },
      { name: 'OpenDRI', url: 'https://opendri.org/' },
      { name: 'UN OCHA HDX', url: 'https://data.humdata.org/' },
      { name: 'Copernicus EMS', url: 'https://emergency.copernicus.eu/' },
      { name: 'GLIDE', url: 'https://www.glidenumber.net/' },
      { name: 'NASA Landslide Portal', url: 'https://landslides.nasa.gov/' },
    ],
  },
  {
    num: 6, title: 'Space, Astronomy & Universe APIs', group: 'space',
    entries: [
      { name: 'NASA Open APIs', url: 'https://api.nasa.gov/' },
      { name: 'CelesTrak GP API', url: 'https://celestrak.org/' },
      { name: 'TheSpaceDevs (LL2)', url: 'https://thespacedevs.com/' },
      { name: 'N2YO API', url: 'https://www.n2yo.com/api/' },
      { name: 'Space-Track', url: 'https://www.space-track.org/' },
      { name: 'SIMBAD / NED', url: 'http://simbad.cds.unistra.fr/' },
      { name: 'SpaceX API', url: 'https://github.com/r-spacex/SpaceX-API' },
      { name: 'NASA GCN Kafka', url: 'https://gcn.nasa.gov/' },
      { name: 'Heavens-Above', url: 'https://www.heavens-above.com/' },
      { name: 'UCS Satellite DB', url: 'https://www.ucsusa.org/resources/satellite-database' },
      { name: 'ESA Space Debris', url: 'https://www.esa.int/Space_Safety/Space_Debris' },
      { name: 'NASA ODPO', url: 'https://www.orbitaldebris.jsc.nasa.gov/' },
      { name: 'LeoLabs', url: 'https://www.leolabs.space/' },
      { name: 'SatNOGS', url: 'https://satnogs.org/' },
      { name: 'SOCRATES', url: 'https://celestrak.org/SOCRATES/' },
      { name: 'Space-Track API', url: 'https://www.space-track.org/documentation' },
    ],
  },
  {
    num: 7, title: 'Webcams & Live Video Stream APIs', group: 'advanced',
    entries: [
      { name: 'Windy Webcams', url: 'https://api.windy.com/' },
      { name: 'OpenWebcamDB', url: 'https://openwebcamdb.com/' },
      { name: 'Webcams.travel', url: 'https://www.webcams.travel/' },
    ],
  },
  {
    num: 8, title: 'Geospatial, Demographics & Global Mapping', group: 'geospatial',
    entries: [
      { name: 'OSM Overpass', url: 'http://overpass-api.de/' },
      { name: 'OSM Nominatim', url: 'https://nominatim.org/' },
      { name: 'GeoNames', url: 'https://www.geonames.org/' },
      { name: 'OpenTopography', url: 'https://opentopography.org/' },
      { name: 'Openrouteservice', url: 'https://openrouteservice.org/' },
      { name: 'Natural Earth', url: 'https://www.naturalearthdata.com/' },
      { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' },
      { name: 'Geofabrik', url: 'https://www.geofabrik.de/' },
      { name: 'Overture Maps', url: 'https://overturemaps.org/' },
      { name: 'OpenAddresses', url: 'https://openaddresses.io/' },
      { name: 'OpenRailwayMap', url: 'https://www.openrailwaymap.org/' },
      { name: '3D City DB', url: 'https://www.3dcitydb.org/' },
      { name: 'GeoPlatform.gov', url: 'https://www.geoplatform.gov/' },
      { name: 'Data.gov', url: 'https://www.data.gov/' },
      { name: 'EU Open Data Portal', url: 'https://data.europa.eu/' },
      { name: 'World Bank Open Data', url: 'https://data.worldbank.org/' },
      { name: 'UN Data', url: 'https://data.un.org/' },
      { name: 'Humanitarian Data Exchange', url: 'https://data.humdata.org/' },
    ],
  },
  {
    num: 9, title: 'Atmosphere & Environmental Science', group: 'atmosphere',
    entries: [
      { name: 'OpenAQ', url: 'https://openaq.org/' },
      { name: 'World AQI API', url: 'https://aqicn.org/api/' },
      { name: 'Lightning Alerts (OpenWeather)', url: 'https://openweathermap.org/api/lightning' },
      { name: 'Copernicus Atmosphere', url: 'https://atmosphere.copernicus.eu/' },
      { name: 'NASA GMAO', url: 'https://gmao.gsfc.nasa.gov/' },
      { name: 'AIRS (NASA)', url: 'https://airs.jpl.nasa.gov/' },
      { name: 'OMI (NASA)', url: 'https://ozoneaq.gsfc.nasa.gov/' },
      { name: 'EPA AirData', url: 'https://www.epa.gov/outdoor-air-quality-data' },
      { name: 'AirNow API', url: 'https://www.airnowapi.org/' },
      { name: 'European Environment Agency', url: 'https://www.eea.europa.eu/' },
      { name: 'PurpleAir API', url: 'https://api.purpleair.com/' },
      { name: 'WAQI', url: 'https://waqi.info/' },
      { name: 'CAMS Global Reanalysis', url: 'https://ads.atmosphere.copernicus.eu/' },
      { name: 'HYSPLIT', url: 'https://www.ready.noaa.gov/' },
      { name: 'SILAM', url: 'https://silam.fmi.fi/' },
      { name: 'MACC', url: 'https://atmosphere.copernicus.eu/' },
      { name: 'TEMPO', url: 'https://tempo.si.edu/' },
      { name: 'Pandonia', url: 'https://www.pandonia-global-network.org/' },
    ],
  },
  {
    num: 10, title: 'Transit & Logistics', group: 'advanced',
    entries: [
      { name: 'Transitland API', url: 'https://www.transit.land/' },
    ],
  },
  {
    num: 11, title: 'Human Geography & Humanitarian Data', group: 'geospatial',
    entries: [
      { name: 'HDX', url: 'https://data.humdata.org/' },
      { name: 'WorldPop Database', url: 'https://www.worldpop.org/' },
    ],
  },
  {
    num: 12, title: 'Atmospheric Physics & Upper Air', group: 'weather',
    entries: [
      { name: 'Wyoming Soundings', url: 'http://weather.uwyo.edu/upperair/sounding.html' },
      { name: 'SPC Sounding Climatology', url: 'https://www.spc.noaa.gov/exper/soundings/' },
      { name: 'WWLLN', url: 'http://wwlln.net/' },
      { name: 'GLD360 (Vaisala)', url: 'https://www.vaisala.com/en/products/systems/lightning/gld360' },
      { name: 'SPC Severe Weather Data', url: 'https://www.spc.noaa.gov/wcm/' },
      { name: 'NHC Tropical Cyclone Data', url: 'https://www.nhc.noaa.gov/data/' },
      { name: 'IBTrACS', url: 'https://www.ncei.noaa.gov/products/international-best-track-archive' },
      { name: 'NCEP/NCAR Reanalysis', url: 'https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html' },
    ],
  },
  {
    num: 13, title: 'Carbon Cycle, GHG & Methane', group: 'atmosphere',
    entries: [
      { name: 'GOSAT', url: 'https://www.gosat.nies.go.jp/' },
      { name: 'GOSAT-2', url: 'https://www.gosat-2.nies.go.jp/' },
      { name: 'TCCON', url: 'https://tccondata.org/' },
      { name: 'NOAA Global Monitoring Lab', url: 'https://gml.noaa.gov/' },
      { name: 'ICOS', url: 'https://www.icos-cp.eu/' },
      { name: 'FLUXNET', url: 'https://fluxnet.org/' },
      { name: 'AmeriFlux', url: 'https://ameriflux.lbl.gov/' },
      { name: 'EDGAR', url: 'https://edgar.jrc.ec.europa.eu/' },
    ],
  },
  {
    num: 14, title: 'Urban Systems & Population', group: 'geospatial',
    entries: [
      { name: 'WorldPop', url: 'https://www.worldpop.org/' },
      { name: 'GHSL', url: 'https://ghsl.jrc.ec.europa.eu/' },
      { name: 'LandScan', url: 'https://landscan.ornl.gov/' },
      { name: 'Facebook Data for Good', url: 'https://dataforgood.facebook.com/' },
      { name: 'Overture Maps Buildings', url: 'https://overturemaps.org/' },
      { name: 'Microsoft Building Footprints', url: 'https://github.com/microsoft/GlobalMLBuildingFootprints' },
    ],
  },
  {
    num: 15, title: 'Health & Environmental Exposure', group: 'advanced',
    entries: [
      { name: 'CDC WONDER', url: 'https://wonder.cdc.gov/' },
      { name: 'WHO Global Health Observatory', url: 'https://www.who.int/data/gho' },
      { name: 'Global Heat Health Info', url: 'https://ghhin.org/' },
      { name: 'National Allergy Bureau', url: 'https://www.aaaai.org/nab' },
      { name: 'OpenAQ Health', url: 'https://openaq.org/' },
      { name: 'HealthMap', url: 'https://www.healthmap.org/' },
      { name: 'VectorBase', url: 'https://vectorbase.org/' },
      { name: 'Malaria Atlas Project', url: 'https://malariaatlas.org/' },
    ],
  },
  {
    num: 16, title: 'Paleoclimate & Deep Time', group: 'geology',
    entries: [
      { name: 'NOAA Paleoclimatology', url: 'https://www.ncei.noaa.gov/products/paleoclimatology' },
      { name: 'PAGES', url: 'https://pastglobalchanges.org/' },
      { name: 'Neotoma', url: 'https://www.neotomadb.org/' },
      { name: 'WDC Paleoclimatology', url: 'https://www.ncei.noaa.gov/access/paleo-search/' },
      { name: 'ITRDB', url: 'https://www.ncei.noaa.gov/products/paleoclimatology/tree-ring' },
      { name: 'SISAL', url: 'https://pastglobalchanges.org/science/wg/sisal/intro' },
      { name: 'PANGAEA', url: 'https://www.pangaea.de/' },
      { name: 'Macrostrat', url: 'https://macrostrat.org/' },
      { name: 'PBDB', url: 'https://paleobiodb.org/' },
      { name: 'GeoDeepDive', url: 'https://geodeepdive.org/' },
    ],
  },
  {
    num: 17, title: 'Geophysics & Gravity', group: 'geology',
    entries: [
      { name: 'IGRF Model', url: 'https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html' },
      { name: 'WMM', url: 'https://www.ngdc.noaa.gov/geomag/WMM/' },
      { name: 'EMM2017', url: 'https://www.ngdc.noaa.gov/geomag/EMM/' },
      { name: 'WDMAM', url: 'https://wdmam.org/' },
      { name: 'IGFS', url: 'https://www.igfs.net/' },
      { name: 'EGM2008', url: 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84' },
      { name: 'EIGEN', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'GOCE', url: 'https://earth.esa.int/eogateway/missions/goce' },
      { name: 'GMRT', url: 'https://www.gmrt.org/' },
      { name: 'Crust 1.0', url: 'https://igppweb.ucsd.edu/~gabi/crust1.html' },
      { name: 'LITHO1.0', url: 'https://igppweb.ucsd.edu/~gabi/litho1.0.html' },
    ],
  },
  {
    num: 18, title: 'Natural Resources & Energy', group: 'geology',
    entries: [
      { name: 'USGS Mineral Resources', url: 'https://mrdata.usgs.gov/' },
      { name: 'NGDS', url: 'https://gdr.openei.org/' },
      { name: 'BOEM Data Center', url: 'https://www.boem.gov/renewable-energy/mapping-and-data' },
      { name: 'OpenEI', url: 'https://openei.org/' },
      { name: 'NREL Geothermal Prospector', url: 'https://maps.nrel.gov/geothermal-prospector/' },
      { name: 'Petrel Open Data', url: 'https://github.com/equinor/seismic-zfp' },
    ],
  },
  {
    num: 19, title: 'Coastal & Wetland Systems', group: 'ecology',
    entries: [
      { name: 'Global Mangrove Watch', url: 'https://www.globalmangrovewatch.org/' },
      { name: 'Digital Coast (NOAA)', url: 'https://coast.noaa.gov/digitalcoast/' },
      { name: 'SeagrassWatch', url: 'https://www.seagrasswatch.org/' },
      { name: 'Wetlands International', url: 'https://www.wetlands.org/' },
      { name: 'RAMSAR Sites', url: 'https://rsis.ramsar.org/' },
      { name: 'Coastal Wetland Inventory', url: 'https://www.fws.gov/program/national-wetlands-inventory' },
      { name: 'Global Wetlands Map', url: 'https://www2.cifor.org/global-wetlands/' },
      { name: 'Coastal Relief Model', url: 'https://www.ngdc.noaa.gov/mgg/coastal/' },
    ],
  },
  {
    num: 20, title: 'Wildlife & Acoustics', group: 'ecology',
    entries: [
      { name: 'Movebank API', url: 'https://github.com/movebank/movebank-api-doc' },
      { name: 'eBird', url: 'https://ebird.org/' },
      { name: 'eBird Basic Dataset', url: 'https://ebird.org/science/download-ebird-data-products' },
      { name: 'iNaturalist', url: 'https://www.inaturalist.org/' },
      { name: 'OBIS', url: 'https://obis.org/' },
      { name: 'NOAA Passive Acoustics', url: 'https://www.ncei.noaa.gov/maps/passive_acoustic_data/' },
      { name: 'xeno-canto', url: 'https://www.xeno-canto.org/' },
      { name: 'Macaulay Library', url: 'https://www.macaulaylibrary.org/' },
      { name: 'Wildlife Insights', url: 'https://www.wildlifeinsights.org/' },
    ],
  },
  {
    num: 21, title: 'Severe Weather & Storms', group: 'weather',
    entries: [
      { name: 'NHC GIS Data', url: 'https://www.nhc.noaa.gov/gis/' },
      { name: 'IBTrACS', url: 'https://www.ncei.noaa.gov/products/international-best-track-archive' },
      { name: 'SPC Storm Events', url: 'https://www.spc.noaa.gov/wcm/' },
      { name: 'SPC Mesoscale Analysis', url: 'https://www.spc.noaa.gov/exper/mesoanalysis/' },
      { name: 'NCEI Storm Events', url: 'https://www.ncei.noaa.gov/access/search/data-search/severe-weather' },
      { name: 'NEXRAD Radar (AWS)', url: 'https://registry.opendata.aws/noaa-nexrad/' },
      { name: 'Tornado History Project', url: 'https://www.tornadohistoryproject.com/' },
      { name: 'ESWD', url: 'https://www.eswd.eu/' },
      { name: 'Tropical Tidbits', url: 'https://www.tropicaltidbits.com/' },
      { name: 'HURDAT2', url: 'https://www.aoml.noaa.gov/hrd/hurdat/' },
    ],
  },
  {
    num: 22, title: 'Soil Science & Geochemistry', group: 'geology',
    entries: [
      { name: 'ISRIC World Soil Info', url: 'https://www.isric.org/' },
      { name: 'SoilGrids', url: 'https://www.isric.org/explore/soilgrids' },
      { name: 'HWSD', url: 'http://www.fao.org/soils-portal/data-hub/' },
      { name: 'WoSIS', url: 'https://www.isric.org/explore/wosis' },
      { name: 'ICE-D', url: 'https://www.ice-d.org/' },
    ],
  },
  {
    num: 23, title: 'Planetary Defense & NEOs', group: 'space',
    entries: [
      { name: 'NASA CNEOS', url: 'https://cneos.jpl.nasa.gov/' },
      { name: 'CNEOS Scout', url: 'https://cneos.jpl.nasa.gov/scout/' },
      { name: 'CNEOS Sentry', url: 'https://cneos.jpl.nasa.gov/sentry/' },
      { name: 'CNEOS Fireball Data', url: 'https://cneos.jpl.nasa.gov/fireballs/' },
      { name: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
      { name: 'MPC', url: 'https://www.minorplanetcenter.net/' },
      { name: 'NEODyS', url: 'https://newton.spacedys.com/neodys/' },
      { name: 'ESA NEO CC', url: 'https://neo.ssa.esa.int/' },
      { name: 'IMO', url: 'https://www.imo.net/' },
    ],
  },
  {
    num: 24, title: 'Ionospheric & Radio Propagation', group: 'space',
    entries: [
      { name: 'GIRO', url: 'https://giro.uml.edu/' },
      { name: 'GIRO DriftBase', url: 'https://ulcar.uml.edu/DriftBase/' },
      { name: 'IGS Ionosphere WG', url: 'https://igs.org/products/ionosphere/' },
      { name: 'Madrigal Database', url: 'https://cedar.openmadrigal.org/' },
      { name: 'SuperDARN', url: 'https://superdarn.jhuapl.edu/' },
      { name: 'AMPERE', url: 'https://ampere.jhuapl.edu/' },
    ],
  },
  {
    num: 25, title: 'Geodesy & GNSS', group: 'advanced',
    entries: [
      { name: 'IGS', url: 'https://igs.org/' },
      { name: 'IGS Data Center', url: 'https://cddis.nasa.gov/' },
      { name: 'UNAVCO Data Archive', url: 'https://www.unavco.org/data/' },
      { name: 'NGS CORS', url: 'https://geodesy.noaa.gov/CORS/' },
      { name: 'EUREF', url: 'https://www.epncb.oma.be/' },
      { name: 'SIRGAS', url: 'https://www.sirgas.org/' },
      { name: 'ITRF', url: 'https://itrf.ign.fr/' },
      { name: 'SONEL', url: 'https://www.sonel.org/' },
      { name: 'EPOS-GNSS', url: 'https://www.epos-eu.org/' },
      { name: 'ILRS', url: 'https://ilrs.gsfc.nasa.gov/' },
      { name: 'ILRS Data Products', url: 'https://ilrs.gsfc.nasa.gov/data_and_products/products/index.html' },
      { name: 'IVS', url: 'https://ivscc.gsfc.nasa.gov/' },
      { name: 'IVS Data Products', url: 'https://ivscc.gsfc.nasa.gov/products-data/index.html' },
      { name: 'CDDIS', url: 'https://cddis.nasa.gov/' },
      { name: 'PBO H2O', url: 'https://www.unavco.org/data/gps-gnss/derived-products/pbo-h2o/documentation/documentation.html' },
    ],
  },
  {
    num: 26, title: 'Drought & Food Security', group: 'weather',
    entries: [
      { name: 'FEWS NET', url: 'https://fews.net/' },
      { name: 'FEWS NET Data Portal', url: 'https://fews.net/data/agroclimatology-data' },
      { name: 'USGS FEWS NET', url: 'https://earlywarning.usgs.gov/' },
      { name: 'NASA FEWS NET', url: 'https://earlywarning.usgs.gov/fews' },
      { name: 'US Drought Monitor', url: 'https://droughtmonitor.unl.edu/' },
      { name: 'NA Drought Monitor', url: 'https://droughtmonitor.unl.edu/NADM/' },
      { name: 'Global Drought Observatory', url: 'https://edo.jrc.ec.europa.eu/' },
      { name: 'SPEI Global Drought', url: 'https://spei.csic.es/' },
      { name: 'FAO GIEWS', url: 'https://www.fao.org/giews/' },
      { name: 'Harvest2Market', url: 'https://fews.net/data/agroclimatology-data' },
    ],
  },
  {
    num: 27, title: 'Water Quality & HABs', group: 'ocean',
    entries: [
      { name: 'USGS NAWQA', url: 'https://nawqatrends.wim.usgs.gov/swtrends' },
      { name: 'Water Quality Portal', url: 'https://www.waterqualitydata.us/' },
      { name: 'EPA STORET/WQX', url: 'https://www.epa.gov/waterdata/storage-and-retrieval-and-water-quality-exchange' },
      { name: 'NOAA HAB Forecasting', url: 'https://coastalscience.noaa.gov/research/hab/' },
      { name: 'MERIS/OLCI Color', url: 'https://oceancolor.gsfc.nasa.gov/' },
      { name: 'GEMStat', url: 'https://gemstat.org/' },
      { name: 'Lake Water Quality', url: 'https://www.epa.gov/national-aquatic-resource-surveys' },
    ],
  },
  {
    num: 28, title: 'Snow & Avalanche', group: 'cryosphere',
    entries: [
      { name: 'NSIDC Snow Today', url: 'https://nsidc.org/snow-today' },
      { name: 'Rutgers Global Snow Lab', url: 'https://climate.rutgers.edu/snowcover/' },
      { name: 'GlobSnow', url: 'https://www.globsnow.info/' },
      { name: 'Avalanche.org', url: 'https://www.avalanche.org/' },
      { name: 'Canadian Ice Service', url: 'https://www.canada.ca/en/environment-climate-change/services/ice-forecasts-observations.html' },
      { name: 'Great Lakes Ice', url: 'https://www.glerl.noaa.gov/data/ice/' },
    ],
  },
  {
    num: 29, title: 'Volcanic Hazards & Ash', group: 'aviation',
    entries: [
      { name: 'Tokyo VAAC', url: 'https://ds.data.jma.go.jp/svd/vaac/data/' },
      { name: 'Anchorage VAAC', url: 'https://www.weather.gov/vaac/' },
      { name: 'Washington VAAC', url: 'https://www.nhc.noaa.gov/' },
      { name: 'WOVOdat', url: 'https://www.wovodat.org/' },
      { name: 'NASA SO2 Monitoring', url: 'https://so2.gsfc.nasa.gov/' },
      { name: 'NOAA SO2 Portal', url: 'https://satepsanone.nesdis.noaa.gov/pub/OMI/OMISO2/' },
      { name: 'Volcano Discovery', url: 'https://www.volcanodiscovery.com/' },
    ],
  },
  {
    num: 30, title: 'Ocean Biogeochemistry', group: 'ocean',
    entries: [
      { name: 'SOCAT', url: 'https://www.socat.info/' },
      { name: 'GLODAP', url: 'https://www.glodap.info/' },
      { name: 'GOA-ON', url: 'https://www.goa-on.org/' },
      { name: 'WOD', url: 'https://www.ncei.noaa.gov/products/world-ocean-database' },
      { name: 'WOA', url: 'https://www.ncei.noaa.gov/products/world-ocean-atlas' },
      { name: 'GEOTRACES', url: 'https://www.geotraces.org/' },
      { name: 'EMODnet Chemistry', url: 'https://ec.oceanbrowser.net/emodnet/' },
      { name: 'The Ocean Cleanup', url: 'https://theoceancleanup.com/research/' },
      { name: 'Jambeck Plastic', url: 'https://jambeck.engr.uga.edu/' },
      { name: 'Seafloor Litter', url: 'https://emodnet.ec.europa.eu/geoviewer/' },
    ],
  },
  {
    num: 31, title: 'Ocean & Marine Data', group: 'ocean',
    entries: [
      { name: 'HYCOM', url: 'https://www.hycom.org/' },
      { name: 'Copernicus Marine', url: 'https://marine.copernicus.eu/' },
      { name: 'ARGO Floats', url: 'https://argo.ucsd.edu/' },
      { name: 'NOAA Tides & Currents', url: 'https://tidesandcurrents.noaa.gov/' },
      { name: 'IOOS', url: 'https://ioos.noaa.gov/data/' },
      { name: 'EMODnet', url: 'https://emodnet.ec.europa.eu/' },
      { name: 'OBIS', url: 'https://obis.org/' },
      { name: 'SeaDataNet', url: 'https://www.seadatanet.org/' },
      { name: 'NOAA Coral Reef Watch', url: 'https://coralreefwatch.noaa.gov/' },
      { name: 'Ocean Color Web', url: 'https://oceancolor.gsfc.nasa.gov/' },
      { name: 'GHRSST', url: 'https://www.ghrsst.org/' },
      { name: 'AVISO+', url: 'https://www.aviso.altimetry.fr/' },
      { name: 'CMEMS', url: 'https://marine.copernicus.eu/' },
      { name: 'GEBCO Grid', url: 'https://www.gebco.net/data_and_products/gridded_bathymetry_data/' },
      { name: 'IHO Data Centre', url: 'https://iho.int/' },
      { name: 'NOAA SWFS', url: 'https://www.fisheries.noaa.gov/' },
      { name: 'PacIOOS', url: 'https://www.pacioos.hawaii.edu/' },
      { name: 'JCOMMOPS', url: 'https://www.jcommops.org/' },
    ],
  },
  {
    num: 32, title: 'Hydrology & Water Resources', group: 'advanced',
    entries: [
      { name: 'USGS Water Data', url: 'https://api.waterdata.usgs.gov/' },
      { name: 'USGS Water Services', url: 'https://waterservices.usgs.gov/' },
      { name: 'GRDC', url: 'https://portal.grdc.bafg.de/' },
      { name: 'HydroSHEDS', url: 'https://www.hydrosheds.org/' },
      { name: 'SMAP (NASA)', url: 'https://smap.jpl.nasa.gov/' },
      { name: 'FLDAS Soil Moisture', url: 'https://ldas.gsfc.nasa.gov/fldas/' },
      { name: 'GLDAS', url: 'https://ldas.gsfc.nasa.gov/gldas/' },
      { name: 'GRACE-FO', url: 'https://grace.jpl.nasa.gov/' },
      { name: 'AQUASTAT', url: 'https://www.fao.org/aquastat/' },
      { name: 'CUAHSI HydroShare', url: 'https://www.hydroshare.org/' },
      { name: 'WRI Aqueduct', url: 'https://www.wri.org/aqueduct' },
      { name: 'OpenAgua', url: 'https://www.openagua.org/' },
      { name: 'iRain', url: 'https://irain.eng.uci.edu/' },
    ],
  },
  {
    num: 33, title: 'Space Weather & Solar', group: 'space',
    entries: [
      { name: 'NOAA SWPC API', url: 'https://services.swpc.noaa.gov/' },
      { name: 'DSCOVR Real-Time', url: 'https://www.swpc.noaa.gov/products/real-time-solar-wind' },
      { name: 'ACE Real-Time', url: 'https://izw1.caltech.edu/ACE/ASC/rtsw.html' },
      { name: 'NASA CDAWeb', url: 'https://cdaweb.gsfc.nasa.gov/' },
      { name: 'LASP Portal', url: 'https://lasp.colorado.edu/space-weather-portal/' },
      { name: 'NASA iSWA', url: 'https://iswa.gsfc.nasa.gov/' },
      { name: 'SDO', url: 'https://sdo.gsfc.nasa.gov/' },
      { name: 'SOHO', url: 'https://soho.nascom.nasa.gov/' },
      { name: 'STEREO', url: 'https://stereo.gsfc.nasa.gov/' },
      { name: 'JHelioviewer', url: 'https://www.jhelioviewer.org/' },
      { name: 'Helioviewer', url: 'https://helioviewer.org/' },
      { name: 'SunPy', url: 'https://sunpy.org/' },
      { name: 'Virtual Solar Obs', url: 'https://sdac.virtualsolar.org/' },
      { name: 'NOAA NGDC SW', url: 'https://www.ngdc.noaa.gov/stp/space-weather/' },
      { name: 'USGS Geomagnetism', url: 'https://geomag.usgs.gov/' },
      { name: 'INTERMAGNET', url: 'https://www.intermagnet.org/' },
      { name: 'SuperMAG', url: 'https://supermag.jhuapl.edu/' },
      { name: 'OMNIWeb', url: 'https://omniweb.gsfc.nasa.gov/' },
      { name: 'CCMC', url: 'https://ccmc.gsfc.nasa.gov/' },
      { name: 'SAMPEX', url: 'https://lasp.colorado.edu/home/sampex/' },
      { name: 'MMS Science Data', url: 'https://lasp.colorado.edu/mms/sdc/' },
    ],
  },
  {
    num: 34, title: 'Cryosphere & Ice', group: 'cryosphere',
    entries: [
      { name: 'NSIDC', url: 'https://nsidc.org/' },
      { name: 'Arctic Data Explorer', url: 'https://nsidc.org/arcticseaicenews/' },
      { name: 'Global Cryosphere Watch', url: 'https://globalcryospherewatch.org/' },
      { name: 'WGMS', url: 'https://wgms.ch/' },
      { name: 'RGI', url: 'https://www.glims.org/RGI/' },
      { name: 'GLIMS', url: 'https://www.glims.org/' },
      { name: 'ICESat-2', url: 'https://icesat-2.gsfc.nasa.gov/' },
      { name: 'CryoSat-2', url: 'https://earth.esa.int/eogateway/missions/cryosat' },
      { name: 'Operation IceBridge', url: 'https://icebridge.gsfc.nasa.gov/' },
      { name: 'OSI SAF', url: 'https://osi-saf.eumetsat.int/' },
      { name: 'Polar View', url: 'https://www.polarview.org/' },
      { name: 'GTN-P', url: 'https://gtnp.arcticportal.org/' },
      { name: 'Iceberg Tracker', url: 'https://www.icebergfinder.com/' },
      { name: 'Snow Today', url: 'https://nsidc.org/snow-today' },
    ],
  },
  {
    num: 35, title: 'Geology & Geodesy', group: 'geology',
    entries: [
      { name: 'Macrostrat', url: 'https://macrostrat.org/' },
      { name: 'BGS', url: 'https://www.bgs.ac.uk/' },
      { name: 'IGRF', url: 'https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html' },
      { name: 'WMM', url: 'https://www.ngdc.noaa.gov/geomag/WMM/' },
      { name: 'INTERMAGNET Data', url: 'https://intermagnet.github.io/' },
      { name: 'EarthScope', url: 'https://www.earthscope.org/' },
      { name: 'SOPAC', url: 'http://sopac-csrc.ucsd.edu/' },
      { name: 'EPOS', url: 'https://www.epos-eu.org/' },
      { name: 'GFZ Data Services', url: 'https://dataservices.gfz-potsdam.de/' },
      { name: 'NGDC Data', url: 'https://www.ngdc.noaa.gov/' },
    ],
  },
  {
    num: 36, title: 'Biodiversity & Land Cover', group: 'ecology',
    entries: [
      { name: 'iNaturalist', url: 'https://www.inaturalist.org/' },
      { name: 'Map of Life', url: 'https://mol.org/' },
      { name: 'MODIS Land Cover', url: 'https://modis.gsfc.nasa.gov/data/dataprod/mod12.php' },
      { name: 'Copernicus Land Service', url: 'https://land.copernicus.eu/' },
      { name: 'Harmonized World Soil DB', url: 'https://www.fao.org/soils-portal/data-hub/' },
      { name: 'OpenLandMap', url: 'https://openlandmap.org/' },
      { name: 'EarthEnv', url: 'https://www.earthenv.org/' },
      { name: 'CHELSA', url: 'https://chelsa-climate.org/' },
      { name: 'EcoData Retriever', url: 'https://ecodataretriever.org/' },
      { name: 'NEON', url: 'https://www.neonscience.org/' },
      { name: 'LTER Network', url: 'https://lternet.edu/' },
      { name: 'ALA', url: 'https://www.ala.org.au/' },
      { name: 'Global Forest Watch', url: 'https://www.globalforestwatch.org/' },
    ],
  },
  {
    num: 37, title: 'GIS & Geospatial Platforms', group: 'geospatial',
    entries: [
      { name: 'Open Data Kit', url: 'https://opendatakit.org/' },
      { name: 'QGIS', url: 'https://qgis.org/' },
      { name: 'GeoServer', url: 'http://geoserver.org/' },
      { name: 'MapServer', url: 'https://mapserver.org/' },
      { name: 'GeoNode', url: 'https://geonode.org/' },
      { name: 'GeoNetwork', url: 'https://geonetwork-opensource.org/' },
      { name: 'OpenLayers', url: 'https://openlayers.org/' },
      { name: 'Leaflet', url: 'https://leafletjs.com/' },
      { name: 'CesiumJS', url: 'https://cesium.com/' },
      { name: 'GDAL', url: 'https://gdal.org/' },
      { name: 'PostGIS', url: 'https://postgis.net/' },
    ],
  },
  {
    num: 38, title: 'Agriculture & Food Security', group: 'weather',
    entries: [
      { name: 'FAO FAOSTAT', url: 'https://www.fao.org/faostat/' },
      { name: 'USDA NASS', url: 'https://quickstats.nass.usda.gov/' },
      { name: 'Crop Monitor', url: 'https://cropmonitor.org/' },
      { name: 'GEOGLAM', url: 'https://www.geoglam.org/' },
      { name: 'NASA Harvest', url: 'https://nasaharvest.org/' },
      { name: 'GLAM', url: 'https://glam1.gsfc.nasa.gov/' },
      { name: 'USDA CropScape', url: 'https://nassgeodata.gmu.edu/CropScape/' },
      { name: 'WAPOR', url: 'https://wapor.apps.fao.org/' },
      { name: 'EarthStat', url: 'http://www.earthstat.org/' },
      { name: 'AMIS', url: 'https://www.amis-outlook.org/' },
    ],
  },
  {
    num: 39, title: 'Energy & Infrastructure', group: 'advanced',
    entries: [
      { name: 'Global Solar Atlas', url: 'https://globalsolaratlas.info/' },
      { name: 'Global Wind Atlas', url: 'https://globalwindatlas.info/' },
      { name: 'OpenEI', url: 'https://openei.org/' },
      { name: 'NREL Data Catalog', url: 'https://data.nrel.gov/' },
      { name: 'EIA Open Data', url: 'https://www.eia.gov/opendata/' },
      { name: 'OSM Power', url: 'https://wiki.openstreetmap.org/wiki/Power' },
      { name: 'GRID3', url: 'https://grid3.org/' },
      { name: 'Energydata.info', url: 'https://energydata.info/' },
    ],
  },
  {
    num: 40, title: 'Aerosol & Radiation', group: 'atmosphere',
    entries: [
      { name: 'MPLNET', url: 'https://mplnet.gsfc.nasa.gov/' },
      { name: 'BSRN', url: 'https://bsrn.awi.de/' },
      { name: 'ARM Data Center', url: 'https://www.arm.gov/' },
      { name: 'ARM Data Discovery', url: 'https://adc.arm.gov/armlive/' },
      { name: 'SURFRAD', url: 'https://gml.noaa.gov/grad/surfrad/' },
      { name: 'GAW', url: 'https://gawsis.meteoswiss.ch/' },
    ],
  },
  {
    num: 41, title: 'Phenology & Ecosystems', group: 'ecology',
    entries: [
      { name: 'PhenoCam Network', url: 'https://phenocam.nau.edu/webcam/' },
      { name: 'PhenoCam Data', url: 'https://phenocam.nau.edu/webcam/gallery/' },
      { name: 'NEON', url: 'https://www.neonscience.org/' },
      { name: 'NEON Data Portal', url: 'https://data.neonscience.org/' },
      { name: 'LTAR Network', url: 'https://ltar.ars.usda.gov/' },
      { name: 'CZO Network', url: 'https://criticalzone.org/' },
      { name: 'CZO Data Portal', url: 'https://criticalzone.org/data/' },
      { name: 'AmeriFlux', url: 'https://ameriflux.lbl.gov/' },
      { name: 'AmeriFlux Data', url: 'https://ameriflux.lbl.gov/data/download-data/' },
      { name: 'ICOS', url: 'https://www.icos-cp.eu/' },
      { name: 'FLUXNET', url: 'https://fluxnet.org/' },
    ],
  },
  {
    num: 42, title: 'Ocean Observatories', group: 'ocean',
    entries: [
      { name: 'OOI', url: 'https://oceanobservatories.org/' },
      { name: 'NEPTUNE Canada', url: 'https://www.oceannetworks.ca/' },
      { name: 'ONC Data', url: 'https://data.oceannetworks.ca/' },
      { name: 'EMSO', url: 'https://www.emso.eu/' },
      { name: 'EMSO Data Portal', url: 'https://data.emso.eu/' },
      { name: 'ALOHA', url: 'https://aco-ssds.soest.hawaii.edu/' },
      { name: 'DART', url: 'https://www.ndbc.noaa.gov/dart/dart.shtml' },
      { name: 'DART Data Access', url: 'https://www.ndbc.noaa.gov/dart_data_access.shtml' },
      { name: 'NDBC Buoy Data', url: 'https://www.ndbc.noaa.gov/' },
    ],
  },
  {
    num: 43, title: 'Strong Motion & EQ Engineering', group: 'seismic',
    entries: [
      { name: 'COSMOS', url: 'https://www.strongmotion.org/' },
      { name: 'COSMOS VDC', url: 'https://www.strongmotioncenter.org/vdc/' },
      { name: 'K-NET / KiK-net', url: 'https://www.kyoshin.bosai.go.jp/' },
      { name: 'GeoNet', url: 'https://www.geonet.org.nz/' },
      { name: 'GeoNet Data', url: 'https://www.geonet.org.nz/data' },
      { name: 'CSN Chile', url: 'https://evtdb.csn.uchile.cl/' },
      { name: 'ShakeAlert', url: 'https://www.shakealert.org/' },
      { name: 'USGS ShakeMap', url: 'https://earthquake.usgs.gov/data/shakemap/' },
      { name: 'USGS DyFI', url: 'https://earthquake.usgs.gov/data/dyfi/' },
    ],
  },
  {
    num: 44, title: 'Landslides & Slope Stability', group: 'hazards',
    entries: [
      { name: 'NASA COOLR', url: 'https://landslides.nasa.gov/' },
      { name: 'NASA Landslide Reporter', url: 'https://landslides.nasa.gov/reporter/' },
      { name: 'LHASA', url: 'https://gpm.nasa.gov/applications/global-landslide-model' },
      { name: 'High Mountain Asia', url: 'https://nsidc.org/data/hma_ls_cat/' },
      { name: 'TRMM Landslide', url: 'https://gpm.nasa.gov/applications/global-landslide-model' },
    ],
  },
  {
    num: 45, title: 'Glacier & Permafrost', group: 'cryosphere',
    entries: [
      { name: 'WGMS', url: 'https://wgms.ch/' },
      { name: 'GlaThiDa', url: 'https://www.gtn-g.ch/data/' },
      { name: 'GTN-G', url: 'https://www.gtn-g.ch/' },
      { name: 'NSIDC Glacier Data', url: 'https://nsidc.org/data/glacier_inventory/' },
      { name: 'RGI', url: 'https://www.glims.org/RGI/' },
      { name: 'GLIMS', url: 'https://www.glims.org/' },
      { name: 'GTN-P', url: 'https://gtnp.arcticportal.org/' },
      { name: 'TSP', url: 'https://gtnp.arcticportal.org/data/data-handling' },
      { name: 'DUE Permafrost', url: 'https://gtnp.arcticportal.org/' },
    ],
  },
  {
    num: 46, title: 'Peatlands & Wetlands', group: 'ecology',
    entries: [
      { name: 'Global Peatland DB', url: 'https://greifswaldmoor.de/global-peatland-database-en.html' },
      { name: 'PeatData', url: 'https://datadryad.org/' },
      { name: 'EIDC Peatland', url: 'https://eidc.ceh.ac.uk/' },
      { name: 'Holocene Peatland DB', url: 'https://www2.cifor.org/global-wetlands/' },
      { name: 'Global Mangrove Watch', url: 'https://www.globalmangrovewatch.org/' },
      { name: 'RAMSAR', url: 'https://rsis.ramsar.org/' },
      { name: 'Wetlands International', url: 'https://www.wetlands.org/' },
      { name: 'Global Wetlands Map', url: 'https://www2.cifor.org/global-wetlands/' },
      { name: 'US NWI', url: 'https://www.fws.gov/program/national-wetlands-inventory' },
      { name: 'SeagrassWatch', url: 'https://www.seagrasswatch.org/' },
    ],
  },
  {
    num: 47, title: 'Coral Reefs & Marine Ecosystems', group: 'ocean',
    entries: [
      { name: 'NOAA Coral Reef Watch', url: 'https://coralreefwatch.noaa.gov/' },
      { name: 'Allen Coral Atlas', url: 'https://allencoralatlas.org/' },
      { name: 'Reef Check', url: 'https://www.reefcheck.org/' },
      { name: 'CoralWatch', url: 'https://coralwatch.org/' },
      { name: 'CoralWatch Data', url: 'https://coralwatch.org/data/' },
      { name: 'ReefCloud', url: 'https://reefcloud.ai/' },
      { name: 'GCRMN', url: 'https://gcrmn.net/' },
      { name: 'MERMAID', url: 'https://datamermaid.org/' },
      { name: 'NCRMP', url: 'https://www.coris.noaa.gov/monitoring/' },
      { name: 'CORDIO', url: 'https://cordioea.net/' },
      { name: 'AquaMaps', url: 'https://www.aquamaps.org/' },
    ],
  },
  {
    num: 48, title: 'Biomass & Forest Carbon', group: 'ecology',
    entries: [
      { name: 'GEDI Data', url: 'https://daac.ornl.gov/cgi-bin/dataset_lister.pl?p=32' },
      { name: 'ICESat-2 Biomass', url: 'https://ceos.org/gst/icesat2-boreal-biomass.html' },
      { name: 'ICESat-2 Data', url: 'https://icesat-2.gsfc.nasa.gov/' },
      { name: 'GFW Data Portal', url: 'https://data.globalforestwatch.org/' },
      { name: 'Rainfor', url: 'https://www.rainfor.org/' },
      { name: 'ForestPlots.net', url: 'https://www.forestplots.net/' },
    ],
  },
  {
    num: 49, title: 'Geochemistry & Petrology', group: 'geology',
    entries: [
      { name: 'EarthChem Portal', url: 'https://www.earthchem.org/' },
      { name: 'PetDB', url: 'https://www.earthchem.org/petdb' },
      { name: 'GEOROC', url: 'http://georoc.mpch-mainz.gwdg.de/georoc/' },
      { name: 'GeoReM', url: 'http://georem.mpch-mainz.gwdg.de/' },
      { name: 'Deep Lithosphere Dataset', url: 'https://www.earthchem.org/' },
      { name: 'DARWIN', url: 'https://www.earthchem.org/' },
      { name: 'PANGAEA Geochemistry', url: 'https://www.pangaea.de/' },
    ],
  },
  {
    num: 50, title: 'Seafloor Mapping & Bathymetry', group: 'ocean',
    entries: [
      { name: 'GMRT', url: 'https://www.gmrt.org/' },
      { name: 'GEBCO', url: 'https://www.gebco.net/' },
      { name: 'GEBCO Grid', url: 'https://www.gebco.net/data_and_products/gridded_bathymetry_data/' },
      { name: 'IHO Data Centre', url: 'https://iho.int/' },
      { name: 'IHO DCDB', url: 'https://www.ngdc.noaa.gov/mgg/bathymetry/hydro.html' },
      { name: 'EMODnet Bathymetry', url: 'https://emodnet.ec.europa.eu/bathymetry' },
      { name: 'OpenTopo Bathymetry', url: 'https://opentopography.org/' },
      { name: 'SIO Seafloor', url: 'https://topex.ucsd.edu/marine_topo/' },
    ],
  },
  {
    num: 51, title: 'Hydrothermal Vents & Subsurface', group: 'geology',
    entries: [
      { name: 'InterRidge Vents', url: 'http://vents-data.interridge.org/' },
      { name: 'InterRidge V3.4', url: 'https://doi.pangaea.de/10.1594/PANGAEA.917894' },
      { name: 'GROTP', url: 'https://geothermal.org/' },
      { name: 'NGDS', url: 'https://gdr.openei.org/' },
      { name: 'NREL Geothermal', url: 'https://www.nrel.gov/geothermal/' },
    ],
  },
  {
    num: 52, title: 'Crustal & Lithospheric Models', group: 'geology',
    entries: [
      { name: 'CRUST1.0', url: 'https://igppweb.ucsd.edu/~gabi/crust1.html' },
      { name: 'LITHO1.0', url: 'https://igppweb.ucsd.edu/~gabi/litho1.0.html' },
      { name: 'CRUST2.0', url: 'https://igppweb.ucsd.edu/~gabi/crust2.html' },
      { name: 'EIGEN-6C4', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'XGM2019', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'ICGEM', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'WDMAM', url: 'https://wdmam.org/' },
      { name: 'EMM2017', url: 'https://www.ngdc.noaa.gov/geomag/EMM/' },
      { name: 'EMGeo', url: 'https://emgeo.org/' },
      { name: 'MTNet', url: 'https://www.mtnet.info/' },
    ],
  },
  {
    num: 53, title: 'Flood Forecasting & Extremes', group: 'hazards',
    entries: [
      { name: 'GLOFAS', url: 'https://www.globalfloods.eu/' },
      { name: 'EFAS', url: 'https://www.efas.eu/' },
      { name: 'ADCIRC', url: 'https://adcirc.org/' },
      { name: 'SLOSH Display', url: 'https://www.nhc.noaa.gov/nationalsurge/' },
      { name: 'HRRR-Smoke', url: 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/' },
      { name: 'BehavePlus', url: 'https://www.frames.gov/behaveplus' },
      { name: 'iRain', url: 'https://irain.eng.uci.edu/' },
    ],
  },
  {
    num: 54, title: 'Coastal Erosion & Monitoring', group: 'ocean',
    entries: [
      { name: 'CoastSnap', url: 'https://www.coastsnap.com/' },
      { name: 'Digital Coast (NOAA)', url: 'https://coast.noaa.gov/digitalcoast/' },
      { name: 'NOAA Shoreline', url: 'https://www.ncei.noaa.gov/products/coastal-relief-model' },
      { name: 'USACE Coastal Data', url: 'https://cirp.usace.army.mil/' },
      { name: 'Coastal Imaging', url: 'https://ciroh.org/' },
      { name: 'ARGUS', url: 'https://ciroh.org/' },
    ],
  },
  {
    num: 55, title: 'Ozone & UV Monitoring', group: 'atmosphere',
    entries: [
      { name: 'WOUDC', url: 'https://woudc.org/' },
      { name: 'WOUDC Data', url: 'https://woudc.org/data/explore.php' },
      { name: 'TOAR', url: 'https://igacproject.org/activities/TOAR' },
      { name: 'NASA OMI', url: 'https://ozoneaq.gsfc.nasa.gov/' },
      { name: 'NASA OMPS', url: 'https://ozoneaq.gsfc.nasa.gov/' },
      { name: 'Dobson Network', url: 'https://woudc.org/' },
      { name: 'Brewer Network', url: 'https://woudc.org/' },
      { name: 'NDACC Ozone', url: 'https://ndacc.larc.nasa.gov/' },
    ],
  },
  {
    num: 56, title: 'Upper Atmosphere & Mesosphere', group: 'space',
    entries: [
      { name: 'NLC Camera Network', url: 'https://www.iap-kborn.de/' },
      { name: 'MLS Mesosphere', url: 'https://mls.jpl.nasa.gov/' },
      { name: 'Odin/OSIRIS', url: 'https://odin-osiris.usask.ca/' },
      { name: 'SCIAMACHY', url: 'https://earth.esa.int/eogateway/missions/sciamachy' },
    ],
  },
  {
    num: 57, title: 'Climate Teleconnections', group: 'weather',
    entries: [
      { name: 'NOAA CPC', url: 'https://www.cpc.ncep.noaa.gov/' },
      { name: 'NOAA Teleconnections', url: 'https://www.cpc.ncep.noaa.gov/data/teledoc/telecontents.html' },
      { name: 'MEI', url: 'https://www.psl.noaa.gov/enso/mei/' },
      { name: 'ONI', url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php' },
      { name: 'PDO Index', url: 'https://www.ncei.noaa.gov/access/monitoring/pdo/' },
      { name: 'NAO Index', url: 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/nao.shtml' },
      { name: 'AO Index', url: 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/ao.shtml' },
      { name: 'AAO Index', url: 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/aao/aao.shtml' },
      { name: 'MJO Index', url: 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/MJO/mjo.shtml' },
      { name: 'SOI', url: 'https://www.cpc.ncep.noaa.gov/data/indices/soi' },
      { name: 'PSL Climate Indices', url: 'https://www.psl.noaa.gov/data/climateindices/list/' },
    ],
  },
  {
    num: 58, title: 'Wildfire & Smoke Management', group: 'weather',
    entries: [
      { name: 'BehavePlus', url: 'https://www.frames.gov/behaveplus' },
      { name: 'HRRR-Smoke', url: 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/' },
      { name: 'RAP-Smoke', url: 'https://rapidrefresh.noaa.gov/RAP/' },
      { name: 'NRL Smoke', url: 'https://www.nrlmry.navy.mil/' },
      { name: 'VIIRS Active Fires', url: 'https://www.earthdata.nasa.gov/learn/find-data/near-real-time/firms' },
      { name: 'MODIS Active Fires', url: 'https://earthdata.nasa.gov/earth-observation-data/near-real-time/firms' },
    ],
  },
  {
    num: 59, title: 'Groundwater & Aquifer Systems', group: 'advanced',
    entries: [
      { name: 'WHYMAP', url: 'https://www.whymap.org/' },
      { name: 'IGRAC', url: 'https://www.un-igrac.org/' },
      { name: 'IGRAC Portal', url: 'https://ggis.un-igrac.org/' },
      { name: 'USGS Groundwater Data', url: 'https://waterdata.usgs.gov/nwis/gw' },
      { name: 'GRACE-FO', url: 'https://grace.jpl.nasa.gov/' },
      { name: 'AQUASTAT', url: 'https://www.fao.org/aquastat/' },
    ],
  },
  {
    num: 60, title: 'Transboundary Water Governance', group: 'advanced',
    entries: [
      { name: 'IGRAC', url: 'https://www.un-igrac.org/' },
      { name: 'IGRAC Portal', url: 'https://ggis.un-igrac.org/' },
      { name: 'WHYMAP', url: 'https://www.whymap.org/' },
      { name: 'USGS Groundwater', url: 'https://waterdata.usgs.gov/nwis/gw' },
      { name: 'AQUASTAT', url: 'https://www.fao.org/aquastat/' },
    ],
  },
  {
    num: 61, title: 'Orbital Debris & SSA', group: 'space',
    entries: [
      { name: 'Space-Track', url: 'https://www.space-track.org/' },
      { name: 'Space-Track API', url: 'https://www.space-track.org/documentation' },
      { name: 'SOCRATES', url: 'https://celestrak.org/SOCRATES/' },
      { name: 'SatNOGS', url: 'https://satnogs.org/' },
      { name: 'N2YO', url: 'https://www.n2yo.com/' },
      { name: 'Heavens-Above', url: 'https://www.heavens-above.com/' },
      { name: 'UCS Satellite DB', url: 'https://www.ucsusa.org/resources/satellite-database' },
      { name: 'ESA Space Debris', url: 'https://www.esa.int/Space_Safety/Space_Debris' },
      { name: 'NASA ODPO', url: 'https://www.orbitaldebris.jsc.nasa.gov/' },
      { name: 'LeoLabs', url: 'https://www.leolabs.space/' },
    ],
  },
  {
    num: 62, title: 'Geomagnetism & GIC', group: 'geology',
    entries: [
      { name: 'INTERMAGNET', url: 'https://www.intermagnet.org/' },
      { name: 'INTERMAGNET Data', url: 'https://intermagnet.github.io/' },
      { name: 'USGS Geomagnetism', url: 'https://geomag.usgs.gov/' },
      { name: 'SuperMAG', url: 'https://supermag.jhuapl.edu/' },
      { name: 'SuperMAG Data', url: 'https://supermag.jhuapl.edu/mag/' },
      { name: 'BGS Geomagnetism', url: 'https://www.bgs.ac.uk/' },
      { name: 'GFZ Geomagnetism', url: 'https://www.gfz-potsdam.de/en/section/geomagnetism' },
      { name: 'LISN', url: 'https://lisn.igp.gob.pe/' },
    ],
  },
  {
    num: 63, title: 'Soil Respiration & Carbon Flux', group: 'ecology',
    entries: [
      { name: 'SRDB', url: 'https://github.com/bpbond/srdb' },
      { name: 'AmeriFlux BASE', url: 'https://ameriflux.lbl.gov/data/download-data/' },
      { name: 'NEON Soil Data', url: 'https://data.neonscience.org/data-products/DP1.00096.001' },
      { name: 'LTER Soil Carbon', url: 'https://lternet.edu/' },
      { name: 'GLDAS', url: 'https://ldas.gsfc.nasa.gov/gldas/' },
      { name: 'SMAP Soil Moisture', url: 'https://smap.jpl.nasa.gov/' },
      { name: 'SMOS', url: 'https://www.cesbio.cnrs.fr/' },
      { name: 'ASCAT Soil Moisture', url: 'https://hsaf.meteoam.it/' },
    ],
  },
  {
    num: 64, title: 'Weather Radar & Nowcasting', group: 'weather',
    entries: [
      { name: 'OPERA', url: 'https://www.eumetnet.eu/activities/observations-programme/current-activities/opera/' },
      { name: 'NEXRAD Level-II', url: 'https://registry.opendata.aws/noaa-nexrad/' },
      { name: 'MRMS', url: 'https://www.nssl.noaa.gov/projects/mrms/' },
      { name: 'MRMS Data', url: 'https://mrms.ncep.noaa.gov/data/' },
      { name: 'SPC Mesoanalysis', url: 'https://www.spc.noaa.gov/exper/mesoanalysis/' },
      { name: 'SPC Convective Outlooks', url: 'https://www.spc.noaa.gov/products/outlook/' },
      { name: 'SPC WCM', url: 'https://www.spc.noaa.gov/wcm/' },
      { name: 'Tornado History', url: 'https://www.tornadohistoryproject.com/' },
      { name: 'ESWD', url: 'https://www.eswd.eu/' },
      { name: 'Severe Weather Europe', url: 'https://www.severe-weather.eu/' },
    ],
  },
  {
    num: 65, title: 'Solar Radio Monitoring', group: 'space',
    entries: [
      { name: 'CALLISTO', url: 'https://www.e-callisto.org/' },
      { name: 'CALLISTO Spectrograms', url: 'https://soleil.i4ds.ch/solarradio/callistoQuicklooks/' },
      { name: 'e-CALLISTO', url: 'https://www.e-callisto.org/' },
      { name: 'SWAVES', url: 'https://swaves.gsfc.nasa.gov/' },
      { name: 'Wind WAVES', url: 'https://wind.nasa.gov/' },
      { name: 'LOFAR Solar', url: 'https://www.astron.nl/' },
      { name: 'Nançay Radioheliograph', url: 'https://www.obs-nancay.fr/' },
      { name: 'Nobeyama Radioheliograph', url: 'https://solar.nro.nao.ac.jp/norh/' },
      { name: 'GOES XRS', url: 'https://www.swpc.noaa.gov/products/goes-x-ray-flux' },
    ],
  },
  {
    num: 66, title: 'SLR & VLBI Geodesy', group: 'advanced',
    entries: [
      { name: 'ILRS', url: 'https://ilrs.gsfc.nasa.gov/' },
      { name: 'ILRS Data', url: 'https://ilrs.gsfc.nasa.gov/data_and_products/data/index.html' },
      { name: 'IVS', url: 'https://ivscc.gsfc.nasa.gov/' },
      { name: 'IVS Data', url: 'https://ivscc.gsfc.nasa.gov/products-data/index.html' },
      { name: 'CDDIS', url: 'https://cddis.nasa.gov/' },
      { name: 'BKG Data Center', url: 'https://igs.bkg.bund.de/' },
      { name: 'GA Data Center', url: 'https://www.ga.gov.au/scientific-topics/positioning-navigation' },
    ],
  },
  {
    num: 67, title: 'GNSS Reflectometry & Soil Moisture', group: 'advanced',
    entries: [
      { name: 'PBO H2O', url: 'https://www.unavco.org/data/gps-gnss/derived-products/pbo-h2o/documentation/documentation.html' },
      { name: 'GNSS-IR', url: 'https://gnss-reflections.org/' },
      { name: 'SMAP', url: 'https://smap.jpl.nasa.gov/' },
      { name: 'CYGNSS', url: 'https://science.nasa.gov/mission/cygnss/' },
      { name: 'CYGNSS Data', url: 'https://podaac.jpl.nasa.gov/CYGNSS' },
      { name: 'Spire Weather', url: 'https://spire.com/weather/' },
      { name: 'GeoOptics', url: 'https://geooptics.com/' },
      { name: 'PlanetiQ', url: 'https://www.planetiq.com/' },
      { name: 'ROM SAF', url: 'https://rom-saf.eumetsat.int/' },
    ],
  },
  {
    num: 68, title: 'Geoid & Gravity Models', group: 'geology',
    entries: [
      { name: 'ICGEM', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'EIGEN-6C4', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'XGM2019', url: 'https://icgem.gfz-potsdam.de/home' },
      { name: 'EGM2008', url: 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84' },
      { name: 'GOCE', url: 'https://earth.esa.int/eogateway/missions/goce' },
      { name: 'GRACE-FO', url: 'https://grace.jpl.nasa.gov/' },
      { name: 'BGI Gravimetry', url: 'https://bgi.obs-mip.fr/' },
      { name: 'NGA Geoid', url: 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84' },
      { name: 'GFZ Gravity', url: 'https://www.gfz-potsdam.de/en/section/earth-system-modelling' },
    ],
  },
  {
    num: 69, title: 'Satellite Altimetry & Sea Level', group: 'ocean',
    entries: [
      { name: 'AVISO+', url: 'https://www.aviso.altimetry.fr/' },
      { name: 'AVISO Data', url: 'https://www.aviso.altimetry.fr/en/data.html' },
      { name: 'CTOH', url: 'https://ctoh.legos.obs-mip.fr/' },
      { name: 'DAHITI', url: 'https://dahiti.dgfi.tum.de/en/' },
      { name: 'Jason-3', url: 'https://www.nesdis.noaa.gov/jason-3' },
      { name: 'Sentinel-6', url: 'https://sentinels.copernicus.eu/web/sentinel/missions/sentinel-6' },
      { name: 'SWOT', url: 'https://swot.jpl.nasa.gov/' },
      { name: 'SWOT Data', url: 'https://podaac.jpl.nasa.gov/SWOT' },
      { name: 'CryoSat-2', url: 'https://earth.esa.int/eogateway/missions/cryosat' },
    ],
  },
  {
    num: 70, title: 'InSAR & Ground Deformation', group: 'satellite',
    entries: [
      { name: 'COMET', url: 'https://comet.nerc.ac.uk/' },
      { name: 'COMET LiCSAR', url: 'https://comet.nerc.ac.uk/COMET-LiCS-portal/' },
      { name: 'LiCSAR', url: 'https://comet.nerc.ac.uk/COMET-LiCS-portal/' },
      { name: 'ASF SAR Data', url: 'https://asf.alaska.edu/' },
      { name: 'UNAVCO SAR', url: 'https://www.unavco.org/data/imaging/sar/' },
      { name: 'SqueeSAR', url: 'https://www.tre-altamira.com/' },
      { name: 'MintPy', url: 'https://github.com/insarlab/MintPy' },
    ],
  },
  {
    num: 71, title: 'Isotope Hydrology & Paleohydrology', group: 'advanced',
    entries: [
      { name: 'SISAL', url: 'https://pastglobalchanges.org/science/wg/sisal/intro' },
      { name: 'PAGES 2k', url: 'https://pastglobalchanges.org/science/wg/2k-network/intro' },
      { name: 'Iso2k', url: 'https://www.ncei.noaa.gov/access/paleo-search/study/27850' },
      { name: 'SWITCH', url: 'https://www.hydrology.nl/' },
      { name: 'LMWL Database', url: 'https://www.hydrology.nl/' },
      { name: 'Paleo Hydrology', url: 'https://www.ncei.noaa.gov/access/paleo-search/' },
    ],
  },
];

/* ── Generate the file ── */
const ALL_MOTION_TYPES = ['pulse', 'wave', 'trail', 'breathe', 'dash', 'flicker', 'orbit', 'glow', 'contract', 'shimmer', 'radar', 'float'] as const;

const GROUP_MOTION_HINTS: Record<string, string[]> = {
  seismic: ['pulse', 'flicker', 'radar'],
  ocean: ['wave', 'shimmer', 'float'],
  aviation: ['trail', 'dash', 'orbit'],
  satellite: ['breathe', 'glow', 'orbit'],
  weather: ['dash', 'wave', 'flicker'],
  hazards: ['flicker', 'pulse', 'radar'],
  space: ['orbit', 'glow', 'trail'],
  atmosphere: ['glow', 'breathe', 'shimmer'],
  cryosphere: ['contract', 'shimmer', 'float'],
  geology: ['pulse', 'shimmer', 'glow'],
  ecology: ['shimmer', 'float', 'breathe'],
  advanced: ['radar', 'orbit', 'pulse'],
  geospatial: ['float', 'wave', 'dash'],
};

function getUniqueMotion(layerIndex: number, group: string): string {
  const hints = GROUP_MOTION_HINTS[group] || ALL_MOTION_TYPES;
  const primaryOffset = layerIndex % hints.length;
  return hints[primaryOffset];
}

const gen = goldenColorGen();
const groupColors: Record<string, string> = {};

function shortSub(section: Section, entry: { name: string; url: string }): string {
  const n = entry.name;
  const known: Record<string, string> = {
    'USGS Earthquake Hazards': 'Seismic hazard data',
    'USGS Latest Earthquakes': 'Live seismic events',
    'GDACS': 'Global disaster alerts',
    'ReliefWeb': 'Humanitarian updates',
    'NASA Open APIs': 'NASA data portal',
    'CelesTrak GP API': 'Satellite tracking',
    'Open-Meteo': 'Free weather API',
    'National Weather Service': 'US weather data',
    'OpenWeatherMap': 'Global weather API',
    'IRIS Data Services': 'Seismic waveform data',
    'FDSN': 'Seismic network data',
    'EMSC': 'European seismic data',
    'INGV': 'Italian seismic data',
    'GEOFON': 'Global seismic data',
    'ISC': 'Seismic bulletin data',
    'JMA': 'Japan seismic data',
    'PHIVOLCS': 'Philippines seismic data',
    'BGS Earthquake Data': 'UK seismic data',
    'IGN (Spain)': 'Spain seismic data',
    'ORFEUS': 'European waveform data',
    'GNS Science (NZ)': 'New Zealand seismic data',
    'OpenFEMA': 'US disaster data',
    'Natural Earth': 'Global vector data',
    'OSM Overpass': 'OpenStreetMap data',
    'OSM Nominatim': 'OSM geocoding',
    'OpenTopography': 'Elevation data',
    'Openrouteservice': 'Route planning',
    'Planetary Computer STAC': 'Satellite catalog',
    'AWS Earth Search': 'Cloud satellite data',
    'Copernicus Data Space': 'ESA satellite data',
    'USGS EarthExplorer': 'Earth data explorer',
    'NASA Earthdata Search': 'NASA data catalog',
    'Google Earth Engine': 'Satellite analysis',
    'NASA Worldview': 'Satellite imagery',
    'Landsat Look': 'Landsat imagery',
    'Planet Labs Open Data': 'Daily satellite imagery',
    'OpenAerialMap': 'Open aerial imagery',
    'Bhuvan (ISRO)': 'Indian satellite data',
    'ASTER GDEM': 'Global elevation model',
    'SRTM': 'Shuttle radar data',
    'GEBCO': 'Global bathymetry',
    'GEBCO Grid': 'Bathymetry grid',
    'MODIS Web Services': 'MODIS satellite data',
    'VIIRS Active Fires': 'Active fire detection',
    'Global Surface Water Explorer': 'Surface water data',
    'Meteostat': 'Historical weather',
    'Weatherstack': 'Current weather API',
    'DWD Open Data': 'German weather data',
    'Met Office DataPoint': 'UK weather data',
    'ECMWF Copernicus CDS': 'Climate data store',
    'NOAA Climate Data Online': 'Climate records',
    'CHIRPS Rainfall': 'Precipitation data',
    'IMERG Rainfall': 'Satellite rainfall',
    'GFS Forecast': 'Global weather model',
    'HRRR Model': 'US weather model',
    'NASA POWER': 'Solar & weather data',
    'WorldClim': 'Global climate data',
    'Stormglass': 'Marine weather',
    'RainViewer API': 'Weather radar',
    'Meteoblue API': 'Weather forecasts',
    'OpenAQ': 'Air quality data',
    'World AQI API': 'Air quality index',
    'Copernicus Atmosphere': 'Atmospheric data',
    'NASA GMAO': 'Global modeling data',
    'AIRS (NASA)': 'Atmospheric infrared',
    'OMI (NASA)': 'Ozone monitoring',
    'EPA AirData': 'US air quality',
    'AirNow API': 'US air quality',
    'PurpleAir API': 'Community air quality',
    'CAMS Global Reanalysis': 'Atmospheric reanalysis',
    'HYSPLIT': 'Air trajectory model',
    'Windy Webcams': 'Live webcam feeds',
    'OpenWebcamDB': 'Public webcam DB',
    'NHC GIS Data': 'Hurricane data',
    'IBTrACS': 'Tropical storm archive',
    'NEXRAD Radar (AWS)': 'US weather radar',
    'Tropical Tidbits': 'Tropical weather',
    'HURDAT2': 'Hurricane database',
    'NCEI Storm Events': 'US storm data',
    'NASA CNEOS': 'Near-Earth objects',
    'JPL Horizons': 'Solar system data',
    'MPC': 'Minor planet data',
    'IMO': 'Meteor observations',
    'ESA Space Debris': 'Space debris data',
    'NASA ODPO': 'Orbital debris data',
    'LeoLabs': 'Space debris tracking',
    'SatNOGS': 'Satellite ground network',
    'Space-Track': 'Satellite catalog',
    'N2YO API': 'Satellite tracking',
    'Heavens-Above': 'Satellite passes',
    'UCS Satellite DB': 'Satellite database',
    'NOAA SWPC API': 'Space weather data',
    'DSCOVR Real-Time': 'Solar wind data',
    'ACE Real-Time': 'Solar wind data',
    'SDO': 'Solar observatory',
    'SOHO': 'Solar observatory',
    'STEREO': 'Solar observatory',
    'USGS Geomagnetism': 'Geomagnetic data',
    'INTERMAGNET': 'Geomagnetic observatory',
    'SuperMAG': 'Geomagnetic data',
    'OMNIWeb': 'Heliospheric data',
    'NSIDC': 'Ice & snow data',
    'NSIDC Snow Today': 'Snow cover data',
    'ICESat-2': 'Ice elevation data',
    'CryoSat-2': 'Ice satellite data',
    'Operation IceBridge': 'Polar ice survey',
    'WGMS': 'Glacier monitoring',
    'RGI': 'Glacier inventory',
    'GLIMS': 'Glacier database',
    'FEWS NET': 'Food security data',
    'US Drought Monitor': 'Drought conditions',
    'SPEI Global Drought': 'Global drought index',
    'Global Drought Observatory': 'Drought monitoring',
    'FAO GIEWS': 'Food supply data',
    'FAO FAOSTAT': 'Food & agriculture data',
    'USDA NASS': 'US agriculture data',
    'USGS NAWQA': 'Water quality data',
    'NOAA HAB Forecasting': 'Harmful algae blooms',
    'Ocean Color Web': 'Ocean chlorophyll',
    'GHRSST': 'Sea surface temperature',
    'AVISO+': 'Satellite altimetry',
    'HYCOM': 'Ocean circulation model',
    'Copernicus Marine': 'Marine environment data',
    'ARGO Floats': 'Ocean profiling',
    'NOAA Tides & Currents': 'Tide data',
    'NOAA Coral Reef Watch': 'Coral reef monitoring',
    'SOCAT': 'Ocean CO2 data',
    'GLODAP': 'Ocean chemistry data',
    'WOD': 'World ocean database',
    'WOA': 'World ocean atlas',
    'GMRT': 'Geophysical mapping',
    'GEOTRACES': 'Ocean trace elements',
    'Global Mangrove Watch': 'Mangrove monitoring',
    'Digital Coast (NOAA)': 'Coastal management',
    'SeagrassWatch': 'Seagrass monitoring',
    'RAMSAR Sites': 'Wetland conservation',
    'RAMSAR': 'Wetland conservation',
    'Movebank API': 'Animal tracking',
    'eBird': 'Bird sightings',
    'iNaturalist': 'Species observations',
    'OBIS': 'Ocean biodiversity',
    'Map of Life': 'Species distribution',
    'MODIS Land Cover': 'Land cover data',
    'Copernicus Land Service': 'Land monitoring',
    'OpenLandMap': 'Land cover mapping',
    'Global Forest Watch': 'Forest monitoring',
    'Global Peatland DB': 'Peatland data',
    'GEDI Data': 'Forest structure data',
    'GFW Data Portal': 'Forest data',
    'EarthChem Portal': 'Geochemistry data',
    'PetDB': 'Petrology database',
    'GEOROC': 'Geochemistry database',
    'Macrostrat': 'Geological mapping',
    'PBDB': 'Paleobiology data',
    'NOAA Paleoclimatology': 'Paleoclimate data',
    'PANGAEA': 'Earth science data',
    'CoastSnap': 'Coastal monitoring',
    'Global Wind Atlas': 'Wind resource data',
    'Global Solar Atlas': 'Solar resource data',
    'OpenEI': 'Energy data',
    'NREL Data Catalog': 'Renewable energy data',
    'EIA Open Data': 'US energy statistics',
    'Energydata.info': 'Energy sector data',
    'Transitland API': 'Transit data',
    'WHO Global Health Observatory': 'Health data',
    'CDC WONDER': 'US health data',
    'Malaria Atlas Project': 'Malaria mapping',
    'HealthMap': 'Disease monitoring',
    'WorldPop Database': 'Population data',
    'WorldPop': 'Population mapping',
    'GHSL': 'Human settlement data',
    'LandScan': 'Population distribution',
    'Facebook Data for Good': 'Humanitarian data',
    'Microsoft Building Footprints': 'Building data',
    'Overture Maps': 'Open map data',
    'Overture Maps Buildings': 'Building footprints',
    'OSM Power': 'Power infrastructure',
    'OpenRailwayMap': 'Railway data',
    '3D City DB': '3D city models',
    'ISRIC World Soil Info': 'Soil data',
    'SoilGrids': 'Global soil mapping',
    'HWSD': 'Harmonized soil data',
    'HRRR-Smoke': 'Smoke forecasting',
    'BehavePlus': 'Fire behavior model',
    'GLOFAS': 'Global flood forecasting',
    'EFAS': 'European flood data',
    'ADCIRC': 'Storm surge model',
    'SLOSH Display': 'Hurricane surge model',
    'iRain': 'Rainfall monitoring',
    'GRACE-FO': 'Gravity recovery',
    'GLDAS': 'Global land data',
    'SMAP (NASA)': 'Soil moisture data',
    'FLDAS': 'Flood & drought data',
    'FLDAS Soil Moisture': 'Land surface data',
    'AQUASTAT': 'Global water data',
    'HydroSHEDS': 'Hydrological mapping',
    'WRI Aqueduct': 'Water risk data',
    'WHYMAP': 'Groundwater mapping',
    'IGRAC': 'Groundwater data',
    'IGRAC Portal': 'Groundwater portal',
    'COSMOS': 'Strong motion data',
    'K-NET / KiK-net': 'Japan strong motion',
    'GeoNet': 'New Zealand geohazards',
    'GeoNet Data': 'NZ geohazard data',
    'CSN Chile': 'Chile seismic data',
    'ShakeAlert': 'Early earthquake warning',
    'USGS ShakeMap': 'Shaking intensity maps',
    'USGS DyFI': 'Earthquake felt reports',
    'NASA COOLR': 'Landslide data',
    'NASA Landslide Reporter': 'Landslide reports',
    'LHASA': 'Landslide hazard model',
    'OOI': 'Ocean observatory data',
    'NEPTUNE Canada': 'Cabled ocean observatory',
    'ONC Data': 'Ocean Networks Canada',
    'EMSO': 'European ocean observatory',
    'DART': 'Tsunami buoy data',
    'NDBC Buoy Data': 'Weather buoy data',
    'Tokyo VAAC': 'Volcanic ash advisory',
    'Anchorage VAAC': 'Volcanic ash advisory',
    'Washington VAAC': 'Volcanic ash advisory',
    'WOVOdat': 'Volcano observatory data',
    'NASA SO2 Monitoring': 'Volcanic SO2 data',
    'Volcano Discovery': 'Volcanic activity',
    'CALLISTO': 'Solar radio bursts',
    'GOES XRS': 'Solar X-ray flux',
    'IGRF Model': 'Geomagnetic reference field',
    'WMM': 'World magnetic model',
    'EMM2017': 'Enhanced magnetic model',
    'WDMAM': 'World magnetic anomaly map',
    'EGM2008': 'Earth gravity model',
    'EIGEN-6C4': 'Gravity field model',
    'GOCE': 'Gravity satellite data',
    'CRUST1.0': 'Crustal model',
    'LITHO1.0': 'Lithosphere model',
    'ICGEM': 'Gravity field models',
    'USGS Mineral Resources': 'Mineral data',
    'BOEM Data Center': 'Offshore energy data',
    'NREL Geothermal Prospector': 'Geothermal data',
    'NGDS': 'Geothermal data',
    'InterRidge Vents': 'Hydrothermal vents',
    'GOSAT': 'Greenhouse gas data',
    'TCCON': 'Carbon column data',
    'ICOS': 'Carbon flux data',
    'FLUXNET': 'Ecosystem flux data',
    'AmeriFlux': 'Carbon flux data',
    'EDGAR': 'Emission inventory',
    'NOAA Global Monitoring Lab': 'Greenhouse gas data',
    'Crop Monitor': 'Crop condition data',
    'GEOGLAM': 'Agricultural monitoring',
    'NASA Harvest': 'Food security data',
    'USDA CropScape': 'US crop data',
    'WAPOR': 'Water productivity',
    'Global Flood Database': 'Flood records',
    'EM-DAT': 'Disaster database',
    'NASA Disasters Portal': 'Disaster response',
    'ThinkHazard!': 'Hazard assessment',
    'INFORM Index': 'Risk index data',
    'UN OCHA HDX': 'Humanitarian data',
    'Copernicus EMS': 'Emergency mapping',
    'OpenDRI': 'Disaster risk data',
    'DesInventar': 'Disaster inventory',
    'GLIDE': 'Disaster identifier',
    'NASA Landslide Portal': 'Landslide data',
    'CMEMS': 'Marine data store',
    'IHO Data Centre': 'Hydrographic data',
    'IHO DCDB': 'Bathymetry data',
    'EMODnet Bathymetry': 'European bathymetry',
    'EMODnet': 'European marine data',
    'IOOS': 'US ocean data',
    'SeaDataNet': 'Ocean data network',
    'PacIOOS': 'Pacific ocean data',
    'JCOMMOPS': 'Ocean observing coordination',
    'BGS': 'UK geology data',
    'BGS Geomagnetism': 'UK geomagnetic data',
    'GFZ Data Services': 'German geoscience data',
    'GFZ Geomagnetism': 'German geomagnetic data',
    'NGDC Data': 'Geophysical data',
    'SOPAC': 'Pacific geoscience data',
    'USGS Water Data': 'US water data',
    'USGS Water Services': 'USGS hydrology',
    'USGS Groundwater Data': 'US groundwater',
    'USGS Groundwater': 'US groundwater data',
    'Paleo Hydrology': 'Paleoclimate data',
    'PAGES 2k': 'Past 2000 years data',
    'PAGES': 'Past global change data',
    'SISAL': 'Speleothem data',
    'Iso2k': 'Isotope data',
    'Neotoma': 'Paleoecology data',
    'ITRDB': 'Tree ring data',
    'WDC Paleoclimatology': 'Paleoclimate data',
    'GeoDeepDive': 'Geoscience text mining',
    'GlaThiDa': 'Glacier thickness data',
    'GTN-G': 'Glacier monitoring',
    'GTN-P': 'Permafrost monitoring',
    'NSIDC Glacier Data': 'Glacier data',
    'DUE Permafrost': 'Permafrost data',
    'TSP': 'Thermal state permafrost',
    'Iceberg Tracker': 'Iceberg tracking',
    'Snow Today': 'Snow monitoring',
    'Polar View': 'Polar monitoring',
    'OSI SAF': 'Sea ice data',
    'Global Cryosphere Watch': 'Cryosphere monitoring',
    'Arctic Data Explorer': 'Arctic data',
    'OPERA': 'European weather radar',
    'MRMS': 'Multi-radar US data',
    'SPC Mesoanalysis': 'Storm analysis',
    'SPC Convective Outlooks': 'Severe weather forecasts',
    'SPC Storm Events': 'Severe weather reports',
    'SPC WCM': 'Weather data',
    'SPC Mesoscale Analysis': 'Storm analysis',
    'Tornado History Project': 'Tornado records',
    'Tornado History': 'Tornado records',
    'ESWD': 'European storm data',
    'Severe Weather Europe': 'European severe weather',
    'USGS FEWS NET': 'Food security data',
    'NASA FEWS NET': 'Food security data',
    'NA Drought Monitor': 'North America drought',
    'CUAHSI HydroShare': 'Hydrology data sharing',
    'OpenAgua': 'Water management',
    'GRDC': 'Global river data',
    'USACE Coastal Data': 'Coastal engineering',
    'NOAA Shoreline': 'Shoreline data',
    'WOUDC': 'Ozone data',
    'TOAR': 'Tropospheric ozone',
    'NASA OMI': 'Ozone monitoring',
    'NASA OMPS': 'Ozone monitoring',
    'NDACC Ozone': 'Ozone data network',
    'NLC Camera Network': 'Noctilucent clouds',
    'MLS Mesosphere': 'Mesosphere data',
    'Odin/OSIRIS': 'Atmospheric data',
    'SCIAMACHY': 'Atmospheric chemistry',
    'NOAA CPC': 'Climate prediction',
    'NOAA Teleconnections': 'Climate indices',
    'MEI': 'ENSO index',
    'ONI': 'Oceanic Nino index',
    'PDO Index': 'Pacific Decadal Oscillation',
    'NAO Index': 'North Atlantic Oscillation',
    'AO Index': 'Arctic Oscillation',
    'AAO Index': 'Antarctic Oscillation',
    'MJO Index': 'Madden-Julian Oscillation',
    'SOI': 'Southern Oscillation Index',
    'PSL Climate Indices': 'Climate indices',
    'RAP-Smoke': 'Smoke forecasting',
    'NRL Smoke': 'Smoke modeling',
    'MODIS Active Fires': 'Active fire detection',
    'IGS Ionosphere WG': 'Ionospheric data',
    'Madrigal Database': 'Ionospheric data',
    'SuperDARN': 'Ionospheric radar',
    'AMPERE': 'Ionospheric currents',
    'GIRO': 'Ionospheric sounding',
    'GIRO DriftBase': 'Ionospheric drift',
    'IGS': 'GNSS data',
    'IGS Data Center': 'GNSS data archive',
    'UNAVCO Data Archive': 'Geodetic data',
    'NGS CORS': 'US GPS network',
    'EUREF': 'European GPS network',
    'SIRGAS': 'Americas GPS network',
    'ITRF': 'Terrestrial reference frame',
    'SONEL': 'Sea level data',
    'EPOS-GNSS': 'European GNSS data',
    'ILRS': 'Laser ranging data',
    'ILRS Data': 'Laser ranging data',
    'IVS': 'VLBI data',
    'IVS Data': 'VLBI data',
    'CDDIS': 'NASA geodetic data',
    'PBO H2O': 'GPS water vapor',
    'GNSS-IR': 'GNSS interferometry',
    'CYGNSS': 'Wind speed data',
    'CYGNSS Data': 'Wind data',
    'Spire Weather': 'GNSS weather data',
    'GeoOptics': 'GNSS weather data',
    'ROM SAF': 'Radio occultation data',
    'BKG Data Center': 'Geodetic data',
    'GA Data Center': 'Australian geodetic data',
    'COMET LiCSAR': 'InSAR data',
    'LiCSAR': 'InSAR data portal',
    'ASF SAR Data': 'Radar satellite data',
    'UNAVCO SAR': 'SAR data',
    'MintPy': 'InSAR processing',
    'COMET': 'Earthquake geology data',
    'AVISO Data': 'Altimetry data',
    'CTOH': 'Tropical altimetry',
    'DAHITI': 'Water level data',
    'Jason-3': 'Sea level data',
    'Sentinel-6': 'Sea level data',
    'SWOT': 'Surface water data',
    'SWOT Data': 'Surface water data',
    'BGI Gravimetry': 'Gravity data',
    'NGA Geoid': 'Geoid model data',
    'GFZ Gravity': 'Gravity field data',
    'IGRF': 'Geomagnetic field',
    'INTERMAGNET Data': 'Geomagnetic data',
    'SuperMAG Data': 'Geomagnetic data',
    'LISN': 'Ionospheric data',
    'NOAA NGDC SW': 'Space weather data',
    'Virtual Solar Obs': 'Solar data',
    'Helioviewer': 'Solar imagery',
    'JHelioviewer': 'Solar imagery',
    'SunPy': 'Solar data analysis',
    'CCMC': 'Space weather modeling',
    'SAMPEX': 'Radiation belt data',
    'MMS Science Data': 'Magnetospheric data',
    'LOFAR Solar': 'Solar radio data',
    'Nançay Radioheliograph': 'Solar radio imaging',
    'Nobeyama Radioheliograph': 'Solar radio imaging',
    'e-CALLISTO': 'Solar radio network',
    'CALLISTO Spectrograms': 'Solar radio data',
    'Wind WAVES': 'Solar radio data',
    'SWAVES': 'Solar radio data',
    'NASA iSWA': 'Space weather tools',
    'LASP Portal': 'Space weather data',
    'NASA CDAWeb': 'Space physics data',
    'SRDB': 'Soil respiration data',
    'AmeriFlux BASE': 'Carbon flux data',
    'AmeriFlux Data': 'Carbon flux data',
    'NEON Soil Data': 'Soil carbon data',
    'NEON Data Portal': 'Ecology data',
    'NEON': 'National ecology network',
    'LTER Soil Carbon': 'Long-term soil carbon',
    'LTER Network': 'Long-term ecology',
    'ASCAT Soil Moisture': 'Satellite soil moisture',
    'SMOS': 'Soil moisture data',
    'LTAR Network': 'Agriculture data',
    'CZO Network': 'Critical zone data',
    'CZO Data Portal': 'Critical zone data',
    'PhenoCam Network': 'Phenology camera network',
    'PhenoCam Data': 'Phenology data',
    'EcoData Retriever': 'Ecology data tool',
    'CHELSA': 'Climate data',
    'EarthEnv': 'Environmental data',
    'ALA': 'Australian biodiversity',
    'Rainfor': 'Forest plot data',
    'ForestPlots.net': 'Forest data',
    'ICESat-2 Biomass': 'Biomass data',
    'ICESat-2 Data': 'Ice & biomass data',
    'Allen Coral Atlas': 'Coral reef mapping',
    'Reef Check': 'Reef monitoring',
    'CoralWatch': 'Coral health data',
    'CoralWatch Data': 'Coral health data',
    'ReefCloud': 'Reef monitoring',
    'GCRMN': 'Coral reef monitoring',
    'MERMAID': 'Reef survey data',
    'NCRMP': 'US coral monitoring',
    'CORDIO': 'Western Indian Ocean coral',
    'AquaMaps': 'Species distribution',
    'PeatData': 'Peatland data',
    'EIDC Peatland': 'Peatland data',
    'Holocene Peatland DB': 'Holocene peat data',
    'US NWI': 'US wetlands inventory',
    'Coastal Wetland Inventory': 'US wetlands',
    'Global Wetlands Map': 'Wetland mapping',
    'Coastal Relief Model': 'Coastal topography',
    'Wetlands International': 'Wetland conservation',
    'JAXA G-Portal': 'Japanese satellite data',
    'JAXA Himawari Monitor': 'Himawari satellite',
    'NOAA GOES-R Series': 'GOES satellite data',
    'VEDA Dashboard': 'NASA data dashboard',
    'USGS AppEEARS': 'Earth data access',
    'AIR Centre EO Catalog': 'Atlantic EO data',
    'MACC': 'Atmospheric data',
    'SILAM': 'Air quality modeling',
    'TEMPO': 'Air quality satellite',
    'Pandonia': 'Pandora instrument data',
    'Wyoming Soundings': 'Upper air data',
    'SPC Sounding Climatology': 'Sounding climatology',
    'WWLLN': 'Lightning detection',
    'GLD360 (Vaisala)': 'Lightning network',
    'NHC Tropical Cyclone Data': 'Hurricane data',
    'NCEP/NCAR Reanalysis': 'Historical reanalysis',
    'KNMI Climate Explorer': 'Climate analysis',
    'IRI Data Library': 'Climate data',
    'OGIMET': 'Weather data',
    'Visual Crossing': 'Weather data',
    'WeatherAPI.com': 'Weather data',
    'GOSAT-2': 'Greenhouse gas data',
    'NOAA SWFS': 'Fisheries data',
    'NOAA Passive Acoustics': 'Ocean acoustics',
    'xeno-canto': 'Bird sounds',
    'Macaulay Library': 'Animal sounds',
    'Wildlife Insights': 'Camera trap data',
    'C3S Seasonal Forecasts': 'Seasonal climate',
    'ISMN': 'Soil moisture network',
    'RFE Rainfall': 'African rainfall',
    'N2YO': 'Satellite tracking',
    'SOCRATES': 'Satellite conjunction data',
    'Space-Track API': 'Satellite data API',
    'Harmonized World Soil DB': 'Global soil data',
    'WoSIS': 'World soil data',
    'ICE-D': 'Surface exposure data',
    'CNEOS Scout': 'NEO impact assessment',
    'CNEOS Sentry': 'NEO impact monitoring',
    'CNEOS Fireball Data': 'Fireball events',
    'NEODyS': 'NEO dynamics data',
    'ESA NEO CC': 'NEO coordination data',
    'PlanetiQ': 'GNSS weather data',
    'GeoPlatform.gov': 'US geospatial data',
    'Data.gov': 'US open data',
    'EU Open Data Portal': 'EU open data',
    'World Bank Open Data': 'Global development data',
    'UN Data': 'UN statistics',
    'Humanitarian Data Exchange': 'Humanitarian data',
    'GeoServer': 'Geospatial server',
    'MapServer': 'Map server',
    'GeoNode': 'Geospatial platform',
    'GeoNetwork': 'Metadata catalog',
    'OpenLayers': 'Web map library',
    'Leaflet': 'Web map library',
    'CesiumJS': '3D globe library',
    'GDAL': 'Geospatial data tool',
    'PostGIS': 'Geospatial database',
    'QGIS': 'GIS desktop tool',
    'Open Data Kit': 'Field data collection',
    'Geofabrik': 'OSM data extracts',
    'OpenAddresses': 'Open address data',
    'GBDX': 'Geospatial analytics',
    'Pixalytics': 'Satellite analytics',
    'SkyWatch': 'Satellite data access',
    'Sinergise': 'EO data platform',
    'EOS Data Analytics': 'Satellite insights',
    'SpaceKnow': 'Satellite monitoring',
    'Orbital Insight': 'Geospatial analytics',
    'Descartes Labs': 'Satellite analysis',
    'PERSIANN-CDR': 'Long-term rainfall',
    'GRID3': 'Geo-referenced data',
    'EarthStat': 'Agricultural statistics',
    'AMIS': 'Agricultural market data',
    'NOS EarthView': 'Ocean observations',
    'SOCIB': 'Coastal data',
    'ARGUS': 'Coastal imaging',
    'Coastal Imaging': 'Coastal monitoring',
    'SOCIB': 'Balearic coastal data',
    'LANDO': 'Land surface data',
    'Social Media Volc': 'Social media volcano data',
    'VOLCORE': 'Volcanic core data',
    'SqueeSAR': 'Ground deformation',
    'Dobson Network': 'Ozone spectrophotometer',
    'Brewer Network': 'Ozone spectrometer',
    'XGM2019': 'Gravity field model',
    'CRUST2.0': 'Crustal model v2',
    'EMGeo': 'Electromagnetic geophysics',
    'MTNet': 'Magnetotelluric data',
    'ISRIC World Soil Info': 'World soil data',
    'Deep Lithosphere Dataset': 'Lithosphere data',
    'DARWIN': 'Geochemical data',
    'PANGAEA Geochemistry': 'Geochemical data',
    'OpenTopo Bathymetry': 'Bathymetry data',
    'SIO Seafloor': 'Seafloor topography',
    'GROTP': 'Geothermal data',
    'NREL Geothermal': 'Geothermal data',
    'InterRidge V3.4': 'Hydrothermal vent data',
    'Vents Data': 'Vent field data',
    'SWITCH': 'Water isotope data',
    'LMWL Database': 'Water isotope data',
    'Iso2k': 'Isotope database',
    'PAGES 2k': '2000-year climate',
  };

  if (known[n]) return known[n];

  // Fallback: use section title shortened based on group
  const title = section.title;
  const shorteners: Record<string, string> = {
    'Earth Data, Imagery & Satellite Platforms': 'Earth observation data',
    'Weather & Climate APIs': 'Weather & climate data',
    'Natural Hazards & Disaster Alerts': 'Hazard monitoring',
    'Aviation & ADS-B Data': 'Aviation tracking data',
    'Maritime Data APIs': 'Maritime data',
    'Space, Astronomy & Universe APIs': 'Space & astronomy',
    'Geospatial, Demographics & Global Mapping': 'Geospatial mapping',
    'Atmosphere & Environmental Science': 'Atmospheric data',
    'Severe Weather & Storms': 'Severe weather data',
    'Biodiversity & Land Cover': 'Biodiversity data',
    'Atmospheric Physics & Upper Air': 'Upper atmosphere',
    'Carbon Cycle, GHG & Methane': 'Greenhouse gas data',
    'Soil Science & Geochemistry': 'Soil & geochemistry',
    'Geophysics & Gravity': 'Geophysics data',
    'Geology & Geodesy': 'Geology & geodesy',
    'Cryosphere & Ice': 'Cryosphere data',
    'Ocean & Marine Data': 'Ocean data',
    'Hydrology & Water Resources': 'Water resources',
    'Space Weather & Solar': 'Space weather data',
    'Wildlife & Acoustics': 'Wildlife monitoring',
    'Urban Systems & Population': 'Population data',
    'Health & Environmental Exposure': 'Health data',
    'Human Geography & Humanitarian Data': 'Humanitarian data',
    'Paleoclimate & Deep Time': 'Paleoclimate data',
    'Natural Resources & Energy': 'Energy resources',
    'Coastal & Wetland Systems': 'Coastal & wetland',
    'Agriculture & Food Security': 'Agriculture data',
    'Energy & Infrastructure': 'Energy infrastructure',
    'Drought & Food Security': 'Drought monitoring',
    'Water Quality & HABs': 'Water quality data',
    'Snow & Avalanche': 'Snow & avalanche',
    'Volcanic Hazards & Ash': 'Volcanic hazards',
    'Ocean Biogeochemistry': 'Ocean chemistry',
    'Planetary Defense & NEOs': 'Near-Earth objects',
    'Ionospheric & Radio Propagation': 'Ionospheric data',
    'Geodesy & GNSS': 'Geodetic data',
    'Strong Motion & EQ Engineering': 'Strong motion data',
    'Landslides & Slope Stability': 'Landslide data',
    'Glacier & Permafrost': 'Glacier data',
    'Peatlands & Wetlands': 'Peatland & wetland',
    'Coral Reefs & Marine Ecosystems': 'Coral reef data',
    'Biomass & Forest Carbon': 'Forest carbon data',
    'Geochemistry & Petrology': 'Geochemistry data',
    'Seafloor Mapping & Bathymetry': 'Bathymetry data',
    'Hydrothermal Vents & Subsurface': 'Hydrothermal vents',
    'Crustal & Lithospheric Models': 'Crustal models',
    'Flood Forecasting & Extremes': 'Flood forecasting',
    'Coastal Erosion & Monitoring': 'Coastal monitoring',
    'Ozone & UV Monitoring': 'Ozone data',
    'Upper Atmosphere & Mesosphere': 'Upper atmosphere',
    'Climate Teleconnections': 'Climate indices',
    'Wildfire & Smoke Management': 'Fire management',
    'Groundwater & Aquifer Systems': 'Groundwater data',
    'Transboundary Water Governance': 'Water governance',
    'Orbital Debris & SSA': 'Space debris data',
    'Geomagnetism & GIC': 'Geomagnetic data',
    'Soil Respiration & Carbon Flux': 'Soil carbon data',
    'Weather Radar & Nowcasting': 'Weather radar',
    'Solar Radio Monitoring': 'Solar radio data',
    'SLR & VLBI Geodesy': 'Geodetic data',
    'GNSS Reflectometry & Soil Moisture': 'Soil moisture data',
    'Geoid & Gravity Models': 'Gravity models',
    'Satellite Altimetry & Sea Level': 'Sea level data',
    'InSAR & Ground Deformation': 'Ground deformation',
    'Isotope Hydrology & Paleohydrology': 'Isotope data',
    'Transit & Logistics': 'Transit data',
    'Aerosol & Radiation': 'Aerosol data',
    'Phenology & Ecosystems': 'Ecosystem data',
    'Ocean Observatories': 'Ocean observatory data',
    'GIS & Geospatial Platforms': 'Mapping platform',
  };

  return shorteners[title] || title.split(/[,&]/)[0].trim() || section.group;
}

function generate(): string {
  // Deduplicate entries by name across all sections
  const seenNames = new Set<string>();
  const deduplicatedSections: Section[] = [];

  for (const section of SECTIONS) {
    const uniqueEntries: { name: string; url: string }[] = [];
    for (const entry of section.entries) {
      const normalizedName = entry.name.toLowerCase().trim();
      if (!seenNames.has(normalizedName)) {
        seenNames.add(normalizedName);
        uniqueEntries.push(entry);
      }
    }
    if (uniqueEntries.length > 0) {
      deduplicatedSections.push({ ...section, entries: uniqueEntries });
    }
  }

  const totalUniqueLayers = deduplicatedSections.reduce((s, sec) => s + sec.entries.length, 0);

  let output = `/* ── AUTO-GENERATED LAYER CONFIG ── */
/* ${deduplicatedSections.length} categories, ${totalUniqueLayers} unique data layers (deduplicated by name) */
/* Every hex color is unique. Every symbol is unique. Every motion type is assigned per-layer. */

export type MotionType = ${[...ALL_MOTION_TYPES].map(t => `'${t}'`).join(' | ')};

export interface LayerCategory {
  id: string; label: string; symbol: string; color: string;
  motionType: MotionType; description: string; group: string;
  dataSource: string; sub?: string; badge?: 'LIVE' | 'KEY' | 'PREMIUM';
  type: 'point' | 'geojson' | 'effect' | 'heatmap' | 'polygon' | 'tile' | '3dtiles' | 'panel';
}

export interface LayerGroup { id: string; label: string; icon: string; color: string; }

/* ── Groups ── */
`;

  // Unique groups - with 'advanced' moved to last
  const GROUP_ORDER = ['seismic', 'ocean', 'aviation', 'satellite', 'weather', 'hazards', 'space', 'geospatial', 'atmosphere', 'geology', 'ecology', 'cryosphere', 'advanced'];
  const allGroupsSet = new Set(deduplicatedSections.map(s => s.group));
  const allGroups = GROUP_ORDER.filter(g => allGroupsSet.has(g));
  const groupIcons: Record<string, string> = {
    seismic: '⬡', ocean: '◈', aviation: '◆', satellite: '◇', weather: '▣',
    hazards: '◉', space: '◎', atmosphere: '◐', cryosphere: '◒', geology: '▤',
    ecology: '▥', advanced: '▦', geospatial: '◰',
  };

  output += `export const LAYER_GROUPS: LayerGroup[] = [\n`;
  for (const g of allGroups) {
    const c = gen.next().value!;
    groupColors[g] = c;
    output += `  { id: '${g}', label: '${g.charAt(0).toUpperCase() + g.slice(1)}', icon: '${groupIcons[g] || '◻'}', color: '${c}' },\n`;
  }
  output += `];\n\n`;

  // Group → default type mapping
  const GROUP_TYPES: Record<string, string> = {
    seismic: 'point',
    ocean: 'point',
    aviation: 'point',
    satellite: 'tile',
    weather: 'heatmap',
    hazards: 'point',
    space: 'point',
    atmosphere: 'heatmap',
    cryosphere: 'polygon',
    geology: 'geojson',
    ecology: 'polygon',
    advanced: 'point',
    geospatial: 'geojson',
  };

  // Layers
  output += `export const LAYER_CATEGORIES: LayerCategory[] = [\n`;

  let symbolIdx = 0;
  let totalLayers = 0;
  let globalLayerIndex = 0;

  for (const section of deduplicatedSections) {
    output += `  // ── ${section.num}. ${section.title} ──\n`;
    for (const entry of section.entries) {
      const id = `${section.num}_${slug(entry.name.replace(/[()]/g, '').trim())}`;
      const color = gen.next().value!;
      const sym = GEOM_SYMBOLS[symbolIdx];
      symbolIdx++;
      const motion = getUniqueMotion(globalLayerIndex, section.group);
      const layerType = GROUP_TYPES[section.group] || 'point';
      globalLayerIndex++;

      output += `  {\n`;
      output += `    id: '${id}', label: '${entry.name.replace(/'/g, "\\'")}', symbol: '${sym}',\n`;
      output += `    color: '${color}', motionType: '${motion}', group: '${section.group}',\n`;
      output += `    type: '${layerType}', description: '${entry.name} — ${section.title}',\n`;
      output += `    dataSource: '${entry.url}',\n`;
      output += `    sub: '${shortSub(section, entry).replace(/'/g, "\\'")}',\n`;
      output += `  },\n`;
      totalLayers++;
    }
  }

  // Add synthetic layers (derived/application layers with no external data source URL)
  // These use the LEGACY IDs that App.tsx rendering logic depends on
  output += `  // ── Synthetic / Derived Layers ──\n`;
  const SYNTHETIC: { id: string; label: string; group: string; type: string; description: string; url: string; badge?: string; sub?: string }[] = [
    { id: 'earthquakes', label: 'Earthquakes', group: 'seismic', type: 'point', description: 'Real-time earthquake data from USGS', url: 'https://earthquake.usgs.gov/earthquakes/feed/', badge: 'LIVE', sub: 'USGS Real-Time' },
    { id: 'tectonic', label: 'Tectonic Plates', group: 'seismic', type: 'geojson', description: 'Plate boundary network with active fault zones highlighted', url: 'https://github.com/fraxen/tectonicplates', sub: 'USGS Plates' },
    { id: 'seismic_waves', label: 'Seismic Wave Propagation', group: 'seismic', type: 'effect', description: 'P-wave, S-wave, and surface wave propagation from earthquake epicenters', url: '', sub: 'Click earthquake to trigger' },
    { id: 'tsunami', label: 'Tsunami Propagation', group: 'seismic', type: 'effect', description: 'Auto-triggered tsunami travel-time isochrones for M7.5+ submarine earthquakes', url: '', sub: 'Auto for M7.5+ ocean quakes' },
    { id: 'heatmap', label: 'Seismic Heatmap', group: 'seismic', type: 'heatmap', description: 'Density heatmap computed from earthquake epicenters', url: '' },
    { id: 'flight_tracks', label: 'Flight Tracks', group: 'aviation', type: 'point', description: 'Live flight tracking from OpenSky Network', url: 'https://opensky-network.org/', badge: 'KEY', sub: 'OpenSky Network' },
    { id: 'airports', label: 'Major Airports', group: 'aviation', type: 'point', description: 'World major airports dataset', url: 'https://github.com/mwgg/Airports' },
    { id: 'airspaces', label: 'Airspace Boundaries', group: 'aviation', type: 'geojson', description: 'Airspace boundary polygons from OpenAIP', url: '', badge: 'KEY' },
    { id: 'ais_vessels', label: 'AIS Vessels', group: 'ocean', type: 'point', description: 'Live ship tracking from AISStream', url: 'https://aisstream.io/', badge: 'KEY', sub: 'AISStream Real-Time' },
    { id: 'space_debris', label: 'Space Debris', group: 'space', type: 'point', description: 'Orbital debris tracking from CelesTrak', url: 'https://celestrak.org/', sub: 'CelesTrak GP (1500+ objects)' },
    { id: 'nasa_dsn', label: 'NASA Deep Space Network', group: 'space', type: 'point', description: 'Active deep-space tracking stations', url: '', badge: 'LIVE', sub: 'Active deep-space tracking' },
    { id: 'space_weather', label: 'Space Weather', group: 'space', type: 'point', description: 'Real-time space weather from NOAA SWPC', url: 'https://services.swpc.noaa.gov/', badge: 'LIVE', sub: 'NOAA SWPC' },
    { id: 'lightning_strikes', label: 'Lightning Strikes', group: 'weather', type: 'point', description: 'Real-time lightning detection', url: '', badge: 'LIVE', sub: 'Real-Time Lightning' },
    { id: 'aurora_oval', label: 'Polar Auroral Oval', group: 'atmosphere', type: 'point', description: 'NOAA Ovation aurora forecast', url: '', sub: 'NOAA SWPC Ovation Model' },
    { id: 'storm_forecast', label: 'Storm Forecast Cone', group: 'weather', type: 'polygon', description: 'Tropical cyclone track prediction cone', url: '', sub: 'NHC GIS data source' },
    { id: 'smoke_dispersion', label: 'Smoke Dispersion', group: 'weather', type: 'effect', description: 'Wind-driven plume from active fires', url: '', sub: 'EONET active fire sources' },
    { id: 'wildfires', label: 'Wildfires', group: 'weather', type: 'point', description: 'Active fire detection from EONET', url: '', sub: 'EONET fire events' },
    { id: 'severe_storms', label: 'Severe Storms', group: 'weather', type: 'point', description: 'Severe weather events from EONET', url: '', sub: 'EONET storm events' },
    { id: 'volcanoes', label: 'Volcanoes', group: 'weather', type: 'point', description: 'Volcanic activity from EONET', url: '', sub: 'EONET volcano events' },
    { id: 'floods', label: 'Flood Reports', group: 'hazards', type: 'point', description: 'EONET flood event reports', url: '', sub: 'EONET flood events' },
    { id: 'dust', label: 'Dust Storms', group: 'atmosphere', type: 'point', description: 'Dust storm events from EONET', url: '', sub: 'EONET dust events' },
    { id: 'seaLakeIce', label: 'Icebergs & Sea Ice', group: 'cryosphere', type: 'point', description: 'EONET sea and lake ice events', url: '', sub: 'Antarctic iceberg calving & sea ice events' },
    { id: 'disaster_alerts', label: 'Disaster Alerts', group: 'hazards', type: 'point', description: 'Global disaster alerts from GDACS', url: 'https://www.gdacs.org/', badge: 'LIVE', sub: 'GDACS Alerts' },
    { id: 'disaster_near_me', label: 'Disasters Near Me', group: 'hazards', type: 'point', description: 'Location-based disaster alerts from EONET', url: '', sub: 'Requires location' },
    { id: 'flood_extent', label: 'Flood Extent Mapping', group: 'hazards', type: 'tile', description: 'MODIS Combined Flood 1-Day from NASA GIBS', url: '', badge: 'KEY' },
    { id: 'landslides', label: 'Landslides', group: 'hazards', type: 'point', description: 'NASA landslide event reports', url: '', sub: 'NASA landslide reports' },
    { id: 'india_cctv', label: 'Live Webcams', group: 'advanced', type: 'point', description: 'Open live public webcams worldwide', url: '', badge: 'LIVE', sub: 'Open live public webcams worldwide' },
    { id: 'intel_feed', label: 'Intel Feed', group: 'advanced', type: 'panel', description: 'Real-time events from all sources', url: '', badge: 'LIVE', sub: 'Aggregated alert feed' },
    { id: 'population_impact', label: 'Population Impact Zones', group: 'geospatial', type: 'polygon', description: '50-city population overlay', url: '', sub: 'Major cities overlay' },
    { id: 'submarine_cables', label: 'Undersea Fiber Cables', group: 'advanced', type: 'geojson', description: 'Global submarine cable network from Telegeography', url: 'https://www.submarinecablemap.com/' },
    { id: 'animal_migrations', label: 'Animal Migrations', group: 'ecology', type: 'point', description: 'Animal migration tracking from Movebank', url: 'https://www.movebank.org/', sub: 'Movebank API' },
    { id: 'electricity_grid', label: 'Electricity Grid', group: 'advanced', type: 'point', description: 'Global electricity grid carbon intensity', url: 'https://energydata.info/', sub: 'Energydata.info' },
    { id: 'nasa_gibs', label: 'NASA GIBS Imagery', group: 'satellite', type: 'tile', description: 'NASA Global Imagery Browse Services', url: 'https://gibs.earthdata.nasa.gov/', sub: 'NASA GIBS WMS' },
    { id: 'night_lights', label: 'Nighttime Lights', group: 'satellite', type: 'tile', description: 'VIIRS Black Marble nighttime lights from NASA GIBS', url: '' },
    { id: 'aerosol_index', label: 'Aerosol Index', group: 'atmosphere', type: 'tile', description: 'OMPS Aerosol Index from NASA GIBS', url: '' },
    { id: 'dust_score', label: 'Dust Score', group: 'atmosphere', type: 'tile', description: 'MODIS Terra Aerosol optical thickness', url: '' },
    { id: 'sea_ice', label: 'Sea Ice', group: 'cryosphere', type: 'tile', description: 'AMSR2 sea ice concentration from NASA GIBS', url: '' },
    { id: 'sea_temp', label: 'Sea Surface Temperature', group: 'ocean', type: 'tile', description: 'GHRSST sea surface temperature from NASA GIBS', url: '' },
    { id: 'temp_anomaly', label: 'Temperature Anomaly', group: 'atmosphere', type: 'tile', description: 'AIRS temperature anomaly from NASA GIBS', url: '' },
    { id: 'precipitation', label: 'Precipitation', group: 'weather', type: 'tile', description: 'IMERG precipitation from NASA GIBS', url: '' },
    { id: 'wind', label: 'Wind Speed', group: 'weather', type: 'tile', description: 'Wind speed from NASA GIBS', url: '' },
    { id: 'pressure', label: 'Pressure', group: 'weather', type: 'tile', description: 'GEOS pressure from NASA GIBS', url: '' },
    { id: 'co_index', label: 'CO Index', group: 'atmosphere', type: 'tile', description: 'CAMS CO from NASA GIBS', url: '' },
    { id: 'so2_index', label: 'SO2 Index', group: 'atmosphere', type: 'tile', description: 'OMPS SO2 from NASA GIBS', url: '' },
    { id: 'land_cover', label: 'Land Cover', group: 'ecology', type: 'tile', description: 'MODIS land cover from NASA GIBS', url: '' },
    { id: 'dt_buildings', label: 'Digital Twin Buildings', group: 'geospatial', type: '3dtiles', description: 'OSM buildings digital twin', url: '' },
  ];
  for (const s of SYNTHETIC) {
    const color = gen.next().value!;
    const sym = GEOM_SYMBOLS[symbolIdx]; symbolIdx++;
    const motion = getUniqueMotion(globalLayerIndex, s.group);
    globalLayerIndex++;

    output += `  {\n`;
    output += `    id: '${s.id}', label: '${s.label}', symbol: '${sym}',\n`;
    output += `    color: '${color}', motionType: '${motion}', group: '${s.group}',\n`;
    output += `    type: '${s.type}', description: '${s.description}',\n`;
    output += `    dataSource: '${s.url}',\n`;
    if (s.badge) output += `    badge: '${s.badge}',\n`;
    if (s.sub) output += `    sub: '${s.sub.replace(/'/g, "\\'")}',\n`;
    output += `  },\n`;
    totalLayers++;
  }

  output += `];\n\n`;

  // Section titles lookup (section number → title)
  output += `export const SECTION_TITLES: Record<number, string> = {\n`;
  for (const sec of deduplicatedSections) {
    output += `  ${sec.num}: '${sec.title.replace(/'/g, "\\'")}',\n`;
  }
  output += `};\n\n`;

  // LEGACY_DEFAULTS: default toggle states for key layers (App.tsx depends on this)
  output += `export const LEGACY_DEFAULTS: Record<string, { on?: boolean; badge?: string; sub?: string; opacity?: number }> = {\n`;
  const LEGACY_ENTRIES = [
    "earthquakes: { on: true, badge: 'LIVE', sub: 'USGS Real-Time' }",
    "tectonic: { badge: 'KEY', sub: 'USGS Plates' }",
    "flight_tracks: { badge: 'KEY', sub: 'OpenSky Network' }",
    "space_debris: { sub: 'CelesTrak GP (1500+ objects)' }",
    "ais_vessels: { badge: 'KEY', sub: 'AISStream Real-Time' }",
    "intel_feed: { badge: 'LIVE', sub: 'Aggregated alert feed' }",
    "lightning_strikes: { badge: 'LIVE', sub: 'Real-Time Lightning' }",
    "aurora_oval: { opacity: 0.8, sub: 'NOAA Ovation Forecast' }",
    "flood_extent: { badge: 'KEY' }",
    "nasa_gibs: { opacity: 0.8 }",
    "night_lights: { opacity: 0.8 }",
    "sea_ice: { opacity: 0.7 }",
    "precipitation: { opacity: 0.6 }",
    "wind: { opacity: 0.6 }",
    "heatmap: { opacity: 0.7 }",
    "airspaces: { badge: 'KEY' }",
    "submarine_cables: { sub: 'Submarine Cable Map' }",
    "floods: { sub: 'EONET flood events' }",
    "landslides: { sub: 'NASA landslide reports' }",
    "seaLakeIce: { sub: 'EONET sea ice events' }",
  ];
  for (const entry of LEGACY_ENTRIES) {
    output += `  ${entry},\n`;
  }
  output += `};\n\n`;

  // Helpers
  output += `
export function getLayerById(id: string): LayerCategory | undefined {
  return LAYER_CATEGORIES.find(lc => lc.id === id);
}

export function getLayerColor(id: string): string | undefined {
  return getLayerById(id)?.color;
}
`;

  console.log(`Generated: ${allGroups.length} groups, ${totalLayers} layers`);
  return output;
}

const result = generate();
const scriptPath = fileURLToPath(import.meta.url);
const outPath = path.join(path.dirname(scriptPath), '..', 'src', 'config', 'layerConfig.ts');
fs.writeFileSync(outPath, result, 'utf-8');
console.log(`Written to ${outPath}`);
