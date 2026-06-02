#!/usr/bin/env node
// Measure timestamp resolution in Claude Code JSONL transcripts.
// Question: do timestamps carry sub-second precision reliably enough to
// label tool-call durations as "412ms" vs "~0.4s" in the UI?

import { readFile } from 'node:fs/promises';
import process from 'node:process';

interface Entry {
  timestamp?: string;
  [key: string]: unknown;
}

const file = process.argv[2];
if (!file) { console.error('usage: timestamp-resolution.ts <session.jsonl>'); process.exit(2); }

const text = await readFile(file, 'utf8');
const lines = text.split('\n').filter(Boolean);

const tsList: number[] = [];
for (const line of lines) {
  let obj: Entry;
  try { obj = JSON.parse(line) as Entry; } catch { continue; }
  if (obj.timestamp) tsList.push(new Date(obj.timestamp).getTime());
}

// Distribution of milliseconds digit usage
const msBuckets = new Array<number>(10).fill(0);
for (const t of tsList) msBuckets[Math.floor((t % 1000) / 100)]++;

// Distribution of consecutive gaps
const gaps: number[] = [];
for (let i = 1; i < tsList.length; i++) {
  const g = tsList[i] - tsList[i - 1];
  if (g >= 0 && g < 60_000) gaps.push(g);
}
gaps.sort((a, b) => a - b);
function pct(arr: number[], p: number): number { return arr[Math.floor(arr.length * p)]; }

console.log(`Entries with timestamps: ${tsList.length}`);
console.log(`Consecutive gaps measured: ${gaps.length}`);
console.log('');
console.log('Gap percentiles (ms):');
console.log(`  p10  ${pct(gaps, 0.10)}`);
console.log(`  p50  ${pct(gaps, 0.50)}`);
console.log(`  p90  ${pct(gaps, 0.90)}`);
console.log(`  p99  ${pct(gaps, 0.99)}`);
console.log('');
console.log('Distribution of ms-tens digit (should be roughly uniform if sub-second is real):');
const total = msBuckets.reduce((a, b) => a + b, 0);
for (let i = 0; i < 10; i++) {
  console.log(`  ${i}00-${i}99ms: ${msBuckets[i]} (${(msBuckets[i] / total * 100).toFixed(1)}%)`);
}

const subSecondGaps = gaps.filter(g => g > 0 && g < 1000).length;
console.log('');
console.log(`Sub-second non-zero gaps: ${subSecondGaps} / ${gaps.length} (${(subSecondGaps / gaps.length * 100).toFixed(1)}%)`);
console.log(`Zero-ms gaps: ${gaps.filter(g => g === 0).length} (often same-turn entries written together)`);

// Verdict: if sub-second gaps are >10% of all gaps and the ms-tens digit is
// reasonably distributed across 0-9, we can claim millisecond resolution.
const tensDistributed = msBuckets.every(b => b / total > 0.02);
const millisecondReal = subSecondGaps / gaps.length > 0.10 && tensDistributed;
console.log('');
console.log(`Verdict: ${millisecondReal ? 'millisecond resolution IS reliable' : 'use coarser "~0.Ns" labels'}`);
