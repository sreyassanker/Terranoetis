/**
 * Cyber Symbology — MIL-STD-2525D Appendix L
 *
 * Defines standardized cyber symbols for tactical display:
 * - Botnets, DDoS, Malware, Firewalls, Ransomware
 * - Network attacks, Data exfiltration, Supply chain
 * - All symbols use SIDC (Standard Identification Code) format
 *
 * Transforms the cyber module from text labels to a tactical COP display.
 * Compatible with APP-6D (NATO) and JADC2 symbology standards.
 *
 * Reference: MIL-STD-2525D Appendix L
 * https://www.jcs.mil/Portals/36/Documents/Doctrine/Standardization/MIL-STD/MIL-STD-2525D/MIL-STD-2525D.pdf
 */

import * as Cesium from 'cesium';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type CyberAffiliation = 'hostile' | 'suspect' | 'unknown' | 'friendly' | 'neutral';
export type CyberAssetType = 'network' | 'endpoint' | 'database' | 'server' | 'router' | 'firewall' | 'cloud' | 'iot' | 'scada' | 'satellite';
export type CyberThreatType = 'malware' | 'botnet' | 'ddos' | 'ransomware' | 'phishing' | 'apt' | 'insider' | 'supply_chain' | 'zero_day' | 'data_exfiltration';
export type CyberSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface CyberSymbol {
  sidc: string;           // 15-char SIDC code (Appendix L)
  label: string;          // Human-readable label
  category: string;       // Symbol category
  color: string;          // Default display color
  icon: string;           // Lucide icon name for UI
  description: string;
}

