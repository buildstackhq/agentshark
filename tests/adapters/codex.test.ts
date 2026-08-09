import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEvents } from '../../src/extract/events.js';
import type { SessionRef } from '../../src/adapters/types.js';
import { loadSessionEntries, summarizeSession } from '../../src/adapters/codex.js';

const fixturePath = fileURLToPath(new URL('./fixtures/codex-normalization.jsonl', import.meta.url));

const sessionRef: SessionRef = {
  source: 'codex',
  id: 'thread-abc',
  jsonlPath: fixturePath,
  projectDir: '/Users/alex/projects/buildstack',
  projectLabel: 'buildstack',
  lastActivity: new Date('2026-05-30T12:00:06.000Z'),
  sizeBytes: 0,
};

test('codex adapter normalizes legacy and mixed entry shapes', async () => {
  const entries = await loadSessionEntries(sessionRef);
  const normalizedEntries = entries as any[];

  assert.equal(normalizedEntries.length, 5);

  const assistantEntries = normalizedEntries.filter((entry: any) => entry.type === 'assistant');
  assert.equal(assistantEntries.length, 3);

  const responseAssistant = assistantEntries.find((entry: any) => entry.requestId === 'turn-1');
  assert.ok(responseAssistant);
  assert.equal(responseAssistant.message.model, 'codex-test-model');
  assert.equal(responseAssistant.message.usage.input_tokens, 100);
  assert.equal(responseAssistant.message.usage.cache_read_input_tokens, 20);
  assert.equal(responseAssistant.message.usage.output_tokens, 12);

  const looseAssistant = assistantEntries.find((entry: any) => entry.requestId == null && entry.message?.content?.[0]?.text === 'Loose assistant says hi');
  assert.ok(looseAssistant);
  assert.equal(looseAssistant.message.model, 'codex-test-model');
  assert.equal(looseAssistant.message.usage.input_tokens, 12);
  assert.equal(looseAssistant.message.usage.cache_read_input_tokens, 3);

  const looseUser = normalizedEntries.find((entry: any) => entry.type === 'user' && entry.message?.content?.[0]?.text === 'Loose user note');
  assert.ok(looseUser);
});

test('codex extraction preserves subagent and tool-result coverage', async () => {
  const entries = await loadSessionEntries(sessionRef);
  const events = extractEvents(entries, sessionRef);

  const subagents = events.filter(event => event.type === 'subagent');
  const toolResults = events.filter(event => event.type === 'tool_result');
  const assistantMessages = events.filter(event => event.type === 'message' && event.subtype === 'assistant');

  assert.ok(assistantMessages.length >= 2);
  assert.equal(subagents.length, 1);
  assert.equal(subagents[0]?.subtype, 'subagent');
  assert.match(subagents[0]?.detail ?? '', /Agent/);

  assert.equal(toolResults.length, 1);
  assert.equal(toolResults[0]?.subtype, 'success');
  assert.equal((toolResults[0]?.payload as { tool_use_id?: string } | undefined)?.tool_use_id, 'call-1');
});

test('codex summarization counts only usage-bearing assistant turns', async () => {
  const entries = await loadSessionEntries(sessionRef);
  const summary = summarizeSession(entries);

  assert.equal(summary.assistantTurns, 2);
  assert.equal(summary.lastModel, 'codex-test-model');
  assert.equal(summary.billedInput, 135);
  assert.equal(summary.cacheRead, 23);
  assert.equal(summary.outputTokens, 13);
});
