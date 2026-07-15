/**
 * WebTransport HTTP/3 — Low-Latency Real-Time Streaming
 *
 * WebTransport enables multiplexed, bidirectional streaming over HTTP/3.
 * Advantages over WebSocket:
 * - 0-RTT connection establishment
 * - Multiplexed streams (no head-of-line blocking)
 * - Unreliable datagrams for real-time telemetry
 * - Better performance on lossy networks
 *
 * Use cases:
 * - Real-time AIS/ADS-B track streaming
 * - Telemetry feeds (weather radar, seismic)
 * - Multiplayer collaboration on COP
 *
 * Spec: https://w3c.github.io/webtransport/
 * Node.js: @aspect-build/webtransport or experimental node:http3
 */

import { logger } from '../observability/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface WebTransportConfig {
  port: number;
  maxSessions: number;
  certPath?: string;
  keyPath?: string;
}

export interface WebTransportSession {
  id: string;
  remoteAddr: string;
  createdAt: number;
  lastActivity: number;
  streamsOpened: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface StreamChunk {
  sessionId: string;
  streamId: string;
  data: ArrayBuffer;
  timestamp: number;
  unreliable: boolean;
}

export interface TransportMetrics {
  activeSessions: number;
  totalBytesReceived: number;
  totalBytesSent: number;
  totalStreams: number;
  avgLatencyMs: number;
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// WebTransport Manager
// ═══════════════════════════════════════════════════════════════════════════

export class WebTransportManager {
  private sessions = new Map<string, WebTransportSession>();
  private datagramQueue: StreamChunk[] = [];
  private metrics: TransportMetrics = {
    activeSessions: 0,
    totalBytesReceived: 0,
    totalBytesSent: 0,
    totalStreams: 0,
    avgLatencyMs: 0,
    uptime: 0,
  };
  private startTime = Date.now();
  private config: WebTransportConfig;

  constructor(config: Partial<WebTransportConfig> = {}) {
    this.config = {
      port: config.port || 4433,
      maxSessions: config.maxSessions || 100,
      certPath: config.certPath,
      keyPath: config.keyPath,
    };
  }

  /**
   * Start WebTransport server (HTTP/3)
   */
  async start(): Promise<void> {
    logger.info({ port: this.config.port }, '[WebTransport] Starting HTTP/3 server');
    // In production, use @aspect-build/webtransport or node:http3
    // For now, this is a placeholder that logs the configuration
    logger.info({ maxSessions: this.config.maxSessions }, '[WebTransport] Server ready');
  }

  /**
   * Handle new session
   */
  handleSession(sessionId: string, remoteAddr: string): WebTransportSession {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error('Max sessions reached');
    }

    const session: WebTransportSession = {
      id: sessionId,
      remoteAddr,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      streamsOpened: 0,
      bytesReceived: 0,
      bytesSent: 0,
    };

    this.sessions.set(sessionId, session);
    this.metrics.activeSessions = this.sessions.size;
    logger.info({ sessionId, remoteAddr }, '[WebTransport] Session established');

    return session;
  }

  /**
   * Send data on a reliable stream
   */
  async sendStream(sessionId: string, streamId: string, data: ArrayBuffer): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.lastActivity = Date.now();
    session.bytesSent += data.byteLength;
    this.metrics.totalBytesSent += data.byteLength;

    // In production, write to the actual WebTransport stream
    return true;
  }

  /**
   * Send datagram (unreliable, low-latency)
   */
  sendDatagram(sessionId: string, data: ArrayBuffer): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.lastActivity = Date.now();
    session.bytesSent += data.byteLength;
    this.metrics.totalBytesSent += data.byteLength;

    // Queue for batch sending
    this.datagramQueue.push({
      sessionId,
      streamId: 'datagram',
      data,
      timestamp: Date.now(),
      unreliable: true,
    });

    return true;
  }

  /**
   * Receive data from session
   */
  receiveData(sessionId: string, data: ArrayBuffer, unreliable: boolean): StreamChunk {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      session.bytesReceived += data.byteLength;
    }
    this.metrics.totalBytesReceived += data.byteLength;

    return {
      sessionId,
      streamId: `recv_${Date.now()}`,
      data,
      timestamp: Date.now(),
      unreliable,
    };
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.metrics.activeSessions = this.sessions.size;
    logger.info({ sessionId }, '[WebTransport] Session closed');
  }

  /**
   * Get metrics
   */
  getMetrics(): TransportMetrics {
    return {
      ...this.metrics,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Stop server
   */
  stop(): void {
    this.sessions.clear();
    this.datagramQueue = [];
    this.metrics.activeSessions = 0;
    logger.info('[WebTransport] Server stopped');
  }
}

// Singleton
let instance: WebTransportManager | null = null;
export function getWebTransportManager(): WebTransportManager {
  if (!instance) instance = new WebTransportManager();
  return instance;
}
