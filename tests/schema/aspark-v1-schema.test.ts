import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReplay } from '../../src/replay/replay.js';
import { compileSchema } from './ajvHelpers.js';

test('schema/aspark.v1.json is itself a valid JSON Schema', () => {
  assert.doesNotThrow(() => compileSchema('aspark.v1.json'));
});

test('a legacy v1-shaped file conforms to schema/aspark.v1.json and still loads via replay', async () => {
  const validate = compileSchema('aspark.v1.json');
  const legacyFile = {
    asparkVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    exportedBy: 'agentshark@0.1.2',
    redaction: { policy: 'default', patternsApplied: ['api_key'], matchCount: 0 },
    session: { label: 'claude-code · demo', agent: 'claude-code', source: 'claude-code' },
    events: [
      {
        ts: '2026-01-01T00:00:00.000Z',
        spanId: 'evt-1',
        source: 'claude-code',
        type: 'message',
        payload: 'hello',
        tags: {},
        category: 'message',
      },
    ],
  };

  const valid = validate(legacyFile);
  assert.ok(valid, `expected legacy file to conform to v1 schema, errors: ${JSON.stringify(validate.errors)}`);

  // And prove the backward-compat promise in README/docs: replay.ts must still
  // load a v1-shaped file (no `children`) even though it never validates
  // against the v1 schema at runtime.
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = mkdtempSync(join(tmpdir(), 'aspark-v1-'));
  try {
    const path = join(tmp, 'legacy.aspark');
    writeFileSync(path, JSON.stringify(legacyFile), 'utf8');
    const result = await loadReplay(path);
    assert.equal(result.children.length, 0);
    assert.equal(result.events.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
