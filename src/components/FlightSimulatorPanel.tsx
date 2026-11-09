import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Rocket,
  Car,
  Eye,
  Radio,
  MapPin,
  LocateFixed,
  Compass,
  Maximize2,
  Minimize2,
  X,
  Check,
  Copy,
  Camera,
  RotateCcw,
  RotateCw,
  Zap,
  Wind,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
  Sun,
  Lightbulb,
  Terminal,
} from 'lucide-react';
import * as Cesium from 'cesium';
import Panel from '@/components/ui/Panel';
import { GroundWalkController, type GroundExplorerMode, type CameraViewPerspective } from '@/rendering/groundWalkController';
import { loadOsmBuildings, hideOsmBuildings } from '@/rendering/osmBuildings';
import { getPegmanSvgUri, updatePegman, removePegman, flyToStreetLevel } from '@/rendering/streetViewPegman';
import { TeslaRoadsterCockpitView } from '@/components/TeslaRoadsterCockpitView';
import { SIMULATOR_CITIES, LANDMARK_PRESETS, type CityPreset } from '@/data/simulatorPresets';

export { SIMULATOR_CITIES, LANDMARK_PRESETS, type CityPreset };

export interface HeliSpawn {
  lat: number;
  lon: number;
  altM: number;
  headingDeg: number;
  label: string;
  coldStart?: boolean;
  airframe?: 'AH64E' | 'HELIDRIVE_X';
}

export type SimulatorMode = 'helicopter' | 'streetview' | 'car' | 'drone' | 'walk';

export interface FlightSimulatorPanelProps {
  viewer: Cesium.Viewer | null;
  initialMode?: SimulatorMode;
  initialLat?: number;
  initialLon?: number;
  initialHeading?: number;
  googleMapsApiKey?: string;
  onOpenApiVault?: () => void;
  onLaunchHelicopter: (spawn: HeliSpawn) => void;
  onClose: () => void;
  onSimulationActiveChange?: (active: boolean) => void;
  toggleConsoleNonce?: number;
}

