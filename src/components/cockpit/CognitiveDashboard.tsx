import React, { useState, useEffect, useRef } from 'react';

interface BrainActivity {
  system1Load: number;
  system2Load: number;
  activeIntent: string;
  recentLatency: number;
  throughput: number;
}

interface MemoryTier {
  tier: 'working' | 'consolidating' | 'long_term';
  items: Array<{ key: string; age: string; size: string }>;
  utilization: number;
}

interface CognitiveDashboardProps {
  onClose: () => void;
}

function ActivitySparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 30;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ borderRadius: 4, background: 'rgba(255,255,255,0.02)' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AnimatedBrain({ system1Load, system2Load }: { system1Load: number; system2Load: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [particles] = useState(() =>
    Array.from({ length: 40 }, () => ({
      x: Math.random() * 200, y: Math.random() * 200,
      vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 3 + 1, a: Math.random() * 0.5 + 0.3,
    }))
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame: number;
    const animate = () => {
      ctx.clearRect(0, 0, 200, 200);
      // Neural connections
      ctx.strokeStyle = `rgba(59,130,246,${0.05 + system1Load * 0.1})`;
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 50) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x + 100, particles[i].y + 100);
            ctx.lineTo(particles[j].x + 100, particles[j].y + 100);
            ctx.stroke();
          }
        }
      }
      // System 1 particles (fast, blue)
      const s1Count = Math.floor(system1Load * 20) + 5;
      for (let i = 0; i < s1Count && i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -100 || p.x > 100) p.vx *= -1;
        if (p.y < -100 || p.y > 100) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x + 100, p.y + 100, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59,130,246,${p.a})`;
        ctx.fill();
      }
      // System 2 particles (slow, purple)
      const s2Start = s1Count;
      const s2Count = Math.floor(system2Load * 15) + 3;
      for (let i = s2Start; i < s2Start + s2Count && i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * 0.3; p.y += p.vy * 0.3;
        if (p.x < -100 || p.x > 100) p.vx *= -1;
        if (p.y < -100 || p.y > 100) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x + 100, p.y + 100, p.r * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168,85,247,${p.a})`;
        ctx.fill();
      }
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [system1Load, system2Load, particles]);

  return (
    <canvas ref={canvasRef} width={200} height={200} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }} />
  );
}

