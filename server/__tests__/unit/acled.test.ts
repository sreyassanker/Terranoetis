import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  summarizeEvents,
  detectEscalation,
  EVENT_TYPES,
  INTERACTION_TYPES,
  type AcledEvent,
} from '../../utils/acled';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeEvent(overrides: Partial<AcledEvent> = {}): AcledEvent {
  return {
    event_id: 1,
    event_date: '2024-01-15',
    year: 2024,
    time_precision: 1,
    disorder_type: 'Strategic developments',
    event_type: 'Battles',
    sub_event_type: 'Armed clash',
    actor1: 'Military Forces of Country A',
    assoc_actor_1: '',
    actor2: 'Military Forces of Country B',
    assoc_actor_2: '',
    interaction_type: 'State forces battle',
    civilian_targeting: 'No',
    iso: 156,
    region: 'Middle East',
    country: 'Syria',
    admin1: 'Damascus',
    admin2: '',
    admin3: '',
    admin4: '',
    location: 'Damascus',
    latitude: 33.5138,
    longitude: 36.2765,
    geo_precision: 1,
    source: 'Social media',
    source_scale: 'National',
    notes: 'Armed clash reported',
    fatalities: 5,
    tags: '',
    timestamp: 1705276800,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ACLED constants', () => {
  it('EVENT_TYPES contains expected categories', () => {
    expect(EVENT_TYPES).toContain('Battles');
    expect(EVENT_TYPES).toContain('Violence against civilians');
    expect(EVENT_TYPES).toContain('Protests');
    expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(5);
  });

  it('INTERACTION_TYPES contains expected categories', () => {
    expect(INTERACTION_TYPES).toContain('State forces battle');
    expect(INTERACTION_TYPES).toContain('Non-state actor battle');
    expect(INTERACTION_TYPES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('summarizeEvents', () => {
  it('returns zero counts for empty array', () => {
    const result = summarizeEvents([]);
    expect(result.totalEvents).toBe(0);
    expect(result.totalFatalities).toBe(0);
    expect(result.byType).toEqual({});
    expect(result.byActor).toEqual({});
    expect(result.hotspots).toEqual([]);
  });

  it('counts total events and fatalities', () => {
    const events = [
      makeEvent({ fatalities: 10 }),
      makeEvent({ fatalities: 5 }),
      makeEvent({ event_id: 2, fatalities: 0 }),
    ];
    const result = summarizeEvents(events);
    expect(result.totalEvents).toBe(3);
    expect(result.totalFatalities).toBe(15);
  });

  it('groups events by type', () => {
    const events = [
      makeEvent({ event_type: 'Battles' }),
      makeEvent({ event_type: 'Battles' }),
      makeEvent({ event_type: 'Protests' }),
    ];
    const result = summarizeEvents(events);
    expect(result.byType['Battles']).toBe(2);
    expect(result.byType['Protests']).toBe(1);
  });

  it('groups events by actor', () => {
    const events = [
      makeEvent({ actor1: 'Actor A' }),
      makeEvent({ actor1: 'Actor A' }),
      makeEvent({ actor1: 'Actor B' }),
    ];
    const result = summarizeEvents(events);
    expect(result.byActor['Actor A']).toBe(2);
    expect(result.byActor['Actor B']).toBe(1);
  });

  it('limits actor tracking to 50 unique actors', () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      makeEvent({ actor1: `Actor ${i}` }),
    );
    const result = summarizeEvents(events);
    expect(Object.keys(result.byActor).length).toBeLessThanOrEqual(50);
  });

  it('identifies hotspots sorted by count', () => {
    const events = [
      makeEvent({ country: 'Country A', admin1: 'Region1' }),
      makeEvent({ country: 'Country A', admin1: 'Region1' }),
      makeEvent({ country: 'Country A', admin1: 'Region1' }),
      makeEvent({ country: 'Country B', admin1: 'Region2' }),
    ];
    const result = summarizeEvents(events);
    expect(result.hotspots.length).toBeGreaterThan(0);
    expect(result.hotspots[0].location).toBe('Country A - Region1');
    expect(result.hotspots[0].count).toBe(3);
  });

  it('caps hotspots at 20', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ country: `Country ${i}`, admin1: `Region ${i}` }),
    );
    const result = summarizeEvents(events);
    expect(result.hotspots.length).toBeLessThanOrEqual(20);
  });

  it('aggregates fatalities per hotspot', () => {
    const events = [
      makeEvent({ country: 'A', admin1: 'R1', fatalities: 10 }),
      makeEvent({ country: 'A', admin1: 'R1', fatalities: 5 }),
    ];
    const result = summarizeEvents(events);
    expect(result.hotspots[0].fatalities).toBe(15);
  });
});

