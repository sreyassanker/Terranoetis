import React, { useState } from 'react';

interface SettingsPanelProps {
  onClose: () => void;
}

const HAZARD_THRESHOLDS = [
  { id: 'earthquake', label: 'Earthquake', default: 4.5, min: 2, max: 8, unit: 'M' },
  { id: 'storm', label: 'Storm', default: 40, min: 20, max: 70, unit: 'dBZ' },
  { id: 'flood', label: 'Flood', default: 0.3, min: 0, max: 1, unit: 'prob' },
  { id: 'wildfire', label: 'Wildfire', default: 0.5, min: 0, max: 1, unit: 'prob' },
  { id: 'tsunami', label: 'Tsunami', default: 0.2, min: 0, max: 1, unit: 'prob' },
  { id: 'tornado', label: 'Tornado', default: 0.4, min: 0, max: 1, unit: 'prob' },
];

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'cognitive' | 'alerts' | 'providers' | 'privacy'>('cognitive');
  const [s1Bias, setS1Bias] = useState(0.6);
  const [s2Bias, setS2Bias] = useState(0.4);
  const [thresholds, setThresholds] = useState(HAZARD_THRESHOLDS.map(t => ({ ...t, value: t.default })));
  const [rememberChats, setRememberChats] = useState(true);
  const [rememberAnalytics, setRememberAnalytics] = useState(true);
  const [autoForgetDays, setAutoForgetDays] = useState(90);

  const tabLabels: Record<string, string> = {
    cognitive: '🧠 Cognitive',
    alerts: '🔔 Alerts',
    providers: '🔑 Providers',
    privacy: '🛡️ Privacy',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <span style={{ fontWeight: 700, fontSize: 13 }}>⚙️ Settings</span>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '4px 6px', gap: 2 }}>
        {(['cognitive', 'alerts', 'providers', 'privacy'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '5px 4px', fontSize: 9, fontWeight: 600, cursor: 'pointer', borderRadius: 6,
              background: activeTab === tab ? 'rgba(59,130,246,0.12)' : 'transparent',
              border: activeTab === tab ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-dim)',
            }}>
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {activeTab === 'cognitive' && (
          <div>
            <div className="cockpit-card" style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>System 1 vs System 2 Bias</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>
                  <span style={{ color: 'var(--accent)' }}>⚡ Fast & Intuitive</span>
                  <span style={{ color: 'var(--purple)' }}>🧠 Deep & Analytical</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={s1Bias} onChange={e => { setS1Bias(parseFloat(e.target.value)); setS2Bias(1 - parseFloat(e.target.value)); }}
                  style={{ width: '100%', accentColor: 'var(--accent)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
                  <span>System 1: {(s1Bias * 100).toFixed(0)}%</span>
                  <span>System 2: {(s2Bias * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Higher System 1 bias means faster responses but less depth.
                Higher System 2 bias enables more thorough analysis but slower replies.
              </div>
            </div>
            <div className="cockpit-card">
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Reasoning Depth</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Quick', 'Balanced', 'Deep', 'Maximum'].map((label, i) => (
                  <button key={label}
                    style={{
                      flex: 1, padding: '4px 0', fontSize: 9, fontWeight: 600, cursor: 'pointer', borderRadius: 6,
                      background: i === 1 ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${i === 1 ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
                      color: i === 1 ? 'var(--accent)' : 'var(--text-dim)',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Per-Hazard Alert Thresholds</div>
            {thresholds.map(t => (
              <div key={t.id} className="cockpit-card" style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{t.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 600 }}>{t.value}{t.unit}</span>
                </div>
                <input type="range" min={t.min} max={t.max} step={t.id === 'earthquake' ? 0.1 : t.unit === 'prob' ? 0.05 : 1}
                  value={t.value}
                  onChange={e => setThresholds(prev => prev.map(x => x.id === t.id ? { ...x, value: parseFloat(e.target.value) } : x))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-dim)' }}>
                  <span>Min: {t.min}{t.unit}</span>
                  <span>Max: {t.max}{t.unit}</span>
                </div>
              </div>
            ))}
            <button style={{
              marginTop: 6, padding: '4px 12px', fontSize: 10, fontWeight: 600,
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 6, color: 'var(--accent)', cursor: 'pointer',
            }}>
              Reset to Defaults
            </button>
          </div>
        )}

        {activeTab === 'providers' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>AI Provider Preferences</div>
            <div className="cockpit-card" style={{ marginBottom: 6 }}>
              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Primary AI Provider</label>
                <select style={{
                  width: '100%', padding: '5px 8px', fontSize: 10, borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)',
                }}>
                  <option>Auto (cheapest available)</option>
                  <option>Gemini</option>
                  <option>Anthropic</option>
                  <option>Groq</option>
                  <option>OpenRouter</option>
                  <option>Together</option>
                </select>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Configure API keys in the <span style={{ color: 'var(--accent)', cursor: 'pointer' }}>API Vault</span> (🔑 button in top bar)
              </div>
            </div>
            <div className="cockpit-card">
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Model Selection Strategy</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['Cost-first', 'Quality-first', 'Balanced'].map(s => (
                  <button key={s}
                    style={{
                      flex: 1, padding: '4px 0', fontSize: 9, cursor: 'pointer', borderRadius: 6,
                      background: s === 'Balanced' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${s === 'Balanced' ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
                      color: s === 'Balanced' ? 'var(--accent)' : 'var(--text-dim)',
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Privacy Controls</div>
            <div className="cockpit-card" style={{ marginBottom: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={rememberChats} onChange={e => setRememberChats(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text)' }}>Remember conversations</div>
                  <div style={{ fontSize: 8, color: 'var(--text-dim)' }}>Store chat history for context and personalization</div>
                </div>
              </label>
            </div>
            <div className="cockpit-card" style={{ marginBottom: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={rememberAnalytics} onChange={e => setRememberAnalytics(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text)' }}>Collect analytics</div>
                  <div style={{ fontSize: 8, color: 'var(--text-dim)' }}>Help improve accuracy with usage data</div>
                </div>
              </label>
            </div>
            <div className="cockpit-card" style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Auto-forget after</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[7, 30, 90, 365].map(d => (
                  <button key={d} onClick={() => setAutoForgetDays(d)}
                    style={{
                      flex: 1, padding: '4px 0', fontSize: 9, cursor: 'pointer', borderRadius: 6,
                      background: d === autoForgetDays ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${d === autoForgetDays ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
                      color: d === autoForgetDays ? 'var(--accent)' : 'var(--text-dim)',
                    }}>
                    {d < 365 ? `${d}d` : '1y'}
                  </button>
                ))}
              </div>
            </div>
            <button style={{
              width: '100%', padding: '4px 0', marginTop: 6, fontSize: 10,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6, color: 'var(--danger)', cursor: 'pointer',
            }}>
              🗑️ Clear All Stored Data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
