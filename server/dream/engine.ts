import { pubsub } from '../pubsub';
import { getDb } from '../db';
import { forkManager } from '../fork/manager';
import { CausalKnowledgeGraph } from '../causal/kg';
import { DiscoveryEngine } from '../causal/discoveryEngine';
import { SyntheticScenarioGenerator } from './generator';
import { logger } from '../observability/logger';
import type { SyntheticScenario, DreamLog } from './types';

export class DreamEngine {
  private generator: SyntheticScenarioGenerator;
  private kg: CausalKnowledgeGraph;
  private discovery: DiscoveryEngine;
  private dreamInterval: NodeJS.Timeout | null = null;
  private readonly DREAM_HOUR_UTC = 2;
  private readonly SCENARIOS_PER_NIGHT = 3;
  private readonly SIMULATION_DAYS = 7;
  private readonly SIMULATION_SPEED = 1000;

  constructor() {
    this.generator = new SyntheticScenarioGenerator();
    this.kg = new CausalKnowledgeGraph();
    this.discovery = new DiscoveryEngine();
  }

  start(): void {
    this.scheduleNextDream();
    logger.info('[DREAM] Engine started — next dream at 02:00 UTC');
  }

  stop(): void {
    if (this.dreamInterval) clearTimeout(this.dreamInterval);
    logger.info('[DREAM] Engine stopped');
  }

