import { useState, useCallback, useRef, useEffect } from 'react';
import { Shield, Plus, Trash2, Target, Navigation2, Ship, Plane } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import type { MilitaryEntity, Affiliation, EntityDomain } from '@/rendering/militarySymbology';
import { getMilitarySymbol, getAffiliationColor } from '@/rendering/militarySymbology';

type SymbolPreset = {
  name: string;
  domain: EntityDomain;
  affiliation: Affiliation;
  sidc?: string;
};

const PRESETS: SymbolPreset[] = [
  { name: 'Friendly Infantry', domain: 'ground', affiliation: 'friend' },
  { name: 'Hostile Infantry', domain: 'ground', affiliation: 'hostile' },
  { name: 'Friendly Tank', domain: 'ground', affiliation: 'friend', sidc: 'SFGPEWN------FP-----' },
  { name: 'Hostile Tank', domain: 'ground', affiliation: 'hostile', sidc: 'SFGPEWN------HP-----' },
  { name: 'Friendly Aircraft', domain: 'air', affiliation: 'friend' },
  { name: 'Hostile Aircraft', domain: 'air', affiliation: 'hostile' },
  { name: 'Friendly Ship', domain: 'surface', affiliation: 'friend' },
  { name: 'Hostile Ship', domain: 'surface', affiliation: 'hostile' },
  { name: 'Neutral Vessel', domain: 'surface', affiliation: 'neutral' },
  { name: 'Friendly Submarine', domain: 'subsurface', affiliation: 'friend' },
  { name: 'Hostile Submarine', domain: 'subsurface', affiliation: 'hostile' },
];

export function MilitarySymbologyPanel({ onClose, onPlaceEntity }: {
  onClose?: () => void;
  onPlaceEntity?: (entity: MilitaryEntity) => void;
}) {
  const [tab, setTab] = useState<'symbols' | 'tracks'>('symbols');
  const [tracks, setTracks] = useState<MilitaryEntity[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('militaryTracks') || '[]');
    } catch { return []; }
  });

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
      timestamp: Date.now(),
    };
    setTracks(prev => [...prev, entity]);
  }, []);

  const removeTrack = useCallback((id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearAll = useCallback(() => setTracks([]), []);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 340 }}>
      <Panel title="MILITARY SYMBOLOGY" icon={<Shield size={16} />}
             accentColor="#22c55e" iconColor="#4ade80" titleColor="#86efac" onClose={onClose}>
        <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid rgba(34,197,94,0.15)' }}>
          {(['symbols', 'tracks'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: tab === t ? 'rgba(34,197,94,0.25)' : 'transparent',
                color: tab === t ? '#86efac' : '#64748b', fontSize: 9, textTransform: 'uppercase' }}>{t}</button>
          ))}
        </div>

        {tab === 'symbols' && (
          <div style={{ padding: '10px 14px', maxHeight: 400, overflowY: 'auto' }}>
            <div style={{ color: '#86efac', fontSize: 9, marginBottom: 8 }}>PRESET SYMBOLS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {PRESETS.map((p, i) => {
                const temp: MilitaryEntity = {
                  id: `preview_${i}`, name: p.name, lat: 0, lon: 0,
                  heading: 0, domain: p.domain, affiliation: p.affiliation,
                  status: 'present', sidc: p.sidc, timestamp: Date.now(),
                };
                return (
                  <button key={i} onClick={() => addPreset(p)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                      borderRadius: 6, border: `1px solid ${getAffiliationColor(p.affiliation)}40`,
                      background: `${getAffiliationColor(p.affiliation)}08`, cursor: 'pointer' }}>
                    <img src={getMilitarySymbol(temp, 24).toDataURL()} alt={p.name}
                      style={{ width: 24, height: 24 }} />
                    <span style={{ color: '#cbd5e1', fontSize: 8, lineHeight: 1.2 }}>{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'tracks' && (
          <div style={{ padding: '10px 14px', maxHeight: 400, overflowY: 'auto' }}>
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
                    border: '1px solid rgba(34,197,94,0.1)',
                    background: 'rgba(34,197,94,0.04)' }}>
                  <img src={sym.toDataURL()} style={{ width: 28, height: 28 }} alt={t.name} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 10 }}>{t.name}</div>
                    <div style={{ color: '#64748b', fontSize: 8 }}>
                      {t.domain} · {t.affiliation}
                      {t.lat !== 0 && ` · ${t.lat.toFixed(2)}, ${t.lon.toFixed(2)}`}
                    </div>
                  </div>
                  <Trash2 size={12} style={{ color: '#ef4444', cursor: 'pointer' }}
                    onClick={() => removeTrack(t.id)} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
