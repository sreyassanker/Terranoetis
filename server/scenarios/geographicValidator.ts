/**
 * Geographic Validator
 * 
 * Validates whether a scenario type is physically possible at a given location.
 * - Tsunami requires ocean proximity
 * - Wildfire requires vegetation/fuel
 * - Flood requires terrain that can hold water
 * - Hurricane requires coastal proximity
 * - Volcanic requires volcanic terrain
 * - Earthquake is valid anywhere (tectonic plates)
 */

export interface ValidationResult {
  valid: boolean;
  reason: string;
  confidence: number; // 0-1
  suggestion?: string;
}

/**
 * Simplified land/ocean mask based on major water bodies
 * Uses coarse polygons for major oceans and seas
 */
function isLikelyOcean(lat: number, lon: number): boolean {
  // Pacific Ocean
  if (lat > -60 && lat < 65 && lon > 120 && lon < 180) return true;
  if (lat > -60 && lat < 65 && lon > -180 && lon < -100) return true;
  
  // Atlantic Ocean
  if (lat > -60 && lat < 70 && lon > -60 && lon < 0) return true;
  if (lat > -60 && lat < 10 && lon > -80 && lon < -30) return true;
  
  // Indian Ocean
  if (lat > -50 && lat < 30 && lon > 20 && lon < 120) return true;
  
  // Arctic Ocean
  if (lat > 70) return true;
  
  // Mediterranean
  if (lat > 30 && lat < 46 && lon > -6 && lon < 36) return true;
  
  // Caribbean Sea
  if (lat > 10 && lat < 25 && lon > -90 && lon < -60) return true;
  
  // Gulf of Mexico
  if (lat > 18 && lat < 31 && lon > -98 && lon < -80) return true;
  
  // South China Sea
  if (lat > 0 && lat < 23 && lon > 100 && lon < 120) return true;
  
  // Sea of Japan
  if (lat > 33 && lat < 52 && lon > 127 && lon < 145) return true;
  
  // Bay of Bengal
  if (lat > 0 && lat < 22 && lon > 80 && lon < 100) return true;
  
  // Arabian Sea
  if (lat > 0 && lat < 25 && lon > 50 && lon < 80) return true;
  
  // Red Sea
  if (lat > 12 && lat < 30 && lon > 32 && lon < 44) return true;
  
  return false;
}

/**
 * Check if location has vegetation (simplified NDVI-like classification)
 */
function hasVegetation(lat: number, lon: number): boolean {
  // Desert regions (Sahara, Arabian, Gobi, Australian, etc.)
  const deserts = [
    { latMin: 15, latMax: 35, lonMin: -15, lonMax: 35 },   // Sahara
    { latMin: 15, latMax: 32, lonMin: 35, lonMax: 60 },    // Arabian
    { latMin: 35, latMax: 48, lonMin: 75, lonMax: 115 },   // Gobi/Taklamakan
    { latMin: -30, latMax: -18, lonMin: 120, lonMax: 145 }, // Australian
    { latMin: -25, latMax: -15, lonMin: 14, lonMax: 20 },   // Namib/Kalahari
    { latMin: 25, latMax: 40, lonMin: -115, lonMax: -100 }, // Sonoran/Chihuahuan
  ];
  
  for (const d of deserts) {
    if (lat >= d.latMin && lat <= d.latMax && lon >= d.lonMin && lon <= d.lonMax) {
      return false;
    }
  }
  
  // Ice sheets (no vegetation)
  if (lat > 65 || lat < -65) return false;
  
  return true;
}

/**
 * Check if location is near a volcano
 */
