/**
 * Realtime Voice Bridge — proxies browser ↔ realtime voice providers.
 * PRIMARY: OpenAI Realtime (gpt-realtime-2025-08-28). FALLBACK: Gemini Live
 * (gemini-3.1-flash-live-preview via BidiGenerateContent) — used
 * automatically when the OpenAI key is absent, invalid, or out of credits.
 *
 * API keys stay server-side (never touch the browser). The browser sends a
 * uniform protocol the hook understands:
 *   {type:'audio', data: base64PCM16}  → provider input audio
 *   {type:'commit'}                    → commit the buffered turn
 *   {type:'create_response'}           → ask the model to respond
 *   {type:'cancel'}                    → interrupt the current response
 *   {type:'ping'}                      → keepalive
 *
 * Provider → browser events are normalized to the same shapes the client
 * hook already consumes: response.audio.delta (base64 PCM16 @24000),
 * response.audio_transcript.delta (text), input_audio_buffer.speech_started
 * (interrupt), error, voice_connected, voice_disconnected.
 */

import WebSocket from 'ws';
import { logger } from './observability/logger';

const OPENAI_REALTIME = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2025-08-28';
const GEMINI_LIVE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_MODEL = 'models/gemini-3.1-flash-live-preview';
const AUDIO_MIME = 'audio/pcm;rate=24000';

interface RealtimeSession {
  clientWs: WebSocket;
  providerWs: WebSocket | null;
  userId: string;
  destroyed: boolean;
  provider: 'openai' | 'gemini';
}

const sessions = new Map<string, RealtimeSession>();

/** Normalized message handlers. `ws` is the active provider socket. */
function sendToProvider(ws: WebSocket | null, raw: string, provider: 'openai' | 'gemini'): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'audio') {
      if (provider === 'gemini') {
        // Gemini Live: realtimeInput.mediaChunks[].data (base64 PCM16)
        ws.send(JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: AUDIO_MIME, data: msg.data }] },
        }));
      } else {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.data }));
      }
    } else if (msg.type === 'commit') {
      if (provider === 'gemini') {
        // Gemini has no explicit commit — sending a text turn triggers VAD end.
        // We just no-op; the client starts responses on create_response.
      } else {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      }
    } else if (msg.type === 'create_response') {
      if (provider === 'gemini') {
        const text = String(msg.response?.instructions || msg.response?.text || '');
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: text ? [{ text }] : [] }],
            turnComplete: true,
          },
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'response.create',
          response: msg.response || { modalities: ['text', 'audio'] },
        }));
      }
    } else if (msg.type === 'cancel') {
      if (provider === 'gemini') {
        ws.send(JSON.stringify({ clientInterruption: {} }));
      } else {
        ws.send(JSON.stringify({ type: 'response.cancel' }));
      }
    } else if (msg.type === 'session_update') {
      if (provider === 'openai') {
        ws.send(JSON.stringify({ type: 'session.update', session: msg.session }));
      }
    } else if (msg.type !== 'ping') {
      ws.send(raw);
    }
  } catch { /* ignore malformed messages */ }
}

/** Normalize a provider event to the client hook's expected shape. */
function normalizeProviderEvent(provider: 'openai' | 'gemini', event: Record<string, unknown>, clientWs: WebSocket): void {
  const send = (obj: unknown) => { try { clientWs.send(JSON.stringify(obj)); } catch { /* */ } };
  if (provider === 'gemini') {
    if (event.setupComplete) {
      send({ type: 'voice_connected', sessionId: 'gemini' });
      return;
    }
    const serverContent = event.serverContent as Record<string, unknown> | undefined;
    if (serverContent) {
      const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
      const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts as Array<Record<string, unknown>> : [];
      for (const part of parts) {
        const inline = part.inlineData as Record<string, unknown> | undefined;
        if (inline?.data) {
          send({ type: 'response.audio.delta', delta: inline.data, provider: 'gemini' });
        }
        if (part.text) {
          send({ type: 'response.audio_transcript.delta', delta: part.text, provider: 'gemini' });
        }
      }
      if (serverContent.turnComplete) {
        send({ type: 'response.done', provider: 'gemini' });
      }
      return;
    }
    const err = event.error as Record<string, unknown> | undefined;
    if (err) {
      send({ type: 'error', error: { message: String(err.message || 'Gemini voice error') } });
      return;
    }
    return;
  }
  // OpenAI — forward the relevant event types verbatim (client already parses).
  const t = event.type as string;
  if (t === 'response.audio.delta' || t === 'response.audio.done' ||
      t === 'response.audio_transcript.delta' || t === 'response.audio_transcript.done' ||
      t === 'response.done' || t === 'response.output_item.done' ||
      t === 'conversation.item.created' || t === 'conversation.item.input_audio_transcription.completed' ||
      t === 'input_audio_buffer.speech_started' || t === 'input_audio_buffer.speech_stopped' ||
      t === 'session.created' || t === 'session.updated' ||
      t === 'error' || t === 'rate_limits.updated') {
    send(event);
  }
}

