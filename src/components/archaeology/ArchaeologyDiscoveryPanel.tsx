import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as Cesium from 'cesium';
import {
  Landmark,
  Crosshair,
  Satellite,
  Radio,
  Mountain,
  Layers,
  Sparkles,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Maximize2,
  BookOpen,
  ShieldCheck,
  Activity,
  Globe2,
  Compass,
  FileCheck2,
  Check,
  Copy,
  ChevronRight,
  ExternalLink,
  Navigation,
  CheckCheck,
  CloudSun,
  Eye,
  SlidersHorizontal,
  Info,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { authHeaders } from '@/context/AuthContext';
import type {
  StudyAreaBoundingBox,
  BiomeType,
  ArchaeologicalAnomaly,
  ArchaeologyScanResult,
  PeerReviewedReferenceSite,
  BenchmarkAuditReport,
} from '../../../server/archaeology/types';
import { inferBiomeFromCoordinates } from '../../../server/archaeology/biomeInference';
import {
  renderArchaeologyAnomaliesOnGlobe,
  clearArchaeologyOverlays,
  flyToAnomaly,
  ANOMALY_COLOR_MAP,
} from '@/rendering/archaeologyOverlay';

interface ArchaeologyDiscoveryPanelProps {
  viewer: Cesium.Viewer | null;
  show: boolean;
  onClose: () => void;
  activeStudyAreaBbox: StudyAreaBoundingBox | null;
  studyAreaName?: string | null;
  onOpenStudyAreaPanel?: () => void;
  zIndex?: number;
}

type TabType = 'search' | 'dossier' | 'benchmarks';

interface SensorModalInfo {
  id: 's2' | 's1' | 'dem' | 'soil';
  name: string;
  title: string;
  tag: string;
  tagColor: string;
  accentBg: string;
  borderColor: string;
  icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;
  description: string;
}

const SENSOR_MODALITIES: SensorModalInfo[] = [
  {
    id: 's2',
    name: 'Sentinel-2 L2A Optical',
    title: 'Copernicus Sentinel-2 Multi-Spectral (10m)',
    tag: 'OPTICAL / RED-EDGE',
    tagColor: '#38bdf8',
    accentBg: 'rgba(56,189,248,0.12)',
    borderColor: 'rgba(56,189,248,0.3)',
    icon: Satellite,
    description:
      'Multi-temporal Red-Edge (B05) and NIR (B08/B04) calculate differential vegetation stress (ΔNDRE/ΔNDVI) over buried stone foundations and sunken ditches.',
  },
  {
    id: 's1',
    name: 'Sentinel-1 RTC C-Band SAR',
    title: 'Copernicus Sentinel-1 SAR C-Band Radar',
    tag: 'SUBTERRANEAN SAR',
    tagColor: '#06b6d4',
    accentBg: 'rgba(6,182,212,0.12)',
    borderColor: 'rgba(6,182,212,0.3)',
    icon: Radio,
    description:
      'Radiometrically Terrain Corrected (RTC) C-band dual-polarization (VV/VH) penetrates 1–2m loose dry sand sheets to detect dielectric anomalies of buried silt paleochannels and compacted caravan trails.',
  },
  {
    id: 'dem',
    name: 'SRTM 30m Global DEM',
    title: 'Digital Elevation Models (NASA/USGS SRTM 30m)',
    tag: 'TOPOGRAPHY / SLRM',
    tagColor: '#f97316',
    accentBg: 'rgba(249,115,22,0.12)',
    borderColor: 'rgba(249,115,22,0.3)',
    icon: Mountain,
    description:
      'Horn gradient slope derivation and Simple Local Relief Models (SLRM) isolate micro-relief anomalies (10–50cm ramparts, barrows, tell mounds) from regional terrain grades.',
  },
  {
    id: 'soil',
    name: 'ISRIC SoilGrids Profile',
    title: 'Subsurface Soil Profile (ISRIC SoilGrids 250m)',
    tag: 'SOIL DIELECTRIC',
    tagColor: '#eab308',
    accentBg: 'rgba(234,179,8,0.12)',
    borderColor: 'rgba(234,179,8,0.3)',
    icon: Activity,
    description:
      'Subsurface clay, sand, and silt proportions determine electrical permittivity and dielectric contrast under radar illumination.',
  },
];

const BIOME_LABELS: Record<BiomeType, { label: string; desc: string }> = {
  tropical_coastal: {
    label: 'Tropical Coastal / Monsoon',
    desc: 'High vegetation density, monsoon hydrology, alluvial coastal soils (e.g. South Asia, Kerala, SE Asia)',
  },
  agricultural_plain: {
    label: 'Agricultural Plain',
    desc: 'Crop-mark differential stress via Sentinel-2 Red-Edge (ΔNDRE) & NDVI (e.g. Western Europe, UK)',
  },
  arid_desert: {
    label: 'Hyper-Arid Desert',
    desc: 'C-band SAR radar subsurface sand penetration & paleochannel extraction (e.g. Sahara, Arabian Peninsula)',
  },
  jungle_canopy: {
    label: 'Jungle & Dense Canopy',
    desc: 'LiDAR canopy penetration & Simple Local Relief Models (SLRM / SVF) (e.g. Amazon basin, Central America)',
  },
  alluvial_floodplain: {
    label: 'Alluvial Floodplain',
    desc: 'Thermal inertia & soil reflectance contrast over buried mudbrick structures (e.g. Nile Delta, Mesopotamia)',
  },
  steppe_grassland: {
    label: 'Steppe Grassland',
    desc: 'Circularity and micro-topographic shadow relief for burial mounds / kurgans (e.g. Eurasian steppe)',
  },
};

const SITE_FLAGS: Record<string, string> = {
  Egypt: '🇪🇬',
  'United Kingdom': '🇬🇧',
  Ecuador: '🇪🇨',
  Oman: '🇴🇲',
  India: '🇮🇳',
};

const DISCOVERY_PRESETS = [
  {
    name: 'Ahramat Nile Branch',
    location: 'Giza Plateau, Egypt',
    biome: 'arid_desert' as BiomeType,
    bbox: { lonMin: 31.08, latMin: 29.94, lonMax: 31.18, latMax: 30.04 },
    desc: 'Buried 64km Nile branch underlying pyramid complexes (Ghoneim et al., Nature Comms 2024)',
    flag: '🇪🇬',
  },
  {
    name: 'Silchester Roman Town',
    location: 'Hampshire, UK',
    biome: 'agricultural_plain' as BiomeType,
    bbox: { lonMin: -1.105, latMin: 51.350, lonMax: -1.075, latMax: 51.365 },
    desc: 'Calleva Atrebatum orthogonal insulae street grid via crop stress (Fulford et al., Britannia)',
    flag: '🇬🇧',
  },
  {
    name: 'Tanis Royal Necropolis',
    location: 'Nile Delta, Egypt',
    biome: 'alluvial_floodplain' as BiomeType,
    bbox: { lonMin: 31.870, latMin: 30.970, lonMax: 31.895, latMax: 30.985 },
    desc: 'Mudbrick temples & tomb structures mapped via thermal/multispectral satellite contrast (Parcak 2009)',
    flag: '🇪🇬',
  },
  {
    name: 'Upano Valley Urban Grid',
    location: 'Amazonian Andes, Ecuador',
    biome: 'jungle_canopy' as BiomeType,
    bbox: { lonMin: -78.180, latMin: -2.350, lonMax: -78.130, latMax: -2.290 },
    desc: 'Dense 2,500-year-old agrarian urban settlements under canopy (Rostain et al., Science 2024)',
    flag: '🇪🇨',
  },
  {
    name: 'Ubar (Atlantis of the Sands)',
    location: "Rub' al Khali, Oman",
    biome: 'arid_desert' as BiomeType,
    bbox: { lonMin: 53.640, latMin: 18.245, lonMax: 53.670, latMax: 18.270 },
    desc: 'Desert caravan hub discovered via Shuttle SIR-C / Landsat radar (Blom et al., PNAS 1997)',
    flag: '🇴🇲',
  },
  {
    name: 'Eastfort Negative Control',
    location: 'Thiruvananthapuram, India',
    biome: 'tropical_coastal' as BiomeType,
    bbox: { lonMin: 76.940, latMin: 8.475, lonMax: 76.960, latMax: 8.490 },
    desc: 'Empirical zero-anomaly negative control: verified zero synthetic false positives',
    flag: '🇮🇳',
  },
];

export const ArchaeologyDiscoveryPanel: React.FC<ArchaeologyDiscoveryPanelProps> = ({
  viewer,
  show,
  onClose,
  activeStudyAreaBbox,
  studyAreaName,
  onOpenStudyAreaPanel,
  zIndex = 115,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('search');
  const effectiveViewer = viewer || (typeof window !== 'undefined' ? (window as any).__VIEWER__ : null);
  const [selectedBiome, setSelectedBiome] = useState<BiomeType>('agricultural_plain');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ArchaeologyScanResult | null>(null);
  const [selectedAnomaly, setSelectedAnomaly] = useState<ArchaeologicalAnomaly | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [hoveredSensor, setHoveredSensor] = useState<'s2' | 's1' | 'dem' | 'soil' | null>(null);

  // Atmospheric Quality & Date Filters
  const [maxCloudCover, setMaxCloudCover] = useState<number>(5);
  const [seasonWindow, setSeasonWindow] = useState<'clearest_auto' | 'dry_season' | 'latest'>('clearest_auto');

  // 3D IDW Surface Visualization State
  const [showIdwSurface, setShowIdwSurface] = useState<boolean>(true);
  const [surfaceOpacity, setSurfaceOpacity] = useState<number>(0.65);
  const [showConfidenceFog, setShowConfidenceFog] = useState<boolean>(true);
  const [hoverProbe, setHoverProbe] = useState<{ lat: number; lon: number; value: number; confidencePct: number } | null>(null);

  // Benchmarks state
  const [benchmarks, setBenchmarks] = useState<PeerReviewedReferenceSite[]>([]);
  const [runningBenchmark, setRunningBenchmark] = useState(false);
  const [benchmarkAudit, setBenchmarkAudit] = useState<BenchmarkAuditReport | null>(null);

  // Automatically synchronize biome geographically whenever the study area changes
  useEffect(() => {
    if (activeStudyAreaBbox) {
      const centerLat = (activeStudyAreaBbox.latMin + activeStudyAreaBbox.latMax) / 2;
      const centerLon = (activeStudyAreaBbox.lonMin + activeStudyAreaBbox.lonMax) / 2;
      const inferred = inferBiomeFromCoordinates(centerLat, centerLon);
      setSelectedBiome(inferred);
    }
  }, [activeStudyAreaBbox]);

  // Load benchmarks list on mount
  useEffect(() => {
    fetch('/api/archaeology/benchmarks', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => {
        if (data.sites) setBenchmarks(data.sites);
      })
      .catch(err => console.warn('Failed to fetch archaeology benchmarks:', err));
  }, []);

  // Update globe overlays & 3D IDW surface whenever scanResult changes or visualization settings change
  useEffect(() => {
    if (!effectiveViewer) return;
    if (!scanResult) {
      clearArchaeologyOverlays(effectiveViewer);
      return;
    }

    renderArchaeologyAnomaliesOnGlobe(
      effectiveViewer,
      scanResult,
      scanResult.studyArea,
      (anomaly) => {
        setSelectedAnomaly(anomaly);
        setActiveTab('dossier');
      },
      {
        showIdwSurface,
        surfaceOpacity,
        showConfidenceFog,
        onProbe: (probe) => setHoverProbe(probe),
      },
    );
  }, [effectiveViewer, scanResult, showIdwSurface, surfaceOpacity, showConfidenceFog]);

  // Clean up overlays on close
  const handleClose = useCallback(() => {
    clearArchaeologyOverlays(effectiveViewer);
    onClose();
  }, [effectiveViewer, onClose]);

  // Execute scan on current study area
  const handleExecuteScan = async (overrideBbox?: StudyAreaBoundingBox, overrideBiome?: BiomeType) => {
    const bboxToUse = overrideBbox || activeStudyAreaBbox;
    if (!bboxToUse) {
      setErrorMsg('Please draw or select a study area on the globe first.');
      setActiveTab('search');
      return;
    }

    setScanning(true);
    setErrorMsg(null);

    try {
      const resp = await fetch('/api/archaeology/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          studyArea: bboxToUse,
          biome: overrideBiome || selectedBiome,
          maxCloudCoverPercent: maxCloudCover,
          seasonWindow: seasonWindow === 'latest' ? undefined : seasonWindow,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Scan failed with HTTP ${resp.status}`);
      }

      const data: ArchaeologyScanResult = await resp.json();
      setScanResult(data);
      if (data.anomalies.length > 0) {
        setSelectedAnomaly(data.anomalies[0]);
      } else {
        setSelectedAnomaly(null);
      }
      setActiveTab('dossier');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  // Select and fly to a peer-reviewed benchmark location
  const handleSelectBenchmark = (site: PeerReviewedReferenceSite) => {
    const v = effectiveViewer;
    if (!v) return;
    setSelectedBiome(site.biome);
    setErrorMsg(null);

    // Frame camera on the benchmark bounding box with padding
    const { lonMin, latMin, lonMax, latMax } = site.referenceBoundingBox;
    const padLon = (lonMax - lonMin) * 0.20;
    const padLat = (latMax - latMin) * 0.20;
    v.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        lonMin - padLon,
        latMin - padLat,
        lonMax + padLon,
        latMax + padLat,
      ),
      duration: 1.5,
    });
    v.scene.requestRender();

    // Execute scan on benchmark bounding box
    handleExecuteScan(site.referenceBoundingBox, site.biome);
  };

  // Preset button handler
  const handleApplyPreset = (preset: typeof DISCOVERY_PRESETS[0]) => {
    setSelectedBiome(preset.biome);
    setErrorMsg(null);
    const v = effectiveViewer;
    if (v && !v.isDestroyed()) {
      const { lonMin, latMin, lonMax, latMax } = preset.bbox;
      const padLon = (lonMax - lonMin) * 0.25;
      const padLat = (latMax - latMin) * 0.25;
      v.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          lonMin - padLon,
          latMin - padLat,
          lonMax + padLon,
          latMax + padLat,
        ),
        duration: 1.5,
      });
      v.scene.requestRender();
    }
    handleExecuteScan(preset.bbox, preset.biome);
  };

  // Cinematic 3D Orbit / Angle Fly-To
  const handleCinematicFlyTo = (anomaly: ArchaeologicalAnomaly) => {
    const v = effectiveViewer;
    if (!v || v.isDestroyed()) return;
    const lat = anomaly.centroid.lat;
    const lon = anomaly.centroid.lon;
    const elevation = anomaly.centroid.elevationMeters || 0;
    const radiusMeters = Math.max(600, Math.sqrt(anomaly.areaM2 || 10000) * 2.5);

    const sphere = new Cesium.BoundingSphere(
      Cesium.Cartesian3.fromDegrees(lon, lat, elevation),
      radiusMeters,
    );

    v.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(30),
        Cesium.Math.toRadians(-42),
        radiusMeters * 2.4,
      ),
      duration: 1.8,
    });
  };

  // Copy Centroid Coordinates
  const handleCopyCoords = (anomaly: ArchaeologicalAnomaly) => {
    const text = `${anomaly.centroid.lat.toFixed(6)}, ${anomaly.centroid.lon.toFixed(6)}`;
    navigator.clipboard?.writeText(text);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  // Run validation benchmark suite
  const handleRunValidationBenchmark = async () => {
    setRunningBenchmark(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/archaeology/benchmark/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!resp.ok) throw new Error(`Benchmark failed with status ${resp.status}`);
      const report: BenchmarkAuditReport = await resp.json();
      setBenchmarkAudit(report);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningBenchmark(false);
    }
  };

  // Export results as GeoJSON for public / field researchers
  const handleExportGeoJSON = () => {
    if (!scanResult || scanResult.anomalies.length === 0) return;
    const geojson = {
      type: 'FeatureCollection',
      features: scanResult.anomalies.map(a => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [a.polygonCoordinates],
        },
        properties: {
          id: a.id,
          name: a.name,
          category: a.category,
          confidenceScore: a.confidenceScore,
          areaM2: a.areaM2,
          evidence: a.evidence,
          evidenceSummary: a.evidenceSummary,
          culturalContext: a.culturalContext,
        },
      })),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `archaeology_dossier_${scanResult.scanId}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download raw verification dossier
  const handleDownloadDossierJSON = () => {
    if (!scanResult) return;
    const blob = new Blob([JSON.stringify(scanResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `archaeology_verification_telemetry_${scanResult.scanId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const centerCoords = useMemo(() => {
    if (!activeStudyAreaBbox) return null;
    return {
      lat: (activeStudyAreaBbox.latMin + activeStudyAreaBbox.latMax) / 2,
      lon: (activeStudyAreaBbox.lonMin + activeStudyAreaBbox.lonMax) / 2,
    };
  }, [activeStudyAreaBbox]);

  if (!show) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        right: 14,
        zIndex,
        width: 530,
        maxHeight: 'calc(100vh - 100px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Panel
        title="SPACE ARCHAEOLOGY & DISCOVERY INTELLIGENCE"
        icon={<Landmark size={15} />}
        accentColor="#f59e0b"
        iconColor="#fbbf24"
        titleColor="#fde68a"
        onClose={handleClose}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.75), 0 0 0 1px rgba(245,158,11,0.3)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* Live Earth Observation Status Ribbon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 12px',
            background: 'linear-gradient(90deg, rgba(245,158,11,0.14), rgba(6,182,212,0.09))',
            borderBottom: '1px solid rgba(245,158,11,0.22)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fde68a' }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 10px #22c55e',
                display: 'inline-block',
              }}
            />
            <span>EO LIVE SENSORS: SENTINEL-1 RTC · SENTINEL-2 L2A · SRTM 30M · SOILGRIDS</span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>V3.2 VERIFIED SCIENTIFIC</span>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(0,0,0,0.55)',
            borderBottom: '1px solid rgba(251,191,36,0.18)',
            padding: '6px 8px',
            gap: 6,
          }}
        >
          <button
            onClick={() => setActiveTab('search')}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'search' ? 'linear-gradient(135deg, rgba(245,158,11,0.32), rgba(245,158,11,0.12))' : 'transparent',
              color: activeTab === 'search' ? '#fde68a' : 'var(--text-dim)',
              boxShadow: activeTab === 'search' ? '0 0 0 1px rgba(245,158,11,0.45)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              transition: 'all 0.15s ease',
            }}
          >
            <Crosshair size={12} />
            Search Area
          </button>

          <button
            onClick={() => setActiveTab('dossier')}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'dossier' ? 'linear-gradient(135deg, rgba(245,158,11,0.32), rgba(245,158,11,0.12))' : 'transparent',
              color: activeTab === 'dossier' ? '#fde68a' : 'var(--text-dim)',
              boxShadow: activeTab === 'dossier' ? '0 0 0 1px rgba(245,158,11,0.45)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              position: 'relative',
              transition: 'all 0.15s ease',
            }}
          >
            <Sparkles size={12} />
            Dossier
            {scanResult && (
              <span
                style={{
                  background: scanResult.anomalies.length > 0 ? '#22c55e' : 'rgba(255,255,255,0.18)',
                  color: scanResult.anomalies.length > 0 ? '#000' : 'var(--text-dim)',
                  fontSize: 8,
                  fontWeight: 900,
                  padding: '1px 5px',
                  borderRadius: 10,
                }}
              >
                {scanResult.anomalies.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('benchmarks')}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'benchmarks' ? 'linear-gradient(135deg, rgba(245,158,11,0.32), rgba(245,158,11,0.12))' : 'transparent',
              color: activeTab === 'benchmarks' ? '#fde68a' : 'var(--text-dim)',
              boxShadow: activeTab === 'benchmarks' ? '0 0 0 1px rgba(245,158,11,0.45)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              transition: 'all 0.15s ease',
            }}
          >
            <BookOpen size={12} />
            Verified (5)
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {errorMsg && (
            <div
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 8,
                padding: '9px 12px',
                color: '#f87171',
                fontSize: 11,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* TAB 1: Search Area */}
          {activeTab === 'search' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Define or draw a prospective zone on the 3D globe to execute orthogonal consensus prospection
                using live multi-spectral Copernicus optical, radar, and micro-elevation models.
              </div>

              {/* Study Area Definition Card */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Compass size={13} color="#f59e0b" />
                    {studyAreaName || 'Prospective Study Area'}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: activeStudyAreaBbox ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: activeStudyAreaBbox ? '#4ade80' : '#f87171',
                      border: `1px solid ${activeStudyAreaBbox ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}
                  >
                    {activeStudyAreaBbox ? 'ZONE DEFINED' : 'NO SELECTION'}
                  </span>
                </div>

                {activeStudyAreaBbox ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                      fontSize: 10,
                      color: 'var(--text)',
                      background: 'rgba(255,255,255,0.02)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Lat Range: </span>
                      <span style={{ fontWeight: 600 }}>{activeStudyAreaBbox.latMin.toFixed(4)}° → {activeStudyAreaBbox.latMax.toFixed(4)}°</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Lon Range: </span>
                      <span style={{ fontWeight: 600 }}>{activeStudyAreaBbox.lonMin.toFixed(4)}° → {activeStudyAreaBbox.lonMax.toFixed(4)}°</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Draw a study area on the 3D globe using the Study Area panel (Point, Rectangle, Polygon, or Circle), or click any discovery preset below.
                  </div>
                )}

                {onOpenStudyAreaPanel && (
                  <button
                    onClick={onOpenStudyAreaPanel}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(245,158,11,0.12)',
                      border: '1px solid rgba(245,158,11,0.35)',
                      color: '#fde68a',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    <Layers size={13} />
                    {activeStudyAreaBbox ? 'Modify Study Area in Panel' : 'Open Study Area Panel to Draw'}
                  </button>
                )}
              </div>

              {/* Quick Archaeological & Control Presets */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Sparkles size={12} color="#f59e0b" />
                  Discovery Presets & Scientific Controls:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {DISCOVERY_PRESETS.map(preset => (
                    <button
                      key={preset.name}
                      onClick={() => handleApplyPreset(preset)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '8px 10px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        cursor: 'pointer',
                        textAlign: 'left',
                        gap: 3,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#f59e0b';
                        e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>
                          {preset.flag} {preset.name}
                        </span>
                        <ChevronRight size={11} color="#f59e0b" />
                      </div>
                      <span style={{ fontSize: 8, color: 'var(--text-dim)', lineHeight: 1.2 }}>{preset.location}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Geographically Inferred Biome Selector */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Globe2 size={12} color="#38bdf8" />
                    Landscape Biome (Ecological Classification):
                  </label>
                  {centerCoords && (
                    <span style={{ fontSize: 8, color: '#4ade80', fontWeight: 600 }}>
                      INFERRED AT {centerCoords.lat.toFixed(2)}°, {centerCoords.lon.toFixed(2)}°
                    </span>
                  )}
                </div>

                <select
                  value={selectedBiome}
                  onChange={e => setSelectedBiome(e.target.value as BiomeType)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(15,23,42,0.85)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <option value="tropical_coastal">Tropical Coastal / Monsoon (High Vegetation & Alluvial Plains)</option>
                  <option value="agricultural_plain">Agricultural Plain (Sentinel-2 Crop Marks ΔNDRE/NDVI)</option>
                  <option value="arid_desert">Hyper-Arid Desert (SAR Radar Sand Penetration)</option>
                  <option value="jungle_canopy">Jungle & Rainforest (LiDAR Micro-Relief SLRM/SVF)</option>
                  <option value="alluvial_floodplain">Alluvial Floodplain (Thermal & Mudbrick Wall Contrast)</option>
                  <option value="steppe_grassland">Steppe Grassland (Burial Mound / Kurgan Circularity)</option>
                </select>

                <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {BIOME_LABELS[selectedBiome]?.desc}
                </div>
              </div>

              {/* Atmospheric Quality & Cloud Ceiling Filter */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CloudSun size={12} color="#f59e0b" />
                    Cloud Ceiling & Target Imagery Season:
                  </label>
                  <span style={{ fontSize: 8, color: '#fde68a', fontWeight: 700 }}>
                    STAC CEILING: ≤ {maxCloudCover}%
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select
                    value={maxCloudCover}
                    onChange={e => setMaxCloudCover(Number(e.target.value))}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: 'rgba(15,23,42,0.85)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    <option value={5}>&lt; 5% Cloud (Strict Clean)</option>
                    <option value={10}>&lt; 10% Cloud (Standard Clean)</option>
                    <option value={20}>&lt; 20% Cloud (Permissive)</option>
                    <option value={50}>&lt; 50% Cloud (Cloud Tolerant)</option>
                  </select>

                  <select
                    value={seasonWindow}
                    onChange={e => setSeasonWindow(e.target.value as any)}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: 'rgba(15,23,42,0.85)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    <option value="clearest_auto">Clearest Pass (Auto STAC)</option>
                    <option value="dry_season">Dry Season (Crop Stress)</option>
                    <option value="latest">Latest Recent Pass</option>
                  </select>
                </div>

                <div style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  Filters Sentinel-2 L2A STAC archive for scenes under {maxCloudCover}% cloud cover to prevent cloud shadows from obscuring archaeological crop marks.
                </div>
              </div>

              {/* 3D IDW Surface Classification Map Controls */}
              <div
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(56,189,248,0.25)',
                  borderRadius: 8,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Eye size={13} color="#38bdf8" />
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8' }}>
                      3D IDW Surface Classification Map
                    </span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)' }}>
                    <input
                      type="checkbox"
                      checked={showIdwSurface}
                      onChange={e => setShowIdwSurface(e.target.checked)}
                      style={{ accentColor: '#38bdf8' }}
                    />
                    <span>Drape on 3D Globe</span>
                  </label>
                </div>

                {/* 4-Tier Colormap Legend Bar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div
                    style={{
                      height: 9,
                      borderRadius: 4,
                      background: 'linear-gradient(90deg, rgb(15,23,42) 0%, rgb(14,116,144) 20%, rgb(34,197,94) 45%, rgb(245,158,11) 65%, rgb(249,115,22) 82%, rgb(239,68,68) 100%)',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-dim)' }}>
                    <span style={{ color: '#38bdf8' }}>0.0 Baseline (Clean)</span>
                    <span style={{ color: '#4ade80' }}>0.45 Normal Veg</span>
                    <span style={{ color: '#facc15' }}>0.65 Divergence</span>
                    <span style={{ color: '#f87171' }}>1.0 Anomaly</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Surface Opacity: {Math.round(surfaceOpacity * 100)}%</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1.0}
                    step={0.05}
                    value={surfaceOpacity}
                    onChange={e => setSurfaceOpacity(parseFloat(e.target.value))}
                    style={{ width: 110, accentColor: '#38bdf8' }}
                  />
                </div>
              </div>

              {/* Real-time Hover Probe Reticle Status Chip */}
              {hoverProbe && (
                <div
                  style={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid #38bdf8',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 0 12px rgba(56,189,248,0.25)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#38bdf8' }}>
                    <Crosshair size={11} color="#38bdf8" />
                    <span>RETICLE: {hoverProbe.lat.toFixed(4)}°, {hoverProbe.lon.toFixed(4)}°</span>
                  </div>
                  <div style={{ fontWeight: 800, color: hoverProbe.value >= 0.7 ? '#f87171' : hoverProbe.value >= 0.4 ? '#facc15' : '#4ade80' }}>
                    Index: {hoverProbe.value.toFixed(2)} ({hoverProbe.value >= 0.7 ? 'ANOMALY' : hoverProbe.value >= 0.4 ? 'VARIATION' : 'CLEAN'}) · Conf: {hoverProbe.confidencePct}%
                  </div>
                </div>
              )}

              {/* Sensor Readiness Checklist with Interactive Hover Telemetry */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {/* Floating Sensor Info Tooltip on Cursor Hover */}
                {hoveredSensor && (() => {
                  const sensor = SENSOR_MODALITIES.find(s => s.id === hoveredSensor);
                  if (!sensor) return null;
                  const SensorIcon = sensor.icon;
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 8px)',
                        left: 0,
                        right: 0,
                        background: 'rgba(10, 15, 29, 0.97)',
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${sensor.borderColor}`,
                        boxShadow: `0 12px 32px rgba(0,0,0,0.85), 0 0 16px ${sensor.accentBg}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                        zIndex: 50,
                        pointerEvents: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        animation: 'fadeIn 0.15s ease-out',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <SensorIcon size={14} color={sensor.tagColor} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: sensor.tagColor }}>
                            {sensor.title}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: sensor.accentBg,
                            color: sensor.tagColor,
                            border: `1px solid ${sensor.borderColor}`,
                            letterSpacing: 0.5,
                          }}
                        >
                          {sensor.tag}
                        </span>
                      </div>

                      <div style={{ fontSize: 9.5, color: '#cbd5e1', lineHeight: 1.45 }}>
                        {sensor.description}
                      </div>

                      {/* Live Telemetry Display */}
                      {sensor.id === 's2' && scanResult?.liveSensors.sentinel2 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                          <div style={{ fontSize: 8.5, color: '#38bdf8', background: 'rgba(0,0,0,0.4)', padding: '3px 6px', borderRadius: 4 }}>
                            Scene: {scanResult.liveSensors.sentinel2.sceneId} · Cloud: {scanResult.liveSensors.sentinel2.cloudCoverPercent}%
                          </div>
                          {scanResult.liveSensors.sentinel2.pixelStatistics && (
                            <div style={{ fontSize: 8, color: '#4ade80', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', padding: '4px 6px', borderRadius: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                              <span>Live Pixels: {scanResult.liveSensors.sentinel2.pixelStatistics.validPixelsAnalyzed.toLocaleString()}</span>
                              <span>NDRE: {scanResult.liveSensors.sentinel2.pixelStatistics.computedNdre.toFixed(3)}</span>
                              <span>NDVI: {scanResult.liveSensors.sentinel2.pixelStatistics.computedNdvi.toFixed(3)}</span>
                              <span>NDMI: {scanResult.liveSensors.sentinel2.pixelStatistics.computedNdmi.toFixed(3)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {sensor.id === 's1' && scanResult?.liveSensors.sentinel1 && (
                        <div style={{ fontSize: 8.5, color: '#06b6d4', background: 'rgba(0,0,0,0.4)', padding: '3px 6px', borderRadius: 4, marginTop: 2 }}>
                          Platform: {scanResult.liveSensors.sentinel1.platform} · Pols: {scanResult.liveSensors.sentinel1.polarizations.join('/')} ({scanResult.liveSensors.sentinel1.mode})
                        </div>
                      )}

                      {sensor.id === 'dem' && scanResult?.liveSensors.dem && (
                        <div style={{ fontSize: 8.5, color: '#f97316', background: 'rgba(0,0,0,0.4)', padding: '3px 6px', borderRadius: 4, marginTop: 2 }}>
                          SRTM 30m: {scanResult.liveSensors.dem.minElevationM}m–{scanResult.liveSensors.dem.maxElevationM}m · Slope: {scanResult.liveSensors.dem.slopeDegrees}° · σ: {scanResult.liveSensors.dem.elevationStdDevM}m
                        </div>
                      )}

                      {sensor.id === 'soil' && scanResult?.liveSensors.soil && (
                        <div style={{ fontSize: 8.5, color: '#eab308', background: 'rgba(0,0,0,0.4)', padding: '3px 6px', borderRadius: 4, marginTop: 2 }}>
                          SoilGrids: Clay {scanResult.liveSensors.soil.clayPercent}% · Sand {scanResult.liveSensors.soil.sandPercent}% ({scanResult.liveSensors.soil.textureClass})
                        </div>
                      )}

                      {/* Directional Arrow pointing towards hovered item */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: hoveredSensor === 's2' || hoveredSensor === 'dem' ? '25%' : '75%',
                          transform: 'translateX(-50%)',
                          width: 0,
                          height: 0,
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderTop: `6px solid ${sensor.borderColor}`,
                        }}
                      />
                    </div>
                  );
                })()}

                {/* 2x2 Sensor Badges Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 6,
                    fontSize: 9,
                  }}
                >
                  {SENSOR_MODALITIES.map((sensor) => {
                    const isHovered = hoveredSensor === sensor.id;
                    return (
                      <div
                        key={sensor.id}
                        onMouseEnter={() => setHoveredSensor(sensor.id)}
                        onMouseLeave={() => setHoveredSensor(null)}
                        style={{
                          background: isHovered ? sensor.accentBg : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isHovered ? sensor.tagColor : 'var(--border)'}`,
                          padding: '6px 8px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isHovered ? `0 0 10px ${sensor.accentBg}` : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                          <Check size={11} color="#22c55e" style={{ flexShrink: 0 }} />
                          <span
                            style={{
                              color: isHovered ? '#fff' : 'var(--text-main)',
                              fontWeight: isHovered ? 600 : 400,
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                          >
                            {sensor.name}
                          </span>
                        </div>
                        <Info
                          size={10}
                          color={isHovered ? sensor.tagColor : 'var(--text-dim)'}
                          style={{ flexShrink: 0, opacity: isHovered ? 1 : 0.6 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Direct Scan Trigger */}
              <button
                disabled={!activeStudyAreaBbox || scanning}
                onClick={() => handleExecuteScan()}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: activeStudyAreaBbox
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : 'rgba(255,255,255,0.05)',
                  border: 'none',
                  color: activeStudyAreaBbox ? '#000' : 'var(--text-muted)',
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: 0.5,
                  cursor: activeStudyAreaBbox && !scanning ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: activeStudyAreaBbox ? '0 4px 14px rgba(245,158,11,0.3)' : 'none',
                }}
              >
                {scanning ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {scanning ? 'ACQUIRING LIVE SATELLITE & ELEVATION FEEDS...' : 'EXECUTE ORTHOGONAL CONSENSUS SCAN'}
              </button>
            </div>
          )}

          {/* TAB 2: Dossier */}
          {activeTab === 'dossier' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!scanResult ? (
                <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}>
                  <Landmark size={36} style={{ margin: '0 auto 10px', opacity: 0.35, color: '#f59e0b' }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>No Study Area Prospected Yet</div>
                  <div style={{ fontSize: 10, marginTop: 4, lineHeight: 1.5 }}>
                    Draw a bounding box on the 3D globe or select a verified benchmark site to inspect authentic subterranean discoveries.
                  </div>
                </div>
              ) : (
                <>
                  {/* 3D IDW Surface Classification Legend & Controls in Dossier */}
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(56,189,248,0.25)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Eye size={12} color="#38bdf8" />
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8' }}>
                          3D IDW Classification Surface
                        </span>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)' }}>
                        <input
                          type="checkbox"
                          checked={showIdwSurface}
                          onChange={e => setShowIdwSurface(e.target.checked)}
                          style={{ accentColor: '#38bdf8' }}
                        />
                        <span>Draped on 3D Globe</span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div
                        style={{
                          height: 7,
                          borderRadius: 3,
                          background: 'linear-gradient(90deg, rgb(15,23,42) 0%, rgb(14,116,144) 20%, rgb(34,197,94) 45%, rgb(245,158,11) 65%, rgb(249,115,22) 82%, rgb(239,68,68) 100%)',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--text-dim)' }}>
                        <span style={{ color: '#38bdf8' }}>0.0 Baseline</span>
                        <span style={{ color: '#4ade80' }}>0.45 Normal Veg</span>
                        <span style={{ color: '#facc15' }}>0.65 Divergence</span>
                        <span style={{ color: '#f87171' }}>1.0 Hotspot</span>
                      </div>
                    </div>

                    {hoverProbe && (
                      <div style={{ fontSize: 8, color: '#38bdf8', display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', padding: '3px 6px', borderRadius: 4 }}>
                        <span>⌖ Reticle: {hoverProbe.lat.toFixed(4)}°, {hoverProbe.lon.toFixed(4)}°</span>
                        <span style={{ fontWeight: 800, color: hoverProbe.value >= 0.7 ? '#f87171' : hoverProbe.value >= 0.4 ? '#facc15' : '#4ade80' }}>
                          Index: {hoverProbe.value.toFixed(2)} ({hoverProbe.value >= 0.7 ? 'HOTSPOT' : 'BASELINE'})
                        </span>
                      </div>
                    )}
                  </div>

                  {scanResult.status === 'NO_ANOMALY_DETECTED' ? (
                /* Honest Scientific Report when 0 anomalies detected */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.35)',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: '0 0 20px rgba(34,197,94,0.12)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: 'rgba(34,197,94,0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: '1px solid #22c55e',
                        }}
                      >
                        <ShieldCheck size={18} color="#4ade80" />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#4ade80', letterSpacing: 0.5 }}>
                          PROSPECTION COMPLETE: TERRAIN CLEAR
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
                          Zero synthetic detections · Transparent peer-reviewed baseline
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: 6 }}>
                      {scanResult.statusMessage}
                    </div>
                  </div>

                  {/* Live Telemetry Diagnostic Certificate Panel */}
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Activity size={13} color="#f59e0b" />
                      Empirical Remote Sensing Telemetry ({scanResult.studyAreaKm2} km²)
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 9 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 5 }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>Copernicus Sentinel-2 Optical:</span>
                        <span style={{ color: 'var(--text)' }}>
                          {scanResult.liveSensors.sentinel2 ? `${scanResult.liveSensors.sentinel2.platform} (Cloud ${scanResult.liveSensors.sentinel2.cloudCoverPercent}%)` : 'Not available'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 5 }}>
                        <span style={{ color: '#06b6d4', fontWeight: 600 }}>Sentinel-1 C-Band SAR:</span>
                        <span style={{ color: 'var(--text)' }}>
                          {scanResult.liveSensors.sentinel1 ? `${scanResult.liveSensors.sentinel1.platform} (${scanResult.liveSensors.sentinel1.polarizations.join('/')})` : 'Not available'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 5 }}>
                        <span style={{ color: '#f97316', fontWeight: 600 }}>SRTM 30m Topography:</span>
                        <span style={{ color: 'var(--text)' }}>
                          {scanResult.liveSensors.dem ? `${scanResult.liveSensors.dem.minElevationM}m–${scanResult.liveSensors.dem.maxElevationM}m (Slope ${scanResult.liveSensors.dem.slopeDegrees}°, σ ${scanResult.liveSensors.dem.elevationStdDevM}m)` : 'Not available'}
                        </span>
                      </div>

                      {scanResult.liveSensors.soil && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#eab308', fontWeight: 600 }}>Subsurface Soil Texture:</span>
                          <span style={{ color: 'var(--text)' }}>
                            {scanResult.liveSensors.soil.clayPercent}% Clay, {scanResult.liveSensors.soil.sandPercent}% Sand ({scanResult.liveSensors.soil.textureClass})
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleDownloadDossierJSON}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                        fontSize: 9,
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginTop: 4,
                      }}
                    >
                      <Download size={12} />
                      Download Raw Sensor Telemetry Log (JSON)
                    </button>
                  </div>
                </div>
              ) : scanResult.status === 'INSUFFICIENT_DATA' ? (
                /* Explicit Warning when Live Data is Unavailable */
                <div
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={18} color="#f87171" />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>
                      INSUFFICIENT REMOTE SENSING DATA
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5 }}>
                    {scanResult.statusMessage}
                  </div>
                </div>
              ) : (
                /* Confirmed Discoveries Dossier */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                      Confirmed Archaeological Features ({scanResult.anomalies.length})
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={handleExportGeoJSON}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'rgba(34,197,94,0.15)',
                          border: '1px solid #22c55e',
                          color: '#4ade80',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Download GeoJSON for QGIS / field verification"
                      >
                        <Download size={11} />
                        Export GeoJSON
                      </button>
                    </div>
                  </div>

                  {/* Selected Anomaly Deep Physical Evidence Dossier Card */}
                  {selectedAnomaly && (
                    <div
                      style={{
                        background: 'rgba(15,23,42,0.92)',
                        border: '1px solid #f59e0b',
                        borderRadius: 10,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        boxShadow: '0 8px 30px rgba(245,158,11,0.18)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#fde68a' }}>
                            {selectedAnomaly.name}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
                            {selectedAnomaly.category.toUpperCase().replace(/_/g, ' ')} · Centroid: {selectedAnomaly.centroid.lat.toFixed(4)}°, {selectedAnomaly.centroid.lon.toFixed(4)}°
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            padding: '3px 8px',
                            borderRadius: 12,
                            background: selectedAnomaly.confidenceScore >= 0.95 ? 'rgba(34,197,94,0.2)' : 'rgba(234,179,8,0.2)',
                            color: selectedAnomaly.confidenceScore >= 0.95 ? '#4ade80' : '#facc15',
                            border: `1px solid ${selectedAnomaly.confidenceScore >= 0.95 ? '#22c55e' : '#eab308'}`,
                          }}
                        >
                          {(selectedAnomaly.confidenceScore * 100).toFixed(1)}% CONF
                        </span>
                      </div>

                      {/* Quick Action Ribbon */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleCinematicFlyTo(selectedAnomaly)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            padding: '6px 8px',
                            borderRadius: 6,
                            background: 'rgba(245,158,11,0.15)',
                            border: '1px solid rgba(245,158,11,0.4)',
                            color: '#fde68a',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Navigation size={12} />
                          Cinematic 3D Fly-To
                        </button>

                        <button
                          onClick={() => handleCopyCoords(selectedAnomaly)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--border)',
                            color: copiedCoords ? '#4ade80' : 'var(--text-dim)',
                            fontSize: 10,
                            cursor: 'pointer',
                          }}
                        >
                          {copiedCoords ? <CheckCheck size={12} color="#4ade80" /> : <Copy size={12} />}
                          {copiedCoords ? 'Copied' : 'Coords'}
                        </button>
                      </div>

                      {/* 4-Quadrant Orthogonal Consensus Telemetry Grid */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, 1fr)',
                          gap: 8,
                          background: 'rgba(0,0,0,0.3)',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                        }}
                      >
                        {/* 1. Optical Contrast */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 700 }}>
                            Optical Contrast (ΔNDRE)
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                            {selectedAnomaly.evidence.spectralContrastDelta.toFixed(2)}
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                            Chlorophyll vegetative stress depression
                          </span>
                        </div>

                        {/* 2. SAR Radar Ratio */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 9, color: '#06b6d4', fontWeight: 700 }}>
                            SAR Backscatter (VH/VV)
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                            {selectedAnomaly.evidence.radarBackscatterRatioDb.toFixed(1)} dB
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                            Subterranean dielectric silt reflection
                          </span>
                        </div>

                        {/* 3. Micro-Topography */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 9, color: '#f97316', fontWeight: 700 }}>
                            Micro-Relief Depth (SLRM)
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                            {selectedAnomaly.evidence.microReliefDepthMeters > 0 ? '+' : ''}
                            {selectedAnomaly.evidence.microReliefDepthMeters.toFixed(2)}m
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                            Elevation anomaly above local grade
                          </span>
                        </div>

                        {/* 4. Orthogonal Agreement */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 9, color: '#fde68a', fontWeight: 700 }}>
                            Orthogonal Agreement
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#4ade80' }}>
                            {(selectedAnomaly.evidence.orthogonalityScore * 100).toFixed(0)}%
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                            Independent modality consensus
                          </span>
                        </div>
                      </div>

                      {/* Evidence Summary & Cultural Context */}
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        <strong>Physical Evidence: </strong>{selectedAnomaly.evidenceSummary}
                      </div>

                      {selectedAnomaly.culturalContext && (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                          <strong>Cultural Period: </strong>{selectedAnomaly.culturalContext}
                        </div>
                      )}
                    </div>
                  )}

                  {/* List of Other Anomalies in this scan */}
                  {scanResult.anomalies.length > 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)' }}>
                        All Discovered Features:
                      </span>
                      {scanResult.anomalies.map(a => {
                        const isSelected = selectedAnomaly?.id === a.id;
                        return (
                          <div
                            key={a.id}
                            onClick={() => {
                              setSelectedAnomaly(a);
                              if (effectiveViewer) flyToAnomaly(effectiveViewer, a);
                            }}
                            style={{
                              background: isSelected ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${isSelected ? '#f59e0b' : 'var(--border)'}`,
                              borderRadius: 6,
                              padding: '8px 10px',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span style={{ fontSize: 10, fontWeight: 700, color: isSelected ? '#fde68a' : 'var(--text)' }}>
                              {a.name}
                            </span>
                            <span style={{ fontSize: 9, color: a.confidenceScore >= 0.95 ? '#4ade80' : '#facc15' }}>
                              {(a.confidenceScore * 100).toFixed(1)}% Conf
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

          {/* TAB 4: Peer-Reviewed Benchmarks */}
          {activeTab === 'benchmarks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Five real-world archaeological discovery sites documented in peer-reviewed scientific literature
                (Nature, Science, Britannia, NASA JPL). Click any site to fly the 3D globe and retrieve real satellite telemetry.
              </div>

              {/* Validation Benchmark Trigger */}
              <button
                disabled={runningBenchmark}
                onClick={handleRunValidationBenchmark}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  border: 'none',
                  color: '#000',
                  fontWeight: 900,
                  fontSize: 11,
                  letterSpacing: 0.5,
                  cursor: runningBenchmark ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 16px rgba(34,197,94,0.35)',
                }}
              >
                {runningBenchmark ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                {runningBenchmark ? 'RUNNING SATELLITE BENCHMARK AUDIT...' : 'RUN BENCHMARK VALIDATION AUDIT (5 SITES)'}
              </button>

              {/* Audit Results Table */}
              {benchmarkAudit && (
                <div
                  style={{
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid rgba(34,197,94,0.4)',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileCheck2 size={15} color="#4ade80" />
                      Audit Score: {benchmarkAudit.benchmarkAccuracyPercentage}% Accuracy
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                      Avg Error: {benchmarkAudit.averageCentroidErrorMeters}m
                    </span>
                  </div>

                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                    Sources: {benchmarkAudit.scientificIntegrityCheck.dataSources}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 9 }}>
                    {benchmarkAudit.results.map(r => (
                      <div
                        key={r.siteId}
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span style={{ color: 'var(--text)' }}>{r.siteName}</span>
                          <span style={{ color: r.verificationStatus === 'VERIFIED' ? '#4ade80' : '#f87171' }}>
                            {r.verificationStatus} ({(r.predictedConfidenceScore * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-dim)' }}>
                          Error: {r.centroidErrorDistanceMeters}m · IoU: {(r.spatialIoU * 100).toFixed(0)}% · Elev:{' '}
                          {r.liveSensorsRetrieved.measuredElevationM ?? 'N/A'}m
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                          Live S2: {r.liveSensorsRetrieved.s2SceneId ? r.liveSensorsRetrieved.s2SceneId.slice(0, 36) + '...' : 'N/A'}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                          {r.evidenceCitation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* List of the 5 Sites */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {benchmarks.map(site => (
                  <div
                    key={site.id}
                    className="archaeology-benchmark-card"
                    data-site-id={site.id}
                    onClick={() => handleSelectBenchmark(site)}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#f59e0b';
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fde68a' }}>{site.name}</span>
                      <span
                        style={{
                          fontSize: 9,
                          color: '#38bdf8',
                          border: '1px solid rgba(56,189,248,0.4)',
                          padding: '1px 6px',
                          borderRadius: 12,
                          background: 'rgba(56,189,248,0.1)',
                        }}
                      >
                        {SITE_FLAGS[site.country] || ''} {site.country}
                      </span>
                    </div>

                    <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                      <strong>Citation:</strong> {site.citation.authors} ({site.citation.year}),{' '}
                      <em>{site.citation.journal}</em>
                    </div>

                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                      <strong>Modality:</strong> {site.primaryModality}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9 }}>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {site.referenceCoordinates.lat.toFixed(4)}°, {site.referenceCoordinates.lon.toFixed(4)}°
                      </span>
                      <span style={{ color: '#f59e0b', fontWeight: 700 }}>Fly & Prospect →</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
};