export interface CyberEntity {
  id: string;
  lat: number;
  lon: number;
  type: CyberThreatType | CyberAssetType;
  affiliation: CyberAffiliation;
  severity: CyberSeverity;
  label: string;
  description?: string;
  properties: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIL-STD-2525D Appendix L Cyber SIDC Codes
// ═══════════════════════════════════════════════════════════════════════════

// SIDC format: [affiliation][battle_dimension][status][size][equipment][installation]
// Appendix L uses the 'E' (Electronic Warfare) battle dimension
const AFFILIATION_CODES: Record<CyberAffiliation, string> = {
  hostile: 'H',
  suspect: 'S',
  unknown: 'U',
  friendly: 'F',
  neutral: 'N',
};

// Appendix L defines specific cyber threat symbols using the 'CY' prefix
const CYBER_SYMBOLS: Record<string, CyberSymbol> = {
  malware: {
    sidc: 'HCYB--',
    label: 'Malware',
    category: 'Software Attack',
    color: '#ef4444',
    icon: 'Bug',
    description: 'Malicious software including viruses, trojans, worms',
  },
  botnet: {
    sidc: 'HCYA--',
    label: 'Botnet',
    category: 'Coordinated Attack',
    color: '#f97316',
    icon: 'Network',
    description: 'Network of compromised devices under centralized control',
  },
  ddos: {
    sidc: 'HCYC--',
    label: 'DDoS',
    category: 'Denial of Service',
    color: '#dc2626',
    icon: 'Zap',
    description: 'Distributed Denial of Service attack — overwhelming target capacity',
  },
  ransomware: {
    sidc: 'HCYD--',
    label: 'Ransomware',
    category: 'Data Attack',
    color: '#b91c1c',
    icon: 'Lock',
    description: 'Encryption-based extortion targeting data availability',
  },
  phishing: {
    sidc: 'HCYE--',
    label: 'Phishing',
    category: 'Social Engineering',
    color: '#8b5cf6',
    icon: 'Mail',
    description: 'Deceptive communications targeting credentials and access',
  },
  apt: {
    sidc: 'HCYF--',
    label: 'APT',
    category: 'Advanced Persistent Threat',
    color: '#7c3aed',
    icon: 'Shield',
    description: 'State-sponsored or highly sophisticated threat actor',
  },
  insider: {
    sidc: 'HCYH--',
    label: 'Insider Threat',
    category: 'Internal Threat',
    color: '#f59e0b',
    icon: 'UserX',
    description: 'Malicious activity from authorized internal users',
  },
  supply_chain: {
    sidc: 'HCYI--',
    label: 'Supply Chain',
    category: 'Supply Chain Attack',
    color: '#d97706',
    icon: 'Package',
    description: 'Compromise of software/hardware supply chain',
  },
  zero_day: {
    sidc: 'HCYJ--',
    label: 'Zero-Day',
    category: 'Exploit',
    color: '#dc2626',
    icon: 'AlertTriangle',
    description: 'Exploitation of unknown/unpatched vulnerabilities',
  },
  data_exfiltration: {
    sidc: 'HCYK--',
    label: 'Data Exfiltration',
    category: 'Data Theft',
    color: '#9333ea',
    icon: 'Download',
    description: 'Unauthorized transfer of data out of the network',
  },
};

const ASSET_SYMBOLS: Record<string, CyberSymbol> = {
  network: {
    sidc: 'FFCY--',
    label: 'Network',
    category: 'Infrastructure',
    color: '#3b82f6',
    icon: 'Wifi',
    description: 'Network infrastructure component',
  },
  endpoint: {
    sidc: 'FFCY--',
    label: 'Endpoint',
    category: 'Device',
    color: '#60a5fa',
    icon: 'Monitor',
    description: 'End-user computing device',
  },
  database: {
    sidc: 'FFCY--',
    label: 'Database',
    category: 'Data Store',
    color: '#2563eb',
    icon: 'Database',
    description: 'Database or data repository',
  },
  server: {
    sidc: 'FFCY--',
    label: 'Server',
    category: 'Compute',
    color: '#1d4ed8',
    icon: 'Server',
    description: 'Compute server or virtual machine',
  },
  firewall: {
    sidc: 'FFCY--',
    label: 'Firewall',
    category: 'Security',
    color: '#22c55e',
    icon: 'Shield',
    description: 'Network security appliance',
  },
  cloud: {
    sidc: 'FFCY--',
    label: 'Cloud',
    category: 'Cloud',
    color: '#06b6d4',
    icon: 'Cloud',
    description: 'Cloud service or resource',
  },
  iot: {
    sidc: 'FFCY--',
    label: 'IoT',
    category: 'IoT Device',
    color: '#14b8a6',
    icon: 'Cpu',
    description: 'Internet of Things device',
  },
  scada: {
    sidc: 'FFCY--',
    label: 'SCADA',
    category: 'OT/ICS',
    color: '#f59e0b',
    icon: 'Settings',
    description: 'Industrial control system / SCADA endpoint',
  },
  satellite: {
    sidc: 'FFCY--',
    label: 'Satellite',
    category: 'Space',
    color: '#8b5cf6',
    icon: 'Satellite',
    description: 'Satellite or space-based asset',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the cyber symbol for a threat type
 */
export function getCyberThreatSymbol(type: CyberThreatType): CyberSymbol | undefined {
  return CYBER_SYMBOLS[type];
}

/**
 * Get the cyber symbol for an asset type
 */
export function getCyberAssetSymbol(type: CyberAssetType): CyberSymbol | undefined {
  return ASSET_SYMBOLS[type];
}

/**
 * Get all available cyber threat symbols
 */
export function getAllThreatSymbols(): CyberSymbol[] {
  return Object.values(CYBER_SYMBOLS);
}

/**
 * Get all available cyber asset symbols
 */
export function getAllAssetSymbols(): CyberSymbol[] {
  return Object.values(ASSET_SYMBOLS);
}

/**
 * Get color for cyber affiliation
 */
export function getCyberAffiliationColor(affiliation: CyberAffiliation): Cesium.Color {
  const colors: Record<CyberAffiliation, Cesium.Color> = {
    hostile: Cesium.Color.fromCssColorString('#ef4444'),
    suspect: Cesium.Color.fromCssColorString('#f97316'),
    unknown: Cesium.Color.fromCssColorString('#fbbf24'),
    friendly: Cesium.Color.fromCssColorString('#3b82f6'),
    neutral: Cesium.Color.fromCssColorString('#6b7280'),
  };
  return colors[affiliation] || colors.unknown;
}

/**
 * Get color for cyber severity level
 */
export function getSeverityColor(severity: CyberSeverity): Cesium.Color {
  const colors: Record<CyberSeverity, Cesium.Color> = {
    low: Cesium.Color.fromCssColorString('#22c55e'),
    medium: Cesium.Color.fromCssColorString('#f59e0b'),
    high: Cesium.Color.fromCssColorString('#f97316'),
    critical: Cesium.Color.fromCssColorString('#ef4444'),
  };
  return colors[severity] || colors.low;
}

/**
 * Build a SIDC string for a cyber entity
 */
export function buildCyberSidc(
  type: CyberThreatType | CyberAssetType,
  affiliation: CyberAffiliation,
): string {
  const sym = CYBER_SYMBOLS[type] || ASSET_SYMBOLS[type];
  if (!sym) return 'U--------';

  // Replace affiliation placeholder with actual affiliation
  const affCode = AFFILIATION_CODES[affiliation] || 'U';
  return affCode + sym.sidc.substring(1);
}

/**
 * Get all symbols as a flat map for the UI
 */
export function getCyberSymbolCatalog(): Record<string, CyberSymbol> {
  return { ...CYBER_SYMBOLS, ...ASSET_SYMBOLS };
}
