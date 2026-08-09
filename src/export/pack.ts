import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRedactionCollector } from '../redact/redact.js';
import { sessionRegistry } from '../store/sessionRegistry.js';
import { loadSessionEntries } from '../adapters/index.js';
import { extractEvents } from '../extract/events.js';
import type { AgentEvent } from '../schema/event.js';
import type { SessionRef } from '../adapters/types.js';

const ASPARK_VERSION = '2';
const MAX_FAMILY_DEPTH = 8;

export interface RedactionDiff {
  engine: string;
  patternsApplied: string[];
  matchCount: number;
  samples: { pattern: string; match: string; context: string }[];
}

export interface ChildSessionExport {
  session: {
    id: string;
    source: string;
    projectLabel: string;
    projectDir: string;
    parentSessionId: string;
    parentToolUseId?: string;
    agentType?: string;
  };
  events: Partial<AgentEvent>[];
}

export interface AsparkFile {
  asparkVersion: string;
  exportedAt: string;
  exportedBy: string;
  session: {
    id: string;
    source: string;
    projectLabel: string;
    projectDir: string;
  };
  redaction: {
    engine: string;
    patternsApplied: string[];
  };
  events: Partial<AgentEvent>[];
  children?: ChildSessionExport[];
}

export interface PreparedExport {
  file: AsparkFile;
  diff: RedactionDiff;
  defaultPath: string;
}

export interface ExportOptions {
  outputPath?: string;
}

const REDACTION_ENGINE = 'agentshark-redact-v1';
const PATTERNS_APPLIED = ['api_key', 'jwt', 'secret'];

function defaultOutputPath(sessionId: string): string {
  return join(homedir(), 'agentshark-exports', `${sessionId}.aspark`);
}

function stripRaw(events: AgentEvent[]): Partial<AgentEvent>[] {
  // Strip the internal `raw` field that links back to the original JSONL
  // entry. `turnUsage` is preserved so context-composition can be recomputed
  // when the file is replayed.
  return events.map(e => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { raw, ...rest } = e;
    return rest;
  });
}

/**
 * Prepare an export without writing anything. Returns the redacted `.aspark`
 * payload plus a sample diff describing what was redacted, so callers can show
 * a confirmation step before persisting the file.
 *
 * When `children` are passed, the bundle becomes a family export: the parent's
 * events plus every descendant sub-agent's events live in one file, and the
 * redaction diff covers the whole family with a single match count and sample
 * list.
 */
export function prepareExport(
  sessionRef: SessionRef,
  events: AgentEvent[],
  opts: ExportOptions = {},
  children: Array<{ ref: SessionRef; events: AgentEvent[] }> = [],
): PreparedExport {
  const parentStripped = stripRaw(events);
  const childrenStripped = children.map(c => ({
    ref: c.ref,
    events: stripRaw(c.events),
  }));

  // Redact each session's events independently — so per-session shapes survive —
  // while a shared collector redacts and records family-wide samples/matchCount
  // in the same pass, rather than scanning the whole tree twice.
  const collector = createRedactionCollector();
  const redactedParent = parentStripped.map(e => collector.redact(e) as typeof e);
  const redactedChildren: ChildSessionExport[] = childrenStripped.map(c => ({
    session: {
      id: c.ref.id,
      source: c.ref.source,
      projectLabel: c.ref.projectLabel,
      projectDir: c.ref.projectDir,
      parentSessionId: c.ref.parentSessionId ?? '',
      parentToolUseId: c.ref.parentToolUseId,
      agentType: c.ref.agentType,
    },
    events: c.events.map(e => collector.redact(e) as typeof e),
  }));

  const file: AsparkFile = {
    asparkVersion: ASPARK_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: 'agentshark-tui',
    session: {
      id: sessionRef.id,
      source: sessionRef.source,
      projectLabel: sessionRef.projectLabel,
      projectDir: sessionRef.projectDir,
    },
    redaction: {
      engine: REDACTION_ENGINE,
      patternsApplied: PATTERNS_APPLIED,
    },
    events: redactedParent,
    ...(redactedChildren.length > 0 ? { children: redactedChildren } : {}),
  };

  const diff: RedactionDiff = {
    engine: REDACTION_ENGINE,
    patternsApplied: PATTERNS_APPLIED,
    matchCount: collector.matchCount,
    samples: collector.samples,
  };

  return { file, diff, defaultPath: opts.outputPath ?? defaultOutputPath(sessionRef.id) };
}

/**
 * Persist a prepared `.aspark` file to disk. Splitting this from `prepareExport`
 * lets callers (TUI / CLI) confirm the redaction diff before any file is written.
 */
export async function writeExport(prepared: PreparedExport, outPath?: string): Promise<string> {
  const finalPath = outPath ?? prepared.defaultPath;
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, JSON.stringify(prepared.file, null, 2), 'utf8');
  return finalPath;
}

/**
 * One-shot export — kept for callers that don't need the confirmation step.
 * Equivalent to prepareExport + writeExport.
 */
export async function exportSession(
  sessionRef: SessionRef,
  events: AgentEvent[],
  opts: ExportOptions = {},
  children: Array<{ ref: SessionRef; events: AgentEvent[] }> = [],
): Promise<string> {
  const prepared = prepareExport(sessionRef, events, opts, children);
  return writeExport(prepared);
}

/**
 * BFS over the in-memory `sessionRegistry` starting at `root`, loading and
 * extracting events for every descendant sub-agent. Requires the registry to
 * be populated first (e.g. via `discoverAllSessions`). Returns flat list of
 * `{ ref, events }` pairs ready to pass to `prepareExport` as `children`.
 *
 * Defensively bounded by `MAX_FAMILY_DEPTH` and a `seen` set so a circular
 * parent/child link (shouldn't happen, but adapters are external) can't run
 * away. Children that fail to load are skipped silently — the rest of the
 * family still exports.
 */
export async function gatherDescendants(
  root: SessionRef,
): Promise<Array<{ ref: SessionRef; events: AgentEvent[] }>> {
  const seen = new Set<string>([root.id]);
  const result: Array<{ ref: SessionRef; events: AgentEvent[] }> = [];
  const queue: Array<{ ref: SessionRef; depth: number }> = [{ ref: root, depth: 0 }];

  while (queue.length > 0) {
    const { ref, depth } = queue.shift()!;
    if (depth >= MAX_FAMILY_DEPTH) continue;
    const children = sessionRegistry.childrenOf(ref.id);
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      try {
        const entries = await loadSessionEntries(child);
        const events = extractEvents(entries, child);
        result.push({ ref: child, events });
        queue.push({ ref: child, depth: depth + 1 });
      } catch {
        // Skip children that can't be loaded; the rest of the family still
        // exports.
      }
    }
  }
  return result;
}
