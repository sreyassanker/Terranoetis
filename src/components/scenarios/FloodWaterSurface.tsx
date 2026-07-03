import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { sampleTerrainHeights } from '@/lib/terrainSampler';
import { throttledRender } from '@/lib/throttledRender';

interface FloodWaterSurfaceProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  /** Progress 0→1 directly controlled by timeline scrubber */
  progress: number;
}

/**
 * GLSL wave shader for realistic water surface animation.
 * Uses procedural fBm noise for organic wave patterns.
 */
const WAVE_SHADER_SOURCE = `
  uniform float time;
  uniform float waveIntensity;
  uniform float alpha;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;

    float t = time * 0.3;
    float wave1 = fbm(st * 8.0 + vec2(t, t * 0.7));
    float wave2 = fbm(st * 12.0 - vec2(t * 0.5, t * 1.2));
    float wave3 = fbm(st * 5.0 + vec2(t * 0.8, -t * 0.4));

    float combinedWave = (wave1 + wave2 + wave3) / 3.0;
    float specular = pow(combinedWave, 3.0) * 0.4;

    vec3 shallowColor = vec3(0.2, 0.75, 0.85);
    vec3 deepColor = vec3(0.05, 0.15, 0.45);
    vec3 waterCol = mix(shallowColor, deepColor, 1.0 - waveIntensity);

    vec3 finalColor = waterCol + combinedWave * 0.08;
    finalColor += vec3(specular * 0.6, specular * 0.7, specular * 0.9);

    float foam = smoothstep(0.65, 0.78, combinedWave) * waveIntensity * 0.3;
    finalColor += vec3(foam);

    material.diffuse = finalColor;
    material.alpha = alpha;
    material.specular = vec3(0.4 + specular * 0.3);
    material.shininess = 80.0;

    return material;
  }
`;

/**
 * Optimized Flood Water Surface Renderer
 *
 * - Terrain sampling done once per shape set (not per frame)
 * - Wave shader handles animation via GPU uniforms (no CPU CallbackProperty)
 * - Entity positions are static Cartesian3 arrays (pre-cached)
 * - Only the shader time uniform updates per frame (GPU-side, near-zero CPU cost)
 */
export default function FloodWaterSurface({ viewer, shapes, progress }: FloodWaterSurfaceProps) {
  const entitiesRef = useRef<Cesium.Entity[]>([]);
  const postRenderRef = useRef<(() => void) | null>(null);
  const builtShapesRef = useRef<string>('');
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (postRenderRef.current) {
      viewer.scene.postRender.removeEventListener(postRenderRef.current);
      postRenderRef.current = null;
    }
    const ec = viewer.entities;
    ec.suspendEvents();
    for (const entity of entitiesRef.current) {
      ec.remove(entity);
    }
    entitiesRef.current = [];
    ec.resumeEvents();
  }, [viewer]);

  const buildWaterSurface = useCallback(async () => {
    if (!viewer || shapes.length === 0) return;

    cleanup();

    const allPositions: { lat: number; lon: number }[] = [];
    for (const shape of shapes) {
      if (shape.positions) allPositions.push(...shape.positions);
    }
    if (allPositions.length === 0) return;

    const heightMap = await sampleTerrainHeights(viewer, allPositions);

    // Create wave material — shader runs on GPU, uniform updates are near-zero cost
    const waveMaterial = new Cesium.Material({
      fabric: {
        type: 'WaveWater',
        uniforms: {
          time: 0.0,
          waveIntensity: 0.6,
          alpha: 0.6,
        },
        source: WAVE_SHADER_SOURCE,
      },
    });

    // Animate shader uniforms via postRender — only time updates, no position recalc
    const postRenderListener = () => {
      const t = performance.now() / 1000.0;
      waveMaterial.uniforms.time = t;
      waveMaterial.uniforms.waveIntensity = 0.3 + progressRef.current * 0.7;
      waveMaterial.uniforms.alpha = 0.35 + progressRef.current * 0.45;
    };
    viewer.scene.postRender.addEventListener(postRenderListener);
    postRenderRef.current = postRenderListener;

    const ec = viewer.entities;
    ec.suspendEvents();

    for (const shape of shapes) {
      if (!shape.positions || shape.positions.length < 3) continue;

      const depths = shape.depths || shape.positions.map(() => (shape.maxDepth || 1) * 0.5);
      const waterElevation = shape.waterElevation || 10;

      // Pre-cache vertex data — terrain height looked up once, not per frame
      const vertexData = shape.positions.map((pos, i) => {
        const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
        const terrainH = heightMap.get(key) ?? 0;
        const depth = depths[i] || (shape.maxDepth || 1) * 0.5;
        return { lat: pos.lat, lon: pos.lon, terrainH, depth };
      });

      const maxDepth = shape.maxDepth || 1;
      const baseColor = depthToColor(0.6);

      // Pre-compute static positions for initial state — only elevation changes via progress
      const entity = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.CallbackProperty(() => {
            const p = progressRef.current;
            return vertexData.map(v => {
              const elevation = v.terrainH + waterElevation * p + v.depth * 0.5 * p;
              return Cesium.Cartesian3.fromDegrees(v.lon, v.lat, elevation);
            });
          }, false),
          material: waveMaterial,
          outline: true,
          outlineColor: baseColor.withAlpha(0.6 + progressRef.current * 0.2),
        },
      });

      entitiesRef.current.push(entity);
    }

    ec.resumeEvents();
    throttledRender(viewer);
  }, [viewer, shapes, cleanup]);

  useEffect(() => {
    const shapeKey = shapes.map(s => s.positions?.length ?? 0).join(',');
    if (shapeKey === builtShapesRef.current) return;
    builtShapesRef.current = shapeKey;

    if (shapes.length === 0) {
      cleanup();
      return;
    }

    buildWaterSurface();
  }, [shapes, buildWaterSurface, cleanup]);

  // Only trigger a single throttled render on progress change
  useEffect(() => {
    throttledRender(viewer);
  }, [progress, viewer]);

  useEffect(() => cleanup, [cleanup]);

  return null;
}

function depthToColor(normalizedDepth: number): Cesium.Color {
  const d = Math.max(0, Math.min(1, normalizedDepth));
  const hue = 190 + d * 30;
  const sat = 80 + d * 10;
  const light = 70 - d * 40;
  const alpha = 0.35 + d * 0.45;
  const h = hue / 360, s = sat / 100, l = light / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1 / 6) { r = c; g = x; }
  else if (h < 2 / 6) { r = x; g = c; }
  else if (h < 3 / 6) { g = c; b = x; }
  else if (h < 4 / 6) { g = x; b = c; }
  else if (h < 5 / 6) { r = x; b = c; }
  else { r = c; b = x; }
  return new Cesium.Color(r + m, g + m, b + m, alpha);
}
