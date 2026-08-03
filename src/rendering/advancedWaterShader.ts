/**
 * Advanced Water Shader System
 * 
 * High-performance GPU shaders for realistic water rendering:
 * - Ocean waves with proper wave spectrum
 * - Flood inundation with terrain following
 * - Tsunami wave propagation
 * - Foam and spray effects
 * 
 * All rendering happens on GPU for optimal performance.
 */

import * as Cesium from 'cesium';

/**
 * Advanced ocean wave shader with Gerstner waves
 * Based on Tessendorf (2001) - "Simulating Ocean Water"
 */
export const OCEAN_WAVE_SHADER = `
  uniform float time;
  uniform float waveHeight;
  uniform float waveSpeed;
  uniform float choppy;
  uniform float foamThreshold;
  
  // Gerstner wave function
  vec3 gerstnerWave(vec2 pos, float amplitude, vec2 direction, float steepness, float speed, float time) {
    float k = 2.0 * 3.14159 / 10.0; // wavelength = 10m
    float c = speed / k;
    float f = k * (dot(direction, pos) - c * time);
    float a = amplitude / k;
    
    return vec3(
      steepness * a * direction.x * cos(f),
      steepness * a * direction.y * cos(f),
      a * sin(f)
    );
  }
  
  // Simple noise for foam
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
  
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec3 pos = -materialInput.positionToEyeEC;
    
    // Multiple Gerstner waves for realistic ocean
    vec3 wave1 = gerstnerWave(pos.xz, waveHeight * 1.0, vec2(1.0, 0.0), choppy, waveSpeed, time);
    vec3 wave2 = gerstnerWave(pos.xz, waveHeight * 0.5, vec2(0.7, 0.7), choppy * 0.8, waveSpeed * 0.8, time * 1.2);
    vec3 wave3 = gerstnerWave(pos.xz, waveHeight * 0.3, vec2(-0.3, 0.9), choppy * 0.6, waveSpeed * 0.6, time * 0.9);
    
    vec3 wavePos = pos + wave1 + wave2 + wave3;
    
    // Compute normal from wave gradient
    float dx = waveHeight * (cos(wavePos.x * 0.5 + time) * 0.5 + cos(wavePos.x * 1.3 + time * 1.2) * 0.25);
    float dz = waveHeight * (cos(wavePos.z * 0.7 + time * 0.8) * 0.5 + cos(wavePos.z * 1.1 + time * 0.9) * 0.25);
    vec3 normal = normalize(vec3(-dx, 1.0, -dz));
    
    // Water colors
    vec3 shallowColor = vec3(0.1, 0.6, 0.8);
    vec3 deepColor = vec3(0.02, 0.1, 0.3);
    vec3 foamColor = vec3(0.9, 0.95, 1.0);
    
    // Depth-based coloring (simulate with height)
    float depthFactor = smoothstep(-1.0, 2.0, wavePos.y);
    vec3 waterColor = mix(deepColor, shallowColor, depthFactor);
    
    // Foam on wave crests
    float foamNoise = noise(st * 20.0 + time * 0.5);
    float foam = smoothstep(foamThreshold, foamThreshold + 0.2, wavePos.y + foamNoise * 0.3);
    waterColor = mix(waterColor, foamColor, foam * 0.7);
    
    // Specular highlight (sun reflection)
    vec3 lightDir = normalize(czm_sunDirectionEC);
    vec3 viewDir = normalize(materialInput.positionToEyeEC);
    vec3 halfDir = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfDir), 0.0), 128.0);
    
    // Fresnel effect (more reflective at grazing angles)
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
    vec3 skyColor = vec3(0.4, 0.6, 0.9);
    waterColor = mix(waterColor, skyColor, fresnel * 0.5);
    
    // Final color
    vec3 finalColor = waterColor + specular * vec3(1.0, 0.95, 0.8) * 0.6;
    
    material.diffuse = finalColor;
    material.alpha = 0.85;
    material.specular = 0.5 + specular * 0.3;
    material.shininess = 100.0;
    
    return material;
  }
`;

/**
 * Tsunami wave shader with directional propagation
 */
