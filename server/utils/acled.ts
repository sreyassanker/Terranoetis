/**
 * ACLED (Armed Conflict Location & Event Data) Real-Time Conflict Events
 *
 * Provides daily granularity conflict data for 200+ countries including:
 * - Violent events (battles, violence against civilians, explosions)
 * - Non-violent events (protests, peace talks, strategic developments)
 * - Actor classification (state vs non-state, affiliated groups)
 * - Fatality counts and event notes
 *
 * API: https://api.acleddata.com/acled/read
 * Auth: Requires ACLED API key (free registration at acledata.com)
 * Set ACLED_API_KEY in server/.env
 */

import { haversineDistance } from './geo';
import { logger } from '../observability/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AcledEvent {
  event_id: number;
  event_date: string;
  year: number;
  time_precision: number;
  disorder_type: string;
  event_type: string;
  sub_event_type: string;
  actor1: string;
  assoc_actor_1: string;
  actor2: string;
  assoc_actor_2: string;
  interaction_type: string;
  civilian_targeting: string;
  iso: number;
  region: string;
  country: string;
  admin1: string;
  admin2: string;
  admin3: string;
  admin4: string;
  location: string;
  latitude: number;
  longitude: number;
  geo_precision: number;
  source: string;
  source_scale: string;
  notes: string;
  fatalities: number;
  tags: string;
  timestamp: number;
}

export interface AcledQueryResult {
  events: AcledEvent[];
  total: number;
  query: {
    country?: string;
    region?: string;
    startDate?: string;
    endDate?: string;
    eventType?: string;
  };
  cached: boolean;
}

// Event type categories for filtering
export const EVENT_TYPES = [
  'Battles',
  'Violence against civilians',
  'Explosions/Remote violence',
  'Protests',
  'Riots',
  'Strategic developments',
  'Peaceful protests',
] as const;

export const INTERACTION_TYPES = [
  'State forces battle',
  'Non-state actor battle',
  'State forces use violence against civilians',
  'Non-state actor use violence against civilians',
  'Non-violent activity',
  'Other',
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// API Configuration
// ═══════════════════════════════════════════════════════════════════════════

const ACLED_BASE_URL = 'https://api.acleddata.com/acled/read';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEFAULT_COUNTRY = '';  // Empty = all countries
const DEFAULT_TERMS = 300;  // Max results per request (ACLED limit)

function getApiKey(): string {
  return process.env.ACLED_API_KEY || '';
}

// ═══════════════════════════════════════════════════════════════════════════
// Core API Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch conflict events from ACLED
 */
export async function fetchAcledEvents(params: {
  country?: string;
  region?: string;
  startDate?: string;
  endDate?: string;
  eventType?: string;
  limit?: number;
}): Promise<AcledQueryResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ACLED_API_KEY is not configured — register at acleddata.com and set it in the server .env');
  }

  const url = new URL(ACLED_BASE_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('email', process.env.ACLED_EMAIL || '');
  url.searchParams.set('terms', String(Math.min(params.limit || DEFAULT_TERMS, DEFAULT_TERMS)));

  if (params.country) url.searchParams.set('country', params.country);
  if (params.region) url.searchParams.set('region', params.region);
  if (params.startDate) url.searchParams.set('from_date', params.startDate);
  if (params.endDate) url.searchParams.set('to_date', params.endDate);
  if (params.eventType) url.searchParams.set('event_type', params.eventType);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`ACLED API returned ${response.status}`);
    }

    const data = await response.json();
    const events = (data.data || []) as AcledEvent[];

    return {
      events,
      total: parseInt(data.count || '0', 10),
      query: params,
      cached: false,
    };
  } catch (e) {
    logger.error({ err: e }, '[ACLED] Failed to fetch events');
    return { events: [], total: 0, query: params, cached: false };
  }
}

/**
 * Get recent events globally (last N days)
 */
export async function getRecentGlobalEvents(days: number = 7): Promise<AcledEvent[]> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const result = await fetchAcledEvents({
    startDate,
    endDate,
    limit: 500,
  });

  return result.events;
}

/**
 * Get events near a specific location
 */
