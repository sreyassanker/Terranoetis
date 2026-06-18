import React from 'react';

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
}

export const ForkPanel: React.FC<ForkPanelProps> = ({ forks, onPauseFork, onResumeFork, onTerminateFork }) => {
  if (forks.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '80px',
      right: '20px',
      width: '280px',
      background: 'rgba(0, 0, 0, 0.85)',
      border: '1px solid #FF8C00',
      borderRadius: '8px',
      padding: '12px',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: '12px',
      zIndex: 1000,
      maxHeight: '400px',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #FF8C00', paddingBottom: '4px' }}>
        <span style={{ color: '#FF8C00', fontWeight: 'bold', fontSize: '14px' }}>🍴 PARALLEL REALITIES</span>
        <span style={{ color: '#888' }}>{forks.length} active</span>
      </div>
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
    </div>
  );
};
