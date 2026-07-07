import ms from 'milsymbol';

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown';
export type EntityDomain = 'air' | 'ground' | 'surface' | 'subsurface' | 'space';
export type EntityStatus = 'present' | 'planned' | 'suspected' | 'confirmed';

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
  echelon?: string;
  trackId?: string;
  speed?: number;
  timestamp: number;
}

const AFFILIATION_MAP: Record<Affiliation, string> = {
  friend: 'F',
  hostile: 'H',
  neutral: 'N',
  unknown: 'U',
};

const STATUS_MAP: Record<EntityStatus, string> = {
  present: 'P',
  planned: 'A',
  suspected: 'S',
  confirmed: 'C',
};

const DOMAIN_SIDC: Record<EntityDomain, string> = {
  air: 'SFAPMF',
  ground: 'SFGPUCI',
  surface: 'SFAPCB',
  subsurface: 'SFAPSM',
  space: 'SFAPSP',
};

const ICON_CACHE = new Map<string, HTMLCanvasElement>();
const ICON_CACHE_MAX = 200;

function buildSidc(entity: MilitaryEntity): string {
  const aff = AFFILIATION_MAP[entity.affiliation];
  const status = STATUS_MAP[entity.status];
  const domain = DOMAIN_SIDC[entity.domain];
  return `${domain}------${aff}${status}-----`;
}

export function getMilitarySymbol(entity: MilitaryEntity, size: number = 32): HTMLCanvasElement {
  const sidc = entity.sidc || buildSidc(entity);
  const key = `${sidc}_${size}`;

  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  if (ICON_CACHE.size >= ICON_CACHE_MAX) ICON_CACHE.clear();

  try {
    const symbol = new ms.Symbol(sidc, {
      size,
      quantity: entity.echelon || '',
      fill: true,
    });
    const canvas = symbol.asCanvas();
    ICON_CACHE.set(key, canvas);
    return canvas;
  } catch {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2);
    ctx.fill();
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
