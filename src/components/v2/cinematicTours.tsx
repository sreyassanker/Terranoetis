import React, { useState, useCallback, useEffect, useRef } from 'react';

type TourType = 'orbit' | 'dolly' | 'flyover';

interface Tour {
  id: string;
  name: string;
  type: TourType;
  target: [number, number];
  duration: number;
  narration: string;
  createdAt: Date;
}

interface CinematicToursProps {
  viewer: any;
  target?: [number, number];
  type?: TourType;
  onRecord?: (blob: Blob) => void;
}

const TOUR_TYPES: TourType[] = ['orbit', 'dolly', 'flyover'];

const TOUR_DEFAULTS: Record<TourType, { duration: number; height: number; pitch: number }> = {
  orbit: { duration: 10, height: 2000, pitch: -30 },
  dolly: { duration: 8, height: 500, pitch: -15 },
  flyover: { duration: 15, height: 5000, pitch: -45 },
};

const NarrationScripts: Record<TourType, (target: [number, number]) => string> = {
  orbit: (t) => `Orbiting around ${t[0].toFixed(2)}°N, ${t[1].toFixed(2)}°E. Observing the terrain from all angles.`,
  dolly: (t) => `Approaching ${t[0].toFixed(2)}°N, ${t[1].toFixed(2)}°E. Closing in for a detailed view.`,
  flyover: (t) => `Flying over ${t[0].toFixed(2)}°N, ${t[1].toFixed(2)}°E. A sweeping panoramic survey of the region.`,
};

