#!/usr/bin/env node
// Belt-and-suspenders check: scan every tests/fixtures/**/*.jsonl for the same
// secret patterns the redactor looks for. Fails the test suite if a real-looking
// secret leaks through the scrubber, EXCEPT in session-with-secrets.jsonl where
// synthetic secrets are intentional.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const FIXTURES_DIR = new URL('../tests/fixtures/', import.meta.url).pathname;

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'api_key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'username_leak', re: /cshanmugam|sekar\.fa@gmail\.com/g },
  { name: 'real_project_leak', re: /\b(?:ht\/buildstack|ht\/prd|ht\/rippulse|ht\/nofye|ht\/build)\/[a-z]/g },
];

const ALLOW_LIST = new Set(['session-with-secrets.jsonl']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (extname(p) === '.jsonl') yield p;
  }
}

let failed = 0;
for (const file of walk(FIXTURES_DIR)) {
  if (ALLOW_LIST.has(basename(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      console.error(`✗ ${file.replace(FIXTURES_DIR, 'tests/fixtures/')}: matched ${name}: ${m[0].slice(0, 60)}`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} fixture(s) contain secret-shaped content. Re-scrub before commit.`);
  process.exit(1);
} else {
  console.log('✓ fixtures clean');
}
