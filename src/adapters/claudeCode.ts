// Claude Code adapter — discovers and loads sessions from ~/.claude/projects.
//
// Session layout on disk:
//   ~/.claude/projects/<encoded-project-dir>/<session-uuid>.jsonl
//
// The encoded project dir replaces `/` with `-`, so /Users/foo/bar becomes
// `-Users-foo-bar`. Decode is heuristic — hyphens in dir names are ambiguous.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionRef, SessionSummary, LastUsage } from './types.js';

export const NAME = 'claude-code';
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export async function detect(): Promise<boolean> {
  try {
    await stat(PROJECTS_DIR);
    return true;
  } catch {
    return false;
  }
}

function decodeProjectDir(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  // Heuristic only — used for display, not filesystem access.
  // Claude Code replaces '/' with '-'; hyphens in dir names are ambiguous.
  return '/' + encoded.slice(1).replace(/-/g, '/');
}

function shortLabel(decodedPath: string): string {
  const parts = decodedPath.split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[parts.length - 1] || decodedPath;
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const sessions: SessionRef[] = [];
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const projectPath = join(PROJECTS_DIR, pd.name);
    let entries;
    try { entries = await readdir(projectPath, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const jsonlPath = join(projectPath, e.name);
      let s;
      try { s = await stat(jsonlPath); }
      catch { continue; }
      const decoded = decodeProjectDir(pd.name);
      sessions.push({
        source: NAME,
        id: e.name.replace(/\.jsonl$/, ''),
        jsonlPath,
        projectDir: decoded,
        projectLabel: shortLabel(decoded),
        lastActivity: s.mtime,
        sizeBytes: s.size,
      });
    }
  }
  sessions.sort((a, b) => +b.lastActivity - +a.lastActivity);
  return sessions.slice(0, limit);
}

export async function loadSessionEntries(sessionRef: SessionRef): Promise<unknown[]> {
  const text = await readFile(sessionRef.jsonlPath, 'utf8');
  const entries: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
  }
  return entries;
}

interface RawEntry {
  type?: string;
  requestId?: string;
  timestamp?: string;
  message?: {
    model?: string;
    usage?: LastUsage;
  };
}

export function summarizeSession(entries: unknown[]): SessionSummary {
  let assistantTurns = 0;
  let lastModel: string | null = null;
  let billedInput = 0;
  let cacheRead = 0;
  let outputTokens = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let lastUsage: LastUsage | null = null;
  const seenReqs = new Set<string>();

  for (const raw of entries) {
    const e = raw as RawEntry;
    if (e.timestamp) {
      if (!firstTs) firstTs = e.timestamp;
      lastTs = e.timestamp;
    }
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    if (e.requestId && seenReqs.has(e.requestId)) continue;
    if (e.requestId) seenReqs.add(e.requestId);
    const u = e.message.usage;
    assistantTurns++;
    lastModel = e.message.model ?? lastModel;
    billedInput += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    cacheRead += u.cache_read_input_tokens || 0;
    outputTokens += u.output_tokens || 0;
    lastUsage = u;
  }

  return {
    assistantTurns,
    lastModel,
    billedInput,
    cacheRead,
    outputTokens,
    firstTs,
    lastTs,
    cacheReadPct: billedInput > 0 ? cacheRead / billedInput : 0,
    lastUsage,
  };
}
