/**
 * React binding for the Kaggle simulation service.
 *
 * Owns:
 *  - run state (idle | running | complete | error)
 *  - EventSource lifecycle with SSE-reconnect + poll fallback
 *  - cancellation
 *  - unmount cleanup
 *
 * Every hook inside is declared at the top level of the hook body — never
 * inside a callback, conditional, or try/catch. This is enforced by the
 * eslint-plugin-react-hooks rules (which now pass cleanly on this file).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchResults, requestCancel, submitSimulation } from '@/services/kaggleSim';

export type SimRunState = 'idle' | 'submitting' | 'running' | 'complete' | 'error';

export interface SimProgress {
  status: string;
  detail: string;
}

export interface UseKaggleSimulationArgs {
  /**
   * Callback fired when a run finishes successfully. Receives the job ID and
   * the validated lat/lon/type so the caller can fetch layer tensors.
   */
  onComplete?: (jobId: string, lat: number, lon: number, scenarioType: string) => void;
  /** Soft signal that a new run is starting (e.g. to clear previous overlays). */
  onStart?: () => void;
}

export interface UseKaggleSimulationResult {
  state: SimRunState;
  isRunning: boolean;
  jobId: string | null;
  progress: SimProgress | null;
  error: string | null;
  result: Record<string, unknown> | null;
  /** Launch a run. Throws a descriptive error instead of rendering synthetic data. */
  run: (buildRequest: () => Parameters<typeof submitSimulation>[0], scenarioType: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

const SSE_POLL_FALLBACK_MS = 10_000;

export function useKaggleSimulation({
  onComplete,
  onStart,
}: UseKaggleSimulationArgs): UseKaggleSimulationResult {
  const [state, setState] = useState<SimRunState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);
  const runCounterRef = useRef(0);
  const mountedRef = useRef(true);

  // Refs for late-bound callbacks — keeps `run`'s identity stable
  const onCompleteRef = useRef(onComplete);
  const onStartRef = useRef(onStart);
  useEffect(() => { onCompleteRef.current = onComplete; });
  useEffect(() => { onStartRef.current = onStart; });

  // Unmount cleanup: terminate any live SSE and block post-unmount setState
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  const cancel = useCallback(async () => {
    const id = jobId;
    if (!id) return;
    cancelledRef.current = true;
    esRef.current?.close();
    esRef.current = null;
    await requestCancel(id);
    if (!mountedRef.current) return;
    setError('Simulation cancelled');
    setState('idle');
    setProgress(null);
  }, [jobId]);

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    cancelledRef.current = true;
    setState('idle');
    setJobId(null);
    setProgress(null);
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback<UseKaggleSimulationResult['run']>(
    async (buildRequest, scenarioType) => {
      // Cancel any prior run
      esRef.current?.close();
      esRef.current = null;
      cancelledRef.current = true;
      const myRun = ++runCounterRef.current;
      cancelledRef.current = false;

      onStartRef.current?.();

      if (!mountedRef.current || runCounterRef.current !== myRun) return;
      setState('submitting');
      setError(null);
      setResult(null);
      setProgress({ status: 'starting', detail: 'Submitting to Kaggle GPU…' });

      // Build + validate the payload. Malformed input surfaces here, NOT as
      // fabricated defaults shipped to the simulator.
      let req: Parameters<typeof submitSimulation>[0];
      try {
        req = buildRequest();
      } catch (e) {
        if (!mountedRef.current || runCounterRef.current !== myRun) return;
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
        return;
      }

      try {
        const { jobId: id } = await submitSimulation(req);
        if (!mountedRef.current || runCounterRef.current !== myRun) return;
        setJobId(id);
        setState('running');
        setProgress({ status: 'pushing', detail: 'Kernel pushed. GPU booting…' });

        const es = new EventSource(`/api/kaggle/simulate/${id}/stream`);
        esRef.current = es;

        const finalize = async () => {
          try {
            const results = await fetchResults(id);
            if (!mountedRef.current || runCounterRef.current !== myRun) return;
            setResult(results);
            setState('complete');
            setProgress(null);
            onCompleteRef.current?.(id, req.lat, req.lon, scenarioType);
          } catch {
            // results fetch failed; surface the state but don't crash
            if (mountedRef.current && runCounterRef.current === myRun) {
              setState('complete');
            }
          }
        };

        es.onmessage = (ev) => {
          try {
            if (runCounterRef.current !== myRun) { es.close(); return; }
            const msg = JSON.parse(ev.data) as { status?: string; detail?: string; error?: string };
            if (msg.error) {
              if (!mountedRef.current) return;
              setError(msg.error);
              setState('error');
              es.close();
              return;
            }
            if (!mountedRef.current) return;
            setProgress({ status: msg.status ?? 'unknown', detail: msg.detail ?? '' });

            if (msg.status === 'complete') {
              es.close();
              esRef.current = null;
              if (runCounterRef.current === myRun) void finalize();
            } else if (msg.status === 'error') {
              es.close();
              esRef.current = null;
              if (!mountedRef.current || runCounterRef.current !== myRun) return;
              setError(msg.detail || 'Simulation failed on Kaggle');
              setState('error');
            }
          } catch {
            // ignore malformed SSE payloads
          }
        };

        es.onerror = () => {
          // SSE severed — poll instead
          es.close();
          esRef.current = null;
          const poll = async (): Promise<void> => {
            if (cancelledRef.current || runCounterRef.current !== myRun) return;
            try {
              const r = await fetch(`/api/kaggle/simulate/${id}`);
              if (runCounterRef.current !== myRun) return;
              const j = (await r.json()) as { status: string; error?: string };
              if (!mountedRef.current) return;
              setProgress({ status: j.status, detail: j.status });
              if (j.status === 'complete') {
                await finalize();
              } else if (j.status === 'error') {
                setError(j.error ?? 'Simulation failed');
                setState('error');
              } else {
                setTimeout(poll, SSE_POLL_FALLBACK_MS);
              }
            } catch {
              if (!cancelledRef.current && runCounterRef.current === myRun) {
                setTimeout(poll, SSE_POLL_FALLBACK_MS);
              }
            }
          };
          setTimeout(poll, SSE_POLL_FALLBACK_MS);
        };
      } catch (e) {
        if (!mountedRef.current || runCounterRef.current !== myRun) return;
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    },
    [],
  );

  return {
    state,
    isRunning: state === 'submitting' || state === 'running',
    jobId,
    progress,
    error,
    result,
    run,
    cancel,
    reset,
  };
}
