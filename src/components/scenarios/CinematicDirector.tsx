import { useState, useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';

interface CameraPath {
  name: string;
  description: string;
  duration: number;
  waypoints: Array<{ lat: number; lon: number; height: number; heading?: number; pitch?: number }>;
}

interface CinematicDirectorProps {
  viewer: Cesium.Viewer | null;
  onClose: () => void;
}

const CAMERA_PATHS: CameraPath[] = [
  {
    name: 'Fly Through the Hurricane Eye',
    description: 'Cinematic orbit through the eyewall into the calm eye of the storm',
    duration: 15,
    waypoints: [
      { lat: 20, lon: 75, height: 50000, heading: 0, pitch: -45 },
      { lat: 19.5, lon: 74.5, height: 20000, heading: 45, pitch: -60 },
      { lat: 19, lon: 74, height: 5000, heading: 90, pitch: -75 },
      { lat: 18.5, lon: 72, height: 1000, heading: 180, pitch: -85 },
    ],
  },
  {
    name: 'Orbit the Earthquake Epicenter',
    description: '360° orbit around the epicenter showing fault line and aftershock distribution',
    duration: 20,
    waypoints: [
      { lat: 19, lon: 72, height: 100000, heading: 0, pitch: -30 },
      { lat: 19, lon: 72, height: 80000, heading: 90, pitch: -35 },
      { lat: 19, lon: 72, height: 60000, heading: 180, pitch: -40 },
      { lat: 19, lon: 72, height: 40000, heading: 270, pitch: -45 },
    ],
  },
  {
    name: 'Tsunami Wave Propagation',
    description: 'Follow the tsunami wavefront from epicenter to coastline',
    duration: 18,
    waypoints: [
      { lat: 5, lon: 95, height: 80000, heading: 45, pitch: -25 },
      { lat: 6, lon: 96, height: 50000, heading: 60, pitch: -30 },
      { lat: 8, lon: 97, height: 30000, heading: 75, pitch: -35 },
      { lat: 10, lon: 98, height: 15000, heading: 90, pitch: -40 },
    ],
  },
  {
    name: 'Wildfire Aerial Sweep',
    description: 'Low-altitude flyover of the wildfire front and smoke plume',
    duration: 12,
    waypoints: [
      { lat: 38, lon: -122, height: 30000, heading: 120, pitch: -50 },
      { lat: 38.5, lon: -121.5, height: 15000, heading: 140, pitch: -60 },
      { lat: 39, lon: -121, height: 5000, heading: 160, pitch: -70 },
    ],
  },
  {
    name: 'Flood Inundation Pullback',
    description: 'Start close on flooded area, pull back to reveal regional context',
    duration: 10,
    waypoints: [
      { lat: 26, lon: 80, height: 2000, heading: 0, pitch: -60 },
      { lat: 26.5, lon: 80.5, height: 20000, heading: 45, pitch: -45 },
      { lat: 27, lon: 81, height: 100000, heading: 90, pitch: -30 },
    ],
  },
  {
    name: 'Volcanic Eruption Reveal',
    description: 'Ascend from crater to stratosphere showing ash plume',
    duration: 14,
    waypoints: [
      { lat: -8, lon: 115, height: 1000, heading: 0, pitch: -70 },
      { lat: -8, lon: 115, height: 10000, heading: 180, pitch: -55 },
      { lat: -8, lon: 115, height: 50000, heading: 270, pitch: -40 },
    ],
  },
];

export default function CinematicDirector({ viewer, onClose }: CinematicDirectorProps) {
  const [selectedPath, setSelectedPath] = useState(CAMERA_PATHS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showNarration, setShowNarration] = useState(true);
  const [narrationText, setNarrationText] = useState('');
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef(0);

  const playPath = useCallback((path: CameraPath) => {
    if (!viewer) return;
    setIsPlaying(true);
    setProgress(0);
    startTimeRef.current = Date.now();

    const totalDuration = path.duration * 1000;

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const t = Math.min(1, elapsed / totalDuration);

      if (t >= 1) { setIsPlaying(false); setProgress(1); return; }

      const idx = t * (path.waypoints.length - 1);
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, path.waypoints.length - 1);
      const f = idx - i0;

      const wp0 = path.waypoints[i0];
      const wp1 = path.waypoints[i1];

      const lat = wp0.lat + (wp1.lat - wp0.lat) * f;
      const lon = wp0.lon + (wp1.lon - wp0.lon) * f;
      const height = wp0.height + (wp1.height - wp0.height) * f;
      const heading = (wp0.heading || 0) + ((wp1.heading || 0) - (wp0.heading || 0)) * f;
      const pitch = (wp0.pitch || -45) + ((wp1.pitch || -45) - (wp0.pitch || -45)) * f;

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0,
        },
        duration: 0.5,
      });

      setProgress(t);

      if (showNarration) {
        setNarrationText(generateNarration(path, t));
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [viewer, showNarration]);

  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 380, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad">🎥</div>
        <div className="ai-title">Cinematic Director</div>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Path Selection */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Camera Paths</div>
          {CAMERA_PATHS.map(path => (
            <div key={path.name}
              className={`scenario-card ${selectedPath.name === path.name ? 'active' : ''}`}
              style={{
                background: selectedPath.name === path.name ? 'rgba(59,130,246,0.15)' : 'rgba(0,0,0,0.2)',
                borderRadius: 6, padding: 8, marginBottom: 4, cursor: 'pointer',
                border: selectedPath.name === path.name ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}
              onClick={() => { setSelectedPath(path); stopPlayback(); }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{path.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{path.description}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{path.duration}s · {path.waypoints.length} waypoints</div>
            </div>
          ))}
        </div>

        {/* Playback Controls */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="glass-button" style={{ fontSize: 12, padding: '6px 16px', flex: 1 }}
              onClick={() => isPlaying ? stopPlayback() : playPath(selectedPath)}>
              {isPlaying ? '⏹ Stop' : '▶ Play'}
            </button>
          </div>

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 40 }}>{(progress * 100).toFixed(0)}%</span>
            <input type="range" min="0" max="100" value={progress * 100}
              onChange={e => setProgress(Number(e.target.value) / 100)}
              style={{ flex: 1, height: 3, accentColor: '#60a5fa' }} />
          </div>
        </div>

        {/* Narration Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Narration</span>
          <label className="switch">
            <input type="checkbox" checked={showNarration} onChange={() => setShowNarration(!showNarration)} />
            <span className="slider" />
          </label>
        </div>

        {/* Narration Text */}
        {showNarration && narrationText && (
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 1.5, color: 'var(--text)',
            borderLeft: '3px solid #60a5fa',
          }}>
            {narrationText}
          </div>
        )}

        {/* Path Visualizer */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Path Profile</div>
          <div style={{ display: 'flex', gap: 2, height: 40, alignItems: 'flex-end' }}>
            {selectedPath.waypoints.map((wp, i) => {
              const h = Math.log10(wp.height) / 5 * 40;
              const isActive = i === Math.floor(progress * (selectedPath.waypoints.length - 1));
              return (
                <div key={i} style={{
                  flex: 1, height: `${h}px`, borderRadius: '2px 2px 0 0',
                  background: isActive ? '#60a5fa' : 'rgba(96,165,250,0.3)',
                  transition: 'background 0.2s',
                  position: 'relative',
                }} title={`${wp.lat.toFixed(1)}°, ${wp.lon.toFixed(1)}° @ ${wp.height.toLocaleString()}m`} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
            <span>Start</span>
            <span>End</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function generateNarration(path: CameraPath, _t: number): string {
  const narrations: Record<string, string[]> = {
    'Fly Through the Hurricane Eye': [
      'Approaching the outer eyewall... towering cumulonimbus clouds reach 15km into the stratosphere.',
      'Entering the eyewall... windspeeds exceed 250 km/h. Rainbands spiral inward.',
      'Breaking through into the eye. Complete calm. The stadium effect is visible — a 40km wide amphitheater of cloud.',
      'The eye wall surrounds us. This is the most dangerous quadrant for storm surge.',
    ],
    'Orbit the Earthquake Epicenter': [
      'Initiating orbital scan of the epicentral region. Mapping surface deformation patterns.',
      'Fault rupture propagating along the plate boundary. Aftershocks cluster along the rupture zone.',
      'Measuring coseismic displacement. Ground motion records indicate ~5m of slip.',
      'Completing orbital survey. InSAR data will reveal full deformation field.',
    ],
    'Tsunami Wave Propagation': [
      'Seafloor displacement generates a wave train. Initial wave height: ~1m in deep water.',
      'Wave shoaling begins as depth decreases. Speed drops, amplitude increases.',
      'Approaching the coastline. Wave height now exceeds 10m. Runup will inundate low-lying areas.',
      'Impact zone: coastal communities have minutes to evacuate. Inundation extends 2km inland.',
    ],
    'Wildfire Aerial Sweep': [
      'Initiating low-altitude sweep along the fire front. Spotting activity visible ahead.',
      'Crown fire developing in the canopy. Pyrocumulus cloud forming above.',
      'Fire behavior extreme: flame lengths exceed 30m. Ember cast ahead of the main front.',
      'Burn scar assessment: severity mapping shows mosaic pattern of high and moderate severity.',
    ],
    'Flood Inundation Pullback': [
      'Close-up of flooded urban area. Water depth exceeds 2m in low-lying neighborhoods.',
      'Pulling back to reveal the floodplain. Overflow from main river channel affects 50km².',
      'Regional context: watershed drainage shows multiple tributaries contributing to the flood wave.',
      'Full basin view: flood stage expected to persist for 48 hours before recession begins.',
    ],
    'Volcanic Eruption Reveal': [
      'At the crater rim. Magma conduit visible. Lava fountaining reaches 500m height.',
      'Ascending through the eruption column. Ash and gas plume rises to 15km altitude.',
      'Stratospheric view: ash plume dispersing downwind. Aviation advisories in effect.',
      'Regional impact assessment: tephra fallout affecting communities within 50km radius.',
    ],
  };

  const lines = narrations[path.name] || ['Narrating camera path...'];
  return lines[Math.floor(Math.random() * lines.length)];
}
