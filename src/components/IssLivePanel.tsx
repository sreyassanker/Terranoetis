import { useState, useEffect } from 'react';
import { Rocket } from 'lucide-react';
import { openInBrowser, isDesktopApp, DESKTOP_API_SERVER, getYoutubeEmbedUrl } from '@/lib/desktop';

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

  const watchUrl = 'https://www.youtube.com/watch?v=awQzjn72bI0';
  const thumbUrl = 'https://img.youtube.com/vi/awQzjn72bI0/hqdefault.jpg';

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
          <div
            role="button"
            tabIndex={0}
            onClick={() => openInBrowser(watchUrl)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInBrowser(watchUrl); } }}
            title="Watch ISS Live Camera Stream"
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              minHeight: 180,
              cursor: 'pointer',
              backgroundColor: '#05050a',
              backgroundImage: `url("${thumbUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.7) 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div
                style={{
                  width: 52,
                  height: 36,
                  backgroundColor: '#ef4444',
                  borderRadius: 9,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{
                  width: 0,
                  height: 0,
                  borderTop: '7px solid transparent',
                  borderBottom: '7px solid transparent',
                  borderLeft: '13px solid #ffffff',
                  marginLeft: 3,
                }} />
              </div>

              <div style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 4,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#fff',
                fontSize: 10.5,
                fontWeight: 500,
              }}>
                <span>Watch ISS Live Stream</span>
                <span style={{ fontSize: 9, opacity: 0.8 }}>↗</span>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            src={getYoutubeEmbedUrl('awQzjn72bI0')}
            title="ISS Live Camera"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
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
