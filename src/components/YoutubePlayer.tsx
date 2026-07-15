import { useRef, useState } from 'react';

export function YoutubePlayer({ videoId }: { videoId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState(false);

  if (error) {
    return <div className="cctv-preview-empty">Failed to load YouTube video</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onError={() => setError(true)}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
