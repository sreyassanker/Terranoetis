import React, { useState } from 'react';

interface Tool {
  name: string;
  category: string;
  description: string;
  icon: string;
}

interface ChainStep {
  tool: string;
  params: string;
  id: string;
}

const AVAILABLE_TOOLS: Tool[] = [
  { name: 'earthquakes', category: 'seismic', description: 'Recent M2.5+ earthquakes', icon: '🌍' },
  { name: 'weather_forecast', category: 'weather', description: 'Current weather at lat/lon', icon: '🌤️' },
  { name: 'storms', category: 'weather', description: 'Tropical cyclone tracks', icon: '🌀' },
  { name: 'wildfires', category: 'hazards', description: 'NASA EONET fire events', icon: '🔥' },
  { name: 'floods', category: 'hazards', description: 'Flood events globally', icon: '🌊' },
  { name: 'firms_fires', category: 'hazards', description: 'NASA FIRMS satellite fire', icon: '🛰️' },
  { name: 'satellite_analyze', category: 'multimodal', description: 'Analyze satellite imagery', icon: '📡' },
  { name: 'seismic_events', category: 'multimodal', description: 'Seismic waveform events', icon: '📉' },
  { name: 'radar_fetch', category: 'multimodal', description: 'NEXRAD radar data', icon: '📡' },
  { name: 'sentiment_analyze', category: 'multimodal', description: 'Social sentiment analysis', icon: '💬' },
  { name: 'sandbox_python', category: 'compute', description: 'Run Python analysis', icon: '🐍' },
  { name: 'predict', category: 'ml', description: 'Make prediction', icon: '🔮' },
];

interface ToolWorkbenchProps {
  onClose: () => void;
}

export default function ToolWorkbench({ onClose }: ToolWorkbenchProps) {
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [paramsInput, setParamsInput] = useState('{ "lat": 35, "lon": 140 }');

  function addTool(name: string) {
    setChain(prev => [...prev, { tool: name, params: paramsInput, id: `step_${Date.now()}_${prev.length}` }]);
    setSelectedTool(null);
  }

  function removeStep(id: string) {
    setChain(prev => prev.filter(s => s.id !== id));
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= chain.length) return;
    const next = [...chain];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setChain(next);
  }

  async function executeChain() {
    setExecuting(true);
    setResults({});
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      try {
        let params = {};
        try { params = JSON.parse(step.params); } catch { params = {}; }
        const resp = await fetch('/api/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: step.tool, params }),
        });
        const data = resp.ok ? await resp.json() : { error: `HTTP ${resp.status}` };
        setResults(prev => ({ ...prev, [step.id]: JSON.stringify(data, null, 1).slice(0, 300) }));
      } catch (e) {
        setResults(prev => ({ ...prev, [step.id]: `Error: ${e}` }));
      }
    }
    setExecuting(false);
  }

  function exportChain() {
    const json = JSON.stringify(chain, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toolchain-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const categories = [...new Set(AVAILABLE_TOOLS.map(t => t.category))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <span style={{ fontWeight: 700, fontSize: 13 }}>🔧 Tool Workbench</span>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Tool Palette */}
        <div style={{ width: 140, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Tools</div>
          {categories.map(cat => (
            <div key={cat} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 8, color: 'var(--text-dim)', marginBottom: 2, textTransform: 'uppercase' }}>{cat}</div>
              {AVAILABLE_TOOLS.filter(t => t.category === cat).map(tool => (
                <div key={tool.name}
                  onClick={() => addTool(tool.name)}
                  style={{
                    padding: '3px 6px', fontSize: 9, cursor: 'pointer', borderRadius: 4, marginBottom: 2,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                    color: 'var(--text)', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  title={tool.description}
                >
                  {tool.icon} {tool.name}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Chain Builder */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>
            Chain ({chain.length} steps)
          </div>

          {chain.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
              Click tools on the left to build a chain
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
              {chain.map((step, i) => (
                <div key={step.id} style={{
                  padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--accent)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>#{i + 1}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>{step.tool}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button onClick={() => moveStep(i, i - 1)} disabled={i === 0}
                        style={{ fontSize: 9, padding: '1px 4px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => moveStep(i, i + 1)} disabled={i === chain.length - 1}
                        style={{ fontSize: 9, padding: '1px 4px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', cursor: i === chain.length - 1 ? 'default' : 'pointer', opacity: i === chain.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={() => removeStep(step.id)}
                        style={{ fontSize: 9, padding: '1px 4px', background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                  {/* Data flow arrow */}
                  {i < chain.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0', marginLeft: 8 }}>
                      <span style={{ color: 'var(--teal)', fontSize: 9 }}>↓</span>
                      <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>data flows to {chain[i + 1].tool}</span>
                    </div>
                  )}
                  {/* Result preview */}
                  {results[step.id] && (
                    <div style={{ marginTop: 4, padding: '4px 6px', background: 'rgba(20,184,166,0.04)', borderRadius: 4, fontSize: 8, color: 'var(--teal)', maxHeight: 40, overflow: 'hidden' }}>
                      {results[step.id]}
                    </div>
                  )}
                </div>
              ))}

              {/* Data flow lines (visual connector) */}
              {chain.length > 1 && (
                <div style={{ padding: '6px 8px', fontSize: 8, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--teal)' }}>══════</span>
                  Sequential data flow — output of each step feeds the next
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
            <button onClick={executeChain} disabled={chain.length === 0 || executing}
              style={{
                padding: '4px 12px', fontSize: 10, fontWeight: 600, cursor: chain.length === 0 || executing ? 'default' : 'pointer',
                background: 'linear-gradient(135deg, var(--accent), var(--purple))', border: 'none', borderRadius: 6, color: '#fff',
                opacity: chain.length === 0 || executing ? 0.5 : 1,
              }}>
              {executing ? '▶ Executing...' : '▶ Run Chain'}
            </button>
            <button onClick={exportChain} disabled={chain.length === 0}
              style={{ padding: '4px 10px', fontSize: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: chain.length === 0 ? 'default' : 'pointer', opacity: chain.length === 0 ? 0.3 : 1 }}>
              💾 Export JSON
            </button>
            <button onClick={() => { setChain([]); setResults({}); }}
              style={{ padding: '4px 10px', fontSize: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: 'var(--danger)', cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {showSaveDialog && (
        <div className="share-dialog active" onClick={() => setShowSaveDialog(false)}>
          <div className="share-dialog-content" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Chain exported!</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Saved to downloads as toolchain-{Date.now()}.json</div>
          </div>
        </div>
      )}
    </div>
  );
}
