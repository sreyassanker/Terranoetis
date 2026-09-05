import { useCallback, useRef } from 'react';
import { useChatStore } from '@/store/chatStore';
import { authHeaders } from '@/context/AuthContext';
import { extractArtifacts } from '@/lib/advancedChat';
import { cacheChatSession, queueMessage, isOnline } from '@/lib/offlineChat';
import type { ChatMessage, AiRecipe } from '@/lib/chatStore';
import * as Cesium from 'cesium';

export interface UseChatOptions {
  abortControllerRef?: React.MutableRefObject<AbortController | null>;
  currentRequestIdRef?: React.MutableRefObject<string | null>;
  onPanel?: (data: unknown) => void;
  onAnalyticalResult?: (data: Record<string, unknown>) => void;
}

interface LocationResult {
  lat: number;
  lon: number;
}

interface AgentStep {
  type: string;
  text: string;
  code?: string;
  output?: string;
  timeMs?: number;
  status?: string;
  toolName?: string;
  subtask?: string;
  startedAt?: number;
}

interface PipelineStep {
  id: string;
  description: string;
  status: string;
}

export function useChat(
  extractLocation: (text: string) => Promise<LocationResult | null>,
  focusLocation: (lat: number, lon: number, opts: Record<string, unknown>) => void,
  toggleLayer: (id: string) => void,
  isLayerEnabled: (id: string) => boolean,
  sendToPipeline: (msg: string, wsId: string | null) => Promise<void>,
  sendMonitorCommand: (msg: string) => Promise<boolean>,
  sendScheduleCommand: (msg: string) => Promise<boolean>,
  executeAgentCommands: (commands: Array<Record<string, unknown>>) => void,
  generateLocalResponse: (msg: string, loc: LocationResult | null) => Promise<string>,
  cleanupThinkingSteps: (force?: boolean) => void,
  loadFlightTracks: (viewer: Cesium.Viewer) => Promise<void>,
  viewerRef: React.MutableRefObject<Cesium.Viewer | null>,
  options: UseChatOptions = {},
) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  if (options.abortControllerRef) {
    abortControllerRef.current = options.abortControllerRef.current;
  }
  if (options.currentRequestIdRef) {
    currentRequestIdRef.current = options.currentRequestIdRef.current;
  }

  const nextAiMsgIdRef = useRef(100);
  const store = useChatStore;

  const sendAI = useCallback(async (overrideMessage?: string, opts?: { force?: boolean; regen?: boolean; studyAreaAction?: 'draw' | 'detected' | 'skip'; bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number }; polygon?: Array<Array<[number, number]>> }) => {
    const state = store.getState();
    const userMsg = typeof overrideMessage === 'string' ? overrideMessage : state.aiInput.trim();
    if (!userMsg) return;
    // Double-send guard: only one stream at a time (the Stop button owns abort).
    // A genuine rerun (slider re-run via sendAIRef) may bypass with force.
    if (state.aiTyping && !opts?.force) return;

    // Edit-in-place: the pending edit owns a user message. Replace its content,
    // drop everything after it, then regenerate — no new user message is added.
    const editingId = store.getState().editingMessageId;
    const isRegen = Boolean(opts?.regen || editingId != null);
    if (editingId != null) {
      const msgs = store.getState().aiMessages;
      const editIdx = msgs.findIndex(m => m.id === editingId);
      if (editIdx >= 0) {
        store.getState().setAiMessages([
          ...msgs.slice(0, editIdx),
          { ...msgs[editIdx], content: userMsg },
        ]);
      }
      store.getState().setEditingMessageId(null);
    }

    store.getState().setAiInput('');
    const streamTabId = store.getState().activeTabId;
    const mutateTab = (fn: (tab: import('@/store/chatStore').ChatTab) => import('@/store/chatStore').ChatTab) => {
      if (streamTabId) store.getState().mutateTab(streamTabId, fn);
    };
    // When no chat tab exists (fresh load before the user opens a tab), all of
    // the tab mutations above no-op. Fall back to the singleton store so the
    // message still renders. This is the pre-tab behaviour and keeps the
    // god-eye flow (any panel command) fully functional on first load.
    const addMessage = (msg: ChatMessage) => {
      if (streamTabId) {
        mutateTab(tab => ({
          ...tab,
          messages: tab.messages.some(m => m.id === msg.id)
            ? tab.messages
            : [...tab.messages, { ...msg, timestamp: msg.timestamp ?? Date.now() }],
        }));
      } else {
        store.getState().addMessage(msg);
      }
    };
    const updateMessage = (id: number, updates: Partial<ChatMessage>) => {
      if (streamTabId) {
        mutateTab(tab => ({
          ...tab,
          messages: tab.messages.map(m => (m.id === id ? { ...m, ...updates } : m)),
        }));
      } else {
        store.getState().updateMessage(id, updates);
      }
    };
    const setAiTyping = (v: boolean) => streamTabId ? store.getState().setTabTyping(streamTabId, v) : store.getState().setAiTyping(v);
    // Single source of truth: agentSteps are driven entirely by server SSE updates.
    // NO client-seeded placeholder steps - server is authoritative.
    const setAgentSteps = (fn: (prev: AgentStep[]) => AgentStep[]) => {
      if (streamTabId) {
        mutateTab(tab => ({
          ...tab,
          agentSteps: typeof fn === 'function' ? fn(tab.agentSteps) : fn,
        }));
      } else {
        store.getState().setAgentSteps(fn);
      }
    };
    const setPipelineProgress = (fn: (prev: PipelineStep[]) => PipelineStep[]) => {
      if (streamTabId) {
        mutateTab(tab => ({
          ...tab,
          pipelineProgress: typeof fn === 'function' ? fn(tab.pipelineProgress) : fn,
        }));
      } else {
        store.getState().setPipelineProgress(fn);
      }
    };
    const setExpandedStep = (v: number) => store.getState().setExpandedStep(v);

    const sessionId = store.getState().sessionId;
    const selectedTier = store.getState().selectedTier;
    const selectedModel = store.getState().selectedModel;
    const chatImages = store.getState().chatImages;
    const sandboxWorkspaceId = store.getState().sandboxWorkspaceId;
    const studyAreaBbox = store.getState().studyAreaBbox;
    const requestImages = chatImages.length > 0
      ? chatImages.map(img => ({ dataUrl: img.dataUrl, mimeType: img.mimeType, fileName: img.fileName }))
      : undefined;

    // Attach any pending uploads to the user message so they render inline.
    // The message now owns the images, so drop the global queue immediately —
    // this must happen before any early return (fly/monitor/schedule/compute)
    // so images are never re-sent on a later message.
    // On regenerate, the original user message already exists — don't duplicate it.
    if (!isRegen) {
      addMessage({ id: nextAiMsgIdRef.current++, role: 'user', content: userMsg, images: requestImages });
      store.getState().clearChatImages();
    }
    setAiTyping(true);
    setAgentSteps(() => []);
    setPipelineProgress(() => []);

    // Offline: queue message
    if (!isOnline()) {
      await queueMessage(userMsg, store.getState().sessionId);
      addMessage({
        id: nextAiMsgIdRef.current++,
        role: 'assistant',
        content: '⚡ You are offline. Your message has been queued and will be sent when you reconnect.',
      });
      setAiTyping(false);
      return;
    }

    const loc = await extractLocation(userMsg);

    // Multi-command message? (comma/and-separated: "show earthquakes, flights,
    // and ships"). When the user asks for MULTIPLE things, skip the client-side
    // shortcuts below (fly/flight/compute) — the server's multi-command handler
    // parses and executes ALL of them deterministically.
    const lower0 = userMsg.toLowerCase().trim();
    const hasMultipleSegments = /[,;]|\band\b|\bplus\b/i.test(lower0);
    const isExplicitMultiCommand = hasMultipleSegments && (
      /\b(show|display|open|enable|toggle|hide|close|disable)\b/i.test(lower0)
      || /\b(earthquake|quake|flight|plane|aircraft|ship|vessel|wildfire|volcano|storm|satellite|aurora|panel|workbench|tracker|explorer|dashboards?)\b/i.test(lower0)
    );
    if (!isExplicitMultiCommand) {
      // NOTE: "fly to X" is intentionally NOT short-circuited here anymore.
      // The old client-side pure-fly shortcut flew to a fixed 20 km height and
      // returned before reaching the server, so the OSM/admin boundary was
      // never drawn and the camera never fit the whole area. The server's
      // area-resolution step resolves the real boundary, emits flyTo (fit) +
      // addPolygon (boundary) commands, and returns a clean confirmation.

      // Monitor/schedule commands
      if (/^monitor\s+/i.test(userMsg)) {
        const handled = await sendMonitorCommand(userMsg);
        if (handled) { cleanupThinkingSteps(); setAiTyping(false); return; }
      }
      if (/^schedule\s+/i.test(userMsg)) {
        const handled = await sendScheduleCommand(userMsg);
        if (handled) { cleanupThinkingSteps(); setAiTyping(false); return; }
      }

      // Compute tasks
      const isComputeTask = /\b(compute|calculate|run script|execute (?:code|script|python|node|bash)|simulate|csv|analyze (?:data|dataset|this)|pipeline)\b/i.test(userMsg)
        && !/\b(show|display|visualize|fly|go|zoom|toggle|enable|display|where|what|how|why|compare|near|around)\b/i.test(userMsg);

      if (isComputeTask) {
        try {
          setExpandedStep(-1);
          await sendToPipeline(userMsg, sandboxWorkspaceId || null);
          setAiTyping(false);
          return;
        } catch (e) {
          addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: `Pipeline execution failed: ${e}\n\nFalling back to agent analysis...` });
        }
      }

      // Flight queries
      const lower = userMsg.toLowerCase();
      const wantsFlights = lower.includes('plane') || lower.includes('flight') || lower.includes('aircraft') || lower.includes('adsb');
      if (wantsFlights && loc) {
        const layerId = 'flight_tracks';
        if (isLayerEnabled(layerId)) {
          const v = viewerRef.current;
          if (v) void loadFlightTracks(v);
        } else {
          toggleLayer(layerId);
        }
        focusLocation(loc.lat, loc.lon, { label: 'Live Aircraft', color: '#60a5fa', height: 50000 });
        addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: `Loading aircraft near ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}...` });
        setAiTyping(false);
        return;
      }
    }

    // General AI query
    setExpandedStep(-1);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    if (options.abortControllerRef) options.abortControllerRef.current = abortController;
    if (streamTabId) store.getState().registerTabAbort(streamTabId, abortController);

    // Hoisted so the catch block below can append to the live streamed bubble
    // (abort / server errors) instead of duplicating it.
    let streamingMsgId: number | null = null;
    let streamingStepAdded = false;
    let tokenBuffer = '';
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    const patchStreamingMsg = (patch: (m: ChatMessage) => Partial<ChatMessage> | null) => {
      mutateTab(tab => ({
        ...tab,
        messages: tab.messages.map(m => {
          if (m.id !== streamingMsgId) return m;
          const p = patch(m);
          return p ? { ...m, ...p } : m;
        }),
      }));
    };
    // Batch streamed tokens and flush ~every 40ms — avoids a store update +
    // full message re-parse per token (O(n²) on long responses).
    const flushTokens = () => {
      if (!tokenBuffer) return;
      const chunk = tokenBuffer;
      tokenBuffer = '';
      if (streamingMsgId === null) {
        streamingMsgId = nextAiMsgIdRef.current++;
        addMessage({ id: streamingMsgId!, role: 'assistant', content: chunk });
      } else {
        patchStreamingMsg(m => ({ content: m.content + chunk }));
      }
    };

    try {
      // Clear previous AI entities
      const v0 = viewerRef.current;
      if (v0) {
        const rawEntities = (v0 as unknown as { entities: unknown }).entities;
        // Cesium EntityCollection has .values() method; newer builds expose an Array.
        const entityList: Record<string, unknown>[] = typeof (rawEntities as { values?: () => unknown })?.values === 'function'
          ? Array.from((rawEntities as { values(): IterableIterator<Record<string, unknown>> }).values())
          : Array.isArray(rawEntities) ? rawEntities as Record<string, unknown>[] : [];
        const toRemove = entityList.filter((e: Record<string, unknown>) => {
          const props = e.properties as Record<string, unknown> | undefined;
          const layer = props?.layer;
          return layer === 'heatmap' || layer === 'chart' || layer === 'geojson';
        });
        for (const e of toRemove) {
          const coll = rawEntities as { remove(e: Record<string, unknown>): void };
          if (typeof coll.remove === 'function') coll.remove(e);
        }
      }

      const contextMessages = (streamTabId
        ? (store.getState().chatTabs.find(t => t.id === streamTabId)?.messages ?? store.getState().aiMessages)
        : store.getState().aiMessages
      ).slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
      const resp = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          message: userMsg,
          userId: 'browser-user',
          sessionId,
          tier: selectedTier,
          ...(selectedModel && selectedModel !== 'auto' ? { model: selectedModel } : {}),
          ...(opts?.studyAreaAction ? { studyAreaAction: opts.studyAreaAction } : {}),
          ...(opts?.bbox ? { studyAreaBbox: opts.bbox } : {}),
          ...(opts?.polygon ? { studyAreaPolygon: opts.polygon } : {}),
          recentMessages: contextMessages,
          images: requestImages,
          ...(studyAreaBbox ? { studyAreaBbox } : {}),
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) throw new Error(`Agent request failed (${resp.status})`);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      let lastTraceId: string | null = null;
      let lastModelTier: string | null = null;
      let serverError: string | null = null;
      let lastRecipe: AiRecipe | null = null;
      let lastReplayed: boolean | undefined;
      let lastPatternId: string | undefined;
      const receivedCommands: Array<{ action: string; label?: string; lat?: number; lon?: number; layerId?: string }> = [];

      const processLines = () => {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) continue;
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            // Non-token events mutate the streamed message (tools, steps) —
            // flush pending tokens first so ordering stays intact.
            if (data.type !== 'token') flushTokens();
            if (data.type === 'connected' && data.requestId) currentRequestIdRef.current = data.requestId;
            if (data.steps) {
              setAgentSteps(data.steps.map((s: Record<string, unknown>) => ({ type: (s.type as string) || 'step', text: (s.text as string) || (s.type as string) || '', code: s.code as string | undefined, output: s.output as string | undefined, status: (s.status as string) || 'completed', timeMs: s.timeMs as number | undefined, startedAt: Date.now() })));
            }
            if (data.type === 'step') {
              const status = (data.status as string) || 'completed';
              const stepType = (data.stepType as string) || 'step';
              const text = (data.text as string) || '';
              setAgentSteps((prev: AgentStep[]) => {
                // The client seeds a generic "Analyzing your request..." step
                // before the fetch starts. Fold it into the first real phase
                // step so the timeline reads cleanly (one entry per phase).
                const placeholderIdx = prev.findIndex(s => s.type === 'reasoning' && s.status === 'running' && /Analyzing your request/.test(s.text));
                if (placeholderIdx >= 0 && placeholderIdx === prev.length - 1) {
                  const next = [...prev];
                  next[placeholderIdx] = { ...next[placeholderIdx], status: 'completed', text: 'Request received', timeMs: Date.now() - (next[placeholderIdx].startedAt || Date.now()) };
                  return [...next, { type: stepType, text, code: data.code as string | undefined, output: data.output as string | undefined, status, startedAt: Date.now() }];
                }
                // When a completion/failure event matches the most recent *running*
                // step of the same phase, fold it into that node so the timeline
                // shows one entry per phase that transitions running → done.
                let idx = -1;
                for (let i = prev.length - 1; i >= 0; i--) {
                  if (prev[i].status === 'running' && prev[i].type !== stepType) break;
                  if (prev[i].type === stepType && prev[i].status === 'running') { idx = i; break; }
                }
                if (idx >= 0 && (status === 'completed' || status === 'failed')) {
                  const next = [...prev];
                  next[idx] = {
                    ...prev[idx],
                    status,
                    text: text || prev[idx].text,
                    code: (data.code as string) ?? prev[idx].code,
                    output: (data.output as string) ?? prev[idx].output,
                    timeMs: data.timeMs !== undefined ? (data.timeMs as number) : prev[idx].timeMs,
                  };
                  return next;
                }
                return [...prev, { type: stepType, text, code: data.code as string | undefined, output: data.output as string | undefined, status, startedAt: Date.now() }];
              });
            }
                    if (data.type === 'token' && data.text) {
              // Ensure a live "Generating response" step exists during token
              // streaming so the process panel stays animated for the longest
              // phase (Claude Code shows a distinct writing state too).
              if (!streamingStepAdded) {
                streamingStepAdded = true;
                setAgentSteps((prev: AgentStep[]) => {
                  if (prev.some(s => s.type === 'streaming')) return prev;
                  return [...prev, { type: 'streaming', text: 'Generating response…', status: 'running', startedAt: Date.now() }];
                });
              }
              tokenBuffer += data.text;
            }
            if (data.type === 'tool_call') {
              if (streamingMsgId === null) {
                streamingMsgId = nextAiMsgIdRef.current++;
                addMessage({ id: streamingMsgId!, role: 'assistant', content: '', toolEvents: [{ name: data.name, args: data.args, description: data.description, status: 'pending', riskLevel: data.riskLevel }] });
              } else {
                patchStreamingMsg(m => ({ toolEvents: [...(m.toolEvents || []), { name: data.name, args: data.args, description: data.description, status: 'pending', riskLevel: data.riskLevel }] }));
              }
            }
            if (data.type === 'tool_approval') {
              if (streamingMsgId === null) {
                streamingMsgId = nextAiMsgIdRef.current++;
                addMessage({ id: streamingMsgId!, role: 'assistant', content: '', toolEvents: [{ name: data.name, args: data.args, description: data.description, status: 'blocked', riskLevel: data.riskLevel, approvalRequired: true }] });
              } else {
                patchStreamingMsg(m => ({ toolEvents: [...(m.toolEvents || []), { name: data.name, args: data.args, description: data.description, status: 'blocked', riskLevel: data.riskLevel, approvalRequired: true }] }));
              }
            }
            if (data.type === 'subagent' && data.role) {
              const activity = { role: data.role, stepId: data.stepId, status: data.status, text: data.text, partial: data.partial, timestamp: data.timestamp || Date.now() };
              if (streamingMsgId === null) {
                streamingMsgId = nextAiMsgIdRef.current++;
                addMessage({ id: streamingMsgId!, role: 'assistant', content: '', subAgents: [activity] });
              } else {
                patchStreamingMsg(m => ({ subAgents: [...(m.subAgents || []), activity].slice(-50) }));
              }
            }
            if (data.type === 'tool_result' && streamingMsgId !== null) {
              // Enterprise: surface dataset degradation visibly (missing key, upstream down).
              if (data.degraded && data.error) {
                const reason = /KEY_REQUIRED|not configured/i.test(data.error) ? 'API key missing' : 'upstream unavailable';
                import('sonner').then(({ toast }) => toast.warning(`${data.name}: dataset unavailable (${reason})`, { description: String(data.error).slice(0, 120) }));
              }
              patchStreamingMsg(m => {
                if (!m.toolEvents) return { toolEvents: [{ name: data.name, status: data.status, error: data.error, result: data.result, degraded: data.degraded }] };
                const events = [...m.toolEvents];
                const idx = events.findIndex(e => e.name === data.name && (e.status === 'pending' || e.status === 'blocked'));
                if (idx >= 0) events[idx] = { ...events[idx], status: data.status, error: data.error, result: data.result, degraded: data.degraded };
                else events.push({ name: data.name, status: data.status, error: data.error, result: data.result, degraded: data.degraded });
                return { toolEvents: events };
              });
            }
            if (data.commands && Array.isArray(data.commands)) {
              for (const cmd of data.commands) {
                receivedCommands.push({ action: cmd.action, label: cmd.label, lat: cmd.lat, lon: cmd.lon, layerId: cmd.layerId });
              }
              executeAgentCommands(data.commands);
            }
            if (data.type === 'intent') {
              if (data.location) focusLocation(data.location.lat, data.location.lon, { label: data.location.label || 'Location', color: '#60a5fa', height: 20000 });
              if (data.layerIds) (data.layerIds as string[]).forEach((lid: string) => { if (!isLayerEnabled(lid)) toggleLayer(lid); });
            }
            if (data.type === 'output') {
              finalText = data.text;
              if (data.traceId) lastTraceId = data.traceId;
              if (data.modelTier) lastModelTier = data.modelTier;
              if (data.recipe) lastRecipe = data.recipe as AiRecipe;
              if (data.replayed !== undefined) lastReplayed = data.replayed as boolean;
              if (data.patternId) lastPatternId = data.patternId as string;
              setAgentSteps((prev: AgentStep[]) => {
                let found = false;
                const next = prev.map(s => {
                  if (s.type === 'streaming' && s.status === 'running') {
                    found = true;
                    return { ...s, status: 'completed', text: 'Response generated', timeMs: Date.now() - (s.startedAt || Date.now()) };
                  }
                  return s;
                });
                return found ? next : prev;
              });
            }
            // Study area request — the server asks the user to choose how to
            // define the spatial boundary before running a computation.
            if (data.type === 'study_area_request') {
              if (streamTabId) {
                store.getState().setTabTyping(streamTabId, false);
              } else {
                store.getState().setAiTyping(false);
              }
              addMessage({
                id: nextAiMsgIdRef.current++,
                role: 'assistant',
                content: data.query ? `**Study area needed**\n\n${data.message || 'This analysis needs a study area boundary. Choose how to proceed:'}` : '',
                studyAreaRequest: {
                  query: data.query || '',
                  location: data.location,
                  detectedBbox: data.detectedBbox,
                  options: data.options || [],
                },
              });
              // The stream ends after this event — skip remaining processing.
              // (The server sends done right after.)
              return;
            }
            if (data.type === 'panel' || (data.stats && data.charts)) {
              options.onPanel?.(data);
            }
            // Analytical compute → globe: when the agent runs analytical_execute
            // and the server streams the real computed spatial grid back, hand it
            // to the globe renderer so the result appears as a heatmap over the
            // study area (not just text in the chat).
            if (data.type === 'analytical_result') {
              options.onAnalyticalResult?.(data);
            }
            if (data.type === 'done' && data.traceId) lastTraceId = data.traceId;
            if (data.type === 'error') serverError = data.error || data.message || 'Unknown server error';
          } catch { /* skip malformed JSON */ }
        }
      };

      flushTimer = setInterval(flushTokens, 40);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processLines();
      }
      processLines();
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
      flushTokens();

      if (serverError) {
        if (streamingMsgId !== null) {
          patchStreamingMsg(m => ({ content: `${m.content}\n\n⚠️ Server error: ${serverError}` }));
        } else {
          addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: `⚠️ Server error: ${serverError}` });
        }
      } else if (finalText) {
        const { cleanedContent, artifacts } = extractArtifacts(finalText);
        const msgPatch: Partial<ChatMessage> = {
          content: artifacts.length > 0 ? cleanedContent : finalText,
          traceId: lastTraceId,
          commands: receivedCommands.length > 0 ? receivedCommands : undefined,
          modelTier: lastModelTier,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          resumable: true,
          recipe: lastRecipe || undefined,
          replayed: lastReplayed,
          patternId: lastPatternId,
        };
        if (streamingMsgId !== null) {
          updateMessage(streamingMsgId, msgPatch);
        } else {
          addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: finalText, ...msgPatch });
        }
        store.getState().streamingMdRef.current.reset();
      } else if (streamingMsgId === null) {
        const fallback = await generateLocalResponse(userMsg, loc);
        addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: fallback });
      }

      // Cache session
      const finalMessages = streamTabId
        ? (store.getState().chatTabs.find(t => t.id === streamTabId)?.messages ?? store.getState().aiMessages)
        : store.getState().aiMessages;
      await cacheChatSession(sessionId, finalMessages);
    } catch (e) {
      // Flush any buffered tokens so a mid-stream abort/error keeps the text
      // that already arrived, before appending the stop/error notice.
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
      flushTokens();
      if ((e as Error)?.name === 'AbortError') {
        if (streamingMsgId !== null) {
          patchStreamingMsg(m => ({ content: `${m.content}\n\n*⏹ Stopped.*` }));
        } else {
          addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: '⏹ Response stopped.' });
        }
      } else {
        const fallback = await generateLocalResponse(userMsg, null);
        if (streamingMsgId !== null) {
          patchStreamingMsg(m => ({ content: `${m.content}\n\n${fallback}\n\n*(Agent unavailable: ${e})*` }));
        } else {
          addMessage({ id: nextAiMsgIdRef.current++, role: 'assistant', content: `${fallback}\n\n*(Agent unavailable: ${e})*` });
        }
      }
    }

    cleanupThinkingSteps(true);
    setAiTyping(false);
    abortControllerRef.current = null;
    if (options.abortControllerRef) options.abortControllerRef.current = null;
    if (streamTabId) store.getState().registerTabAbort(streamTabId, null);
  }, [extractLocation, focusLocation, toggleLayer, isLayerEnabled, sendToPipeline,
    sendMonitorCommand, sendScheduleCommand, executeAgentCommands, generateLocalResponse,
    cleanupThinkingSteps, loadFlightTracks, viewerRef, options, store]);

  const stopGeneration = useCallback(() => {
    const activeTabId = store.getState().activeTabId;
    if (activeTabId) store.getState().abortTabStream(activeTabId);
    abortControllerRef.current?.abort();
    if (options.abortControllerRef) options.abortControllerRef.current = null;
    if (activeTabId) store.getState().setTabTyping(activeTabId, false);
    else store.getState().setAiTyping(false);
    cleanupThinkingSteps(true);
  }, [cleanupThinkingSteps, store, options]);

  return {
    sendAI,
    stopGeneration,
    abortControllerRef,
    currentRequestIdRef,
  };
}
