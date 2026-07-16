import { useState } from 'react';
import { Rocket } from 'lucide-react';

interface IssLivePanelProps {
  lat: number;
  lon: number;
  src: string;
  onClose: () => void;
  isTraveling?: boolean;
  onBoard?: () => void;
}

export function IssLivePanel({ lat, lon, src, onClose, isTraveling = false, onBoard }: IssLivePanelProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="iss-live-panel glass-panel">
      <div className="iss-live-header">
        <div className="iss-live-title">
          <span className="iss-live-dot" />
          <span>ISS · LIVE CAMERA</span>
        </div>
        <button className="iss-live-close" onClick={onClose} aria-label="Close ISS camera">×</button>
      </div>

      <div className="iss-live-video">
        {failed ? (
          <div className="cctv-preview-empty">Live feed unavailable</div>
        ) : (
          <iframe
            src={src}
            title="ISS Live Camera"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onError={() => setFailed(true)}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
          />
        )}
      </div>

      <div className="iss-live-footer">
        <div className="iss-live-stat">
          <span className="iss-live-label">LATITUDE</span>
          <span className="iss-live-value">{lat.toFixed(3)}°</span>
        </div>
        <div className="iss-live-stat">
          <span className="iss-live-label">LONGITUDE</span>
          <span className="iss-live-value">{lon.toFixed(3)}°</span>
        </div>
        <div className="iss-live-stat">
          <span className="iss-live-label">ALTITUDE</span>
          <span className="iss-live-value">~408 km</span>
        </div>
      </div>

      {onBoard && (
        <button
          className={`iss-live-board${isTraveling ? ' active' : ''}`}
          onClick={onBoard}
        >
          <Rocket size={13} />
          {isTraveling ? 'Exit Travel View' : 'Enter Travel View'}
        </button>
      )}
    </div>
  );
}
