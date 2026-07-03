import { useState, useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';

interface Waypoint {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
}

interface CameraPath {
  name: string;
  description: string;
  category: string;
  duration: number;
  waypoints: Waypoint[];
  narration: string[];
}

interface CinematicDirectorProps {
  viewer: Cesium.Viewer | null;
  onClose: () => void;
  layerVersion?: number;
  focusEntity?: { lat: number; lon: number; layer: string; name?: string } | null;
}

/* ── Easing ────────────────────────────────────────────── */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/* ── Entity extraction ─────────────────────────────────── */

const DISASTER_LAYERS = ['earthquakes', 'wildfires', 'volcanoes', 'floods', 'severe_storms', 'dust'];

function extractEntityPositions(viewer: Cesium.Viewer): Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]> {
  const groups = new Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]>();
  const now = Cesium.JulianDate.now();

  for (const entity of viewer.entities.values) {
    // Skip hidden entities (layer toggled off)
    if (entity.show === false) continue;

    const props = entity.properties?.getValue(now) as Record<string, unknown> | undefined;
    const layer = (props?.layer as string) ?? '';
    if (!DISASTER_LAYERS.includes(layer)) continue;

    let pos: Cesium.Cartesian3 | undefined;
    if (entity.position) {
      pos = entity.position.getValue instanceof Function ? entity.position.getValue(now) : entity.position as unknown as Cesium.Cartesian3;
    }
    if (!pos) continue;

    const carto = Cesium.Cartographic.fromCartesian(pos);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const mag = typeof props?.magnitude === 'number' ? props.magnitude : undefined;
    const name = typeof props?.place === 'string' ? props.place : typeof entity.name === 'string' ? entity.name : undefined;

    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer)!.push({ lat, lon, magnitude: mag, name });
  }

  return groups;
}

/* ── Dynamic path generation ───────────────────────────── */

function generateOrbitalPath(
  name: string,
  category: string,
  description: string,
  lat: number,
  lon: number,
  baseHeight: number,
  orbitRadius: number,
  segments: number,
  narration: string[],
): CameraPath {
  const waypoints: Waypoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    waypoints.push({
      lat: lat + (Math.cos(angle) * orbitRadius) / 111320,
      lon: lon + (Math.sin(angle) * orbitRadius) / (111320 * Math.cos((lat * Math.PI) / 180)),
      height: baseHeight,
      heading: Cesium.Math.toDegrees(angle) + 180,
      pitch: -45,
    });
  }
  return { name, description, category, duration: segments * 2.5, waypoints, narration };
}

function generateFlyThroughPath(
  name: string,
  category: string,
  description: string,
  lat: number,
  lon: number,
  narration: string[],
): CameraPath {
  return {
    name,
    description,
    category,
    duration: 12,
    waypoints: [
      { lat: lat - 2, lon: lon - 3, height: 80000, heading: 30, pitch: -25 },
      { lat: lat - 0.5, lon: lon - 1, height: 40000, heading: 45, pitch: -35 },
      { lat, lon, height: 15000, heading: 60, pitch: -60 },
      { lat: lat + 0.3, lon: lon + 0.5, height: 5000, heading: 90, pitch: -75 },
    ],
    narration,
  };
}

function generateRevealPath(
  name: string,
  category: string,
  description: string,
  lat: number,
  lon: number,
  narration: string[],
): CameraPath {
  return {
    name,
    description,
    category,
    duration: 14,
    waypoints: [
      { lat, lon, height: 2000, heading: 0, pitch: -70 },
      { lat, lon, height: 15000, heading: 90, pitch: -50 },
      { lat, lon, height: 60000, heading: 180, pitch: -35 },
      { lat, lon, height: 120000, heading: 270, pitch: -25 },
    ],
    narration,
  };
}