function isVolcanicRegion(lat: number, lon: number): boolean {
  // Major volcanic regions (Ring of Fire + others)
  const volcanicRegions = [
    // Pacific Ring of Fire - West
    { latMin: -50, latMax: 10, lonMin: 95, lonMax: 180 },
    { latMin: 10, latMax: 65, lonMin: 125, lonMax: 180 },
    { latMin: 50, latMax: 65, lonMin: -180, lonMax: -130 },
    { latMin: 15, latMax: 55, lonMin: -130, lonMax: -60 },
    // Pacific Ring of Fire - East
    { latMin: -55, latMax: 15, lonMin: -85, lonMax: -65 },
    // Mediterranean-Indonesian belt
    { latMin: 35, latMax: 45, lonMin: 10, lonMax: 40 },
    { latMin: -10, latMax: 10, lonMin: 95, lonMax: 141 },
    // Hotspot volcanoes
    { latMin: 18, latMax: 23, lonMin: -160, lonMax: -154 }, // Hawaii
    { latMin: -22, latMax: -18, lonMin: -136, lonMax: -134 }, // Pitcairn
  ];
  
  for (const r of volcanicRegions) {
    if (lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if location is near a coast (within ~50km)
 */
function isCoastal(lat: number, lon: number): boolean {
  // Check multiple points around the location
  const offsets = [0.25, 0.5]; // ~25km, ~50km
  
  for (const offset of offsets) {
    const testPoints = [
      { lat: lat + offset, lon },
      { lat: lat - offset, lon },
      { lat, lon: lon + offset },
      { lat, lon: lon - offset },
      { lat: lat + offset * 0.7, lon: lon + offset * 0.7 },
      { lat: lat - offset * 0.7, lon: lon - offset * 0.7 },
    ];
    
    let oceanCount = 0;
    for (const pt of testPoints) {
      if (isLikelyOcean(pt.lat, pt.lon)) oceanCount++;
    }
    
    // If more than 30% of nearby points are ocean, consider it coastal
    if (oceanCount >= 2) return true;
  }
  
  return false;
}

/**
 * Validate tsunami scenario
 */
export function validateTsunami(lat: number, lon: number): ValidationResult {
  // Tsunami requires ocean source and coastal target
  const isOceanSource = isLikelyOcean(lat, lon);
  const isCoastalTarget = isCoastal(lat, lon);
  
  if (!isOceanSource) {
    return {
      valid: false,
      reason: 'Tsunami epicenter must be in ocean (subduction zone)',
      confidence: 0.9,
      suggestion: 'Place epicenter in Pacific Ocean near Japan, Chile, or Indonesia',
    };
  }
  
  if (!isCoastalTarget) {
    return {
      valid: true,
      reason: 'Tsunami will propagate but no coastal inundation expected at this location',
      confidence: 0.7,
      suggestion: 'Move study area closer to coast for inundation visualization',
    };
  }
  
  return {
    valid: true,
    reason: 'Valid tsunami scenario - ocean source with coastal impact',
    confidence: 0.95,
  };
}

/**
 * Validate wildfire scenario
 */
export function validateWildfire(lat: number, lon: number): ValidationResult {
  const hasVegetationResult = hasVegetation(lat, lon);
  
  if (!hasVegetationResult) {
    return {
      valid: false,
      reason: 'Insufficient vegetation/fuel for wildfire in desert/barren terrain',
      confidence: 0.85,
      suggestion: 'Move to forested region (e.g., California, Australia, Amazon)',
    };
  }
  
  return {
    valid: true,
    reason: 'Valid wildfire scenario - sufficient vegetation present',
    confidence: 0.9,
  };
}

/**
 * Validate volcanic eruption scenario
 */
export function validateVolcanic(lat: number, lon: number): ValidationResult {
  const isVolcanicResult = isVolcanicRegion(lat, lon);
  
  if (!isVolcanicResult) {
    return {
      valid: true,
      reason: 'Location outside major volcanic regions - eruption possible but unlikely',
      confidence: 0.6,
      suggestion: 'For realistic scenario, use Ring of Fire location (Japan, Indonesia, Chile)',
    };
  }
  
  return {
    valid: true,
    reason: 'Valid volcanic scenario - active volcanic region',
    confidence: 0.95,
  };
}

/**
 * Validate flood inundation scenario
 */
export function validateFlood(lat: number, lon: number): ValidationResult {
  const isOcean = isLikelyOcean(lat, lon);
  
  if (isOcean) {
    return {
      valid: false,
      reason: 'Flood inundation is for terrestrial flooding, not ocean storms',
      confidence: 0.85,
      suggestion: 'Move to land location with river or low-lying terrain',
    };
  }
  
  return {
    valid: true,
    reason: 'Valid flood scenario - terrestrial location',
    confidence: 0.9,
  };
}

/**
 * Validate earthquake swarm scenario
 */
export function validateEarthquake(_lat: number, _lon: number): ValidationResult {
  return {
    valid: true,
    reason: 'Earthquakes can occur at any tectonic location',
    confidence: 0.95,
  };
}

/**
 * Validate hurricane/typhoon scenario
 */
export function validateHurricane(lat: number, lon: number): ValidationResult {
  const isTropics = lat > -35 && lat < 35;
  const coastalCheck = isCoastal(lat, lon);
  
  if (!isTropics) {
    return {
      valid: false,
      reason: 'Hurricanes only form in tropical regions (35°N to 35°S)',
      confidence: 0.9,
      suggestion: 'Move to tropical ocean or coastal region',
    };
  }
  
  if (!coastalCheck) {
    return {
      valid: true,
      reason: 'Hurricane tracking over open ocean - no landfall impact',
      confidence: 0.7,
      suggestion: 'Move to coastal region for landfall visualization',
    };
  }
  
  return {
    valid: true,
    reason: 'Valid hurricane scenario - tropical coastal region',
    confidence: 0.95,
  };
}

/**
 * Main validation function
 */
export function validateScenario(
  type: string,
  lat: number,
  lon: number,
): ValidationResult {
  switch (type) {
    case 'tsunami_wave':
      return validateTsunami(lat, lon);
    case 'wildfire_spread':
      return validateWildfire(lat, lon);
    case 'volcanic_eruption':
      return validateVolcanic(lat, lon);
    case 'flood_inundation':
      return validateFlood(lat, lon);
    case 'earthquake_swarm':
      return validateEarthquake(lat, lon);
    case 'hurricane_landfall':
      return validateHurricane(lat, lon);
    default:
      return {
        valid: true,
        reason: 'Unknown scenario type - validation skipped',
        confidence: 0.5,
      };
  }
}
