#!/usr/bin/env node
// One-shot check: walk ~/.claude/projects and report how many parent sessions
// have sub-agents wired up correctly via the registry. Used during Gap 6
// development to verify discoverSubagents picks up the real meta.json layout.

import { discoverSessions } from '../src/adapters/claudeCode.js';
import { sessionRegistry } from '../src/store/sessionRegistry.js';

const sessions = await discoverSessions({ limit: 300 });
const parents = sessions.filter(s => !s.parentSessionId);
const children = sessions.filter(s => s.parentSessionId);
console.log(`total sessions: ${sessions.length} (parents: ${parents.length}, sub-agents: ${children.length})`);

const parentsWithKids = parents.filter(p => sessionRegistry.hasChildren(p.id));
console.log(`parents with at least one sub-agent: ${parentsWithKids.length}`);

for (const p of parentsWithKids.slice(0, 5)) {
  const kids = sessionRegistry.childrenOf(p.id);
  console.log(`  parent ${p.id.slice(0, 12)}… → ${kids.length} child(ren)`);
  for (const k of kids.slice(0, 2)) {
    console.log(`    ↳ ${k.agentType ?? '?'} (toolUseId ${k.parentToolUseId?.slice(0, 16) ?? 'none'}…)`);
  }
}
