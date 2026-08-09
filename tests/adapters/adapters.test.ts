import test from 'node:test';
import assert from 'node:assert/strict';
import * as claudeCode from '../../src/adapters/claudeCode.js';
import * as claudeCowork from '../../src/adapters/claudeCowork.js';
import * as codex from '../../src/adapters/codex.js';
import * as cursor from '../../src/adapters/cursor.js';
import * as geminiCli from '../../src/adapters/geminiCli.js';
import * as copilotCli from '../../src/adapters/copilotCli.js';

test('claudeCode advertises full capabilities including summary + cache', () => {
  assert.equal(claudeCode.NAME, 'claude-code');
  assert.ok(claudeCode.CAPABILITIES.has('discover'));
  assert.ok(claudeCode.CAPABILITIES.has('load'));
  assert.ok(claudeCode.CAPABILITIES.has('summary'));
  assert.ok(claudeCode.CAPABILITIES.has('cache'));
});

test('claudeCowork advertises full capabilities (re-exports claudeCode logic)', () => {
  assert.equal(claudeCowork.NAME, 'claude-cowork');
  assert.ok(claudeCowork.CAPABILITIES.has('summary'));
  assert.ok(claudeCowork.CAPABILITIES.has('cache'));
});

test('codex advertises full capabilities', () => {
  assert.equal(codex.NAME, 'codex');
  assert.ok(codex.CAPABILITIES.has('summary'));
});

test('cursor is discovery-only — explicitly lacks summary capability', () => {
  assert.equal(cursor.NAME, 'cursor');
  assert.ok(cursor.CAPABILITIES.has('discover'));
  assert.ok(cursor.CAPABILITIES.has('load'));
  assert.equal(cursor.CAPABILITIES.has('summary'), false,
    'Cursor must not advertise summary — README marks it discovery-only');
  assert.equal(cursor.CAPABILITIES.has('cache'), false);
});

test('geminiCli is discovery-only', () => {
  assert.equal(geminiCli.NAME, 'gemini-cli');
  assert.equal(geminiCli.CAPABILITIES.has('summary'), false);
});

test('copilotCli is discovery-only', () => {
  assert.equal(copilotCli.NAME, 'copilot-cli');
  assert.equal(copilotCli.CAPABILITIES.has('summary'), false);
});

test('stub adapters still return zero summaries (not undefined / throw)', () => {
  // Guardrail: when callers (TopView, summarizeSession in index) call into a
  // stub's summarizeSession, it must return zeros, not throw — even if the UI
  // hides the zeros under the capability flag.
  for (const adapter of [cursor, geminiCli, copilotCli]) {
    const summary = adapter.summarizeSession([]);
    assert.equal(summary.assistantTurns, 0);
    assert.equal(summary.billedInput, 0);
    assert.equal(summary.cacheRead, 0);
    assert.equal(summary.lastModel, null);
  }
});
