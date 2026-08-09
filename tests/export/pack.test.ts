import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSessionEntries, NAME } from '../../src/adapters/claudeCode.js';
import { extractEvents } from '../../src/extract/events.js';
import { exportSession, prepareExport, writeExport, gatherDescendants } from '../../src/export/pack.js';
import { sessionRegistry } from '../../src/store/sessionRegistry.js';
import type { SessionRef } from '../../src/adapters/types.js';
import type { AgentEvent } from '../../src/schema/event.js';

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

// The session-with-secrets fixture has these intentionally-fake secrets injected
// (see tests/fixtures/README.md). They must NOT appear verbatim in the exported file.
const SYNTHETIC_SECRETS = [
  'sk-ant-fixturefakekeyaaaaaaaaaaaaaaaa',
  'sk-fixturefakekeybbbbbbbbbbbbbbbb',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fixturefakefakefakefakefakefake',
];

test('exportSession produces a valid .aspark v2 file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspark-test-'));
  try {
    const ref = makeRef('short-session.jsonl');
    const entries = await loadSessionEntries(ref);
    const events = extractEvents(entries, ref);
    const outPath = await exportSession(ref, events, { outputPath: join(dir, 'out.aspark') });
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));

    assert.equal(parsed.asparkVersion, '2');
    assert.equal(parsed.session.id, ref.id);
    assert.equal(parsed.session.source, 'claude-code');
    assert.ok(parsed.events.length > 0);
    assert.equal(parsed.redaction.engine, 'agentshark-redact-v1');
    assert.ok(Array.isArray(parsed.redaction.patternsApplied));
    // No children passed → `children` is omitted from the file entirely.
    assert.equal('children' in parsed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exportSession redacts secrets from event payloads (Gap 1 baseline)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspark-test-'));
  try {
    const ref = makeRef('session-with-secrets.jsonl');
    const entries = await loadSessionEntries(ref);
    const events = extractEvents(entries, ref);

    // Sanity check: the events DO carry the synthetic secrets pre-export.
    const preExportSerialized = JSON.stringify(events);
    const seenPre = SYNTHETIC_SECRETS.filter(s => preExportSerialized.includes(s));
    assert.ok(seenPre.length > 0,
      'fixture setup error: synthetic secrets should be present in extracted events before export');

    const outPath = await exportSession(ref, events, { outputPath: join(dir, 'secrets.aspark') });
    const exported = readFileSync(outPath, 'utf8');

    for (const secret of SYNTHETIC_SECRETS) {
      assert.equal(
        exported.includes(secret),
        false,
        `exported file leaked synthetic secret: ${secret.slice(0, 24)}…`,
      );
    }
    assert.ok(exported.includes('<<REDACTED:'), 'expected at least one <<REDACTED:*>> marker in export');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepareExport returns a redaction diff with sample contexts', async () => {
  const ref = makeRef('session-with-secrets.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);

  const prepared = prepareExport(ref, events);
  assert.equal(prepared.file.asparkVersion, '2');
  assert.ok(prepared.defaultPath.endsWith('.aspark'));
  assert.ok(prepared.diff.matchCount > 0, 'expected match count > 0 for secrets fixture');

  // Each sample should have a pattern label and a context snippet.
  for (const s of prepared.diff.samples) {
    assert.ok(prepared.diff.patternsApplied.includes(s.pattern),
      `sample pattern ${s.pattern} not in patternsApplied`);
    assert.ok(s.context.length > 0, 'sample context should not be empty');
    assert.ok(s.context.length < 200, 'sample context should be short');
  }
});

test('prepareExport does NOT write any file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspark-test-'));
  try {
    const outPath = join(dir, 'should-not-exist.aspark');
    const ref = makeRef('short-session.jsonl');
    const entries = await loadSessionEntries(ref);
    const events = extractEvents(entries, ref);
    prepareExport(ref, events, { outputPath: outPath });
    // No write: file must not exist.
    assert.throws(() => readFileSync(outPath, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeExport persists a prepared file at the requested path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspark-test-'));
  try {
    const outPath = join(dir, 'persist.aspark');
    const ref = makeRef('short-session.jsonl');
    const entries = await loadSessionEntries(ref);
    const events = extractEvents(entries, ref);
    const prepared = prepareExport(ref, events, { outputPath: outPath });
    const finalPath = await writeExport(prepared);
    assert.equal(finalPath, outPath);
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(parsed.asparkVersion, '2');
    assert.ok(parsed.events.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exportSession strips internal raw field from events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aspark-test-'));
  try {
    const ref = makeRef('short-session.jsonl');
    const entries = await loadSessionEntries(ref);
    const events = extractEvents(entries, ref);
    // events arriving from extractor have a `raw` field that links to the
    // original JSONL entry — it shouldn't appear in the exported file.
    assert.ok(events.some(e => 'raw' in e), 'sanity check: events should carry `raw` before export');

    const outPath = await exportSession(ref, events, { outputPath: join(dir, 'out.aspark') });
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    for (const e of parsed.events) {
      assert.equal('raw' in e, false, 'exported event must not include raw');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepareExport preserves turnUsage on api_turn events (needed for replay context view)', async () => {
  const ref = makeRef('short-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);
  // Sanity: at least one api_turn event in the extracted stream carries turnUsage.
  assert.ok(
    events.some(e => e.type === 'api_turn' && e.turnUsage),
    'fixture should yield at least one api_turn with turnUsage',
  );

  const prepared = prepareExport(ref, events);
  // After redaction/strip, turnUsage must still be present on api_turn events.
  const exportedApiTurns = prepared.file.events.filter(e => e.type === 'api_turn');
  assert.ok(exportedApiTurns.length > 0, 'expected at least one api_turn event in export');
  assert.ok(
    exportedApiTurns.some(e => 'turnUsage' in e && e.turnUsage),
    'turnUsage must survive prepareExport so replay can recompute context composition',
  );
});

test('prepareExport with children produces a v2 family bundle', async () => {
  const parent = makeRef('parent-with-subagent.jsonl');
  const parentEntries = await loadSessionEntries(parent);
  const parentEvents = extractEvents(parentEntries, parent);

  // Synthesize a child SessionRef + events from the subagent-child fixture.
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

  assert.equal(prepared.file.asparkVersion, '2');
  assert.ok(Array.isArray(prepared.file.children));
  assert.equal(prepared.file.children!.length, 1);
  assert.equal(prepared.file.children![0].session.id, child.id);
  assert.equal(prepared.file.children![0].session.parentSessionId, parent.id);
  assert.equal(prepared.file.children![0].session.parentToolUseId, 'toolu_test_child_1');
  assert.equal(prepared.file.children![0].session.agentType, 'Explore');
  assert.ok(prepared.file.children![0].events.length > 0);
  // Parent events are unchanged.
  assert.ok(prepared.file.events.length > 0);
});

test('prepareExport reports family-wide redaction matches across parent + children', async () => {
  const ref = makeRef('short-session.jsonl');
  const entries = await loadSessionEntries(ref);
  const events = extractEvents(entries, ref);

  // Synthesize a child with a known secret in the payload.
  const childRef: SessionRef = {
    source: NAME,
    id: `${ref.id}/synthetic-child`,
    jsonlPath: '',
    projectDir: ref.projectDir,
    projectLabel: 'synthetic',
    lastActivity: new Date(),
    sizeBytes: 0,
    parentSessionId: ref.id,
    parentToolUseId: 'toolu_synth',
    agentType: 'Explore',
  };
  const childEvents: AgentEvent[] = [{
    ts: '2026-01-01T00:00:00.000Z',
    traceId: childRef.id,
    spanId: 'evt-1',
    source: NAME,
    sessionLabel: childRef.projectLabel,
    type: 'message',
    detail: 'leaked key sk-ant-leakedchildkeyxxxxxxxxxxxxxxxxxxxx',
    payload: { content: 'API key sk-ant-leakedchildkeyxxxxxxxxxxxxxxxxxxxx in child payload' },
    tags: {},
    category: 'message',
  }];

  const prepared = prepareExport(ref, events, {}, [{ ref: childRef, events: childEvents }]);
  // The diff must reflect a match found in the child's payload.
  assert.ok(
    prepared.diff.matchCount >= 1,
    `expected at least 1 family-wide redaction match, got ${prepared.diff.matchCount}`,
  );
  assert.ok(
    prepared.diff.samples.some(s => s.pattern === 'api_key'),
    'expected the child\'s api_key match to appear in samples',
  );
  // And the secret must NOT appear verbatim in the exported child's events.
  const childExport = prepared.file.children![0];
  assert.equal(
    JSON.stringify(childExport.events).includes('sk-ant-leakedchildkeyxxxxxxxxxxxxxxxxxxxx'),
    false,
    'child events must be redacted',
  );
});

test('gatherDescendants protects against parent↔child cycles in the registry', async () => {
  // Manually plant a circular link in the registry. gatherDescendants should
  // terminate cleanly without revisiting nodes.
  sessionRegistry.clear();
  const a: SessionRef = {
    source: NAME, id: 'cycle-a', jsonlPath: '', projectDir: '/x', projectLabel: 'a',
    lastActivity: new Date(), sizeBytes: 0,
  };
  const b: SessionRef = {
    source: NAME, id: 'cycle-b', jsonlPath: '', projectDir: '/x', projectLabel: 'b',
    lastActivity: new Date(), sizeBytes: 0,
    parentSessionId: 'cycle-a', parentToolUseId: 'tu-ab',
  };
  // Pathological back-edge: b's child is a.
  sessionRegistry.recordChild('cycle-a', 'tu-ab', b);
  sessionRegistry.recordChild('cycle-b', 'tu-ba', a);

  // Should not hang or recurse infinitely. Both children will fail to load
  // (empty jsonlPath), so the result is an empty array — but the important
  // thing is that the call terminates.
  const descendants = await gatherDescendants(a);
  assert.ok(Array.isArray(descendants), 'gatherDescendants must return an array even on a cyclic graph');
  sessionRegistry.clear();
});
