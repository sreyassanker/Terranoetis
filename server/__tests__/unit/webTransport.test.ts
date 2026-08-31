import { describe, expect, it, beforeEach } from 'vitest';
import { WebTransportManager, getWebTransportManager } from '../../utils/webTransport';

describe('WebTransportManager', () => {
  let mgr: WebTransportManager;

  beforeEach(() => {
    mgr = new WebTransportManager({ port: 9999, maxSessions: 5 });
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const defaultMgr = new WebTransportManager();
      const metrics = defaultMgr.getMetrics();
      expect(metrics.activeSessions).toBe(0);
    });

    it('applies custom config', () => {
      expect(mgr.getMetrics().activeSessions).toBe(0);
    });
  });

  describe('handleSession', () => {
    it('creates a new session', () => {
      const session = mgr.handleSession('s1', '192.168.1.1:4433');
      expect(session.id).toBe('s1');
      expect(session.remoteAddr).toBe('192.168.1.1:4433');
      expect(session.bytesReceived).toBe(0);
      expect(session.bytesSent).toBe(0);
    });

    it('tracks active sessions in metrics', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.handleSession('s2', '10.0.0.2:8080');
      expect(mgr.getMetrics().activeSessions).toBe(2);
    });

    it('throws when max sessions reached', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.handleSession('s2', '10.0.0.2:8080');
      mgr.handleSession('s3', '10.0.0.3:8080');
      mgr.handleSession('s4', '10.0.0.4:8080');
      mgr.handleSession('s5', '10.0.0.5:8080');
      expect(() => mgr.handleSession('s6', '10.0.0.6:8080')).toThrow('Max sessions reached');
    });
  });

  describe('sendStream', () => {
    it('returns true for valid session', async () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      const buf = new ArrayBuffer(100);
      const result = await mgr.sendStream('s1', 'stream1', buf);
      expect(result).toBe(true);
    });

    it('returns false for unknown session', async () => {
      const buf = new ArrayBuffer(100);
      const result = await mgr.sendStream('unknown', 'stream1', buf);
      expect(result).toBe(false);
    });

    it('updates bytes sent in session and metrics', async () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      const buf = new ArrayBuffer(256);
      await mgr.sendStream('s1', 'stream1', buf);
      const metrics = mgr.getMetrics();
      expect(metrics.totalBytesSent).toBe(256);
    });
  });

  describe('sendDatagram', () => {
    it('returns true for valid session', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      const buf = new ArrayBuffer(64);
      expect(mgr.sendDatagram('s1', buf)).toBe(true);
    });

    it('returns false for unknown session', () => {
      const buf = new ArrayBuffer(64);
      expect(mgr.sendDatagram('unknown', buf)).toBe(false);
    });

    it('queues datagrams', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.sendDatagram('s1', new ArrayBuffer(10));
      mgr.sendDatagram('s1', new ArrayBuffer(20));
      expect(mgr.getMetrics().totalBytesSent).toBe(30);
    });
  });

  describe('receiveData', () => {
    it('returns a valid StreamChunk', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      const buf = new ArrayBuffer(128);
      const chunk = mgr.receiveData('s1', buf, false);
      expect(chunk.sessionId).toBe('s1');
      expect(chunk.data).toBe(buf);
      expect(chunk.unreliable).toBe(false);
      expect(chunk.streamId).toMatch(/^recv_/);
    });

    it('updates bytes received in session', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.receiveData('s1', new ArrayBuffer(512), false);
      const metrics = mgr.getMetrics();
      expect(metrics.totalBytesReceived).toBe(512);
    });
  });

  describe('closeSession', () => {
    it('removes session', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.closeSession('s1');
      expect(mgr.getMetrics().activeSessions).toBe(0);
    });

    it('reduces active session count', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.handleSession('s2', '10.0.0.2:8080');
      mgr.closeSession('s1');
      expect(mgr.getMetrics().activeSessions).toBe(1);
    });
  });

  describe('stop', () => {
    it('clears all sessions', () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      mgr.handleSession('s2', '10.0.0.2:8080');
      mgr.stop();
      expect(mgr.getMetrics().activeSessions).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('returns uptime >= 0', () => {
      const metrics = mgr.getMetrics();
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });

    it('accumulates total bytes', async () => {
      mgr.handleSession('s1', '10.0.0.1:8080');
      await mgr.sendStream('s1', 'a', new ArrayBuffer(100));
      mgr.sendDatagram('s1', new ArrayBuffer(50));
      mgr.receiveData('s1', new ArrayBuffer(200), false);
      const m = mgr.getMetrics();
      expect(m.totalBytesSent).toBe(150);
      expect(m.totalBytesReceived).toBe(200);
    });
  });
});

describe('getWebTransportManager singleton', () => {
  it('returns the same instance', () => {
    const a = getWebTransportManager();
    const b = getWebTransportManager();
    expect(a).toBe(b);
  });
});
