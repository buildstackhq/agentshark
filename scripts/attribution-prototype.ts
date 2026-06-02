#!/usr/bin/env node
// Cache-aware input-token attribution prototype.
//
// Hypothesis: per-block tokenization of conversation history + reconciliation
// against `usage` partitions reproduces the API's billed input tokens within
// ~10% on both cold and cache-heavy turns. Output tokens are NOT attributed
// per-block (they stream as one assistant response).
//
// Validation strategy: the Claude Code JSONL gives us all user/assistant
// content but NOT system prompt, tool definitions, or CLAUDE.md memory blobs.
// That fixed overhead should appear as a roughly constant gap between our
// per-message token estimate and `api_billed_input`. If the gap is stable
// across both cache-cold and cache-heavy turns, the algorithm works.
//
// Usage:
//   tsx attribution-prototype.ts <session.jsonl> [--limit N] [--json]

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { countTokens } from '@anthropic-ai/tokenizer';

type TextBlock = { type: 'text'; text: string };
type ThinkingBlock = { type: 'thinking'; thinking: string };
type ToolUseBlock = { type: 'tool_use'; name: string; input: unknown };
type ToolResultBlock = { type: 'tool_result'; content: unknown };
type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

interface RawMessage {
  role?: string;
  content?: string | Array<ContentBlock | string>;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  model?: string;
}

interface RawEntry {
  type?: string;
  isMeta?: boolean;
  requestId?: string;
  message?: RawMessage;
}

interface ConvEntry {
  role: string;
  text: string;
  tokens: number;
  requestId?: string;
}

interface TurnEntry {
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  model: string;
  promptIndex: number;
}

interface Row {
  reqId: string;
  model: string;
  promptEntries: number;
  estimatedPromptTokens: number;
  billedInput: number;
  overhead: number;
  inputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  outputTokens: number;
  cacheReadPct: number;
}

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--'));

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  return undefined;
}

const limit = Number(flagValue('limit')) || Infinity;
const offset = Number(flagValue('offset')) || 0;
const emitJson = args.includes('--json');

if (!filePath) {
  console.error('usage: attribution-prototype.ts <session.jsonl> [--limit N] [--json]');
  process.exit(2);
}

const text = await readFile(filePath, 'utf8');
const lines = text.split('\n').filter(Boolean);
const entries = lines.map(l => { try { return JSON.parse(l) as RawEntry; } catch { return null; } }).filter((e): e is RawEntry => e !== null);

// Tokenize anything that the API would have seen as text content within a
// single conversation message. We extract text from user / assistant entries
// only — `permission-mode`, `file-history-snapshot`, etc. are local Claude
// Code metadata and not sent to the API.
function messageText(msg: RawMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const chunks: string[] = [];
  for (const block of msg.content) {
    if (typeof block === 'string') { chunks.push(block); continue; }
    if (block.type === 'text') chunks.push(block.text);
    else if (block.type === 'thinking') chunks.push(block.thinking);
    else if (block.type === 'tool_use') {
      chunks.push(block.name);
      try { chunks.push(JSON.stringify(block.input ?? {})); } catch {}
    }
    else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') chunks.push(block.content);
      else if (Array.isArray(block.content)) {
        for (const c of block.content as Array<{ type?: string; text?: string }>) {
          if (c?.type === 'text' && c.text) chunks.push(c.text);
        }
      }
    }
  }
  return chunks.join('\n');
}

// Walk the JSONL and build:
//   - conversation: ordered list of { role, text, tokens, requestId } message blocks
//     as they would have been seen by the API
//   - turns: unique API turns keyed by requestId, with `usage` and prompt index
//     (i.e., the conversation length BEFORE this turn ran)

const conversation: ConvEntry[] = [];
const turnByReqId = new Map<string, TurnEntry>();

