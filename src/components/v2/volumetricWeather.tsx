import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import type * as Cesium from 'cesium';

interface WeatherDataPoint {
  lat?: number;
  lon?: number;
  intensity?: number;
  opacity?: number;
}

interface VolumetricWeatherProps {
  viewer: Cesium.Viewer;
  weatherData: WeatherDataPoint[];
  type: 'cloud' | 'smoke' | 'rain';
  visible?: boolean;
  opacity?: number;
  onToggle?: (visible: boolean) => void;
}

interface ParticleConfig {
  image: string;
  color: [number, number, number, number];
  size: number;
  speed: number;
  count: number;
  lifetime: number;
  emitterRadius: number;
}

const PARTICLE_CONFIGS: Record<string, ParticleConfig> = {
  cloud: {
    image: '/particles/cloud.png',
    color: [1, 1, 1, 0.4],
    size: 24,
    speed: 0.5,
    count: 200,
    lifetime: 60,
    emitterRadius: 2000,
  },
  smoke: {
    image: '/particles/smoke.png',
    color: [0.6, 0.6, 0.6, 0.6],
    size: 16,
    speed: 0.8,
    count: 300,
    lifetime: 30,
    emitterRadius: 1000,
  },
  rain: {
    image: '/particles/rain.png',
    color: [0.4, 0.6, 1, 0.8],
    size: 4,
    speed: 3,
    count: 5000,
    lifetime: 3,
    emitterRadius: 5000,
  },
};

const VolumetricWeather: React.FC<VolumetricWeatherProps> = ({
  viewer, weatherData, type, visible = true, opacity = 1, onToggle,
}) => {
  const systemRef = useRef<Cesium.ParticleSystem | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [particleCount, setParticleCount] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cesium = (window as any).Cesium as typeof Cesium | undefined;

  const config = useMemo(() => PARTICLE_CONFIGS[type], [type]);

  const _getShadersForType = useCallback((particleType: string): string => {
    switch (particleType) {
      case 'cloud':
        return 'vec2 cloudUV = gl_FragCoord.xy / vec2(512.0); float alpha = 1.0 - smoothstep(0.0, 0.8, length(cloudUV - 0.5));';
      case 'smoke':
        return 'vec2 smokeUV = gl_FragCoord.xy / vec2(256.0); float alpha = exp(-length(smokeUV - 0.5) * 3.0);';
      case 'rain':
        return 'vec2 rainUV = gl_FragCoord.xy / vec2(64.0); float alpha = 1.0 - abs(rainUV.x - 0.5) * 2.0;';
      default:
        return 'float alpha = 1.0;';
    }
  }, []);

  const _createParticleSystem = useCallback(() => {
    if (!viewer || !viewer.scene || !visible || !cesium) return;
    const emitter = new cesium.CircleEmitter(config.emitterRadius);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const particleSystem = new (cesium as any).ParticleSystem({
      image: config.image,
      color: new cesium.Color(...config.color),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size: new (cesium as any).ParticleSystemSize(config.size, config.size * 2),
      speed: config.speed,
      lifetime: config.lifetime,
      emitter,
      rate: config.count / config.lifetime,
      minimumParticleLife: config.lifetime * 0.5,
      maximumParticleLife: config.lifetime,
      startScale: 1,
      endScale: 0.1,
    });
    viewer.scene.primitives.add(particleSystem);
    systemRef.current = particleSystem;
    setParticleCount(config.count);
    setIsReady(true);

    if (weatherData.length > 0) {
      const location = weatherData[0];
      const cartesian = cesium.Cartesian3.fromDegrees(location.lon || 0, location.lat || 0, 500);
      particleSystem.modelMatrix = cesium.Transforms.eastNorthUpToFixedFrame(cartesian);
    }
    return particleSystem;
  }, [viewer, weatherData, visible, config, cesium]);

  useEffect(() => {
    const ps = systemRef.current;
    if (!ps) return;

    const updateParticles = () => {
      if (!weatherData.length) return;
      const latest = weatherData[weatherData.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ps as any).rate = (latest.intensity || 1) * (config.count / config.lifetime);
      const c = cesium!.Color.fromBytes(
        Math.floor(255 * config.color[0]),
        Math.floor(255 * config.color[1]),
        Math.floor(255 * config.color[2]),
        Math.floor(255 * Math.min(1, (latest.opacity ?? config.color[3]))),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ps as any).color = c;
    };

    const interval = setInterval(updateParticles, 2000);
    updateParticles();

    return () => {
      clearInterval(interval);
    };
  }, [weatherData, config, cesium]);

  if (!visible) return null;

  return (
    <div className="volumetric-weather-panel">
      <div className="volumetric-weather-indicator">
        <span className="weather-dot" style={{ background: isReady ? '#22c55e' : '#f59e0b' }} />
        <span className="weather-type">{type}</span>
        <span className="weather-count">{weatherData.length} zones · {particleCount} particles</span>
        <button className="weather-toggle" onClick={() => onToggle?.(false)} title="Hide weather layer">✕</button>
      </div>
      <div className="weather-controls">
        <label className="weather-label">
          <span>Opacity</span>
          <span className="weather-val">{Math.round(opacity * 100)}%</span>
        </label>
        <input type="range" min={0} max={1} step={0.1} value={opacity} readOnly className="weather-slider" />
      </div>
      {weatherData.length > 0 && (
        <div className="weather-data-list">
          {weatherData.slice(0, 3).map((w, i) => (
            <div key={i} className="weather-data-item">
              <span className="wd-location">{w.lat?.toFixed(1)}, {w.lon?.toFixed(1)}</span>
              <span className="wd-intensity">{(w.intensity || 1).toFixed(1)}</span>
            </div>
          ))}
          {weatherData.length > 3 && (
            <div className="weather-more">+{weatherData.length - 3} more zones</div>
          )}
        </div>
      )}
      <style>{`
        .volumetric-weather-panel { position: absolute; top: 60px; right: 10px; z-index: 110; }
        .volumetric-weather-indicator { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 8px; font-size: 11px; color: #94a3b8; backdrop-filter: blur(8px); }
        .weather-dot { width: 6px; height: 6px; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .weather-type { font-weight: 600; color: #e2e8f0; text-transform: uppercase; }
        .weather-count { font-size: 10px; color: #64748b; }
        .weather-toggle { background: none; border: none; color: #64748b; cursor: pointer; font-size: 12px; padding: 0 2px; }
        .weather-toggle:hover { color: #ef4444; }
        .weather-controls { margin-top: 4px; padding: 8px 12px; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 8px; }
        .weather-label { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #64748b; margin-bottom: 4px; }
        .weather-val { color: #e2e8f0; font-weight: 600; }
        .weather-slider { width: 100%; height: 4px; -webkit-appearance: none; background: #334155; border-radius: 2px; outline: none; }
        .weather-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #3b82f6; cursor: pointer; }
        .weather-data-list { margin-top: 4px; padding: 6px 12px; background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 8px; }
        .weather-data-item { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; color: #94a3b8; }
        .wd-intensity { color: #3b82f6; font-weight: 600; }
        .weather-more { font-size: 10px; color: #64748b; text-align: center; padding: 2px 0; }
      `}</style>
    </div>
  );
};

export default VolumetricWeather;
