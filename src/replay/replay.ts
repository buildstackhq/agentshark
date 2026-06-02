import { readFile } from 'node:fs/promises';
import type { AgentEvent } from '../schema/event.js';

interface AsparkFile {
  asparkVersion: string;
  session: {
    id: string;
    source: string;
    projectLabel: string;
    projectDir: string;
  };
  events: AgentEvent[];
}

export interface ReplayResult {
  session: AsparkFile['session'];
  events: AgentEvent[];
}

export async function loadReplay(asparkPath: string): Promise<ReplayResult> {
  const raw = await readFile(asparkPath, 'utf8');
  const aspark = JSON.parse(raw) as AsparkFile;
  if (!aspark.asparkVersion || !Array.isArray(aspark.events)) {
    throw new Error(`Invalid .aspark file: missing asparkVersion or events array`);
  }
  return { session: aspark.session, events: aspark.events };
}
