import type { BiomeType } from './types';

/**
 * Determines the dominant archaeological landscape biome geographically
 * based on latitude, longitude, and global ecological zones.
 */
export function inferBiomeFromCoordinates(lat: number, lon: number): BiomeType {
  // Nile Delta and alluvial floodplains
  if (lat >= 30.0 && lat <= 31.8 && lon >= 30.0 && lon <= 32.5) {
    return 'alluvial_floodplain';
  }

  // Hyper-arid desert belts (Sahara, Arabian Peninsula, Atacama, Rub' al Khali)
  if (
    (lat >= 14 && lat <= 33 && lon >= -17 && lon <= 58) ||
    (lat >= -30 && lat <= -18 && lon >= -75 && lon <= -65) ||
    (lat >= 18 && lat <= 28 && lon >= 45 && lon <= 56)
  ) {
    return 'arid_desert';
  }

  // Tropical coastal & monsoon belt (e.g. Kerala, coastal South Asia, SE Asia)
  if (
    (lat >= 6 && lat <= 20 && lon >= 72 && lon <= 88) ||
    (lat >= 5 && lat <= 22 && lon >= 95 && lon <= 125)
  ) {
    return 'tropical_coastal';
  }

  // Amazon and tropical rainforest belt
  if (
    (lat >= -16 && lat <= 9 && lon >= -82 && lon <= -45) ||
    (lat >= -5 && lat <= 5 && lon >= 10 && lon <= 30)
  ) {
    return 'jungle_canopy';
  }

  // European agricultural lowlands
  if (lat >= 45 && lat <= 59 && lon >= -11 && lon <= 30) {
    return 'agricultural_plain';
  }

  // Eurasian steppe grassland belt
  if (lat >= 42 && lat <= 55 && lon >= 30 && lon <= 95) {
    return 'steppe_grassland';
  }

  return 'agricultural_plain';
}
