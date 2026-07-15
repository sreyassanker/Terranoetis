export type CyberAttackPhase = 'reconnaissance' | 'weaponization' | 'delivery' | 'exploitation' | 'installation' | 'command_control' | 'actions_on_objectives';
export type CyberAsset = 'network' | 'endpoint' | 'server' | 'database' | 'scada' | 'comms';

export interface CyberThreat {
  id: string;
  name: string;
  phase: CyberAttackPhase;
  sourceIp: string;
  targetIp: string;
  targetAsset: CyberAsset;
  severity: 'critical' | 'high' | 'medium' | 'low';
  mitreId: string;
  timestamp: number;
}

export interface CyberAsset_ {
  id: string;
  name: string;
  type: CyberAsset;
  ip: string;
  lat: number;
  lon: number;
  status: 'operational' | 'degraded' | 'compromised' | 'offline';
  lastScan: number;
}

export interface CyberKillChain {
  id: string;
  threatId: string;
  phases: CyberAttackPhase[];
  currentPhase: CyberAttackPhase;
  indicators: string[];
}

export interface CyberStatus {
  threats: CyberThreat[];
  assets: CyberAsset_[];
  killChains: CyberKillChain[];
  activeThreats: number;
  compromisedAssets: number;
}
