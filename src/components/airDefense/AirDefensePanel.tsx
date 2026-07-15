import { useState, useMemo } from 'react';
import { Radar, AlertTriangle, Shield, Zap } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import type { MissileTrack, Interceptor, InterceptAttempt } from '@/rendering/airDefense/airDefenseTypes';

type Tab = 'tracks' | 'interceptors' | 'intercepts';
const TIER_COLORS: Record<string, string> = { outer: '#3b82f6', mid: '#f59e0b', inner: '#ef4444', point: '#dc2626' };

export function AirDefensePanel({ missileTracks, interceptors, interceptAttempts, iamdStatus, onClose }: {
  missileTracks: MissileTrack[]; interceptors: Interceptor[]; interceptAttempts: InterceptAttempt[];
  iamdStatus: any; onClose?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('tracks');
  const sorted = useMemo(() => [...missileTracks].sort((a, b) => (a.timeToImpact ?? 9999) - (b.timeToImpact ?? 9999)), [missileTracks]);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 360, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <Panel title="AIR DEFENSE / IAMD" icon={<Radar size={16} />} accentColor="#3b82f6" iconColor="#60a5fa" titleColor="#93c5fd" onClose={onClose}>
        <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid rgba(59,130,246,0.15)' }}>
          {(['tracks', 'interceptors', 'intercepts'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer', background: tab === t ? 'rgba(59,130,246,0.25)' : 'transparent', color: tab === t ? '#93c5fd' : '#64748b', fontSize: 9, textTransform: 'uppercase' }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'tracks' && (
            <div style={{ padding: '10px 14px' }}>
              {/* IAMD Tier Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 10 }}>
                {(['outer', 'mid', 'inner'] as const).map(tier => (
                  <div key={tier} style={{ background: `${TIER_COLORS[tier]}10`, borderRadius: 4, padding: '4px', textAlign: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: iamdStatus?.[`${tier}TierCoverage`] ? '#22c55e' : '#ef4444', margin: '0 auto 2px' }} />
                    <div style={{ color: TIER_COLORS[tier], fontSize: 8, textTransform: 'uppercase' }}>{tier}</div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#93c5fd', fontSize: 9, marginBottom: 8 }}>MISSILE TRACKS ({missileTracks.length})</div>
              {sorted.length === 0 && <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>No missile tracks detected.</div>}
              {sorted.map(track => (
                <div key={track.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}>{track.name}</span>
                    <span style={{ padding: '1px 4px', borderRadius: 2, fontSize: 7, fontWeight: 600, background: 'rgba(239,68,68,0.3)', color: '#fca5a5', textTransform: 'uppercase' }}>{track.type}</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 7, marginTop: 2 }}>Alt: {(track.alt / 1000).toFixed(1)}km · Speed: {track.speed} m/s</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ color: '#ef4444', fontSize: 8, fontWeight: 700 }}>TTI: {Math.round(track.timeToImpact ?? 0)}s</span>
                    <span style={{ color: '#64748b', fontSize: 7 }}>Conf: {Math.round(track.confidence * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'interceptors' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ color: '#93c5fd', fontSize: 9, marginBottom: 8 }}>INTERCEPTORS ({interceptors.length})</div>
              {interceptors.map(i => (
                <div key={i.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6, border: `1px solid ${TIER_COLORS[i.tier]}20`, background: `${TIER_COLORS[i.tier]}06` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#e2e8f0', fontSize: 9 }}>{i.name}</span>
                    <span style={{ color: i.status === 'ready' ? '#22c55e' : '#64748b', fontSize: 7 }}>{i.status} · x{i.quantity}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 7 }}>{i.tier} tier · Range {(i.maxRange/1000).toFixed(0)}km · Mach {i.machSpeed}</div>
                </div>
              ))}
            </div>
          )}
          {tab === 'intercepts' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ color: '#93c5fd', fontSize: 9, marginBottom: 8 }}>INTERCEPT ATTEMPTS ({interceptAttempts.length})</div>
              {interceptAttempts.length === 0 && <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>No intercept attempts.</div>}
              {interceptAttempts.map(a => (
                <div key={a.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6, border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#e2e8f0', fontSize: 9 }}>{a.interceptorName}</span>
                    <span style={{ color: a.status === 'kill' ? '#22c55e' : a.status === 'miss' ? '#ef4444' : '#f59e0b', fontSize: 7, textTransform: 'uppercase' }}>{a.status}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 7 }}>Tier: {a.tier} · PIP: {a.pipLat.toFixed(2)}, {a.pipLon.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
