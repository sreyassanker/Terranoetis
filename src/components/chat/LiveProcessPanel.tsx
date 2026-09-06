import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Hourglass,
  ScanSearch, Wrench, TerminalSquare, Sparkles, Braces, Database, Network,
  Brain, Zap, Cpu, Eye, ListChecks, Layers, Bot, PenLine,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentStep, PipelineStep } from '@/store/chatStore';
import { useChatStore } from '@/store/chatStore';
import { useShallow } from 'zustand/react/shallow';

// Claude Code-style braille-dot spinner frames.
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 120;

/** Single shared 120ms clock for every spinner on the page (one interval,
 *  not one per component). */
const tickListeners = new Set<(now: number) => void>();
let tickInterval: ReturnType<typeof setInterval> | null = null;
function subscribeTick(fn: (now: number) => void): () => void {
  tickListeners.add(fn);
  if (!tickInterval) {
    tickInterval = setInterval(() => {
      const now = Date.now();
      tickListeners.forEach(l => l(now));
    }, FRAME_MS);
  }
  return () => {
    tickListeners.delete(fn);
    if (tickListeners.size === 0 && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };
}

/** Honors prefers-reduced-motion: spinners freeze, verbs stop cycling. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Action verbs cycled while a step is running (Claude Code rotates its verb
// list as it works). Each phase gets its own flavour; unknown phases fall
// back to the generic set.
const PHASE_VERBS: Record<string, string[]> = {
  classifying: ['Classifying', 'Detecting', 'Parsing'],
  agent_thinking: ['Reasoning', 'Thinking', 'Evaluating'],
  reasoning: ['Reasoning', 'Thinking', 'Evaluating'],
  orchestrating: ['Orchestrating', 'Coordinating', 'Dispatching'],
  tool_execution: ['Executing', 'Running', 'Querying'],
  synthesis: ['Synthesizing', 'Combining', 'Drafting'],
  parsing: ['Parsing', 'Structuring', 'Formatting'],
  memory_recall: ['Recalling', 'Searching', 'Retrieving'],
  multimodal: ['Analyzing', 'Scanning', 'Inspecting'],
  cache_check: ['Checking', 'Scanning', 'Verifying'],
  streaming: ['Generating', 'Writing', 'Streaming'],
  planning: ['Planning', 'Designing', 'Scheduling'],
};
const DEFAULT_VERBS = ['Working', 'Processing', 'Thinking'];

function brailleFrame(nowMs: number, seed = 0): string {
  return BRAILLE_FRAMES[Math.floor(nowMs / FRAME_MS + seed) % BRAILLE_FRAMES.length];
}

/** Self-contained Claude Code-style braille-dot spinner (shared clock). */
export function BrailleSpinner({ seed = 0, size = 'md' }: { seed?: number; size?: 'sm' | 'md' }) {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(() => (reduced ? '⠸' : brailleFrame(Date.now(), seed)));
  useEffect(() => {
    // Reduced motion: hold a static frame (set from the initializer above);
    // no subscription, so no setState in the effect body.
    if (reduced) return;
    return subscribeTick(now => setFrame(brailleFrame(now, seed)));
  }, [seed, reduced]);
  return (
    <span className={`braille-spin${size === 'sm' ? ' braille-node' : ''}`} aria-hidden="true">
      {frame}
    </span>
  );
}

const PHASE_LABEL: Record<string, string> = {
  classifying: 'Classifying intent',
  model_tier: 'Model tier',
  cache_check: 'Checking cache',
  cache_hit: 'Cache hit',
  orchestrating: 'Orchestrating agents',
  agent_thinking: 'Reasoning',
  memory_recall: 'Memory recall',
  multimodal: 'Vision analysis',
  multimodal_fallback: 'Vision fallback',
  tool_execution: 'Tool execution',
  synthesis: 'Synthesis',
  parsing: 'Parsing output',
  planning: 'Planning',
  reasoning: 'Reasoning',
  subtask: 'Subtask',
  pipeline: 'Pipeline step',
  streaming: 'Generating response',
  error: 'Error',
};

const PHASE_COLOR: Record<string, string> = {
  classifying: '#8b5cf6',
  model_tier: '#06b6d4',
  cache_check: '#eab308',
  cache_hit: '#22c55e',
  orchestrating: '#f97316',
  agent_thinking: '#60a5fa',
  memory_recall: '#14b8a6',
  multimodal: '#f43f5e',
  multimodal_fallback: '#f43f5e',
  tool_execution: '#6366f1',
  synthesis: '#22c55e',
  parsing: '#ec4899',
  planning: '#0ea5e9',
  reasoning: '#60a5fa',
  subtask: '#a3e635',
  pipeline: '#f97316',
  streaming: '#818cf8',
  error: '#ef4444',
};

function phaseIcon(type: string): LucideIcon {
  switch (type) {
    case 'classifying': return ScanSearch;
    case 'model_tier': return Cpu;
    case 'cache_check': case 'memory_recall': return Database;
    case 'cache_hit': return Zap;
    case 'orchestrating': return Network;
    case 'agent_thinking': case 'reasoning': return Brain;
    case 'multimodal': case 'multimodal_fallback': return Eye;
    case 'tool_execution': return Wrench;
    case 'synthesis': return Sparkles;
    case 'parsing': return Braces;
    case 'planning': return ListChecks;
    case 'subtask': return Layers;
    case 'pipeline': return Hourglass;
    case 'streaming': return PenLine;
    case 'error': return XCircle;
    default: {
      const t = type.toLowerCase();
      if (t.includes('code') || t.includes('execut')) return TerminalSquare;
      if (t.includes('tool')) return Wrench;
      return Bot;
    }
  }
}

function phaseLabel(type: string): string {
  if (PHASE_LABEL[type]) return PHASE_LABEL[type];
  const t = type.toLowerCase().replace(/[_-]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function phaseColor(type: string): string {
  return PHASE_COLOR[type] || '#60a5fa';
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const tenths = Math.floor((ms % 1000) / 100);
  if (m > 0) return `${m}m ${s % 60}s`;
  if (s > 0) return `${s}.${tenths}s`;
  return `${Math.max(0, ms)}ms`;
}

function stepTime(step: AgentStep, nowMs: number): string | null {
  if (step.timeMs !== undefined && step.timeMs > 0) return fmtDuration(step.timeMs);
  // Only a LIVE running step may derive its duration from the wall clock.
  // Completed/failed steps without timeMs show nothing — otherwise a panel
  // restored from localStorage would print "now - yesterday" as the time.
  if (step.status === 'running' && step.startedAt !== undefined) {
    const ms = Math.max(0, nowMs - step.startedAt);
    if (ms <= 0) return null;
    return fmtDuration(ms);
  }
  return null;
}

/** Re-tick every intervalMs while `active` is true (live elapsed timers).
 *  Reduced-motion users get a 1s cadence instead of 120ms. */
function useNow(active: boolean, intervalMs = 250, reduced = false): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const ms = reduced ? 1000 : intervalMs;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, intervalMs, reduced]);
  return now;
}

