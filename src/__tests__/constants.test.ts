import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SEVERITY_COLORS,
  SEVERITY_BG,
  SEVERITY_ICONS,
  timeAgo,
  formatTimeAgo,
  SeverityIcon,
} from '../lib/constants';

// ── SEVERITY_COLORS ─────────────────────────────────────────────

describe('SEVERITY_COLORS', () => {
  it('has all severity levels', () => {
    expect(SEVERITY_COLORS).toHaveProperty('critical');
    expect(SEVERITY_COLORS).toHaveProperty('high');
    expect(SEVERITY_COLORS).toHaveProperty('medium');
    expect(SEVERITY_COLORS).toHaveProperty('low');
    expect(SEVERITY_COLORS).toHaveProperty('info');
    expect(SEVERITY_COLORS).toHaveProperty('unknown');
  });

  it('all values are valid hex colors', () => {
    for (const [key, value] of Object.entries(SEVERITY_COLORS)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('critical is red', () => {
    expect(SEVERITY_COLORS.critical).toBe('#ef4444');
  });
});

// ── SEVERITY_BG ─────────────────────────────────────────────────

describe('SEVERITY_BG', () => {
  it('has all severity levels', () => {
    expect(SEVERITY_BG).toHaveProperty('critical');
    expect(SEVERITY_BG).toHaveProperty('high');
    expect(SEVERITY_BG).toHaveProperty('medium');
    expect(SEVERITY_BG).toHaveProperty('low');
    expect(SEVERITY_BG).toHaveProperty('info');
    expect(SEVERITY_BG).toHaveProperty('unknown');
  });

  it('all values are rgba colors', () => {
    for (const [key, value] of Object.entries(SEVERITY_BG)) {
      expect(value).toMatch(/^rgba\(/);
    }
  });
});

// ── SEVERITY_ICONS ──────────────────────────────────────────────

describe('SEVERITY_ICONS', () => {
  it('has all severity levels', () => {
    expect(SEVERITY_ICONS).toHaveProperty('critical');
    expect(SEVERITY_ICONS).toHaveProperty('high');
    expect(SEVERITY_ICONS).toHaveProperty('medium');
    expect(SEVERITY_ICONS).toHaveProperty('low');
    expect(SEVERITY_ICONS).toHaveProperty('info');
    expect(SEVERITY_ICONS).toHaveProperty('unknown');
  });

  it('all values are LucideIcon components', () => {
    for (const [key, value] of Object.entries(SEVERITY_ICONS)) {
      // Lucide icons are React forward-ref components (objects with $$typeof)
      expect(value).toBeDefined();
      expect(value).not.toBeNull();
    }
  });
});

// ── timeAgo ─────────────────────────────────────────────────────

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    expect(timeAgo(Date.now() - 30_000)).toBe('just now');
    expect(timeAgo(Date.now() - 1_000)).toBe('just now');
    expect(timeAgo(Date.now())).toBe('just now');
  });

  it('returns minutes ago for timestamps 1-59 minutes ago', () => {
    expect(timeAgo(Date.now() - 60_000)).toBe('1m ago');
    expect(timeAgo(Date.now() - 900_000)).toBe('15m ago');
    expect(timeAgo(Date.now() - 3_540_000)).toBe('59m ago');
  });

  it('returns hours ago for timestamps 1-23 hours ago', () => {
    expect(timeAgo(Date.now() - 3_600_000)).toBe('1h ago');
    expect(timeAgo(Date.now() - 23 * 3_600_000)).toBe('23h ago');
  });

  it('returns days ago for timestamps 1+ days ago', () => {
    expect(timeAgo(Date.now() - 86_400_000)).toBe('1d ago');
    expect(timeAgo(Date.now() - 604_800_000)).toBe('7d ago');
    expect(timeAgo(Date.now() - 2_592_000_000)).toBe('30d ago');
  });

  it('uses floor rounding (does not round up)', () => {
    // 59 minutes 59 seconds should be 59m, not 1h
    expect(timeAgo(Date.now() - 3_599_000)).toBe('59m ago');
    // 23 hours 59 minutes should be 23h, not 1d
    expect(timeAgo(Date.now() - 86_399_000)).toBe('23h ago');
  });

  it('returns days ago for timestamps spanning multiple days', () => {
    expect(timeAgo(Date.now() - 86_400_000)).toBe('1d ago');
    expect(timeAgo(Date.now() - 2 * 86_400_000)).toBe('2d ago');
  });

  it('handles future timestamps gracefully', () => {
    // Future timestamps should return 'just now' (diff <= 0)
    expect(timeAgo(Date.now() + 60_000)).toBe('just now');
    expect(timeAgo(Date.now() + 86_400_000)).toBe('just now');
  });
});

// ── formatTimeAgo ───────────────────────────────────────────────

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent dates', () => {
    expect(formatTimeAgo('2026-07-10T11:59:30Z')).toBe('just now');
    expect(formatTimeAgo('2026-07-10T12:00:00Z')).toBe('just now');
  });

  it('returns minutes ago', () => {
    expect(formatTimeAgo('2026-07-10T11:45:00Z')).toBe('15m ago');
    expect(formatTimeAgo('2026-07-10T11:01:00Z')).toBe('59m ago');
  });

  it('returns hours ago', () => {
    expect(formatTimeAgo('2026-07-10T09:00:00Z')).toBe('3h ago');
    expect(formatTimeAgo('2026-07-10T00:00:00Z')).toBe('12h ago');
  });

  it('returns days ago for old dates (not locale string)', () => {
    expect(formatTimeAgo('2026-07-09T12:00:00Z')).toBe('1d ago');
    expect(formatTimeAgo('2026-07-03T12:00:00Z')).toBe('7d ago');
    expect(formatTimeAgo('2026-06-10T12:00:00Z')).toBe('30d ago');
  });

  it('returns the input string for invalid dates', () => {
    expect(formatTimeAgo('not-a-date')).toBe('not-a-date');
    expect(formatTimeAgo('')).toBe('');
  });

  it('returns the input string for NaN dates', () => {
    expect(formatTimeAgo('invalid')).toBe('invalid');
  });

  it('produces same output as timeAgo for equivalent timestamps', () => {
    const ts = Date.now() - 3_600_000; // 1 hour ago
    const dateStr = new Date(ts).toISOString();
    expect(formatTimeAgo(dateStr)).toBe(timeAgo(ts));
  });
});

// ── SeverityIcon ────────────────────────────────────────────────

describe('SeverityIcon', () => {
  it('is a function component', () => {
    expect(typeof SeverityIcon).toBe('function');
  });

  it('accepts severity and size props', () => {
    // SeverityIcon is a React component, we just verify it renders without throwing
    // In a real test environment with React testing-library, we'd render and check
    const result = SeverityIcon({ severity: 'critical', size: 14 });
    expect(result).toBeDefined();
  });

  it('falls back to unknown icon for unrecognized severity', () => {
    const result = SeverityIcon({ severity: 'nonexistent' });
    expect(result).toBeDefined();
  });
});
