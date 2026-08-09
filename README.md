```
                             ,-
                          ,-' /
                       ,-'   /
                    ,-'     /
                 _,'       /
              ,-'/        /
            ,'  /        /
           /   /        /
          /   /        /
         /   /_______ /
        (____________)
              \\
               \\
                \\
                 \\
                  >== AGENT.SHARK ==>
```

**Wire shark + `top` for AI agents.** Deep, event-level introspection of what an agent is actually doing — (Claude Code, Claude Cowork, Codex)

`top` is the entry point: an `htop`-style live list of every agent session running on your machine — including sub-agent sessions with a one-key jump from any parent row into the agents it spawned.


`inspect` is the headline: a three-pane TUI that shows every tool call, MCP roundtrip, hook fire, sub-agent spawn, and cache event in a single session, with per-event input-token attribution.

---

## What it looks like

**`top` — live session list (parents with sub-agents show a `+N` badge; press `s` to expand the children inline):**

```
 agentshark · top                                                    top · 18 sessions
 acme/payments  claude-opus-4-7  turns: 53    cache: 97%
╰──────────────────────────────────────────────────────────────────────────────────────╯
    AGENT              MODEL          PROJECT            TURNS  BILLED_IN   CACHE%  AGE
    claude-code        sonnet-4-6     acme/payments          3     51.8K    74%   22s
▶   claude-code +2     opus-4-7       acme/payments         53      3.4M    97%    3m
  ↳ └─ claude-code     haiku-4-5-202… acme/payments ↳ Explore   22    488.7K    91%    8m
  ↳ └─ claude-code     haiku-4-5-202… acme/payments ↳ Explore   14    302.1K    88%   11m
    claude-code +3     opus-4-7       infra/deploy         169     26.4M    99%    6m
  ↳ └─ claude-code     opus-4-7       infra/deploy  ↳ Plan        8    241.3K    83%   14m
  ↳ └─ claude-code     haiku-4-5-202… infra/deploy  ↳ Explore    19    512.6K    90%   58m
  ↳ └─ claude-code     haiku-4-5-202… infra/deploy  ↳ Explore    11    248.4K    87%    1h
    claude-code +1     sonnet-4-6     frontend/dashboard    31      1.1M    95%   14m
  ↳ └─ claude-code     haiku-4-5-202… frontend/dashboard ↳ Explore  17   394.2K    89%   31m
    cursor             sonnet-4-6     frontend/dashboard     4      8.2K    41%    2h

  q quit  ↑↓ navigate  ⏎ inspect  s show sub-agents  e export  h help
```

**`inspect` — event-level introspection:**

```
┌─ agentshark inspect · agentshark · claude-sonnet-4-6 · 14 turns ────────────────── [live] 87% cache ─┐
│  13:04:21  [message   ]  user: update the readme …                      in: 24,103          [WRITE]   │
│  13:04:21  [api_turn  ]  → claude-sonnet-4-6  in: 24,103  out: 0                                      │
│  13:04:44  [tool_call ]  Read · /README.md                              in: 24,103                     │
│  13:04:44  [tool_result]  2,841 bytes                                   in: 24,103                     │
│  13:04:51  [hook      ]  post_tool                                      in: 24,103                     │
│  13:04:53  [message   ]  assistant: Here's the plan …                  in: 25,410  out: 612   [HIT]   │
│  13:05:01  [mcp       ]  filesystem · write_file                        in: 25,410            [HIT]   │
│▶ 13:05:01  [tool_result]  written                                       in: 25,410                     │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  tool_result @ 13:05:01  span:a3f1  parent:b2e9                                                        │
│  { "type": "tool_result", "content": "written", "is_error": false }                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Privacy posture (read this first)

agentshark is built for a security-conscious developer audience. The rules:

1. **Local mode never sends data anywhere.** Live tail and replay run entirely on your machine, against log files the agents already wrote.
2. **Export is explicit.** `agentshark export` (and `e` in the top view) runs the secret scan, shows you the redaction diff, and requires your `y` confirmation before any file is written. Use `--yes` to skip the prompt in scripts.

If anything in this list looks wrong on inspection, file an issue — these are non-negotiable invariants, not aspirations.

---

## Status

Pre-alpha. TUI MVP runs against local agent sessions like Claude Code, Cowork, Codex sessions.

### Tested status by agent

| Agent | OS | Status |
|-------|----|--------|
| Claude Code | macOS | ✅ |
| Claude Cowork | macOS | ✅ |
| Codex | macOS | ✅ |
| Cursor | macOS / Linux / Windows | ⚠️ discovery only — token / cache data not yet supported |
| Gemini CLI | macOS | ⚠️ discovery only — token / cache data not yet supported |
| Copilot CLI | macOS | ⚠️ discovery only — token / cache data not yet supported |

---

## Installation

**From source (current):**

Clone the repository, then install dependencies:

```sh
cd agentshark
npm install
```

To run it against your local checkout, use the `dev` script — `npx agentshark` fetches the published package from the npm registry, not your local changes:

```sh
npm run dev
# pass CLI args after `--`, e.g.:
npm run dev -- inspect --replay debug.aspark
```

**Once published to npm:**

```sh
npm install -g agentshark
# or run without installing:
npx agentshark
```

---

## Quick start

```sh
# Headless smoke test — validates the data pipeline without a TTY
npm test

