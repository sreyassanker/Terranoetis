import { useState, useRef, useCallback, useEffect } from 'react';
import * as Cesium from 'cesium';

interface SpatialSketchingProps {
  viewer: Cesium.Viewer | null;
  onClose: () => void;
  onGenerateScenario: (type: string, params: Record<string, unknown>) => void;
}

type DrawMode = 'polygon' | 'rectangle' | 'circle' | null;

const SCENARIO_PROMPTS = [
  { label: 'What if a wildfire started here?', type: 'wildfire_spread' },
  { label: 'What if an earthquake struck?', type: 'earthquake_swarm' },
  { label: 'What if a hurricane made landfall?', type: 'hurricane_landfall' },
  { label: 'What if a tsunami hit this coast?', type: 'tsunami_wave' },
  { label: 'What if this area flooded?', type: 'flood_inundation' },
  { label: 'What if a volcano erupted here?', type: 'volcanic_eruption' },
];

export default function SpatialSketching({ viewer, onClose, onGenerateScenario }: SpatialSketchingProps) {
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [points, setPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [boundingBox, setBoundingBox] = useState<{ minLat: number; maxLat: number; minLon: number; maxLon: number } | null>(null);
  const [activePrompt, setActivePrompt] = useState(SCENARIO_PROMPTS[0]);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawnPrimitivesRef = useRef<Cesium.Entity[]>([]);

  const clearDrawings = useCallback(() => {
    if (!viewer) return;
    for (const ent of drawnPrimitivesRef.current) {
      viewer.entities.remove(ent);
    }
    drawnPrimitivesRef.current = [];
  }, [viewer]);

  useEffect(() => {
    return () => clearDrawings();
  }, [clearDrawings]);

  const startDrawing = useCallback((mode: DrawMode) => {
    if (!viewer) return;
    clearDrawings();
    setDrawMode(mode);
    setIsDrawing(true);
    setPoints([]);
    setBoundingBox(null);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = viewer.camera.pickEllipsoid(click.position);
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      setPoints(prev => {
        const newPoints = [...prev, { lat, lon }];
        if (mode === 'rectangle' && newPoints.length >= 2) {
          const p0 = newPoints[0];
          const p1 = newPoints[1];
          const bb = {
            minLat: Math.min(p0.lat, p1.lat),
            maxLat: Math.max(p0.lat, p1.lat),
            minLon: Math.min(p0.lon, p1.lon),
            maxLon: Math.max(p0.lon, p1.lon),
          };
          setBoundingBox(bb);
          drawRectangle(viewer, bb, drawnPrimitivesRef.current);
          setIsDrawing(false);
          handler.destroy();
        } else if (mode === 'circle' && newPoints.length >= 2) {
          const center = newPoints[0];
          const edge = newPoints[1];
          const radius = haversine(center.lat, center.lon, edge.lat, edge.lon);
          const bb = {
            minLat: center.lat - radius,
            maxLat: center.lat + radius,
            minLon: center.lon - radius,
            maxLon: center.lon + radius,
          };
          setBoundingBox(bb);
          drawCircle(viewer, center, radius, drawnPrimitivesRef.current);
          setIsDrawing(false);
          handler.destroy();
        }
        return newPoints;
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    if (mode === 'polygon') {
      handler.setInputAction(() => {
        if (points.length >= 3) {
          const bb = {
            minLat: Math.min(...points.map(p => p.lat)),
            maxLat: Math.max(...points.map(p => p.lat)),
            minLon: Math.min(...points.map(p => p.lon)),
            maxLon: Math.max(...points.map(p => p.lon)),
          };
          setBoundingBox(bb);
          drawPolygon(viewer, points, drawnPrimitivesRef.current);
          setIsDrawing(false);
          handler.destroy();
        }
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }
  }, [viewer, clearDrawings, points]);

  const handleGenerate = useCallback(() => {
    if (!boundingBox) return;
    const centerLat = (boundingBox.minLat + boundingBox.maxLat) / 2;
    const centerLon = (boundingBox.minLon + boundingBox.maxLon) / 2;
    const spread = Math.max(
      boundingBox.maxLat - boundingBox.minLat,
      boundingBox.maxLon - boundingBox.minLon,
    );

    onGenerateScenario(activePrompt.type, {
      lat: centerLat,
      lon: centerLon,
      spread,
      magnitude: 5,
      intensity: spread * 10,
    });

    clearDrawings();
    setDrawMode(null);
    setBoundingBox(null);
  }, [boundingBox, activePrompt, onGenerateScenario, clearDrawings]);

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 360, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad">✏️</div>
        <div className="ai-title">Spatial Sketching</div>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Prompt Selection */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>What do you want to simulate?</div>
          {SCENARIO_PROMPTS.map(prompt => (
            <div key={prompt.type}
              className={`scenario-card ${activePrompt.type === prompt.type ? 'active' : ''}`}
              style={{
                background: activePrompt.type === prompt.type ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.2)',
                borderRadius: 6, padding: 8, marginBottom: 4, cursor: 'pointer',
                border: activePrompt.type === prompt.type ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}
              onClick={() => setActivePrompt(prompt)}>
              <div style={{ fontSize: 11 }}>{prompt.label}</div>
            </div>
          ))}
        </div>

        {/* Draw Controls */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Draw on Globe</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['polygon', 'rectangle', 'circle'] as DrawMode[]).map(mode => (
              <button key={mode}
                className={`glass-button ${drawMode === mode ? 'active' : ''}`}
                style={{ fontSize: 10, padding: '4px 10px', flex: 1, textTransform: 'capitalize' }}
                onClick={() => startDrawing(mode)}
                disabled={isDrawing}>
                {mode === 'polygon' ? '⬡ Polygon' : mode === 'rectangle' ? '▭ Rectangle' : '○ Circle'}
              </button>
            ))}
          </div>
          {isDrawing && (
            <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>
              {drawMode === 'polygon' ? 'Click to add points. Right-click to finish.' :
               drawMode === 'rectangle' ? 'Click first corner, then opposite corner.' :
               'Click center, then edge point.'}
            </div>
          )}
          {points.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
              {points.length} point{points.length !== 1 ? 's' : ''} recorded
            </div>
          )}
        </div>

        {/* Bounding Box Info */}
        {boundingBox && (
          <div className="scenario-info" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 6, color: 'var(--text-dim)' }}>Selection Boundary</div>
            <div className="info-row"><span className="info-key">Lat</span><span className="info-val">{boundingBox.minLat.toFixed(2)}° – {boundingBox.maxLat.toFixed(2)}°</span></div>
            <div className="info-row"><span className="info-key">Lon</span><span className="info-val">{boundingBox.minLon.toFixed(2)}° – {boundingBox.maxLon.toFixed(2)}°</span></div>
            <div className="info-row"><span className="info-key">Area</span><span className="info-val">{((boundingBox.maxLat - boundingBox.minLat) * (boundingBox.maxLon - boundingBox.minLon) * 111 * 111).toFixed(0)} km²</span></div>
          </div>
        )}

        {/* Generate Button */}
        <button className="glass-button" style={{
          fontSize: 12, padding: '8px 16px',
          background: boundingBox ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
          border: boundingBox ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.1)',
          fontWeight: 600, cursor: boundingBox ? 'pointer' : 'not-allowed', opacity: boundingBox ? 1 : 0.5,
        }} disabled={!boundingBox} onClick={handleGenerate}>
          Generate {activePrompt.type.replace(/_/g, ' ')} Scenario
        </button>

        {/* Clear */}
        {points.length > 0 && (
          <button className="glass-button" style={{ fontSize: 10 }}
            onClick={() => { clearDrawings(); setPoints([]); setBoundingBox(null); setDrawMode(null); setIsDrawing(false); }}>
            Clear Drawing
          </button>
        )}
      </div>
    </div>
  );
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 111.32;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function drawRectangle(viewer: Cesium.Viewer, bb: { minLat: number; maxLat: number; minLon: number; maxLon: number }, target: Cesium.Entity[]) {
  const west = Cesium.Math.toRadians(bb.minLon);
  const south = Cesium.Math.toRadians(bb.minLat);
  const east = Cesium.Math.toRadians(bb.maxLon);
  const north = Cesium.Math.toRadians(bb.maxLat);

  const ent = viewer.entities.add({
    rectangle: {
      coordinates: new Cesium.Rectangle(west, south, east, north),
      material: Cesium.Color.fromAlpha(Cesium.Color.LIME, 0.15),
      outline: true,
      outlineColor: Cesium.Color.LIME,
      outlineWidth: 2,
      height: 0,
    },
  });
  target.push(ent);
}

function drawCircle(viewer: Cesium.Viewer, center: { lat: number; lon: number }, radiusKm: number, target: Cesium.Entity[]) {
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat),
    ellipse: {
      semiMinorAxis: radiusKm * 500,
      semiMajorAxis: radiusKm * 500,
      material: Cesium.Color.fromAlpha(Cesium.Color.CYAN, 0.15),
      outline: true,
      outlineColor: Cesium.Color.CYAN,
      outlineWidth: 2,
      height: 0,
    },
  });
  target.push(ent);
}

function drawPolygon(viewer: Cesium.Viewer, pts: Array<{ lat: number; lon: number }>, target: Cesium.Entity[]) {
  const positions = pts.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  const ent = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      material: Cesium.Color.fromAlpha(Cesium.Color.ORANGE, 0.15),
      outline: true,
      outlineColor: Cesium.Color.ORANGE,
      outlineWidth: 2,
      height: 0,
    },
  });
  target.push(ent);
}
