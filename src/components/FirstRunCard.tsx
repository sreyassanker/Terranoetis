import React, { useState } from 'react';
import { X, Plane, Zap, Flame, Satellite, Shield, Globe2 } from 'lucide-react';
import { markFirstRunDone, type FirstRunMission } from '@/lib/firstRun';

interface FirstRunCardProps {
  onDismiss: () => void;
  onStage: (mission: FirstRunMission) => void;
}

interface MissionOption {
  id: FirstRunMission;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
}

const MISSIONS: MissionOption[] = [
  {
    id: 'compute-demo',
    label: 'Compute Demo',
    desc: 'Run Land Surface Temperature over Austin — real Landsat + ERA5 data painted on the globe as a 28×28 heatmap.',
    icon: <Zap size={18} />,
    color: '#34d399',
  },
  {
    id: 'live-contacts',
    label: 'Live Contacts',
    desc: 'Light up the globe with real flights, ships, satellites, and earthquakes — all live public telemetry.',
    icon: <Plane size={18} />,
    color: '#38bdf8',
  },
  {
    id: 'environmental',
    label: 'Environmental Watch',
    desc: 'Live fires (NASA FIRMS), storms, floods, and alerts from the ambient intelligence engine.',
    icon: <Flame size={18} />,
    color: '#f59e0b',
  },
];

export const FirstRunCard: React.FC<FirstRunCardProps> = ({ onDismiss, onStage }) => {
  const [visible, setVisible] = useState(true);
  const [staging, setStaging] = useState<FirstRunMission | null>(null);

  const dismiss = () => {
    setVisible(false);
    markFirstRunDone();
    onDismiss();
  };

  const stage = (mission: FirstRunMission) => {
    setStaging(mission);
    markFirstRunDone();
    onStage(mission);
    setTimeout(() => setVisible(false), 200);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', left: 16, bottom: 76, zIndex: 9990, width: 380,
      maxWidth: 'calc(100vw - 32px)',
      background: 'rgba(10,12,28,0.92)', backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)',
      overflow: 'hidden',
      animation: 'slideInUp 0.35s ease',
    }}>
      <style>{`@keyframes slideInUp { from { opacity: 0; transform: translateY(16px);} to { opacity: 1; transform: translateY(0);} }`}</style>
      <div style={{
        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
        background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(139,92,246,0.04))',
        borderBottom: '1px solid rgba(139,92,246,0.15)',
      }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}>
          <Satellite size={17} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Terranoetis</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>Real-time geospatial intelligence — real data, real equations.</div>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }} title="Dismiss">
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#c4b5fd', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={12} /> Stage a mission
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MISSIONS.map(m => (
            <button key={m.id} onClick={() => stage(m.id)} disabled={staging !== null}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${m.color}30`,
                cursor: staging === null ? 'pointer' : 'default', textAlign: 'left', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${m.color}12`; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: `${m.color}18`, border: `1px solid ${m.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color, flexShrink: 0 }}>
                {m.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{m.label}</div>
                <div style={{ fontSize: 9.5, color: '#94a3b8', lineHeight: 1.4, marginTop: 2 }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#475569', marginTop: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Globe2 size={9} /> All missions use live public data — nothing is simulated.
        </div>
      </div>
    </div>
  );
};
