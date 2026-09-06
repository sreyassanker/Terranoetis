import { useEffect } from 'react';
import { Globe, MapPin, SkipForward, SquareDashed } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';

interface StudyAreaRequest {
  query: string;
  location?: { lat: number; lon: number; label?: string };
  detectedBbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  options: Array<{ id: 'draw' | 'detected' | 'skip' | 'global'; label: string; description: string }>;
}

export function StudyAreaPrompt({
  request,
  sendAI,
}: {
  request: StudyAreaRequest;
  sendAI: (msg?: string, opts?: { force?: boolean; regen?: boolean; studyAreaAction?: 'draw' | 'detected' | 'skip' | 'global'; bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } }) => void;
}) {
  const setPendingStudyAreaQuery = useChatStore(s => s.setPendingStudyAreaQuery);

  // When the server auto-detected a real boundary, draw it on the globe so the
  // user can see it and decide whether to adjust it.
  useEffect(() => {
    if (request.detectedBbox) {
      const drawBbox = (window as unknown as Record<string, unknown>).__drawStudyAreaBbox as unknown as ((bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => void) | undefined;
      if (typeof drawBbox === 'function') drawBbox(request.detectedBbox);
    }
  }, [request.detectedBbox]);

  const handleDraw = () => {
    setPendingStudyAreaQuery(request.query);
    // Expose a global function set by App.tsx to start drawing on the globe.
    const startDraw = (window as unknown as Record<string, unknown>).__startStudyAreaDraw as unknown as (() => void) | undefined;
    if (typeof startDraw === 'function') {
      startDraw();
    }
  };

  const handleDetected = () => {
    setPendingStudyAreaQuery(null);
    sendAI(request.query, { force: true, studyAreaAction: 'detected', bbox: request.detectedBbox });
  };

  const handleSkip = () => {
    setPendingStudyAreaQuery(null);
    sendAI(request.query, { force: true, studyAreaAction: 'skip' });
  };

  const handleGlobal = () => {
    setPendingStudyAreaQuery(null);
    sendAI(request.query, { force: true, studyAreaAction: 'global' });
  };

  const optDraw = request.options.find(o => o.id === 'draw');
  const optDetected = request.options.find(o => o.id === 'detected');
  const optSkip = request.options.find(o => o.id === 'skip');
  const optGlobal = request.options.find(o => o.id === 'global');

  return (
    <div className="study-area-prompt" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 2 }}>
        {request.detectedBbox
          ? 'I detected a study area boundary. Adjust it or use it:'
          : optGlobal
            ? 'Search the whole globe, or mark a specific area:'
            : 'Choose how to define the study area:'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {optGlobal && (
          <button
            onClick={handleGlobal}
            title={optGlobal.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)',
              color: '#60a5fa', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <Globe size={13} />
            {optGlobal.label}
          </button>
        )}
        {optDraw && (
          <button
            onClick={handleDraw}
            title={optDraw.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)',
              color: '#60a5fa', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <SquareDashed size={13} />
            {optDraw.label}
          </button>
        )}
        {optDetected && (
          <button
            onClick={handleDetected}
            title={optDetected.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)',
              color: '#34d399', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <MapPin size={13} />
            {optDetected.label}
          </button>
        )}
        {optSkip && (
          <button
            onClick={handleSkip}
            title={optSkip.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)',
              color: '#eab308', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <SkipForward size={13} />
            {optSkip.label}
          </button>
        )}
      </div>
      {request.location && (
        <div style={{ fontSize: 10, opacity: 0.6 }}>
          Detected location: <strong>{request.location.label || `${request.location.lat.toFixed(2)}, ${request.location.lon.toFixed(2)}`}</strong>
        </div>
      )}
    </div>
  );
}