/**
 * Shared chat model types.
 *
 * These live outside React components (plain .ts) so the server can import
 * them without a --jsx transform.
 */

export interface Reaction {
  type: 'like' | 'dislike' | 'heart' | 'rocket' | 'eyes' | 'zap';
  count: number;
  userIds: string[];
}

export interface ThreadReply {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ToolEvent {
  name: string;
  args?: Record<string, unknown>;
  description?: string;
  status?: 'pending' | 'success' | 'error' | 'unknown' | 'blocked';
  error?: string;
  result?: unknown;
  riskLevel?: 'low' | 'medium' | 'high' | 'destructive';
  approvalRequired?: boolean;
  /** Single-use, user-bound, expiring token minted server-side when a destructive
   *  tool was blocked. Required to approve execution via /api/agent/approve. */
  approvalId?: string;
  /** Enterprise: true when the dataset is unavailable (missing key / upstream down). */
  degraded?: boolean;
}

export interface SubAgentActivity {
  role: string;
  stepId?: string;
  status: 'starting' | 'thinking' | 'tool_call' | 'tool_result' | 'partial' | 'completed' | 'failed';
  text: string;
  partial?: string;
  timestamp: number;
}

export interface PlanCard {
  id: string;
  query: string;
  steps: Array<{
    id: string;
    description: string;
    rationale?: string;
    agent: string;
    tools?: string[];
    requiresApproval: boolean;
    enabled: boolean;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    output?: string;
    durationMs?: number;
  }>;
  requiresConfirmation: boolean;
  summary: string;
  executed?: boolean;
}

export interface ArtifactData {
  kind: 'table' | 'chart' | 'slider' | 'image' | 'map-link';
  title?: string;
  // table
  columns?: string[];
  rows?: Record<string, string | number>[];
  // chart
  chartType?: 'bar' | 'line' | 'pie' | 'scatter';
  labels?: string[];
  values?: number[];
  // slider (re-runnable query)
  sliderQuery?: string;
  sliderParam?: string;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderValue?: number;
  // image/map
  src?: string;
  lat?: number;
  lon?: number;
  label?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  type?: string;
  data?: unknown;
  feedback?: 'up' | 'down';
  traceId?: string | null;
  modelTier?: string | null;
  commands?: Array<{ action: string; label?: string; lat?: number; lon?: number; layerId?: string }>;
  toolEvents?: ToolEvent[];
  subAgents?: SubAgentActivity[];
  plan?: PlanCard;
  artifacts?: ArtifactData[];
  /** Whether this message can be resumed (#14) */
  resumable?: boolean;
  /** Conversation memory summary snapshot for this turn */
  memoryRecalled?: number;
  /** Attached image uploads rendered inline with the message */
  images?: Array<{ dataUrl: string; mimeType: string; fileName: string }>;
  /** Epoch ms the message was created (displayed when present) */
  timestamp?: number;
  /** Emoji reactions (persisted with the chat's message JSON) */
  reactions?: Reaction[];
  /** Inline thread replies (persisted with the chat's message JSON) */
  threadReplies?: ThreadReply[];
  /** Reusable workflow recipe (emitted by /api/agent/ask) — enables Save */
  recipe?: AiRecipe;
  /** True when this response was replayed from a saved pattern */
  replayed?: boolean;
  /** Pattern id used for the replay */
  patternId?: string;
  /** Interactive study-area request — the AI needs a boundary before computing. */
  studyAreaRequest?: {
    requestId?: string;
    query: string;
    location?: { lat: number; lon: number; label?: string };
    /** Auto-detected boundary (real OSM region box) shown to the user for adjustment. */
    detectedBbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
    options: Array<{ id: 'draw' | 'detected' | 'skip'; label: string; description: string }>;
  };
}

/** A reusable workflow recipe captured from a chat run the user liked. */
export interface AiRecipe {
  intent: string;
  query: string;
  domain: string;
  slots: string[];
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
  commands?: Array<Record<string, unknown>>;
  sampleLocation?: { lat: number; lon: number; label?: string };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  environmentId?: string;
  workspaceId?: string;
}

export interface ChatListItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
