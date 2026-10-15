import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Clapperboard, Circle, Flame, TriangleAlert, Waves, CloudLightning, Wind,
  Globe, MapPin, Play, Pause, Square, RotateCw, Video, Volume2, VolumeX,
  Plus, Trash2, Camera, Download, Upload, Eye, Compass, Mountain,
  Layers, Sliders, Maximize2, Minimize2, ChevronUp, ChevronDown, Sparkles,
  Radio, Check, RefreshCw, X, ArrowLeft, Crosshair, Orbit, PlaneTakeoff,
  Wand2, Target, SunMedium
} from 'lucide-react';
import * as Cesium from 'cesium';
import Panel from '@/components/ui/Panel';
import { SENSOR_STYLES, type SensorStyleId } from '@/rendering/sensorStyles';
import {
  evaluateSplinePath,
  formatTimecode,
  generateOrbitPath,
  generateReconDivePath,
  generateHorizonRevealPath,
  generateSpiralClimbPath,
  generateContextualNarration,
  type Waypoint,
  type CameraPath,
  type EvaluatedCameraFrame,
  type TargetPoint,
} from '@/rendering/cinematicSpline';
import { SHOWCASE_PRESETS } from '@/data/cinematicPresets';

interface CinematicDirectorProps {
  viewer: Cesium.Viewer | null;
  onClose: () => void;
  layerVersion?: number;
  focusEntity?: { lat: number; lon: number; layer: string; name?: string } | null;
  zIndex?: number;
  activeSensorStyle?: SensorStyleId;
  onSelectSensorStyle?: (id: SensorStyleId) => void;
}

const CUSTOM_TOURS_KEY = 'terranoetis_custom_cinematic_tours';
const DISASTER_LAYERS = ['earthquakes', 'wildfires', 'volcanoes', 'floods', 'severe_storms', 'dust'];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  landmarks: <Mountain size={12} color="#38bdf8" />,
  earthquakes: <Circle size={12} fill="#ef4444" color="#ef4444" />,
  wildfires: <Flame size={12} color="#f97316" />,
  volcanoes: <TriangleAlert size={12} color="#a855f7" />,
  floods: <Waves size={12} color="#3b82f6" />,
  severe_storms: <CloudLightning size={12} color="#eab308" />,
  dust: <Wind size={12} color="#94a3b8" />,
  overview: <Globe size={12} color="#60a5fa" />,
  custom: <Sparkles size={12} color="#ec4899" />,
};

/* ── Live Entity Extraction for Hazard Paths ── */
function extractEntityPositions(viewer: Cesium.Viewer): Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]> {
  const groups = new Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]>();
  const now = Cesium.JulianDate.now();

  for (const entity of viewer.entities.values) {
    if (entity.show === false) continue;
    const props = entity.properties?.getValue(now) as Record<string, unknown> | undefined;
    const layer = (props?.layer as string) ?? '';
    if (!DISASTER_LAYERS.includes(layer)) continue;

    let pos: Cesium.Cartesian3 | undefined;
    if (entity.position) {
      pos = entity.position.getValue instanceof Function ? entity.position.getValue(now) : (entity.position as unknown as Cesium.Cartesian3);
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

function buildDisasterPaths(entityGroups: Map<string, { lat: number; lon: number; magnitude?: number; name?: string }[]>): CameraPath[] {
  const paths: CameraPath[] = [];

  for (const [layer, entities] of entityGroups) {
    if (!entities.length) continue;
    const sorted = [...entities].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0)).slice(0, 2);

    for (const [idx, ent] of sorted.entries()) {
      const magLabel = ent.magnitude ? ` M${ent.magnitude.toFixed(1)}` : '';
      const displayName = ent.name ?? `${ent.lat.toFixed(2)}°, ${ent.lon.toFixed(2)}°`;
      const baseAlt = ent.magnitude ? ent.magnitude * 15000 + 25000 : 45000;

      paths.push({
        id: `live_${layer}_${idx}`,
        name: `${displayName}${magLabel}`,
        description: `Tactical 3D orbit around active ${layer.replace('_', ' ')} incident.`,
        category: layer,
        duration: 20,
        waypoints: [
          { lat: ent.lat + 0.35, lon: ent.lon - 0.45, height: baseAlt * 1.4, heading: 135, pitch: -30, narration: `Approaching ${layer.replace('_', ' ')} incident area.` },
          { lat: ent.lat - 0.30, lon: ent.lon - 0.35, height: baseAlt, heading: 45, pitch: -40, narration: `Sweeping along the perimeter. Mapping ground deformation and hazard radius.` },
          { lat: ent.lat - 0.35, lon: ent.lon + 0.40, height: baseAlt * 0.9, heading: 315, pitch: -45, narration: `Direct sensor look-angle. Energy concentration and thermal signature verified.` },
          { lat: ent.lat + 0.40, lon: ent.lon + 0.30, height: baseAlt * 1.5, heading: 225, pitch: -30, narration: `Pulling back to establish regional containment boundary.` },
        ],
        narration: [
          `Approaching ${layer.replace('_', ' ')} incident area.`,
          `Sweeping along the perimeter. Mapping ground deformation and hazard radius.`,
          `Direct sensor look-angle. Energy concentration and thermal signature verified.`,
          `Pulling back to establish regional containment boundary.`,
        ],
      });
    }
  }

  return paths;
}

/* ── Tactical Radio Sound Synthesizer (Web Audio API) ── */
function playRadioCommsChirp(type: 'squelch' | 'roger' = 'squelch') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'squelch') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);

      const bufferSize = Math.floor(ctx.sampleRate * 0.035);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.04;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.04, ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      noise.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start();
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1450, ctx.currentTime);
      osc.frequency.setValueAtTime(850, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch {
    /* AudioContext unavailable or blocked */
  }
}

