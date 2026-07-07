/**
 * GPU Particle System for Fire, Smoke, and Volcanic Ash
 * 
 * Uses Cesium's built-in particle system for high-performance rendering.
 * All particles are rendered on GPU with minimal CPU overhead.
 */

import * as Cesium from 'cesium';

export interface ParticleConfig {
  /** Particle image (data URL or path) */
  image: string;
  /** Emission rate (particles per second) */
  emissionRate: number;
  /** Particle lifetime in seconds */
  lifetime: number;
  /** Minimum particle size */
  minSize: number;
  /** Maximum particle size */
  maxSize: number;
  /** Minimum speed (m/s) */
  minSpeed: number;
  /** Maximum speed (m/s) */
  maxSpeed: number;
  /** Minimum life (seconds) */
  minLife: number;
  /** Maximum life (seconds) */
  maxLife: number;
  /** Start color (RGBA 0-1) */
  startColor?: Cesium.Color;
  /** End color (RGBA 0-1) */
  endColor?: Cesium.Color;
  /** Gravity (m/s²) */
  gravity?: number;
  /** Emit from model or from position */
  emitFrom?: 'model' | 'point';
}

/**
 * Fire particle configuration
 */
export const FIRE_PARTICLES: ParticleConfig = {
  image: createFireParticleImage(),
  emissionRate: 100,
  lifetime: 2,
  minSize: 5,
  maxSize: 20,
  minSpeed: 2,
  maxSpeed: 8,
  minLife: 0.5,
  maxLife: 2,
  startColor: new Cesium.Color(1, 0.6, 0, 1),
  endColor: new Cesium.Color(1, 0.2, 0, 0),
  gravity: -5,
  emitFrom: 'point',
};

/**
 * Smoke particle configuration
 */
export const SMOKE_PARTICLES: ParticleConfig = {
  image: createSmokeParticleImage(),
  emissionRate: 50,
  lifetime: 5,
  minSize: 10,
  maxSize: 50,
  minSpeed: 1,
  maxSpeed: 5,
  minLife: 2,
  maxLife: 5,
  startColor: new Cesium.Color(0.3, 0.3, 0.3, 0.8),
  endColor: new Cesium.Color(0.5, 0.5, 0.5, 0),
  gravity: -1,
  emitFrom: 'point',
};

/**
 * Volcanic ash particle configuration
 */
export const ASH_PARTICLES: ParticleConfig = {
  image: createAshParticleImage(),
  emissionRate: 200,
  lifetime: 10,
  minSize: 2,
  maxSize: 8,
  minSpeed: 5,
  maxSpeed: 20,
  minLife: 5,
  maxLife: 15,
  startColor: new Cesium.Color(0.4, 0.35, 0.3, 1),
  endColor: new Cesium.Color(0.3, 0.25, 0.2, 0),
  gravity: -2,
  emitFrom: 'point',
};

/**
 * Lava particle configuration
 */
export const LAVA_PARTICLES: ParticleConfig = {
  image: createLavaParticleImage(),
  emissionRate: 30,
  lifetime: 3,
  minSize: 3,
  maxSize: 10,
  minSpeed: 1,
  maxSpeed: 4,
  minLife: 1,
  maxLife: 3,
  startColor: new Cesium.Color(1, 0.3, 0, 1),
  endColor: new Cesium.Color(0.8, 0.1, 0, 0),
  gravity: -8,
  emitFrom: 'point',
};

/**
 * Water splash configuration
 */
export const WATER_SPLASH_PARTICLES: ParticleConfig = {
  image: createWaterParticleImage(),
  emissionRate: 80,
  lifetime: 1,
  minSize: 2,
  maxSize: 6,
  minSpeed: 3,
  maxSpeed: 10,
  minLife: 0.3,
  maxLife: 1,
  startColor: new Cesium.Color(0.3, 0.7, 0.9, 1),
  endColor: new Cesium.Color(0.2, 0.5, 0.8, 0),
  gravity: -10,
  emitFrom: 'point',
};