const CATEGORY_NARRATION: Record<string, string[]> = {
  earthquakes: [
    'Seismic event detected. Scanning epicentral region for surface deformation.',
    'Fault rupture analysis in progress. Mapping aftershock distribution along the rupture zone.',
    'Ground motion data shows significant energy release. Assessing structural impact radius.',
  ],
  wildfires: [
    'Thermal anomaly detected. Sweeping along the active fire front.',
    'Pyrocumulus development visible. Crown fire activity intensifying in the canopy layer.',
    'Fire behavior analysis: spotting distance and rate of spread indicate extreme conditions.',
  ],
  volcanoes: [
    'Volcanic unrest detected. Ascending through the eruption column.',
    'Ash plume reaching stratospheric altitudes. Aviation advisories in effect.',
    'Thermal signature analysis: lava flow progression mapped from crater to flanks.',
  ],
  floods: [
    'Inundation mapping initiated. Water level exceeds flood stage in low-lying areas.',
    'Pulling back to reveal the full extent of the floodplain. Multiple tributaries contributing.',
    'Watershed analysis shows peak flow propagation. Inundation extent expanding.',
  ],
  severe_storms: [
    'Severe weather system identified. Orbiting the storm core structure.',
    'Mesocyclone signature detected. Supercell dynamics under analysis.',
    'Storm-relative velocity indicates strong rotation. Tornado potential assessed.',
  ],
  dust: [
    'Dust event detected. Mapping atmospheric particulate concentration.',
    'Visibility reduction extending across the region. Transport trajectory modeled.',
    'Aerosol optical depth measurement indicates significant mineral dust loading.',
  ],
};

function buildDynamicPaths(entityGroups: Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]>): CameraPath[] {
  const paths: CameraPath[] = [];

  for (const [layer, entities] of entityGroups) {
    if (!entities.length) continue;
    const baseNarration = CATEGORY_NARRATION[layer] ?? ['Analyzing event region...'];

    // Sort by magnitude descending (if available), pick top 3
    const sorted = entities
      .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
      .slice(0, 3);

    for (const [idx, ent] of sorted.entries()) {
      const magLabel = ent.magnitude ? ` M${ent.magnitude.toFixed(1)}` : '';
      const suffix = sorted.length > 1 ? ` #${idx + 1}` : '';
      const displayName = ent.name ?? `${ent.lat.toFixed(1)}°, ${ent.lon.toFixed(1)}`;

      // Data-driven narration
      const narration = baseNarration.map(line => {
        let result = line;
        if (ent.magnitude) result = result.replace('event', `M${ent.magnitude.toFixed(1)} event`);
        if (ent.name) result = result.replace(/region|zone|epicenter/gi, ent.name.length > 30 ? ent.name.slice(0, 30) + '…' : ent.name);
        return result;
      });

      if (layer === 'earthquakes') {
        paths.push(generateOrbitalPath(
          `${displayName}${magLabel}`,
          layer,
          `Orbital scan of seismic event`,
          ent.lat, ent.lon, ent.magnitude ? ent.magnitude * 20000 + 30000 : 50000,
          ent.magnitude ? ent.magnitude * 15000 + 20000 : 30000,
          8, narration,
        ));
      } else if (layer === 'wildfires' || layer === 'volcanoes') {
        paths.push(generateRevealPath(
          `${displayName}${suffix}`,
          layer,
          `Reveal ${layer} event from crater/front`,
          ent.lat, ent.lon, narration,
        ));
      } else {
        paths.push(generateFlyThroughPath(
          `${displayName}${suffix}`,
          layer,
          `Fly through ${layer} event zone`,
          ent.lat, ent.lon, narration,
        ));
      }
    }
  }

  // Fallback: global overview if no entities
  if (paths.length === 0) {
    paths.push({
      name: 'Global Overview',
      description: 'Cinematic orbit around the globe',
      category: 'overview',
      duration: 20,
      waypoints: [
        { lat: 20, lon: 0, height: 2.2e7, heading: 0, pitch: -90 },
        { lat: 20, lon: 90, height: 2.2e7, heading: 90, pitch: -90 },
        { lat: 20, lon: 180, height: 2.2e7, heading: 180, pitch: -90 },
        { lat: 20, lon: 270, height: 2.2e7, heading: 270, pitch: -90 },
      ],
      narration: [
        'Initiating global survey. Scanning all active monitoring regions.',
        'Earth observation systems online. Real-time data fusion active.',
        'Planetary intelligence network fully operational.',
      ],
    });
  }

  return paths;
}

