/**
 * Kill Chain + MITRE ATT&CK Mapping — Physical-Digital Fusion
 *
 * Maps cyber threats to MITRE ATT&CK techniques and visualizes
 * kill chain stages geographically on the COP.
 *
 * When a cyber attack is detected, trace it to physical infrastructure
 * (data centers, ISP locations, military installations).
 *
 * References:
 * - MITRE ATT&CK: https://attack.mitre.org/
 * - Lockheed Martin Cyber Kill Chain: https://www.lockheedmartin.com/en-us/capabilities/cyber/cyber-kill-chain.html
 */

import * as Cesium from 'cesium';
import { BaseManager } from '../baseManager';
import type { CyberThreat, CyberAsset_, CyberKillChain, CyberAttackPhase } from './cyberTypes';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface MitreTechnique {
  id: string;            // e.g., T1566
  name: string;          // e.g., 'Phishing'
  tactic: string;        // e.g., 'Initial Access'
  description: string;
  url: string;
}

export interface KillChainStage {
  phase: CyberAttackPhase;
  label: string;
  mitreTactics: string[];
  mitreTechniques: MitreTechnique[];
  color: Cesium.Color;
  order: number;
}

export interface KillChainVisualization {
  chainId: string;
  threatId: string;
  threatName: string;
  stages: KillChainStage[];
  currentPhase: CyberAttackPhase;
  progress: number;          // 0-1
  targetLat: number;
  targetLon: number;
  sourceLat?: number;
  sourceLon?: number;
}

