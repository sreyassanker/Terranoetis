import { useRef, useState, useEffect } from 'react';

export function CctvVideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(false);

    let hls: any = null;
    let cancelled = false;
    const isHls = src.includes('.m3u8') || src.includes('m3u8');

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) {
          if (hls) hls.destroy();
          return;
        }
        if (!videoRef.current) return;
        if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = src;
        } else if (Hls.isSupported()) {
          hls = new Hls({
            maxMaxBufferLength: 5,
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current?.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
              console.warn('HLS fatal error:', data);
              setError(true);
            }
          });
        } else {
          setError(true);
        }
      }).catch(err => {
        if (cancelled) return;
        console.error('Failed to load hls.js', err);
        setError(true);
      });
    } else {
      video.src = src;
      video.load();
      video.play().catch(() => {});
    }

    return () => {
      cancelled = true;
      if (hls) {
        hls.destroy();
      }
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [src]);

  if (error) {
    return (
      <div className="cctv-preview-empty">
        Failed to load video stream
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      muted
      autoPlay
      style={{ width: '100%', height: '165px', objectFit: 'cover', background: '#000', display: 'block' }}
    />
  );
}