for (const e of entries) {
  if (e.type === 'user' && e.message && !e.isMeta) {
    const txt = messageText(e.message);
    if (!txt) continue;
    const tokens = countTokens(txt);
    conversation.push({ role: 'user', text: txt, tokens });
  } else if (e.type === 'assistant' && e.message) {
    const txt = messageText(e.message);
    if (txt) {
      const tokens = countTokens(txt);
      conversation.push({ role: 'assistant', text: txt, tokens, requestId: e.requestId });
    }
    if (e.message.usage && e.requestId && !turnByReqId.has(e.requestId)) {
      const u = e.message.usage;
      turnByReqId.set(e.requestId, {
        usage: {
          input_tokens: u.input_tokens ?? 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
        },
        model: e.message.model ?? '',
        // promptIndex = how many conversation entries existed BEFORE this turn ran
        promptIndex: conversation.length - (txt ? 1 : 0),
      });
    }
  }
}

// Validate per-turn: sum of token estimates for prompt entries should match
// api_billed_input minus a (stable) system-overhead constant.
const rows: Row[] = [];
const overheads: number[] = [];

let idx = -1;
let processed = 0;
for (const [reqId, turn] of turnByReqId.entries()) {
  idx++;
  if (idx < offset) continue;
  if (processed++ >= limit) break;

  const promptSlice = conversation.slice(0, turn.promptIndex);
  const estimatedPromptTokens = promptSlice.reduce((a, b) => a + b.tokens, 0);

  const u = turn.usage;
  const billedInput = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  const overhead = billedInput - estimatedPromptTokens;
  overheads.push(overhead);

  const cacheReadPct = billedInput > 0 ? u.cache_read_input_tokens / billedInput : 0;

  rows.push({
    reqId,
    model: turn.model,
    promptEntries: promptSlice.length,
    estimatedPromptTokens,
    billedInput,
    overhead,
    inputTokens: u.input_tokens,
    cacheCreate: u.cache_creation_input_tokens,
    cacheRead: u.cache_read_input_tokens,
    outputTokens: u.output_tokens,
    cacheReadPct,
  });
}

// Compute stability of overhead. If our model works, overhead should be ~constant
// for a single session (= system prompt + tool defs + memory).
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
const overheadMedian = median(overheads);
const overheadAbsDeviations = overheads.map(o => Math.abs(o - overheadMedian));
const overheadMaxDev = Math.max(...overheadAbsDeviations);
const overheadAvgDev = overheadAbsDeviations.reduce((a, b) => a + b, 0) / (overheads.length || 1);

if (emitJson) {
  console.log(JSON.stringify({ rows, overheadMedian, overheadMaxDev, overheadAvgDev }, null, 2));
} else {
  console.log(`Session: ${filePath}`);
  console.log(`Turns analyzed: ${rows.length}\n`);
  console.log('  #   billedIn    estIn   overhead   cache%  model');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(
      `  ${String(i).padStart(3)}  ${String(r.billedInput).padStart(8)}  ${String(r.estimatedPromptTokens).padStart(7)}  ${String(r.overhead).padStart(8)}   ${(r.cacheReadPct * 100).toFixed(1).padStart(5)}%  ${r.model}`
    );
  }
  console.log('');
  console.log(`Overhead median (≈ system prompt + tool defs + memory): ${overheadMedian} tokens`);
  console.log(`Overhead avg absolute deviation: ${overheadAvgDev.toFixed(0)} tokens`);
  console.log(`Overhead max absolute deviation: ${overheadMaxDev} tokens`);

  // Validation criterion: relative deviation from median should be <10% of billed input
  // on each turn. If deviation is bounded and small, attribution algorithm works.
  const failingTurns = rows.filter(r => {
    const expected = r.estimatedPromptTokens + overheadMedian;
    const error = Math.abs(expected - r.billedInput);
    return error / r.billedInput > 0.10;
  });
  console.log(`\nTurns where (est + medianOverhead) error vs billedInput > 10%: ${failingTurns.length} / ${rows.length}`);
  if (failingTurns.length > 0) {
    console.log('Sample failing turns:');
    for (const r of failingTurns.slice(0, 5)) {
      const expected = r.estimatedPromptTokens + overheadMedian;
      console.log(`  req=${r.reqId} billed=${r.billedInput} est+overhead=${expected} cache%=${(r.cacheReadPct * 100).toFixed(1)}`);
    }
  }
}