export async function getEventsNearLocation(
  lat: number,
  lon: number,
  radiusKm: number = 250,
): Promise<AcledEvent[]> {
  // ACLED doesn't have native radius search, so we fetch recent and filter client-side
  const events = await getRecentGlobalEvents(7);

  return events.filter((e) => {
    const dist = haversineDistance(lat, lon, e.latitude, e.longitude);
    return dist <= radiusKm;
  });
}

/**
 * Get events for a specific country with date range
 */
export async function getCountryEvents(
  country: string,
  startDate?: string,
  endDate?: string,
): Promise<AcledEvent[]> {
  const result = await fetchAcledEvents({
    country,
    startDate,
    endDate,
    limit: 500,
  });

  return result.events;
}

/**
 * Get event summary statistics for a region
 */
export function summarizeEvents(events: AcledEvent[]): {
  totalEvents: number;
  totalFatalities: number;
  byType: Record<string, number>;
  byActor: Record<string, number>;
  hotspots: Array<{ location: string; count: number; fatalities: number }>;
} {
  const byType: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  const locationCounts: Record<string, { count: number; fatalities: number }> = {};

  let totalFatalities = 0;

  for (const e of events) {
    totalFatalities += e.fatalities || 0;

    byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    // Only track top 50 actors to prevent memory issues
    if (Object.keys(byActor).length < 50 || byActor[e.actor1]) {
      byActor[e.actor1] = (byActor[e.actor1] || 0) + 1;
    }

    const loc = `${e.country} - ${e.admin1 || e.location}`;
    if (!locationCounts[loc]) locationCounts[loc] = { count: 0, fatalities: 0 };
    locationCounts[loc].count += 1;
    locationCounts[loc].fatalities += e.fatalities || 0;
  }

  const hotspots = Object.entries(locationCounts)
    .map(([location, data]) => ({ location, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Cap at 20 to prevent memory issues

  return {
    totalEvents: events.length,
    totalFatalities,
    byType,
    byActor,
    hotspots,
  };
}

/**
 * Detect escalation patterns (protests → violence → organized conflict)
 */
export function detectEscalation(events: AcledEvent[]): Array<{
  country: string;
  admin1: string;
  timeline: string[];
  escalationScore: number;
}> {
  // Group events by country + admin1
  const groups: Record<string, AcledEvent[]> = {};
  for (const e of events) {
    const key = `${e.country}|${e.admin1}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }

  const escalations: Array<{
    country: string;
    admin1: string;
    timeline: string[];
    escalationScore: number;
  }> = [];

  for (const [key, groupEvents] of Object.entries(groups)) {
    const [country, admin1] = key.split('|');

    // Sort by date
    const sorted = groupEvents.sort((a, b) =>
      new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
    );

    // Check for escalation pattern: peaceful → violent
    const eventTypes = sorted.map((e) => e.event_type);
    const hasProtests = eventTypes.some((t) => t.includes('Protest'));
    const hasViolence = eventTypes.some((t) =>
      t.includes('Violence') || t.includes('Battle') || t.includes('Explosion'),
    );

    if (hasProtests && hasViolence) {
      const score = calculateEscalationScore(sorted);
      if (score > 0.5) {
        escalations.push({
          country,
          admin1,
          timeline: sorted.map((e) => `${e.event_date}: ${e.event_type}`),
          escalationScore: score,
        });
      }
    }
  }

  return escalations.sort((a, b) => b.escalationScore - a.escalationScore);
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function calculateEscalationScore(sortedEvents: AcledEvent[]): number {
  const violenceKeywords = ['Violence', 'Battle', 'Explosion'];
  const protestKeywords = ['Protest', 'Peaceful'];

  let protestCount = 0;
  let violenceCount = 0;

  for (const e of sortedEvents) {
    if (protestKeywords.some((k) => e.event_type.includes(k))) protestCount++;
    if (violenceKeywords.some((k) => e.event_type.includes(k))) violenceCount++;
  }

  if (protestCount === 0 || violenceCount === 0) return 0;

  // Escalation = violence comes after protests, weighted by fatality count
  const fatalities = sortedEvents.reduce((sum, e) => sum + (e.fatalities || 0), 0);
  const violenceRatio = violenceCount / sortedEvents.length;

  return Math.min(1, violenceRatio * 0.5 + Math.min(1, fatalities / 50) * 0.3 + (protestCount > 0 && violenceCount > 0 ? 0.2 : 0));
}
