#!/usr/bin/env node
// Scan ~/.claude/projects/ for sessions suitable for attribution validation:
//   - "cold": low total cache_read_input_tokens (system started fresh, no prompt caching yet)
//   - "cache-heavy": >50% of input tokens came from cache_read
// Prints a short report so we can pick stable fixtures by hand.

import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface Summary {
  assistantTurns: number;
  inputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  outputTokens: number;
  totalBilledInput: number;
  cacheReadPct: number;
  firstTs: string | null;
  lastTs: string | null;
}

interface Candidate extends Summary {
  path: string;
  size: number;
}

async function* walkJsonl(root: string): AsyncGenerator<string> {
  for (const projectDir of await readdir(root, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const projectPath = join(root, projectDir.name);
    let entries: Dirent[];
    try { entries = await readdir(projectPath, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      yield join(projectPath, e.name);
    }
  }
}

function summarize(lines: string[]): Summary {
  let assistantTurns = 0;
  let inputTokens = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let outputTokens = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  for (const line of lines) {
    if (!line) continue;
    let obj: RawEntry;
    try { obj = JSON.parse(line) as RawEntry; } catch { continue; }
    if (obj.timestamp) {
      if (!firstTs) firstTs = obj.timestamp;
      lastTs = obj.timestamp;
    }
    if (obj.type !== 'assistant' || !obj.message?.usage) continue;
    const u = obj.message.usage;
    assistantTurns++;
    inputTokens += u.input_tokens ?? 0;
    cacheCreate += u.cache_creation_input_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
  }
  const totalBilledInput = inputTokens + cacheCreate + cacheRead;
  const cacheReadPct = totalBilledInput > 0 ? cacheRead / totalBilledInput : 0;
  return { assistantTurns, inputTokens, cacheCreate, cacheRead, outputTokens, totalBilledInput, cacheReadPct, firstTs, lastTs };
}

async function main(): Promise<void> {
  const candidates: Candidate[] = [];
  for await (const path of walkJsonl(PROJECTS_DIR)) {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch { continue; }
    const lines = raw.split('\n');
    const s = summarize(lines);
    if (s.assistantTurns < 3) continue;
    const st = await stat(path);
    candidates.push({ path, size: st.size, ...s });
  }

  // Sort: best cache-heavy = high cache_read pct + decent volume
  const cacheHeavy = [...candidates]
    .filter(c => c.cacheRead > 50_000)
    .sort((a, b) => b.cacheReadPct - a.cacheReadPct)
    .slice(0, 5);

  // Best cold = very low cacheRead but enough turns to be interesting
  const cold = [...candidates]
    .filter(c => c.cacheRead < 5_000 && c.assistantTurns >= 5)
    .sort((a, b) => b.totalBilledInput - a.totalBilledInput)
    .slice(0, 5);

  console.log(`Scanned ${candidates.length} sessions in ${PROJECTS_DIR}\n`);

  console.log('=== Top cache-heavy candidates (best at top) ===');
  for (const c of cacheHeavy) {
    console.log(`  ${(c.cacheReadPct * 100).toFixed(1)}% cache-read · ${c.assistantTurns} turns · billed_in=${c.totalBilledInput} · ${c.path}`);
  }

  console.log('\n=== Top cold candidates (low cache-read) ===');
  for (const c of cold) {
    console.log(`  ${(c.cacheReadPct * 100).toFixed(1)}% cache-read · ${c.assistantTurns} turns · billed_in=${c.totalBilledInput} · ${c.path}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
