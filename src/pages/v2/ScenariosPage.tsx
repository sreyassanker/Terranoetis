import React from 'react';
import ScenarioGallery from '@/components/scenarios/ScenarioGallery';

const ScenariosPage: React.FC = () => {
  const dummyScenarios: any[] = [];

  return (
    <div className="v2-scenarios-page">
      <div className="v2-header">
        <div className="v2-logo">
          <span className="v2-logo-icon">🎯</span>
          <span className="v2-logo-text">Scenarios v2</span>
        </div>
        <div className="v2-nav">
          <a href="/v2/globe" className="nav-link">Globe</a>
          <a href="/v2/canvas" className="nav-link">Canvas</a>
          <a href="/v2/scenarios" className="nav-link active">Scenarios</a>
          <a href="/v2/tours" className="nav-link">Tours</a>
          <a href="/" className="nav-link nav-back">Back to v1</a>
        </div>
      </div>
      <div className="v2-scenarios-body">
        <ScenarioGallery
          scenarios={dummyScenarios}
          onSelect={(id) => console.log('selected scenario', id)}
          onCreateNew={() => console.log('create new')}
          onClose={() => {}}
        />
      </div>
      <style>{`
        .v2-scenarios-page { display: flex; flex-direction: column; height: 100vh; background: #0f172a; }
        .v2-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid #1e293b; }
        .v2-logo { display: flex; align-items: center; gap: 8px; }
        .v2-logo-icon { font-size: 20px; }
        .v2-logo-text { font-size: 14px; font-weight: 600; color: #e2e8f0; }
        .v2-nav { display: flex; gap: 4px; align-items: center; }
        .nav-link { padding: 6px 14px; border-radius: 6px; font-size: 13px; color: #94a3b8; text-decoration: none; transition: all 0.15s; }
        .nav-link:hover { background: #1e293b; color: #e2e8f0; }
        .nav-link.active { background: #3b82f6; color: white; }
        .nav-back { border: 1px solid #334155; }
        .v2-scenarios-body { flex: 1; padding: 24px; overflow-y: auto; }
      `}</style>
    </div>
  );
};

export default ScenariosPage;
