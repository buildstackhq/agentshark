// Codex adapter — discovers sessions from ~/.codex/sessions.
//
// Codex stores sessions in a nested year/month/day tree and logs a mix of
// event_msg and response_item records. We normalize those records into the
// Claude-shaped session entries that the rest of agentshark already expects.

import { open, readdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { basename, dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import type { SessionRef, SessionSummary, AdapterCapability } from './types.js';

export const NAME = 'codex';
export const CAPABILITIES: Set<AdapterCapability> = new Set(['discover', 'load', 'summary', 'cache']);
const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const SQLITE_DB = join(homedir(), '.codex', 'logs_2.sqlite');
const execFileAsync = promisify(execFile);
const modelCache = new Map<string, { value: string | null; expiresAt: number }>();
const sqliteWarningDedup = new Set<string>();

interface CodexEntry {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
  message?: Record<string, unknown>;
  content?: unknown;
  text?: unknown;
  output?: unknown;
  model?: string;
  usage?: unknown;
  requestId?: string;
  role?: string;
  isMeta?: boolean;
}

interface NormalizedMessage {
  content?: unknown;
  model?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

interface NormalizedEntry {
  timestamp: string;
  type: 'user' | 'assistant';
  message: NormalizedMessage;
  requestId?: string;
  isMeta?: boolean;
}

interface SqliteRow {
  feedback_log_body?: string;
}

interface SessionCandidate {
  jsonlPath: string;
  id: string;
  projectDir: string;
  lastActivity: Date;
  sizeBytes: number;
}

type SqliteWarningCode = 'CODEX_SQLITE3_MISSING' | 'CODEX_SQLITE_QUERY_FAILED' | 'CODEX_SQLITE_SCHEMA_DRIFT';

export async function detect(): Promise<boolean> {
  try { await stat(SESSIONS_DIR); return true; }
  catch { return false; }
}

async function walkJsonlFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(fullPath);
    }
  }
  return out;
}

function shortProjectLabel(jsonlPath: string): string {
  const sessionDir = dirname(jsonlPath);
  const rel = relative(SESSIONS_DIR, sessionDir);
  if (rel && !rel.startsWith('..') && rel !== '') return rel.split(sep).join('/');
  return basename(sessionDir);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shortPathLabel(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[0] || normalized;
}

function labelFromValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/[\\/]/.test(trimmed)) return shortPathLabel(trimmed);
  return trimmed;
}

async function readJsonlHead(jsonlPath: string, maxBytes = 64 * 1024): Promise<string> {
  const file = await open(jsonlPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

function inferLabelFromHead(head: string): string | null {
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as unknown;
      if (!isRecord(entry) || entry.type !== 'session_meta' || !isRecord(entry.payload)) continue;
      const payload = entry.payload;
      for (const key of ['project_name', 'project', 'cwd', 'working_dir', 'working_directory', 'project_dir', 'projectPath', 'workspace', 'path']) {
        const value = payload[key];
        if (typeof value === 'string') {
          const label = labelFromValue(value);
          if (label) return label;
        }
      }
    } catch {
      // Keep scanning. Codex sessions can be long-lived and partially written.
    }
  }
  return null;
}

async function deriveSessionLabel(jsonlPath: string, id: string): Promise<string> {
  const fallback = `${shortProjectLabel(jsonlPath)} · ${id.slice(0, 8)}`;
  try {
    const label = inferLabelFromHead(await readJsonlHead(jsonlPath));
    return label ? `${label} · ${id.slice(0, 8)}` : fallback;
  } catch {
    return fallback;
  }
}

function normalizeUsage(raw: unknown): NormalizedMessage['usage'] | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    input_tokens: typeof raw.input_tokens === 'number' ? raw.input_tokens : 0,
    cache_creation_input_tokens: typeof raw.cache_creation_input_tokens === 'number' ? raw.cache_creation_input_tokens : 0,
    cache_read_input_tokens:
      typeof raw.cache_read_input_tokens === 'number'
        ? raw.cache_read_input_tokens
        : typeof raw.cached_input_tokens === 'number'
          ? raw.cached_input_tokens
          : 0,
    output_tokens: typeof raw.output_tokens === 'number' ? raw.output_tokens : 0,
  };
}

