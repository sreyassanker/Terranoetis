import { useCallback } from 'react';
import type { ChatMessage, PlanCard } from '@/lib/chatStore';
import type { AgentStep, PipelineStep } from '@/store/chatStore';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';
import { ChatMessageRow } from './ChatMessageRow';
import { VirtualizedMessageList } from './VirtualizedMessageList';
import type { VirtualizedMessageListHandle } from './VirtualizedMessageList';
import LiveProcessPanel, { BrailleSpinner } from './LiveProcessPanel';

export default function ChatPanelContent({
  aiMessages,
  aiTyping,
  streamingRenderer,
  virtualizedChatRef,
  agentSteps,
  pipelineProgress,
  focusLocation,
  toggleLayer,
  executePlanFromCard,
  togglePlanStep,
  rerunWithParam,
  resumeMessage,
  sendAI,
  onEditMessage,
}: {
  aiMessages: ChatMessage[];
  aiTyping: boolean;
  streamingRenderer: StreamingMarkdownRenderer;
  virtualizedChatRef: React.MutableRefObject<VirtualizedMessageListHandle | null>;
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
  focusLocation: (lat: number, lon: number, opts?: { label?: string; color?: string; height?: number; duration?: number }) => void;
  toggleLayer: (id: string) => void;
  executePlanFromCard: (plan: PlanCard, msgId: number) => void | Promise<void>;
  togglePlanStep: (msgId: number, stepId: string) => void;
  rerunWithParam: (msg: ChatMessage, param: string, value: number) => void;
  resumeMessage: (msg: ChatMessage) => void | Promise<void>;
  sendAI: (msg?: string, opts?: { force?: boolean; regen?: boolean }) => void | Promise<void>;
  onEditMessage: (content: string, messageId: number) => void;
}) {

  const renderMessage = useCallback((msg: ChatMessage, idx: number, isLast: boolean) => (
    <ChatMessageRow
      key={msg.id}
      msg={msg}
      idx={idx}
      isLast={isLast}
      aiTyping={aiTyping}
      streamingRenderer={streamingRenderer}
      focusLocation={focusLocation}
      toggleLayer={toggleLayer}
      executePlanFromCard={executePlanFromCard}
      togglePlanStep={togglePlanStep}
      rerunWithParam={rerunWithParam}
      resumeMessage={resumeMessage}
      sendAI={sendAI}
      onEditMessage={onEditMessage}
    />
  ), [aiTyping, streamingRenderer, focusLocation, toggleLayer, executePlanFromCard, togglePlanStep, rerunWithParam, resumeMessage, sendAI, onEditMessage]);

  return (
    <>
      <VirtualizedMessageList
        ref={virtualizedChatRef}
        messages={aiMessages}
        aiTyping={aiTyping}
        streamingRenderer={streamingRenderer}
        renderItem={renderMessage}
      />

      {agentSteps.length > 0 && (
        <LiveProcessPanel agentSteps={agentSteps} pipelineProgress={pipelineProgress} />
      )}

        {aiTyping && (
          <div className="ai-typing">
            <span className="ai-typing-row">
              <BrailleSpinner />
              <span className="ai-typing-text">Working…</span>
            </span>
          </div>
        )}
      </>
  );
}