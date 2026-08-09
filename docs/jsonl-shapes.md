# JSONL shape findings — Phase 1 pre-flight

Sampled real Claude Code sessions under `~/.claude/projects/*/`. Findings drive the extractor + fixture work.

## File layout

```
~/.claude/projects/<project-encoded-path>/
  <session-uuid>.jsonl                     # the session log
  <session-uuid>/                          # exists when this session spawned sub-agents
    subagents/
      agent-<agentId>.jsonl                # one child sub-agent log
      agent-<agentId>.meta.json            # linkage metadata
```

The encoded project path is the absolute project dir with `/` → `-` (e.g. `/Users/cshanmugam/ht/buildstack` → `-Users-cshanmugam-ht-buildstack`).

## Top-level entry types

Observed `type:` values at the JSONL line root:

- `user` — user message turn (also used for tool_result content blocks)
- `assistant` — assistant message turn
- `system` — rare; system messages
- `attachment` — meta entries that carry many internal Claude Code event shapes; **does not** mean "file attachment" only
- `permission-mode` — meta only
- `file-history-snapshot` — meta only

## `attachment` subtypes observed in the wild

`attachment.type` field — full list observed across this machine's sessions:

| `attachment.type` | What it carries |
|---|---|
| `auto_mode`, `auto_mode_exit` | Auto mode lifecycle |
| `command_permissions` | Permission grants for tools/commands |
| `compact_file_reference` | Compact file references |
| `date_change` | Date roll-over |
| `deferred_tools_delta` | Deferred tools list updates |
| `diagnostics` | Diagnostics output |
| `dynamic_skill`, `skill_listing` | Skill loading |
| `edited_text_file` | An edited file's content |
| `file` | A loaded file's content (the actual "file attachment") |
| `hook_success`, `hook_error` (inferred) | Hook fires |
| `mcp_instructions_delta` | MCP instructions updates |
| `nested_memory` | Memory injection |
| `plan_file_reference` | Plan file refs |
| `plan_mode`, `plan_mode_exit`, `plan_mode_reentry` | Plan mode lifecycle |
| `queued_command` | Queued commands |
| `task_reminder` | "Task tools haven't been used recently …" reminders |

## Hook entries

Hook events arrive as `type:"attachment"` with `attachment.type:"hook_success"` (or `hook_error`). Sample structure:

```json
{
  "type": "attachment",
  "attachment": {
    "type": "hook_success",
    "hookName": "PreToolUse:Bash",
    "hookEvent": "PreToolUse",
    "toolUseID": "toolu_01DfzMNnzVeMENwVmEGdh94F",
    "content": "",
    "stdout": "{...}",
    "stderr": "",
    "exitCode": 0,
    "command": "/Users/cshanmugam/.claude/hooks/rtk-rewrite.sh",
    "durationMs": 222
  },
  "uuid": "...", "timestamp": "...", "sessionId": "..."
}
```