function emitSqliteWarning(code: SqliteWarningCode, threadId: string, detail: string): void {
  const key = `${code}:${threadId}:${detail}`;
  if (sqliteWarningDedup.has(key)) return;
  sqliteWarningDedup.add(key);
  process.emitWarning(
    `Codex SQLite enrichment fell back to raw JSONL for thread ${threadId}: ${detail}`,
    { code, detail: SQLITE_DB },
  );
}

function warnSqliteLookupFailure(threadId: string, err: unknown): void {
  if (err && typeof err === 'object') {
    const code = (err as { code?: string }).code;
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    if (code === 'ENOENT' || /no such file or directory|not found/i.test(stderr) || /no such file or directory|not found/i.test(String(err))) {
      emitSqliteWarning('CODEX_SQLITE3_MISSING', threadId, 'sqlite3 binary was not found on PATH');
      return;
    }
    emitSqliteWarning('CODEX_SQLITE_QUERY_FAILED', threadId, `sqlite3 query failed: ${String((err as Error).message || err)}`);
    return;
  }

  emitSqliteWarning('CODEX_SQLITE_QUERY_FAILED', threadId, 'sqlite3 query failed with an unknown error');
}

function attachPendingTurnUsage(
  entry: NormalizedEntry,
  currentTurnId: string | null,
  currentTurnAssistantIndex: number | null,
  normalized: NormalizedEntry[],
  pendingUsage: Map<string, NormalizedMessage['usage']>,
): number | null {
  if (!currentTurnId) return currentTurnAssistantIndex;
  if (currentTurnAssistantIndex == null) currentTurnAssistantIndex = normalized.length;
  const pending = pendingUsage.get(currentTurnId);
  if (pending) {
    entry.message.usage = pending;
    pendingUsage.delete(currentTurnId);
  }
  return currentTurnAssistantIndex;
}

function normalizeLooseEntry(entry: CodexEntry): NormalizedEntry | null {
  if (!entry.timestamp || typeof entry.type !== 'string') return null;

  const rawMessage = isRecord(entry.message) ? entry.message : undefined;
  const role = entry.type === 'assistant' ? 'assistant' : 'user';
  const content = rawMessage?.content ?? entry.content ?? entry.text ?? entry.output ?? null;
  const normalized: NormalizedEntry = {
    timestamp: entry.timestamp,
    type: role,
    message: { content: toTextBlocks(content) },
    isMeta: entry.isMeta === true || entry.role === 'developer',
  };

  if (role === 'assistant') {
    const model = typeof rawMessage?.model === 'string' ? rawMessage.model : typeof entry.model === 'string' ? entry.model : null;
    if (model) normalized.message.model = model;

    const usage = normalizeUsage(rawMessage?.usage ?? entry.usage);
    if (usage) normalized.message.usage = usage;

    const requestId =
      typeof entry.requestId === 'string'
        ? entry.requestId
        : typeof rawMessage?.requestId === 'string'
          ? rawMessage.requestId
          : typeof rawMessage?.request_id === 'string'
            ? rawMessage.request_id
            : null;
    if (requestId) normalized.requestId = requestId;
  }

  return normalized;
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  const files = await walkJsonlFiles(SESSIONS_DIR);
  const candidates: SessionCandidate[] = [];
  for (const jsonlPath of files) {
    let s;
    try { s = await stat(jsonlPath); } catch { continue; }
    const sessionDir = dirname(jsonlPath);
    const id = basename(jsonlPath).replace(/\.jsonl$/, '');
    candidates.push({
      id,
      jsonlPath,
      projectDir: sessionDir,
      lastActivity: s.mtime,
      sizeBytes: s.size,
    });
  }
  candidates.sort((a, b) => +b.lastActivity - +a.lastActivity);

  const sessions = await Promise.all(candidates.slice(0, limit).map(async candidate => ({
    source: NAME,
    id: candidate.id,
    jsonlPath: candidate.jsonlPath,
    projectDir: candidate.projectDir,
    projectLabel: await deriveSessionLabel(candidate.jsonlPath, candidate.id),
    lastActivity: candidate.lastActivity,
    sizeBytes: candidate.sizeBytes,
  })));

  return sessions;
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function toTextBlocks(content: unknown): unknown[] {
  if (!Array.isArray(content)) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (content == null) return [];
    return [{ type: 'text', text: String(content) }];
  }

  const blocks: unknown[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      blocks.push({ type: 'text', text: block });
      continue;
    }
    const item = block as Record<string, unknown>;
    if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') {
      blocks.push({ type: 'text', text: String(item.text ?? '') });
    } else if (item.type === 'thinking') {
      const text = String(item.thinking ?? item.text ?? '');
      if (text) blocks.push({ type: 'thinking', thinking: text });
    } else if (item.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        name: typeof item.name === 'string' ? item.name : undefined,
        input: parseJsonLike(item.input),
      });
    } else if (item.type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined,
        content: item.content,
        is_error: item.is_error,
      });
    }
  }
  return blocks;
}

