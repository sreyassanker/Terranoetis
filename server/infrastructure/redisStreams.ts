/**
 * Redis Streams for Event Sourcing
 *
 * Provides persistent, ordered event logs perfect for event sourcing.
 * Geospatial events (earthquakes detected, aircraft entered airspace,
 * threat identified) are published to streams with consumer groups
 * for parallel processing.
 *
 * Features:
 * - Persistent ordered event log
 * - Consumer groups for parallel processing
 * - Message retention policies (max length, max age)
 * - Time-series queries for temporal analysis
 * - Replay capabilities for debugging
 *
 * Redis Streams docs: https://redis.io/docs/data-types/streams/
 */

import { getRedis } from './redis';
import { logger } from '../observability/logger';

export interface StreamEvent {
  id?: string;
  type: string;
  source: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface StreamConsumer {
  id: string;
  group: string;
  lastId: string;
}

const STREAM_PREFIX = 'earth:stream:';
const GROUP_PREFIX = 'earth:group:';

/**
 * Create a consumer group for a stream
 */
export async function createConsumerGroup(
  streamName: string,
  groupName: string,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;
    await redis.xgroup('CREATE', key, groupName, '0', 'MKSTREAM');
    logger.info({ stream: streamName, group: groupName }, 'Consumer group created');
  } catch (e: any) {
    // Group may already exist
    if (!e.message?.includes('BUSYGROUP')) {
      logger.warn({ err: e, stream: streamName }, 'Failed to create consumer group');
    }
  }
}

/**
 * Publish an event to a stream
 * @param streamName Stream name (e.g., 'earthquakes', 'flights', 'sentinel')
 * @param event Event data
 * @returns Message ID
 */
export async function publishEvent(
  streamName: string,
  event: StreamEvent,
): Promise<string | null> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;

    // Convert event to flat field/value pairs for XADD
    const fields: Record<string, string> = {
      type: event.type,
      source: event.source,
      timestamp: String(event.timestamp),
      data: JSON.stringify(event.data),
    };

    const messageId = await redis.xadd(
      key,
      'MAXLEN', '~100000', // Keep approximately 100k events
      '*',
      ...Object.entries(fields).flat(),
    );

    return messageId;
  } catch (e) {
    logger.warn({ err: e, stream: streamName }, 'Failed to publish event');
    return null;
  }
}

/**
 * Consume events from a stream using a consumer group
 * @param streamName Stream name
 * @param groupName Consumer group name
 * @param consumerName Consumer name (unique per worker)
 * @param count Maximum events to consume
 * @returns Array of events
 */
export async function consumeEvents(
  streamName: string,
  groupName: string,
  consumerName: string,
  count: number = 10,
): Promise<StreamEvent[]> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;

    const results = await redis.xreadgroup(
      'GROUP', groupName, consumerName,
      'COUNT', count,
      'BLOCK', 5000, // Block for 5 seconds if no new events
      'STREAMS', key, '>',
    );

    if (!results || results.length === 0) return [];

    const events: StreamEvent[] = [];
    const [_stream, entries] = results[0];

    for (const [messageId, fields] of entries) {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap[fields[i]] = fields[i + 1];
      }

      events.push({
        id: messageId,
        type: fieldMap.type || 'unknown',
        source: fieldMap.source || 'unknown',
        timestamp: parseInt(fieldMap.timestamp) || Date.now(),
        data: JSON.parse(fieldMap.data || '{}'),
      });
    }

    return events;
  } catch (e) {
    logger.warn({ err: e, stream: streamName }, 'Failed to consume events');
    return [];
  }
}

/**
 * Acknowledge processed events
 */
export async function acknowledgeEvents(
  streamName: string,
  groupName: string,
  messageIds: string[],
): Promise<void> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;
    await redis.xack(key, groupName, ...messageIds);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to acknowledge events');
  }
}

/**
 * Get recent events from a stream (without consumer group)
 * @param streamName Stream name
 * @param count Number of recent events to retrieve
 */
export async function getRecentEvents(
  streamName: string,
  count: number = 50,
): Promise<StreamEvent[]> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;

    const results = await redis.xrevrange(key, '+', '-', 'COUNT', count);

    return results.map(([messageId, fields]: [string, string[]]) => {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap[fields[i]] = fields[i + 1];
      }
      return {
        id: messageId,
        type: fieldMap.type || 'unknown',
        source: fieldMap.source || 'unknown',
        timestamp: parseInt(fieldMap.timestamp) || Date.now(),
        data: JSON.parse(fieldMap.data || '{}'),
      };
    });
  } catch (e) {
    logger.warn({ err: e }, 'Failed to get recent events');
    return [];
  }
}

/**
 * Get stream length (approximate)
 */
export async function getStreamLength(streamName: string): Promise<number> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;
    return await redis.xlen(key);
  } catch {
    return 0;
  }
}

/**
 * Trim stream to specific length
 */
export async function trimStream(
  streamName: string,
  maxLen: number,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;
    await redis.xtrim(key, 'MAXLEN', maxLen);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to trim stream');
  }
}

/**
 * Delete a stream
 */
export async function deleteStream(streamName: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = STREAM_PREFIX + streamName;
    await redis.del(key);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to delete stream');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pre-defined streams for the Earth Intelligence platform
// ═══════════════════════════════════════════════════════════════════

export const STREAMS = {
  EARTHQUAKES: 'earthquakes',
  FLIGHTS: 'flights',
  AIS_VESSELS: 'ais_vessels',
  SENTINEL_ALERTS: 'sentinel_alerts',
  MILITARY_TRACKS: 'military_tracks',
  WEATHER_EVENTS: 'weather_events',
  CYBER_EVENTS: 'cyber_events',
  FIRE_DETECTIONS: 'fire_detections',
  USER_ACTIONS: 'user_actions',
  SYSTEM_EVENTS: 'system_events',
} as const;

/**
 * Initialize all default consumer groups
 */
export async function initStreams(): Promise<void> {
  const groups = ['earth-intel-main', 'earth-intel-analytics'];
  const streams = Object.values(STREAMS);

  for (const stream of streams) {
    for (const group of groups) {
      await createConsumerGroup(stream, group);
    }
  }

  logger.info('Redis Streams initialized with consumer groups');
}
