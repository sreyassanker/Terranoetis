import { describe, it, expect } from 'vitest';
import { SIMULATOR_CITIES, LANDMARK_PRESETS } from '@/components/SimulatorConsole';
import { API_METADATA } from '../../server/apiMetadata';

describe('Flight Simulator & Exploration Hub', () => {
  it('exclusively defines Google Maps API Key configuration inside API Vault metadata', () => {
    const gmaps = API_METADATA.find(a => a.id === 'google_maps');
    expect(gmaps).toBeDefined();
    expect(gmaps?.envKey).toBe('GOOGLE_MAPS_API_KEY');
    expect(gmaps?.free).toBe(true);
    expect(gmaps?.category).toBe('Satellite & Imagery');
  });

  it('exports complete roster of 3D city enclaves and landmark presets', () => {
    expect(SIMULATOR_CITIES.length).toBeGreaterThanOrEqual(10);
    const ny = SIMULATOR_CITIES.find(c => c.city === 'New York');
    expect(ny).toBeDefined();
    expect(ny?.lat).toBeCloseTo(40.758, 2);

    const tokyo = SIMULATOR_CITIES.find(c => c.city === 'Tokyo');
    expect(tokyo).toBeDefined();

    expect(LANDMARK_PRESETS.length).toBeGreaterThanOrEqual(5);
    const eiffel = LANDMARK_PRESETS.find(l => l.name === 'Eiffel Tower');
    expect(eiffel).toBeDefined();
  });
});
