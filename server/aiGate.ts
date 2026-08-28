/**
 * AI usage gate.
 *
 * Controls whether autonomous/background AI generation is allowed.
 * When CHAT_ONLY mode is on, the LLM is only invoked by the AI chat panel
 * flow (/api/agent/* endpoints). Background timers and proactive systems
 * must check `isAutonomousAiAllowed()` before calling omninet.
 *
 * Enable autonomous AI with AUTONOMOUS_AI=1 in .env (default: off — chat only).
 */
const autonomousEnabled = process.env.AUTONOMOUS_AI === '1' || process.env.AUTONOMOUS_AI === 'true';

export function isAutonomousAiAllowed(): boolean {
  return autonomousEnabled;
}