export const TSUNAMI_WAVE_SHADER = `
  uniform float time;
  uniform float waveHeight;
  uniform vec2 epicenter;
  uniform float waveSpeed;
  uniform float directivity;
  
  // Wave propagation from epicenter
  float waveAmplitude(vec2 pos, vec2 epicenter, float time, float speed) {
    float dist = length(pos - epicenter);
    float waveRadius = time * speed;
    
    // Primary wave crest
    float primaryWave = exp(-pow(dist - waveRadius, 2.0) * 0.1) * waveHeight;
    
    // Secondary crests (dispersion)
    float secondaryWave = exp(-pow(dist - waveRadius * 0.8, 2.0) * 0.15) * waveHeight * 0.5;
    float tertiaryWave = exp(-pow(dist - waveRadius * 0.6, 2.0) * 0.2) * waveHeight * 0.3;
    
    return primaryWave + secondaryWave + tertiaryWave;
  }
  
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec3 pos = -materialInput.positionToEyeEC;
    
    // Compute wave height at this point
    float height = waveAmplitude(pos.xz, epicenter, time, waveSpeed);
    
    // Directional bias (perpendicular to fault)
    float angle = atan(pos.z - epicenter.y, pos.x - epicenter.x);
    float dirFactor = 0.5 + 0.5 * cos(angle - directivity);
    height *= dirFactor;
    
    // Water colors
    vec3 shallowColor = vec3(0.1, 0.7, 0.9);
    vec3 deepColor = vec3(0.02, 0.15, 0.4);
    vec3 foamColor = vec3(0.95, 0.98, 1.0);
    
    // Height-based coloring
    float normalizedHeight = clamp(height / waveHeight, 0.0, 1.0);
    vec3 waterColor = mix(deepColor, shallowColor, normalizedHeight);
    
    // Foam on wave crests
    float foam = smoothstep(0.6, 0.9, normalizedHeight);
    waterColor = mix(waterColor, foamColor, foam * 0.8);
    
    // Specular
    vec3 lightDir = normalize(czm_sunDirectionEC);
    vec3 normal = normalize(vec3(0.0, 1.0, 0.0));
    vec3 viewDir = normalize(materialInput.positionToEyeEC);
    vec3 halfDir = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfDir), 0.0), 64.0);
    
    vec3 finalColor = waterColor + specular * vec3(1.0, 0.95, 0.8) * 0.5;
    
    material.diffuse = finalColor;
    material.alpha = 0.8 + normalizedHeight * 0.15;
    material.specular = 0.4 + specular * 0.2;
    material.shininess = 80.0;
    
    return material;
  }
`;

/**
 * Flood inundation shader with terrain following
 */
export const FLOOD_SHADER = `
  uniform float time;
  uniform float waterLevel;
  uniform float flowSpeed;
  
  // Simple noise for water surface variation
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
  
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec3 pos = -materialInput.positionToEyeEC;
    
    // Flowing water effect
    float flow = noise(st * 10.0 + time * flowSpeed) * 0.5 +
                 noise(st * 20.0 - time * flowSpeed * 0.7) * 0.3 +
                 noise(st * 5.0 + time * flowSpeed * 1.3) * 0.2;
    
    // Water colors (murky flood water)
    vec3 shallowColor = vec3(0.3, 0.5, 0.4);
    vec3 deepColor = vec3(0.1, 0.2, 0.15);
    vec3 sedimentColor = vec3(0.4, 0.35, 0.25);
    
    // Mix based on flow and depth
    vec3 waterColor = mix(deepColor, shallowColor, flow);
    waterColor = mix(waterColor, sedimentColor, 0.3); // sediment
    
    // Subtle wave pattern
    float waves = sin(pos.x * 2.0 + time * 2.0) * sin(pos.z * 2.0 + time * 1.5) * 0.1;
    waterColor += waves * 0.05;
    
    // Specular (wet surface)
    vec3 lightDir = normalize(czm_sunDirectionEC);
    vec3 normal = normalize(vec3(waves * 0.5, 1.0, waves * 0.5));
    vec3 viewDir = normalize(materialInput.positionToEyeEC);
    vec3 halfDir = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfDir), 0.0), 32.0);
    
    vec3 finalColor = waterColor + specular * vec3(0.8, 0.85, 0.9) * 0.3;
    
    material.diffuse = finalColor;
    material.alpha = 0.75;
    material.specular = 0.3 + specular * 0.2;
    material.shininess = 40.0;
    
    return material;
  }
`;

/**
 * Create ocean wave material
 */

/**
 * Create tsunami wave material
 */

/**
 * Create flood water material
 */
export function createFloodMaterial(
  waterLevel: number = 1.0,
  flowSpeed: number = 0.5,
): Cesium.Material {
  return new Cesium.Material({
    fabric: {
      type: 'FloodWater',
      uniforms: {
        time: 0.0,
        waterLevel,
        flowSpeed,
      },
      source: FLOOD_SHADER,
    },
  });
}

/**
 * Animate water material (call in render loop)
 */
export function animateWaterMaterial(
  material: Cesium.Material,
  deltaTime: number,
): void {
  if (material.uniforms.time !== undefined) {
    material.uniforms.time += deltaTime;
  }
}
