import ms from 'milsymbol';

/* ═══════════════════════════════════════════════════════════════════
   MIL-STD-2525D / APP-6D Tactical Symbology Engine
   Full support for affiliation frames, echelon modifiers, status,
   equipment types, and multi-point tactical graphics.
   ═══════════════════════════════════════════════════════════════════ */

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown' | 'pending' | 'assumed_friend' | 'joker' | 'faker';
export type EntityDomain = 'air' | 'ground' | 'surface' | 'subsurface' | 'space';
export type EntityStatus = 'present' | 'planned' | 'suspected' | 'confirmed' | 'anticipated' | 'present_destroyed' | 'present_damaged' | 'present_full';

export type Echelon =
  | 'team'        // TEAM (2-4)
  | 'squad'       // SQUAD (5-10)
  | 'section'     // SECTION (11-14)
  | 'platoon'     // PLATOON (15-32)
  | 'company'     // COMPANY (33-140)
  | 'battalion'   // BATTALION (141-400)
  | 'regiment'    // REGIMENT/GROUP (401-1500)
  | 'brigade'     // BRIGADE (1501-4000)
  | 'division'    // DIVISION (4001-16000)
  | 'corps'       // CORPS (16001-50000)
  | 'army'        // FIELD ARMY (50001+)
  | 'army_group'  // ARMY GROUP / FRONT
  | 'region'      // REGION / THEATER
  | 'global';     // GLOBAL / COMMAND

export type EquipmentType =
  | 'infantry' | 'mech_infantry' | 'motorized_infantry' | 'mountain_infantry' | 'airborne_infantry'
  | 'armor' | 'armored_cavalry' | 'reconnaissance'
  | 'artillery' | 'rocket_artillery' | 'mortar' | 'air_defense'
  | 'engineer' | 'signal' | 'intelligence' | 'military_police'
  | 'logistics' | 'medical' | 'chemical' | 'cyber'
  | 'helicopter' | 'attack_helicopter' | 'transport_helicopter'
  | 'fixed_wing' | 'bomber' | 'fighter' | 'recon_air'
  | 'warship' | 'destroyer' | 'frigate' | 'submarine' | 'carrier' | 'patrol_boat' | 'mine_warfare'
  | 'missile' | 'icbm' | 'slbm'
  | 'space_asset' | 'satellite' | 'recon_satellite';

export type TacticalGraphicType =
  | 'boundary'         // Phase line / boundary line
  | 'forward_line'     // Forward line of own troops (FLOT)
  | 'objective_line'   // Objective line
  | 'no_fire_line'     // No-fire line
  | 'fire_support_line' // Fire support coordination line
  | 'target_area'      // Target / NAIP / TAI / DA
  | 'engagement_zone'  // Engagement zone
  | 'security_zone'    // Security zone / screen area
  | 'assembly_area'    // Assembly area
  | 'drop_zone'        // Drop zone / landing zone
  | 'supply_route'     // MSR / ASR
  | 'obstacle_zone'    // Obstacle belt / line
  | 'air_corridor'     // Low level air corridor
  | 'restricted_area'  // Restricted operations zone
  | 'fire_support_area'; // FSA / RFA / SFA

export interface MilitaryEntity {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt?: number;
  heading: number;
  domain: EntityDomain;
  affiliation: Affiliation;
  status: EntityStatus;
  sidc?: string;
  echelon?: Echelon;
  equipment?: EquipmentType;
  trackId?: string;
  speed?: number;
  timestamp: number;
  combatId?: string;
  reinforceState?: string;
  specialDesignator?: string;
}

export interface TacticalGraphic {
  id: string;
  name: string;
  type: TacticalGraphicType;
  affiliation: Affiliation;
  positions: Array<{ lat: number; lon: number }>;
  color?: string;
  width?: number;
  closed?: boolean;
  label?: string;
  timestamp: number;
}

/* ── SIDC Position Maps ────────────────────────────────────────── */

const AFFILIATION_MAP: Record<Affiliation, string> = {
  friend: 'F',
  hostile: 'H',
  neutral: 'N',
  unknown: 'U',
  pending: 'P',
  assumed_friend: 'A',
  joker: 'J',
  faker: 'K',
};

