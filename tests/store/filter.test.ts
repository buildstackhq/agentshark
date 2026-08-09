import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFilter } from '../../src/store/filter.js';
import type { AgentEvent } from '../../src/schema/event.js';

function mk(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    traceId: 'trace-default',
    spanId: 'span-1',
    source: 'claude-code',
    sessionLabel: 'cc · example',
    type: 'message',
    subtype: 'user',
    tokensIn: 100,
    detail: 'hello',
    tags: {},
    category: 'message_user',
    ...overrides,
  };
}

const events: AgentEvent[] = [
  mk({ spanId: 'a', type: 'message', subtype: 'user', tokensIn: 100 }),
  mk({ spanId: 'b', type: 'tool_call', subtype: 'file_read', tokensIn: 500, tags: { tool_name: 'Read' }, category: 'file_read' }),
  mk({ spanId: 'c', type: 'mcp', subtype: 'request', tokensIn: 1500, tags: { mcp_server: 'gmail', mcp_tool: 'list' }, category: 'mcp_request', detail: 'gmail/list payload' }),
  mk({ spanId: 'd', type: 'hook', subtype: 'pretooluse', tokensIn: 0, tags: { hook_event: 'PreToolUse', hook_name: 'PreToolUse:Bash' }, category: 'hook' }),
  mk({ spanId: 'e', type: 'cache', subtype: 'hit', tokensIn: 2000, category: 'cache' }),
  mk({ spanId: 'f', type: 'tool_call', subtype: 'bash', tokensIn: 50, source: 'codex', tags: { tool_name: 'Bash' }, category: 'bash' }),
  mk({ spanId: 'g', type: 'message', subtype: 'assistant', tokensIn: 800, model: 'claude-opus-4-7', category: 'message_assistant' }),
];

test('empty filter matches everything', () => {
  const f = compileFilter('');
  assert.equal(events.filter(f).length, events.length);
});

test('whitespace-only filter matches everything', () => {
  const f = compileFilter('   ');
  assert.equal(events.filter(f).length, events.length);
});

test('type: matches by event type prefix', () => {
  assert.deepEqual(
    events.filter(compileFilter('type:mcp')).map(e => e.spanId),
    ['c'],
  );
  assert.deepEqual(
    events.filter(compileFilter('type:tool_call')).map(e => e.spanId),
    ['b', 'f'],
  );
});

test('subtype: matches by event subtype prefix', () => {
  assert.deepEqual(
    events.filter(compileFilter('subtype:user')).map(e => e.spanId),
    ['a'],
  );
});

test('source: matches by source', () => {
  assert.deepEqual(
    events.filter(compileFilter('source:codex')).map(e => e.spanId),
    ['f'],
  );
});

test('mcp: matches tags.mcp_server', () => {
  assert.deepEqual(
    events.filter(compileFilter('mcp:gmail')).map(e => e.spanId),
    ['c'],
  );
});

test('hook: matches tags.hook_event (normalized snake_case)', () => {
  // After Gap 2: the extractor normalizes Claude Code's CamelCase hookEvent
  // ("PreToolUse") to the snake_case form the docs advertise ("pre_tool").
  // The synthetic test event below uses the normalized form directly.
  const normalized = events.map(e =>
    e.type === 'hook' ? { ...e, tags: { ...e.tags, hook_event: 'pre_tool' } } : e,
  );
  assert.deepEqual(
    normalized.filter(compileFilter('hook:pre_tool')).map(e => e.spanId),
    ['d'],
  );
});

test('trace: matches traceId', () => {
  const withTrace = mk({ spanId: 'h', traceId: 'unique-trace-id' });
  assert.equal(
    [withTrace, ...events].filter(compileFilter('trace:unique')).length,
    1,
  );
});

test('model: matches event.model', () => {
  assert.deepEqual(
    events.filter(compileFilter('model:claude-opus')).map(e => e.spanId),
    ['g'],
  );
});

test('category: matches event.category prefix', () => {
  assert.deepEqual(
    events.filter(compileFilter('category:mcp_request')).map(e => e.spanId),
    ['c'],
  );
});

test('tokens > N matches', () => {
  const f = compileFilter('tokens > 1000');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId).sort(),
    ['c', 'e'],
  );
});

test('tokens < N matches', () => {
  const f = compileFilter('tokens < 100');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId).sort(),
    ['d', 'f'],
  );
});

test('tokens > 0 (edge)', () => {
  const f = compileFilter('tokens > 0');
  const ids = events.filter(f).map(e => e.spanId).sort();
  // hook (d) has tokensIn=0 → excluded; all others > 0 → included
  assert.deepEqual(ids, ['a', 'b', 'c', 'e', 'f', 'g']);
});

test('quoted regex matches haystack containing payload+tags+detail', () => {
  const f = compileFilter('"gmail"');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId),
    ['c'],
  );
});

test('quoted regex with anchor', () => {
  const f = compileFilter('"^claude-opus"');
  // regex is tested against JSON-stringified detail+payload+tags. The model
  // field is NOT in that haystack, so a literal "claude-opus" would only
  // match in detail/tag/payload. Confirm behavior to lock in the contract.
  assert.equal(events.filter(f).length, 0);
});

test('invalid regex does not crash; returns false', () => {
  const f = compileFilter('"[unclosed"');
  assert.equal(events.filter(f).length, 0);
});

test('AND combinator', () => {
  const f = compileFilter('type:tool_call AND tokens > 100');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId),
    ['b'],
  );
});

test('OR combinator', () => {
  const f = compileFilter('type:mcp OR type:hook');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId).sort(),
    ['c', 'd'],
  );
});

test('NOT prefix', () => {
  const f = compileFilter('NOT source:codex');
  assert.equal(events.filter(f).length, events.length - 1);
});

test('parenthesized grouping', () => {
  const f = compileFilter('(type:tool_call OR type:mcp) AND NOT source:codex');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId).sort(),
    ['b', 'c'],
  );
});

test('whitespace tolerance: extra spaces parse identically', () => {
  const a = compileFilter('type:mcp   AND   tokens > 500');
  const b = compileFilter('type:mcp AND tokens > 500');
  assert.deepEqual(
    events.filter(a).map(e => e.spanId),
    events.filter(b).map(e => e.spanId),
  );
});

test('unknown key:value falls back to regex (does not match nothing silently)', () => {
  // "fakekey:somevalue" isn't in KEYS, so it should be treated as a regex
  // against the haystack — and won't match unless the literal substring appears.
  const f = compileFilter('fakekey:somevalue');
  assert.equal(events.filter(f).length, 0);
});

test('case-insensitive value matching on kv', () => {
  // filter.ts evaluator lowercases both sides
  const f = compileFilter('type:MCP');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId),
    ['c'],
  );
});

test('boolean precedence: AND binds tighter than OR', () => {
  // "type:mcp OR type:hook AND tokens > 1000" should parse as
  // type:mcp OR (type:hook AND tokens > 1000) → only c matches
  // (hook has tokens=0 so the AND branch is empty).
  const f = compileFilter('type:mcp OR type:hook AND tokens > 1000');
  assert.deepEqual(
    events.filter(f).map(e => e.spanId),
    ['c'],
  );
});
