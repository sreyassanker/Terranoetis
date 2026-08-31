import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Realtime Voice — PRIMARY voice path using OpenAI Realtime API via the
 * server bridge (key stays server-side). Audio-in/audio-out, fully
 * interruptible (you can cut the AI off mid-sentence). Falls back to the
 * caller's Web Speech path when this can't connect.
 */

interface RealtimeVoiceOptions {
  onTranscript?: (text: string) => void;
  onStatus?: (status: string) => void;
  onError?: (msg: string) => void;
  getToken?: () => string | null;
}

interface AudioChunk {
  data: string; // base64 PCM16
}

export function useRealtimeVoice(opts: RealtimeVoiceOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  // const playBufferRef = useRef<ArrayBuffer[]>([]);
  const destroyedRef = useRef(false);

  const { onTranscript, onStatus, onError, getToken } = opts;

  const playAudioChunk = useCallback((base64: string) => {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm = new Int16Array(bytes.buffer);
      if (!playCtxRef.current) {
        playCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = playCtxRef.current;
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const data = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch { /* ignore decode errors on chunk edges */ }
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    if (destroyedRef.current) return false;
    const token = getToken?.() || null;
    if (!token) return false;

    return new Promise<boolean>((resolve) => {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${window.location.host}/ws/voice?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          onStatus?.('Realtime voice connected');
          setReady(true);
          resolve(true);
        };
        ws.onerror = () => {
          onError?.('Voice connection failed');
          resolve(false);
        };
        ws.onclose = () => {
          setReady(false);
          setActive(false);
          onStatus?.('Voice disconnected');
        };
        ws.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data);
            if (event.type === 'response.audio.delta' && event.delta) {
              playAudioChunk(event.delta);
            } else if (event.type === 'response.audio_transcript.delta' && event.delta) {
              onTranscript?.(event.delta);
            } else if (event.type === 'input_audio_buffer.speech_started') {
              // Interrupt: stop playback of the previous response
              if (playCtxRef.current) {
                playCtxRef.current.close().catch(() => {});
                playCtxRef.current = null;
              }
            } else if (event.type === 'error') {
              onError?.(event.error?.message || 'Voice error');
            }
          } catch { /* ignore */ }
        };
      } catch {
        resolve(false);
      }
    });
  }, [getToken, onStatus, onError, onTranscript, playAudioChunk]);

  const startMic = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 24000, echoCancellation: true, noiseSuppression: true } });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule('/voice-pcm-processor.js');
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(ctx, 'voice-pcm-processor');
      worklet.port.onmessage = (ev: MessageEvent<AudioChunk>) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'audio', data: ev.data.data }));
        }
      };
      workletRef.current = worklet;
      source.connect(worklet);
      worklet.connect(ctx.destination); // muted monitor
      setActive(true);
      return true;
    } catch {
      onError?.('Microphone permission denied');
      return false;
    }
  }, [onError]);

  const start = useCallback(async (): Promise<boolean> => {
    if (active) return true;
    const connected = wsRef.current?.readyState === WebSocket.OPEN;
    if (!connected) {
      const ok = await connect();
      if (!ok) return false;
    }
    const micOk = await startMic();
    if (!micOk) return false;
    // Start a turn
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'create_response', response: { modalities: ['text', 'audio'], instructions: 'Listen to the user. Be concise.' } }));
    }
    setActive(true);
    return true;
  }, [active, connect, startMic]);

  const commit = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'commit' }));
      wsRef.current.send(JSON.stringify({ type: 'create_response', response: { modalities: ['text', 'audio'] } }));
    }
  }, []);

  const cancel = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    if (playCtxRef.current) {
      playCtxRef.current.close().catch(() => {});
      playCtxRef.current = null;
    }
    try {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      sourceNodeRef.current?.disconnect();
      sourceNodeRef.current = null;
      workletRef.current?.disconnect();
      workletRef.current = null;
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    return () => {
      destroyedRef.current = true;
      stop();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [stop]);

  return { ready, active, connect, start, stop, commit, cancel };
}
