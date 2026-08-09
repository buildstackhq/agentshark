// Gemini CLI adapter — discovers sessions from ~/.gemini/sessions.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionRef, SessionSummary, AdapterCapability } from './types.js';

export const NAME = 'gemini-cli';
// Discovery only — Gemini CLI's session format isn't yet decoded for token /
// cache / turn counts. Tracked as roadmap.
export const CAPABILITIES: Set<AdapterCapability> = new Set(['discover', 'load']);
const SESSIONS_DIR = join(homedir(), '.gemini', 'sessions');

export async function detect(): Promise<boolean> {
  try { await stat(SESSIONS_DIR); return true; }
  catch { return false; }
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  const sessions: SessionRef[] = [];
  let entries;
  try { entries = await readdir(SESSIONS_DIR, { withFileTypes: true }); }
  catch { return []; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const jsonlPath = join(SESSIONS_DIR, e.name);
    let s;
    try { s = await stat(jsonlPath); } catch { continue; }
    sessions.push({
      source: NAME,
      id: e.name.replace(/\.jsonl$/, ''),
      jsonlPath,
      projectDir: SESSIONS_DIR,
      projectLabel: e.name.replace(/\.jsonl$/, '').slice(0, 16),
      lastActivity: s.mtime,
      sizeBytes: s.size,
    });
  }
  sessions.sort((a, b) => +b.lastActivity - +a.lastActivity);
  return sessions.slice(0, limit);
}

export async function loadSessionEntries(sessionRef: SessionRef): Promise<unknown[]> {
  const text = await readFile(sessionRef.jsonlPath, 'utf8');
  const entries: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return entries;
}

export function summarizeSession(_entries: unknown[]): SessionSummary {
  return {
    assistantTurns: 0,
    lastModel: null,
    billedInput: 0,
    cacheRead: 0,
    outputTokens: 0,
    cacheReadPct: 0,
    firstTs: null,
    lastTs: null,
    lastUsage: null,
  };
}
