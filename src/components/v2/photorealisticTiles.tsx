import React, { useEffect, useRef, useCallback, useState } from 'react';
import type * as Cesium from 'cesium';

interface PhotorealisticTilesProps {
  viewer: Cesium.Viewer;
  enabled: boolean;
  ionToken?: string;
  onToggle?: (enabled: boolean) => void;
}

const PHOTOREALISTIC_ASSET_ID = 2275207;
const OSM_BUILDINGS_ASSET_ID = 96188;

const PhotorealisticTiles: React.FC<PhotorealisticTilesProps> = ({
  viewer, enabled, ionToken, onToggle,
}) => {
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const isMounted = useRef(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tileStats, setTileStats] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);

  useEffect(() => {
    viewerRef.current = viewer;
  }, [viewer]);

  const addTileset = useCallback(async () => {
    if (!viewer || !viewer.scene || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const assetId = ionToken ? PHOTOREALISTIC_ASSET_ID : OSM_BUILDINGS_ASSET_ID;
      const cesiumWindow = (window as unknown as Record<string, unknown>).Cesium as Record<string, unknown> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tileset = await (cesiumWindow as any)?.Cesium3DTileset?.fromIonAssetId(assetId, {
        accessToken: ionToken || undefined,
      });
      if (tileset) {
        tileset.tileLoad.addEventListener(() => {
          setTileStats({ loaded: tileset.tilesLoaded, total: tileset.tilesLoading + tileset.tilesLoaded });
        });
        viewer.scene.primitives.add(tileset);
        tilesetRef.current = tileset;
        viewer.zoomTo(tileset);
      }
      setLoading(false);
    } catch (err) {
      console.warn('Failed to load 3D tiles, using fallback terrain', err);
      if (isMounted.current) {
        setError('Failed to load 3D tiles. Using terrain fallback.');
        setLoading(false);
      }
    }
  }, [viewer, enabled, ionToken]);

  const removeTileset = useCallback(() => {
    if (tilesetRef.current && viewer?.scene?.primitives) {
      viewer.scene.primitives.remove(tilesetRef.current);
      tilesetRef.current = null;
    }
    setTileStats({ loaded: 0, total: 0 });
  }, [viewer]);

  useEffect(() => {
    isMounted.current = true;
    if (enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void addTileset();
    } else {
      removeTileset();
    }
    return () => {
      isMounted.current = false;
      removeTileset();
    };
  }, [enabled, addTileset, removeTileset]);

  useEffect(() => {
    const cesiumViewer = viewerRef.current;
    if (cesiumViewer?.scene?.globe) {
      cesiumViewer.scene.globe.enableLighting = enabled;
      cesiumViewer.scene.globe.showGroundAtmosphere = enabled;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cesiumViewer.scene.globe as any).terrainExaggeration = terrainExaggeration;
    }
  }, [enabled, terrainExaggeration]);

  return (
    <div className="photorealistic-tiles">
      <button
        className={`layer-toggle ${enabled ? 'active' : ''}`}
        onClick={() => onToggle?.(!enabled)}
        title={enabled ? 'Disable photorealistic tiles' : 'Enable photorealistic tiles'}
        disabled={loading}
      >
        <span className="toggle-icon">🏔️</span>
        <span className="toggle-label">Photorealistic</span>
        {loading ? (
          <span className="toggle-loading">Loading...</span>
        ) : (
          <span className="toggle-status">{enabled ? 'ON' : 'OFF'}</span>
        )}
      </button>
      {error && <div className="toggle-error">{error}</div>}
      {enabled && tileStats.total > 0 && (
        <div className="tile-stats">Tiles: {tileStats.loaded}/{tileStats.total}</div>
      )}
      {enabled && (
        <div className="terrain-controls">
          <label className="terrain-label">
            <span>Exaggeration</span>
            <span className="terrain-val">{terrainExaggeration}x</span>
          </label>
          <input
            type="range" min={0.5} max={5} step={0.5}
            value={terrainExaggeration}
            onChange={e => setTerrainExaggeration(parseFloat(e.target.value))}
            className="terrain-slider"
          />
        </div>
      )}
      {enabled && (
        <div className="ion-info">
          {ionToken ? 'Google Photorealistic 3D Tiles' : 'OSM Buildings (fallback)'}
        </div>
      )}
      <style>{`
        .photorealistic-tiles { position: absolute; bottom: 16px; right: 16px; z-index: 100; display: flex; flex-direction: column; gap: 4px; }
        .layer-toggle { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(148, 163, 184, 0.3); border-radius: 8px; color: #e2e8f0; cursor: pointer; font-size: 13px; backdrop-filter: blur(8px); transition: all 0.2s; }
        .layer-toggle:hover { background: rgba(30, 41, 59, 0.9); border-color: rgba(148, 163, 184, 0.5); }
        .layer-toggle.active { border-color: #3b82f6; box-shadow: 0 0 12px rgba(59, 130, 246, 0.3); }
        .layer-toggle:disabled { opacity: 0.5; cursor: wait; }
        .toggle-loading { font-size: 10px; color: #f59e0b; }
        .toggle-status { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
        .layer-toggle.active .toggle-status { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .toggle-error { padding: 4px 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; font-size: 10px; color: #f87171; }
        .tile-stats { padding: 4px 8px; font-size: 10px; color: #64748b; text-align: center; background: rgba(15,23,42,0.6); border-radius: 6px; }
        .terrain-controls { padding: 6px 12px; background: rgba(15,23,42,0.8); border: 1px solid #334155; border-radius: 8px; }
        .terrain-label { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 2px; }
        .terrain-val { color: #e2e8f0; font-weight: 600; }
        .terrain-slider { width: 100%; height: 4px; -webkit-appearance: none; background: #334155; border-radius: 2px; outline: none; }
        .terrain-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #3b82f6; cursor: pointer; }
        .ion-info { padding: 4px 8px; font-size: 9px; color: #475569; text-align: center; background: rgba(15,23,42,0.4); border-radius: 6px; }
      `}</style>
    </div>
  );
};

export default PhotorealisticTiles;
