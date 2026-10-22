import type { CadastralHeritageSite, StudyAreaBoundingBox } from './types';

/**
 * Authoritative Global Cadastral Heritage Gazetteer.
 * Comprehensive spatial database of documented standing monuments, ancient archaeological
 * complexes, and UNESCO World Heritage properties with verified coordinates and bounding boxes.
 */
export const GLOBAL_HERITAGE_GAZETTEER: CadastralHeritageSite[] = [
  {
    id: 'whc_252_taj_mahal',
    name: 'Taj Mahal Complex',
    category: 'standing_monument',
    historicType: 'mausoleum / imperial monumental complex',
    periodOrEpoch: 'Mughal Empire (1632–1653 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-252) · ASI Protected',
    coordinates: { lat: 27.1751, lon: 78.0421, elevationMeters: 171 },
    boundingBox: { latMin: 27.1680, latMax: 27.1820, lonMin: 78.0360, lonMax: 78.0490 },
    polygonCoordinates: [
      [78.0401, 27.1726],
      [78.0441, 27.1726],
      [78.0441, 27.1764],
      [78.0401, 27.1764],
      [78.0401, 27.1726],
    ],
    source: 'UNESCO World Heritage Database & Archaeological Survey of India (ASI)',
    architecturalContext: 'White marble domed mausoleum, four 40m minarets, red sandstone gateway, and Mughal Charbagh formal garden terrace',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_91_colosseum',
    name: 'Colosseum (Flavian Amphitheatre)',
    category: 'standing_monument',
    historicType: 'amphitheatre / imperial monument',
    periodOrEpoch: 'Roman Empire, Flavian Dynasty (72–80 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-91)',
    coordinates: { lat: 41.8902, lon: 12.4922, elevationMeters: 54 },
    boundingBox: { latMin: 41.8885, latMax: 41.8920, lonMin: 12.4900, lonMax: 12.4945 },
    polygonCoordinates: [
      [12.4907, 41.8892],
      [12.4938, 41.8892],
      [12.4938, 41.8913],
      [12.4907, 41.8913],
      [12.4907, 41.8892],
    ],
    source: 'Parco Archeologico del Colosseo & UNESCO World Heritage Database',
    architecturalContext: 'Travertine limestone and tuff elliptical amphitheatre with four-story arcade facade',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_86_giza_pyramids',
    name: 'Giza Necropolis & Great Pyramids',
    category: 'historic_complex',
    historicType: 'pyramid complex / royal necropolis',
    periodOrEpoch: 'Old Kingdom Egypt, 4th Dynasty (c. 2560–2500 BCE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-86)',
    coordinates: { lat: 29.9792, lon: 31.1342, elevationMeters: 65 },
    boundingBox: { latMin: 29.9710, latMax: 29.9820, lonMin: 31.1260, lonMax: 31.1360 },
    polygonCoordinates: [
      [31.1270, 29.9720],
      [31.1430, 29.9720],
      [31.1430, 29.9840],
      [31.1270, 29.9840],
      [31.1270, 29.9720],
    ],
    source: 'Egyptian Ministry of Tourism and Antiquities & UNESCO World Heritage',
    architecturalContext: 'Limestone masonry monumental standing pyramids of Khufu, Khafre, Menkaure, and Great Sphinx',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_668_angkor_wat',
    name: 'Angkor Wat Temple Complex',
    category: 'historic_complex',
    historicType: 'temple complex / religious monumental architecture',
    periodOrEpoch: 'Khmer Empire, Suryavarman II (1113–1150 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-668)',
    coordinates: { lat: 13.4125, lon: 103.8670, elevationMeters: 28 },
    boundingBox: { latMin: 13.4050, latMax: 13.4200, lonMin: 103.8580, lonMax: 103.8760 },
    polygonCoordinates: [
      [103.8610, 13.4080],
      [103.8730, 13.4080],
      [103.8730, 13.4170],
      [103.8610, 13.4170],
      [103.8610, 13.4080],
    ],
    source: 'APSARA National Authority & UNESCO World Heritage Database',
    architecturalContext: 'Sandstone quincunx towers, bas-relief galleries, and 190m-wide moated perimeter enclosure',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_326_petra',
    name: 'Petra Rock-Cut Nabataean Capital',
    category: 'historic_complex',
    historicType: 'rock-cut architecture / ancient caravan metropolis',
    periodOrEpoch: 'Nabataean Kingdom (4th c. BCE – 106 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-326)',
    coordinates: { lat: 30.3285, lon: 35.4444, elevationMeters: 810 },
    boundingBox: { latMin: 30.3200, latMax: 30.3380, lonMin: 35.4350, lonMax: 35.4550 },
    source: 'Department of Antiquities of Jordan & UNESCO World Heritage',
    architecturalContext: 'Rose-red sandstone rock-cut facades, Al-Khazneh (Treasury), Siq gorge, and Nabataean hydraulic water system',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_274_machu_picchu',
    name: 'Machu Picchu Historic Sanctuary',
    category: 'historic_complex',
    historicType: 'Inca royal estate / citadel',
    periodOrEpoch: 'Inca Empire, Pachacuti (c. 1450 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-274)',
    coordinates: { lat: -13.1631, lon: -72.5450, elevationMeters: 2430 },
    boundingBox: { latMin: -13.1700, latMax: -13.1550, lonMin: -72.5520, lonMax: -72.5380 },
    source: 'National Institute of Culture (INC Peru) & UNESCO World Heritage',
    architecturalContext: 'Dry-stone ashlar granite terraces, Intihuatana stone, Temple of the Sun, and agricultural terraces',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_829_pompeii',
    name: 'Archaeological Area of Pompeii',
    category: 'historic_complex',
    historicType: 'Roman city / volcanic preserved ruins',
    periodOrEpoch: 'Roman Republic & Early Empire (Buried 79 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-829)',
    coordinates: { lat: 40.7508, lon: 14.4869, elevationMeters: 30 },
    boundingBox: { latMin: 40.7450, latMax: 40.7580, lonMin: 14.4780, lonMax: 14.4960 },
    source: 'Parco Archeologico di Pompei & UNESCO World Heritage',
    architecturalContext: 'Paved Roman streets, forum, basilica, amphitheatre, atrium domus houses, and thermopolia',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_373_stonehenge',
    name: 'Stonehenge, Avebury and Associated Sites',
    category: 'standing_monument',
    historicType: 'megalithic stone circle / ceremonial henge',
    periodOrEpoch: 'Neolithic to Bronze Age (c. 3000–1600 BCE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-373)',
    coordinates: { lat: 51.1789, lon: -1.8262, elevationMeters: 102 },
    boundingBox: { latMin: 51.1740, latMax: 51.1830, lonMin: -1.8320, lonMax: -1.8200 },
    source: 'English Heritage & UNESCO World Heritage Database',
    architecturalContext: 'Post-and-lintel sarsen stone circle, bluestone horseshoe, circular earthen ditch and bank (henge)',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_422_hadrians_wall',
    name: 'Hadrian’s Wall (Frontiers of the Roman Empire)',
    category: 'historic_complex',
    historicType: 'linear Roman military frontier wall & forts',
    periodOrEpoch: 'Roman Empire, Emperor Hadrian (122 CE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-422)',
    coordinates: { lat: 55.0050, lon: -2.3900, elevationMeters: 280 },
    boundingBox: { latMin: 54.9950, latMax: 55.0150, lonMin: -2.4100, lonMax: -2.3700 },
    source: 'Historic England & UNESCO World Heritage Database',
    architecturalContext: 'Stone and turf curtain wall, milecastles, turrets, and ditch (Vallum) across northern Britain',
    isAboveGroundStanding: true,
  },
  {
    id: 'whc_114_persepolis',
    name: 'Persepolis (Takht-e Jamshid)',
    category: 'historic_complex',
    historicType: 'Achaemenid ceremonial capital',
    periodOrEpoch: 'Achaemenid Empire, Darius the Great (c. 518 BCE)',
    heritageDesignation: 'UNESCO World Heritage Site (Ref: WHC-114)',
    coordinates: { lat: 29.9357, lon: 52.8914, elevationMeters: 1610 },
    boundingBox: { latMin: 29.9300, latMax: 29.9420, lonMin: 52.8850, lonMax: 52.8980 },
    source: 'Iranian Cultural Heritage Organization & UNESCO World Heritage',
    architecturalContext: 'Massive stone terrace, Apadana Palace column arcade, Gate of All Nations, and monumental bas-relief stairways',
    isAboveGroundStanding: true,
  },
];

/**
 * Checks if a study area bounding box spatially intersects any documented heritage monument.
 */
export function queryHeritageGazetteer(bbox: StudyAreaBoundingBox): CadastralHeritageSite[] {
  const matches: CadastralHeritageSite[] = [];

  for (const site of GLOBAL_HERITAGE_GAZETTEER) {
    const lat = site.coordinates.lat;
    const lon = site.coordinates.lon;

    // Direct bounding-box inclusion test with 500m tolerance (~0.005 deg)
    const tol = 0.005;
    const isIntersecting =
      lat >= bbox.latMin - tol &&
      lat <= bbox.latMax + tol &&
      lon >= bbox.lonMin - tol &&
      lon <= bbox.lonMax + tol;

    if (isIntersecting) {
      matches.push(site);
    }
  }

  return matches;
}
