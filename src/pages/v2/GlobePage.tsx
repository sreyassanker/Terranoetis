import React from 'react';

const GlowCanvas: React.FC = () => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const animate = () => {
      frame++;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 3; i++) {
        const x = canvas.width / 2 + Math.sin((frame + i * 120) * 0.01) * 120;
        const y = canvas.height / 2 + Math.cos((frame + i * 120) * 0.01) * 80;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 60);
        gradient.addColorStop(0, `hsla(${220 + i * 30}, 70%, 60%, 0.15)`);
        gradient.addColorStop(1, `hsla(${220 + i * 30}, 70%, 60%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 60, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={300}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
};

const GlobePage: React.FC = () => {
  return (
    <div className="v2-globe-page">
      <div className="v2-header">
        <div className="v2-logo">
          <span className="v2-logo-icon">🌍</span>
          <span className="v2-logo-text">Geospatial Intelligence v2</span>
        </div>
        <div className="v2-nav">
          <a href="/v2/globe" className="nav-link active">Globe</a>
          <a href="/v2/canvas" className="nav-link">Canvas</a>
          <a href="/v2/scenarios" className="nav-link">Scenarios</a>
          <a href="/v2/tours" className="nav-link">Tours</a>
          <a href="/" className="nav-link nav-back">Back to v1</a>
        </div>
      </div>
      <div className="v2-globe-container">
        <GlowCanvas />
        <div className="v2-globe-placeholder">
          <h1>Enhanced 3D Globe</h1>
          <p>Cesium Ion Globe + Photorealistic Tiles + Volumetric Weather</p>
          <div className="v2-feature-grid">
            <div className="feature-card">
              <span className="feature-icon">🏔️</span>
              <h3>Photorealistic 3D Tiles</h3>
              <p>Cesium Ion Google 3D Tiles with OSM Buildings fallback</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">🌤️</span>
              <h3>Volumetric Weather</h3>
              <p>Real-time cloud, smoke, and rain particle systems</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">🎤</span>
              <h3>Voice Navigation</h3>
              <p>WebRTC speech-to-globe with VAD and command parsing</p>
            </div>
            <div className="feature-card">
              <span className="feature-icon">🎬</span>
              <h3>Cinematic Tours</h3>
              <p>AI-generated camera flight paths with narration</p>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .v2-globe-page { display: flex; flex-direction: column; height: 100vh; background: #0f172a; position: relative; }
        .v2-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid #1e293b; z-index: 10; }
        .v2-logo { display: flex; align-items: center; gap: 8px; }
        .v2-logo-icon { font-size: 20px; }
        .v2-logo-text { font-size: 14px; font-weight: 600; color: #e2e8f0; }
        .v2-nav { display: flex; gap: 4px; align-items: center; }
        .nav-link { padding: 6px 14px; border-radius: 6px; font-size: 13px; color: #94a3b8; text-decoration: none; transition: all 0.15s; }
        .nav-link:hover { background: #1e293b; color: #e2e8f0; }
        .nav-link.active { background: #3b82f6; color: white; }
        .nav-back { border: 1px solid #334155; }
        .v2-globe-container { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .v2-globe-placeholder { position: relative; z-index: 1; text-align: center; max-width: 720px; padding: 48px; }
        .v2-globe-placeholder h1 { font-size: 32px; font-weight: 700; color: #e2e8f0; margin: 0 0 8px; }
        .v2-globe-placeholder p { color: #64748b; font-size: 15px; margin: 0 0 32px; }
        .v2-feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .feature-card { background: rgba(30, 41, 59, 0.8); border: 1px solid #334155; border-radius: 12px; padding: 20px; text-align: left; backdrop-filter: blur(8px); }
        .feature-icon { font-size: 24px; }
        .feature-card h3 { font-size: 14px; color: #e2e8f0; margin: 8px 0 4px; }
        .feature-card p { font-size: 12px; color: #64748b; margin: 0; }
      `}</style>
    </div>
  );
};

export default GlobePage;
