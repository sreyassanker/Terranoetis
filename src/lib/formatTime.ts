/**
 * Consistent IST (Indian Standard Time, UTC+5:30) date/time formatting
 * for display across the entire app. All timestamps shown to the user
 * should go through one of these functions so the UX is uniform.
 *
 * The timezone can be changed at runtime by calling setTimezone() —
 * defaults to Asia/Kolkata (IST). The admin panel lets users choose.
 */

let currentTimezone = 'Asia/Kolkata';

/** Override the default timezone (e.g. from the admin panel). */
export function setTimezone(tz: string): void {
  currentTimezone = tz;
}

/** Get the currently active timezone. */
export function getTimezone(): string {
  return currentTimezone;
}

function withTZ(date: Date | number | string): Date {
  return typeof date === 'number' || typeof date === 'string' ? new Date(date) : date;
}

/**
 * `Date.prototype.toLocaleString` is specified as constructing an
 * `Intl.DateTimeFormat` and immediately calling `format` on it, so the
 * formatter is rebuilt — with full ICU timezone resolution — on every call.
 * These helpers are invoked from render paths that run several times a
 * second, which dominated the CPU profile. Reusing one formatter per distinct
 * option set is byte-identical output at a fraction of the cost.
 *
 * The active timezone is part of the key, so setTimezone() takes effect
 * immediately.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

const COMPONENT_KEYS = [
  'year', 'month', 'day', 'hour', 'minute', 'second', 'weekday', 'era',
  'quarter', 'dayPeriod', 'timeZoneName', 'fractionalSecondDigits',
] as const;

function hasFormatSpec(options: Intl.DateTimeFormatOptions | undefined): boolean {
  if (!options) return false;
  const opts = options as Record<string, unknown>;
  return opts.dateStyle !== undefined || opts.timeStyle !== undefined
    || COMPONENT_KEYS.some((k) => opts[k] !== undefined);
}

export function formatISTTime(date: Date | number | string): string {
  return formatter('en-IN', { timeZone: currentTimezone, hour: '2-digit', minute: '2-digit' })
    .format(withTZ(date));
}

export function formatISTDate(date: Date | number | string): string {
  return formatter('en-IN', { timeZone: currentTimezone, dateStyle: 'medium' })
    .format(withTZ(date));
}

/** Cached equivalent of `toLocaleDateString('en-IN', { timeZone })` — renders
 *  as `22/9/2026` rather than `formatISTDate`'s `22 Sept 2026`. */
export function formatISTCalendarDate(date: Date | number | string): string {
  return formatter('en-IN', { timeZone: currentTimezone }).format(withTZ(date));
}

export function formatIST(date: Date | number | string, options?: { dateStyle?: 'full' | 'long' | 'medium' | 'short'; timeStyle?: 'full' | 'long' | 'medium' | 'short' }): string {
  const d = withTZ(date);
  // V8 is not equivalent in the no-format-spec case: `d.toLocaleString(loc,
  // {timeZone})` yields date AND time, while a DateTimeFormat built from the
  // same options yields date only. Real call sites always pass a style, so
  // route just that degenerate case through the original expression rather
  // than change what users see.
  if (!hasFormatSpec(options)) return d.toLocaleString('en-IN', { timeZone: currentTimezone, ...options });
  return formatter('en-IN', { timeZone: currentTimezone, ...options }).format(d);
}

/** Short display label for the active timezone, e.g. "IST" or "China Standard Time". */
export function timezoneLabel(tz: string = currentTimezone): string {
  try {
    // Formatting against the clock each call keeps the label correct across a
    // DST transition; only the construction was being paid repeatedly.
    const short = formatter('en', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value;
    if (short) return short;
  } catch { /* fall through */ }
  return tz.split('/').pop()?.replace(/_/g, ' ') || tz;
}

/** The full IANA timezone list (every zone the browser Intl API supports),
 *  each with its current UTC offset, so users worldwide can pick their zone. */
export function getAllTimezones(): Array<{ id: string; label: string; offset: string }> {
  const ids = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') || fallbackTimezones;
    } catch {
      return fallbackTimezones;
    }
  })();
  return ids
    .map((id) => {
      let offset = 'UTC';
      try {
        const fmt = new Intl.DateTimeFormat('en', { timeZone: id, timeZoneName: 'longOffset' });
        const parts = fmt.formatToParts(new Date());
        offset = parts.find(p => p.type === 'timeZoneName')?.value || 'UTC';
      } catch { /* ignore */ }
      return { id, label: id.replace(/_/g, ' '), offset };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Common timezone ids (fallback if supportedValuesOf is unavailable). */
const fallbackTimezones = [
  'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Cairo',
  'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Tunis',
  'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Caracas', 'America/Chicago',
  'America/Denver', 'America/Havana', 'America/Lima', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Panama', 'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Almaty', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Bangkok', 'Asia/Beirut', 'Asia/Dhaka',
  'Asia/Dubai', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Irkutsk', 'Asia/Jakarta', 'Asia/Jerusalem',
  'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Krasnoyarsk', 'Asia/Kuala_Lumpur',
  'Asia/Manila', 'Asia/Rangoon', 'Asia/Riyadh', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Taipei', 'Asia/Tehran', 'Asia/Tokyo', 'Asia/Ulaanbaatar', 'Asia/Vladivostok',
  'Asia/Yakutsk', 'Asia/Yangon', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Darwin',
  'Australia/Hobart', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Brussels', 'Europe/Bucharest',
  'Europe/Budapest', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Lisbon',
  'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris', 'Europe/Prague',
  'Europe/Rome', 'Europe/Stockholm', 'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu', 'Pacific/Port_Moresby',
  'UTC',
];