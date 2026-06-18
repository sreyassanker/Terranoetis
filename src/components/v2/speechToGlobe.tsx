import React, { useState, useCallback, useEffect, useRef } from 'react';

interface SpeechToGlobeProps {
  viewer?: any;
  onNavigate?: (command: NavigationCommand) => void;
}

interface NavigationCommand {
  action: 'fly' | 'zoom' | 'search' | 'filter';
  target?: string;
  location?: string;
  timeRange?: { start: string; end: string };
  params?: Record<string, string>;
}

interface Transcription {
  text: string;
  confidence: number;
  isFinal: boolean;
}

const COMMAND_PATTERNS: Array<{ regex: RegExp; parse: (match: RegExpMatchArray) => NavigationCommand }> = [
  {
    regex: /(?:show|find|display)\s+(.+?)(?:\s+in\s+(.+?))?(?:\s+(?:last|past)\s+(\d+)\s*(day|week|month|year)s?)?(?:\s+(.+))?/i,
    parse: (m) => ({
      action: 'search',
      target: m[1]?.trim().toLowerCase(),
      location: m[2]?.trim(),
      timeRange: m[3] ? { start: `-${m[3]}${m[4][0]}`, end: 'now' } : undefined,
    }),
  },
  {
    regex: /fly\s+to\s+(.+)/i,
    parse: (m) => ({ action: 'fly', location: m[1]?.trim() }),
  },
  {
    regex: /zoom\s+(?:to|in\s+on)\s+(.+)/i,
    parse: (m) => ({ action: 'zoom', location: m[1]?.trim() }),
  },
  {
    regex: /filter\s+(?:by\s+)?(.+?)(?:\s+(.+))?/i,
    parse: (m) => ({ action: 'filter', target: m[1]?.trim(), params: m[2] ? { value: m[2]?.trim() } : undefined }),
  },
];

const SpeechToGlobe: React.FC<SpeechToGlobeProps> = ({ viewer, onNavigate }) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<Transcription>({ text: '', confidence: 0, isFinal: false });
  const [commandPreview, setCommandPreview] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  const startListening = useCallback(async () => {
    try {
      audioRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setTranscript({ text: 'Speech recognition not available', confidence: 0, isFinal: true });
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let finalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
            processCommand(result[0].transcript);
          } else {
            interimText += result[0].transcript;
          }
        }
        setTranscript({
          text: finalText || interimText,
          confidence: event.results[event.results.length - 1]?.[0]?.confidence || 0,
          isFinal: !!finalText,
        });
      };

      recognition.onerror = () => setIsListening(false);
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);

      drawWaveform();
    } catch {
      setTranscript({ text: 'Microphone access denied', confidence: 0, isFinal: true });
    }
  }, [onNavigate]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.getTracks().forEach(t => t.stop());
      audioRef.current = null;
    }
    setIsListening(false);
    cancelAnimationFrame(animationRef.current);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  const processCommand = useCallback((text: string) => {
    setHistory(prev => [text, ...prev].slice(0, 20));
    for (const { regex, parse } of COMMAND_PATTERNS) {
      const match = text.match(regex);
      if (match) {
        const command = parse(match);
        setCommandPreview(JSON.stringify(command, null, 2));
        onNavigate?.(command);
        break;
      }
    }
  }, [onNavigate]);

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !audioRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(audioRef.current);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = isListening ? `hsl(${220 + dataArray[i] * 0.3}, 70%, 60%)` : '#334155';
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    draw();
  }, [isListening]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return (
    <div className="speech-to-globe">
      <div className="speech-panel">
        <div className="speech-header">
          <h3 className="speech-title">Voice Commands</h3>
          <button
            className={`mic-button ${isListening ? 'listening' : ''}`}
            onClick={isListening ? stopListening : startListening}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        </div>

        <canvas ref={canvasRef} className="waveform-canvas" width={260} height={40} />

        <div className="transcript-area">
          {transcript.text && (
            <div className="transcript-text">
              <p>{transcript.text}</p>
              <div className="confidence-bar">
                <div className="confidence-fill" style={{ width: `${transcript.confidence * 100}%` }} />
              </div>
              <span className="confidence-label">
                {Math.round(transcript.confidence * 100)}% confidence
              </span>
            </div>
          )}
          {!transcript.text && isListening && (
            <div className="listening-indicator">
              <span className="listening-dot" /> Listening...
            </div>
          )}
        </div>

        {commandPreview && (
          <div className="command-preview">
            <div className="preview-header">Parsed Command</div>
            <pre className="preview-json">{commandPreview}</pre>
          </div>
        )}

        {history.length > 0 && (
          <div className="voice-history">
            <h4>Recent Commands</h4>
            {history.slice(0, 5).map((h, i) => (
              <div key={i} className="history-item">
                <span className="history-icon">🎤</span>
                <span className="history-text">{h}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .speech-to-globe { position: absolute; bottom: 80px; left: 16px; width: 280px; z-index: 100; }
        .speech-panel { background: rgba(15, 23, 42, 0.9); border: 1px solid #334155; border-radius: 12px; padding: 12px; backdrop-filter: blur(12px); }
        .speech-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .speech-title { color: #e2e8f0; font-size: 13px; font-weight: 600; margin: 0; }
        .mic-button { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #334155; background: #1e293b; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .mic-button.listening { border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.1); animation: micPulse 1.5s infinite; }
        @keyframes micPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); } }
        .waveform-canvas { width: 100%; height: 40px; border-radius: 6px; background: #0f172a; margin-bottom: 8px; }
        .transcript-area { min-height: 40px; margin-bottom: 8px; }
        .transcript-text p { margin: 0; font-size: 12px; color: #e2e8f0; line-height: 1.4; }
        .confidence-bar { height: 3px; background: #334155; border-radius: 2px; margin: 4px 0; }
        .confidence-fill { height: 100%; background: #10b981; border-radius: 2px; transition: width 0.3s; }
        .confidence-label { font-size: 10px; color: #64748b; }
        .listening-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #94a3b8; }
        .listening-dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; animation: pulse 1.5s infinite; }
        .command-preview { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
        .preview-header { font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
        .preview-json { font-size: 10px; color: #3b82f6; margin: 0; white-space: pre-wrap; }
        .voice-history h4 { font-size: 10px; color: #64748b; text-transform: uppercase; margin: 0 0 6px; }
        .history-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 11px; color: #94a3b8; }
        .history-icon { font-size: 10px; }
        .history-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
    </div>
  );
};

export default SpeechToGlobe;
