export interface SessionRef {
  source: string;
  id: string;
  jsonlPath: string;
  projectDir: string;
  projectLabel: string;
  lastActivity: Date;
  sizeBytes: number;
  /**
   * For sub-agent sessions: the session id of the parent that spawned this
   * agent (Gap 6 — hybrid sub-agent linkage). Populated by the adapter when
   * it discovers `<parent-session>/<parent-id>/subagents/agent-<agentId>.jsonl`.
   * Unset for top-level sessions.
   */
  parentSessionId?: string;
  /**
   * For sub-agent sessions: the parent's `tool_use.id` (the `Agent` invocation
   * that spawned this). Comes from the matching `agent-<agentId>.meta.json`'s
   * `toolUseId`. Lets us correlate a parent's spawn event with its child
   * session and render the jump-to-child action.
   */
  parentToolUseId?: string;
  /**
   * For sub-agent sessions: the agent type from the meta file (e.g. "Explore",
   * "general-purpose"). Used to label child rows in `top`.
   */
  agentType?: string;
}

export interface LastUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

export interface SessionSummary {
  assistantTurns: number;
  lastModel: string | null;
  billedInput: number;
  cacheRead: number;
  outputTokens: number;
  cacheReadPct: number;
  firstTs: string | null;
  lastTs: string | null;
  lastUsage: LastUsage | null;
}

export interface EnrichedSession extends SessionRef {
  model: string | null;
  turns: number;
  billedInput: number;
  cacheReadPct: number;
}

/**
 * What an adapter can actually surface from this agent's logs.
 *
 * - 'discover'  — can list sessions on disk
 * - 'load'      — can parse session entries into raw JSON objects
 * - 'summary'   — `summarizeSession` returns real token / cache / turn counts.
 *                  Missing this means the adapter is "discovery only" — sessions
 *                  show up in `top` but BILLED_IN / CACHE% / TURNS are unknown.
 * - 'cache'     — `summary.cacheRead` is meaningful (vs always 0).
 *
 * The capability set is exported as `CAPABILITIES` from each adapter module
 * and consulted by `agentshark adapters`, the top view, and the docs to
 * surface gaps honestly instead of showing 0 as a real value.
 */
export type AdapterCapability = 'discover' | 'load' | 'summary' | 'cache';

export interface Adapter {
  NAME: string;
  CAPABILITIES: Set<AdapterCapability>;
  detect(): Promise<boolean>;
  discoverSessions(opts?: { limit?: number }): Promise<SessionRef[]>;
  loadSessionEntries(ref: SessionRef): Promise<unknown[]>;
  summarizeSession(entries: unknown[]): SessionSummary;
}
