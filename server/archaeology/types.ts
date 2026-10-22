/**
 * Space Archaeology & Automated Earth Discovery Types
 * Standardized interfaces for multi-sensor prospection,
 * orthogonal consensus detection, and peer-reviewed validation.
 */

export interface StudyAreaBoundingBox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export type BiomeType =
  | 'arid_desert'          // Radar sand penetration, paleochannel extraction
  | 'agricultural_plain'   // Multispectral crop-mark stress (NDVI, NDRE)
  | 'jungle_canopy'        // Dense vegetation canopy limits
  | 'steppe_grassland'     // Kurgan / mound circularity, shadow relief
  | 'alluvial_floodplain'  // Soil mark contrast, buried mudbrick masonry
  | 'tropical_coastal';    // High-vegetation coastal/monsoon plain

export type AnomalyCategory =
  | 'linear_foundation'     // Buried stone walls, Roman roads, canal banks
  | 'enclosure_ditch'       // Ring ditches, hillfort ramparts, barrows
  | 'paleochannel_segment'  // Extinct riverbed, harbor inlet, oasis branch
  | 'settlement_mound'      // Tell mound, earthen platform, pyramid base
  | 'caravan_waypoint';     // Ancient desert track nexus, caravanserai

export interface MultiModalEvidence {
  spectralContrastDelta: number;     // ΔNDRE or local Z-score against background (-1.0 to +1.0)
  microReliefDepthMeters: number;    // Simple Local Relief Model (SLRM) residual in meters (-5.0m to +15.0m)
  radarBackscatterRatioDb: number;   // Measured Sentinel-1 VH/VV cross-polarization ratio in dB
  circularityScore: number;          // Isoperimetric quotient: 4π*Area / Perimeter^2 (0.0 to 1.0)
  orthogonalityScore: number;        // PCA elongation / orientation score (0.0 to 1.0)
  paleoWaterDistanceMeters: number;  // Geodesic distance to nearest watercourse/paleochannel
  slopeGradientDegrees: number;      // Horn 3x3 local terrain slope in degrees
  multiTemporalDeltaNdre?: number;   // Dual-date phenological differential stress (ΔNDRE across dates)
  measuredSarVhDb?: number;          // Measured calibrated Sentinel-1 RTC VH backscatter in dB
  measuredSarVvDb?: number;          // Measured calibrated Sentinel-1 RTC VV backscatter in dB
  ndreLocalZScore?: number;          // Standardized spatial Z-score
  slrmLocalZScore?: number;          // Standardized micro-relief Z-score
}

export interface ArchaeologicalAnomaly {
  id: string;
  category: AnomalyCategory;
  name: string;
  confidenceScore: number;           // 0.0 to 1.0
  centroid: {
    lat: number;
    lon: number;
    elevationMeters: number;
  };
  boundingBox: StudyAreaBoundingBox;
  polygonCoordinates: Array<[number, number]>; // [lon, lat] pairs for GeoJSON polygon
  areaM2: number;
  perimeterMeters: number;
  estimatedAgeRange?: string;
  culturalContext?: string;
  evidence: MultiModalEvidence;
  evidenceSummary: string;
  detectionTimestamp: number;
  blindIoU?: number;                 // True spatial Intersection over Union against ground-truth
  centroidDisplacementMeters?: number; // True geodesic distance error
}

export interface LiveSensorAcquisition {
  sentinel2: {
    sceneId: string;
    acquisitionDate: string;
    cloudCoverPercent: number;
    platform: string;
    bandsProcessed: string[];
    pixelStatistics?: {
      validPixelsAnalyzed: number;
      b04RedMean: number;
      b04RedStdDev: number;
      b05RedEdgeMean: number;
      b05RedEdgeStdDev: number;
      b08NirMean: number;
      b08NirStdDev: number;
      b11SwirMean: number;
      b11SwirStdDev: number;
      computedNdre: number;
      computedNdvi: number;
      computedNdmi: number;
      computedNdbi: number;
    };
    multiTemporal?: {
      isMultiTemporal: boolean;
      stressDate: string;             // Stressed / peak dry date (YYYY-MM-DD)
      baselineDate: string;           // Moist / spring baseline date (YYYY-MM-DD)
      daysSeparation: number;         // Days elapsed between the two scenes
      stressSceneId: string;
      baselineSceneId: string;
      stressNdre: number;
      baselineNdre: number;
      deltaNdre: number;              // ΔNDRE differential
      deltaNdvi: number;              // ΔNDVI differential
      deltaNdmi: number;              // ΔNDMI moisture differential
      contrastAmplificationRatio: number; // Factor enhancement e.g. 1.85x
    };
  } | null;
  sentinel1: {
    sceneId: string;
    acquisitionDate: string;
    platform: string;
    polarizations: string[];
    mode: string;
    measuredVhMeanDb?: number;        // Real measured mean VH backscatter in dB
    measuredVvMeanDb?: number;        // Real measured mean VV backscatter in dB
    measuredCrossPolRatioDb?: number; // Real measured cross-pol ratio (VH - VV) in dB
  } | null;
  dem: {
    dataset: string;
    minElevationM: number;
    maxElevationM: number;
    meanElevationM: number;
    slopeDegrees: number;
    elevationStdDevM: number;
    pointsSampled: number;
    elevationGrid?: number[];
    gridRows?: number;
    gridCols?: number;
    slrmGrid?: number[];             // Simple Local Relief Model residuals
  } | null;
  soil?: {
    clayPercent: number;
    sandPercent: number;
    siltPercent: number;
    textureClass: string;
  } | null;
  landCover?: {
    dataset: string;
    builtUpPercent: number;
    croplandPercent: number;
    treeCoverPercent: number;
    grasslandPercent: number;
    waterPercent: number;
    barePercent: number;
    isUrbanFabric: boolean;
  } | null;
}