# Session list (top view)
npm run dev -- top

# Event inspector — most recent session
npm run dev -- inspect

# Print events as JSONL to stdout (no TUI, useful for piping to jq)
npm run dev -- inspect --print
npm run dev -- inspect --print | jq 'select(.type=="mcp")'

# Show which adapters are detected on this machine
npm run dev -- adapters
```

After `npm install -g agentshark`, replace `npm run dev --` with `agentshark`.

---

## `agentshark top` — session list

An htop-style live list of agent sessions on your machine.

**Columns:**

| Column | Description |
|--------|-------------|
| `AGENT` | Adapter name: `claude-code`, `claude-cowork`, `codex`, `cursor`*, `gemini-cli`*, `copilot-cli`* — entries marked `*` are discovery-only and render `—` for TURNS / BILLED_IN / CACHE%. A `+N` suffix means "this session spawned N sub-agents — press `s` to reveal them as `└─` rows directly beneath". |
| `MODEL` | Last model observed (e.g. `claude-sonnet-4-6`) |
| `PROJECT` | Project name inferred from the session path |
| `TURNS` | Number of completed assistant turns |
| `BILLED_IN` | Total billed input tokens (formatted, e.g. `686.1K`) |
| `CACHE%` | Percentage of input tokens served from cache |
| `AGE` | Time since last activity (e.g. `2m`, `1h`) |

**Keys:**

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate sessions |
| `Enter` | Open selected session in `inspect` view |
| `s` | Show / hide sub-agent rows in this list (default: hidden — only parent rows shown) |
| `e` | Export selected session — opens a redaction-diff confirmation; `y` writes, `n` / `Esc` aborts |
| `r` | Pause / resume auto-refresh |
| `h` | Toggle help |
| `q` / `Ctrl+C` | Quit |

---

## `agentshark inspect` — event inspector

A three-pane TUI: header bar, event list, and detail inspector.

### Header bar

| Field | Description |
|-------|-------------|
| `agentshark inspect` | Mode label |
| `[live]` / `[paused]` | Live-tailing new events vs. frozen replay |
| Project name | Inferred from the session path |
| Model | Last model seen in this session |
| `N turns` | Number of completed assistant turns |
| `~N tok avg` | Average billed input tokens per API turn |
| `last: N tok` | Input tokens on the most recent turn |
| `N% cache` | Cache hit rate — % of input tokens served from cache (green = healthy) |

> For a guide on how to read these metrics together to diagnose context bloat and cache health, see [Understanding context metrics](docs/guide.md#understanding-context-metrics) in the CLI reference.

### Event list columns

| Column | Description |
|--------|-------------|
| Timestamp | Wall-clock time of the event |
| Type badge | Color-coded event type (see table below) |
| Description | Tool name, MCP server/tool, hook type, or message preview |
| `in: N` | Input tokens attributed to this event |
| `out: N` | Output tokens (assistant messages only) |
| Cache state | `[HIT]` cache read · `[WRITE]` cache write · blank = non-cached |

### Event types

| Type | Description |
|------|-------------|
| `message` | User, assistant, or system message turn |
| `tool_call` | Agent calls a local tool (Read, Write, Bash, etc.) |
| `tool_result` | Tool execution result returned to the model |
| `mcp` | MCP server request, response, or error |
| `hook` | Hook fired: `pre_tool`, `post_tool`, `user_prompt_submit`, `stop` |
| `skill` | Skill invocation |
| `system_reminder` | System reminder block injected into context |
| `subagent` | Sub-agent spawned or completed |
| `api_turn` | Full API turn boundary with aggregate token totals |
| `cache` | Cache checkpoint written or read |
| `attachment` | Catch-all for Claude Code internal `attachment.type` records that don't map to a more specific event type above (e.g. `file`, `diagnostics`, `deferred_tools_delta`). Subtype = the original `attachment.type` |

### Inspector pane

Shows the full payload of the selected event: raw arguments, response body, timing, span IDs, and cache state.

### Context Composition view (`c`)

Breaks down the current input token budget by category:
- System prompt, tool definitions, skills, conversation history, current user turn, system reminders
- Shows the largest individual blocks consuming context

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Context Composition · claude-sonnet-4-6                                         │
│ Current input · 98,432 / 200,000 tokens · 49% of window                        │
│ █████████████████████                                                           │
│                                                                                 │
│   System prompt + tool defs + memory    42,118 ████████░░░░░░░░░░░░░  43%      │
│   User messages                         21,504 ████░░░░░░░░░░░░░░░░░  22%      │
│   Tool results (misc)                   14,291 ███░░░░░░░░░░░░░░░░░░  15%      │
│   File writes                            8,847 ██░░░░░░░░░░░░░░░░░░░   9%      │
│   Tool calls (misc)                      5,612 █░░░░░░░░░░░░░░░░░░░░   6%      │
│   Assistant messages                     3,104 ░░░░░░░░░░░░░░░░░░░░░   3%      │
│   Sub-agent spawns                       1,842 ░░░░░░░░░░░░░░░░░░░░░   2%      │
│   Bash outputs                             714 ░░░░░░░░░░░░░░░░░░░░░   1%      │
│                                                                                 │
│ Largest single blocks                                                           │
│   ▸ 1 import { Box, Text, useApp, useInput } from 'ink'; 2 imp…    3,812 tok   │
│   ▸ 1 # cli.md — commands and UI flows 2 3 Audience…               2,947 tok   │
│   ▸ Write {"file_path":"/Users/cshanmugam/.claude…                 2,103 tok   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Keys

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate event list |
| `PgUp` / `PgDn` | Page through event list |
| `g` / `G` | Jump to first / last event |
| `/` | Open filter bar |
| `Esc` | Close filter bar |
| `i` | Toggle inspector pane |
| `c` | Toggle Context Composition view |
| `s` | Cycle sort order: step ↑ / step ↓ / tok ↓ / tok ↑ |
| `>` | Drill into a sub-agent of the current session (press again to cycle through siblings) |
| `<` | Pop back to the parent session |
| `t` | Toggle live tail (pause / resume polling) |
| `h` | Toggle help |
| `q` | Back / quit |

---

## Filter language

The filter bar (`/`) accepts a Wire shark-style expression language.

```
# By event type
type:tool_call
type:mcp OR type:hook

