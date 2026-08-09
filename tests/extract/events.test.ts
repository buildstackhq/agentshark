import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSessionEntries, NAME } from '../../src/adapters/claudeCode.js';
import { extractEvents, normalizeHookSubtype } from '../../src/extract/events.js';
import { compileFilter } from '../../src/store/filter.js';
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

test('normalizeHookSubtype maps documented CamelCase forms to snake_case', () => {
  assert.equal(normalizeHookSubtype('PreToolUse'), 'pre_tool');
  assert.equal(normalizeHookSubtype('PostToolUse'), 'post_tool');
  assert.equal(normalizeHookSubtype('UserPromptSubmit'), 'user_prompt_submit');
  assert.equal(normalizeHookSubtype('Stop'), 'stop');
});

test('normalizeHookSubtype falls back to CamelCase→snake_case for unknown values', () => {
  assert.equal(normalizeHookSubtype('SubagentStop'), 'subagent_stop');
  assert.equal(normalizeHookSubtype('SessionStart'), 'session_start');
});

test('normalizeHookSubtype handles empty / null gracefully', () => {
  assert.equal(normalizeHookSubtype(undefined), 'unknown');
  assert.equal(normalizeHookSubtype(null), 'unknown');
  assert.equal(normalizeHookSubtype(''), 'unknown');
});

test('extractEvents emits hook events from with-hooks.jsonl fixture (Gap 2 baseline)', async () => {
  const ref = makeRef('with-hooks.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);

  const hooks = events.filter(e => e.type === 'hook');
  assert.ok(hooks.length > 0, 'fixture should produce at least one hook event');

  // Every hook event must have a snake_case subtype and a populated tags.hook_event
  for (const h of hooks) {
    assert.ok(h.subtype && /^[a-z_]+$/.test(h.subtype), `hook subtype not snake_case: ${h.subtype}`);
    assert.ok(h.tags.hook_event, 'tags.hook_event must be populated');
    assert.ok(h.tags.hook_name, 'tags.hook_name must be populated');
  }
});

test('hook:pre_tool filter matches snake_case subtype (Gap 2 acceptance)', async () => {
  const ref = makeRef('with-hooks.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const matched = events.filter(compileFilter('hook:pre_tool'));
  assert.ok(matched.length > 0, 'docs-promised hook:pre_tool should now match real fixture events');
  for (const h of matched) {
    assert.equal(h.type, 'hook');
    assert.equal(h.subtype, 'pre_tool');
  }
});

test('hook events preserve the raw CamelCase value for inspection', async () => {
  const ref = makeRef('with-hooks.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const preTool = events.find(e => e.type === 'hook' && e.subtype === 'pre_tool');
  assert.ok(preTool, 'expected at least one pre_tool hook event in the fixture');
  assert.equal(preTool.tags.hook_event_raw, 'PreToolUse',
    'raw CamelCase value should be preserved in tags.hook_event_raw');
});

test('extractEvents emits type:subagent when parent calls the Agent tool', async () => {
  const ref = makeRef('parent-with-subagent.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const subagents = events.filter(e => e.type === 'subagent');
  assert.ok(subagents.length > 0, 'parent-with-subagent fixture should produce sub-agent spawn events');
});

test('extractEvents surfaces api_turn boundaries with usage attached', async () => {
  const ref = makeRef('long-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const apiTurns = events.filter(e => e.type === 'api_turn');
  assert.ok(apiTurns.length > 0, 'long-session should have at least one api_turn');
  for (const t of apiTurns) {
    assert.ok(t.payload, 'api_turn should carry payload');
  }
});

test('extractEvents tags every event with a cacheState (Gap 3 acceptance)', async () => {
  const ref = makeRef('long-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);

  // long-session.jsonl has ~99.7% cache_read across turns; the majority of
  // events under those turns should be tagged 'hit'.
  const withCacheState = events.filter(e => e.cacheState !== undefined);
  assert.equal(withCacheState.length, events.length,
    'every event should carry a cacheState after Gap 3');

  const hits = events.filter(e => e.cacheState === 'hit').length;
  const total = events.length;
  assert.ok(hits / total > 0.3,
    `expected majority cache hits in long-session; got ${hits}/${total} = ${(hits/total*100).toFixed(1)}%`);
});

test('cache: filter matches per-event cacheState', async () => {
  const ref = makeRef('long-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const hitMatched = events.filter(compileFilter('cache:hit'));
  const noneMatched = events.filter(compileFilter('cache:none'));
  assert.ok(hitMatched.length > 0, 'cache:hit should match events tagged hit');
  assert.equal(
    hitMatched.length + noneMatched.length + events.filter(compileFilter('cache:write')).length,
    events.length,
    'every event should fall into exactly one of {hit, write, none}',
  );
});