export interface KillChainStatus {
  activeChains: number;
  completedChains: number;
  averageTimeToDetect: number;
  mostCommonTechnique: string;
  chains: KillChainVisualization[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MITRE ATT&CK Technique Database
// ═══════════════════════════════════════════════════════════════════════════

const KILL_CHAIN_STAGES: KillChainStage[] = [
  {
    phase: 'reconnaissance',
    label: 'Reconnaissance',
    mitreTactics: ['TA0043'],
    mitreTechniques: [
      { id: 'T1595', name: 'Active Scanning', tactic: 'Reconnaissance', description: 'Adversary scans target infrastructure', url: 'https://attack.mitre.org/techniques/T1595' },
      { id: 'T1592', name: 'Gather Victim Host Info', tactic: 'Reconnaissance', description: 'Collect information about victim hosts', url: 'https://attack.mitre.org/techniques/T1592' },
    ],
    color: Cesium.Color.fromCssColorString('#94a3b8'),
    order: 0,
  },
  {
    phase: 'weaponization',
    label: 'Weaponization',
    mitreTactics: ['TA0001'],
    mitreTechniques: [
      { id: 'T1583', name: 'Acquire Infrastructure', tactic: 'Resource Development', description: 'Set up attack infrastructure', url: 'https://attack.mitre.org/techniques/T1583' },
      { id: 'T1587', name: 'Develop Capabilities', tactic: 'Resource Development', description: 'Create exploit code and malware', url: 'https://attack.mitre.org/techniques/T1587' },
    ],
    color: Cesium.Color.fromCssColorString('#a78bfa'),
    order: 1,
  },
  {
    phase: 'delivery',
    label: 'Delivery',
    mitreTactics: ['TA0001'],
    mitreTechniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', description: 'Deliver malicious payload via email', url: 'https://attack.mitre.org/techniques/T1566' },
      { id: 'T1195', name: 'Supply Chain Compromise', tactic: 'Initial Access', description: 'Compromise software supply chain', url: 'https://attack.mitre.org/techniques/T1195' },
    ],
    color: Cesium.Color.fromCssColorString('#f472b6'),
    order: 2,
  },
  {
    phase: 'exploitation',
    label: 'Exploitation',
    mitreTactics: ['TA0001', 'TA0002'],
    mitreTechniques: [
      { id: 'T1203', name: 'Exploitation for Client Execution', tactic: 'Execution', description: 'Exploit vulnerabilities in client software', url: 'https://attack.mitre.org/techniques/T1203' },
      { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', description: 'Exploit web application vulnerabilities', url: 'https://attack.mitre.org/techniques/T1190' },
    ],
    color: Cesium.Color.fromCssColorString('#f97316'),
    order: 3,
  },
  {
    phase: 'installation',
    label: 'Installation',
    mitreTactics: ['TA0002', 'TA0003'],
    mitreTechniques: [
      { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', description: 'Execute commands on victim system', url: 'https://attack.mitre.org/techniques/T1059' },
      { id: 'T1547', name: 'Boot or Logon Autostart Execution', tactic: 'Persistence', description: 'Establish persistence via startup', url: 'https://attack.mitre.org/techniques/T1547' },
    ],
    color: Cesium.Color.fromCssColorString('#ef4444'),
    order: 4,
  },
  {
    phase: 'command_control',
    label: 'Command & Control',
    mitreTactics: ['TA0011'],
    mitreTechniques: [
      { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command and Control', description: 'Use common protocols for C2', url: 'https://attack.mitre.org/techniques/T1071' },
      { id: 'T1572', name: 'Protocol Tunneling', tactic: 'Command and Control', description: 'Tunnel C2 through allowed protocols', url: 'https://attack.mitre.org/techniques/T1572' },
    ],
    color: Cesium.Color.fromCssColorString('#dc2626'),
    order: 5,
  },
  {
    phase: 'actions_on_objectives',
    label: 'Actions on Objectives',
    mitreTactics: ['TA0040'],
    mitreTechniques: [
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', description: 'Ransomware encryption', url: 'https://attack.mitre.org/techniques/T1486' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', description: 'Steal data via C2 channel', url: 'https://attack.mitre.org/techniques/T1041' },
    ],
    color: Cesium.Color.fromCssColorString('#b91c1c'),
    order: 6,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Kill Chain Renderer
// ═══════════════════════════════════════════════════════════════════════════

export class KillChainRenderer extends BaseManager<KillChainStatus> {
  private chains = new Map<string, KillChainVisualization>();
  private entities = new Map<string, Cesium.Entity[]>();

  /**
   * Render a kill chain visualization on the globe
   */
  addKillChain(
    chainId: string,
    threat: CyberThreat,
    asset?: CyberAsset_,
  ): void {
    if (!this.viewer) return;

    const currentPhaseIdx = KILL_CHAIN_STAGES.findIndex(
      (s) => s.phase === threat.phase,
    );
    const progress = currentPhaseIdx >= 0 ? currentPhaseIdx / (KILL_CHAIN_STAGES.length - 1) : 0;

    const targetLat = asset?.lat ?? 0;
    const targetLon = asset?.lon ?? 0;

    const viz: KillChainVisualization = {
      chainId,
      threatId: threat.id,
      threatName: threat.name,
      stages: KILL_CHAIN_STAGES,
      currentPhase: threat.phase,
      progress,
      targetLat,
      targetLon,
    };

    this.chains.set(chainId, viz);
    this.renderChain(viz);
  }

  /**
   * Remove a kill chain visualization
   */
  removeKillChain(chainId: string): void {
    const ents = this.entities.get(chainId);
    if (ents) {
      for (const e of ents) {
        this.removeEntity(e.id);
      }
      this.entities.delete(chainId);
    }
    this.chains.delete(chainId);
  }

  /**
   * Get all active kill chain visualizations
   */
  getChains(): KillChainVisualization[] {
    return Array.from(this.chains.values());
  }

  /**
   * Get kill chain status summary
   */
  getStatus(): KillChainStatus {
    const chains = this.getChains();
    return {
      activeChains: chains.length,
      completedChains: 0,
      averageTimeToDetect: 0,
      mostCommonTechnique: 'T1566',
      chains,
    };
  }

  private renderChain(viz: KillChainVisualization): void {
    if (!this.viewer) return;
    const ents: Cesium.Entity[] = [];

    // Render target marker
    if (viz.targetLat !== 0 || viz.targetLon !== 0) {
      const targetEnt = this.createEntity(`killchain_target_${viz.chainId}`, {
        position: Cesium.Cartesian3.fromDegrees(viz.targetLon, viz.targetLat, 5000),
        point: {
          pixelSize: 10,
          color: KILL_CHAIN_STAGES.find((s) => s.phase === viz.currentPhase)?.color || Cesium.Color.RED,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${viz.currentPhase.replace(/_/g, ' ').toUpperCase()}`,
          font: '11px Space Grotesk, sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          showBackground: true,
          backgroundColor: KILL_CHAIN_STAGES.find((s) => s.phase === viz.currentPhase)?.color || Cesium.Color.RED,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { layer: 'kill_chain', chainId: viz.chainId, threatId: viz.threatId },
      });
      if (targetEnt) ents.push(targetEnt);
    }

    // Render progress ring
    if (viz.targetLat !== 0 || viz.targetLon !== 0) {
      const ringEnt = this.createEntity(`killchain_ring_${viz.chainId}`, {
        position: Cesium.Cartesian3.fromDegrees(viz.targetLon, viz.targetLat, 1000),
        ellipse: {
          semiMajorAxis: 20000,
          semiMinorAxis: 20000,
          material: KILL_CHAIN_STAGES.find((s) => s.phase === viz.currentPhase)?.color.withAlpha(0.15) || Cesium.Color.RED.withAlpha(0.15),
          outline: true,
          outlineColor: KILL_CHAIN_STAGES.find((s) => s.phase === viz.currentPhase)?.color.withAlpha(0.5) || Cesium.Color.RED.withAlpha(0.5),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: { layer: 'kill_chain_ring', chainId: viz.chainId },
      });
      if (ringEnt) ents.push(ringEnt);
    }

    this.entities.set(viz.chainId, ents);
  }

  renderAll(): void {
    this.chains.forEach((viz) => this.renderChain(viz));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the kill chain stage for a given phase
 */
export function getKillChainStage(phase: CyberAttackPhase): KillChainStage | undefined {
  return KILL_CHAIN_STAGES.find((s) => s.phase === phase);
}

/**
 * Get all kill chain stages in order
 */
export function getAllKillChainStages(): KillChainStage[] {
  return [...KILL_CHAIN_STAGES];
}

/**
 * Get MITRE ATT&CK techniques for a given phase
 */
export function getMitreTechniquesForPhase(phase: CyberAttackPhase): MitreTechnique[] {
  const stage = KILL_CHAIN_STAGES.find((s) => s.phase === phase);
  return stage?.mitreTechniques || [];
}

/**
 * Calculate kill chain progress percentage
 */
export function calculateProgress(currentPhase: CyberAttackPhase): number {
  const idx = KILL_CHAIN_STAGES.findIndex((s) => s.phase === currentPhase);
  return idx >= 0 ? idx / (KILL_CHAIN_STAGES.length - 1) : 0;
}
