import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { causalGraph, type CausalRelation } from '../world-model/causalGraph';
import { memoryManagerV2 } from '../memoryV2/memoryManagerV2';

export interface WaveformSample {
  time: number;
  amplitude: number;
}

export interface SeismicEvent {
  id: string;
  network: string;
  station: string;
  lat: number;
  lon: number;
  time: number;
  magnitude: number;
  depth: number;
  pArrival?: number;
  sArrival?: number;
  dominantFreq: number;
  duration: number;
  energy: number;
  eventType: 'earthquake' | 'quarry_blast' | 'nuclear_test' | 'unknown';
}

export interface Spectrogram {
  freqs: number[];
  times: number[];
  amplitudes: number[][];
}

export class SeismicProcessor {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly irisBase = 'https://service.iris.edu/fdsnws/event/1';

  init(): void {
    this.ensureTables();
    logger.info('SeismicProcessor initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.pollEvents(), 120000);
    logger.info('SeismicProcessor started');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    logger.info('SeismicProcessor stopped');
  }

  /** Fetch recent seismic events from IRIS/FDSN */
  async fetchEvents(minMag = 2.5, hoursBack = 24): Promise<SeismicEvent[]> {
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - hoursBack * 3600000).toISOString();
    const url = `${this.irisBase}/query?format=geojson&starttime=${startTime}&endtime=${endTime}&minmagnitude=${minMag}&orderby=time`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json() as { features?: Array<Record<string, unknown>> };
      const features = data.features || [];

      return features.map((f: Record<string, unknown>) => {
        const props = f.properties as Record<string, unknown> || {};
        const coords = (f.geometry as Record<string, unknown>)?.coordinates as number[] || [];
        const mag = (props.mag as number) || 0;
        const depth = coords[2] || 0;

        return {
          id: (props.id as string) || `${f.id}` || `seismic_${Date.now()}`,
          network: (props.net as string) || 'unknown',
          station: (props.place as string) || 'unknown',
          lat: coords[1] || 0,
          lon: coords[0] || 0,
          time: new Date(props.time as string || Date.now()).getTime(),
          magnitude: mag,
          depth,
          dominantFreq: this.estimateDominantFreq(mag),
          duration: this.estimateDuration(mag),
          energy: this.calculateEnergy(mag),
          eventType: (mag > 4.5 ? 'earthquake' : 'unknown') as 'earthquake' | 'quarry_blast' | 'nuclear_test' | 'unknown',
        } as SeismicEvent;
      }).filter(e => e.lat !== 0 || e.lon !== 0);
    } catch {
      return [];
    }
  }

  /** Process waveform: filter, detrend, extract features */
  processWaveform(samples: WaveformSample[], sampleRate: number): {
    filtered: WaveformSample[];
    spectrogram: Spectrogram;
    pArrival: number | null;
    sArrival: number | null;
    dominantFreq: number;
    energy: number;
  } {
    // Detrend: remove DC offset
    const mean = samples.reduce((s, x) => s + x.amplitude, 0) / samples.length;
    const detrended = samples.map(s => ({ time: s.time, amplitude: s.amplitude - mean }));

    // Simple low-pass filter (moving average)
    const windowSize = Math.max(1, Math.floor(sampleRate / 10));
    const filtered: WaveformSample[] = [];
    for (let i = 0; i < detrended.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(detrended.length, i + windowSize);
      let sum = 0;
      for (let j = start; j < end; j++) sum += detrended[j].amplitude;
      filtered.push({ time: detrended[i].time, amplitude: sum / (end - start) });
    }

    // FFT approximation — find dominant frequency from zero-crossings
    let zeroCrossings = 0;
    for (let i = 1; i < filtered.length; i++) {
      if (filtered[i].amplitude * filtered[i - 1].amplitude < 0) zeroCrossings++;
    }
    const dominantFreq = (zeroCrossings / 2) / (samples.length / sampleRate);

    // Energy (approximate RMS)
    const rms = Math.sqrt(samples.reduce((s, x) => s + x.amplitude * x.amplitude, 0) / samples.length);

    // Simple spectrogram (frequency bins over time windows)
    const windowMs = 100;
    const samplesPerWindow = Math.floor(sampleRate * windowMs / 1000);
    const times: number[] = [];
    const freqs: number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * dominantFreq / 5);
    const amplitudes: number[][] = [];

    for (let i = 0; i < filtered.length; i += samplesPerWindow) {
      times.push(filtered[i].time);
      const windowData = filtered.slice(i, Math.min(i + samplesPerWindow, filtered.length));
      const energy = Math.sqrt(windowData.reduce((s, x) => s + x.amplitude * x.amplitude, 0) / windowData.length);
      amplitudes.push(freqs.map(() => energy));
    }

    // P-wave and S-wave arrival detection (STA/LTA algorithm)
    const pArrival = this.detectPArrival(filtered, sampleRate);
    const sArrival = pArrival !== null ? pArrival + this.estimateSMiss(dominantFreq) : null;

    return {
      filtered,
      spectrogram: { freqs, times, amplitudes },
      pArrival,
      sArrival,
      dominantFreq,
      energy: rms,
    };
  }

  /** Detect P-wave arrival using short-term / long-term average ratio */
  private detectPArrival(samples: WaveformSample[], sampleRate: number): number | null {
    if (samples.length < 100) return null;

    const staWindow = Math.floor(sampleRate * 0.5);
    const ltaWindow = Math.floor(sampleRate * 10);

    let sta = 0;
    let lta = 0;

    for (let i = 0; i < samples.length; i++) {
      const absVal = Math.abs(samples[i].amplitude);
      if (i < ltaWindow) {
        lta += absVal;
      } else if (i < ltaWindow + staWindow) {
        sta += absVal;
      } else {
        sta += absVal;
        sta -= Math.abs(samples[i - staWindow].amplitude);
        lta += absVal;
        lta -= Math.abs(samples[i - ltaWindow].amplitude);

        const ratio = (sta / staWindow) / (lta / ltaWindow);
        if (ratio > 3.0) {
          return samples[i - staWindow].time;
        }
      }
    }
    return null;
  }

  /** Estimate magnitude from waveform features */
  estimateMagnitude(maxAmplitude: number, distanceKm: number): number {
    // Simplified Richter scale approximation
    return Math.log10(maxAmplitude * 1000) + 3 * Math.log10(distanceKm) - 2.5;
  }

  /** Compute spectrogram for a given waveform */
  computeSpectrogram(samples: WaveformSample[], sampleRate: number): Spectrogram {
    const result = this.processWaveform(samples, sampleRate);
    return result.spectrogram;
  }

  /** Add seismic event to causal graph for world model integration */
  addToCausalGraph(event: SeismicEvent): void {
    causalGraph.addNode(event.id, 'event', 0.5, {
      magnitude: event.magnitude,
      depth: event.depth,
      time: event.time,
      dominantFreq: event.dominantFreq,
      eventType: event.eventType,
    }).catch(() => {});

    // Create causal links to nearby hazards
    const db = getDb();
    const recentEvents = db.prepare(
      'SELECT * FROM seismic_events WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND id != ? ORDER BY time DESC LIMIT 5',
    ).all(
      event.lat - 2, event.lat + 2,
      event.lon - 2, event.lon + 2,
      event.id,
    ) as SeismicEvent[];

    for (const prev of recentEvents) {
      const timeDelta = Math.abs(event.time - prev.time) / 3600000;
      if (timeDelta < 48) {
        causalGraph.addEdge(prev.id, event.id, 'correlates' as CausalRelation, 1.0 / (1 + timeDelta / 24)).catch(() => {});
      }
    }

    memoryManagerV2.store('episodic', { userId: '', query: 'seismic_event', response: JSON.stringify(event), intentType: 'seismic' } as unknown as Record<string, unknown>).catch(() => {});
  }

  /** Bulk-store events in DB, publish new ones */
  async pollEvents(): Promise<SeismicEvent[]> {
    const events = await this.fetchEvents();
    const db = getDb();
    let newCount = 0;

    for (const event of events) {
      const existing = db.prepare('SELECT id FROM seismic_events WHERE id = ?').get(event.id);
      if (!existing) {
        db.prepare(
          'INSERT INTO seismic_events (id, network, station, lat, lon, time, magnitude, depth, dominant_freq, duration, energy, event_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))',
        ).run(event.id, event.network, event.station, event.lat, event.lon, event.time, event.magnitude, event.depth, event.dominantFreq, event.duration, event.energy, event.eventType);

        this.addToCausalGraph(event);
        pubsub.publish('seismic:event', event);
        newCount++;
      }
    }

    if (newCount > 0) {
      logger.info({ newEvents: newCount }, 'Seismic poll complete');
    }

    return events;
  }

  /** Query historical seismic events for a region */
  queryHistory(lat: number, lon: number, radiusDeg = 2, limit = 20): SeismicEvent[] {
    try {
      const db = getDb();
      return db.prepare(
        'SELECT * FROM seismic_events WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY magnitude DESC LIMIT ?',
      ).all(lat - radiusDeg, lat + radiusDeg, lon - radiusDeg, lon + radiusDeg, limit) as SeismicEvent[];
    } catch { return []; }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM seismic_events').get() as { c: number }).c;
      const lastMag = db.prepare('SELECT magnitude FROM seismic_events ORDER BY time DESC LIMIT 1').get() as { magnitude: number } | undefined;
      return { totalEvents: count, lastMagnitude: lastMag?.magnitude || 0, running: this.running };
    } catch { return { totalEvents: 0, lastMagnitude: 0, running: this.running }; }
  }

  private estimateDominantFreq(mag: number): number {
    if (mag < 3) return 5;
    if (mag < 5) return 2;
    return 0.5;
  }

  private estimateDuration(mag: number): number {
    return Math.max(1, mag * mag * 0.5);
  }

  private calculateEnergy(mag: number): number {
    return Math.pow(10, 1.5 * mag + 4.8);
  }

  private estimateSMiss(domFreq: number): number {
    return 1000 / domFreq * 1.73; // Vp/Vs ≈ 1.73
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS seismic_events (
          id TEXT PRIMARY KEY,
          network TEXT,
          station TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          time INTEGER NOT NULL,
          magnitude REAL,
          depth REAL,
          dominant_freq REAL,
          duration REAL,
          energy REAL,
          event_type TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_seismic_time ON seismic_events(time DESC);
        CREATE INDEX IF NOT EXISTS idx_seismic_location ON seismic_events(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_seismic_magnitude ON seismic_events(magnitude DESC);

        CREATE TABLE IF NOT EXISTS waveform_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL,
          samples_json TEXT NOT NULL,
          sample_rate REAL NOT NULL,
          features_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch { /* tables exist */ }
  }
}

export const seismicProcessor = new SeismicProcessor();
