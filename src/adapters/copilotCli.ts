// Copilot CLI adapter — discovers logs from ~/.config/github-copilot.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionRef, SessionSummary, AdapterCapability } from './types.js';

export const NAME = 'copilot-cli';
// Discovery only — Copilot CLI's response logs aren't yet decoded for token /
// cache / turn counts. Tracked as roadmap.
export const CAPABILITIES: Set<AdapterCapability> = new Set(['discover', 'load']);
const CONFIG_DIR = join(homedir(), '.config', 'github-copilot');

export async function detect(): Promise<boolean> {
  try { await stat(CONFIG_DIR); return true; }
  catch { return false; }
}

async function findJsonlFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const paths: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) paths.push(...await findJsonlFiles(full, depth + 1));
    else if (e.isFile() && e.name.endsWith('.jsonl')) paths.push(full);
  }
  return paths;
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  const files = await findJsonlFiles(CONFIG_DIR);
  const sessions: SessionRef[] = [];
  for (const f of files) {
    let s;
    try { s = await stat(f); } catch { continue; }
    const id = f.replace(CONFIG_DIR, '').replace(/[/\\]/g, '-').replace(/\.jsonl$/, '').replace(/^-/, '');
    sessions.push({
      source: NAME,
      id,
      jsonlPath: f,
      projectDir: CONFIG_DIR,
      projectLabel: id.slice(0, 20),
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
