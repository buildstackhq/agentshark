import test from 'node:test';
import assert from 'node:assert/strict';
import { scanForRedaction, createRedactionCollector, redactDeep } from '../../src/redact/redact.js';

function repeatedApiKey(n: number): string {
  return Array.from({ length: n }, (_, i) => `sk-${'a'.repeat(24)}${i}`).join(' ');
}

test('scanForRedaction reports the true match count, not just the capped sample count', () => {
  const text = repeatedApiKey(10);
  const { samples, matchCount } = scanForRedaction(text);
  assert.equal(matchCount, 10, 'matchCount should count every match, not cap at the sample limit');
  assert.equal(samples.length, 3, 'samples should still be capped at 3 for the confirmation UI');
});

test('createRedactionCollector redacts every match while also reporting the true count', () => {
  const text = repeatedApiKey(10);
  const collector = createRedactionCollector();
  const redacted = collector.redact(text) as string;
  assert.equal(collector.matchCount, 10);
  assert.equal(collector.samples.length, 3);
  assert.ok(!/sk-a{24}/.test(redacted), 'no raw secret should survive redaction');
  assert.equal((redacted.match(/<<REDACTED:api_key>>/g) ?? []).length, 10, 'every match must be redacted, not just the sampled ones');
});

test('createRedactionCollector output matches plain redactDeep for a nested object', () => {
  const obj = { a: repeatedApiKey(2), b: { c: 'no secrets here' } };
  const collector = createRedactionCollector();
  assert.deepEqual(collector.redact(obj), redactDeep(obj));
});
