import { describe, it, expect } from 'vitest';
import { __system1Describers } from '../../cognition/cognitiveOrchestrator';

/**
 * Pins the System 1 real-data fast path describers against the ACTUAL response
 * shapes of the endpoints they render. If an upstream endpoint changes its
 * shape (e.g. Open-Meteo renames temperature_2m), these tests fail loudly
 * instead of silently emitting "n/a" fields or empty summaries.
 *
 * These are pure functions: they take the exact JSON the endpoint returns and
 * must produce a non-empty, field-correct summary. No LLM calls, no network.
 */

describe('System 1 real-data describers', () => {
  it('weather: renders real Open-Meteo current block (temperature_2m shape)', () => {
    // Real Open-Meteo /v1/forecast response shape (as proxied by
    // /api/weather/open-meteo).
    const payload = {
      current: {
        temperature_2m: 21.4,
        relative_humidity_2m: 63,
        apparent_temperature: 20.9,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 11.2,
        pressure_msl: 1015,
      },
    };
    const out = __system1Describers.weather(payload);
    expect(out).toContain('partly cloudy');
    expect(out).toContain('21.4°C');
    expect(out).toContain('63%');
    expect(out).not.toContain('undefined');
  });

  it('weather: honest message when current block is missing', () => {
    expect(__system1Describers.weather({ error: 'upstream down' })).toContain('no current conditions');
  });

  it('earthquakes: renders USGS GeoJSON features (mag/place shape)', () => {
    const payload = {
      features: [
        { properties: { mag: 5.2, place: '24 km SSE of X', time: 1700000000000 } },
        { properties: { mag: 3.1, place: 'Off the coast of Y', time: 1699990000000 } },
      ],
    };
    const out = __system1Describers.earthquakes(payload);
    expect(out).toContain('2 earthquake(s)');
    expect(out).toContain('M5.2');
    expect(out).toContain('M3.1');
  });

  it('earthquakes: honest empty state', () => {
    expect(__system1Describers.earthquakes({ features: [] })).toContain('No earthquakes');
  });

  it('flights: renders the merged states/count shape from /api/flights/all', () => {
    const out = __system1Describers.flights({ states: [[], []], count: 2 });
    expect(out).toContain('2 aircraft');
  });

  it('flights: honest zero state', () => {
    expect(__system1Describers.flights({ states: [], count: 0 })).toContain('No aircraft');
  });

  it('eonet: renders EONET events (title/categories/geometry shape)', () => {
    const payload = {
      events: [
        { title: 'Wildfire Near LA', categories: [{ title: 'Wildfires' }], geometry: [{ date: '2026-08-30T00:00:00Z' }] },
      ],
    };
    const out = __system1Describers.eonet(payload);
    expect(out).toContain('1 active hazard event');
    expect(out).toContain('Wildfire Near LA');
    expect(out).toContain('Wildfires');
  });

  it('gdacs: parses raw RSS XML title tags (real /api/gdacs/alerts shape)', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>GDACS</title></item>
      <item><title>EQ - M 6.1 in Indonesia on 30 Aug 2026 03:00 UTC</title></item>
    </channel></rss>`;
    const out = __system1Describers.gdacs(xml);
    expect(out).toContain('1 active GDACS');
    expect(out).toContain('Indonesia');
    expect(out).not.toContain('GDACS · EQ'); // the generic title is filtered
  });

  it('space weather: renders NOAA SWPC array-of-arrays Kp shape', () => {
    // Real /api/space-weather/kp payload: [[timeTag, Kp, estimated, source], ...]
    const payload = [['2026-08-30 12:00:00', 4.0, 4.0, 'estimated'], ['2026-08-30 09:00:00', 3.3, 3.3, 'estimated']];
    const out = __system1Describers.spaceWeather(payload);
    expect(out).toContain('Kp index: 4.0');
    expect(out).toContain('active');
    expect(out).toContain('NOAA SWPC');
  });

  it('space weather: honest empty state', () => {
    expect(__system1Describers.spaceWeather([])).toContain('unavailable');
  });
});
