import React from 'react';
import { GitFork } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface Fork {
  forkId: string;
  name: string;
  divergenceScore: number;
  status: string;
}

interface ForkPanelProps {
  forks: Fork[];
  onPauseFork: (forkId: string) => void;
  onResumeFork: (forkId: string) => void;
  onTerminateFork: (forkId: string) => void;
  zIndex?: number;
}

export const ForkPanel: React.FC<ForkPanelProps> = ({ forks, onPauseFork, onResumeFork, onTerminateFork, zIndex = 110 }) => {
  if (forks.length === 0) return null;

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 280 }}>
      <Panel
        title="PARALLEL REALITIES"
        icon={<GitFork size={14} />}
        accentColor="#f97316"
        iconColor="#fb923c"
        titleColor="#fdba74"
        headerExtra={<span style={{ color: '#94a3b8', fontSize: 10 }}>{forks.length} active</span>}
        style={{ maxHeight: 400, overflowY: 'auto' }}
      >
      {forks.map(fork => (
        <div key={fork.forkId} style={{ marginBottom: '10px', padding: '8px', background: 'rgba(255, 140, 0, 0.1)', borderRadius: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontWeight: 'bold', color: '#FF8C00' }}>{fork.name}</span>
            <span style={{ color: fork.status === 'running' ? '#0f0' : '#888', fontSize: '10px' }}>{fork.status.toUpperCase()}</span>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#aaa' }}>
              <span>DIVERGENCE</span>
              <span>{(fork.divergenceScore * 100).toFixed(1)}%</span>
            </div>
            <div style={{ width: '100%', height: '4px', background: '#333', borderRadius: '2px', marginTop: '2px' }}>
              <div style={{
                width: `${Math.min(100, fork.divergenceScore * 100)}%`,
                height: '100%',
                background: fork.divergenceScore > 0.7 ? '#f00' : fork.divergenceScore > 0.4 ? '#FF8C00' : '#0f0',
                borderRadius: '2px',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {fork.status === 'running' ? (
              <button onClick={() => onPauseFork(fork.forkId)} style={{ flex: 1, background: '#333', border: '1px solid #666', color: '#fff', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>PAUSE</button>
            ) : (
              <button onClick={() => onResumeFork(fork.forkId)} style={{ flex: 1, background: '#333', border: '1px solid #0f0', color: '#0f0', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>RESUME</button>
            )}
            <button onClick={() => onTerminateFork(fork.forkId)} style={{ flex: 1, background: '#300', border: '1px solid #f00', color: '#f00', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>KILL</button>
          </div>
        </div>
      ))}
    </Panel>
    </div>
  );
};