/**
 * Create a fire particle image as data URL
 */
function createFireParticleImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  
  // Radial gradient for fire
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 200, 50, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 100, 0, 0.8)');
  gradient.addColorStop(1, 'rgba(200, 50, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  
  return canvas.toDataURL();
}

/**
 * Create a smoke particle image as data URL
 */
function createSmokeParticleImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  
  // Radial gradient for smoke
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(100, 100, 100, 0.8)');
  gradient.addColorStop(0.5, 'rgba(80, 80, 80, 0.4)');
  gradient.addColorStop(1, 'rgba(60, 60, 60, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  
  return canvas.toDataURL();
}

/**
 * Create an ash particle image as data URL
 */
function createAshParticleImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  
  // Simple circle for ash
  ctx.fillStyle = 'rgba(80, 70, 60, 1)';
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fill();
  
  return canvas.toDataURL();
}

/**
 * Create a lava particle image as data URL
 */
function createLavaParticleImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  
  // Hot glow gradient for lava
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 100, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 150, 0, 0.9)');
  gradient.addColorStop(0.7, 'rgba(200, 50, 0, 0.6)');
  gradient.addColorStop(1, 'rgba(100, 20, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  
  return canvas.toDataURL();
}

/**
 * Create a water particle image as data URL
 */
function createWaterParticleImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  
  // Soft circle for water
  const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  gradient.addColorStop(0, 'rgba(100, 180, 255, 1)');
  gradient.addColorStop(1, 'rgba(50, 120, 200, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 16);
  
  return canvas.toDataURL();
}

/**
 * Create a particle system at a position
 */
export function createParticleSystem(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian3,
  config: ParticleConfig,
): Cesium.ParticleSystem {
  const particleSystem = new Cesium.ParticleSystem({
    image: config.image,
    emissionRate: config.emissionRate,
    lifetime: config.lifetime,
    minimumParticleSize: config.minSize,
    maximumParticleSize: config.maxSize,
    minimumSpeed: config.minSpeed,
    maximumSpeed: config.maxSpeed,
    minimumLife: config.minLife,
    maximumLife: config.maxLife,
    startColor: config.startColor || Cesium.Color.WHITE,
    endColor: config.endColor || Cesium.Color.TRANSPARENT,
    gravity: config.gravity ? new Cesium.Cartesian3(0, 0, config.gravity) : undefined,
    position,
    updateCallback: (particle: Cesium.Particle) => {
      // Add some randomness to particle movement
      particle.velocity.x += (Math.random() - 0.5) * 0.1;
      particle.velocity.y += (Math.random() - 0.5) * 0.1;
    },
  });
  
  viewer.scene.primitives.add(particleSystem);
  return particleSystem;
}

/**
 * Create fire particles at a location
 */
export function createFireEffect(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  height: number = 0,
): Cesium.ParticleSystem {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return createParticleSystem(viewer, position, FIRE_PARTICLES);
}

/**
 * Create smoke plume at a location
 */
export function createSmokeEffect(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  height: number = 100,
): Cesium.ParticleSystem {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return createParticleSystem(viewer, position, SMOKE_PARTICLES);
}

/**
 * Create volcanic ash cloud
 */
export function createAshEffect(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  height: number = 5000,
): Cesium.ParticleSystem {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return createParticleSystem(viewer, position, ASH_PARTICLES);
}

/**
 * Create lava spatter
 */
export function createLavaEffect(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  height: number = 0,
): Cesium.ParticleSystem {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return createParticleSystem(viewer, position, LAVA_PARTICLES);
}

/**
 * Create water splash effect
 */
export function createWaterSplashEffect(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  height: number = 0,
): Cesium.ParticleSystem {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return createParticleSystem(viewer, position, WATER_SPLASH_PARTICLES);
}

/**
 * Remove particle system from scene
 */
export function removeParticleSystem(
  viewer: Cesium.Viewer,
  particleSystem: Cesium.ParticleSystem,
): void {
  viewer.scene.primitives.remove(particleSystem);
  particleSystem.destroy();
}
