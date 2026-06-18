import { pubsub } from '../pubsub';
import { getDb } from '../db';
import type { SyntheticEvent, SyntheticScenario } from './types';

export class SyntheticScenarioGenerator {
  private readonly REGIONS = [
    { name: 'Pacific Ring of Fire', lat: 35.0, lon: 139.0, radiusKm: 2000 },
    { name: 'North Atlantic Hurricane Alley', lat: 25.0, lon: -70.0, radiusKm: 3000 },
    { name: 'Mediterranean Basin', lat: 36.0, lon: 15.0, radiusKm: 1500 },
    { name: 'Southeast Asian Maritime Corridor', lat: 5.0, lon: 105.0, radiusKm: 2500 },
    { name: 'Panama Canal Zone', lat: 9.0, lon: -79.5, radiusKm: 500 },
    { name: 'Arctic Shipping Route', lat: 75.0, lon: 60.0, radiusKm: 3000 },
    { name: 'Horn of Africa', lat: 12.0, lon: 45.0, radiusKm: 1500 },
    { name: 'Chile-Peru Subduction Zone', lat: -30.0, lon: -71.0, radiusKm: 2000 },
  ];

  private readonly EVENT_TEMPLATES = [
    { type: 'earthquake', minMag: 6.0, maxMag: 9.5, params: ['depthKm', 'faultType'] },
    { type: 'hurricane', minMag: 1.0, maxMag: 5.0, params: ['windSpeedKmh', 'pressureMb', 'trackUncertainty'] },
    { type: 'port_strike', minMag: 3.0, maxMag: 8.0, params: ['durationDays', 'affectedPorts', 'unionStrength'] },
    { type: 'cyber_attack', minMag: 4.0, maxMag: 9.0, params: ['targetSector', 'attackVector', 'recoveryHours'] },
    { type: 'tsunami', minMag: 5.0, maxMag: 9.0, params: ['waveHeightM', 'travelSpeedKmh', 'affectedCoastlineKm'] },
    { type: 'volcanic_eruption', minMag: 3.0, maxMag: 8.0, params: ['ashColumnKm', 'vei', 'durationDays'] },
  ] as const;

  generateScenario(): SyntheticScenario {
    const scenarioId = `dream_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const region = this.REGIONS[Math.floor(Math.random() * this.REGIONS.length)];
    const numEvents = 1 + Math.floor(Math.random() * 3);

    const events: SyntheticEvent[] = [];
    for (let i = 0; i < numEvents; i++) {
      const template = this.EVENT_TEMPLATES[Math.floor(Math.random() * this.EVENT_TEMPLATES.length)];
      const magnitude = template.minMag + Math.random() * (template.maxMag - template.minMag);

      const params: Record<string, any> = {};
      for (const param of template.params) {
        params[param] = this.generateParamValue(param);
      }

      const lat = region.lat + (Math.random() - 0.5) * (region.radiusKm / 111);
      const lon = region.lon + (Math.random() - 0.5) * (region.radiusKm / (111 * Math.cos(lat * Math.PI / 180)));

      events.push({
        eventId: `evt_${scenarioId}_${i}`,
        type: template.type as SyntheticEvent['type'],
        region: { lat, lon, radiusKm: region.radiusKm / numEvents },
        magnitude,
        parameters: params,
        isReal: false,
        createdAt: Date.now(),
      });
    }

    return {
      scenarioId,
      name: `${events.map(e => e.type.replace('_', ' ')).join(' + ')} in ${region.name}`,
      events,
      forkId: null,
      predictedOutcome: '',
      actualOutcome: null,
      predictionAccuracy: null,
      evaluatedAt: null,
      lessonsLearned: [],
    };
  }

  generateCompoundScenario(causalChain: string[]): SyntheticScenario {
    const scenarioId = `dream_compound_${Date.now()}`;
    const region = this.REGIONS[Math.floor(Math.random() * this.REGIONS.length)];

    const events: SyntheticEvent[] = causalChain.map((type, i) => {
      const template = this.EVENT_TEMPLATES.find(t => t.type === type) || this.EVENT_TEMPLATES[0];
      const magnitude = template.minMag + Math.random() * (template.maxMag - template.minMag) * (1 + i * 0.3);

      const params: Record<string, any> = {};
      for (const param of template.params) {
        params[param] = this.generateParamValue(param);
      }

      return {
        eventId: `evt_${scenarioId}_${i}`,
        type: type as SyntheticEvent['type'],
        region: { ...region, radiusKm: region.radiusKm / causalChain.length },
        magnitude,
        parameters: params,
        isReal: false,
        createdAt: Date.now() + i * 60000,
      };
    });

    return {
      scenarioId,
      name: `${causalChain.join(' → ')} cascade in ${region.name}`,
      events,
      forkId: null,
      predictedOutcome: '',
      actualOutcome: null,
      predictionAccuracy: null,
      evaluatedAt: null,
      lessonsLearned: [],
    };
  }

  private generateParamValue(param: string): any {
    const generators: Record<string, () => any> = {
      depthKm: () => 5 + Math.random() * 695,
      faultType: () => ['strike-slip', 'thrust', 'normal'][Math.floor(Math.random() * 3)],
      windSpeedKmh: () => 120 + Math.random() * 280,
      pressureMb: () => 880 + Math.random() * 120,
      trackUncertainty: () => 50 + Math.random() * 450,
      durationDays: () => 1 + Math.floor(Math.random() * 30),
      affectedPorts: () => Math.floor(1 + Math.random() * 5),
      unionStrength: () => Math.random(),
      targetSector: () => ['shipping', 'energy', 'finance', 'telecom'][Math.floor(Math.random() * 4)],
      attackVector: () => ['ransomware', 'supply_chain', 'zero_day', 'insider'][Math.floor(Math.random() * 4)],
      recoveryHours: () => 24 + Math.random() * 720,
      waveHeightM: () => 2 + Math.random() * 28,
      travelSpeedKmh: () => 500 + Math.random() * 300,
      affectedCoastlineKm: () => 100 + Math.random() * 1900,
      ashColumnKm: () => 5 + Math.random() * 35,
      vei: () => 2 + Math.floor(Math.random() * 6),
    };
    return (generators[param] || (() => Math.random()))();
  }

  persistScenario(scenario: SyntheticScenario): void {
    try {
      const db = getDb();
      for (const event of scenario.events) {
        db.prepare(`
          INSERT INTO synthetic_events (event_id, scenario_id, event_type, lat, lon, radius_km, magnitude, parameters_json, is_real, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.eventId,
          scenario.scenarioId,
          event.type,
          event.region.lat,
          event.region.lon,
          event.region.radiusKm,
          event.magnitude,
          JSON.stringify(event.parameters),
          0,
          new Date(event.createdAt).toISOString()
        );
      }
      db.prepare(`
        INSERT INTO synthetic_scenarios (scenario_id, name, events_json, fork_id, predicted_outcome, actual_outcome, prediction_accuracy, evaluated_at, lessons_learned_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scenario.scenarioId,
        scenario.name,
        JSON.stringify(scenario.events.map(e => e.eventId)),
        scenario.forkId,
        scenario.predictedOutcome,
        scenario.actualOutcome,
        scenario.predictionAccuracy,
        scenario.evaluatedAt ? new Date(scenario.evaluatedAt).toISOString() : null,
        JSON.stringify(scenario.lessonsLearned),
        new Date().toISOString()
      );
    } catch (e) {
      console.error('[DREAM] Failed to persist scenario:', e);
    }
  }
}
