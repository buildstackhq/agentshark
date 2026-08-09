#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deterministic content scrubber for Claude Code / Codex JSONL sessions.
//
// Reads a real session file, emits a structurally-identical session with:
//   - All UUIDs / IDs / requestIds replaced with stable SHA-1 hashes (relationships preserved)
//   - All timestamps offset to a fixed base (relative ordering preserved)
//   - File paths normalized to /Users/dev/projects/example/<basename>
//   - File contents / Bash outputs / message text replaced with a size marker
//   - Git author / cwd normalized
//   - Secret patterns redacted as a final safety pass
//
// Usage: tsx scripts/scrub-session.ts <input.jsonl> <output.jsonl>
//
// Determinism: SHA-1 of original value → same scrubbed value across runs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { redactString } from '../src/redact/redact.js';

const BASE_TS_MS = Date.parse('2026-01-01T00:00:00.000Z');
const SCRUBBED_PROJECT = '/Users/dev/projects/example';

const ID_KEYS = new Set([
  'uuid', 'parentUuid', 'promptId', 'sessionId', 'requestId',
  'messageId', 'agentId', 'toolUseId', 'tool_use_id', 'toolUseID',
]);

const PATH_KEYS = new Set([
  'path', 'file_path', 'filePath', 'filename', 'displayPath', 'uri',
  'cwd', 'projectDir',
]);

const TEXT_KEYS = new Set([
  'text', 'thinking',
  'stdout', 'stderr',
  'old_string', 'new_string',
  'command', 'prompt', 'description',
]);

// Keys whose values are short structural identifiers — keep verbatim.
const KEEP_VERBATIM = new Set([
  'type', 'subtype', 'role', 'name', 'model',
  'hookEvent', 'hookName',
  'agentType', 'subagent_type',
  'permissionMode', 'mode', 'status',
  'userType', 'entrypoint', 'version', 'slug',
  'gitBranch',
  'asparkVersion', 'engine', 'policy',
]);

let firstTsMs: number | null = null;

function hashId(s: string, prefix = 'fix-'): string {
  if (!s) return s;
  return prefix + createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function offsetTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  if (firstTsMs === null) firstTsMs = ms;
  const offset = firstTsMs - BASE_TS_MS;
  return new Date(ms - offset).toISOString();
}

function scrubPath(p: string): string {
  if (!p) return p;
  // Strip leading absolute paths from the user's home; keep basename only.
  if (p.startsWith('/Users/') || p.startsWith('/home/')) {
    return `${SCRUBBED_PROJECT}/${basename(p)}`;
  }
  // Strip relative paths that traverse out into named project dirs — these
  // leak the real project name. Keep basename only.
  if (p.includes('/')) {
    return `${SCRUBBED_PROJECT}/${basename(p)}`;
  }
  return p;
}

function scrubLongText(label: string, val: string): string {
  return `scrubbed ${label} (${val.length} chars)`;
}

function scrubSecrets(s: string): string {
  // Reuse the app's own secret patterns (src/redact/redact.ts) instead of a
  // hand-rolled, narrower copy — otherwise the two lists silently drift and
  // this scrubber misses secret shapes (e.g. `OPENAI_API_KEY=`, generic
  // `KEY|TOKEN|SECRET=` assignments, base64 blobs) that the real export path
  // would catch.
  return redactString(s)
    .replace(/cshanmugam/g, 'dev')
    .replace(/sekar\.fa@gmail\.com/gi, 'dev@example.com')
    // Normalize any path leak that escaped per-field handling.
    // /Users/<anything>/<rest> → /Users/dev/projects/example/<basename>
    .replace(/\/(Users|home)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._/-]+)?/g, (match) => {
      const bn = match.split('/').filter(Boolean).pop() || '';
      return `${SCRUBBED_PROJECT}/${bn}`;
    });
}

function isIsoTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
}

function scrub(val: any, key: string | null, parentKey: string | null): any {
  if (val == null) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;

  if (typeof val === 'string') {
    if (!val) return val;
    if (key && KEEP_VERBATIM.has(key)) return val;
    if (key === 'timestamp' && isIsoTimestamp(val)) return offsetTimestamp(val);
    if (key === 'id' || (key && ID_KEYS.has(key))) {
      // msg_XXX, toolu_XXX, prompt UUIDs, session UUIDs — hash with prefix
      if (val.startsWith('msg_')) return 'msg_' + createHash('sha1').update(val).digest('hex').slice(0, 12);
      if (val.startsWith('toolu_')) return 'toolu_' + createHash('sha1').update(val).digest('hex').slice(0, 12);
      return hashId(val);
    }
    if (key && PATH_KEYS.has(key)) {
      if (key === 'cwd' || key === 'projectDir') return SCRUBBED_PROJECT;
      return scrubPath(val);
    }
    if (key === 'content') {
      // tool_result content (string form) or attachment.content (string form) —
      // truncate to size marker. But message.content can also be a string for
      // user messages, where we still want to preserve a tiny placeholder.
      if (parentKey === 'message' && val.length < 500) {
        return scrubLongText('message content', val);
      }
      return scrubLongText('content', val);
    }
    if (key && TEXT_KEYS.has(key)) {
      return scrubLongText(key, val);
    }
    // Fallback: scrub secrets, replace usernames, but otherwise keep.
    return scrubSecrets(val);
  }

  if (Array.isArray(val)) {
    return val.map((v) => scrub(v, null, key));
  }

  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      // Object keys themselves can be paths (e.g. trackedFileBackups keyed by
      // absolute path). Scrub key shapes that look like paths.
      const scrubbedKey = (k.startsWith('/Users/') || k.startsWith('/home/'))
        ? `${SCRUBBED_PROJECT}/${basename(k)}`
        : k;
      out[scrubbedKey] = scrub(v, k, key);
    }
    return out;
  }
  return val;
}

function main(): void {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: tsx scripts/scrub-session.ts <input.jsonl> <output.jsonl>');
    process.exit(2);
  }

  const raw = readFileSync(input, 'utf8');
  const lines = raw.split('\n');

  // Reset state per file so each input is reproducible standalone.
  firstTsMs = null;

  const outLines: string[] = [];
  let parseErrors = 0;
  for (const line of lines) {
    if (!line) { outLines.push(''); continue; }
    let obj: any;
    try { obj = JSON.parse(line); } catch { parseErrors++; continue; }
    const scrubbed = scrub(obj, null, null);
    outLines.push(JSON.stringify(scrubbed));
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, outLines.join('\n'), 'utf8');

  const inSize = raw.length;
  const outSize = outLines.join('\n').length;
  console.error(`scrubbed ${lines.length} lines · in=${inSize}b out=${outSize}b · parse errors=${parseErrors}`);
}

main();
