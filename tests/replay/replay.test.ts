import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReplay } from '../../src/replay/replay.js';

function writeBundle(dir: string, name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

test('loadReplay accepts a v1 file and returns empty children', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    const path = writeBundle(dir, 'v1.aspark', {
      asparkVersion: '1',
      exportedAt: '2026-01-01T00:00:00.000Z',
      session: { id: 'sess-1', source: 'claude-code', projectLabel: 'demo', projectDir: '/x' },
      events: [{ ts: '2026-01-01T00:00:00.000Z', type: 'message', detail: 'hello', tags: {}, category: 'message' }],
    });
    const result = await loadReplay(path);
    assert.equal(result.session.id, 'sess-1');
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.children, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadReplay accepts a v2 file with children populated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    const path = writeBundle(dir, 'v2.aspark', {
      asparkVersion: '2',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'agentshark-tui',
      session: { id: 'parent', source: 'claude-code', projectLabel: 'demo', projectDir: '/x' },
      redaction: { engine: 'agentshark-redact-v1', patternsApplied: ['api_key'] },
      events: [{ ts: '2026-01-01T00:00:00.000Z', type: 'message', detail: 'parent', tags: {}, category: 'message' }],
      children: [
        {
          session: {
            id: 'parent/child-1',
            source: 'claude-code',
            projectLabel: 'demo ↳ Explore',
            projectDir: '/x',
            parentSessionId: 'parent',
            parentToolUseId: 'toolu_1',
            agentType: 'Explore',
          },
          events: [
            { ts: '2026-01-01T00:01:00.000Z', type: 'message', detail: 'child', tags: {}, category: 'message' },
          ],
        },
      ],
    });
    const result = await loadReplay(path);
    assert.equal(result.session.id, 'parent');
    assert.equal(result.events.length, 1);
    assert.equal(result.children.length, 1);
    assert.equal(result.children[0].session.id, 'parent/child-1');
    assert.equal(result.children[0].session.parentSessionId, 'parent');
    assert.equal(result.children[0].session.agentType, 'Explore');
    assert.equal(result.children[0].events.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadReplay rejects a malformed v2 file with a child missing events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    const path = writeBundle(dir, 'bad.aspark', {
      asparkVersion: '2',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'agentshark-tui',
      session: { id: 'parent', source: 'claude-code', projectLabel: 'x', projectDir: '/x' },
      redaction: { engine: 'agentshark-redact-v1', patternsApplied: [] },
      events: [],
      // Missing `events` (and most of `session`) on the child — schema violation.
      children: [{ session: { id: 'orphan' } }],
    });
    await assert.rejects(() => loadReplay(path), /schema\/aspark\.v2\.json/);
    await assert.rejects(() => loadReplay(path), /children\/0.*'events'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadReplay rejects a v2 file missing required top-level fields (exportedBy, redaction)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    const path = writeBundle(dir, 'incomplete.aspark', {
      asparkVersion: '2',
      session: { id: 'parent', source: 'claude-code', projectLabel: 'x', projectDir: '/x' },
      events: [],
    });
    await assert.rejects(() => loadReplay(path), /'exportedBy'/);
    await assert.rejects(() => loadReplay(path), /'redaction'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadReplay rejects a file with no asparkVersion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    const path = writeBundle(dir, 'noversion.aspark', {
      session: { id: 'parent', source: 'claude-code', projectLabel: 'x', projectDir: '/x' },
      events: [],
    });
    await assert.rejects(() => loadReplay(path), /asparkVersion/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