/* ── Camera interpolation ──────────────────────────────── */

function setCameraAtT(viewer: Cesium.Viewer, path: CameraPath, t: number) {
  const wps = path.waypoints;
  const idx = t * (wps.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, wps.length - 1);
  const rawF = idx - i0;
  const f = easeInOutCubic(rawF);
  const hF = easeOutQuad(rawF);

  const wp0 = wps[i0];
  const wp1 = wps[i1];

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      wp0.lon + (wp1.lon - wp0.lon) * f,
      wp0.lat + (wp1.lat - wp0.lat) * f,
      wp0.height + (wp1.height - wp0.height) * hF,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(
        wp0.heading + (wp1.heading - wp0.heading) * f,
      ),
      pitch: Cesium.Math.toRadians(
        wp0.pitch + (wp1.pitch - wp0.pitch) * f,
      ),
      roll: 0,
    },
  });
}

function getSegmentIndex(path: CameraPath, t: number): number {
  const idx = t * (path.waypoints.length - 1);
  return Math.floor(idx);
}

/* ── Component ─────────────────────────────────────────── */

export default function CinematicDirector({ viewer, onClose, layerVersion, focusEntity }: CinematicDirectorProps) {
  const [paths, setPaths] = useState<CameraPath[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showNarration, setShowNarration] = useState(true);
  const [narrationText, setNarrationText] = useState('');

  const animRef = useRef<number>(0);
  const startRef = useRef(0);
  const pauseTRef = useRef(0);
  const lastSegmentRef = useRef(-1);
  const selectedIdxRef = useRef(0);

  const selectedPath = paths[selectedIdx] ?? null;

  // Keep ref in sync
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  // Generate paths from live entities — use interval with 0ms first tick
  const refreshPaths = useCallback(() => {
    if (!viewer) return;
    const groups = extractEntityPositions(viewer);
    const newPaths = buildDynamicPaths(groups);
    setPaths(prev => {
      if (prev.length === newPaths.length && prev.every((p, i) => p.name === newPaths[i].name)) return prev;
      return newPaths;
    });
  }, [viewer]);

  useEffect(() => {
    // Kick off immediately via setTimeout to avoid setState-in-effect lint
    const id = setTimeout(refreshPaths, 0);
    const interval = setInterval(refreshPaths, 15000);
    return () => { clearTimeout(id); clearInterval(interval); };
  }, [refreshPaths, layerVersion]);

  // ── Focus entity: generate path and auto-play ─────────

  const focusEntityRef = useRef<string>('');
  useEffect(() => {
    if (!focusEntity || !viewer) return;
    const key = `${focusEntity.lat.toFixed(3)}_${focusEntity.lon.toFixed(3)}_${focusEntity.layer}`;
    if (focusEntityRef.current === key) return;
    focusEntityRef.current = key;

    const narration = CATEGORY_NARRATION[focusEntity.layer] ?? ['Analyzing selected event...'];
    const path = focusEntity.layer === 'earthquakes'
      ? generateOrbitalPath(
          focusEntity.name ?? `Event at ${focusEntity.lat.toFixed(1)}°, ${focusEntity.lon.toFixed(1)}°`,
          focusEntity.layer, 'Orbital scan of selected event',
          focusEntity.lat, focusEntity.lon, 60000, 40000, 8, narration,
        )
      : focusEntity.layer === 'wildfires' || focusEntity.layer === 'volcanoes'
        ? generateRevealPath(
            focusEntity.name ?? `Event at ${focusEntity.lat.toFixed(1)}°, ${focusEntity.lon.toFixed(1)}°`,
            focusEntity.layer, `Reveal selected ${focusEntity.layer}`,
            focusEntity.lat, focusEntity.lon, narration,
          )
        : generateFlyThroughPath(
            focusEntity.name ?? `Event at ${focusEntity.lat.toFixed(1)}°, ${focusEntity.lon.toFixed(1)}°`,
            focusEntity.layer, `Fly through selected event zone`,
            focusEntity.lat, focusEntity.lon, narration,
          );

    // Defer state updates to avoid setState-in-effect lint
    const id = setTimeout(() => {
      setPaths(prev => {
        const filtered = prev.filter(p => p.category !== '_focused');
        return [{ ...path, category: '_focused' }, ...filtered];
      });
      setSelectedIdx(0);
      lastSegmentRef.current = -1;

      // Auto-play the focused path
      const totalMs = path.duration * 1000;
      setIsPlaying(true);
      setProgress(0);
      pauseTRef.current = 0;
      startRef.current = performance.now();
      lastSegmentRef.current = -1;

      if (animRef.current) cancelAnimationFrame(animRef.current);

      const animate = () => {
        const elapsed = performance.now() - startRef.current;
        const rawT = elapsed / totalMs;
        const t = Math.min(1, rawT);

        setCameraAtT(viewer, path, t);
        setProgress(t);

        if (showNarration) {
          const seg = getSegmentIndex(path, t);
          if (seg !== lastSegmentRef.current) {
            lastSegmentRef.current = seg;
            setNarrationText(path.narration[seg % path.narration.length] ?? '');
          }
        }

        if (t >= 1) {
          setIsPlaying(false);
          lastSegmentRef.current = -1;
          return;
        }
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }, 0);

    return () => clearTimeout(id);
  }, [focusEntity, viewer, showNarration]);

  // ── Playback ──────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
  }, []);

  const playPath = useCallback((pathIdx: number, fromT = 0) => {
    if (!viewer) return;
    const path = paths[pathIdx];
    if (!path) return;

    stopPlayback();
    setIsPlaying(true);
    setProgress(fromT);
    pauseTRef.current = fromT;
    startRef.current = performance.now();
    lastSegmentRef.current = -1;

    const totalMs = path.duration * 1000;

    const animate = () => {
      const pathNow = paths[selectedIdxRef.current] ?? path;
      const elapsed = performance.now() - startRef.current;
      const remaining = (1 - pauseTRef.current) * totalMs;
      const rawT = pauseTRef.current + (elapsed / remaining) * (1 - pauseTRef.current);
      const t = Math.min(1, rawT);

      // Position camera
      setCameraAtT(viewer, pathNow, t);
      setProgress(t);

      // Narration: only change on segment boundary
      if (showNarration) {
        const seg = getSegmentIndex(pathNow, t);
        if (seg !== lastSegmentRef.current) {
          lastSegmentRef.current = seg;
          const lines = pathNow.narration;
          setNarrationText(lines[seg % lines.length] ?? '');
        }
      }

      if (t >= 1) {
        setIsPlaying(false);
        lastSegmentRef.current = -1;
        return;
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
  }, [viewer, paths, showNarration, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // ── Slider scrub ──────────────────────────────────────

  const handleScrubStart = useCallback(() => {
    if (isPlaying) {
      pauseTRef.current = progress;
      stopPlayback();
    }
  }, [isPlaying, progress, stopPlayback]);

  const handleScrubChange = useCallback((val: number) => {
    if (!viewer || !selectedPath) return;
    const t = val / 100;
    setProgress(t);
    setCameraAtT(viewer, selectedPath, t);

    if (showNarration) {
      const seg = getSegmentIndex(selectedPath, t);
      const lines = selectedPath.narration;
      setNarrationText(lines[seg % lines.length] ?? '');
    }
  }, [viewer, selectedPath, showNarration]);

  const handleScrubEnd = useCallback(() => {}, []);

  // ── Path selection ────────────────────────────────────

  const selectPath = useCallback((idx: number) => {
    stopPlayback();
    setSelectedIdx(idx);
    setProgress(0);
    setNarrationText('');
    lastSegmentRef.current = -1;
    if (viewer && paths[idx]) {
      setCameraAtT(viewer, paths[idx], 0);
    }
  }, [viewer, paths, stopPlayback]);

  const CATEGORY_ICONS: Record<string, string> = {
    earthquakes: '🔴',
    wildfires: '🔥',
    volcanoes: '🌋',
    floods: '🌊',
    severe_storms: '⛈️',
    dust: '🌪️',
    overview: '🌍',
  };

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 380, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad">🎥</div>
        <div className="ai-title">Cinematic Director</div>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Path list */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>
            Live Event Paths ({paths.length})
          </div>
          {paths.map((path, i) => (
            <div key={`${path.category}-${i}`}
              className={`scenario-card ${selectedIdx === i ? 'active' : ''}`}
              style={{
                background: selectedIdx === i ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.2)',
                borderRadius: 6, padding: 8, marginBottom: 4, cursor: 'pointer',
                border: selectedIdx === i ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}
              onClick={() => selectPath(i)}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>
                {CATEGORY_ICONS[path.category] ?? '📍'} {path.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{path.description}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                {path.duration.toFixed(0)}s · {path.waypoints.length} waypoints · {path.category}
              </div>
            </div>
          ))}
          {paths.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: 8 }}>
              Enable disaster layers to generate cinematic paths from live data.
            </div>
          )}
        </div>

        {/* Playback controls */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="glass-button" style={{ fontSize: 12, padding: '6px 16px', flex: 1 }}
              onClick={() => {
                if (isPlaying) {
                  stopPlayback();
                } else {
                  playPath(selectedIdx, progress < 1 ? progress : 0);
                }
              }}
              disabled={!selectedPath}>
              {isPlaying ? '⏹ Stop' : progress > 0 && progress < 1 ? '▶ Resume' : '▶ Play'}
            </button>
            {progress >= 1 && (
              <button className="glass-button" style={{ fontSize: 11, padding: '6px 10px' }}
                onClick={() => { setProgress(0); setNarrationText(''); lastSegmentRef.current = -1; if (viewer && selectedPath) setCameraAtT(viewer, selectedPath, 0); }}>
                ↺ Reset
              </button>
            )}
          </div>

          {/* Scrub slider */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 40 }}>{(progress * 100).toFixed(0)}%</span>
            <input type="range" min="0" max="100" value={progress * 100}
              onMouseDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              onChange={e => handleScrubChange(Number(e.target.value))}
              onMouseUp={handleScrubEnd}
              onTouchEnd={handleScrubEnd}
              style={{ flex: 1, height: 3, accentColor: '#60a5fa' }} />
          </div>
        </div>

        {/* Narration toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Narration</span>
          <label className="switch">
            <input type="checkbox" checked={showNarration} onChange={() => setShowNarration(p => !p)} />
            <span className="slider" />
          </label>
        </div>

        {/* Narration text */}
        {showNarration && narrationText && (
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 1.5,
            color: 'var(--text)', borderLeft: '3px solid #60a5fa',
          }}>
            {narrationText}
          </div>
        )}

        {/* Path profile */}
        {selectedPath && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Altitude Profile</div>
            <div style={{ display: 'flex', gap: 2, height: 40, alignItems: 'flex-end', overflow: 'hidden' }}>
              {selectedPath.waypoints.map((wp, i) => {
                const h = Math.log10(wp.height) / 5.5 * 40;
                const isActive = i === getSegmentIndex(selectedPath, progress);
                return (
                  <div key={i} style={{
                    flex: 1, height: `${Math.max(2, h)}px`, borderRadius: '2px 2px 0 0',
                    background: isActive ? '#60a5fa' : 'rgba(96,165,250,0.3)',
                    transition: 'background 0.15s',
                  }} title={`${wp.lat.toFixed(1)}°, ${wp.lon.toFixed(1)}° @ ${wp.height.toLocaleString()}m`} />
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
              <span>Start</span>
              <span>End</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
