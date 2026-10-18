import React from 'react';
import { GitFork, Crosshair, Bot, Play, Pause, Trash2, Clock, MapPin, Activity, Wind, Waves, Flame, Anchor, Plane, Zap, Sliders } from 'lucide-react';
import Panel from '@/components/ui/Panel';

export interface Fork {
  forkId: string;
  name: string;
  divergenceScore: number;
  status: string;
  lat?: number;
  lon?: number;
  radiusM?: number;
  bufferRadiusM?: number;
  disruptionType?: string;
  disruptionDetails?: string;
  simulatedTimeMs?: number;
}

interface ForkPanelProps {
  forks: Fork[];
  onPauseFork: (forkId: string) => void;
  onResumeFork: (forkId: string) => void;
  onTerminateFork: (forkId: string) => void;
  onFlyToFork?: (fork: Fork) => void;
  onFocusChat?: (fork: Fork) => void;
  onClose?: () => void;
  zIndex?: number;
}

type DisruptionIconComponent = React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;

const DISRUPTION_BADGES: Record<string, { label: string; Icon: DisruptionIconComponent; color: string; bg: string }> = {
  cyclone: { label: 'Cyclone', Icon: Wind, color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
  earthquake: { label: 'Earthquake', Icon: Activity, color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
  flood: { label: 'Flood', Icon: Waves, color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
  wildfire: { label: 'Wildfire', Icon: Flame, color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' },
  port_closure: { label: 'Port Blockade', Icon: Anchor, color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)' },
  airspace_block: { label: 'Airspace Closure', Icon: Plane, color: '#f472b6', bg: 'rgba(244, 114, 182, 0.15)' },
  power_outage: { label: 'Grid Failure', Icon: Zap, color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)' },
  custom: { label: 'Custom What-If', Icon: Sliders, color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
};

export const ForkPanel: React.FC<ForkPanelProps> = ({
  forks,
  onPauseFork,
  onResumeFork,
  onTerminateFork,
  onFlyToFork,
  onFocusChat,
  onClose,
  zIndex = 110,
}) => {
  if (forks.length === 0) return null;

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 330 }}>
      <Panel
        title="PARALLEL REALITIES"
        icon={<GitFork size={15} />}
        accentColor="#f59e0b"
        iconColor="#fbbf24"
        titleColor="#fef3c7"
        onClose={onClose}
        headerExtra={
          <span style={{
            fontSize: 10,
            background: 'rgba(245, 158, 11, 0.2)',
            color: '#fbbf24',
            padding: '2px 7px',
            borderRadius: 4,
            fontWeight: 700,
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}>
            {forks.length} Active
          </span>
        }
        style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}
      >
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {forks.map(fork => {
            const radiusKm = Math.round(((fork.radiusM || fork.bufferRadiusM || 50000) / 1000));
            const badge = DISRUPTION_BADGES[fork.disruptionType || ''] || DISRUPTION_BADGES.custom;
            const pct = Math.min(100, (fork.divergenceScore * 100)).toFixed(1);
            const simHours = ((fork.simulatedTimeMs || 0) / 3600000).toFixed(1);
            const isRunning = fork.status === 'running';

            const divergenceColor =
              fork.divergenceScore > 0.7 ? '#ef4444' : fork.divergenceScore > 0.3 ? '#f59e0b' : '#10b981';

            return (
              <div
                key={fork.forkId}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                }}
              >
                {/* Header: Title + Disruption Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 700,
                      color: '#f8fafc',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {fork.name}
                    </div>
                    {typeof fork.lat === 'number' && typeof fork.lon === 'number' && (
                      <div style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <MapPin size={10} style={{ color: '#f59e0b' }} />
                        <span>{fork.lat.toFixed(3)}°, {fork.lon.toFixed(3)}° · {radiusKm} km buffer</span>
                      </div>
                    )}
                  </div>

                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: badge.color,
                    background: badge.bg,
                    border: `1px solid ${badge.color}33`,
                    padding: '2px 7px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                  }}>
                    <badge.Icon size={11} color={badge.color} />
                    <span>{badge.label}</span>
                  </span>
                </div>

                {/* Status & Divergence Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: isRunning ? '#10b981' : '#f59e0b',
                        boxShadow: isRunning ? '0 0 6px #10b981' : 'none',
                      }} />
                      <span style={{ color: isRunning ? '#34d399' : '#fbbf24', fontWeight: 600, textTransform: 'uppercase', fontSize: 9 }}>
                        {fork.status}
                      </span>
                      <span style={{ color: '#64748b' }}>·</span>
                      <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={10} /> +{simHours}h sim
                      </span>
                    </div>

                    <span style={{ color: divergenceColor, fontWeight: 700 }}>
                      {pct}% DIVERGED
                    </span>
                  </div>

                  <div style={{ width: '100%', height: 5, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, parseFloat(pct))}%`,
                        height: '100%',
                        background: divergenceColor,
                        borderRadius: 3,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 2 }}>
                  {onFlyToFork && (
                    <button
                      type="button"
                      onClick={() => onFlyToFork(fork)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#94a3b8',
                        padding: '4px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                      }}
                      title="Fly camera to dome center"
                    >
                      <Crosshair size={11} style={{ color: '#38bdf8' }} /> Fly
                    </button>
                  )}

                  {onFocusChat && (
                    <button
                      type="button"
                      onClick={() => onFocusChat(fork)}
                      style={{
                        background: 'rgba(245, 158, 11, 0.12)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        color: '#fbbf24',
                        padding: '4px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        fontWeight: 600,
                      }}
                      title="Lock AI Copilot to this parallel reality"
                    >
                      <Bot size={11} /> Copilot
                    </button>
                  )}

                  {isRunning ? (
                    <button
                      type="button"
                      onClick={() => onPauseFork(fork.forkId)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f8fafc',
                        padding: '4px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                      }}
                      title="Pause simulation tick"
                    >
                      <Pause size={11} /> Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onResumeFork(fork.forkId)}
                      style={{
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        color: '#34d399',
                        padding: '4px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        fontWeight: 600,
                      }}
                      title="Resume simulation tick"
                    >
                      <Play size={11} /> Resume
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onTerminateFork(fork.forkId)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      padding: '4px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 3,
                    }}
                    title="Terminate and clean up parallel reality"
                  >
                    <Trash2 size={11} /> Kill
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
};
export default ForkPanel;
