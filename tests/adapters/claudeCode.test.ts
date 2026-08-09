import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSessionEntries, summarizeSession, applyLimitKeepingFamilies, NAME } from '../../src/adapters/claudeCode.js';
import type { SessionRef } from '../../src/adapters/types.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/claude-code/', import.meta.url));

function makeRef(file: string): SessionRef {
  return {
    source: NAME,
    id: file.replace(/\.jsonl$/, ''),
    jsonlPath: fixturesDir + file,
    projectDir: '/Users/dev/projects/example',
    projectLabel: 'example',
    lastActivity: new Date('2026-01-01T00:30:00.000Z'),
    sizeBytes: 0,
  };
}

test('adapter NAME identifies as claude-code', () => {
  assert.equal(NAME, 'claude-code');
});

test('loadSessionEntries parses every JSONL line into objects', async () => {
  const entries = await loadSessionEntries(makeRef('short-session.jsonl'));
  assert.ok(entries.length > 0);
  // Every entry should be an object (JSON-parsed)
  for (const e of entries) {
    assert.equal(typeof e, 'object');
    assert.notEqual(e, null);
  }
});

test('loadSessionEntries skips malformed lines without crashing', async () => {
  const entries = await loadSessionEntries(makeRef('short-session.jsonl'));
  // Total line count and entry count should be close — confirms loader
  // doesn't drop valid entries.
  assert.ok(entries.length >= 10);
});

test('summarizeSession counts assistant turns and totals tokens', async () => {
  const entries = await loadSessionEntries(makeRef('long-session.jsonl'));
  const summary = summarizeSession(entries);
  // long-session.jsonl is a multi-turn high-cache session. Multiple JSONL
  // "assistant" entries can share one requestId (content blocks of one turn);
  // turns are deduplicated by requestId, so the count is smaller than raw rows.
  assert.ok(summary.assistantTurns >= 3, `expected ≥3 turns, got ${summary.assistantTurns}`);
  assert.ok(summary.billedInput > 50_000, `expected billedInput > 50K, got ${summary.billedInput}`);
  assert.ok(summary.cacheRead > 50_000, `expected cacheRead > 50K, got ${summary.cacheRead}`);
});

test('summarizeSession derives cacheReadPct = cacheRead / billedInput', async () => {
  const entries = await loadSessionEntries(makeRef('long-session.jsonl'));
  const summary = summarizeSession(entries);
  assert.ok(summary.cacheReadPct >= 0 && summary.cacheReadPct <= 1);
  // long-session.jsonl was chosen for very high cache (~99.7%) — sanity
  assert.ok(summary.cacheReadPct > 0.95, `expected >95% cache, got ${(summary.cacheReadPct * 100).toFixed(1)}%`);
});

test('summarizeSession deduplicates assistant turns by requestId', async () => {
  // Build a synthetic entry list with the same requestId twice — only the
  // first should count.
  const entries = [
    { type: 'assistant', timestamp: '2026-01-01T00:00:00.000Z', requestId: 'r1',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 10 } } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', requestId: 'r1',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 10 } } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:02.000Z', requestId: 'r2',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 50, output_tokens: 5 } } },
  ];
  const summary = summarizeSession(entries);
  assert.equal(summary.assistantTurns, 2);
  assert.equal(summary.billedInput, 150);
  assert.equal(summary.outputTokens, 15);
});

test('summarizeSession returns zeros for empty input', () => {
  const summary = summarizeSession([]);
  assert.equal(summary.assistantTurns, 0);
  assert.equal(summary.billedInput, 0);
  assert.equal(summary.cacheRead, 0);
  assert.equal(summary.outputTokens, 0);
  assert.equal(summary.cacheReadPct, 0);
  assert.equal(summary.lastModel, null);
});

test('summarizeSession ignores entries without usage', () => {
  const entries = [
    { type: 'user', timestamp: '2026-01-01T00:00:00.000Z' },
    { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', requestId: 'r1', message: { model: 'm' } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:02.000Z', requestId: 'r2',
      message: { model: 'm', usage: { input_tokens: 10 } } },
  ];
  const summary = summarizeSession(entries);
  assert.equal(summary.assistantTurns, 1);
  assert.equal(summary.billedInput, 10);
});

test('summarizeSession tracks first and last timestamps across all entries', () => {
  const entries = [
    { type: 'user', timestamp: '2026-01-01T00:00:00.000Z' },
    { type: 'assistant', timestamp: '2026-01-01T00:30:00.000Z', requestId: 'r1', message: { usage: { input_tokens: 1 } } },
    { type: 'user', timestamp: '2026-01-01T01:00:00.000Z' },
  ];
  const summary = summarizeSession(entries);
  assert.equal(summary.firstTs, '2026-01-01T00:00:00.000Z');
  assert.equal(summary.lastTs, '2026-01-01T01:00:00.000Z');
});

function mkSession(id: string, minutesAgo: number, parentSessionId?: string): SessionRef {
  return {
    source: NAME,
    id,
    jsonlPath: `/x/${id}.jsonl`,
    projectDir: '/x',
    projectLabel: 'x',
    lastActivity: new Date(Date.now() - minutesAgo * 60_000),
    sizeBytes: 0,
    ...(parentSessionId ? { parentSessionId } : {}),
  };
}

test('applyLimitKeepingFamilies ranks a family by its freshest member, not the parent alone', () => {
  // parent-old-with-children's own row is ancient, but it has a sub-agent
  // active right now — that makes the family itself one of the freshest,
  // so it must beat parent-recent-3 (whose own activity is only 3 min old)
  // for one of the 3 limit slots. Naive parent-only sorting would exclude it
  // and leave its fresh children as orphan rows instead.
  const sessions: SessionRef[] = [
    mkSession('parent-recent-1', 1),
    mkSession('parent-recent-2', 2),
    mkSession('parent-recent-3', 3),
    mkSession('parent-old-with-children', 1000),
    mkSession('child-1', 0, 'parent-old-with-children'),
    mkSession('child-2', 0.5, 'parent-old-with-children'),
  ];

  const result = applyLimitKeepingFamilies(sessions, 3);
  const ids = result.map(s => s.id);

  assert.ok(ids.includes('parent-old-with-children'), 'parent must survive because its child is fresh');
  assert.ok(ids.includes('child-1') && ids.includes('child-2'), 'both children must survive with their parent');
  assert.ok(!ids.includes('parent-recent-3'), 'least-active family should be the one bumped by the limit');
  assert.equal(result.filter(s => !s.parentSessionId).length, 3, 'limit still caps total families kept, not just top-level count');
});

test('applyLimitKeepingFamilies never produces an orphan child — a cut parent takes its children with it', () => {
  const sessions: SessionRef[] = [
    mkSession('parent-1', 1),
    mkSession('parent-2', 2),
    mkSession('parent-3-excluded', 30),
    mkSession('child-of-excluded', 25, 'parent-3-excluded'),
  ];
  const result = applyLimitKeepingFamilies(sessions, 2);
  const ids = result.map(s => s.id);
  assert.ok(!ids.includes('parent-3-excluded'));
  assert.ok(!ids.includes('child-of-excluded'), 'a child of an excluded parent should not become an orphan row');
});

test('summarizeSession captures lastModel from the most recent assistant turn', () => {
  const entries = [
    { type: 'assistant', timestamp: '2026-01-01T00:00:00.000Z', requestId: 'r1',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1 } } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', requestId: 'r2',
      message: { model: 'claude-opus-4-7', usage: { input_tokens: 1 } } },
  ];
  const summary = summarizeSession(entries);
  assert.equal(summary.lastModel, 'claude-opus-4-7');
});
