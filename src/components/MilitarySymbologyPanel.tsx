import { useState, useCallback, useEffect, useRef } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Shield, Plus, Trash2, Crosshair, ChevronDown, ChevronRight, MapPin, Minus, Save } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import type { MilitaryEntity, Affiliation, EntityDomain, Echelon, EquipmentType, TacticalGraphic, TacticalGraphicType } from '@/rendering/militarySymbology';
import { getMilitarySymbol, getAffiliationColor, getEchelonLabel, getEquipmentLabel } from '@/rendering/militarySymbology';

/* ═══════════════════════════════════════════════════════════════════
   Military Symbology Panel (Phase 1 — Enhanced)
   Full MIL-STD-2525D symbology browser with:
   - 30+ preset symbols across all domains and echelons
   - Tactical graphics drawing (zones, boundaries, routes)
   - Echelon and equipment modifiers
   - Track list with real-time status
   ═══════════════════════════════════════════════════════════════════ */

type Tab = 'symbols' | 'tactical' | 'tracks';

interface SymbolPreset {
  name: string;
  domain: EntityDomain;
  affiliation: Affiliation;
  sidc?: string;
  echelon?: Echelon;
  equipment?: EquipmentType;
}

const ECHELONS: Echelon[] = [
  'team', 'squad', 'section', 'platoon', 'company',
  'battalion', 'regiment', 'brigade', 'division', 'corps', 'army',
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const EQUIPMENT_TYPES: EquipmentType[] = [
  'infantry', 'mech_infantry', 'armor', 'artillery', 'air_defense',
  'engineer', 'helicopter', 'attack_helicopter', 'fixed_wing', 'fighter',
  'warship', 'submarine', 'carrier',
];

const GROUND_PRESETS: SymbolPreset[] = [
  { name: 'Friendly Infantry', domain: 'ground', affiliation: 'friend', equipment: 'infantry' },
  { name: 'Friendly Mech Inf', domain: 'ground', affiliation: 'friend', equipment: 'mech_infantry' },
  { name: 'Friendly Armor', domain: 'ground', affiliation: 'friend', equipment: 'armor' },
  { name: 'Friendly Artillery', domain: 'ground', affiliation: 'friend', equipment: 'artillery' },
  { name: 'Friendly Air Defense', domain: 'ground', affiliation: 'friend', equipment: 'air_defense' },
  { name: 'Friendly Engineer', domain: 'ground', affiliation: 'friend', equipment: 'engineer' },
  { name: 'Hostile Infantry', domain: 'ground', affiliation: 'hostile', equipment: 'infantry' },
  { name: 'Hostile Armor', domain: 'ground', affiliation: 'hostile', equipment: 'armor' },
  { name: 'Hostile Artillery', domain: 'ground', affiliation: 'hostile', equipment: 'artillery' },
  { name: 'Unknown Ground', domain: 'ground', affiliation: 'unknown' },
  { name: 'Neutral Ground', domain: 'ground', affiliation: 'neutral' },
  { name: 'Pending Ground', domain: 'ground', affiliation: 'pending' },
];

const AIR_PRESETS: SymbolPreset[] = [
  { name: 'Friendly Fighter', domain: 'air', affiliation: 'friend', equipment: 'fighter' },
  { name: 'Friendly Bomber', domain: 'air', affiliation: 'friend', equipment: 'bomber' },
  { name: 'Friendly Rotary Wing', domain: 'air', affiliation: 'friend', equipment: 'helicopter' },
  { name: 'Friendly Attack Helo', domain: 'air', affiliation: 'friend', equipment: 'attack_helicopter' },
  { name: 'Hostile Fighter', domain: 'air', affiliation: 'hostile', equipment: 'fighter' },
  { name: 'Unknown Air', domain: 'air', affiliation: 'unknown' },
];

const SEA_PRESETS: SymbolPreset[] = [
  { name: 'Friendly Destroyer', domain: 'surface', affiliation: 'friend', equipment: 'destroyer' },
  { name: 'Friendly Frigate', domain: 'surface', affiliation: 'friend', equipment: 'frigate' },
  { name: 'Friendly Carrier', domain: 'surface', affiliation: 'friend', equipment: 'carrier' },
  { name: 'Friendly Submarine', domain: 'subsurface', affiliation: 'friend', equipment: 'submarine' },
  { name: 'Hostile Surface', domain: 'surface', affiliation: 'hostile', equipment: 'warship' },
  { name: 'Hostile Submarine', domain: 'subsurface', affiliation: 'hostile', equipment: 'submarine' },
  { name: 'Unknown Surface', domain: 'surface', affiliation: 'unknown' },
  { name: 'Neutral Vessel', domain: 'surface', affiliation: 'neutral' },
];

const SPACE_PRESETS: SymbolPreset[] = [
  { name: 'Friendly Satellite', domain: 'space', affiliation: 'friend', equipment: 'satellite' },
  { name: 'Hostile Recon Sat', domain: 'space', affiliation: 'hostile', equipment: 'recon_satellite' },
  { name: 'Unknown Space', domain: 'space', affiliation: 'unknown' },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ALL_PRESETS = [...GROUND_PRESETS, ...AIR_PRESETS, ...SEA_PRESETS, ...SPACE_PRESETS];

const TACTICAL_GRAPHIC_TYPES: Array<{ type: TacticalGraphicType; label: string; category: string }> = [
  { type: 'boundary', label: 'Boundary Line', category: 'Lines' },
  { type: 'forward_line', label: 'FLOT', category: 'Lines' },
  { type: 'objective_line', label: 'Objective Line', category: 'Lines' },
  { type: 'no_fire_line', label: 'No-Fire Line', category: 'Lines' },
  { type: 'fire_support_line', label: 'Fire Support Coord Line', category: 'Lines' },
  { type: 'supply_route', label: 'MSR / ASR', category: 'Lines' },
  { type: 'air_corridor', label: 'Low Level Air Corridor', category: 'Lines' },
  { type: 'target_area', label: 'Target Area (NAI/TAI/DA)', category: 'Areas' },
  { type: 'engagement_zone', label: 'Engagement Zone', category: 'Areas' },
  { type: 'security_zone', label: 'Security Zone / Screen', category: 'Areas' },
  { type: 'assembly_area', label: 'Assembly Area', category: 'Areas' },
  { type: 'drop_zone', label: 'Drop Zone / Landing Zone', category: 'Areas' },
  { type: 'obstacle_zone', label: 'Obstacle Zone / Belt', category: 'Areas' },
  { type: 'restricted_area', label: 'Restricted Ops Zone', category: 'Areas' },
  { type: 'fire_support_area', label: 'FSA / RFA / SFA', category: 'Areas' },
];

export function MilitarySymbologyPanel({ onClose, onPlaceEntity, onAddTacticalGraphic, zIndex = 1000 }: {
  onClose?: () => void;
  onPlaceEntity?: (entity: MilitaryEntity) => void;
  onAddTacticalGraphic?: (graphic: TacticalGraphic) => void;
  zIndex?: number;
}) {
  const [tab, setTab] = useState<Tab>('symbols');
  const [tracks, setTracks] = useState<MilitaryEntity[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('militaryTracks') || '[]'); } catch { return []; }
  });
  const [selectedEchelon, setSelectedEchelon] = useState<Echelon | ''>('');
  const [drawingType, setDrawingType] = useState<TacticalGraphicType | null>(null);
  const [drawPoints, setDrawPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Ground');
  const [graphicAffiliation, setGraphicAffiliation] = useState<Affiliation>('friend');
  const [graphicLabel, setGraphicLabel] = useState('');
  const drawingRef = useRef(false);

  useEffect(() => {
    sessionStorage.setItem('militaryTracks', JSON.stringify(tracks));
  }, [tracks]);

  const addPreset = useCallback((preset: SymbolPreset) => {
    const entity: MilitaryEntity = {
      id: `mil_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: preset.name,
      lat: 0, lon: 0, heading: 0,
      domain: preset.domain,
      affiliation: preset.affiliation,
      status: 'present',
      sidc: preset.sidc,
      echelon: preset.echelon || selectedEchelon || undefined,
      equipment: preset.equipment,
      timestamp: Date.now(),
    };
    setTracks(prev => [...prev, entity]);
    onPlaceEntity?.(entity);
  }, [selectedEchelon, onPlaceEntity]);

  const removeTrack = useCallback((id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearAll = useCallback(() => setTracks([]), []);

  const startDrawing = useCallback((type: TacticalGraphicType) => {
    setDrawingType(type);
    setDrawPoints([]);
    drawingRef.current = true;
  }, []);

  const finishDrawing = useCallback(() => {
    if (!drawingType || drawPoints.length < 2) {
      setDrawingType(null);
      setDrawPoints([]);
      return;
    }
    const graphic: TacticalGraphic = {
      id: `tg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: TACTICAL_GRAPHIC_TYPES.find(t => t.type === drawingType)?.label || drawingType,
      type: drawingType,
      affiliation: graphicAffiliation,
      positions: drawPoints,
      label: graphicLabel || undefined,
      closed: ['target_area', 'engagement_zone', 'security_zone', 'assembly_area', 'drop_zone', 'obstacle_zone', 'restricted_area', 'fire_support_area'].includes(drawingType),
      timestamp: Date.now(),
    };
    onAddTacticalGraphic?.(graphic);
    setDrawingType(null);
    setDrawPoints([]);
    setGraphicLabel('');
  }, [drawingType, drawPoints, graphicAffiliation, graphicLabel, onAddTacticalGraphic]);

  const cancelDrawing = useCallback(() => {
    setDrawingType(null);
    setDrawPoints([]);
  }, []);

  const groupedPresets = [
    { key: 'Ground', items: GROUND_PRESETS },
    { key: 'Air', items: AIR_PRESETS },
    { key: 'Sea', items: SEA_PRESETS },
    { key: 'Space', items: SPACE_PRESETS },
  ];

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 360, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <Panel title="MILITARY SYMBOLOGY" icon={<Shield size={16} />}
             accentColor="#22c55e" iconColor="#4ade80" titleColor="#86efac" onClose={onClose}>
        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid rgba(34,197,94,0.15)' }}>
          {(['symbols', 'tactical', 'tracks'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: tab === t ? 'rgba(34,197,94,0.25)' : 'transparent',
                color: tab === t ? '#86efac' : '#64748b', fontSize: 9, textTransform: 'uppercase' }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* ── Symbols Tab ───────────────────────────────── */}
          {tab === 'symbols' && (
            <div style={{ padding: '10px 14px' }}>
              {/* Echelon Selector */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: '#86efac', fontSize: 9, marginBottom: 4 }}>ECHELON MODIFIER</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  <button onClick={() => setSelectedEchelon('')}
                    style={{ padding: '2px 6px', borderRadius: 3, border: 'none', fontSize: 8, cursor: 'pointer',
                      background: !selectedEchelon ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.15)',
                      color: !selectedEchelon ? '#86efac' : '#64748b' }}>None</button>
                  {ECHELONS.map(e => (
                    <button key={e} onClick={() => setSelectedEchelon(e)}
                      style={{ padding: '2px 6px', borderRadius: 3, border: 'none', fontSize: 8, cursor: 'pointer',
                        background: selectedEchelon === e ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.15)',
                        color: selectedEchelon === e ? '#86efac' : '#64748b' }}>
                      {e.slice(0, 3).toUpperCase()}
                    </button>
                  ))}
                </div>
                {selectedEchelon && (
                  <div style={{ color: '#94a3b8', fontSize: 8, marginTop: 2 }}>{getEchelonLabel(selectedEchelon)}</div>
                )}
              </div>

              {/* Preset Symbols by Domain */}
              {groupedPresets.map(group => (
                <div key={group.key} style={{ marginBottom: 8 }}>
                  <button onClick={() => setExpandedCategory(expandedCategory === group.key ? null : group.key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '4px 0',
                      background: 'none', border: 'none', cursor: 'pointer', color: '#86efac', fontSize: 9 }}>
                    {expandedCategory === group.key ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.key.toUpperCase()}</span>
                    <span style={{ color: '#64748b', marginLeft: 'auto' }}>{group.items.length}</span>
                  </button>
                  {expandedCategory === group.key && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                      {group.items.map((p, i) => {
                        const temp: MilitaryEntity = {
                          id: `preview_${group.key}_${i}`, name: p.name, lat: 0, lon: 0,
                          heading: 0, domain: p.domain, affiliation: p.affiliation,
                          status: 'present', sidc: p.sidc, echelon: p.echelon || selectedEchelon || undefined,
                          equipment: p.equipment, timestamp: Date.now(),
                        };
                        return (
                          <button key={i} onClick={() => addPreset(p)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px',
                              borderRadius: 4, border: `1px solid ${getAffiliationColor(p.affiliation)}30`,
                              background: `${getAffiliationColor(p.affiliation)}06`, cursor: 'pointer', textAlign: 'left' }}>
                            <img src={getMilitarySymbol(temp, 20).toDataURL()} alt={p.name}
                              style={{ width: 20, height: 20, flexShrink: 0 }} />
                            <span style={{ color: '#cbd5e1', fontSize: 7, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Tactical Graphics Tab ──────────────────────── */}
          {tab === 'tactical' && (
            <div style={{ padding: '10px 14px' }}>
              {drawingType ? (
                <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                  <div style={{ color: '#86efac', fontSize: 10, fontWeight: 600, marginBottom: 6 }}>
                    DRAWING: {TACTICAL_GRAPHIC_TYPES.find(t => t.type === drawingType)?.label}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>
                    Click on the globe to place points ({drawPoints.length} placed). Right-click to finish.
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={finishDrawing} disabled={drawPoints.length < 2}
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: 'none', fontSize: 9,
                        background: drawPoints.length >= 2 ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.2)',
                        color: drawPoints.length >= 2 ? '#86efac' : '#64748b', cursor: 'pointer' }}>
                      FINISH ({drawPoints.length} pts)
                    </button>
                    <button onClick={cancelDrawing}
                      style={{ padding: '4px 8px', borderRadius: 4, border: 'none', fontSize: 9,
                        background: 'rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer' }}>
                      CANCEL
                    </button>
                  </div>
                  {/* Label Input */}
                  <input type="text" value={graphicLabel} onChange={e => setGraphicLabel(e.target.value)}
                    placeholder="Graphic label (optional)"
                    style={{ width: '100%', marginTop: 6, padding: '3px 6px', borderRadius: 3,
                      border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(0,0,0,0.3)', color: '#e2e8f0',
                      fontSize: 9, outline: 'none' }} />
                </div>
              ) : (
                <div style={{ color: '#86efac', fontSize: 9, marginBottom: 8 }}>TACTICAL GRAPHICS</div>
              )}

              {/* Affiliation selector for graphics */}
              {!drawingType && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color: '#94a3b8', fontSize: 8, marginBottom: 3 }}>AFFILIATION</div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {(['friend', 'hostile', 'neutral', 'unknown'] as Affiliation[]).map(a => (
                        <button key={a} onClick={() => setGraphicAffiliation(a)}
                          style={{ flex: 1, padding: '3px', borderRadius: 3, border: 'none', fontSize: 8, cursor: 'pointer',
                            background: graphicAffiliation === a ? `${getAffiliationColor(a)}30` : 'rgba(100,116,139,0.1)',
                            color: graphicAffiliation === a ? getAffiliationColor(a) : '#64748b', textTransform: 'uppercase' }}>
                          {a.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Graphic types */}
                  {['Lines', 'Areas'].map(cat => (
                    <div key={cat} style={{ marginBottom: 8 }}>
                      <div style={{ color: '#94a3b8', fontSize: 8, marginBottom: 4, textTransform: 'uppercase' }}>{cat}</div>
                      {TACTICAL_GRAPHIC_TYPES.filter(t => t.category === cat).map(t => (
                        <button key={t.type} onClick={() => startDrawing(t.type)}
                          style={{ display: 'block', width: '100%', padding: '5px 8px', marginBottom: 2,
                            borderRadius: 4, border: '1px solid rgba(34,197,94,0.1)',
                            background: 'rgba(34,197,94,0.03)', cursor: 'pointer', textAlign: 'left',
                            color: '#cbd5e1', fontSize: 9 }}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Tracks Tab ────────────────────────────────── */}
          {tab === 'tracks' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: '#86efac', fontSize: 9 }}>TRACKED UNITS ({tracks.length})</span>
                {tracks.length > 0 && (
                  <button onClick={clearAll}
                    style={{ padding: '2px 6px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 8 }}>CLEAR ALL</button>
                )}
              </div>
              {tracks.length === 0 && (
                <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>
                  No tracked units. Add symbols from the Symbols tab.
                </div>
              )}
              {tracks.map(t => {
                const sym = getMilitarySymbol(t, 28);
                return (
                  <div key={t.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      marginBottom: 4, borderRadius: 6,
                      border: `1px solid ${getAffiliationColor(t.affiliation)}20`,
                      background: `${getAffiliationColor(t.affiliation)}04` }}>
                    <img src={sym.toDataURL()} style={{ width: 28, height: 28 }} alt={t.name} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#e2e8f0', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                      <div style={{ color: '#64748b', fontSize: 8 }}>
                        {t.domain} · {t.affiliation}
                        {t.equipment ? ` · ${getEquipmentLabel(t.equipment)}` : ''}
                        {t.echelon ? ` · ${getEchelonLabel(t.echelon)}` : ''}
                        {t.lat !== 0 && ` · ${t.lat.toFixed(2)}, ${t.lon.toFixed(2)}`}
                      </div>
                    </div>
                    <Trash2 size={12} style={{ color: '#ef4444', cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => removeTrack(t.id)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