/**
 * Wire a browser WebSocket to a realtime provider.
 * @param clientWs The authenticated browser socket (already upgraded).
 * @param provider Preferred provider; 'gemini' when no OpenAI key exists.
 */
export function connectVoiceProvider(
  clientWs: WebSocket,
  userId: string,
  provider: 'openai' | 'gemini',
  keys: { openai?: string; gemini?: string },
): void {
  const sessionId = `${userId}_${Date.now()}`;
  const session: RealtimeSession = { clientWs, providerWs: null, userId, destroyed: false, provider };
  sessions.set(sessionId, session);

  clientWs.on('message', (raw) => {
    if (session.destroyed) return;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        clientWs.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      sendToProvider(session.providerWs, raw.toString(), session.provider);
    } catch { /* ignore */ }
  });

  clientWs.on('close', () => {
    if (!session.destroyed) {
      session.destroyed = true;
      session.providerWs?.close();
      sessions.delete(sessionId);
    }
  });

  const onProviderOpen = () => {
    if (session.provider === 'openai') {
      session.providerWs?.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          audio: { input_audio_format: 'pcm16', output_audio_format: 'pcm16', input_audio_transcription: { enabled: true } },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          temperature: 0.7,
          instructions: 'You are Terranoetis, a real-time geospatial intelligence AI. You answer questions about Earth observation, live data, and analytical models. You are concise and direct. Use the current context if available.',
        },
      }));
      clientWs.send(JSON.stringify({ type: 'voice_connected', sessionId }));
    } else {
      // Gemini Live setup
      session.providerWs?.send(JSON.stringify({
        setup: {
          model: GEMINI_MODEL,
          generationConfig: { responseModalities: ['AUDIO'] },
          systemInstruction: { parts: [{ text: 'You are Terranoetis, a real-time geospatial intelligence AI. Be concise and direct. Answer from real Earth-observation knowledge.' }] },
        },
      }));
    }
  };

  const onProviderMessage = (data: WebSocket.RawData) => {
    if (session.destroyed) return;
    try {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      // OpenAI billing / auth failures arrive as MESSAGES, not socket errors.
      // Detect them and fall back to Gemini so voice still works.
      if (session.provider === 'openai' && event.type === 'error' && keys.gemini) {
        const errMsg = String(((event.error as Record<string, unknown> | undefined)?.message) ?? '');
        if (/no credits|insufficient_quota|billing|quota|invalid.*key/i.test(errMsg)) {
          logger.warn({ err: errMsg }, 'OpenAI voice billing/quota — falling back to Gemini Live');
          session.providerWs?.close();
          session.provider = 'gemini';
          openGemini();
          return;
        }
      }
      normalizeProviderEvent(session.provider, event, clientWs);
    } catch { /* ignore parse errors */ }
  };

  const onProviderError = (providerName: string) => {
    // If OpenAI fails at connection (no credits / bad key), fall back to Gemini.
    if (session.provider === 'openai' && keys.gemini) {
      logger.warn('OpenAI Realtime unavailable — falling back to Gemini Live');
      session.provider = 'gemini';
      openGemini();
      return;
    }
    try { clientWs.send(JSON.stringify({ type: 'error', error: `${providerName} voice connection failed` })); } catch { /* */ }
  };

  const openGemini = () => {
    const gws = new WebSocket(`${GEMINI_LIVE}?key=${encodeURIComponent(keys.gemini || '')}`);
    session.providerWs = gws;
    gws.on('open', onProviderOpen);
    gws.on('message', onProviderMessage);
    gws.on('error', () => onProviderError('Gemini'));
    gws.on('close', () => {
      if (!session.destroyed) {
        try { clientWs.send(JSON.stringify({ type: 'voice_disconnected' })); } catch { /* */ }
        session.destroyed = true;
        sessions.delete(sessionId);
      }
    });
  };

  if (session.provider === 'openai') {
    const ows = new WebSocket(OPENAI_REALTIME, {
      headers: { 'Authorization': `Bearer ${keys.openai || ''}` },
    });
    session.providerWs = ows;
    ows.on('open', onProviderOpen);
    ows.on('message', onProviderMessage);
    ows.on('error', () => onProviderError('OpenAI'));
    ows.on('close', () => {
      if (!session.destroyed) {
        try { clientWs.send(JSON.stringify({ type: 'voice_disconnected' })); } catch { /* */ }
        session.destroyed = true;
        sessions.delete(sessionId);
      }
    });
  } else {
    openGemini();
  }
}