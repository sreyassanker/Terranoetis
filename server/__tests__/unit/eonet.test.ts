import { describe, expect, it } from 'vitest';
import { filterEonetPayload, readEonetCategoryFilter } from '../../utils/eonet';

const payload = {
  title: 'EONET Events',
  events: [
    { id: 'fire-1', categories: [{ id: 'wildfires', title: 'Wildfires' }] },
    { id: 'storm-1', categories: [{ id: 'severeStorms', title: 'Severe Storms' }] },
    { id: 'mixed-1', categories: [{ id: 'floods', title: 'Floods' }, { id: 'wildfires', title: 'Wildfires' }] },
  ],
};

describe('EONET category filtering', () => {
  it('filters events by the source query category', () => {
    const result = filterEonetPayload(payload, 'wildfires');

    expect(result.events?.map((event) => event.id)).toEqual(['fire-1', 'mixed-1']);
    expect(result.title).toBe(payload.title);
  });

  it('matches category titles without case or punctuation sensitivity', () => {
    const result = filterEonetPayload(payload, 'severe_storms');

    expect(result.events?.map((event) => event.id)).toEqual(['storm-1']);
  });

  it('returns an empty event list for an unknown category', () => {
    expect(filterEonetPayload(payload, 'not-a-category').events).toEqual([]);
  });

  it('leaves the cached payload untouched when no filter is supplied', () => {
    const result = filterEonetPayload(payload);

    expect(result).toBe(payload);
    expect(payload.events).toHaveLength(3);
  });
});

describe('readEonetCategoryFilter', () => {
  it('trims a string and accepts Express array query values', () => {
    expect(readEonetCategoryFilter('  wildfires ')).toBe('wildfires');
    expect(readEonetCategoryFilter(['floods', 'wildfires'])).toBe('floods');
  });

  it('ignores empty and non-string values', () => {
    expect(readEonetCategoryFilter('  ')).toBeUndefined();
    expect(readEonetCategoryFilter({ category: 'wildfires' })).toBeUndefined();
  });
});
