export interface ToolEvent {
  name: string;
  args?: Record<string, unknown>;
  description?: string;
  status?: 'pending' | 'success' | 'error' | 'unknown' | 'blocked';
  error?: string;
  result?: unknown;
  riskLevel?: 'low' | 'medium' | 'high' | 'destructive';
  approvalRequired?: boolean;
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

export async function listChats(): Promise<ChatListItem[]> {
  const resp = await fetch('/api/chats');
  if (!resp.ok) return [];
  return resp.json();
}

export async function getChat(id: string): Promise<ChatSession | null> {
  const resp = await fetch(`/api/chats/${encodeURIComponent(id)}`);
  if (!resp.ok) return null;
  return resp.json();
}

export async function saveChat(session: Partial<ChatSession> & { id: string }): Promise<boolean> {
  const resp = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  return resp.ok;
}

export async function deleteChat(id: string): Promise<boolean> {
  const resp = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return resp.ok;
}

export function generateChatId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function groupChatsByDate(chats: ChatListItem[]): Array<{ label: string; items: ChatListItem[] }> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const thisWeek = today - now.getDay() * 86400000;
  const lastWeek = thisWeek - 7 * 86400000;
  const groups: Record<string, ChatListItem[]> = {};

  for (const chat of chats) {
    const t = new Date(chat.updatedAt || chat.createdAt).getTime();
    let label: string;
    if (t >= today) label = 'Today';
    else if (t >= yesterday) label = 'Yesterday';
    else if (t >= thisWeek) label = 'This Week';
    else if (t >= lastWeek) label = 'Last Week';
    else label = 'Earlier';
    if (!groups[label]) groups[label] = [];
    groups[label].push(chat);
  }
  const order = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Earlier'];
  return order.filter(l => groups[l]).map(label => ({ label, items: groups[label] }));
}

export function autoTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'New Chat';
  const text = first.content.replace(/^📷\s*\[Image:[^\]]*\]\s*/i, '').replace(/^📊\s*\[Data[^\]]*\]\s*/i, '').trim();
  if (!text) return 'New Chat';
  return text.length > 50 ? text.slice(0, 50) + '...' : text;
}
