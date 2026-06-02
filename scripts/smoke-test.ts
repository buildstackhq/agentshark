#!/usr/bin/env node
// Smoke test the data plane end to end without needing a TTY.
// Runs the same code paths the TUI uses but renders results to stdout.
//
// Fails (non-zero exit) if any pipeline stage produces nothing.

import { discoverSessions, loadSessionEntries, summarizeSession } from '../src/adapters/claudeCode.js';
import { extractEvents } from '../src/extract/events.js';
import { computeContextComposition } from '../src/extract/contextComposition.js';
import { compileFilter } from '../src/store/filter.js';
import type { AgentEvent } from '../src/schema/event.js';

let failed = 0;
function ok(label: string): void { console.log(`✓ ${label}`); }
function fail(label: string, why: string): void { console.log(`✗ ${label}: ${why}`); failed++; }

const sessions = await discoverSessions({ limit: 3 });
if (sessions.length === 0) {
  fail('discoverSessions', 'no local Claude Code sessions found');
  process.exit(1);
}
ok(`discoverSessions returned ${sessions.length} session(s)`);

const target = sessions.find(s => s.sizeBytes > 50000) ?? sessions[0];
const entries = await loadSessionEntries(target);
if (entries.length < 5) fail('loadSessionEntries', `only ${entries.length} entries`);
else ok(`loadSessionEntries parsed ${entries.length} JSONL entries`);

const summary = summarizeSession(entries);
if (summary.assistantTurns === 0) fail('summarizeSession', 'no assistant turns counted');
else ok(`summarizeSession: ${summary.assistantTurns} turns · ${(summary.cacheReadPct * 100).toFixed(0)}% cache · model=${summary.lastModel}`);

const events = extractEvents(entries, target);
if (events.length === 0) fail('extractEvents', 'no events emitted');
else ok(`extractEvents emitted ${events.length} events`);

const types = new Set(events.map((e: AgentEvent) => e.type));
ok(`event types observed: ${[...types].sort().join(', ')}`);

const comp = computeContextComposition(events);
if (comp.billedInput === 0) fail('contextComposition', 'no billed_input from last turn');
else ok(`contextComposition: ${comp.billedInput} billed_in across ${comp.rows.length} categories`);

const filter = compileFilter('type:tool_call OR type:mcp');
const matched = events.filter(filter);
ok(`filter 'type:tool_call OR type:mcp' matched ${matched.length} / ${events.length}`);

const subagentFilter = compileFilter('subtype:subagent');
const subagents = events.filter(subagentFilter);
ok(`filter 'subtype:subagent' matched ${subagents.length} sub-agent spawns`);

const tokensFilter = compileFilter('tokens > 1000');
const heavy = events.filter(tokensFilter);
ok(`filter 'tokens > 1000' matched ${heavy.length} heavy events`);

console.log('\n--- top 3 largest context blocks ---');
for (const b of comp.largestBlocks.slice(0, 3)) {
  console.log(`  ${b.tokens.toString().padStart(7)} tok · ${b.type}/${b.subtype ?? ''} · ${b.detail.slice(0, 70)}`);
}

if (failed > 0) { console.log(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nall green');
