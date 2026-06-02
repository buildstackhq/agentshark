import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { redactDeep } from '../redact/redact.js';
import type { AgentEvent } from '../schema/event.js';
import type { SessionRef } from '../adapters/types.js';

const ASPARK_VERSION = '1';

interface AsparkFile {
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
}

export interface ExportOptions {
  outputPath?: string;
}

export async function exportSession(
  sessionRef: SessionRef,
  events: AgentEvent[],
  opts: ExportOptions = {},
): Promise<string> {
  const redacted = events.map(e => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { raw, ...rest } = e;
    return {
      ...rest,
      payload: e.payload !== undefined ? redactDeep(e.payload) : undefined,
    };
  });

  const aspark: AsparkFile = {
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
      engine: 'agentshark-redact-v1',
      patternsApplied: ['api_key', 'jwt', 'secret'],
    },
    events: redacted,
  };

  const outPath = opts.outputPath ?? join(homedir(), 'agentshark-exports', `${sessionRef.id}.aspark`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(aspark, null, 2), 'utf8');
  return outPath;
}
