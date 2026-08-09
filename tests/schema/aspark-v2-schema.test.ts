import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSessionEntries, NAME } from '../../src/adapters/claudeCode.js';
import { extractEvents } from '../../src/extract/events.js';
import { prepareExport } from '../../src/export/pack.js';
import type { SessionRef } from '../../src/adapters/types.js';
import { compileSchema } from './ajvHelpers.js';

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

test('schema/aspark.v2.json is itself a valid JSON Schema', () => {
  assert.doesNotThrow(() => compileSchema('aspark.v2.json'));
});

test('a real exportSession output conforms to schema/aspark.v2.json', async () => {
  const validate = compileSchema('aspark.v2.json');
  const ref = makeRef('short-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  const prepared = prepareExport(ref, events);

  const valid = validate(prepared.file);
  assert.ok(valid, `expected file to conform to v2 schema, errors: ${JSON.stringify(validate.errors)}`);
});

test('a family export (with children) conforms to schema/aspark.v2.json', async () => {
  const validate = compileSchema('aspark.v2.json');
  const parent = makeRef('parent-with-subagent.jsonl');
  const parentEntries = await loadSessionEntries(parent);
  const parentEvents = extractEvents(parentEntries, parent);

  const child: SessionRef = {
    source: NAME,
    id: `${parent.id}/child-1`,
    jsonlPath: fixturesDir + 'subagent-child.jsonl',
    projectDir: parent.projectDir,
    projectLabel: `${parent.projectLabel} ↳ Explore`,
    lastActivity: new Date('2026-01-01T00:31:00.000Z'),
    sizeBytes: 0,
    parentSessionId: parent.id,
    parentToolUseId: 'toolu_test_child_1',
    agentType: 'Explore',
  };
  const childEntries = await loadSessionEntries(child);
  const childEvents = extractEvents(childEntries, child);

  const prepared = prepareExport(parent, parentEvents, {}, [{ ref: child, events: childEvents }]);

  const valid = validate(prepared.file);
  assert.ok(valid, `expected family export to conform to v2 schema, errors: ${JSON.stringify(validate.errors)}`);
});
