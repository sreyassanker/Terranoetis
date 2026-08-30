import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Pen } from 'lucide-react';
import * as Cesium from 'cesium';
import Panel from '@/components/ui/Panel';

import { haversineKm, circleBbox } from './geo';
import { buildVolcanoShapes } from './volcanoShapes';
import VolcanicVisualizer from './VolcanicVisualizer';
import type { ShapeData } from './types';

interface SpatialSketchingProps {
  viewer: Cesium.Viewer | null;
  onClose: () => void;
  onGenerateScenario: (type: string, params: Record<string, unknown>) => void;
  zIndex?: number;
}

type DrawMode = 'polygon' | 'rectangle' | 'circle' | null;

const SCENARIO_PROMPTS = [
  { label: 'What if a wildfire started here?', type: 'wildfire_spread' },
  { label: 'What if an earthquake struck?', type: 'earthquake_swarm' },
  { label: 'What if a hurricane made landfall?', type: 'hurricane_landfall' },
  { label: 'What if a tsunami hit this coast?', type: 'tsunami_wave' },
  { label: 'What if this area flooded?', type: 'flood_inundation' },
  { label: 'What if a volcano erupted here?', type: 'volcanic_eruption' },
  { label: 'What if a landslide occurred here?', type: 'landslide' },
];

export default function SpatialSketching({ viewer, onClose, onGenerateScenario, zIndex = 110 }: SpatialSketchingProps) {
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [points, setPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [boundingBox, setBoundingBox] = useState<{ minLat: number; maxLat: number; minLon: number; maxLon: number } | null>(null);
  const [activePrompt, setActivePrompt] = useState(SCENARIO_PROMPTS[0]);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawnPrimitivesRef = useRef<Cesium.Entity[]>([]);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  // Mutable mirror of `points` so Cesium event handlers always read the latest
  // vertex list (state read inside a ScreenSpaceEventHandler closure is stale).
  const pointsRef = useRef<Array<{ lat: number; lon: number }>>([]);
  // Volcanic hazard zones generated from the sketched bbox — rendered by
  // VolcanicVisualizer. Pure derivation: rebuilt whenever the bbox or the
  // active prompt changes (no setState-in-effect cascade).
  const volcanoShapes = useMemo<ShapeData[]>(() => {
    if (!boundingBox || activePrompt.type !== 'volcanic_eruption') return [];
    const centerLat = (boundingBox.minLat + boundingBox.maxLat) / 2;
    const centerLon = (boundingBox.minLon + boundingBox.maxLon) / 2;
    const spreadKm = Math.max(
      (boundingBox.maxLat - boundingBox.minLat) * 111,
      (boundingBox.maxLon - boundingBox.minLon) * 111 * Math.cos(centerLat * Math.PI / 180),
    );
    return buildVolcanoShapes({
      center: { lat: centerLat, lon: centerLon },
      radiusKm: spreadKm / 2,
      downslopeDeg: 180, // default south — will be refined by the terrain gradient
    });
  }, [boundingBox, activePrompt.type]);
  const sketchProgress = 0.5;

  const clearDrawings = useCallback(() => {
    if (!viewer) return;
    if (handlerRef.current && !handlerRef.current.isDestroyed()) {
      handlerRef.current.destroy();
    }
    handlerRef.current = null;
    for (const ent of drawnPrimitivesRef.current) {
      viewer.entities.remove(ent);
    }
    drawnPrimitivesRef.current = [];
  }, [viewer]);

  useEffect(() => {
    return () => clearDrawings();
  }, [clearDrawings]);

  const cancelDrawing = useCallback(() => {
    clearDrawings();
    pointsRef.current = [];
    setPoints([]);
    setBoundingBox(null);
    setDrawMode(null);
    setIsDrawing(false);
  }, [clearDrawings]);

  const startDrawing = useCallback((mode: DrawMode) => {
    if (!viewer) return;
    clearDrawings();
    setDrawMode(mode);
    setIsDrawing(true);
    pointsRef.current = [];
    setPoints([]);
    setBoundingBox(null);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = viewer.camera.pickEllipsoid(click.position);
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      const newPoints = [...pointsRef.current, { lat, lon }];
      pointsRef.current = newPoints;
      setPoints(newPoints);

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
        if (!handler.isDestroyed()) handler.destroy();
      } else if (mode === 'circle' && newPoints.length >= 2) {
        const center = newPoints[0];
        const radius = haversineKm(center.lat, center.lon, newPoints[1].lat, newPoints[1].lon);
        const bb = circleBbox(center, radius);
        setBoundingBox(bb);
        drawCircle(viewer, center, radius, drawnPrimitivesRef.current);
        setIsDrawing(false);
        if (!handler.isDestroyed()) handler.destroy();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    if (mode === 'polygon') {
      // Suppress the default context menu so right-click finishes cleanly.
      viewer.scene.canvas.addEventListener('contextmenu', preventContextMenu);
      handler.setInputAction(() => {
        const pts = pointsRef.current;
        if (pts.length >= 3) {
          const bb = {
            minLat: Math.min(...pts.map(p => p.lat)),
            maxLat: Math.max(...pts.map(p => p.lat)),
            minLon: Math.min(...pts.map(p => p.lon)),
            maxLon: Math.max(...pts.map(p => p.lon)),
          };
          setBoundingBox(bb);
          drawPolygon(viewer, pts, drawnPrimitivesRef.current);
          setIsDrawing(false);
          viewer.scene.canvas.removeEventListener('contextmenu', preventContextMenu);
          if (!handler.isDestroyed()) handler.destroy();
        }
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }
  }, [viewer, clearDrawings]);

  // Escape cancels an in-progress drawing.
  useEffect(() => {
    if (!isDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrawing();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawing, cancelDrawing]);

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
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 360 }}>
      <Panel
        title="SPATIAL SKETCHING"
        icon={<Pen size={14} />}
        accentColor="#3b82f6"
        iconColor="#60a5fa"
        titleColor="#93c5fd"
        onClose={onClose}
        style={{ maxHeight: 'calc(100vh - 92px)' }}
      >

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
              {drawMode === 'polygon' ? 'Click to add points. Right-click to finish. Esc to cancel.' :
               drawMode === 'rectangle' ? 'Click first corner, then opposite corner. Esc to cancel.' :
               'Click center, then edge point. Esc to cancel.'}
            </div>
          )}
          {isDrawing && (
            <button className="glass-button" style={{ fontSize: 10, marginTop: 4, width: '100%' }} onClick={cancelDrawing}>
              Cancel ({drawMode})
            </button>
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
            onClick={cancelDrawing}>
            Clear Drawing
          </button>
        )}
      </div>
    </Panel>
    {/* Volcanic hazard zones rendered on the Cesium globe */}
    <VolcanicVisualizer
      viewer={viewer}
      shapes={volcanoShapes}
      progress={sketchProgress}
    />
    </div>
  );
}

function preventContextMenu(e: Event): void {
  e.preventDefault();
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
  const radiusM = radiusKm * 1000;
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat),
    ellipse: {
      semiMinorAxis: radiusM,
      semiMajorAxis: radiusM,
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
