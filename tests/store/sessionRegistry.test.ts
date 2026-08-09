import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRegistry } from '../../src/store/sessionRegistry.js';
import type { SessionRef } from '../../src/adapters/types.js';

function makeChild(id: string, lastActivity: Date, parentSessionId: string, toolUseId: string): SessionRef {
  return {
    source: 'claude-code',
    id,
    jsonlPath: `/x/${id}.jsonl`,
    projectDir: '/x',
    projectLabel: 'x',
    lastActivity,
    sizeBytes: 0,
    parentSessionId,
    parentToolUseId: toolUseId,
  };
}

test('sessionRegistry records and looks up children by parent', () => {
  sessionRegistry.clear();
  const child = makeChild('parent-a/child-1', new Date('2026-01-01T00:00:00Z'), 'parent-a', 'toolu_1');
  sessionRegistry.recordChild('parent-a', 'toolu_1', child);
  assert.ok(sessionRegistry.hasChildren('parent-a'));
  assert.equal(sessionRegistry.hasChildren('parent-b'), false);
  assert.deepEqual(sessionRegistry.childrenOf('parent-a').map(c => c.id), ['parent-a/child-1']);
});

test('mostRecentChild returns the child with the newest lastActivity', () => {
  sessionRegistry.clear();
  const older = makeChild('p/c-old', new Date('2026-01-01T00:00:00Z'), 'p', 'toolu_old');
  const newer = makeChild('p/c-new', new Date('2026-01-02T00:00:00Z'), 'p', 'toolu_new');
  sessionRegistry.recordChild('p', 'toolu_old', older);
  sessionRegistry.recordChild('p', 'toolu_new', newer);
  assert.equal(sessionRegistry.mostRecentChild('p')?.id, 'p/c-new');
});

test('childForToolUse correlates a parent tool_use id to its spawned child', () => {
  sessionRegistry.clear();
  const c = makeChild('p/c', new Date(), 'p', 'toolu_abc');
  sessionRegistry.recordChild('p', 'toolu_abc', c);
  assert.equal(sessionRegistry.childForToolUse('p', 'toolu_abc')?.id, 'p/c');
  assert.equal(sessionRegistry.childForToolUse('p', 'toolu_unknown'), undefined);
});

test('clear() resets all state', () => {
  sessionRegistry.clear();
  const c = makeChild('p/c', new Date(), 'p', 'toolu_z');
  sessionRegistry.recordChild('p', 'toolu_z', c);
  assert.ok(sessionRegistry.hasChildren('p'));
  sessionRegistry.clear();
  assert.equal(sessionRegistry.hasChildren('p'), false);
  assert.equal(sessionRegistry.mostRecentChild('p'), undefined);
});

test('mostRecentChild returns undefined for unknown parent', () => {
  sessionRegistry.clear();
  assert.equal(sessionRegistry.mostRecentChild('nonexistent'), undefined);
});

test('registry can be seeded from a flat list of refs (replay path)', () => {
  sessionRegistry.clear();
  // Simulate replay-load: a flat list of children all keyed off a single parent.
  const flat = [
    makeChild('root/a', new Date('2026-01-01T00:00:00Z'), 'root', 'tu-a'),
    makeChild('root/b', new Date('2026-01-01T00:05:00Z'), 'root', 'tu-b'),
    makeChild('root/c', new Date('2026-01-01T00:03:00Z'), 'root', 'tu-c'),
  ];
  for (const child of flat) {
    sessionRegistry.recordChild(child.parentSessionId!, child.parentToolUseId!, child);
  }
  assert.ok(sessionRegistry.hasChildren('root'));
  // childrenOf returns most-recent first.
  assert.deepEqual(
    sessionRegistry.childrenOf('root').map(c => c.id),
    ['root/b', 'root/c', 'root/a'],
  );
  assert.equal(sessionRegistry.mostRecentChild('root')?.id, 'root/b');
});