# By adapter
source:claude-code

# By MCP server name
mcp:gmail
mcp:filesystem

# By hook type
hook:pre_tool
hook:stop

# By token count
tokens > 1000
tokens < 500

# Regex across all text fields (quoted string)
"anthropic"
"pattern"

# Compound expressions
type:mcp AND tokens > 500
(type:tool_call OR type:mcp) AND NOT source:cursor
```

Supported keys: `type:`, `subtype:`, `source:`, `mcp:`, `hook:`, `trace:`, `model:`, `category:`, `cache:`, `tokens > N`, `tokens < N`, and quoted regex.
`cache:` matches per-event cache state — `cache:hit`, `cache:write`, or `cache:none`.
Boolean operators: `AND`, `OR`, `NOT`. Parentheses for grouping.

---

## Export and replay

Export a session to a self-contained `.aspark` file — a versioned JSON archive containing the full event stream: every tool call, tool result, MCP roundtrip, context composition snapshot, and per-event token counts. When the session spawned sub-agents, **their event streams are bundled in the same file** so the whole family travels together. One redaction-diff confirmation covers the parent and every child. Secrets (API keys, JWTs, bearer tokens) are automatically redacted before the file is written.

```sh
# Export most recent session — bundles parent + every descendant sub-agent
agentshark export                       # prompts y/N after showing redaction diff
agentshark export --output trace.aspark
agentshark export --yes                 # skip the prompt (CI / scripting)

# Replay an exported file offline
agentshark inspect --replay trace.aspark
# Inside replay: `>` drills into the most-recent sub-agent, `<` pops back to the parent.
```

**When to share a `.aspark` with a teammate:**
- Debugging unexpected tool call sequences together
- Walking through context bloat or cache miss patterns with the team
- Filing a bug report with an MCP server author — attach the file directly

The `.aspark` format is versioned. The current format is **v2** — adds a `children` array bundling sub-agent sessions and preserves the per-turn `turnUsage` field so the Context Composition view replays accurately. v1 files (single-session, no `children`) still load. The v2 reference schema is [`schema/aspark.v2.json`](schema/aspark.v2.json), mirrored from [`src/export/pack.ts`](src/export/pack.ts); the legacy v1 schema is kept at [`schema/aspark.v1.json`](schema/aspark.v1.json) for reference. Both are validated against real export output in `tests/schema/aspark-schema.test.ts`.

---

## Documentation

- [**Changelog**](CHANGELOG.md) — what changed in each release
- [**CLI reference**](docs/guide.md) — all commands, flags, key bindings, and common flows
- [**Concepts**](docs/concepts.md) — what agents, sessions, and events are
- [**Design**](docs/design.md) — how agentshark works under the hood

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](SECURITY.md)

## License

Apache-2.0 — see [LICENSE](LICENSE).
