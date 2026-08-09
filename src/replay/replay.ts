import { readFile } from 'node:fs/promises';
import type { AgentEvent } from '../schema/event.js';
import { validateAsparkV2 } from '../schema/validate.js';

export interface ReplayChildSession {
  session: {
    id: string;
    source: string;
    projectLabel: string;
    projectDir: string;
    parentSessionId: string;
    parentToolUseId?: string;
    agentType?: string;
  };
  events: AgentEvent[];
}

interface AsparkFile {
  asparkVersion: string;
  exportedAt?: string;
  session: {
    id: string;
    source: string;
    projectLabel: string;
    projectDir: string;
  };
  events: AgentEvent[];
  children?: ReplayChildSession[];
}

export interface ReplayResult {
  session: AsparkFile['session'];
  exportedAt?: string;
  events: AgentEvent[];
  /** Always an array; empty when loading a v1 file or a v2 file with no descendants. */
  children: ReplayChildSession[];
}

export async function loadReplay(asparkPath: string): Promise<ReplayResult> {
  const raw = await readFile(asparkPath, 'utf8');
  const aspark = JSON.parse(raw) as AsparkFile;
  if (!aspark.asparkVersion || !Array.isArray(aspark.events)) {
    throw new Error(`Invalid .aspark file: missing asparkVersion or events array`);
  }

  if (aspark.asparkVersion === '2') {
    // v2 is the format this codebase actually produces — enforce it fully
    // against schema/aspark.v2.json so a corrupted or hand-edited v2 file
    // fails loudly with every violation, not just the first field we
    // happen to touch downstream.
    const { valid, errors } = validateAsparkV2(aspark);
    if (!valid) {
      throw new Error(`Invalid .aspark v2 file: does not conform to schema/aspark.v2.json:\n${errors.join('\n')}`);
    }
  } else if (aspark.children !== undefined) {
    // Older/legacy files predate the v2 schema and are handled leniently —
    // still sanity-check `children` by hand since v1 never had that field.
    if (!Array.isArray(aspark.children)) {
      throw new Error(`Invalid .aspark file: 'children' is present but not an array`);
    }
    for (const c of aspark.children) {
      if (!c?.session?.id || !Array.isArray(c.events)) {
        throw new Error(`Invalid .aspark file: child session missing 'session.id' or 'events' array`);
      }
    }
  }

  // v1 files have no `children`; treat as empty so callers can branch on a
  // single shape.
  const children: ReplayChildSession[] = Array.isArray(aspark.children) ? aspark.children : [];

  return {
    session: aspark.session,
    exportedAt: aspark.exportedAt,
    events: aspark.events,
    children,
  };
}