**`hookEvent` values observed (CamelCase, not snake_case):**
- `PreToolUse`
- `PostToolUse`
- `Stop`
- (`UserPromptSubmit` not observed in this user's data — exists per design.md; treat as possible.)

## File attachment shape

A real "file attachment" (Claude Code reading a memory/CLAUDE.md or similar file):

```json
{
  "type": "attachment",
  "attachment": {
    "type": "file",
    "filename": "<absolute-path>",
    "content": {
      "type": "text",
      "file": {
        "filePath": "<absolute-path>",
        "content": "<full file content>"
      }
    }
  }
}
```

## Sub-agent spawn linkage

Parent JSONL contains an `Agent` `tool_use` (tool name is **`Agent`**, not `Task` — `Task` did not appear in 534 `Agent` uses across all projects):

```json
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "id": "toolu_013kwL5SabjA1wD742KSL9ZR",
      "name": "Agent",
      "input": {
        "description": "...",
        "subagent_type": "Explore",
        "prompt": "..."
      }
    }]
  }
}
```

Meta file `<parent-session>/subagents/agent-<agentId>.meta.json`:

```json
{
  "agentType": "Explore",
  "description": "...",
  "toolUseId": "toolu_013kwL5SabjA1wD742KSL9ZR"
}
```

Child JSONL `<parent-session>/subagents/agent-<agentId>.jsonl` first message:

```json
{
  "parentUuid": null,
  "isSidechain": true,
  "agentId": "a0d52cb541a4960f5",
  "sessionId": "<parent-session-uuid>",
  "type": "user",
  "message": { "role": "user", "content": "..." }
}
```

**Linkage chain (Pre-flight §3 GO):** parent's `tool_use.id` ⇄ meta's `toolUseId` ⇄ meta filename's `agentId` ⇄ child JSONL filename's `agentId` ⇄ child's `agentId` field. Children also carry the parent's `sessionId` and `isSidechain: true`.

This is sufficient for Gap 6 (hybrid jump-to-child).

## Audit corrections — already-implemented surfaces

Walking the actual code revealed the prior gap audit (in `REVIEW.md`) was overstated for two items:

### Gap 2 — Hook events ARE already extracted

`src/extract/events.ts:330-362` does extract hook events from `attachment.type:"hook_success"|"hook_error"`. It emits `type:'hook'` with `tags.hook_event` populated, `tags.hook_name`, exit code in payload.

**Remaining issue is smaller:** the emitted `subtype` is `"pretooluse"` (lowercased CamelCase) but the docs / filter examples (`docs/guide.md:100`) use `pre_tool`, `post_tool`, `user_prompt_submit`, `stop` (snake_case). The filter `hook:pre_tool` will not match `hook_event: "PreToolUse"`.

Fix is small: either (a) normalize subtype + `tags.hook_event` to snake_case during extraction, or (b) update the docs to use the actual CamelCase form. Option (a) preserves doc accuracy and keeps the user-facing grammar consistent.

### Gap 4 — `attachment` event type already emitted

`src/schema/event.ts:12` lists `attachment` in `EventType`. `src/extract/events.ts:413-428` emits `type:'attachment'` for any `attachment.type` not specifically routed (file, file_history, deferred_tools_delta, etc. fall through here).

**Remaining issue:** the README event-types table describes `attachment` as "File or binary attachment" — that's misleading because in practice it's a fallback for unmatched internal `attachment.type` variants (some of which *are* file content, but many are not). Either rewrite the README description to match what users actually see, or add a `subtype` matrix in the docs.

### What's actually unimplemented (refined gap list)

- **Gap 1** — redaction confirmation flow: confirmed missing. `src/export/pack.ts:36-65` writes silently.
- **Gap 2 (narrowed)** — hook subtype naming mismatch between code (`"pretooluse"`) and docs (`"pre_tool"`). ~1 hour, not 0.5-1 day.
- **Gap 3** — per-event `cacheState`: confirmed missing. `src/ui/EventList.tsx:68-72` `cacheBadge` only returns H/W for the dedicated cache events synthesized from `api_turn` usage deltas; other events (tool_call, message, mcp) always get a blank badge.
- **Gap 4 (narrowed)** — README event-types table is misleading about `attachment`. ~30 min docs update.
- **Gap 5** — stub adapters: confirmed.
- **Gap 6** — sub-agent linkage: confirmed missing. `type:'subagent'` events ARE created when parent uses Agent tool (events.ts:293 + classifyToolCall on line 23), but `parentSpanId` never set on child sessions and no cross-session registry exists. TopView is flat. No jump-to-child key.

### Revised effort

- Gap 1: ~0.5 day (unchanged)
- Gap 2: ~1 hour (was 0.5–1 day) — saves ~4–7 hours
- Gap 3: ~0.5 day (unchanged)
- Gap 4: ~30 min (was 0.5 day) — saves ~3–4 hours
- Gap 5: ~0.5 day (unchanged)
- Gap 6: ~3–5 days (unchanged) — but linkage path now known (Agent tool_use → meta.json `toolUseId` → agentId → subagents/agent-<id>.jsonl)

**Original estimate:** ~6–8 days implementation + 0.5 day pre-flight.
**Revised:** ~5–7 days implementation + 0.5 day pre-flight.

## Fixture sources reserved

Selected from this machine for Phase 1a scrubber input:

| Fixture | Source |
|---|---|
| `claude-code/short-session.jsonl` | TBD — pick a small ≤3-turn session |
| `claude-code/with-hooks.jsonl` | `/Users/cshanmugam/.claude/projects/-Users-cshanmugam-ht-buildstack-agentshark/081c3165-9180-439b-9e22-d1d12102e277.jsonl` (PreToolUse / PostToolUse / Stop) |
| `claude-code/with-attachment.jsonl` | TBD — a session with `attachment.type:"file"` from the prd project |
| `claude-code/long-session.jsonl` | TBD — pick one with high cache hit rate |
| `claude-code/parent-with-subagent.jsonl` + `subagent-child.jsonl` | `/Users/cshanmugam/.claude/projects/-Users-cshanmugam-ht-buildstack/1e2e2e5c-80a6-450a-a9aa-835ceb91bea2.jsonl` + matching `subagents/agent-a0d52cb541a4960f5.jsonl` + `agent-a0d52cb541a4960f5.meta.json` |
| `claude-code/session-with-secrets.jsonl` | Built from short-session.jsonl + synthetic secrets re-injected after scrub |
| `codex/short-session.jsonl` | TBD — pick from `~/.codex/sessions/` |
