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
import type { SessionRef, SessionSummary, LastUsage, AdapterCapability } from './types.js';
import { sessionRegistry } from '../store/sessionRegistry.js';

export const NAME = 'claude-code';
export const CAPABILITIES: Set<AdapterCapability> = new Set(['discover', 'load', 'summary', 'cache']);
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

/**
 * Walk `<project>/<parent-session>/subagents/agent-<id>.{jsonl,meta.json}`
 * pairs and yield SessionRefs for each child plus register the parent→child
 * link in the global session registry (Gap 6).
 */
async function discoverSubagents(
  projectPath: string,
  decoded: string,
  parentSessionId: string,
): Promise<SessionRef[]> {
  const subagentsDir = join(projectPath, parentSessionId, 'subagents');
  let entries;
  try { entries = await readdir(subagentsDir, { withFileTypes: true }); }
  catch { return []; }

  const children: SessionRef[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const agentId = entry.name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const jsonlPath = join(subagentsDir, entry.name);
    const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);

    let stat_;
    try { stat_ = await stat(jsonlPath); } catch { continue; }

    let meta: { toolUseId?: string; agentType?: string; description?: string } | undefined;
    try {
      const metaRaw = await readFile(metaPath, 'utf8');
      meta = JSON.parse(metaRaw);
    } catch { /* meta is optional — children without it still surface */ }

    const child: SessionRef = {
      source: NAME,
      id: `${parentSessionId}/${agentId}`,
      jsonlPath,
      projectDir: decoded,
      projectLabel: `${shortLabel(decoded)} ↳ ${meta?.agentType ?? 'agent'}`,
      lastActivity: stat_.mtime,
      sizeBytes: stat_.size,
      parentSessionId,
      parentToolUseId: meta?.toolUseId,
      agentType: meta?.agentType,
    };

    children.push(child);
    sessionRegistry.recordChild(parentSessionId, meta?.toolUseId ?? '', child);
  }
  return children;
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  // Refresh the parent→child registry from scratch every discovery pass so
  // stale entries from a previous run don't survive across refreshes.
  sessionRegistry.clear();

  const projectDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const sessions: SessionRef[] = [];
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const projectPath = join(PROJECTS_DIR, pd.name);
    let entries;
    try { entries = await readdir(projectPath, { withFileTypes: true }); }
    catch { continue; }
    const decoded = decodeProjectDir(pd.name);
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const jsonlPath = join(projectPath, e.name);
      let s;
      try { s = await stat(jsonlPath); }
      catch { continue; }
      const sessionId = e.name.replace(/\.jsonl$/, '');
      sessions.push({
        source: NAME,
        id: sessionId,
        jsonlPath,
        projectDir: decoded,
        projectLabel: shortLabel(decoded),
        lastActivity: s.mtime,
        sizeBytes: s.size,
      });
      // Walk this session's subagents/ directory and add each child session
      // to the result list, plus register the parent→child link.
      const children = await discoverSubagents(projectPath, decoded, sessionId);
      sessions.push(...children);
    }
  }
  return applyLimitKeepingFamilies(sessions, limit);
}

/**
 * Apply `limit` to whole parent+children families, ranked by the family's
 * most-recent activity (parent OR any child, whichever is freshest) — not by
 * the parent's own lastActivity alone. Sorting the flat parent+child list
 * together and slicing it can otherwise truncate a parent out while its
 * more-recently-active children survive, leaving orphan child rows whose
 * parent can't be found (App.tsx `<` navigation fails). A family with a
 * currently-active sub-agent is itself active, even if the parent row is old.
 */
export function applyLimitKeepingFamilies(sessions: SessionRef[], limit: number): SessionRef[] {
  const parents = sessions.filter(s => !s.parentSessionId);
  const childrenByParent = new Map<string, SessionRef[]>();
  for (const s of sessions) {
    if (!s.parentSessionId) continue;
    const list = childrenByParent.get(s.parentSessionId) ?? [];
    list.push(s);
    childrenByParent.set(s.parentSessionId, list);
  }

  const families = parents.map(parent => {
    const kids = childrenByParent.get(parent.id) ?? [];
    const familyActivity = kids.reduce(
      (max, k) => (+k.lastActivity > max ? +k.lastActivity : max),
      +parent.lastActivity,
    );
    return { parent, children: kids, familyActivity };
  });
  families.sort((a, b) => b.familyActivity - a.familyActivity);

  const kept = families.slice(0, limit).flatMap(f => [f.parent, ...f.children]);
  return kept.sort((a, b) => +b.lastActivity - +a.lastActivity);
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
