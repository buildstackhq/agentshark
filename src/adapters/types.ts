export interface SessionRef {
  source: string;
  id: string;
  jsonlPath: string;
  projectDir: string;
  projectLabel: string;
  lastActivity: Date;
  sizeBytes: number;
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

export interface Adapter {
  NAME: string;
  detect(): Promise<boolean>;
  discoverSessions(opts?: { limit?: number }): Promise<SessionRef[]>;
  loadSessionEntries(ref: SessionRef): Promise<unknown[]>;
  summarizeSession(entries: unknown[]): SessionSummary;
}