function PredictionTimeline() {
  const predictions = [
    { label: 'M6+ earthquake', prob: 0.15, ci: [0.08, 0.24] as [number, number], time: '+2h', color: 'var(--warning)' },
    { label: 'Storm intensification', prob: 0.62, ci: [0.45, 0.78] as [number, number], time: '+6h', color: 'var(--danger)' },
    { label: 'Flood risk', prob: 0.31, ci: [0.20, 0.44] as [number, number], time: '+12h', color: 'var(--warning)' },
    { label: 'Fire spread', prob: 0.08, ci: [0.03, 0.15] as [number, number], time: '+24h', color: 'var(--success)' },
    { label: 'Tsunami risk', prob: 0.02, ci: [0.00, 0.06] as [number, number], time: '+48h', color: 'var(--success)' },
  ];

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px 10px' }}>Predictions</div>
      {predictions.map((p, i) => (
        <div key={i} style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
          <span style={{ width: 80, color: 'var(--text-dim)' }}>{p.time}</span>
          <span style={{ flex: 1, color: 'var(--text)' }}>{p.label}</span>
          <div style={{ position: 'relative', width: 60, height: 14, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: `${p.ci[0] * 100}%`, width: `${(p.ci[1] - p.ci[0]) * 100}%`, height: '100%', background: `${p.color}30`, borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: `${p.prob * 100}%`, width: 4, height: '100%', background: p.color, borderRadius: 2, transform: 'translateX(-2px)' }} />
          </div>
          <span style={{ color: p.color, fontWeight: 600, width: 30, textAlign: 'right' }}>{(p.prob * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function MemoryTierBar({ tier, items, utilization }: MemoryTier) {
  const labelColor = tier === 'working' ? 'var(--accent)' : tier === 'consolidating' ? 'var(--purple)' : 'var(--teal)';
  const barColor = tier === 'working' ? 'rgba(59,130,246,0.3)' : tier === 'consolidating' ? 'rgba(168,85,247,0.3)' : 'rgba(20,184,166,0.3)';
  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: labelColor }}>
          {tier === 'working' ? '⚡ Working' : tier === 'consolidating' ? '💤 Consolidating' : '📦 Long-term'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{items.length} items</span>
        <div style={{ marginLeft: 'auto', width: 60, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${utilization * 100}%`, height: '100%', background: barColor, borderRadius: 2 }} />
        </div>
      </div>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {items.map((item, j) => (
            <span key={j} style={{ fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.04)', borderRadius: 3, color: 'var(--text-dim)' }}>
              {item.key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CognitiveDashboard({ onClose }: CognitiveDashboardProps) {
  const [brainActivity, setBrainActivity] = useState<BrainActivity>({ system1Load: 0.6, system2Load: 0.3, activeIntent: 'earthquake_monitoring', recentLatency: 320, throughput: 12 });
  const [history] = useState<number[]>(() => Array.from({ length: 30 }, () => Math.random() * 0.8 + 0.2));
  const [memoryTiers] = useState<MemoryTier[]>([
    { tier: 'working', items: [{ key: 'Tokyo earthquake', age: '2m', size: '4KB' }, { key: 'Pacific storm', age: '5m', size: '2KB' }, { key: 'User: Japan', age: '1m', size: '1KB' }], utilization: 0.7 },
    { tier: 'consolidating', items: [{ key: 'Seismic patterns', age: '15m', size: '12KB' }, { key: 'Weather corpus', age: '1h', size: '45KB' }], utilization: 0.4 },
    { tier: 'long_term', items: [{ key: 'Tectonic plates', age: '7d', size: '120KB' }, { key: 'Disaster response', age: '3d', size: '80KB' }, { key: 'User preferences', age: '2d', size: '8KB' }], utilization: 0.3 },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBrainActivity(prev => ({
        ...prev,
        system1Load: 0.3 + Math.random() * 0.5,
        system2Load: 0.1 + Math.random() * 0.4,
        throughput: Math.round(8 + Math.random() * 20),
        recentLatency: Math.round(200 + Math.random() * 400),
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const intentLabels: Record<string, string> = {
    earthquake_monitoring: 'Monitoring seismic activity',
    weather_analysis: 'Analyzing weather patterns',
    user_query: 'Processing user request',
    idle: 'Idle — watching',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <span style={{ background: 'linear-gradient(135deg, #3b82f6, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700, fontSize: 13 }}>
          🧠 Cognitive Dashboard
        </span>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {/* Brain Activity */}
        <div className="cockpit-card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <AnimatedBrain system1Load={brainActivity.system1Load} system2Load={brainActivity.system2Load} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>System Load</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
                <div>
                  <div style={{ color: 'var(--accent)', fontWeight: 600 }}>System 1 (Fast)</div>
                  <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
                    <div style={{ width: `${brainActivity.system1Load * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <span style={{ color: 'var(--text-dim)' }}>{(brainActivity.system1Load * 100).toFixed(0)}%</span>
                </div>
                <div>
                  <div style={{ color: 'var(--purple)', fontWeight: 600 }}>System 2 (Deep)</div>
                  <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
                    <div style={{ width: `${brainActivity.system2Load * 100}%`, height: '100%', background: 'var(--purple)', borderRadius: 3 }} />
                  </div>
                  <span style={{ color: 'var(--text-dim)' }}>{(brainActivity.system2Load * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-dim)' }}>
                {intentLabels[brainActivity.activeIntent] || 'Processing'}
              </div>
            </div>
          </div>
        </div>

        {/* Throughput Sparkline */}
        <div className="cockpit-card">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Activity</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ActivitySparkline values={history} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Throughput</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{brainActivity.throughput}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/s</span></div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Latency</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: brainActivity.recentLatency < 300 ? 'var(--success)' : 'var(--warning)' }}>{brainActivity.recentLatency}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>ms</span></div>
            </div>
          </div>
        </div>

        {/* Memory Tiers */}
        <div className="cockpit-card" style={{ padding: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', padding: '8px 10px 4px' }}>Memory</div>
          {memoryTiers.map((tier, i) => <MemoryTierBar key={i} {...tier} />)}
          {memoryTiers.some(t => t.tier === 'consolidating') && (
            <div style={{ padding: '4px 10px 8px', fontSize: 9, color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="pulse-dot" /> Dreaming now... consolidating new experiences
            </div>
          )}
        </div>

        {/* Prediction Timeline */}
        <div className="cockpit-card" style={{ padding: '6px 0' }}>
          <PredictionTimeline />
        </div>
      </div>
    </div>
  );
}