export interface CadastralHeritageSite {
  id: string;
  name: string;
  category: 'standing_monument' | 'historic_complex' | 'archaeological_ruins' | 'world_heritage_site';
  historicType: string;
  periodOrEpoch?: string;
  heritageDesignation?: string;
  coordinates: {
    lat: number;
    lon: number;
    elevationMeters?: number;
  };
  boundingBox?: StudyAreaBoundingBox;
  polygonCoordinates?: Array<[number, number]>;
  source: string;
  architecturalContext?: string;
  isAboveGroundStanding: boolean;
}

export interface SpatialGridPoint {
  lat: number;
  lon: number;
  value: number;       // 0.0 to 1.0 (empirical consensus anomaly score)
  confidence: number;  // 0.0 to 1.0 (certainty based on cloud cover & sensor signal-to-noise ratio)
  opticalDelta: number;
  radarDb: number;
  slopeDegrees: number;
}

export interface ScanOptions {
  maxCloudCoverPercent?: number;
  seasonWindow?: 'clearest_auto' | 'dry_season' | 'latest' | 'multi_temporal_diff' | 'historical_archive';
  startDate?: string;
  endDate?: string;
}

export type ScanStatus =
  | 'ANOMALY_CONFIRMED'
  | 'STANDING_HERITAGE_VERIFIED'
  | 'NO_ANOMALY_DETECTED'
  | 'INSUFFICIENT_DATA'
  | 'AREA_EXCEEDS_LIMIT';

export interface ArchaeologyScanResult {
  scanId: string;
  studyArea: StudyAreaBoundingBox;
  studyAreaKm2: number;
  biome: BiomeType;
  timestamp: number;
  status: ScanStatus;
  statusMessage: string;
  anomalies: ArchaeologicalAnomaly[];
  cadastralHeritage?: CadastralHeritageSite[];
  liveSensors: LiveSensorAcquisition;
  overallConfidence: number;
  highConfidenceCount: number;
  insufficientDataWarning?: string;
  spatialGrid?: {
    points: SpatialGridPoint[];
    gridWidth: number;
    gridHeight: number;
    cloudThresholdUsed: number;
    dateUsed?: string;
  };
}

export interface PeerReviewedReferenceSite {
  id: string;
  name: string;
  country: string;
  biome: BiomeType;
  referenceCoordinates: {
    lat: number;
    lon: number;
    elevationMeters: number;
  };
  referenceBoundingBox: StudyAreaBoundingBox;
  expectedCategory: AnomalyCategory;
  citation: {
    authors: string;
    title: string;
    journal: string;
    year: number;
    volumeOrDoi: string;
  };
  primaryModality: string;
  historicalSignificance: string;
  documentedSurveyBounds: Array<[number, number]>;
}

export interface ValidationMetricResult {
  siteId: string;
  siteName: string;
  documentedCoordinates: { lat: number; lon: number };
  predictedCoordinates: { lat: number; lon: number };
  centroidErrorDistanceMeters: number;
  spatialIoU: number;
  predictedConfidenceScore: number;
  meetsConfidenceThreshold: boolean;
  meetsSpatialPrecisionThreshold: boolean;
  verificationStatus: 'VERIFIED' | 'DISCREPANCY' | 'FAILED';
  verificationMethod: string;
  evidenceCitation: string;
  liveSensorsRetrieved: {
    s2SceneId?: string;
    s1SceneId?: string;
    measuredElevationM?: number;
  };
}

export interface BenchmarkAuditReport {
  timestamp: number;
  totalSitesEvaluated: number;
  negativeControlsEvaluated?: number;
  verifiedCount: number;
  benchmarkAccuracyPercentage: number;
  averageCentroidErrorMeters: number;
  averageConfidenceScore: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  sensitivity: number;
  specificity: number;
  precision?: number;
  f1Score?: number;
  results: ValidationMetricResult[];
  scientificIntegrityCheck: {
    dataSources: string;
    noSyntheticFallbacks: boolean;
    reproduciblePipeline: boolean;
    groundTruthIndependent: boolean;
    minimumAccuracyMet: boolean;
  };
}
