export type EventType =
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'mcp'
  | 'hook'
  | 'skill'
  | 'system_reminder'
  | 'subagent'
  | 'api_turn'
  | 'cache'
  | 'attachment';

export interface AgentEvent {
  ts: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  source: string;
  sessionLabel: string;
  type: EventType;
  subtype?: string;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  detail: string;
  durationApproxMs?: number;
  payload?: unknown;
  tags: Record<string, string>;
  category: string;
  // Internal fields — stripped before export
  raw?: unknown;
  turnUsage?: unknown;
}