const STATUS_MAP: Record<EntityStatus, string> = {
  present: 'P',
  planned: 'A',
  suspected: 'S',
  confirmed: 'C',
  anticipated: 'A',
  present_destroyed: 'D',
  present_damaged: 'F',
  present_full: 'X',
};

const DOMAIN_SIDC: Record<EntityDomain, string> = {
  air: 'SFAPMF',
  ground: 'SFGPUCI',
  surface: 'SFAPCB',
  subsurface: 'SFAPSM',
  space: 'SFAPSP',
};

const ECHELON_MAP: Record<Echelon, string> = {
  team: 'A',
  squad: 'B',
  section: 'C',
  platoon: 'D',
  company: 'E',
  battalion: 'F',
  regiment: 'G',
  brigade: 'H',
  division: 'J',
  corps: 'K',
  army: 'L',
  army_group: 'M',
  region: 'N',
  global: 'O',
};

/* ── Equipment Type → SIDC field "battle_dimension_equip" ─────── */
const EQUIP_SIDC: Record<EquipmentType, string> = {
  infantry: 'UZ',        // Infantry
  mech_infantry: 'UM',   // Mechanized Infantry
  motorized_infantry: 'UR', // Motorized
  mountain_infantry: 'UF', // Mountain
  airborne_infantry: 'UN', // Airborne
  armor: 'UW',           // Armor
  armored_cavalry: 'UY', // Cavalry
  reconnaissance: 'UC',  // Recon
  artillery: 'UF',       // Artillery
  rocket_artillery: 'UE', // Rocket
  mortar: 'UB',          // Mortar
  air_defense: 'EA',     // Air Defense
  engineer: 'R',         // Engineer
  signal: 'O',           // Signal
  intelligence: 'M',     // Intel
  military_police: 'P',  // MP
  logistics: 'S',        // Supply
  medical: 'Q',          // Medical
  chemical: 'T',         // Chemical
  cyber: 'Y',            // Cyber
  helicopter: 'HM',      // Rotary Wing
  attack_helicopter: 'HA', // Attack Helo
  transport_helicopter: 'HU', // Utility Helo
  fixed_wing: 'FA',      // Fixed Wing
  bomber: 'FB',          // Bomber
  fighter: 'FF',         // Fighter
  recon_air: 'FR',       // Recon Air
  warship: 'SS',         // Surface Ship
  destroyer: 'DD',       // Destroyer
  frigate: 'FF',         // Frigate
  submarine: 'SS',       // Sub
  carrier: 'CV',         // Carrier
  patrol_boat: 'PB',     // Patrol
  mine_warfare: 'MC',    // Mine
  missile: 'DM',         // Missile
  icbm: 'DI',            // ICBM
  slbm: 'DS',            // SLBM
  space_asset: 'SP',     // Space
  satellite: 'SA',       // Satellite
  recon_satellite: 'SR', // Recon Sat
};

/* ── Tactical Graphic SIDC Templates ───────────────────────────── */

const ICON_CACHE = new Map<string, HTMLCanvasElement>();
const ICON_CACHE_MAX = 500;

/* ── SIDC Builder ──────────────────────────────────────────────── */

function buildSidc(entity: MilitaryEntity): string {
  const aff = AFFILIATION_MAP[entity.affiliation] || 'U';
  const status = STATUS_MAP[entity.status] || 'P';
  const domain = DOMAIN_SIDC[entity.domain] || 'SFGPUCI';

  if (entity.equipment) {
    const equipCode = EQUIP_SIDC[entity.equipment] || 'UZ';
    return `${domain}${equipCode}----${aff}${status}-----`;
  }

  return `${domain}------${aff}${status}-----`;
}

/* ── Public API ────────────────────────────────────────────────── */

