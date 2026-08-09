# design.md — agentshark technical architecture

Audience: same as `concepts.md` — software/cloud engineer. This doc assumes you've read `concepts.md`.

This is the design of the system. Every claim here should be defendable in code; anything aspirational is flagged as such.

---

## 1. Goal in one sentence

**Inspect any local agent session — single-agent or multi-agent — at the level of every tool call, MCP roundtrip, hook fire, sub-agent spawn, and cache event, with per-event input-token attribution.**

`agentshark inspect` is the headline (Wire shark muscle memory). `agentshark top` is the entry point that surfaces sessions to inspect (htop muscle memory).

---

## 2. Deployment surface

| Surface | What runs where | Who it's for |
|---------|-----------------|--------------|
| **Local** | `npx agentshark` reads files at `~/.claude/projects/`, `~/.codex/sessions/`, etc. No daemon, no service. | Vibe coder running CLI agents locally |

---

## 3. Top-level dataflow

```
LOCAL FILES
~/.claude/projects/...
~/.codex/sessions/...
~/Library/.../Cursor/
~/.gemini/sessions/
~/.config/github-copilot/
        │
        ▼
   local adapters
   (tail JSONL, parse SQLite)
        │
        ▼
         ┌─────────────────────┐
         │ normalised event    │  same shape regardless of source
         │ extractor           │
         └─────────┬───────────┘
                   ▼
         ┌─────────────────────┐
         │ cache-aware         │  see § attribution algorithm
         │ token attributor    │
         └─────────┬───────────┘
                   ▼
         ┌────────────────┐  ┌──────────────────┐
         │ live store     │  │ replay store     │
         │ ring (10K)     │  │ unbounded        │
         └────────┬───────┘  └─────────┬────────┘
                  └────────┬───────────┘
                           ▼
                  ┌────────────────────────────┐
                  │ TUI (ink)                  │
                  │ ┌──────────┐ ┌───────────┐ │
                  │ │ top      │ │ inspect   │ │
                  │ │ tree     │ │ events ·  │ │
                  │ │ summary  │ │ inspector │ │
                  │ │          │ │ context   │ │
                  │ └──────────┘ └───────────┘ │
                  └─────────┬──────────────────┘
                            ▼
                  `agentshark export` →
                  `.aspark` file
                            ▼
                  `agentshark inspect --replay <file>`
```

---

## 4. The normalised event

Every captured event — local file line — is mapped into this shape before anything downstream sees it:

```ts
type Event = {
  ts: string;                   // ISO 8601 with milliseconds where available
  traceId: string;              // multi-agent run; OTLP trace_id
  spanId: string;               // this event's span
  parentSpanId?: string;        // for child spans (sub-agents, nested tool calls)
  sessionLabel: string;         // user-friendly label, e.g. "claude-code · ht/prd"
  source: 'claude-code'         // which adapter produced this
        | 'claude-cowork'
        | 'codex' | 'cursor'
        | 'gemini-cli' | 'copilot-cli';
  agent?: string;               // e.g. "langgraph/writer" — set by SDK
  model?: string;               // e.g. "claude-sonnet-4-6"
  type: EventType;              // see § event taxonomy
  subtype?: string;
  tokensIn?: number;            // cache-aware input attribution (input only)
  cacheState?: 'hit' | 'write' | 'none';  // for the bucket this event was in
  durationApproxMs?: number;    // local sources: approximate; SDK sources: real
  payload?: object;             // redacted; full request/response
  tags?: Record<string, string>; // mcp_server, hook_name, file_path, host, env, ...
};
```

Adapters produce these. The store keeps these. The UI renders these. Nothing else.

---

## 5. Event taxonomy