describe('detectEscalation', () => {
  it('returns empty for no events', () => {
    expect(detectEscalation([])).toEqual([]);
  });

  it('returns empty if only protests (no violence)', () => {
    const events = [
      makeEvent({ event_type: 'Peaceful protests', country: 'A', admin1: 'R1' }),
      makeEvent({ event_type: 'Protests', country: 'A', admin1: 'R1' }),
    ];
    expect(detectEscalation(events)).toEqual([]);
  });

  it('returns empty if only violence (no protests)', () => {
    const events = [
      makeEvent({ event_type: 'Battles', country: 'A', admin1: 'R1' }),
      makeEvent({ event_type: 'Violence against civilians', country: 'A', admin1: 'R1' }),
    ];
    expect(detectEscalation(events)).toEqual([]);
  });

  it('detects escalation pattern: protests followed by violence', () => {
    const events = [
      makeEvent({ event_type: 'Protests', country: 'A', admin1: 'R1', event_date: '2024-01-01', fatalities: 0 }),
      makeEvent({ event_type: 'Peaceful protests', country: 'A', admin1: 'R1', event_date: '2024-01-02', fatalities: 0 }),
      makeEvent({ event_type: 'Battles', country: 'A', admin1: 'R1', event_date: '2024-01-05', fatalities: 20 }),
      makeEvent({ event_type: 'Violence against civilians', country: 'A', admin1: 'R1', event_date: '2024-01-06', fatalities: 30 }),
    ];
    const result = detectEscalation(events);
    expect(result.length).toBe(1);
    expect(result[0].country).toBe('A');
    expect(result[0].admin1).toBe('R1');
    expect(result[0].escalationScore).toBeGreaterThan(0.5);
  });

  it('groups by country and admin1 separately', () => {
    const events = [
      makeEvent({ event_type: 'Protests', country: 'A', admin1: 'R1', event_date: '2024-01-01', fatalities: 0 }),
      makeEvent({ event_type: 'Battles', country: 'A', admin1: 'R1', event_date: '2024-01-05', fatalities: 30 }),
      makeEvent({ event_type: 'Protests', country: 'B', admin1: 'R2', event_date: '2024-01-01', fatalities: 0 }),
      makeEvent({ event_type: 'Battles', country: 'B', admin1: 'R2', event_date: '2024-01-05', fatalities: 30 }),
    ];
    const result = detectEscalation(events);
    expect(result.length).toBe(2);
  });

  it('returns results sorted by escalation score descending', () => {
    const events = [
      makeEvent({ event_type: 'Protests', country: 'Low', admin1: 'R1', event_date: '2024-01-01', fatalities: 0 }),
      makeEvent({ event_type: 'Battles', country: 'Low', admin1: 'R1', event_date: '2024-01-05', fatalities: 5 }),
      makeEvent({ event_type: 'Protests', country: 'High', admin1: 'R2', event_date: '2024-01-01', fatalities: 0 }),
      makeEvent({ event_type: 'Battles', country: 'High', admin1: 'R2', event_date: '2024-01-05', fatalities: 50 }),
    ];
    const result = detectEscalation(events);
    if (result.length >= 2) {
      expect(result[0].escalationScore).toBeGreaterThanOrEqual(result[1].escalationScore);
    }
  });

  it('includes timeline of events', () => {
    const events = [
      makeEvent({ event_type: 'Protests', country: 'A', admin1: 'R1', event_date: '2024-01-01' }),
      makeEvent({ event_type: 'Battles', country: 'A', admin1: 'R1', event_date: '2024-01-05', fatalities: 30 }),
    ];
    const result = detectEscalation(events);
    expect(result[0].timeline.length).toBe(2);
    expect(result[0].timeline[0]).toContain('Protests');
    expect(result[0].timeline[1]).toContain('Battles');
  });
});
