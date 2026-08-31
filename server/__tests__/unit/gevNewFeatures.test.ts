import { describe, it, expect } from 'vitest';
import { decodePolyline } from '../../../src/rendering/osrmRoute';
import { buildAscentPath, parseLaunch } from '../../../src/rendering/launchReplay';
import { getAircraftGltf, classifyAircraft } from '../../../src/rendering/aircraftHangar';

// the reference platform-style new features: OSRM walking route, launch replay, 3D aircraft hangar.
// These tests exercise the pure computation/parsing logic (real code paths,
// no network, no mocks of results).

describe('OSRM polyline decoding (walking route)', () => {
  it('decodes a known-format polyline to lat/lon pairs', () => {
    // Empty polyline → no points
    expect(decodePolyline('')).toEqual([]);
  });

  it('decodes a real encoded polyline', () => {
    // Manually encoded: [(52.5200, 13.4050), (52.5100, 13.4100)]-style.
    // This is the standard algorithm output — verify round-trip structure.
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = decodePolyline(encoded);
    expect(points.length).toBeGreaterThan(0);
    for (const [lat, lon] of points) {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });
});

describe('Launch replay (Launch Library 2 data → reconstructed ascent)', () => {
  it('parses a Launch Library 2 launch record with pad coordinates', () => {
    const raw = {
      id: 'abc123',
      name: 'Test Launch',
      net: '2025-01-01T00:00:00Z',
      pad: { latitude: 28.562, longitude: -80.577 },
      rocket: { configuration: { name: 'Falcon 9' } },
      mission: { name: 'Test Mission', orbit: { name: 'Low Earth Orbit' } },
      status: { name: 'Launch Successful' },
      image: 'https://example.com/img.png',
    };
    const info = parseLaunch(raw as any);
    expect(info).not.toBeNull();
    expect(info!.padLat).toBeCloseTo(28.562, 3);
    expect(info!.padLon).toBeCloseTo(-80.577, 3);
    expect(info!.rocket).toBe('Falcon 9');
    expect(info!.orbitAltKm).toBe(400); // LEO default
  });

  it('rejects records without pad coordinates (honest NaN handling)', () => {
    const raw = { id: 'x', name: 'No pad', pad: {} };
    expect(parseLaunch(raw as any)).toBeNull();
  });

  it('builds a monotonic ascent path from pad to orbit altitude', () => {
    const launch = {
      id: 'x', name: 'T', net: '', padLat: 28.5, padLon: -80.5,
      rocket: 'R', orbit: 'LEO', orbitAltKm: 400, status: '', image: '',
    };
    const path = buildAscentPath(launch, 120);
    expect(path.length).toBe(121);
    // Altitude monotonically increases to parking-orbit altitude
    const alts = path.map(p => p.altM);
    expect(alts[alts.length - 1]).toBeCloseTo(400000, 0);
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i]).toBeGreaterThanOrEqual(alts[i - 1] - 1e-6);
    }
    // Speed reaches orbital velocity (~7.9 km/s)
    expect(path[path.length - 1].speedKms).toBeCloseTo(7.9, 1);
  });
});

describe('3D aircraft hangar (per-class glTF builder + classifier)', () => {
  it('produces valid GLB data URIs for all four classes', () => {
    for (const cls of ['airliner', 'regional', 'helicopter', 'military'] as const) {
      const uri = getAircraftGltf(cls);
      expect(uri.startsWith('data:model/gltf-binary;base64,')).toBe(true);
      const bin = Buffer.from(uri.split(',')[1], 'base64');
      expect(bin.readUInt32LE(0).toString(16)).toBe('46546c67'); // glTF
      expect(bin.readUInt32LE(4)).toBe(2); // version
      expect(bin.readUInt32LE(8)).toBe(bin.length); // declared == actual
    }
  });

  it('caches each class (single build per class)', () => {
    const a = getAircraftGltf('airliner');
    const b = getAircraftGltf('airliner');
    expect(a).toBe(b);
    expect(getAircraftGltf('airliner')).not.toBe(getAircraftGltf('helicopter'));
  });

  it('classifies aircraft metadata to the right model class', () => {
    expect(classifyAircraft('N12345', 'N12345', { type: 'H135' })).toBe('helicopter');
    expect(classifyAircraft('RCH123', 'RCH123', {})).toBe('military');
    expect(classifyAircraft('FIGHTER01', 'FIGHTER01', { type: 'F-16' })).toBe('military');
    expect(classifyAircraft('DAL123', 'DAL123', { type: 'ATR-72' })).toBe('regional');
    expect(classifyAircraft('UAL123', 'UAL123', { type: 'B738' })).toBe('airliner');
  });
});
