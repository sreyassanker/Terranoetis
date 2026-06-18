import React from 'react';

interface ForkItem {
  forkId: string;
  name: string;
  divergenceScore: number;
  status: string;
}

interface ReflexItem {
  reflexId: string;
  status: string;
}

interface DiscoveryItem {
  summary: string;
  confidence: number;
}

interface DreamData {
  scenariosRun: number;
  modelUpdates: number;
  newCausalEdges: number;
  timestamp: number;
}

interface MonitorPanelProps {
  entropy: number;
  interpretation: string;
  forks: ForkItem[];
  reflexStates: ReflexItem[];
  memoryStats: Record<string, { count: number }> | null;
  recentDiscoveries: DiscoveryItem[];
  lastDream: DreamData | null;
  isCollapsed: boolean;
  onToggle: () => void;
}

const REFLEX_COLORS: Record<string, string> = {
  IDLE: '#22c55e',
  ARMED: '#eab308',
  ACTIVE: '#ef4444',
  RECOVERING: '#6b7280',
};

const ENTROPY_COLORS: Record<string, string> = {
  baseline: '#22c55e',
  restless: '#eab308',
  critical: '#FF8C00',
  catastrophic: '#ef4444',
};

export const MonitorPanel: React.FC<MonitorPanelProps> = ({
  entropy,
  interpretation,
  forks,
  reflexStates,
  memoryStats,
  recentDiscoveries,
  lastDream,
  isCollapsed,
  onToggle,
}) => {
  const entropyPct = Math.round(entropy * 100);
  const entropyColor = entropy < 0.3 ? ENTROPY_COLORS.baseline : entropy < 0.6 ? ENTROPY_COLORS.restless : entropy < 0.9 ? ENTROPY_COLORS.critical : ENTROPY_COLORS.catastrophic;
  const isCritical = entropy >= 0.9;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '75px',
    right: '20px',
    width: '320px',
    background: 'rgba(0, 0, 0, 0.9)',
    border: '1px solid #00ff88',
    borderRadius: '8px',
    color: '#eee',
    fontFamily: 'monospace',
    fontSize: '11px',
    zIndex: 1000,
    maxHeight: isCollapsed ? '36px' : '500px',
    overflow: 'hidden',
    transition: 'max-height 0.3s ease',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: isCollapsed ? 'none' : '1px solid #00ff88',
    userSelect: 'none',
  };

  const sectionStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid #1a3a2a',
  };

  const labelStyle: React.CSSProperties = {
    color: '#00ff88',
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '4px',
  };

  const barOuterStyle: React.CSSProperties = {
    width: '100%',
    height: '8px',
    background: '#1a1a2e',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '4px',
  };

  const barInnerStyle = (pct: number, color: string): React.CSSProperties => ({
    width: `${Math.min(100, pct)}%`,
    height: '100%',
    background: color,
    borderRadius: '4px',
    transition: 'width 0.5s ease',
  });

  return (
    <div style={containerStyle}>
      <div style={headerStyle} onClick={onToggle}>
        <span style={{ color: '#00ff88', fontWeight: 'bold', fontSize: '11px' }}>⬡ MONITOR</span>
        <span style={{ color: '#00ff88' }}>{isCollapsed ? '▶' : '▼'}</span>
      </div>

      {!isCollapsed && (
        <div style={{ overflowY: 'auto', maxHeight: '464px' }}>
          {/* 1. PLANETARY ENTROPY */}
          <div style={sectionStyle}>
            <div style={labelStyle}>Planetary Entropy</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span
                className={isCritical ? 'monitor-entropy-critical' : ''}
                style={{ fontSize: '20px', fontWeight: 'bold', color: entropyColor }}
              >
                {entropyPct}%
              </span>
              <span style={{ color: entropyColor, fontSize: '10px' }}>{interpretation.toUpperCase()}</span>
            </div>
            <div style={barOuterStyle}>
              <div style={barInnerStyle(entropyPct, entropyColor)} />
            </div>
          </div>

          {/* 2. ACTIVE FORKS */}
          <div style={sectionStyle}>
            <div style={labelStyle}>
              Active Forks
              <span style={{ marginLeft: '6px', color: '#ff8c00', fontSize: '10px' }}>({forks.length})</span>
            </div>
            {forks.length === 0 && (
              <div style={{ color: '#666', fontSize: '10px' }}>No active forks</div>
            )}
            {forks.map(fork => (
              <div key={fork.forkId} style={{ marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                  <span style={{ color: '#ddd' }}>{fork.name}</span>
                  <span style={{ color: fork.status === 'running' ? '#22c55e' : '#eab308' }}>{fork.status}</span>
                </div>
                <div style={barOuterStyle}>
                  <div style={barInnerStyle(fork.divergenceScore * 100, fork.divergenceScore > 0.6 ? '#ef4444' : fork.divergenceScore > 0.3 ? '#eab308' : '#22c55e')} />
                </div>
              </div>
            ))}
          </div>

          {/* 3. REFLEX STATUS */}
          <div style={sectionStyle}>
            <div style={labelStyle}>Reflex Status</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
              {reflexStates.map(reflex => (
                <div
                  key={reflex.reflexId}
                  style={{
                    padding: '4px 6px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '4px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '8px', color: '#888', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {reflex.reflexId.replace(/-/g, '\n')}
                  </div>
                  <div
                    className={reflex.status === 'ACTIVE' ? 'monitor-entropy-critical' : ''}
                    style={{
                      fontSize: '9px',
                      fontWeight: 'bold',
                      color: REFLEX_COLORS[reflex.status] || '#666',
                    }}
                  >
                    {reflex.status}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. MEMORY TIERS */}
          <div style={sectionStyle}>
            <div style={labelStyle}>Memory Tiers</div>
            {memoryStats ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: '10px' }}>
                {Object.entries(memoryStats).map(([tier, info]) => (
                  <div key={tier} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>{tier}</span>
                    <span style={{ color: '#ddd' }}>{(info as any).count ?? 0}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#666', fontSize: '10px' }}>Loading...</div>
            )}
          </div>

          {/* 5. RECENT DISCOVERIES */}
          <div style={sectionStyle}>
            <div style={labelStyle}>Recent Discoveries</div>
            {recentDiscoveries.length === 0 && (
              <div style={{ color: '#666', fontSize: '10px' }}>No discoveries yet</div>
            )}
            {recentDiscoveries.slice(0, 3).map((d, i) => (
              <div key={i} style={{ fontSize: '10px', color: '#ccc', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.summary}</span>
                <span style={{ color: d.confidence > 0.7 ? '#22c55e' : d.confidence > 0.4 ? '#eab308' : '#ef4444', marginLeft: '6px', flexShrink: 0 }}>
                  {Math.round(d.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>

          {/* 6. DREAM STATUS */}
          <div style={{ ...sectionStyle, borderBottom: 'none' }}>
            <div style={labelStyle}>Last Dream Cycle</div>
            {lastDream ? (
              <div style={{ fontSize: '10px', color: '#ccc' }}>
                <div>Scenarios: <span style={{ color: '#ddd' }}>{lastDream.scenariosRun}</span></div>
                <div>Model updates: <span style={{ color: '#ddd' }}>{lastDream.modelUpdates}</span></div>
                <div>New edges: <span style={{ color: '#ddd' }}>{lastDream.newCausalEdges}</span></div>
                <div style={{ color: '#666', fontSize: '9px', marginTop: '2px' }}>
                  {new Date(lastDream.timestamp).toLocaleString()}
                </div>
              </div>
            ) : (
              <div style={{ color: '#666', fontSize: '10px' }}>No dream cycle recorded</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
