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
  /**
   * Per-event cache classification of the surrounding api_turn (Gap 3,
   * `docs/design.md` § 6). Populated during extraction so cache badges and
   * filters can render and match per-event, not just on dedicated `cache`-type
   * events. Possible values: 'hit' / 'write' / 'none'. Optional for backwards
   * compatibility with old `.aspark` replays that predate this field.
   */
  cacheState?: 'hit' | 'write' | 'none';
  durationApproxMs?: number;
  payload?: unknown;
  tags: Record<string, string>;
  category: string;
  // `raw` is the original JSONL entry — stripped before export. `turnUsage`
  // is the per-turn usage object set on `api_turn` events; it is preserved
  // through export so context-composition can be recomputed in replay.
  raw?: unknown;
  turnUsage?: unknown;
}
