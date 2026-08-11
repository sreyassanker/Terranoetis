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
  digital_twin: ['Analyzing', 'Modeling', 'Simulating'],
  cache_check: ['Checking', 'Scanning', 'Verifying'],
  streaming: ['Generating', 'Writing', 'Streaming'],
  planning: ['Planning', 'Designing', 'Scheduling'],
};
const DEFAULT_VERBS = ['Working', 'Processing', 'Thinking'];

function brailleFrame(nowMs: number, seed = 0): string {
  return BRAILLE_FRAMES[Math.floor(nowMs / FRAME_MS + seed) % BRAILLE_FRAMES.length];
}

/** Self-contained Claude Code-style braille spinner (own 120ms interval). */
export function BrailleSpinner({ seed = 0, size = 'md' }: { seed?: number; size?: 'sm' | 'md' }) {
  const [frame, setFrame] = useState(() => brailleFrame(Date.now(), seed));
  useEffect(() => {
    const id = setInterval(() => setFrame(brailleFrame(Date.now(), seed)), FRAME_MS);
    return () => clearInterval(id);
  }, [seed]);
  return (
    <span className={`braille-spin${size === 'sm' ? ' braille-node' : ''}`} aria-hidden="true">
      {frame}
    </span>
  );
}

const PHASE_LABEL: Record<string, string> = {
  classifying: 'Classifying intent',
  model_tier: 'Model tier',
  digital_twin: 'Digital twin analysis',
  digital_twin_complete: 'Digital twin analysis',
  digital_twin_error: 'Digital twin analysis',
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
  digital_twin: '#a855f7',
  digital_twin_complete: '#a855f7',
  digital_twin_error: '#ef4444',
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
    case 'digital_twin': case 'digital_twin_complete': case 'digital_twin_error': return Brain;
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
  if (step.startedAt !== undefined) {
    const ms = Math.max(0, nowMs - step.startedAt);
    if (ms <= 0) return null;
    return fmtDuration(ms);
  }
  return null;
}

/** Re-tick every intervalMs while `active` is true (live elapsed timers). */
function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
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

  const steps = useMemo<AgentStep[]>(() => [
    ...agentSteps,
    ...pipelineProgress.map(p => ({ type: 'pipeline', text: p.description, status: p.status })),
  ], [agentSteps, pipelineProgress]);

  const total = steps.length;
  const runningCount = steps.filter(s => s.status === 'running').length;
  const doneCount = steps.filter(s => s.status === 'completed' || s.status === 'failed').length;
  const active = runningCount > 0;
  const allDone = total > 0 && !active;
  const now = useNow(active, 120);
  const startMs = steps[0]?.startedAt ?? now;
  const elapsedMs = Math.max(0, now - startMs);

  const runningStep = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].status === 'running') return steps[i];
    return undefined;
  }, [steps]);
  const currentStep = runningStep ?? steps[steps.length - 1];
  const currentColor = currentStep ? phaseColor(currentStep.type) : '#60a5fa';

  // Claude Code cycles action verbs while a step is running. Use the ticking
  // clock so the verb rotates smoothly without a separate interval.
  const verbFor = (nowMs: number, type: string, seed: number): string => {
    const verbs = PHASE_VERBS[type] ?? DEFAULT_VERBS;
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
    <div className="live-process" role="status" aria-label={`Agent process: ${title}`}>
      <div className="live-process-header" onClick={() => setThinkingExpanded(!thinkingExpanded)}>
        <span className="live-process-status" style={{ color: active ? currentColor : allDone ? '#22c55e' : '#94a3b8' }}>
          {active
            ? <BrailleSpinner />
            : allDone
              ? <CheckCircle2 size={13} />
              : <Bot size={13} />}
        </span>
        <span className="live-process-title">{title}</span>
        <span className="live-process-meta">
          <span className="live-process-count">{doneCount}/{total}</span>
          {(active || allDone) && <span className={`live-process-timer${active ? ' ticking' : ''}`}>{fmtDuration(elapsedMs)}</span>}
        </span>
        <span className="live-process-chevron">{thinkingExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
      </div>
      <div className="live-process-progress"><div style={{ width: `${pct}%` }} /></div>
      {thinkingExpanded && (
        <div className="live-process-body">
          {steps.map((step, i) => {
            const st = step.status || 'pending';
            const cls = st === 'running' ? 'running' : st === 'completed' ? 'completed' : st === 'failed' ? 'failed' : 'pending';
            const color = phaseColor(step.type);
            const Icon = phaseIcon(step.type);
            const time = stepTime(step, now);
            const expanded = expandedStep === i;
            return (
              <div
                key={i}
                className={`live-step ${cls}`}
                style={{ '--step-color': color, animationDelay: `${Math.min(i, 10) * 45}ms` } as React.CSSProperties}
              >
                <div className="live-step-rail">
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
                <div className="live-step-content" onClick={() => setExpandedStep(expanded ? null : i)}>
                  <div className="live-step-label">
                    <Icon size={9} style={{ display: 'inline', marginRight: 4, color }} />
                    {phaseLabel(step.type)}
                  </div>
                  <div className="live-step-text">{step.text || 'Working…'}</div>
                  <div className="live-step-foot">
                    {time && <span className="live-step-time">{time}</span>}
                    {(step.code || step.output) && (
                      <span className="live-step-chevron">{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
                    )}
                  </div>
                  {expanded && (
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
            <div className="live-process-live">
              <span className="live-process-live-dot" style={{ background: currentColor }} />
              <span className="live-process-live-text" style={{ color: currentColor }}>Live — updating…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
