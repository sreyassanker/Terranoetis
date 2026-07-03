import React, { useState, useEffect, useRef } from 'react';

interface HealthResponse {
  uptime?: number;
  engines?: Record<string, { status?: string; active?: boolean }>;
}

interface CognitiveDashboardProps {
  onClose: () => void;
}

interface SystemMetrics {
  activeAlerts: number;
  memoryCount: number;
  uptime: string;
  engineStatus: Record<string, string>;
  sentinelActive: boolean;
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

function AnimatedBrain({ load }: { load: number }) {
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
      ctx.strokeStyle = `rgba(59,130,246,${0.05 + load * 0.1})`;
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
      const activeCount = Math.floor(load * 25) + 5;
      for (let i = 0; i < activeCount && i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -100 || p.x > 100) p.vx *= -1;
        if (p.y < -100 || p.y > 100) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x + 100, p.y + 100, p.r, 0, Math.PI * 2);
        ctx.fillStyle = i < activeCount * 0.6
          ? `rgba(59,130,246,${p.a})`
          : `rgba(168,85,247,${p.a})`;
        ctx.fill();
      }
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [load, particles]);

  return (
    <canvas ref={canvasRef} width={200} height={200} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }} />
  );
}

function MemoryTierBar({ tier, count }: { tier: string; count: number }) {
  const tierConfig: Record<string, { label: string; color: string; barColor: string }> = {
    sensory: { label: '👁 Sensory', color: 'var(--accent)', barColor: 'rgba(59,130,246,0.3)' },
    working: { label: '⚡ Working', color: 'var(--accent)', barColor: 'rgba(59,130,246,0.3)' },
    episodic: { label: '📖 Episodic', color: 'var(--purple)', barColor: 'rgba(168,85,247,0.3)' },
    semantic: { label: '🧩 Semantic', color: 'var(--purple)', barColor: 'rgba(168,85,247,0.3)' },
    consolidating: { label: '💤 Consolidating', color: 'var(--purple)', barColor: 'rgba(168,85,247,0.3)' },
    procedural: { label: '🔧 Procedural', color: 'var(--teal)', barColor: 'rgba(20,184,166,0.3)' },
    long_term: { label: '📦 Long-term', color: 'var(--teal)', barColor: 'rgba(20,184,166,0.3)' },
    predictive: { label: '🔮 Predictive', color: 'var(--warning)', barColor: 'rgba(245,158,11,0.3)' },
  };
  const config = tierConfig[tier] || { label: tier, color: 'var(--text-dim)', barColor: 'rgba(255,255,255,0.1)' };
  const maxItems = 500;
  const utilization = Math.min(count / maxItems, 1);
  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: config.color }}>{config.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{count} items</span>
        <div style={{ marginLeft: 'auto', width: 60, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${utilization * 100}%`, height: '100%', background: config.barColor, borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

export default function CognitiveDashboard({ onClose }: CognitiveDashboardProps) {
  const [metrics, setMetrics] = useState<SystemMetrics>({
    activeAlerts: 0, memoryCount: 0, uptime: '—', engineStatus: {}, sentinelActive: false,
  });
  const [memoryTiers, setMemoryTiers] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: 30 }, () => 0));
  const [load, setLoad] = useState(0.3);

  useEffect(() => {
    let mounted = true;
    const fetchMetrics = async () => {
      try {
        const [healthRes, memRes, alertRes] = await Promise.allSettled([
          fetch('/api/health').then(r => r.ok ? r.json() : null),
          fetch('/api/memory/status').then(r => r.ok ? r.json() : null),
          fetch('/api/sentinel/alerts').then(r => r.ok ? r.json() : null),
        ]);

        if (!mounted) return;

        const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
        const mem = memRes.status === 'fulfilled' ? memRes.value : null;
        const alerts = alertRes.status === 'fulfilled' ? alertRes.value : null;

        if (health) {
          const engines = (health as HealthResponse).engines || {};
          const activeCount = Object.values(engines).filter((e) => e?.status === 'running' || e?.active).length;
          const totalEngines = Object.keys(engines).length || 1;
          setLoad(activeCount / totalEngines);
          setMetrics(prev => ({
            ...prev,
            uptime: (health as HealthResponse).uptime ? `${Math.floor((health as HealthResponse).uptime! / 60)}m` : '—',
            engineStatus: Object.fromEntries(
              Object.entries(engines).map(([k, v]: [string, { status?: string; active?: boolean }]) => [k, v?.status || v?.active ? 'active' : 'idle'])
            ),
            sentinelActive: !!engines.sentinel?.active,
          }));
        }

        if (mem) {
          const tiers = mem.tiers || mem;
          const tierCounts: Record<string, number> = {};
          if (typeof tiers === 'object') {
            for (const [k, v] of Object.entries(tiers as Record<string, unknown>)) {
              tierCounts[k] = typeof v === 'number' ? v : ((v as { count?: number })?.count ?? 0);
            }
          }
          setMemoryTiers(tierCounts);
          const total = Object.values(tierCounts).reduce((a, b) => a + b, 0);
          setMetrics(prev => ({ ...prev, memoryCount: total }));
        }

        if (alerts && Array.isArray(alerts)) {
          setMetrics(prev => ({ ...prev, activeAlerts: alerts.length }));
        }
      } catch {
        // ignore fetch errors
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);

    // Update sparkline with real alert count trend
    const sparklineInterval = setInterval(() => {
      setHistory(prev => {
        const next = [...prev.slice(1), metrics.activeAlerts || 0];
        return next;
      });
    }, 3000);

    return () => { mounted = false; clearInterval(interval); clearInterval(sparklineInterval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeEngines = Object.values(metrics.engineStatus).filter(s => s === 'active').length;
  const totalEngines = Object.keys(metrics.engineStatus).length || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <span style={{ background: 'linear-gradient(135deg, #3b82f6, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700, fontSize: 13 }}>
          🧠 Cognitive Dashboard
        </span>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {/* System Status */}
        <div className="cockpit-card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <AnimatedBrain load={load} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>System Status</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
                <div>
                  <div style={{ color: 'var(--accent)', fontWeight: 600 }}>Engines</div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{activeEngines}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/{totalEngines}</span></span>
                </div>
                <div>
                  <div style={{ color: metrics.sentinelActive ? 'var(--success)' : 'var(--text-dim)', fontWeight: 600 }}>Sentinel</div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: metrics.sentinelActive ? 'var(--success)' : 'var(--text-dim)' }}>{metrics.sentinelActive ? 'ON' : 'OFF'}</span>
                </div>
              </div>
              <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-dim)' }}>
                Uptime: {metrics.uptime}
              </div>
            </div>
          </div>
        </div>

        {/* Activity Sparkline */}
        <div className="cockpit-card">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Activity</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ActivitySparkline values={history} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Active Alerts</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: metrics.activeAlerts > 0 ? 'var(--warning)' : 'var(--success)' }}>{metrics.activeAlerts}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Memory</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{metrics.memoryCount}</div>
            </div>
          </div>
        </div>

        {/* Memory Tiers */}
        <div className="cockpit-card" style={{ padding: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', padding: '8px 10px 4px' }}>Memory</div>
          {Object.entries(memoryTiers).length > 0 ? (
            Object.entries(memoryTiers).map(([tier, count]) => (
              <MemoryTierBar key={tier} tier={tier} count={count} />
            ))
          ) : (
            <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text-dim)' }}>Loading memory status...</div>
          )}
        </div>

        {/* Engine Status */}
        <div className="cockpit-card" style={{ padding: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', padding: '8px 10px 4px' }}>Engines</div>
          {Object.entries(metrics.engineStatus).slice(0, 8).map(([name, status]) => (
            <div key={name} style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'active' ? 'var(--success)' : 'var(--text-dim)' }} />
              <span style={{ color: 'var(--text)', flex: 1 }}>{name}</span>
              <span style={{ color: status === 'active' ? 'var(--success)' : 'var(--text-dim)', fontSize: 9 }}>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