export default function CinematicDirector({
  viewer,
  onClose,
  layerVersion,
  focusEntity,
  zIndex = 110,
  activeSensorStyle = 'normal',
  onSelectSensorStyle,
}: CinematicDirectorProps) {
  // Navigation tabs: 'showcase' | 'studio' | 'settings'
  const [activeTab, setActiveTab] = useState<'showcase' | 'studio' | 'settings'>('showcase');

  // Custom user tours loaded from localStorage
  const [customTours, setCustomTours] = useState<CameraPath[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_TOURS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Dynamic disaster paths
  const [disasterPaths, setDisasterPaths] = useState<CameraPath[]>([]);

  // Active tour index & state
  const [selectedTourId, setSelectedTourId] = useState<string>(SHOWCASE_PRESETS[0].id ?? 'himalayan_ridge');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [showTacticalHud, setShowTacticalHud] = useState(false);

  // Voice narration & speech synthesis
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [radioSfxEnabled, setRadioSfxEnabled] = useState(true);
  const [currentNarration, setCurrentNarration] = useState('');
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Video recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live evaluated camera telemetry for Broadcast HUD
  const [liveTelemetry, setLiveTelemetry] = useState<EvaluatedCameraFrame | null>(null);

  // Studio authoring draft state
  const [editingTour, setEditingTour] = useState<CameraPath | null>(null);
  const [studioFeedback, setStudioFeedback] = useState<string | null>(null);

  // Two-step inline confirmation states (replaces window.confirm for Tauri compatibility)
  const [confirmDeleteTourId, setConfirmDeleteTourId] = useState<string | null>(null);
  const [confirmStudioDelete, setConfirmStudioDelete] = useState(false);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmStudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      if (confirmStudioTimerRef.current) clearTimeout(confirmStudioTimerRef.current);
    };
  }, []);

  // Animation frame refs
  const animRef = useRef<number>(0);
  const startRef = useRef(0);
  const pauseTRef = useRef(0);
  const lastSegmentRef = useRef(-1);

  // All combined paths
  const allPaths = useMemo(() => {
    return [...SHOWCASE_PRESETS, ...customTours, ...disasterPaths];
  }, [customTours, disasterPaths]);

  const activePath = useMemo(() => {
    if (activeTab === 'studio' && editingTour) {
      return editingTour;
    }
    return allPaths.find(p => (p.id ?? p.name) === selectedTourId) || allPaths[0];
  }, [allPaths, selectedTourId, activeTab, editingTour]);

  // Activate tour's sensor style if defined
  useEffect(() => {
    if (activePath?.sensorStyle && onSelectSensorStyle) {
      onSelectSensorStyle(activePath.sensorStyle);
    }
  }, [activePath, onSelectSensorStyle]);

  // Refresh live disaster paths on layer changes
  const refreshLivePaths = useCallback(() => {
    if (!viewer) return;
    const groups = extractEntityPositions(viewer);
    const generated = buildDisasterPaths(groups);
    setDisasterPaths(generated);
  }, [viewer]);

  useEffect(() => {
    refreshLivePaths();
    const interval = setInterval(refreshLivePaths, 15000);
    return () => clearInterval(interval);
  }, [refreshLivePaths, layerVersion]);

  // Save custom tours to localStorage
  const saveCustomTours = useCallback((tours: CameraPath[]) => {
    setCustomTours(tours);
    try {
      localStorage.setItem(CUSTOM_TOURS_KEY, JSON.stringify(tours));
    } catch { /* ignore */ }
  }, []);

  /* ── Speech Synthesis & Tactical Radio Audio ── */
  const speakNarration = useCallback((text: string) => {
    if (!voiceEnabled || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      if (radioSfxEnabled) playRadioCommsChirp('squelch');
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.02;
      utterance.onend = () => {
        if (radioSfxEnabled) playRadioCommsChirp('roger');
      };
      speechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch { /* ignore */ }
  }, [voiceEnabled, radioSfxEnabled]);

  const stopSpeech = useCallback(() => {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch { /* ignore */ }
    }
  }, []);

  /* ── Camera Motion & Playback ── */
  const applyCamera = useCallback((path: CameraPath, t: number): EvaluatedCameraFrame => {
    const frame = evaluateSplinePath(path.waypoints, t);
    if (viewer) {
      viewer.camera.setView({
        destination: frame.position,
        orientation: {
          heading: Cesium.Math.toRadians(frame.heading),
          pitch: Cesium.Math.toRadians(frame.pitch),
          roll: Cesium.Math.toRadians(frame.roll),
        },
      });
    }
    setLiveTelemetry(frame);
    return frame;
  }, [viewer]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
    stopSpeech();
    if (isRecording) stopRecording();
  }, [stopSpeech, isRecording]);

  const playPath = useCallback((fromT = 0) => {
    if (!viewer || !activePath || activePath.waypoints.length === 0) return;
    stopPlayback();
    setIsPlaying(true);
    setProgress(fromT);
    pauseTRef.current = fromT;
    startRef.current = performance.now();
    lastSegmentRef.current = -1;

    const baseDurationMs = activePath.duration * 1000;
    const effectiveDurationMs = baseDurationMs / playbackSpeed;

    const animate = () => {
      const elapsed = performance.now() - startRef.current;
      const remainingProgress = 1 - pauseTRef.current;
      const progressDelta = (elapsed / (effectiveDurationMs * remainingProgress)) * remainingProgress;
      const rawT = pauseTRef.current + progressDelta;
      const t = Math.min(1, rawT);

      const frame = applyCamera(activePath, t);
      setProgress(t);

      // Segment narration check
      const seg = frame.segmentIndex;
      if (seg !== lastSegmentRef.current) {
        lastSegmentRef.current = seg;
        const line = activePath.waypoints[seg]?.narration || activePath.narration[seg % activePath.narration.length] || '';
        setCurrentNarration(line);
        speakNarration(line);
      }

      if (t >= 1) {
        if (isLooping) {
          pauseTRef.current = 0;
          startRef.current = performance.now();
          lastSegmentRef.current = -1;
          animRef.current = requestAnimationFrame(animate);
          return;
        }
        setIsPlaying(false);
        lastSegmentRef.current = -1;
        if (isRecording) stopRecording();
        return;
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
  }, [viewer, activePath, playbackSpeed, isLooping, applyCamera, stopPlayback, speakNarration, isRecording]);

  // Scrubbing
  const handleScrub = useCallback((val: number) => {
    if (!activePath) return;
    const t = val / 100;
    setProgress(t);
    pauseTRef.current = t;
    const frame = applyCamera(activePath, t);

    const seg = frame.segmentIndex;
    const line = activePath.waypoints[seg]?.narration || activePath.narration[seg % activePath.narration.length] || '';
    setCurrentNarration(line);
  }, [activePath, applyCamera]);

  /* ── Video Recording (MediaRecorder) ── */
  const startRecording = useCallback(() => {
    if (!viewer?.scene?.canvas) return;
    try {
      const canvas = viewer.scene.canvas;
      const stream = canvas.captureStream(60);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = `${(activePath?.name || 'cinematic_tour').replace(/[^a-z0-9_-]/gi, '_')}.webm`;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };

      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordedDuration(0);

      recordIntervalRef.current = setInterval(() => {
        setRecordedDuration(p => p + 1);
      }, 1000);

      // Start flight from current or beginning
      playPath(progress >= 1 ? 0 : progress);
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
    }
  }, [viewer, activePath, playPath, progress]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    recordIntervalRef.current = null;
    setIsRecording(false);
  }, []);

  /* ── Capture Viewpoint from Active Camera ── */
  const captureCurrentCamera = useCallback((): Waypoint | null => {
    if (!viewer) return null;
    const cam = viewer.camera;
    const carto = cam.positionCartographic;
    if (!carto) return null;

    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const height = Math.round(carto.height);
    const heading = Math.round(Cesium.Math.toDegrees(cam.heading));
    const pitch = Math.round(Cesium.Math.toDegrees(cam.pitch));
    const roll = Math.round(Cesium.Math.toDegrees(cam.roll));

    const wp: Waypoint = {
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      height,
      heading,
      pitch,
      roll,
    };
    wp.narration = generateContextualNarration(wp, 0, 1);
    return wp;
  }, [viewer]);

  /* ── Keyframe Studio Handlers ── */
  const handleStartNewTour = () => {
    const currentWp = captureCurrentCamera();
    const newTour: CameraPath = {
      id: `custom_${Date.now()}`,
      name: 'Custom Mission Tour',
      description: 'Operator authored tactical flight path.',
      category: 'custom',
      duration: 25,
      isCustom: true,
      sensorStyle: activeSensorStyle || 'normal',
      waypoints: currentWp ? [currentWp] : [
        { lat: 35.68, lon: 139.75, height: 3000, heading: 45, pitch: -30, narration: 'Mission approach viewpoint' }
      ],
      narration: ['Mission approach viewpoint'],
    };
    setEditingTour(newTour);
    setActiveTab('studio');
  };

  const handleAddWaypoint = () => {
    if (!editingTour) return;
    const wp = captureCurrentCamera();
    if (!wp) return;
    const newIdx = editingTour.waypoints.length;
    const enrichedWp: Waypoint = {
      ...wp,
      narration: generateContextualNarration(wp, newIdx, newIdx + 1),
    };
    const updatedWps = [...editingTour.waypoints, enrichedWp];
    const updatedTour: CameraPath = {
      ...editingTour,
      waypoints: updatedWps,
      duration: Math.max(10, updatedWps.length * 6),
      narration: updatedWps.map(w => w.narration || ''),
    };
    setEditingTour(updatedTour);
    setStudioFeedback(`Captured viewpoint #${updatedWps.length}`);
    setTimeout(() => setStudioFeedback(null), 2500);
  };

  /* ── AI Tactical Narration Generator ── */
  const handleAutoNarrateTour = () => {
    if (!editingTour) return;
    const total = editingTour.waypoints.length;
    const updatedWps = editingTour.waypoints.map((wp, idx) => {
      let hazardNote: string | undefined;
      for (const dp of disasterPaths) {
        const first = dp.waypoints[0];
        if (first && Math.hypot(first.lat - wp.lat, first.lon - wp.lon) < 2.5) {
          hazardNote = `${dp.name} sector`;
          break;
        }
      }
      const line = generateContextualNarration(wp, idx, total, hazardNote);
      return { ...wp, narration: line };
    });

    const updatedTour: CameraPath = {
      ...editingTour,
      waypoints: updatedWps,
      narration: updatedWps.map(w => w.narration || ''),
    };
    setEditingTour(updatedTour);
    setStudioFeedback('AI Tactical Narration generated!');
    setTimeout(() => setStudioFeedback(null), 2500);
  };

  /* ── Procedural Director Maneuvers ── */
  const handleGenerateManeuver = (type: 'orbit' | 'dive' | 'reveal' | 'spiral') => {
    const currentWp = captureCurrentCamera();
    const center: TargetPoint = focusEntity ? {
      lat: focusEntity.lat,
      lon: focusEntity.lon,
      height: 100,
      name: focusEntity.name || focusEntity.layer,
    } : currentWp ? {
      lat: currentWp.lat,
      lon: currentWp.lon,
      height: Math.max(0, currentWp.height - 2500),
      name: 'Terrain Focus',
    } : {
      lat: 27.988,
      lon: 86.925,
      height: 8848,
      name: 'Khumbu Valley',
    };

    let tour: CameraPath;
    if (type === 'orbit') {
      tour = generateOrbitPath(center, 4000, 2200, 26);
    } else if (type === 'dive') {
      tour = generateReconDivePath(center, 26);
    } else if (type === 'reveal') {
      tour = generateHorizonRevealPath(center, 20);
    } else {
      tour = generateSpiralClimbPath(center, 2500, 7500, 28);
    }

    if (activeSensorStyle) {
      tour.sensorStyle = activeSensorStyle;
    }

    setEditingTour(tour);
    setActiveTab('studio');
    setStudioFeedback(`Generated ${tour.name}!`);
    setTimeout(() => setStudioFeedback(null), 3000);
  };

  const handleDeleteWaypoint = (idx: number) => {
    if (!editingTour || editingTour.waypoints.length <= 1) return;
    const updatedWps = editingTour.waypoints.filter((_, i) => i !== idx);
    setEditingTour({
      ...editingTour,
      waypoints: updatedWps,
      duration: Math.max(10, updatedWps.length * 6),
    });
  };

  const handleMoveWaypoint = (idx: number, dir: -1 | 1) => {
    if (!editingTour) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= editingTour.waypoints.length) return;
    const copy = [...editingTour.waypoints];
    const temp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = temp;
    setEditingTour({ ...editingTour, waypoints: copy });
  };

  const handleSaveTour = () => {
    if (!editingTour) return;
    const updated = [...customTours.filter(t => t.id !== editingTour.id), editingTour];
    saveCustomTours(updated);
    setSelectedTourId(editingTour.id || editingTour.name);
    setStudioFeedback('Tour saved successfully!');
    setTimeout(() => {
      setStudioFeedback(null);
      setActiveTab('showcase');
    }, 1200);
  };

  const handleDeleteTour = (tourId: string) => {
    stopPlayback();
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    setConfirmDeleteTourId(null);
    const updated = customTours.filter(t => t.id !== tourId);
    saveCustomTours(updated);
    if (editingTour?.id === tourId) {
      setEditingTour(null);
      setActiveTab('showcase');
    }
    if (selectedTourId === tourId) {
      setSelectedTourId(SHOWCASE_PRESETS[0].id ?? 'himalayan_ridge');
    }
    setStudioFeedback('Tour deleted completely.');
    setTimeout(() => setStudioFeedback(null), 2000);
  };

  const handleDiscardOrDeleteTour = () => {
    stopPlayback();
    if (confirmStudioTimerRef.current) clearTimeout(confirmStudioTimerRef.current);
    setConfirmStudioDelete(false);
    if (editingTour?.id) {
      const updated = customTours.filter(t => t.id !== editingTour.id);
      saveCustomTours(updated);
      if (selectedTourId === editingTour.id) {
        setSelectedTourId(SHOWCASE_PRESETS[0].id ?? 'himalayan_ridge');
      }
    }
    setEditingTour(null);
    setActiveTab('showcase');
    setStudioFeedback('Tour deleted / discarded.');
    setTimeout(() => setStudioFeedback(null), 2000);
  };

  // Export custom tours to JSON
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(customTours, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terranoetis_cinematic_tours_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import custom tours from JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          const merged = [...customTours, ...parsed.map((p, idx) => ({ ...p, id: p.id || `imported_${Date.now()}_${idx}`, isCustom: true }))];
          saveCustomTours(merged);
          setStudioFeedback(`Imported ${parsed.length} tour(s)!`);
          setTimeout(() => setStudioFeedback(null), 2500);
        }
      } catch (err) {
        setStudioFeedback('Error: Invalid JSON format.');
        setTimeout(() => setStudioFeedback(null), 3000);
      }
    };
    reader.readAsText(file);
  };

  // Preview single waypoint
  const previewWaypoint = (wp: Waypoint) => {
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, wp.height),
      orientation: {
        heading: Cesium.Math.toRadians(wp.heading),
        pitch: Cesium.Math.toRadians(wp.pitch),
        roll: Cesium.Math.toRadians(wp.roll ?? 0),
      },
      duration: 1.5,
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      stopSpeech();
    };
  }, [stopSpeech]);

  return (
    <>
      {/* ── BROADCAST CINEMA MODE OVERLAY (Anamorphic 2.39:1 Letterbox) ── */}
      {cinemaMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: zIndex + 50, pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          {/* Top Letterbox Bar */}
          <div style={{
            height: '11vh', minHeight: 70, background: '#020617', pointerEvents: 'auto',
            borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Clapperboard size={18} color="#38bdf8" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.04em' }}>
                  {activePath?.name.toUpperCase()}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.02em' }}>
                  {activePath?.category.toUpperCase()} MISSION RECONNAISSANCE · 2.39:1 CINEMATIC PROJECTION
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.12)', padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(56, 189, 248, 0.3)'
              }}>
                {formatTimecode(progress * (activePath?.duration || 0))} / {formatTimecode(activePath?.duration || 0)}
              </div>
              <button
                onClick={() => setCinemaMode(false)}
                className="glass-button"
                style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                title="Exit Cinema Mode"
              >
                <Minimize2 size={13} /> Exit Cinema
              </button>
            </div>
          </div>

          {/* Bottom Letterbox Bar with Broadcast Lower-Thirds & Telemetry */}
          <div style={{
            height: '15vh', minHeight: 90, background: '#020617', pointerEvents: 'auto',
            borderTop: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.8)',
          }}>
            {/* Live Subtitle Banner */}
            <div style={{ flex: 1, maxWidth: '60%' }}>
              <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 2 }}>
                TACTICAL INTELLIGENCE NARRATION
              </div>
              <div style={{
                fontSize: 14, fontWeight: 500, color: '#f8fafc', lineHeight: 1.4,
                textShadow: '0 2px 4px rgba(0,0,0,0.8)', minHeight: 40,
              }}>
                {currentNarration || 'Analyzing survey trajectory and terrain elevation profile...'}
              </div>
            </div>

            {/* Real-time Telemetry & Mini Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', gap: 2
              }}>
                <span>LAT/LON: <strong style={{ color: '#f8fafc' }}>{liveTelemetry?.lat.toFixed(4)}°, {liveTelemetry?.lon.toFixed(4)}°</strong></span>
                <span>ALTITUDE: <strong style={{ color: '#38bdf8' }}>{Math.round(liveTelemetry?.height || 0).toLocaleString()} m ASL</strong></span>
                <span>HEADING: <strong style={{ color: '#f8fafc' }}>{Math.round(liveTelemetry?.heading || 0)}°</strong> | PITCH: <strong style={{ color: '#f8fafc' }}>{Math.round(liveTelemetry?.pitch || 0)}°</strong></span>
              </div>

              {/* Transport controls */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => (isPlaying ? stopPlayback() : playPath(progress >= 1 ? 0 : progress))}
                  className="glass-button"
                  style={{
                    width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isPlaying ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.08)',
                    borderColor: '#38bdf8', color: '#38bdf8'
                  }}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  onClick={stopPlayback}
                  className="glass-button"
                  style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Stop and Reset"
                >
                  <Square size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TACTICAL AVIATION & RECON HUD OVERLAY ── */}
      {showTacticalHud && (
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: zIndex + 40,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '24px 32px', fontFamily: 'monospace', color: '#38bdf8',
          textShadow: '0 0 4px rgba(56,189,248,0.8)', fontSize: 11, letterSpacing: '0.08em', userSelect: 'none'
        }}>
          {/* Top Compass Tape */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ background: 'rgba(0,0,0,0.65)', padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.35)', backdropFilter: 'blur(6px)' }}>
              SYS: RECON FLIGHT · SENSOR: {(activeSensorStyle || 'NORMAL').toUpperCase()}
            </div>
            <div style={{
              background: 'rgba(0,0,0,0.75)', padding: '6px 18px', borderRadius: 6,
              border: '1px solid rgba(56,189,248,0.4)', fontWeight: 700, fontSize: 12, display: 'flex', gap: 14, backdropFilter: 'blur(6px)'
            }}>
              <span>HDG {Math.round(liveTelemetry?.heading ?? 0).toString().padStart(3, '0')}°</span>
              <span style={{ color: '#64748b' }}>|</span>
              <span>PITCH {(liveTelemetry?.pitch ?? 0) > 0 ? `+${Math.round(liveTelemetry?.pitch ?? 0)}` : Math.round(liveTelemetry?.pitch ?? 0)}°</span>
              <span style={{ color: '#64748b' }}>|</span>
              <span>BANK {Math.round(liveTelemetry?.roll ?? 0)}°</span>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.65)', padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.35)', backdropFilter: 'blur(6px)' }}>
              CAM SPLINE · {isPlaying ? 'TRACKING' : 'IDLE'} · 60 FPS
            </div>
          </div>

          {/* Center Flight Path Reticle & Pitch Ladder */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: `translate(-50%, -50%) rotate(${-(liveTelemetry?.roll ?? 0)}deg)`,
            width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{ position: 'absolute', width: 24, height: 24, border: '1px solid rgba(56,189,248,0.7)', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', width: 4, height: 4, background: '#38bdf8', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', left: -45, width: 40, height: 1, background: '#38bdf8' }} />
            <div style={{ position: 'absolute', right: -45, width: 40, height: 1, background: '#38bdf8' }} />
            {/* Pitch ticks */}
            <div style={{ position: 'absolute', top: 32, width: 60, height: 1, background: 'rgba(56,189,248,0.4)', display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
              <span>-10</span><span>-10</span>
            </div>
            <div style={{ position: 'absolute', bottom: 32, width: 60, height: 1, background: 'rgba(56,189,248,0.4)', display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
              <span>+10</span><span>+10</span>
            </div>
          </div>

          {/* Bottom Telemetry Gauges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ background: 'rgba(0,0,0,0.65)', padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.35)', backdropFilter: 'blur(6px)' }}>
              <div>POS: {liveTelemetry?.lat.toFixed(4)}°, {liveTelemetry?.lon.toFixed(4)}°</div>
              <div style={{ color: '#94a3b8', fontSize: 9, marginTop: 2 }}>
                TARGET: {activePath?.targetLock?.name || activePath?.name || 'TACTICAL VISTA'}
              </div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.65)', padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.35)', textAlign: 'right', backdropFilter: 'blur(6px)' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                ALT {Math.round(liveTelemetry?.height ?? 0).toLocaleString()} M
              </div>
              <div style={{ color: '#94a3b8', fontSize: 9, marginTop: 2 }}>
                SPEED ~{Math.round(380 * playbackSpeed)} KTS
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN DIRECTOR'S DESK PANEL ── */}
      <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 440 }}>
        <Panel
          title="CINEMATIC DIRECTOR STUDIO"
          icon={<Clapperboard size={14} />}
          accentColor="#3b82f6"
          iconColor="#60a5fa"
          titleColor="#93c5fd"
          onClose={onClose}
          style={{ maxHeight: 'calc(100vh - 80px)' }}
        >
          {/* Tab Navigation */}
          <div style={{
            display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '6px 10px', gap: 6, background: 'rgba(0,0,0,0.2)'
          }}>
            <button
              onClick={() => setActiveTab('showcase')}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: activeTab === 'showcase' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: activeTab === 'showcase' ? '#38bdf8' : '#94a3b8',
                border: activeTab === 'showcase' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                transition: 'all 0.15s ease'
              }}
            >
              Showcase & Live ({allPaths.length})
            </button>
            <button
              onClick={() => {
                if (!editingTour && customTours.length > 0) setEditingTour(customTours[0]);
                else if (!editingTour) handleStartNewTour();
                setActiveTab('studio');
              }}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: activeTab === 'studio' ? 'rgba(236, 72, 153, 0.2)' : 'transparent',
                color: activeTab === 'studio' ? '#f472b6' : '#94a3b8',
                border: activeTab === 'studio' ? '1px solid rgba(236, 72, 153, 0.4)' : '1px solid transparent',
                transition: 'all 0.15s ease'
              }}
            >
              Keyframe Studio
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: activeTab === 'settings' ? 'rgba(96, 165, 250, 0.2)' : 'transparent',
                color: activeTab === 'settings' ? '#60a5fa' : '#94a3b8',
                border: activeTab === 'settings' ? '1px solid rgba(96, 165, 250, 0.4)' : '1px solid transparent',
                transition: 'all 0.15s ease'
              }}
            >
              Settings & Export
            </button>
          </div>

          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 170px)' }}>

            {/* ═══ TAB 1: SHOWCASE & LIVE EVENT TOURS ═══ */}
            {activeTab === 'showcase' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 700, letterSpacing: '0.04em' }}>
                    SELECT CAMERA FLIGHT
                  </span>
                  <button
                    onClick={refreshLivePaths}
                    className="glass-button"
                    style={{ fontSize: 9, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Refresh live disaster paths"
                  >
                    <RefreshCw size={10} /> Scan Globe
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allPaths.map((path) => {
                    const isSelected = (path.id ?? path.name) === selectedTourId;
                    return (
                      <div
                        key={path.id ?? path.name}
                        onClick={() => {
                          stopPlayback();
                          setSelectedTourId(path.id ?? path.name);
                          setProgress(0);
                          applyCamera(path, 0);
                        }}
                        style={{
                          background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)',
                          border: isSelected ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 8, padding: 10, cursor: 'pointer', transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: isSelected ? '#38bdf8' : '#f8fafc', fontSize: 12 }}>
                            {CATEGORY_ICONS[path.category] ?? <MapPin size={12} color="#94a3b8" />}
                            {path.name}
                          </div>
                          <span style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 4,
                            background: path.isCustom ? 'rgba(236,72,153,0.15)' : 'rgba(255,255,255,0.08)',
                            color: path.isCustom ? '#f472b6' : '#94a3b8', textTransform: 'uppercase', fontWeight: 600
                          }}>
                            {path.category}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
                          {path.description}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-muted)', marginTop: 6 }}>
                          <span>⏱ {path.duration}s duration · 📍 {path.waypoints.length} waypoints</span>
                          {path.isCustom && (
                            <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setEditingTour(path);
                                  setActiveTab('studio');
                                }}
                                className="glass-button"
                                style={{ padding: '2px 6px', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, color: '#f472b6' }}
                                title="Edit this custom tour in Keyframe Studio"
                              >
                                <Sliders size={10} /> Edit
                              </button>
                              {confirmDeleteTourId === (path.id ?? path.name) ? (
                                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                  <button
                                    onClick={() => {
                                      if (path.id) handleDeleteTour(path.id);
                                    }}
                                    className="glass-button"
                                    style={{
                                      padding: '2px 6px', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3,
                                      color: '#ffffff', borderColor: '#ef4444', background: '#dc2626', fontWeight: 700
                                    }}
                                    title="Confirm permanent deletion"
                                  >
                                    <Check size={10} /> Delete Now
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
                                      setConfirmDeleteTourId(null);
                                    }}
                                    className="glass-button"
                                    style={{ padding: '2px 4px', fontSize: 9, color: '#94a3b8' }}
                                    title="Cancel"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
                                    setConfirmDeleteTourId(path.id ?? path.name);
                                    confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteTourId(null), 4000);
                                  }}
                                  className="glass-button"
                                  style={{
                                    padding: '2px 6px', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3,
                                    color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)'
                                  }}
                                  title="Delete this custom tour permanently"
                                >
                                  <Trash2 size={10} /> Delete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ TAB 2: KEYFRAME STUDIO (AUTHORING) ═══ */}
            {activeTab === 'studio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Header actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#f472b6', fontWeight: 700, letterSpacing: '0.04em' }}>
                    KEYFRAME AUTHORING STUDIO
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setActiveTab('showcase')}
                      className="glass-button"
                      style={{ fontSize: 10, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}
                      title="Return to Showcase tours list"
                    >
                      <ArrowLeft size={11} /> Showcase
                    </button>
                    <button
                      onClick={handleStartNewTour}
                      className="glass-button"
                      style={{ fontSize: 10, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Plus size={11} /> New Tour
                    </button>
                  </div>
                </div>

                {editingTour ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Tour Metadata */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Tour Name</label>
                      <input
                        type="text"
                        value={editingTour.name}
                        onChange={e => setEditingTour({ ...editingTour, name: e.target.value })}
                        style={{
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 6, padding: '6px 8px', color: '#f8fafc', fontSize: 11
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Description</label>
                      <input
                        type="text"
                        value={editingTour.description}
                        onChange={e => setEditingTour({ ...editingTour, description: e.target.value })}
                        style={{
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 6, padding: '6px 8px', color: '#f8fafc', fontSize: 11
                        }}
                      />
                    </div>

                    {/* "Capture Current Camera" Action */}
                    <div style={{ marginTop: 4 }}>
                      <button
                        onClick={handleAddWaypoint}
                        style={{
                          width: '100%',
                          background: 'rgba(236, 72, 153, 0.2)', border: '1px solid rgba(236, 72, 153, 0.4)',
                          color: '#f472b6', borderRadius: 8, padding: '9px 12px', fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          transition: 'all 0.15s ease'
                        }}
                        title="Capture the current camera position, pitch, heading & altitude as a new keyframe"
                      >
                        <Camera size={14} /> Capture Viewpoint
                      </button>
                    </div>

                    {/* Procedural Maneuvers Generator */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 9, color: '#f472b6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Orbit size={11} /> Procedural Hollywood & Recon Maneuvers
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        <button
                          onClick={() => handleGenerateManeuver('orbit')}
                          className="glass-button"
                          style={{ fontSize: 10, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
                          title="Generate 360-degree circular orbit with target lock and coordinated roll"
                        >
                          <Orbit size={12} color="#38bdf8" /> 360° Orbit
                        </button>
                        <button
                          onClick={() => handleGenerateManeuver('dive')}
                          className="glass-button"
                          style={{ fontSize: 10, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
                          title="Generate high-velocity supersonic dive from orbit to deck"
                        >
                          <PlaneTakeoff size={12} color="#f97316" /> Recon Dive
                        </button>
                        <button
                          onClick={() => handleGenerateManeuver('reveal')}
                          className="glass-button"
                          style={{ fontSize: 10, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
                          title="Generate vertical crane pull-up revealing horizon"
                        >
                          <SunMedium size={12} color="#eab308" /> Horizon Reveal
                        </button>
                        <button
                          onClick={() => handleGenerateManeuver('spiral')}
                          className="glass-button"
                          style={{ fontSize: 10, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
                          title="Generate ascending spiral corkscrew climb around target"
                        >
                          <Compass size={12} color="#a855f7" /> Spiral Climb
                        </button>
                      </div>
                    </div>

                    {/* Camera Optics / Sensor Mode */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Eye size={11} /> Optical Spectrum & Sensor Post-Process
                        </span>
                        <span style={{ fontSize: 9, color: '#94a3b8' }}>
                          MODE: <strong style={{ color: '#f8fafc' }}>{activeSensorStyle?.toUpperCase() || 'NORMAL'}</strong>
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {SENSOR_STYLES.map(s => {
                          const isCur = (activeSensorStyle || 'normal') === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => {
                                if (onSelectSensorStyle) onSelectSensorStyle(s.id);
                                if (editingTour) setEditingTour({ ...editingTour, sensorStyle: s.id });
                              }}
                              className="glass-button"
                              style={{
                                fontSize: 9, padding: '4px 6px', fontWeight: isCur ? 700 : 500,
                                background: isCur ? 'rgba(56, 189, 248, 0.25)' : undefined,
                                borderColor: isCur ? '#38bdf8' : undefined,
                                color: isCur ? '#38bdf8' : '#94a3b8',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3
                              }}
                              title={s.hint}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {studioFeedback && (
                      <div style={{ fontSize: 10, color: '#4ade80', textAlign: 'center', fontWeight: 600 }}>
                        {studioFeedback}
                      </div>
                    )}

                    {/* Waypoints List with AI Briefing button */}
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>
                          Waypoints Sequence ({editingTour.waypoints.length})
                        </span>
                        <button
                          onClick={handleAutoNarrateTour}
                          className="glass-button"
                          style={{ fontSize: 9, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 3, color: '#f472b6' }}
                          title="Generate authentic military/documentary voice narration for all waypoints"
                        >
                          <Sparkles size={11} /> AI Tactical Briefing
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                        {editingTour.waypoints.map((wp, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#f472b6' }}>
                                #{idx + 1} · {wp.lat.toFixed(2)}°, {wp.lon.toFixed(2)}°
                              </span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  onClick={() => previewWaypoint(wp)}
                                  className="glass-button" style={{ padding: '2px 5px', fontSize: 9 }}
                                  title="Fly camera to this waypoint"
                                >
                                  <Eye size={10} />
                                </button>
                                <button
                                  onClick={() => handleMoveWaypoint(idx, -1)}
                                  disabled={idx === 0}
                                  className="glass-button" style={{ padding: '2px 5px', fontSize: 9 }}
                                >
                                  <ChevronUp size={10} />
                                </button>
                                <button
                                  onClick={() => handleMoveWaypoint(idx, 1)}
                                  disabled={idx === editingTour.waypoints.length - 1}
                                  className="glass-button" style={{ padding: '2px 5px', fontSize: 9 }}
                                >
                                  <ChevronDown size={10} />
                                </button>
                                <button
                                  onClick={() => handleDeleteWaypoint(idx)}
                                  className="glass-button" style={{ padding: '2px 5px', fontSize: 9, color: '#ef4444' }}
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>

                            <div style={{ fontSize: 9, color: '#94a3b8', display: 'flex', gap: 10 }}>
                              <span>ALT: {Math.round(wp.height).toLocaleString()}m</span>
                              <span>HDG: {wp.heading}°</span>
                              <span>PITCH: {wp.pitch}°</span>
                            </div>

                            {/* Narration note */}
                            <input
                              type="text"
                              placeholder="Narration note for this viewpoint..."
                              value={wp.narration || ''}
                              onChange={e => {
                                const copy = [...editingTour.waypoints];
                                copy[idx] = { ...copy[idx], narration: e.target.value };
                                setEditingTour({ ...editingTour, waypoints: copy });
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 4, padding: '3px 6px', color: '#e2e8f0', fontSize: 10, marginTop: 2
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Buttons: Save & Delete/Discard */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                      <button
                        onClick={handleSaveTour}
                        style={{
                          flex: 1,
                          background: 'rgba(56, 189, 248, 0.25)', border: '1px solid rgba(56, 189, 248, 0.4)',
                          color: '#38bdf8', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                        }}
                      >
                        <Check size={14} /> Save Tour & Exit
                      </button>

                      {confirmStudioDelete ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            onClick={handleDiscardOrDeleteTour}
                            style={{
                              background: '#dc2626', border: '1px solid #ef4444',
                              color: '#ffffff', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                            }}
                            title="Confirm deletion / discard"
                          >
                            <Trash2 size={13} /> {customTours.some(t => t.id === editingTour.id) ? 'Confirm Delete' : 'Confirm Discard'}
                          </button>
                          <button
                            onClick={() => {
                              if (confirmStudioTimerRef.current) clearTimeout(confirmStudioTimerRef.current);
                              setConfirmStudioDelete(false);
                            }}
                            style={{
                              background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)',
                              color: '#94a3b8', borderRadius: 8, padding: '8px 10px', fontSize: 11,
                              cursor: 'pointer', display: 'flex', alignItems: 'center'
                            }}
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (confirmStudioTimerRef.current) clearTimeout(confirmStudioTimerRef.current);
                            setConfirmStudioDelete(true);
                            confirmStudioTimerRef.current = setTimeout(() => setConfirmStudioDelete(false), 4000);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)',
                            color: '#f87171', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                          }}
                          title={customTours.some(t => t.id === editingTour.id) ? "Delete this saved tour completely" : "Discard this unsaved draft"}
                        >
                          <Trash2 size={14} /> {customTours.some(t => t.id === editingTour.id) ? 'Delete Tour' : 'Discard Draft'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px 10px', color: '#94a3b8' }}>
                    Click "New Tour" to author a custom camera sequence.
                  </div>
                )}
              </div>
            )}

            {/* ═══ TAB 3: SETTINGS & EXPORT ═══ */}
            {activeTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, letterSpacing: '0.04em' }}>
                  DIRECTOR SETTINGS & VIDEO CAPTURE
                </span>

                {/* Speed selector */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#f8fafc' }}>Playback Speed</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0.5, 1.0, 2.0].map(s => (
                      <button
                        key={s}
                        onClick={() => setPlaybackSpeed(s)}
                        style={{
                          background: playbackSpeed === s ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)',
                          border: playbackSpeed === s ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                          color: playbackSpeed === s ? '#38bdf8' : '#94a3b8',
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer'
                        }}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice narration toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#f8fafc' }}>Voiceover AI (Speech)</div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>Synthesizes subtitles aloud using Web Speech API</div>
                  </div>
                  <button
                    onClick={() => setVoiceEnabled(p => !p)}
                    style={{
                      background: voiceEnabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
                      border: voiceEnabled ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.1)',
                      color: voiceEnabled ? '#4ade80' : '#94a3b8',
                      padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}
                  >
                    {voiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                    {voiceEnabled ? 'Enabled' : 'Muted'}
                  </button>
                </div>

                {/* Radio Comms SFX toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#f8fafc' }}>Radio Comms Squelch (SFX)</div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>Tactical military cockpit beep and squelch sound effects</div>
                  </div>
                  <button
                    onClick={() => setRadioSfxEnabled(p => !p)}
                    style={{
                      background: radioSfxEnabled ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                      border: radioSfxEnabled ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      color: radioSfxEnabled ? '#38bdf8' : '#94a3b8',
                      padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}
                  >
                    <Radio size={13} />
                    {radioSfxEnabled ? 'Active' : 'Muted'}
                  </button>
                </div>

                {/* Tactical HUD toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#f8fafc' }}>Aviation & Recon HUD</div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>Flight path reticle, compass tape, altitude & pitch ladder</div>
                  </div>
                  <button
                    onClick={() => setShowTacticalHud(p => !p)}
                    style={{
                      background: showTacticalHud ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                      border: showTacticalHud ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      color: showTacticalHud ? '#38bdf8' : '#94a3b8',
                      padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}
                  >
                    <Crosshair size={13} />
                    {showTacticalHud ? 'Visible' : 'Hidden'}
                  </button>
                </div>

                {/* Loop toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#f8fafc' }}>Loop Sequence</div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>Continuously loops tour for presentations / kiosk</div>
                  </div>
                  <button
                    onClick={() => setIsLooping(p => !p)}
                    style={{
                      background: isLooping ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                      border: isLooping ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      color: isLooping ? '#38bdf8' : '#94a3b8',
                      padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {isLooping ? 'Looping' : 'Off'}
                  </button>
                </div>

                {/* Video recording */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#f8fafc', fontWeight: 600, marginBottom: 4 }}>
                    Canvas Video Capture (MediaRecorder)
                  </div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 8 }}>
                    Record 60 FPS 1080p WebM flight directly from Cesium graphics buffer.
                  </div>
                  <button
                    onClick={() => (isRecording ? stopRecording() : startRecording())}
                    style={{
                      width: '100%',
                      background: isRecording ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.2)',
                      border: isRecording ? '1px solid #ef4444' : '1px solid rgba(56, 189, 248, 0.4)',
                      color: isRecording ? '#f87171' : '#38bdf8',
                      borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}
                  >
                    <Video size={14} />
                    {isRecording ? `Recording in progress... (${recordedDuration}s) Click to Finish` : 'Start Video Recording'}
                  </button>
                </div>

                {/* Import / Export JSON */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#f8fafc', fontWeight: 600, marginBottom: 6 }}>
                    Tour Storage & Exchange
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleExportJSON}
                      className="glass-button"
                      style={{ flex: 1, padding: '6px 8px', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      <Download size={12} /> Export JSON
                    </button>
                    <label
                      className="glass-button"
                      style={{ flex: 1, padding: '6px 8px', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}
                    >
                      <Upload size={12} /> Import JSON
                      <input type="file" accept=".json" onChange={handleImportJSON} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ UNIVERSAL PLAYBACK & SCRUBBER DOCK ═══ */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Transport Buttons */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => {
                    if (isPlaying) stopPlayback();
                    else playPath(progress >= 1 ? 0 : progress);
                  }}
                  className="glass-button"
                  style={{
                    flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 700,
                    background: isPlaying ? 'rgba(56, 189, 248, 0.25)' : undefined,
                    borderColor: isPlaying ? '#38bdf8' : undefined,
                    color: isPlaying ? '#38bdf8' : '#f8fafc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                  }}
                >
                  {isPlaying ? (
                    <><Pause size={14} /> Pause{activeTab === 'studio' && editingTour ? ' Draft' : ''}</>
                  ) : progress > 0 && progress < 1 ? (
                    <><Play size={14} /> Resume{activeTab === 'studio' && editingTour ? ' Draft' : ''}</>
                  ) : (
                    <><Play size={14} /> {activeTab === 'studio' && editingTour ? 'Play Live Draft' : 'Play Tour'}</>
                  )}
                </button>

                <button
                  onClick={stopPlayback}
                  className="glass-button"
                  style={{ padding: '8px 12px' }}
                  title="Stop and Reset"
                >
                  <Square size={13} />
                </button>

                <button
                  onClick={() => {
                    stopPlayback();
                    setProgress(0);
                    if (activePath) applyCamera(activePath, 0);
                  }}
                  className="glass-button"
                  style={{ padding: '8px 12px' }}
                  title="Reset to Beginning"
                >
                  <RotateCw size={13} />
                </button>

                {/* Tactical HUD Toggle */}
                <button
                  onClick={() => setShowTacticalHud(p => !p)}
                  className="glass-button"
                  style={{
                    padding: '8px 10px',
                    background: showTacticalHud ? 'rgba(56, 189, 248, 0.25)' : undefined,
                    color: showTacticalHud ? '#38bdf8' : '#94a3b8'
                  }}
                  title="Toggle Tactical Aviation & Recon HUD"
                >
                  <Crosshair size={13} />
                </button>

                {/* Tactical Radio Comms SFX Toggle */}
                <button
                  onClick={() => setRadioSfxEnabled(p => !p)}
                  className="glass-button"
                  style={{
                    padding: '8px 10px',
                    background: radioSfxEnabled ? 'rgba(56, 189, 248, 0.25)' : undefined,
                    color: radioSfxEnabled ? '#38bdf8' : '#94a3b8'
                  }}
                  title="Toggle Tactical Radio Audio Squelch / Comms SFX"
                >
                  <Radio size={13} />
                </button>

                {/* Cinema Mode Toggle */}
                <button
                  onClick={() => setCinemaMode(p => !p)}
                  className="glass-button"
                  style={{
                    padding: '8px 10px',
                    background: cinemaMode ? 'rgba(56, 189, 248, 0.25)' : undefined,
                    color: cinemaMode ? '#38bdf8' : undefined
                  }}
                  title="Anamorphic 2.39:1 Cinema Mode"
                >
                  <Maximize2 size={13} />
                </button>
              </div>

              {/* Timecode & Cubic Spline Progress Bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {formatTimecode(progress * (activePath?.duration || 0))}
                  </span>
                  <span style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>
                    CATMULL-ROM 3D · {(progress * 100).toFixed(0)}%
                  </span>
                  <span>{formatTimecode(activePath?.duration || 0)}</span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress * 100}
                  onChange={e => handleScrub(Number(e.target.value))}
                  style={{ width: '100%', height: 5, accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>

              {/* Subtitle / Narration preview box */}
              {currentNarration && (
                <div style={{
                  background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '6px 10px', fontSize: 10,
                  color: '#e2e8f0', borderLeft: '3px solid #38bdf8', lineHeight: 1.4
                }}>
                  {currentNarration}
                </div>
              )}
            </div>

          </div>
        </Panel>
      </div>
    </>
  );
}