export function FlightSimulatorPanel({
  viewer,
  initialMode = 'car',
  initialLat,
  initialLon,
  initialHeading = 0,
  googleMapsApiKey,
  onOpenApiVault: _onOpenApiVault,
  onLaunchHelicopter,
  onClose,
  onSimulationActiveChange,
  toggleConsoleNonce,
}: FlightSimulatorPanelProps) {
  // Mode selection: car | helicopter | streetview | drone | walk
  const [mode, setMode] = useState<SimulatorMode>(initialMode);

  // Location selection: 'current' | 'preset'
  const [locationType, setLocationType] = useState<'current' | 'preset'>('current');
  const [selectedCity, setSelectedCity] = useState(SIMULATOR_CITIES[0].label);

  // Active target coordinates
  const [lat, setLat] = useState(() => initialLat ?? SIMULATOR_CITIES[0].lat);
  const [lon, setLon] = useState(() => initialLon ?? SIMULATOR_CITIES[0].lon);
  const [heading, setHeading] = useState(() => initialHeading);
  const [pitch, setPitch] = useState(-8);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [locationName, setLocationName] = useState<string>('Locating address…');
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Helicopter specific settings
  const [altM, setAltM] = useState(500);
  const [coldStart, setColdStart] = useState(false);
  const [airframe] = useState<'AH64E'>('AH64E');

  // Ground simulator controller (Car, Drone, Walk)
  const groundWalkRef = useRef<GroundWalkController | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [perspective, setPerspective] = useState<CameraViewPerspective>('chase');
  const [copvPressurePsi, setCopvPressurePsi] = useState(10000);
  const [flightAltitudeM, setFlightAltitudeM] = useState(0);
  const [isFlying, setIsFlying] = useState(false);
  const [isLudicrous, setIsLudicrous] = useState(false);
  const [autoTurntable, setAutoTurntable] = useState(false);
  const [targaOpen, setTargaOpen] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [headlightsOn, setHeadlightsOn] = useState(false);
  const [odometerKm, setOdometerKm] = useState(12480.0);
  const [steerAngleDeg, setSteerAngleDeg] = useState(0);
  const [throttlePct, setThrottlePct] = useState(0);
  const [brakePct, setBrakePct] = useState(0);

  // UI state
  const [minimized, setMinimized] = useState(false);

  // Sync initial coordinates if passed
  useEffect(() => {
    if (typeof initialLat === 'number') setLat(initialLat);
    if (typeof initialLon === 'number') setLon(initialLon);
    if (typeof initialHeading === 'number') setHeading(initialHeading);
  }, [initialLat, initialLon, initialHeading]);

  // If initialMode requested is car, drone, or walk, handle it
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Synchronize simulation active state to parent
  useEffect(() => {
    onSimulationActiveChange?.(isSimulating);
  }, [isSimulating, onSimulationActiveChange]);

  // Toggle console between HUD and Full Console on external trigger
  useEffect(() => {
    if (toggleConsoleNonce && toggleConsoleNonce > 0) {
      setMinimized(prev => !prev);
    }
  }, [toggleConsoleNonce]);

  // Helper to query viewer's current center coordinates
  const getCurrentViewCenter = useCallback((): { lat: number; lon: number; heading: number } | null => {
    if (!viewer || viewer.isDestroyed()) return null;
    try {
      const center = new Cesium.Cartesian2(viewer.scene.canvas.clientWidth / 2, viewer.scene.canvas.clientHeight / 2);
      let cart = viewer.scene.pickPosition(center);
      if (!cart || !Cesium.defined(cart)) {
        cart = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid) as Cesium.Cartesian3;
      }
      if (cart && Cesium.defined(cart)) {
        const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
        if (carto) {
          return {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
            heading: Cesium.Math.toDegrees(viewer.camera.heading),
          };
        }
      }
    } catch { /* ignore */ }
    return null;
  }, [viewer]);

  // Update coordinates when switching locationType
  useEffect(() => {
    if (locationType === 'preset') {
      const city = SIMULATOR_CITIES.find(c => c.label === selectedCity);
      if (city) {
        setLat(city.lat);
        setLon(city.lon);
        setHeading(city.heading);
      }
    } else {
      const cur = getCurrentViewCenter();
      if (cur) {
        setLat(cur.lat);
        setLon(cur.lon);
        setHeading(cur.heading);
      }
    }
  }, [locationType, selectedCity, getCurrentViewCenter]);

  // Reverse geocoding for current address display
  useEffect(() => {
    let cancelled = false;
    const fetchAddress = async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=16&addressdetails=1`,
          { headers: { 'User-Agent': 'Terranoetis-Desktop/3.0.1' } }
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          const road = data.address?.road || data.address?.suburb || data.address?.neighbourhood;
          const city = data.address?.city || data.address?.town || data.address?.county || '';
          const country = data.address?.country || '';
          if (road && city) setLocationName(`${road}, ${city}`);
          else if (city && country) setLocationName(`${city}, ${country}`);
          else if (data.display_name) setLocationName(data.display_name.split(',').slice(0, 2).join(','));
          else setLocationName(`${lat.toFixed(4)}°, ${lon.toFixed(4)}°`);
        }
      } catch {
        if (!cancelled) setLocationName(`${lat.toFixed(4)}°, ${lon.toFixed(4)}°`);
      }
    };
    fetchAddress();
    return () => { cancelled = true; };
  }, [lat, lon]);

  // Update Pegman on globe when in Street View mode
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (mode === 'streetview') {
      updatePegman(viewer, lat, lon, heading);
    } else {
      removePegman(viewer);
    }
  }, [viewer, mode, lat, lon, heading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (groundWalkRef.current) {
        groundWalkRef.current.stop(0);
        groundWalkRef.current = null;
      }
      hideOsmBuildings();
      if (viewer && !viewer.isDestroyed()) {
        removePegman(viewer);
      }
    };
  }, [viewer]);

  // Launch Helicopter Sim
  const handleLaunchHelicopter = () => {
    if (isSimulating) stopGroundSimulation();
    onLaunchHelicopter({
      lat,
      lon,
      altM,
      headingDeg: heading,
      label: locationType === 'preset' ? selectedCity : 'Recon Target',
      coldStart,
      airframe,
    });
    onClose();
  };

  // Start Ground Simulation (Car, Drone, Walk)
  const startGroundSimulation = useCallback((targetMode: GroundExplorerMode) => {
    if (!viewer || viewer.isDestroyed()) return;

    if (!groundWalkRef.current) {
      groundWalkRef.current = new GroundWalkController();
    }

    setPerspective(targetMode === 'drive' ? 'chase' : 'cockpit');

    // Automatically stream 3D OSM buildings
    void loadOsmBuildings(viewer).catch(() => {});

    groundWalkRef.current.start(
      viewer,
      lat,
      lon,
      heading,
      (state) => {
        setLat(state.lat);
        setLon(state.lon);
        setHeading(state.heading);
        setPitch(state.pitch);
        setSpeedKmh(Math.round(state.speed));
        setPerspective(state.perspective);
        if (state.copvPressurePsi !== undefined) setCopvPressurePsi(state.copvPressurePsi);
        if (state.flightAltitudeM !== undefined) setFlightAltitudeM(state.flightAltitudeM);
        if (state.isFlying !== undefined) setIsFlying(state.isFlying);
        if (state.isLudicrous !== undefined) setIsLudicrous(state.isLudicrous);
        if (state.autoTurntable !== undefined) setAutoTurntable(state.autoTurntable);
        if (state.targaOpen !== undefined) setTargaOpen(state.targaOpen);
        if (state.isAudioMuted !== undefined) setIsAudioMuted(state.isAudioMuted);
        if (state.headlightsOn !== undefined) setHeadlightsOn(state.headlightsOn);
        if (state.odometerKm !== undefined) setOdometerKm(state.odometerKm);
        if (state.steerAngleDeg !== undefined) setSteerAngleDeg(state.steerAngleDeg);
        if (state.throttlePct !== undefined) setThrottlePct(state.throttlePct);
        if (state.brakePct !== undefined) setBrakePct(state.brakePct);
      },
      targetMode,
    );

    setIsSimulating(true);
    setMinimized(true); // Minimize into floating driving HUD
  }, [viewer, lat, lon, heading]);

  const stopGroundSimulation = useCallback(() => {
    if (groundWalkRef.current) {
      groundWalkRef.current.stop(250);
      setIsSimulating(false);
      setMinimized(false);
      setIsFlying(false);
      setIsLudicrous(false);
      setAutoTurntable(false);
      setTargaOpen(false);
    }
    hideOsmBuildings();
  }, []);

  // Teleport to city preset
  const handleSelectCityPreset = (preset: CityPreset) => {
    setSelectedCity(preset.label);
    setLocationType('preset');
    setLat(preset.lat);
    setLon(preset.lon);
    setHeading(preset.heading);

    if (viewer && !viewer.isDestroyed()) {
      if (isSimulating && groundWalkRef.current) {
        groundWalkRef.current.teleport(preset.lat, preset.lon, preset.heading);
      } else {
        void flyToStreetLevel(viewer, preset.lat, preset.lon, preset.heading, 2.0);
      }
    }
  };

  // Teleport to landmark
  const handleSelectLandmark = (lm: typeof LANDMARK_PRESETS[0]) => {
    setLat(lm.lat);
    setLon(lm.lon);
    setHeading(lm.heading);
    if (viewer && !viewer.isDestroyed()) {
      if (isSimulating && groundWalkRef.current) {
        groundWalkRef.current.teleport(lm.lat, lm.lon, lm.heading);
      } else {
        void flyToStreetLevel(viewer, lm.lat, lm.lon, lm.heading, 1.8);
      }
    }
  };

  const copyCoordinates = () => {
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const getCardinal = (deg: number): string => {
    const val = (Math.round((deg % 360) / 22.5) + 16) % 16;
    const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return cardinals[val];
  };

  // Google Maps URLs — Uses ONLY googleMapsApiKey from API Vault (no inline entry)
  const activeKey = (googleMapsApiKey || '').trim();
  const embedUrl = activeKey
    ? `https://www.google.com/maps/embed/v1/streetview?key=${activeKey}&location=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${Math.round(heading)}&pitch=${Math.round(pitch)}&fov=90`
    : null;

  // ══════════════════════════════════════════════════════════════════════════
  // FLOATING IN-SIMULATION HUD (Shown when Car, Drone, or Walk is active)
  // ══════════════════════════════════════════════════════════════════════════
  if (isSimulating && minimized) {
    const modeLabel = mode === 'car' ? 'TESLA ROADSTER' : mode === 'drone' ? 'DRONE RECON' : 'STREET WALK';
    const modeColor = mode === 'car' ? '#ef4444' : mode === 'drone' ? '#a855f7' : '#34d399';

    if (mode === 'car') {
      if (perspective === 'cockpit') {
        return (
          <TeslaRoadsterCockpitView
            speedKmh={speedKmh}
            headingDeg={heading}
            pitchDeg={pitch}
            copvPressurePsi={copvPressurePsi}
            flightAltitudeM={flightAltitudeM}
            isFlying={isFlying}
            isLudicrous={isLudicrous}
            isAudioMuted={isAudioMuted}
            targaOpen={targaOpen}
            headlightsOn={headlightsOn}
            odometerKm={odometerKm}
            steerAngleDeg={steerAngleDeg}
            throttlePct={throttlePct}
            brakePct={brakePct}
            onTogglePerspective={() => groundWalkRef.current?.togglePerspective()}
            onToggleFly={(active) => groundWalkRef.current?.setManualFly(active)}
            onToggleLudicrous={() => groundWalkRef.current?.setManualLudicrous(!isLudicrous)}
            onToggleSound={() => groundWalkRef.current?.toggleAudioMute()}
            onToggleTarga={() => groundWalkRef.current?.toggleTargaRoof()}
            onToggleHeadlights={() => groundWalkRef.current?.toggleHeadlights()}
            onResetCamera={() => groundWalkRef.current?.resetOrbitCamera()}
            onManualThrottle={(fwd) => groundWalkRef.current?.setManualThrottle(fwd)}
            onManualSteer={(turn) => groundWalkRef.current?.setManualSteer(turn)}
          />
        );
      }

      return (
        <div
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: 58,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 600,
            padding: '8px 14px',
            borderRadius: 32,
            background: 'rgba(15, 23, 42, 0.95)',
            border: `1.5px solid ${isFlying ? 'rgba(56,189,248,0.7)' : 'rgba(239,68,68,0.5)'}`,
            boxShadow: isFlying ? '0 12px 36px rgba(56,189,248,0.35)' : '0 12px 36px rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            backdropFilter: 'blur(20px)',
            color: '#f8fafc',
            userSelect: 'none',
            maxWidth: '96vw',
            overflowX: 'auto',
          }}
        >
          {/* Mode & Flight Status Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Car size={16} color={modeColor} />
            <span style={{ fontSize: 11, fontWeight: 700, color: modeColor, letterSpacing: '0.04em' }}>
              {modeLabel}
            </span>
            {isFlying && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.2)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '1px 5px',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                }}
              >
                FLYING {flightAltitudeM.toFixed(1)}m
              </span>
            )}
            {isLudicrous && !isFlying && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: '#f97316',
                  background: 'rgba(249, 115, 22, 0.2)',
                  border: '1px solid rgba(249, 115, 22, 0.4)',
                  padding: '1px 5px',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                }}
              >
                LUDICROUS+
              </span>
            )}
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

          {/* Speedometer */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color: '#fff' }}>
              {speedKmh}
            </span>
            <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 600 }}>KM/H</span>
          </div>

          {/* COPV High-Pressure Tank Gauge */}
          <div
            title={`SpaceX COPV Air Pressure: ${copvPressurePsi} PSI (10,000 PSI max)`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 68,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: copvPressurePsi > 3000 ? '#38bdf8' : '#f87171', fontWeight: 600 }}>
                <Wind size={9} /> {copvPressurePsi}
              </span>
              <span style={{ fontSize: 7.5, opacity: 0.7 }}>PSI</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 4,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.12)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, (copvPressurePsi / 10000) * 100))}%`,
                  height: '100%',
                  background: copvPressurePsi > 3000
                    ? 'linear-gradient(90deg, #0284c7, #38bdf8)'
                    : 'linear-gradient(90deg, #dc2626, #f87171)',
                  transition: 'width 0.1s linear',
                }}
              />
            </div>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

          {/* Action Buttons: Fly, Boost, Cam, 360 Spin, Reset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {/* Toggle SpaceX Cold-Gas Thrusters Flight Mode */}
            <button
              onClick={() => groundWalkRef.current?.toggleFlight()}
              title="Toggle SpaceX Cold-Gas Thrusters Flight Mode [F / Space]"
              style={{
                background: isFlying
                  ? 'linear-gradient(135deg, #0284c7, #0ea5e9)'
                  : 'rgba(14, 165, 233, 0.15)',
                border: `1px solid ${isFlying ? '#38bdf8' : 'rgba(14, 165, 233, 0.4)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: isFlying ? '#fff' : '#38bdf8',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: isFlying ? '0 0 12px rgba(56, 189, 248, 0.6)' : 'none',
              }}
            >
              <Rocket size={11} /> {isFlying ? 'Flying' : 'Fly'}
            </button>

            {/* Ludicrous+ Boost */}
            <button
              onClick={() => groundWalkRef.current?.setManualLudicrous(!isLudicrous)}
              title="Toggle Ludicrous+ Hypercar Boost (Shift)"
              style={{
                background: isLudicrous
                  ? 'linear-gradient(135deg, #ea580c, #f97316)'
                  : 'rgba(249, 115, 22, 0.15)',
                border: `1px solid ${isLudicrous ? '#fb923c' : 'rgba(249, 115, 22, 0.4)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: isLudicrous ? '#fff' : '#fb923c',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: isLudicrous ? '0 0 12px rgba(249, 115, 22, 0.6)' : 'none',
              }}
            >
              <Zap size={11} /> Boost
            </button>

            {/* Cockpit / Chase Camera Toggle */}
            <button
              onClick={() => groundWalkRef.current?.togglePerspective()}
              title="Enter First-Person Cockpit View (C / V)"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                padding: '4px 8px',
                color: '#e2e8f0',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Camera size={11} /> Cockpit View
            </button>

            {/* 360° Studio Showcase Turntable */}
            <button
              onClick={() => groundWalkRef.current?.toggleTurntable()}
              title="Toggle Continuous 360° Showcase Studio Spin (R)"
              style={{
                background: autoTurntable ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${autoTurntable ? '#818cf8' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: autoTurntable ? '#a5b4fc' : '#e2e8f0',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <RotateCw size={11} /> {autoTurntable ? 'Spinning' : '360° Spin'}
            </button>

            {/* Audio Sound Engine Toggle */}
            <button
              onClick={() => groundWalkRef.current?.toggleAudioMute()}
              title="Toggle Roadster Electric Motor & Thruster Audio [U]"
              style={{
                background: !isAudioMuted ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${!isAudioMuted ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6,
                padding: '4px 7px',
                color: !isAudioMuted ? '#38bdf8' : '#94a3b8',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {!isAudioMuted ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {!isAudioMuted ? 'Sound' : 'Mute'}
            </button>

            {/* Convertible Targa Roof Toggle */}
            <button
              onClick={() => groundWalkRef.current?.toggleTargaRoof()}
              title="Toggle Removable Glass Roof Convertible Targa Mode [T]"
              style={{
                background: targaOpen ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${targaOpen ? '#f59e0b' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6,
                padding: '4px 7px',
                color: targaOpen ? '#fbbf24' : '#e2e8f0',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Sun size={11} /> {targaOpen ? 'Targa Open' : 'Coupe'}
            </button>

            {/* Functional Headlights Toggle */}
            <button
              onClick={() => groundWalkRef.current?.toggleHeadlights()}
              title="Toggle Functional Headlights & Beam Projectors [L]"
              style={{
                background: headlightsOn ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${headlightsOn ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 6,
                padding: '4px 7px',
                color: headlightsOn ? '#38bdf8' : '#94a3b8',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <Lightbulb size={11} /> {headlightsOn ? 'Lights' : 'Off'}
            </button>

            {/* Reset Camera View */}
            <button
              onClick={() => groundWalkRef.current?.resetOrbitCamera()}
              title="Reset Camera View to Default Rear Angle (Double-Click Canvas)"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                padding: '4px 6px',
                color: '#94a3b8',
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <RotateCcw size={11} />
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

          {/* Quick-Access Directional Arrows (Accelerate, Steer, Brake/Reverse) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {/* Steer Left */}
            <button
              onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(-1); }}
              onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
              onMouseLeave={() => groundWalkRef.current?.setManualSteer(0)}
              onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(-1); }}
              onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
              title="Steer Left [A / ←]"
              style={{
                background: steerAngleDeg < -5 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${steerAngleDeg < -5 ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 5,
                padding: '4px 6px',
                color: steerAngleDeg < -5 ? '#f87171' : '#cbd5e1',
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowLeft size={11} />
            </button>

            {/* Vertical Throttle / Brake Split */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Accelerate */}
              <button
                onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(1); }}
                onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                onMouseLeave={() => groundWalkRef.current?.setManualThrottle(0)}
                onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(1); }}
                onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                title="Accelerate [W / ↑]"
                style={{
                  background: throttlePct > 0 ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${throttlePct > 0 ? '#10b981' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '4px 4px 2px 2px',
                  padding: '2px 8px',
                  color: throttlePct > 0 ? '#34d399' : '#cbd5e1',
                  fontSize: 9,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowUp size={10} />
              </button>

              {/* Brake / Reverse */}
              <button
                onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(-1); }}
                onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                onMouseLeave={() => groundWalkRef.current?.setManualThrottle(0)}
                onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(-1); }}
                onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                title="Brake / Reverse [S / ↓]"
                style={{
                  background: brakePct > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${brakePct > 0 ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '2px 2px 4px 4px',
                  padding: '2px 8px',
                  color: brakePct > 0 ? '#f87171' : '#cbd5e1',
                  fontSize: 9,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowDown size={10} />
              </button>
            </div>

            {/* Steer Right */}
            <button
              onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(1); }}
              onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
              onMouseLeave={() => groundWalkRef.current?.setManualSteer(0)}
              onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(1); }}
              onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
              title="Steer Right [D / →]"
              style={{
                background: steerAngleDeg > 5 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${steerAngleDeg > 5 ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 5,
                padding: '4px 6px',
                color: steerAngleDeg > 5 ? '#f87171' : '#cbd5e1',
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowRight size={11} />
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

          {/* Heading & Cardinal */}
          <div style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Compass
              size={12}
              color="#38bdf8"
              style={{
                transform: `rotate(${Math.round(heading)}deg)`,
                transition: 'transform 0.1s linear',
              }}
            />
            <span>{getCardinal(heading)} {Math.round(heading)}°</span>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

          {/* Maximize to Console */}
          <button
            onClick={() => setMinimized(false)}
            title="Open Simulator Console"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: 6,
              padding: '5px 8px',
              color: '#94a3b8',
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Maximize2 size={12} /> Console
          </button>

          {/* Exit Simulation Button */}
          <button
            onClick={stopGroundSimulation}
            title="Exit Simulation (Esc)"
            style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: 'none',
              borderRadius: 6,
              padding: '5px 10px',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
            }}
          >
            <X size={12} /> Exit (Esc)
          </button>
        </div>
      );
    }

    // Default HUD for Drone and Pedestrian Walk modes
    return (
      <div
        className="glass-panel"
        style={{
          position: 'fixed',
          bottom: 58,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          padding: '8px 16px',
          borderRadius: 32,
          background: 'rgba(15, 23, 42, 0.94)',
          border: `1.5px solid ${modeColor}55`,
          boxShadow: '0 12px 36px rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          backdropFilter: 'blur(20px)',
          color: '#f8fafc',
          userSelect: 'none',
        }}
      >
        {/* Mode Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {mode === 'drone' && <Radio size={16} color={modeColor} />}
          {mode === 'walk' && <Eye size={16} color={modeColor} />}
          <span style={{ fontSize: 11, fontWeight: 700, color: modeColor, letterSpacing: '0.05em' }}>
            {modeLabel}
          </span>
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

        {/* Speedometer */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#fff' }}>
            {speedKmh}
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>KM/H</span>
        </div>

        {/* Heading & Cardinal */}
        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Compass size={12} color="#38bdf8" />
          <span>{getCardinal(heading)} {Math.round(heading)}°</span>
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)' }} />

        {/* Maximize back to Simulator Console */}
        <button
          onClick={() => setMinimized(false)}
          title="Open Simulator Console"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: 6,
            padding: '5px 8px',
            color: '#94a3b8',
            fontSize: 10,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Maximize2 size={12} /> Console
        </button>

        {/* Exit Simulation Button */}
        <button
          onClick={stopGroundSimulation}
          title="Exit Simulation (Esc)"
          style={{
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            border: 'none',
            borderRadius: 6,
            padding: '5px 10px',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
          }}
        >
          <X size={12} /> Exit (Esc)
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FULL FLIGHT & EXPLORATION SIMULATOR CONSOLE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 600,
        width: mode === 'streetview' && embedUrl ? 740 : 540,
        maxWidth: '94vw',
        maxHeight: '92vh',
        overflowY: 'auto',
        transition: 'width 0.25s ease',
      }}
    >
      <Panel
        title="SIMULATOR CONSOLE"
        icon={<Terminal size={15} />}
        accentColor="#38bdf8"
        iconColor="#38bdf8"
        titleColor="#bae6fd"
        onClose={onClose}
      >
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header Subtitle with active mode indicator */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
              Multi-Vehicle Telemetry & Simulation Console · Tesla Roadster · Helicopter · Street View · Drone · Walk
            </div>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: mode === 'car' ? '#f87171' : mode === 'helicopter' ? '#4ade80' : mode === 'streetview' ? '#fbbc04' : mode === 'drone' ? '#c084fc' : '#34d399',
                background: 'rgba(0,0,0,0.4)',
                border: `1px solid ${mode === 'car' ? '#ef444455' : mode === 'helicopter' ? '#22c55e55' : mode === 'streetview' ? '#fbbc0455' : mode === 'drone' ? '#a855f755' : '#34d39955'}`,
                padding: '3px 8px',
                borderRadius: 5,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}
            >
              {mode === 'car' ? 'TESLA ROADSTER' : mode === 'helicopter' ? 'APACHE HELICOPTER' : mode === 'streetview' ? 'STREET VIEW 360°' : mode === 'drone' ? 'DRONE RECON' : 'STREET WALK'}
            </span>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              MODE SELECTOR TABS (Google Maps & Earth Style Segmented Bar)
              ══════════════════════════════════════════════════════════════ */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(0, 0, 0, 0.45)',
              borderRadius: 8,
              padding: 3,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              gap: 2,
            }}
          >
            {[
              { id: 'car', label: 'Tesla Roadster', icon: Car, color: '#ef4444' },
              { id: 'helicopter', label: 'Helicopter', icon: Rocket, color: '#22c55e' },
              { id: 'streetview', label: 'Street View', icon: MapPin, color: '#fbbc04' },
              { id: 'drone', label: 'Drone', icon: Radio, color: '#a855f7' },
              { id: 'walk', label: 'Street Walk', icon: Eye, color: '#34d399' },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setMode(tab.id as SimulatorMode);
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    borderRadius: 6,
                    border: 'none',
                    background: isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                    boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                    color: isActive ? tab.color : '#94a3b8',
                    fontSize: 10.5,
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Icon size={14} color={isActive ? tab.color : '#94a3b8'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* ══════════════════════════════════════════════════════════════
              LOCATION CONTROLS & GEODETIC PREVIEWS
              ══════════════════════════════════════════════════════════════ */}
          <div
            style={{
              background: 'rgba(0,0,0,0.25)',
              padding: 10,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setLocationType('current')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  cursor: 'pointer',
                  background: locationType === 'current' ? 'rgba(56,189,248,0.16)' : 'transparent',
                  border: `1px solid ${locationType === 'current' ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.1)'}`,
                  color: locationType === 'current' ? '#38bdf8' : '#94a3b8',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <LocateFixed size={12} /> CURRENT VIEWPOINT
              </button>
              <button
                onClick={() => setLocationType('preset')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  cursor: 'pointer',
                  background: locationType === 'preset' ? 'rgba(56,189,248,0.16)' : 'transparent',
                  border: `1px solid ${locationType === 'preset' ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.1)'}`,
                  color: locationType === 'preset' ? '#38bdf8' : '#94a3b8',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <MapPin size={12} /> 3D CITY ENCLAVE
              </button>
            </div>

            {locationType === 'preset' ? (
              <select
                value={selectedCity}
                onChange={(e) => {
                  const preset = SIMULATOR_CITIES.find(c => c.label === e.target.value);
                  if (preset) handleSelectCityPreset(preset);
                }}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  background: 'rgba(0,0,0,0.4)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                {SIMULATOR_CITIES.map((c) => (
                  <option key={c.label} value={c.label}>
                    {c.label} ({c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°)
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5, color: '#cbd5e1' }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                  {locationName}
                </span>
                <button
                  onClick={copyCoordinates}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copiedCoords ? '#4ade80' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 9.5,
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {copiedCoords ? <Check size={10} /> : <Copy size={10} />}
                  {lat.toFixed(4)}°, {lon.toFixed(4)}°
                </button>
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════
              MODE 1: HELICOPTER SIMULATOR
              ══════════════════════════════════════════════════════════════ */}
          {mode === 'helicopter' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Airframe Badge */}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#86efac', letterSpacing: '0.04em' }}>
                    AH-64E APACHE GUARDIAN
                  </div>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>
                    Heavy Attack · Twin Turboshaft · 4-Blade Main Rotor · 3D Avionics & Weapons
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#4ade80',
                    background: 'rgba(34, 197, 94, 0.2)',
                    padding: '2px 7px',
                    borderRadius: 4,
                  }}
                >
                  MIL-SPEC
                </span>
              </div>

              {/* Altitude Selection */}
              <div style={{ opacity: coldStart ? 0.45 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>SPAWN ALTITUDE (MSL)</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0, 100, 500, 1500].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAltM(v)}
                        style={{
                          padding: '2px 5px',
                          fontSize: 9,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: altM === v ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${altM === v ? '#4ade80' : 'rgba(255,255,255,0.12)'}`,
                          color: altM === v ? '#86efac' : '#94a3b8',
                        }}
                      >
                        {v === 0 ? '0m Ground' : `${v}m`}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={0}
                    max={3000}
                    step={25}
                    value={altM}
                    onChange={(e) => setAltM(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#22c55e' }}
                  />
                  <span style={{ fontSize: 11, color: '#4ade80', minWidth: 68, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                    {altM === 0 ? '0m (Ground)' : `${altM} m`}
                  </span>
                </div>
              </div>

              {/* Cold & Dark Start */}
              <button
                onClick={() => setColdStart(v => !v)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: coldStart ? 'rgba(251,191,36,0.14)' : 'transparent',
                  border: `1px solid ${coldStart ? 'rgba(251,191,36,0.55)' : 'rgba(255,255,255,0.12)'}`,
                  color: coldStart ? '#fbbf24' : '#94a3b8',
                }}
              >
                {coldStart ? '☑ COLD & DARK' : '☐ COLD & DARK'} — Start on pad: AVN · ECL · STARTER · FLIGHT
              </button>

              {/* Helicopter Flight Controls Reference */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 9.5,
                  color: '#94a3b8',
                  lineHeight: 1.7,
                }}
              >
                <div><span style={{ color: '#4ade80', fontWeight: 600 }}>W / S · PgUp/PgDn</span> — Collective (climb / descend)</div>
                <div><span style={{ color: '#4ade80', fontWeight: 600 }}>A / D</span> — Throttle (accelerate / decelerate)</div>
                <div><span style={{ color: '#4ade80', fontWeight: 600 }}>↑ ↓ ← →</span> — Cyclic (pitch fwd/aft, roll left/right)</div>
                <div><span style={{ color: '#4ade80', fontWeight: 600 }}>Q / E · , .</span> — Anti-torque pedals (yaw)</div>
                <div><span style={{ color: '#4ade80', fontWeight: 600 }}>Space</span> — Hover assist · <span style={{ color: '#4ade80', fontWeight: 600 }}>C/V</span> — Cameras</div>
              </div>

              {/* Launch CTA */}
              <button
                onClick={handleLaunchHelicopter}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '.06em',
                  boxShadow: '0 6px 18px rgba(22,163,74,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Rocket size={14} /> LAUNCH HELICOPTER FLIGHT
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              MODE 2: GOOGLE STREET VIEW (360° PANORAMA)
              ══════════════════════════════════════════════════════════════ */}
          {mode === 'streetview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {embedUrl ? (
                /* Interactive Embedded Street View Panorama */
                <div style={{ width: '100%', height: 320, borderRadius: 8, overflow: 'hidden', position: 'relative', border: '1px solid rgba(251,188,4,0.3)' }}>
                  <iframe
                    title="Google Street View"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={embedUrl}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(15,23,42,0.85)',
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      color: '#f8fafc',
                      backdropFilter: 'blur(8px)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <img src={getPegmanSvgUri()} alt="Pegman" style={{ width: 14, height: 14 }} />
                    <span>360° Live Embed</span>
                  </div>
                </div>
              ) : (
                /* 360° Street Level View & Exploration */
                <div
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(251,188,4,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src={getPegmanSvgUri()} alt="Pegman" style={{ width: 28, height: 28 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                        360° Street Level Exploration
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                        {locationName} · {lat.toFixed(4)}°, {lon.toFixed(4)}° · Heading {Math.round(heading)}°
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => {
                        setMode('car');
                        startGroundSimulation('drive');
                      }}
                      style={{
                        background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 11,
                        padding: '7px 13px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)',
                      }}
                    >
                      <Car size={13} /> Drive Roadster
                    </button>
                    <button
                      onClick={() => {
                        setMode('walk');
                        startGroundSimulation('walk');
                      }}
                      style={{
                        background: 'rgba(52, 211, 153, 0.18)',
                        border: '1px solid rgba(52, 211, 153, 0.45)',
                        color: '#34d399',
                        fontWeight: 700,
                        fontSize: 11,
                        padding: '7px 13px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Eye size={13} /> Street Walk
                    </button>
                  </div>
                </div>
              )}

              {/* Landmark Presets */}
              <div style={{ fontSize: 9.5, color: '#64748b', fontWeight: 600, letterSpacing: '0.04em', marginTop: 4 }}>
                ICONIC 360° STREET VIEW LANDMARKS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                {LANDMARK_PRESETS.map((lm) => (
                  <button
                    key={lm.name}
                    onClick={() => handleSelectLandmark(lm)}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 4,
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#cbd5e1',
                      fontSize: 9.5,
                      cursor: 'pointer',
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lm.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              MODE 3: TESLA ROADSTER 3D HYPERCAR DRIVE
              ══════════════════════════════════════════════════════════════ */}
          {mode === 'car' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isSimulating ? (
                /* LIVE IN-SIMULATION COCKPIT & FLIGHT CONSOLE */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Status Banner */}
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: isFlying ? 'rgba(14, 165, 233, 0.12)' : 'rgba(239, 68, 68, 0.08)',
                      border: `1px solid ${isFlying ? 'rgba(56, 189, 248, 0.4)' : 'rgba(239, 68, 68, 0.3)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isFlying ? '#38bdf8' : '#f87171', letterSpacing: '0.04em' }}>
                        TESLA ROADSTER ACTIVE TELEMETRY
                      </div>
                      <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>
                        {isFlying
                          ? `SpaceX Cold-Gas Thrusters Firing · Altitude: ${flightAltitudeM.toFixed(1)}m AGL`
                          : isLudicrous
                          ? 'Ludicrous+ Boost Active · Instant All-Wheel Torque'
                          : 'On-Board Compressors Charging · 10,000 PSI COPV Matrix'}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: isFlying ? '#38bdf8' : '#4ade80',
                        background: isFlying ? 'rgba(56, 189, 248, 0.2)' : 'rgba(74, 222, 128, 0.15)',
                        padding: '2px 7px',
                        borderRadius: 4,
                      }}
                    >
                      {isFlying ? 'AIRBORNE' : 'GROUND'}
                    </span>
                  </div>

                  {/* Telemetry Readouts Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    {/* Speedometer */}
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 600 }}>VELOCITY</div>
                      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: '#fff', marginTop: 2 }}>
                        {speedKmh} <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 500 }}>KM/H</span>
                      </div>
                    </div>

                    {/* Flight Altitude */}
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 600 }}>ALTITUDE (AGL)</div>
                      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: isFlying ? '#38bdf8' : '#cbd5e1', marginTop: 2 }}>
                        {flightAltitudeM.toFixed(1)} <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 500 }}>M</span>
                      </div>
                    </div>

                    {/* Camera Mode */}
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 6, textAlign: 'center' }}>
                      <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 600 }}>CAMERA VIEW</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginTop: 4 }}>
                        {perspective === 'chase' ? '📷 Chase Cam' : '💺 Cockpit'}
                      </div>
                    </div>
                  </div>

                  {/* SpaceX Cold-Gas Thruster Pressure Vessel Gauge */}
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.35)',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Wind size={12} /> SPACEX COPV TANK PRESSURE
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: copvPressurePsi > 3000 ? '#38bdf8' : '#f87171' }}>
                        {copvPressurePsi} <span style={{ fontSize: 8.5, color: '#94a3b8' }}>/ 10,000 PSI</span>
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: 7,
                        borderRadius: 3.5,
                        background: 'rgba(255,255,255,0.1)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, (copvPressurePsi / 10000) * 100))}%`,
                          height: '100%',
                          background: copvPressurePsi > 3000
                            ? 'linear-gradient(90deg, #0284c7, #38bdf8)'
                            : 'linear-gradient(90deg, #dc2626, #f87171)',
                          transition: 'width 0.1s linear',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: '#64748b', marginTop: 4 }}>
                      <span>{isFlying ? 'Thrusters depleting air pressure (~220 PSI/s)' : 'Compressors auto-recharging tanks on ground to 10,000 PSI'}</span>
                      <span style={{ color: '#38bdf8' }}>10 NOZZLE MATRIX</span>
                    </div>
                  </div>

                  {/* Tri-Motor AWD, Battery & Sound Architecture Telemetry */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 4,
                      fontSize: 8.5,
                      fontFamily: 'monospace',
                    }}
                  >
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 6px', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>TORQUE</div>
                      <div style={{ color: '#f87171', fontWeight: 700, marginTop: 1 }}>10,000 Nm</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 6px', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>AWD SPLIT</div>
                      <div style={{ color: '#38bdf8', fontWeight: 700, marginTop: 1 }}>35F / 65R</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 6px', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>RANGE</div>
                      <div style={{ color: '#4ade80', fontWeight: 700, marginTop: 1 }}>1,000 KM</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '5px 6px', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>ROOF</div>
                      <div style={{ color: targaOpen ? '#fbbf24' : '#cbd5e1', fontWeight: 700, marginTop: 1 }}>
                        {targaOpen ? 'TARGA OPEN' : 'COUPE'}
                      </div>
                    </div>
                  </div>

                  {/* Interactive Flight & Driving Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Primary Thruster Flight Button (Click to Toggle / Space) */}
                    <button
                      onClick={() => groundWalkRef.current?.toggleFlight()}
                      title="Toggle SpaceX Cold-Gas Thrusters Flight Mode [F / Space]"
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: isFlying
                          ? 'linear-gradient(135deg, #0284c7, #0ea5e9)'
                          : 'linear-gradient(135deg, rgba(2, 132, 199, 0.4), rgba(14, 165, 233, 0.25))',
                        border: `1.5px solid ${isFlying ? '#38bdf8' : 'rgba(56, 189, 248, 0.5)'}`,
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 11.5,
                        letterSpacing: '.04em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        boxShadow: isFlying ? '0 0 16px rgba(56, 189, 248, 0.6)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Rocket size={14} /> {isFlying ? 'SPACE THRUSTERS FIRING (AIRBORNE)' : 'HOLD TO FIRE SPACEX COLD-GAS THRUSTERS (SPACE)'}
                    </button>

                    {/* Secondary Action Buttons Grid (6 Buttons) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                      {/* Ludicrous+ Toggle */}
                      <button
                        onClick={() => groundWalkRef.current?.setManualLudicrous(!isLudicrous)}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: isLudicrous ? 'linear-gradient(135deg, #ea580c, #f97316)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${isLudicrous ? '#fb923c' : 'rgba(255,255,255,0.15)'}`,
                          color: isLudicrous ? '#fff' : '#f97316',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <Zap size={11} /> {isLudicrous ? 'BOOST ON' : 'BOOST (SHIFT)'}
                      </button>

                      {/* Perspective Toggle */}
                      <button
                        onClick={() => groundWalkRef.current?.togglePerspective()}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: perspective === 'cockpit' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${perspective === 'cockpit' ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
                          color: perspective === 'cockpit' ? '#38bdf8' : '#e2e8f0',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <Camera size={11} /> {perspective === 'chase' ? 'COCKPIT (V)' : 'CHASE (V)'}
                      </button>

                      {/* 360° Studio Showcase Turntable */}
                      <button
                        onClick={() => groundWalkRef.current?.toggleTurntable()}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: autoTurntable ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${autoTurntable ? '#818cf8' : 'rgba(255,255,255,0.15)'}`,
                          color: autoTurntable ? '#a5b4fc' : '#e2e8f0',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <RotateCw size={11} /> {autoTurntable ? 'SPINNING' : '360° SPIN (R)'}
                      </button>

                      {/* Audio Sound Toggle */}
                      <button
                        onClick={() => groundWalkRef.current?.toggleAudioMute()}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: !isAudioMuted ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${!isAudioMuted ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
                          color: !isAudioMuted ? '#38bdf8' : '#94a3b8',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        {!isAudioMuted ? <Volume2 size={11} /> : <VolumeX size={11} />}
                        {!isAudioMuted ? 'AUDIO (U)' : 'MUTED (U)'}
                      </button>

                      {/* Convertible Targa Roof Toggle */}
                      <button
                        onClick={() => groundWalkRef.current?.toggleTargaRoof()}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: targaOpen ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${targaOpen ? '#f59e0b' : 'rgba(255,255,255,0.15)'}`,
                          color: targaOpen ? '#fbbf24' : '#e2e8f0',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <Sun size={11} /> {targaOpen ? 'TARGA OPEN' : 'COUPE ROOF (T)'}
                      </button>

                      {/* Reset Camera Orbit */}
                      <button
                        onClick={() => groundWalkRef.current?.resetOrbitCamera()}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#cbd5e1',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <RotateCcw size={11} /> RESET VIEW
                      </button>
                    </div>
                  </div>

                  {/* Virtual Drive D-Pad Controller */}
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      padding: 10,
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>
                      ON-SCREEN VIRTUAL DRIVE PAD
                    </div>
                    {/* Throttle Forward */}
                    <button
                      onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(1); }}
                      onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                      onMouseLeave={() => groundWalkRef.current?.setManualThrottle(0)}
                      onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(1); }}
                      onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                      style={{
                        padding: '6px 20px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      <ArrowUp size={12} /> ACCELERATE
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Steer Left */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(-1); }}
                        onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
                        onMouseLeave={() => groundWalkRef.current?.setManualSteer(0)}
                        onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(-1); }}
                        onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 6,
                          background: 'rgba(255,255,255,0.1)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        <ArrowLeft size={12} /> STEER LEFT
                      </button>

                      {/* Steer Right */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(1); }}
                        onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
                        onMouseLeave={() => groundWalkRef.current?.setManualSteer(0)}
                        onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(1); }}
                        onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualSteer(0); }}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 6,
                          background: 'rgba(255,255,255,0.1)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        STEER RIGHT <ArrowRight size={12} />
                      </button>
                    </div>

                    {/* Brake / Reverse */}
                    <button
                      onMouseDown={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(-1); }}
                      onMouseUp={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                      onMouseLeave={() => groundWalkRef.current?.setManualThrottle(0)}
                      onTouchStart={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(-1); }}
                      onTouchEnd={(e) => { e.preventDefault(); groundWalkRef.current?.setManualThrottle(0); }}
                      style={{
                        padding: '6px 20px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      <ArrowDown size={12} /> BRAKE / REVERSE
                    </button>
                  </div>

                  {/* Console Action Bar */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setMinimized(true)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#e2e8f0',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <Minimize2 size={13} /> Minimize to Floating HUD
                    </button>

                    <button
                      onClick={stopGroundSimulation}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        border: 'none',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <X size={13} /> Exit Roadster Mode
                    </button>
                  </div>
                </div>
              ) : (
                /* PRE-LAUNCH SPECIFICATIONS & CONTROLS */
                <>
                  {/* Vehicle Specification Card */}
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>
                        TESLA ROADSTER (TRI-MOTOR AWD)
                      </div>
                      <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>
                        0–100 km/h: 1.9s (&lt; 1.0s SpaceX Package) · 10,000 Nm Torque · 400+ km/h · 1,000 km Range · Removable Targa Glass Roof
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#f87171',
                        background: 'rgba(239, 68, 68, 0.2)',
                        padding: '2px 7px',
                        borderRadius: 4,
                      }}
                    >
                      HYPERCAR
                    </span>
                  </div>

                  {/* Driving & Flight Controls Guide */}
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      padding: 8,
                      borderRadius: 6,
                      fontSize: 9.5,
                      color: '#94a3b8',
                      lineHeight: 1.7,
                    }}
                  >
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>W / ↑</span> — Instant Electric Throttle (cruising ~140 km/h)</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>Shift</span> — Ludicrous+ Hypercar Boost (up to 400+ km/h)</div>
                    <div><span style={{ color: '#38bdf8', fontWeight: 600 }}>Space</span> — Fire SpaceX Cold-Gas Thrusters (Hover & Fly using 10,000 PSI air pressure)</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>S / ↓</span> — Carbon-Ceramic Brembo Brake & Reverse</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>A / D</span> — Aerodynamic Vectoring Steering</div>
                    <div><span style={{ color: '#38bdf8', fontWeight: 600 }}>T</span> — Convertible Targa Mode (Stow / Mount Removable Glass Roof in Trunk)</div>
                    <div><span style={{ color: '#38bdf8', fontWeight: 600 }}>U</span> — Audio Sound Engine (Procedural Tri-Motor Inverter & SpaceX Pneumatics)</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>Mouse Drag</span> — 360° Spherical Orbit (Clockwise & Anticlockwise continuous)</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>Mouse Wheel</span> — Smooth Zoom In / Out · <span style={{ color: '#f87171', fontWeight: 600 }}>Dbl-Click</span> — Reset Orbit</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>C / V</span> — Switch Cockpit View (Steer-by-wire yoke, dash & windshield) & Chase Cam</div>
                    <div><span style={{ color: '#f87171', fontWeight: 600 }}>R</span> — 360° Showcase Studio Turntable Spin</div>
                  </div>

                  {/* Start 3D Car Drive CTA */}
                  <button
                    onClick={() => startGroundSimulation('drive')}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: 'linear-gradient(135deg, #dc2626, #991b1b)',
                      border: 'none',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: '.06em',
                      boxShadow: '0 6px 18px rgba(220, 38, 38, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Car size={14} /> DRIVE TESLA ROADSTER ON GLOBE
                  </button>
                </>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              MODE 4: DRONE AERIAL RECON
              ══════════════════════════════════════════════════════════════ */}
          {mode === 'drone' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(168, 85, 247, 0.08)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#c084fc', letterSpacing: '0.04em' }}>
                    LOW-ALTITUDE DRONE SURVEY
                  </div>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>
                    24m Operating Ceiling · 360° Gimbal Pitch · Urban Grid Recon
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#c084fc',
                    background: 'rgba(168, 85, 247, 0.2)',
                    padding: '2px 7px',
                    borderRadius: 4,
                  }}
                >
                  24M SURVEY
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 9.5,
                  color: '#94a3b8',
                  lineHeight: 1.7,
                }}
              >
                <div><span style={{ color: '#c084fc', fontWeight: 600 }}>W / S</span> — Fly Forward / Backward</div>
                <div><span style={{ color: '#c084fc', fontWeight: 600 }}>A / D</span> — Lateral Strafe Left / Right</div>
                <div><span style={{ color: '#c084fc', fontWeight: 600 }}>Drag Mouse</span> — 360° Sensor Gimbal Pitch & Heading</div>
                <div><span style={{ color: '#c084fc', fontWeight: 600 }}>Shift</span> — High-speed survey flight</div>
              </div>

              <button
                onClick={() => startGroundSimulation('drone')}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, #9333ea, #7e22ce)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '.06em',
                  boxShadow: '0 6px 18px rgba(147,51,234,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Radio size={14} /> LAUNCH DRONE RECON
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              MODE 5: PEDESTRIAN STREET WALK
              ══════════════════════════════════════════════════════════════ */}
          {mode === 'walk' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'rgba(52, 211, 153, 0.08)',
                  border: '1px solid rgba(52, 211, 153, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6ee7b7', letterSpacing: '0.04em' }}>
                    HUMAN-SCALE PEDESTRIAN WALK
                  </div>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>
                    1.7m Ground Clamped · Dynamic Footstep Cadence · 3D Buildings
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: '#6ee7b7',
                    background: 'rgba(52, 211, 153, 0.2)',
                    padding: '2px 7px',
                    borderRadius: 4,
                  }}
                >
                  1.7M EYE-LEVEL
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 9.5,
                  color: '#94a3b8',
                  lineHeight: 1.7,
                }}
              >
                <div><span style={{ color: '#6ee7b7', fontWeight: 600 }}>W / S</span> — Step Forward / Step Backward</div>
                <div><span style={{ color: '#6ee7b7', fontWeight: 600 }}>A / D</span> — Sidestep Left / Right</div>
                <div><span style={{ color: '#6ee7b7', fontWeight: 600 }}>Drag Mouse</span> — Look 360° around the environment</div>
                <div><span style={{ color: '#6ee7b7', fontWeight: 600 }}>Shift</span> — Sprint</div>
              </div>

              <button
                onClick={() => startGroundSimulation('walk')}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, #059669, #047857)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '.06em',
                  boxShadow: '0 6px 18px rgba(5,150,105,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Eye size={14} /> START STREET WALK
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              FEATURED 3D CITY ENCLAVES (QUICK TELEPORT)
              ══════════════════════════════════════════════════════════════ */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
            <div style={{ fontSize: 9.5, color: '#64748b', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6 }}>
              FEATURED 3D CITY ENCLAVES (3D BUILDINGS STREAMED)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              {SIMULATOR_CITIES.slice(0, 10).map((c) => (
                <button
                  key={c.label}
                  onClick={() => handleSelectCityPreset(c)}
                  style={{
                    padding: '5px 4px',
                    borderRadius: 4,
                    background: selectedCity === c.label && locationType === 'preset' ? 'rgba(56,189,248,0.2)' : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${selectedCity === c.label && locationType === 'preset' ? '#38bdf8' : 'rgba(255,255,255,0.08)'}`,
                    color: selectedCity === c.label && locationType === 'preset' ? '#38bdf8' : '#cbd5e1',
                    fontSize: 9,
                    cursor: 'pointer',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={c.label}
                >
                  {c.city}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
