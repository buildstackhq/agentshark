// Cross-session parent → children registry (Gap 6 — hybrid sub-agent linkage).
//
// Built once per `discoverAllSessions` call. The Claude Code adapter walks
// `<project>/<parent-session-uuid>/subagents/agent-<agentId>.{jsonl,meta.json}`
// pairs and registers each child here with its parent's session id and the
// parent's `tool_use.id` that spawned it.
//
// Used by:
//   - `TopView` — to mark sub-agent rows with a `↳` glyph and look up the
//     "most recent" child of any parent for the jump-to-child key.
//   - `extractEvents` — could correlate a `type:'subagent'` event in the
//     parent's stream with the actual child session (future enhancement).
//
// All state lives in process memory; the registry resets between processes
// and there's no persistence.

import type { SessionRef } from '../adapters/types.js';

interface ChildLink {
  parentSessionId: string;
  parentToolUseId: string;
  child: SessionRef;
}

class SessionRegistry {
  // Map<parentSessionId, list of child links>
  private byParent = new Map<string, ChildLink[]>();
  // Map<parentSessionId-toolUseId, child link> for direct lookup
  private byToolUseId = new Map<string, ChildLink>();

  clear(): void {
    this.byParent.clear();
    this.byToolUseId.clear();
  }

  recordChild(parentSessionId: string, parentToolUseId: string, child: SessionRef): void {
    const link: ChildLink = { parentSessionId, parentToolUseId, child };
    const list = this.byParent.get(parentSessionId) ?? [];
    list.push(link);
    this.byParent.set(parentSessionId, list);
    if (parentToolUseId) this.byToolUseId.set(`${parentSessionId}|${parentToolUseId}`, link);
  }

  /** All children of a given parent, sorted by most-recent activity first. */
  childrenOf(parentSessionId: string): SessionRef[] {
    const list = this.byParent.get(parentSessionId) ?? [];
    return [...list]
      .sort((a, b) => +b.child.lastActivity - +a.child.lastActivity)
      .map(l => l.child);
  }

  /** Most-recent child of a parent, or undefined if none registered. */
  mostRecentChild(parentSessionId: string): SessionRef | undefined {
    return this.childrenOf(parentSessionId)[0];
  }

  /** Look up a child by the parent's tool_use.id that spawned it. */
  childForToolUse(parentSessionId: string, toolUseId: string): SessionRef | undefined {
    return this.byToolUseId.get(`${parentSessionId}|${toolUseId}`)?.child;
  }

  /** Is the given session id a parent that has registered children? */
  hasChildren(parentSessionId: string): boolean {
    return (this.byParent.get(parentSessionId)?.length ?? 0) > 0;
  }
}

export const sessionRegistry = new SessionRegistry();