const CinematicTours: React.FC<CinematicToursProps> = ({
  viewer, target: propTarget, type: propType, onRecord,
}) => {
  const [target, setTarget] = useState<[number, number]>(propTarget || [35.6762, 139.6503]);
  const [tourType, setTourType] = useState<TourType>(propType || 'orbit');
  const [isPlaying, setIsPlaying] = useState(false);
  const [narration, setNarration] = useState('');
  const [tours, setTours] = useState<Tour[]>([]);
  const [tourName, setTourName] = useState('');
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const cesium = (window as any).Cesium;

  useEffect(() => {
    if (propTarget) setTarget(propTarget);
  }, [propTarget]);

  useEffect(() => {
    if (propType) setTourType(propType);
  }, [propType]);

  const playTour = useCallback(async () => {
    if (!viewer || !cesium) return;
    setIsPlaying(true);
    const config = TOUR_DEFAULTS[tourType];
    const destination = cesium.Cartesian3.fromDegrees(target[1], target[0], config.height);
    const orientation = {
      heading: cesium.Math.toRadians(0),
      pitch: cesium.Math.toRadians(config.pitch),
      roll: 0,
    };

    if (tourType === 'orbit') {
      viewer.camera.flyTo({
        destination,
        orientation,
        duration: config.duration,
        complete: () => {
          let heading = 0;
          const orbitInterval = setInterval(() => {
            heading += 0.5;
            viewer.camera.setView({
              orientation: { heading: cesium.Math.toRadians(heading), pitch: cesium.Math.toRadians(config.pitch), roll: 0 },
            });
            if (!isPlaying) clearInterval(orbitInterval);
          }, 50);
          setTimeout(() => clearInterval(orbitInterval), config.duration * 1000);
        },
      });
    } else {
      viewer.camera.flyTo({ destination, orientation, duration: config.duration });
    }

    const script = NarrationScripts[tourType](target);
    setNarration(script);
    if ('speechSynthesis' in window) {
      speechRef.current = new SpeechSynthesisUtterance(script);
      speechRef.current.rate = 0.9;
      window.speechSynthesis.speak(speechRef.current);
    }

    setTimeout(() => {
      setIsPlaying(false);
      setNarration('');
    }, config.duration * 1000);
  }, [viewer, target, tourType, isPlaying, cesium]);

  const stopTour = useCallback(() => {
    setIsPlaying(false);
    if (speechRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setNarration('');
  }, []);

  const saveTour = useCallback(() => {
    const tour: Tour = {
      id: `tour_${Date.now()}`,
      name: tourName || `Tour ${tours.length + 1}`,
      type: tourType,
      target,
      duration: TOUR_DEFAULTS[tourType].duration,
      narration: NarrationScripts[tourType](target),
      createdAt: new Date(),
    };
    setTours(prev => [...prev, tour]);
    setTourName('');
  }, [tourName, tourType, target, tours.length]);

  const loadTour = useCallback((tour: Tour) => {
    setTourType(tour.type);
    setTarget(tour.target as [number, number]);
    setNarration(tour.narration);
  }, []);

  return (
    <div className="cinematic-tours">
      <div className="tour-panel">
        <h3 className="tour-title">Cinematic Tours</h3>
        <div className="tour-controls">
          <div className="tour-row">
            <label>Type</label>
            <div className="tour-type-select">
              {TOUR_TYPES.map(t => (
                <button key={t} className={`type-btn ${tourType === t ? 'active' : ''}`} onClick={() => setTourType(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="tour-row">
            <label>Target</label>
            <div className="tour-coords">
              <input type="number" value={target[0]} onChange={e => setTarget([+e.target.value, target[1]])} step={0.01} placeholder="Lat" />
              <input type="number" value={target[1]} onChange={e => setTarget([target[0], +e.target.value])} step={0.01} placeholder="Lon" />
            </div>
          </div>
          <div className="tour-actions">
            <button className="tour-btn play-btn" onClick={playTour} disabled={isPlaying}>▶ Play</button>
            <button className="tour-btn stop-btn" onClick={stopTour} disabled={!isPlaying}>■ Stop</button>
          </div>
          {narration && <div className="tour-narration">{narration}</div>}
        </div>

        <div className="tour-library">
          <h4>Tour Library</h4>
          <div className="tour-save-row">
            <input value={tourName} onChange={e => setTourName(e.target.value)} placeholder="Tour name..." className="tour-name-input" />
            <button className="tour-btn save-btn" onClick={saveTour} disabled={!tourName}>Save</button>
          </div>
          {tours.map(tour => (
            <div key={tour.id} className="tour-item" onClick={() => loadTour(tour)}>
              <span className="tour-item-name">{tour.name}</span>
              <span className="tour-item-type">{tour.type}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .cinematic-tours { position: absolute; top: 16px; left: 16px; width: 280px; z-index: 100; }
        .tour-panel { background: rgba(15, 23, 42, 0.9); border: 1px solid #334155; border-radius: 12px; padding: 16px; backdrop-filter: blur(12px); }
        .tour-title { color: #e2e8f0; font-size: 14px; font-weight: 600; margin: 0 0 12px; }
        .tour-row { margin-bottom: 10px; }
        .tour-row label { display: block; font-size: 11px; color: #64748b; margin-bottom: 4px; }
        .tour-type-select { display: flex; gap: 4px; }
        .type-btn { flex: 1; padding: 4px 8px; font-size: 11px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; color: #94a3b8; cursor: pointer; }
        .type-btn.active { background: #3b82f6; border-color: #3b82f6; color: white; }
        .tour-coords { display: flex; gap: 4px; }
        .tour-coords input { flex: 1; padding: 4px 8px; font-size: 11px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; }
        .tour-actions { display: flex; gap: 8px; margin-top: 12px; }
        .tour-btn { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500; }
        .tour-btn:disabled { opacity: 0.4; cursor: default; }
        .play-btn { background: #10b981; color: white; flex: 1; }
        .stop-btn { background: #ef4444; color: white; }
        .save-btn { background: #3b82f6; color: white; }
        .tour-narration { margin-top: 8px; padding: 8px; background: #1e293b; border-radius: 6px; font-size: 11px; color: #94a3b8; font-style: italic; line-height: 1.4; }
        .tour-library { margin-top: 12px; border-top: 1px solid #334155; padding-top: 12px; }
        .tour-library h4 { color: #94a3b8; font-size: 11px; font-weight: 600; margin: 0 0 8px; text-transform: uppercase; }
        .tour-save-row { display: flex; gap: 4px; margin-bottom: 8px; }
        .tour-name-input { flex: 1; padding: 4px 8px; font-size: 11px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; color: #e2e8f0; }
        .tour-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #1e293b; border-radius: 4px; cursor: pointer; margin-bottom: 4px; }
        .tour-item:hover { background: #334155; }
        .tour-item-name { color: #e2e8f0; font-size: 12px; }
        .tour-item-type { color: #64748b; font-size: 10px; text-transform: uppercase; }
      `}</style>
    </div>
  );
};

export default CinematicTours;