| `type` | Subtypes | How it's detected (Claude Code) |
|--------|----------|----------------------------------|
| `message` | `user`, `assistant`, `system` | JSONL `type: "user"` / `"assistant"` |
| `tool_call` | tool name (`read`, `edit`, `bash`, ...) | Assistant message `tool_use` content block |
| `tool_result` | `success`, `error` | User message `tool_result` content block |
| `mcp` | `request`, `response`, `error` | Tool name matches `mcp__<server>__<tool>` |
| `hook` | `pre_tool`, `post_tool`, `user_prompt_submit`, `stop` (normalized from CamelCase `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop`) | Top-level `type:"attachment"` lines with `attachment.type` in `hook_success` / `hook_error` |
| `skill` | `loaded`, `dynamic`, `listing` | User message `<command-name>` blocks; `attachment.type` in `skill_listing` / `dynamic_skill` |
| `system_reminder` | `injected`, `task_reminder`, `nested_memory` | `<system-reminder>` content blocks; `attachment.type` in `task_reminder` / `nested_memory` |
| `subagent` | `subagent` | `tool_use` with name `Agent` (parent's spawn record) |
| `api_turn` | `start` | Each unique `requestId` on an assistant message |
| `cache` | `write`, `hit` | Deltas in `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` between turns |
| `attachment` | the original `attachment.type` (e.g. `file`, `diagnostics`, `deferred_tools_delta`, …) | Fallback: any top-level `type:"attachment"` line whose `attachment.type` isn't routed to one of the more specific event types above. **Not** just file attachments — covers the whole catalog of Claude Code internal attachment events |

Every extractor is required to **degrade gracefully**: if the format it's looking for has shifted (e.g. Anthropic renames `hookEvent` to `hook_event`), the event still surfaces as its parent type (`message`, `tool_call`) and never crashes the stream. That's enforced via try/catch around the subtype-specific code paths.

---

## 6. Cache-aware token attribution algorithm

This is the trickiest piece. See `concepts.md` § 9 for why prompt caching makes naive tokenisation wrong.

### Inputs
- The conversation history (every user + assistant message before this turn).
- The `usage` object from this turn:
  ```
  usage.input_tokens                  // non-cached input
  usage.cache_creation_input_tokens   // new cache entries
  usage.cache_read_input_tokens       // cache hits
  usage.output_tokens                 // assistant response (not block-attributable)
  ```
- The model name (selects which tokenizer to use).

### Algorithm
1. **Tokenise** every content block in the conversation history with the right tokenizer (`@anthropic-ai/tokenizer` for Claude, `tiktoken` for OpenAI). Record `block.tokens` per block.

2. **Compute** `total_visible = Σ block.tokens` and `billed_input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.

3. **System overhead** `= billed_input - total_visible`. This is the lump representing system prompt + tool definitions + memory + system reminders we can't fully see in local transcripts.

4. **Cache partition tags.** Walk content blocks and tag each by likely cache state. Claude Code's caching convention is roughly: system prompt + tool defs at the front are cached; the latest user message is non-cached; assistant messages in between are cache_read or cache_create depending on whether they were already in cache. Day-1 prototype validation shows the SDK can be made authoritative here; local adapters have to infer.

5. **Per-block attribution** = `block.tokens` (the raw tokenizer output). For aggregate displays, scale within each cache partition so the sum matches the corresponding `usage` field exactly — guarantees reconciliation.

6. The TUI shows `tokensIn` per event with a cache-state badge:
   - `H` (green) cache hit
   - `W` (yellow) cache write
   - blank — non-cached

### Validation (day-1 result)
Across three real Claude Code sessions (cache states 56-100%): per-turn predicted billed-input matches the API's reported billed-input within <10% on ~95% of turns. The 1-3 failing turns concentrate at session start before injected system reminders accumulate. Detail in `scripts/attribution-prototype.ts`. The "system overhead" is the catch-all category that absorbs whatever the visible tokeniser can't account for.

### What we explicitly don't claim
- **Output token attribution.** Output streams as a single assistant turn; we cannot per-block-attribute it. We show the per-turn total only.
- **Sub-second tokenizer accuracy on extremely long sessions.** The Claude tokenizer (`@anthropic-ai/tokenizer@0.0.4`) is point-in-time; if Anthropic ships a new model with a different vocabulary, our estimates drift. The reconciliation step bounds the impact: aggregate input always matches the API, only per-block ratios shift.

---

## 7. Local adapters

A `LocalAdapter` is a Node module that exports:

```ts
interface LocalAdapter {
  name: string;                                         // 'claude-code'
  detect(): Promise<boolean>;                            // is this agent installed?
  discoverSessions(opts?): Promise<SessionRef[]>;        // active and recent
  tail(session: SessionRef): AsyncIterable<RawEntry>;    // stream new lines
  parseTurn(raw: RawEntry, ctx: AdapterContext): Event[]; // turn → events
  capabilities: Set<EventType>;                          // what this adapter can surface
}
```

| Adapter | Source files | Notes |
|---------|--------------|-------|
| `claude-code` | `~/.claude/projects/<project-dir>/<session-uuid>.jsonl` | Primary, richest. Hooks, MCP, skills, sub-agents all detectable. |
| `claude-cowork` | `~/Library/Application Support/Claude/local-agent-mode-sessions/` | Sandboxed Claude sessions. **macOS only.** |
| `codex` | `~/.codex/sessions/<year>/<file>.jsonl` + `~/.codex/logs_2.sqlite` | JSONL is canonical; SQLite enriches model info (optional — requires `sqlite3` CLI on PATH; degrades gracefully if absent). |
| `cursor` | macOS: `~/Library/Application Support/Cursor/logs/` · Windows: `%APPDATA%/Cursor/logs/` · Linux: `~/.config/Cursor/logs/` | Sparse token data; surface what's there, mark gaps. |
| `gemini-cli` | `~/.gemini/sessions/` | Gemini SDK usage object. |
| `copilot-cli` | `~/.config/github-copilot/` | `usage` from response logs. |

Adapter discovery runs at startup. `agentshark adapters` prints which adapters detected agents on the local machine.

**File watching** uses `chokidar`. Each tail keeps a per-file byte offset; on a write event, it reads from `offset` to EOF, splits by newline, and yields complete JSON lines. Partial lines are buffered until the next tick.

---

## 8. Privacy and redaction

Trust posture stated front-page in the README and enforced by code, not policy:

1. **Local default.** Local mode never sends data anywhere.
2. **`agentshark export`** runs the redactor, shows the user a diff of what got redacted, and only writes the `.aspark` file after confirmation.

---

## 9. `.aspark` v1 export schema

Versioned JSON schema, lives at `schema/aspark.v1.json` in the repo (locked before TUI inspector code so the format never has to change retroactively).

Top-level shape:

```json
{
  "asparkVersion": 1,
  "exportedAt": "2026-05-28T18:42:11.512Z",
  "exportedBy": "agentshark@0.x.y",
  "redaction": {
    "policy": "default",
    "patterns": ["aws_access_key_id", "anthropic_api_key", "..."],
    "matchCount": 12
  },
  "session": {
    "label": "claude-code · ht/prd",
    "agent": "claude-code",
    "model": "claude-sonnet-4-6",
    "host": "local",
    "startedAt": "...",
    "endedAt": "..."
  },
  "events": [ Event, Event, ... ]
}
```

Schema constraints:
- `events` always in chronological order.
- Each `Event` carries `traceId` + `spanId` + (optional) `parentSpanId` so multi-agent topology is preserved.
- Payloads in `events[*].payload` already redacted; unredacted content is never written.

Used by:
- `agentshark inspect --replay <file>` — local replay.
- Bug reports — attach to an issue.

---

## 10. Token attribution code path (concrete)

```
JSONL line read
    │
    ▼
adapter parses → RawEntry
    │
    ▼
extract/events.js
    ├── extract messages
    ├── extract tool_use / tool_result content blocks
    ├── tag mcp / hook / skill / subagent
    └── flag system_reminder spans
    │
    ▼
attribute/cachePartition.js
    ├── read usage object
    ├── partition into hit / write / non-cached buckets
    └── tag each content block by likely cache state
    │
    ▼
attribute/blockTokens/anthropic.js (or /openai or /gemini)
    └── countTokens(block.text)
    │
    ▼
attribute/reconcile.js
    ├── compute total_visible
    ├── system_overhead = billed_input - total_visible
    └── (optional) scale block.tokens so partition sums match exactly
    │
    ▼
emit Event { tokensIn, cacheState, ... }
```

The current MVP keeps step 4 simple — pass through the raw tokenizer count — and surfaces `system_overhead` as its own bucket. Step 4 will gain sophistication (e.g. proportional scaling) once the SDK adapters can self-report cache markers authoritatively.

---

## 11. Storage and memory profile

| Mode | Where events live | Cap |
|------|-------------------|-----|
| Local live | Process memory ring buffer | last 10K events per session |
| Local replay | Process memory unbounded | whole session (typical: <100K events) |
| `.aspark` file | Disk | bounded by your fs |

Memory: a typical event is ~1KB in normalised form, so 10K events = ~10MB. Long sessions or many parallel sessions stay well under typical terminal-tool footprints.

---

## 12. What the TUI MVP covers vs the full design

The TUI's first commit (`packages/tui` v0) covers:

- `agentshark top` against local Claude Code sessions only.
- `agentshark inspect [--replay=FILE]` against a local JSONL or exported trace.
- Three-pane inspect view: event list, inspector, filter bar.
- Context Composition view (`c`).
- Live tail + replay (`--replay <file>`).
- Filter expression v1: `type:X`, `source:X`, regex on payload.

What's NOT in the first commit (tracked as follow-ups):
- `agentshark share` (hosted sharing).
- Multi-agent tree rendering in `top` (sub-agent local sessions render but full topology tree is not yet implemented).

All local adapters (Codex, Cursor, Gemini CLI, Copilot CLI, Claude Cowork) are now implemented and exported.

---

## 13. Tech choices and why

| Choice | Why |
|--------|-----|
| Node.js for TUI | Lowest install friction — `npx agentshark` works without a separate runtime install. ink gives React-style components. |
| In-memory ring buffer | Zero-config; events live in process memory (last 10K per session for live, unbounded for replay). |
| ink for TUI | React component model is familiar; well-maintained; ergonomic for the three-pane layout. |

---

Next: read `docs/guide.md` for what every command actually does in user-visible terms.