function toUsage(info: Record<string, unknown> | undefined): NormalizedMessage['usage'] | undefined {
  if (!info) return undefined;
  const last = info.last_token_usage as Record<string, unknown> | undefined;
  const total = info.total_token_usage as Record<string, unknown> | undefined;
  const usage = last ?? total;
  if (!usage) return undefined;
  return {
    input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: typeof usage.cached_input_tokens === 'number' ? usage.cached_input_tokens : 0,
    output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}

function extractModelFromBody(body: string | undefined): string | null {
  if (!body) return null;
  const match = body.match(/\bmodel=([A-Za-z0-9._:-]+)/);
  return match?.[1] ?? null;
}

function extractThreadId(entries: unknown[]): string | null {
  for (const raw of entries) {
    const entry = raw as CodexEntry;
    if (entry?.type !== 'session_meta') continue;
    const payload = entry.payload ?? {};
    if (typeof payload.id === 'string' && payload.id) return payload.id;
  }
  return null;
}

async function lookupSqliteModel(threadId: string): Promise<string | null> {
  const cacheKey = `${NAME}:${threadId}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: string | null = null;
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-json',
      SQLITE_DB,
      `select feedback_log_body from logs
       where thread_id = '${threadId.replace(/'/g, "''")}'
         and feedback_log_body like '%model=%'
       order by ts desc, ts_nanos desc, id desc
       limit 1;`,
    ], { maxBuffer: 1024 * 1024 });

    let parsedRows = true;
    let rows: SqliteRow[];
    try {
      rows = JSON.parse(String(stdout).trim() || '[]') as SqliteRow[];
    } catch {
      emitSqliteWarning('CODEX_SQLITE_SCHEMA_DRIFT', threadId, 'sqlite3 output was not valid JSON');
      parsedRows = false;
      rows = [];
    }

    value = extractModelFromBody(rows[0]?.feedback_log_body);
    if (!value && parsedRows && rows.length > 0) {
      emitSqliteWarning('CODEX_SQLITE_SCHEMA_DRIFT', threadId, 'query returned rows, but no model could be parsed from feedback_log_body');
    }
  } catch (err) {
    warnSqliteLookupFailure(threadId, err);
    value = null;
  }

  modelCache.set(cacheKey, { value, expiresAt: Date.now() + 10_000 });
  return value;
}

function applyModelToAssistantEntries(entries: NormalizedEntry[], model: string | null): NormalizedEntry[] {
  if (!model) return entries;
  let changed = false;
  const patched = entries.map(entry => {
    if (entry.type !== 'assistant' || entry.message.model) return entry;
    changed = true;
    return {
      ...entry,
      message: { ...entry.message, model },
    };
  });
  return changed ? patched : entries;
}

function normalizeEntries(entries: unknown[]): unknown[] {
  const normalized: NormalizedEntry[] = [];
  const pendingUsage = new Map<string, NormalizedMessage['usage']>();
  let currentTurnId: string | null = null;
  let currentModel: string | null = null;
  let currentTurnAssistantIndex: number | null = null;

  const attachUsage = (usage: NormalizedMessage['usage']) => {
    if (!usage) return;
    if (currentTurnId && currentTurnAssistantIndex != null) {
      const target = normalized[currentTurnAssistantIndex];
      if (target?.type === 'assistant') {
        target.message.usage = usage;
      }
    } else if (currentTurnId) {
      pendingUsage.set(currentTurnId, usage);
    }
  };

  for (const raw of entries) {
    const entry = raw as CodexEntry;
    if (!entry || !entry.timestamp || typeof entry.type !== 'string') continue;

    if ((entry.type === 'user' || entry.type === 'assistant') && entry.payload == null) {
      const looseEntry = normalizeLooseEntry(entry);
      if (looseEntry) normalized.push(looseEntry);
      continue;
    }

    if (entry.type === 'session_meta') {
      const payload = entry.payload ?? {};
      if (typeof payload.model === 'string') currentModel = payload.model;
      continue;
    }

    if (entry.type === 'event_msg') {
      const payload = entry.payload ?? {};
      if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        currentTurnId = payload.turn_id;
        currentTurnAssistantIndex = null;
        continue;
      }
      if (payload.type === 'token_count') {
        const usage = toUsage(payload.info as Record<string, unknown> | undefined);
        attachUsage(usage);
      }
      continue;
    }

    if (entry.type !== 'response_item') continue;
    const payload = entry.payload ?? {};

    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant' || payload.role === 'developer')) {
      const normalizedEntry: NormalizedEntry = {
        timestamp: entry.timestamp,
        type: payload.role === 'assistant' ? 'assistant' : 'user',
        message: { content: toTextBlocks(payload.content) },
        isMeta: payload.role === 'developer',
      };
      if (normalizedEntry.type === 'assistant') {
        normalizedEntry.message.model = currentModel ?? undefined;
        if (currentTurnId) normalizedEntry.requestId = currentTurnId;
        currentTurnAssistantIndex = attachPendingTurnUsage(
          normalizedEntry,
          currentTurnId,
          currentTurnAssistantIndex,
          normalized,
          pendingUsage,
        );
      }
      normalized.push(normalizedEntry);
      continue;
    }

    if (payload.type === 'function_call') {
      const normalizedEntry: NormalizedEntry = {
        timestamp: entry.timestamp,
        type: 'assistant',
        requestId: currentTurnId ?? undefined,
        message: {
          model: currentModel ?? undefined,
          content: [{
            type: 'tool_use',
            name: typeof payload.name === 'string' ? payload.name : undefined,
            input: parseJsonLike(payload.arguments),
          }],
        },
      };
      currentTurnAssistantIndex = attachPendingTurnUsage(
        normalizedEntry,
        currentTurnId,
        currentTurnAssistantIndex,
        normalized,
        pendingUsage,
      );
      normalized.push(normalizedEntry);
      continue;
    }

    if (payload.type === 'function_call_output') {
      normalized.push({
        timestamp: entry.timestamp,
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: typeof payload.call_id === 'string' ? payload.call_id : undefined,
            content: typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? ''),
            is_error: Boolean(payload.error),
          }],
        },
      });
    }
  }

  return normalized;
}

export async function loadSessionEntries(sessionRef: SessionRef): Promise<unknown[]> {
  const text = await readFile(sessionRef.jsonlPath, 'utf8');
  const entries: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  const normalized = normalizeEntries(entries) as NormalizedEntry[];
  const hasModel = normalized.some(entry => entry.type === 'assistant' && Boolean(entry.message.model));
  if (hasModel) return normalized;
  const sqliteModel = await lookupSqliteModel(extractThreadId(entries) ?? sessionRef.id);
  return applyModelToAssistantEntries(normalized, sqliteModel);
}

export function summarizeSession(entries: unknown[]): SessionSummary {
  const normalized = normalizeEntries(entries);
  let assistantTurns = 0;
  let lastModel: string | null = null;
  let billedInput = 0;
  let cacheRead = 0;
  let outputTokens = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let lastUsage: SessionSummary['lastUsage'] = null;
  const seenReqs = new Set<string>();

  for (const raw of normalized) {
    const entry = raw as NormalizedEntry;
    if (entry.timestamp) {
      if (!firstTs) firstTs = entry.timestamp;
      lastTs = entry.timestamp;
    }
    if (entry.type !== 'assistant' || !entry.message?.usage) continue;
    if (entry.requestId && seenReqs.has(entry.requestId)) continue;
    if (entry.requestId) seenReqs.add(entry.requestId);
    const u = entry.message.usage;
    assistantTurns++;
    lastModel = entry.message.model ?? lastModel;
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
    cacheReadPct: billedInput > 0 ? cacheRead / billedInput : 0,
    firstTs,
    lastTs,
    lastUsage,
  };
}
