import React, { useEffect, useState } from 'react';
import ScenarioGallery from '@/components/scenarios/ScenarioGallery';
import type { ScenarioSummary } from '@/components/scenarios/types';
import { authHeaders } from '@/context/AuthContext';

function useScenarioSummaries() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const resp = await fetch('/api/scenarios/search', {
          headers: { ...authHeaders() },
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(resp.status === 401 ? 'Not logged in' : 'Failed to load scenarios');
        const data = await resp.json();
        if (!cancelled) setScenarios(Array.isArray(data?.scenarios) ? data.scenarios : []);
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  return { scenarios, loading, error };
}

const ScenariosPage: React.FC = () => {
  const { scenarios, loading, error } = useScenarioSummaries();
  // Selected-scenario wiring lives in App.tsx (the full SPA view). This v2 page is
  // a standalone gallery; onSelect surfaces to the console for embedders.
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>🎯</span>
          <span style={styles.logoText}>Scenarios v2</span>
        </div>
        <div style={styles.nav}>
          {(['globe', 'canvas', 'scenarios', 'tours'] as const).map(p => (
            <a
              key={p}
              href={`/v2/${p}`}
              style={{ ...styles.navLink, ...(p === 'scenarios' ? styles.navLinkActive : {}) }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </a>
          ))}
          <a href="/" style={{ ...styles.navLink, ...styles.navBack }}>Back to v1</a>
        </div>
      </div>
      <div style={styles.body}>
        <ScenarioGallery
          scenarios={scenarios}
          loading={loading}
          error={error}
          onSelect={(id) => console.log('selected scenario', id)}
          onCreateNew={() => { window.location.href = '/'; }}
          onClose={() => window.history.back()}
        />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 24px', background: 'rgba(15, 23, 42, 0.95)', borderBottom: '1px solid #1e293b',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoIcon: { fontSize: 20 },
  logoText: { fontSize: 14, fontWeight: 600, color: '#e2e8f0' },
  nav: { display: 'flex', gap: 4, alignItems: 'center' },
  navLink: {
    padding: '6px 14px', borderRadius: 6, fontSize: 13,
    color: '#94a3b8', textDecoration: 'none', transition: 'all 0.15s',
  },
  navLinkActive: { background: '#3b82f6', color: 'white' },
  navBack: { border: '1px solid #334155' },
  body: { flex: 1, padding: 24, overflowY: 'auto' },
};

export default ScenariosPage;
