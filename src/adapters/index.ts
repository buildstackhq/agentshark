import * as claudeCode from './claudeCode.js';
import * as cowork from './claudeCowork.js';
import * as codex from './codex.js';
import * as cursor from './cursor.js';
import * as geminiCli from './geminiCli.js';
import * as copilotCli from './copilotCli.js';
import type { SessionRef, EnrichedSession, SessionSummary } from './types.js';

export type { SessionRef, EnrichedSession, SessionSummary };
export { claudeCode };

export const ADAPTERS = [claudeCode, cowork, codex, cursor, geminiCli, copilotCli];

export async function discoverAllSessions(opts: { limit?: number } = {}): Promise<SessionRef[]> {
  const results = await Promise.allSettled(ADAPTERS.map(a => a.discoverSessions(opts)));
  return results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .sort((a, b) => +b.lastActivity - +a.lastActivity);
}

export async function loadSessionEntries(ref: SessionRef): Promise<unknown[]> {
  const adapter = ADAPTERS.find(a => a.NAME === ref.source);
  if (!adapter) throw new Error(`No adapter for source: ${ref.source}`);
  return adapter.loadSessionEntries(ref);
}

export function summarizeSession(ref: SessionRef, entries: unknown[]): SessionSummary {
  const adapter = ADAPTERS.find(a => a.NAME === ref.source);
  if (!adapter) throw new Error(`No adapter for source: ${ref.source}`);
  return adapter.summarizeSession(entries);
}
