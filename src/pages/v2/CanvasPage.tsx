import React from 'react';
import SpatialCanvas from '@/components/v2/spatialCanvas';

const CanvasPage: React.FC = () => {
  return (
    <div className="v2-canvas-page">
      <div className="v2-header">
        <div className="v2-logo">
          <span className="v2-logo-icon">[CANVAS]</span>
          <span className="v2-logo-text">Spatial Canvas v2</span>
        </div>
        <div className="v2-nav">
          <a href="/v2/globe" className="nav-link">Globe</a>
          <a href="/v2/canvas" className="nav-link active">Canvas</a>
          <a href="/v2/scenarios" className="nav-link">Scenarios</a>
          <a href="/v2/tours" className="nav-link">Tours</a>
          <a href="/" className="nav-link nav-back">Back to v1</a>
        </div>
      </div>
      <div className="v2-canvas-body">
        <SpatialCanvas />
      </div>
      <style>{`
        .v2-canvas-page { display: flex; flex-direction: column; height: 100vh; background: #0f172a; }
        .v2-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid #1e293b; }
        .v2-logo { display: flex; align-items: center; gap: 8px; }
        .v2-logo-icon { font-size: 20px; }
        .v2-logo-text { font-size: 14px; font-weight: 600; color: #e2e8f0; }
        .v2-nav { display: flex; gap: 4px; align-items: center; }
        .nav-link { padding: 6px 14px; border-radius: 6px; font-size: 13px; color: #94a3b8; text-decoration: none; transition: all 0.15s; }
        .nav-link:hover { background: #1e293b; color: #e2e8f0; }
        .nav-link.active { background: #3b82f6; color: white; }
        .nav-back { border: 1px solid #334155; }
        .v2-canvas-body { flex: 1; overflow: hidden; }
      `}</style>
    </div>
  );
};

export default CanvasPage;