export function getMilitarySymbol(entity: MilitaryEntity, size: number = 32): HTMLCanvasElement {
  const sidc = entity.sidc || buildSidc(entity);
  const echelonMod = entity.echelon ? ECHELON_MAP[entity.echelon] : '';
  const key = `${sidc}_${echelonMod}_${size}`;

  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  if (ICON_CACHE.size >= ICON_CACHE_MAX) ICON_CACHE.clear();

  try {
    const symbol = new ms.Symbol(sidc, {
      size,
      quantity: echelonMod || '',
      fill: true,
      militaryStyle: '2525D',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const canvas = symbol.asCanvas();
    ICON_CACHE.set(key, canvas);
    return canvas;
  } catch {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Fallback: draw affiliation-colored circle
    const color = getAffiliationColor(entity.affiliation);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.stroke();
    ICON_CACHE.set(key, canvas);
    return canvas;
  }
}


export function getAffiliationColor(affiliation: Affiliation): string {
  switch (affiliation) {
    case 'friend': return '#22c55e';
    case 'hostile': return '#ef4444';
    case 'neutral': return '#fbbf24';
    case 'unknown': return '#94a3b8';
    case 'pending': return '#a78bfa';
    case 'assumed_friend': return '#34d399';
    case 'joker': return '#f97316';
    case 'faker': return '#fb7185';
    default: return '#94a3b8';
  }
}

export function inferEntityDomain(shipType?: number, alt?: number, category?: string): EntityDomain {
  if (alt != null && alt > 100) return 'air';
  if (shipType != null) {
    if (shipType >= 60 && shipType < 70) return 'surface';
    if (shipType >= 70 && shipType < 80) return 'surface';
    if (shipType >= 80 && shipType < 90) return 'surface';
    if (shipType >= 30 && shipType < 40) return 'subsurface';
    return 'surface';
  }
  if (category === 'flight' || category === 'aircraft') return 'air';
  return 'ground';
}

export function getEchelonLabel(echelon: Echelon): string {
  switch (echelon) {
    case 'team': return 'Team (2-4)';
    case 'squad': return 'Squad (5-10)';
    case 'section': return 'Section (11-14)';
    case 'platoon': return 'Platoon (15-32)';
    case 'company': return 'Company (33-140)';
    case 'battalion': return 'Battalion (141-400)';
    case 'regiment': return 'Regiment (401-1500)';
    case 'brigade': return 'Brigade (1501-4000)';
    case 'division': return 'Division (4001-16000)';
    case 'corps': return 'Corps (16001-50000)';
    case 'army': return 'Army (50001+)';
    case 'army_group': return 'Army Group';
    case 'region': return 'Theater';
    case 'global': return 'Global';
    default: return echelon;
  }
}

export function getEquipmentLabel(equip: EquipmentType): string {
  const labels: Record<EquipmentType, string> = {
    infantry: 'Infantry', mech_infantry: 'Mechanized Infantry', motorized_infantry: 'Motorized',
    mountain_infantry: 'Mountain Infantry', airborne_infantry: 'Airborne Infantry',
    armor: 'Armor', armored_cavalry: 'Armored Cavalry', reconnaissance: 'Reconnaissance',
    artillery: 'Artillery', rocket_artillery: 'Rocket Artillery', mortar: 'Mortar',
    air_defense: 'Air Defense', engineer: 'Engineer', signal: 'Signal',
    intelligence: 'Intelligence', military_police: 'Military Police', logistics: 'Logistics',
    medical: 'Medical', chemical: 'Chemical', cyber: 'Cyber',
    helicopter: 'Helicopter', attack_helicopter: 'Attack Helicopter',
    transport_helicopter: 'Transport Helicopter', fixed_wing: 'Fixed Wing',
    bomber: 'Bomber', fighter: 'Fighter', recon_air: 'Recon Aircraft',
    warship: 'Warship', destroyer: 'Destroyer', frigate: 'Frigate',
    submarine: 'Submarine', carrier: 'Carrier', patrol_boat: 'Patrol Boat',
    mine_warfare: 'Mine Warfare', missile: 'Missile', icbm: 'ICBM',
    slbm: 'SLBM', space_asset: 'Space Asset', satellite: 'Satellite',
    recon_satellite: 'Recon Satellite',
  };
  return labels[equip] || equip;
}