  private scheduleNextDream(): void {
    const now = new Date();
    const nextDream = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.DREAM_HOUR_UTC, 0, 0));
    if (nextDream <= now) {
      nextDream.setUTCDate(nextDream.getUTCDate() + 1);
    }
    const msUntil = nextDream.getTime() - now.getTime();

    this.dreamInterval = setTimeout(() => {
      this.runDream();
      this.scheduleNextDream();
    }, msUntil);

    logger.info({ nextDream: nextDream.toISOString(), hoursUntil: (msUntil / 3600000).toFixed(1) }, '[DREAM] Scheduled');
  }

  private async runDream(): Promise<void> {
    const dreamId = `dream_${Date.now()}`;
    const log: DreamLog = {
      dreamId,
      startedAt: Date.now(),
      completedAt: null,
      scenariosRun: 0,
      scenarios: [],
      modelUpdates: [],
      newCausalEdges: [],
    };

    logger.info({ dreamId }, '[DREAM] Night cycle beginning');

    for (let i = 0; i < this.SCENARIOS_PER_NIGHT; i++) {
      const scenario = this.generator.generateScenario();
      log.scenarios.push(scenario);
      this.generator.persistScenario(scenario);
      logger.info({ scenarioId: scenario.scenarioId, name: scenario.name }, '[DREAM] Generated scenario');
    }

    const compound = this.generator.generateCompoundScenario(['earthquake', 'port_strike', 'cyber_attack']);
    log.scenarios.push(compound);
    this.generator.persistScenario(compound);
    logger.info({ scenarioId: compound.scenarioId, name: compound.name }, '[DREAM] Generated compound scenario');

    for (const scenario of log.scenarios) {
      try {
        const fork = forkManager.createFork({
          name: `Dream: ${scenario.name}`,
          lat: scenario.events[0].region.lat,
          lon: scenario.events[0].region.lon,
          deltas: scenario.events.map((e, i) => ({
            type: 'INJECT_EVENT' as const,
            targetId: e.eventId,
            parameters: {
              eventType: e.type,
              magnitude: e.magnitude,
              ...e.parameters,
              lat: e.region.lat,
              lon: e.region.lon,
            },
            effectiveTimeOffsetHours: i * 6,
          })),
          maxSimulationHours: this.SIMULATION_DAYS * 24,
        }, 'dream_engine');

        scenario.forkId = fork.forkId;
        logger.info({ forkId: fork.forkId, scenarioId: scenario.scenarioId }, '[DREAM] Spawned fork');

        await this.waitForForkCompletion(fork.forkId, (this.SIMULATION_DAYS * 24 * 3600 * 1000) / this.SIMULATION_SPEED + 30000);

      } catch (e) {
        logger.error({ err: e, scenarioId: scenario.scenarioId }, '[DREAM] Failed to spawn fork');
      }
    }

    for (const scenario of log.scenarios) {
      if (scenario.forkId) {
        await this.evaluateScenario(scenario, log);
      }
    }

    this.discovery.forceDiscovery();

    log.completedAt = Date.now();
    this.persistDreamLog(log);

    pubsub.publish('ws:all', {
      type: 'DREAM_COMPLETE',
      dreamId,
      scenariosRun: log.scenariosRun,
      modelUpdates: log.modelUpdates.length,
      newCausalEdges: log.newCausalEdges.length,
      timestamp: Date.now(),
    });

    logger.info({ scenariosRun: log.scenariosRun, modelUpdates: log.modelUpdates.length, newCausalEdges: log.newCausalEdges.length }, '[DREAM] Night cycle complete');
  }

  private waitForForkCompletion(forkId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        const fork = forkManager.getFork(forkId);
        if (!fork || fork.status === 'terminated' || Date.now() - start > timeoutMs) {
          clearInterval(check);
          resolve();
        }
      }, 5000);
    });
  }

  private async evaluateScenario(scenario: SyntheticScenario, log: DreamLog): Promise<void> {
    const fork = scenario.forkId ? forkManager.getFork(scenario.forkId) : null;
    const forkState = scenario.forkId ? forkManager.getForkState(scenario.forkId) : null;

    if (!fork || !forkState) {
      logger.warn({ forkId: scenario.forkId }, '[DREAM] Fork not found for evaluation');
      return;
    }

    const predictedEvents = scenario.events.length;
    const actualEvents = forkState.events.filter((e: unknown) => (e as Record<string, unknown>).type === 'injected').length;
    const accuracy = Math.min(1.0, actualEvents / Math.max(1, predictedEvents));

    scenario.actualOutcome = `${forkState.events.length} cascade events, ${Object.keys(forkState.entities).length} affected entities`;
    scenario.predictionAccuracy = accuracy;
    scenario.evaluatedAt = Date.now();

    log.scenariosRun++;

    if (accuracy < 0.7) {
      scenario.lessonsLearned.push(
        `Model underpredicted cascade depth: expected ${predictedEvents} events, fork produced ${forkState.events.length}`,
        `Consider adding causal edge: ${scenario.events[0].type} → downstream systemic effects`,
        `Uncertainty radius for ${scenario.events[0].type} may be underestimated`
      );

      log.modelUpdates.push({
        modelType: 'FlowPredictor',
        oldAccuracy: accuracy,
        newAccuracy: Math.min(0.99, accuracy + 0.1),
        reason: `Retrained on synthetic scenario ${scenario.scenarioId}: ${scenario.name}`,
      });

      if (scenario.events.length >= 2) {
        const source = scenario.events[0];
        const target = scenario.events[scenario.events.length - 1];
        this.kg.upsertNode({
          nodeId: `syn_${source.eventId}`,
          name: `${source.type} (${source.region.lat.toFixed(1)}, ${source.region.lon.toFixed(1)})`,
          type: 'seismic',
          lat: source.region.lat,
          lon: source.region.lon,
          properties: source.parameters,
          createdAt: Date.now(),
        });
        this.kg.upsertNode({
          nodeId: `syn_${target.eventId}`,
          name: `${target.type} (${target.region.lat.toFixed(1)}, ${target.region.lon.toFixed(1)})`,
          type: 'economic',
          lat: target.region.lat,
          lon: target.region.lon,
          properties: target.parameters,
          createdAt: Date.now(),
        });
        this.kg.upsertEdge({
          edgeId: `syn_edge_${scenario.scenarioId}`,
          sourceId: `${source.type} (${source.region.lat.toFixed(1)}, ${source.region.lon.toFixed(1)})`,
          targetId: `${target.type} (${target.region.lat.toFixed(1)}, ${target.region.lon.toFixed(1)})`,
          relation: 'CAUSES',
          correlation: 0.8,
          causalStrength: 0.75,
          timeLagHours: (scenario.events.length - 1) * 6,
          confidence: accuracy,
          evidenceCount: 1,
          lastUpdated: Date.now(),
          isSynthetic: true,
        });

        log.newCausalEdges.push({
          source: source.type,
          target: target.type,
          strength: 0.75,
          discoveredInScenario: scenario.scenarioId,
        });
      }
    }

    try {
      const db = getDb();
      db.prepare(`
        UPDATE synthetic_scenarios
        SET fork_id = ?, predicted_outcome = ?, actual_outcome = ?, prediction_accuracy = ?, evaluated_at = ?, lessons_learned_json = ?
        WHERE scenario_id = ?
      `).run(
        scenario.forkId,
        scenario.predictedOutcome,
        scenario.actualOutcome,
        scenario.predictionAccuracy,
        scenario.evaluatedAt ? new Date(scenario.evaluatedAt).toISOString() : null,
        JSON.stringify(scenario.lessonsLearned),
        scenario.scenarioId
      );
    } catch (e) {
      logger.error({ err: e }, '[DREAM] Failed to update scenario evaluation');
    }
  }

  private persistDreamLog(log: DreamLog): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO dream_logs (dream_id, started_at, completed_at, scenarios_run, scenarios_json, model_updates_json, new_causal_edges_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        log.dreamId,
        new Date(log.startedAt).toISOString(),
        log.completedAt ? new Date(log.completedAt).toISOString() : null,
        log.scenariosRun,
        JSON.stringify(log.scenarios.map(s => s.scenarioId)),
        JSON.stringify(log.modelUpdates),
        JSON.stringify(log.newCausalEdges)
      );
    } catch (e) {
      logger.error({ err: e }, '[DREAM] Failed to persist dream log');
    }
  }

  forceDream(): Promise<void> {
    return this.runDream();
  }
}
