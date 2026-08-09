import { readFile } from 'node:fs/promises';
import type { AgentEvent } from '../schema/event.js';

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

  // v2 may carry a `children` array. v1 files have no `children`; treat as
  // empty so callers can branch on a single shape.
  const children: ReplayChildSession[] = [];
  if (aspark.children !== undefined) {
    if (!Array.isArray(aspark.children)) {
      throw new Error(`Invalid .aspark file: 'children' is present but not an array`);
    }
    for (const c of aspark.children) {
      if (!c?.session?.id || !Array.isArray(c.events)) {
        throw new Error(`Invalid .aspark file: child session missing 'session.id' or 'events' array`);
      }
      children.push(c);
    }
  }

  return {
    session: aspark.session,
    exportedAt: aspark.exportedAt,
    events: aspark.events,
    children,
  };
}