export default function LiveProcessPanel({
  agentSteps,
  pipelineProgress,
}: {
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
}) {
  const { thinkingExpanded, setThinkingExpanded, expandedStep, setExpandedStep } = useChatStore(useShallow(state => ({
    thinkingExpanded: state.thinkingExpanded,
    setThinkingExpanded: state.setThinkingExpanded,
    expandedStep: state.expandedStep,
    setExpandedStep: state.setExpandedStep,
  })));
  const reduced = usePrefersReducedMotion();

  const steps = useMemo<AgentStep[]>(() => [
    ...agentSteps,
    ...pipelineProgress.map(p => ({ type: 'pipeline', text: p.description, status: p.status })),
  ], [agentSteps, pipelineProgress]);

  const total = steps.length;
  const runningCount = steps.filter(s => s.status === 'running').length;
  const doneCount = steps.filter(s => s.status === 'completed' || s.status === 'failed').length;
  const active = runningCount > 0;
  const allDone = total > 0 && !active;
  const now = useNow(active, 120, reduced);
  const startMs = steps[0]?.startedAt ?? now;
  // While active the header timer is live wall-clock time. Once finished
  // (including a panel restored from localStorage after a reload) it must
  // show the ACTUAL work duration — summing recorded step times — never
  // "now - a startedAt from yesterday".
  const workMs = steps.reduce((acc, s) => acc + (s.timeMs && s.timeMs > 0 ? s.timeMs : 0), 0);
  const spanMs = Math.max(0, (steps[steps.length - 1]?.startedAt ?? startMs) - startMs);
  const elapsedMs = active ? Math.max(0, now - startMs) : (workMs > 0 ? workMs : spanMs);

  const runningStep = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].status === 'running') return steps[i];
    return undefined;
  }, [steps]);
  const currentStep = runningStep ?? steps[steps.length - 1];
  const currentColor = currentStep ? phaseColor(currentStep.type) : '#60a5fa';

  // Claude Code cycles action verbs while a step is running. Under
  // reduced-motion the first verb is held stable.
  const verbFor = (nowMs: number, type: string, seed: number): string => {
    const verbs = PHASE_VERBS[type] ?? DEFAULT_VERBS;
    if (reduced) return verbs[0];
    return verbs[Math.floor(nowMs / 600 + seed) % verbs.length];
  };

  if (total === 0) return null;

  const title = runningStep
    ? `${verbFor(now, runningStep.type, 0)}…`
    : allDone
      ? `Process complete — ${doneCount}/${total} steps`
      : currentStep?.text || 'Processing…';

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    // Stable accessible name; the fast-cycling verb/timer spans are
    // aria-hidden so screen readers are not re-announced every 600ms.
    <div className="live-process" role="status" aria-label="Agent process">
      <button
        type="button"
        className="live-process-header"
        onClick={() => setThinkingExpanded(!thinkingExpanded)}
        aria-expanded={thinkingExpanded}
      >
        <span className="live-process-status" style={{ color: active ? currentColor : allDone ? '#22c55e' : '#94a3b8' }} aria-hidden="true">
          {active
            ? <BrailleSpinner />
            : allDone
              ? <CheckCircle2 size={14} />
              : <Bot size={14} />}
        </span>
        <span className="live-process-title" aria-hidden="true">{title}</span>
        <span className="live-process-meta" aria-hidden="true">
          <span className="live-process-count">{doneCount}/{total}</span>
          {(active || allDone) && <span className={`live-process-timer${active ? ' ticking' : ''}`}>{fmtDuration(elapsedMs)}</span>}
        </span>
        <span className="live-process-chevron">{thinkingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      <div className="live-process-progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
      {thinkingExpanded && (
        <div className="live-process-body">
          {steps.map((step, i) => {
            const st = step.status || 'pending';
            const cls = st === 'running' ? 'running' : st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : 'pending';
            const color = phaseColor(step.type);
            const Icon = phaseIcon(step.type);
            const time = stepTime(step, now);
            const expanded = expandedStep === i;
            const hasDetail = !!(step.code || step.output);
            return (
              <div
                key={i}
                className={`live-step ${cls}`}
                style={{ '--step-color': color, animationDelay: `${Math.min(i, 10) * 45}ms` } as React.CSSProperties}
              >
                <div className="live-step-rail" aria-hidden="true">
                  <span className={`live-step-node ${cls}`}>
                    {st === 'running'
                      ? <BrailleSpinner seed={i} size="sm" />
                      : st === 'completed'
                        ? <CheckCircle2 size={11} />
                        : st === 'failed'
                          ? <XCircle size={11} />
                          : <span className="live-step-dot" />}
                  </span>
                  {i < steps.length - 1 && <span className="live-step-line" />}
                </div>
                <div
                  className="live-step-content"
                  role="button"
                  tabIndex={0}
                  aria-expanded={hasDetail ? expanded : undefined}
                  onClick={() => hasDetail && setExpandedStep(expanded ? null : i)}
                  onKeyDown={e => {
                    if (!hasDetail) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedStep(expanded ? null : i);
                    }
                  }}
                >
                  <div className="live-step-label">
                    <Icon size={11} style={{ display: 'inline', marginRight: 4, color }} />
                    {phaseLabel(step.type)}
                  </div>
                  <div className="live-step-text">{step.text || 'Working…'}</div>
                  <div className="live-step-foot">
                    {time && <span className="live-step-time">{time}</span>}
                    {hasDetail && (
                      <span className="live-step-chevron">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
                    )}
                  </div>
                  {expanded && hasDetail && (
                    <div className="think-step-detail">
                      {step.code && <div className="think-code-block"><div className="think-code-label">Code</div><pre className="think-code">{step.code}</pre></div>}
                      {step.output && <div className="think-output-block"><div className="think-output-label">Output</div><pre className="think-output">{step.output}</pre></div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {active && (
            <div className="live-process-live" aria-hidden="true">
              <span className="live-process-live-dot" style={{ background: currentColor }} />
              <span className="live-process-live-text" style={{ color: currentColor }}>Live — updating…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
