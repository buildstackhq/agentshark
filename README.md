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

> Built by [Buildstack](https://buildstack.dev/) · **Wire shark + `top` for AI agents.** Deep, event-level introspection of what an agent is actually doing — (Claude Code, Claude Cowork, Codex)

`top` is the entry point: an `htop`-style live list of every agent session running on your machine — including multi-agent topologies as a tree.


`inspect` is the headline: a three-pane TUI that shows every tool call, MCP roundtrip, hook fire, sub-agent spawn, and cache event in a single session, with per-event input-token attribution.

---

## What it looks like

**`top` — live session list:**

```
┌─ agentshark top ──────────────────────────────────────────────────── [live] ─┐
│  AGENT         MODEL           PROJECT           TURNS  BILLED_IN  CACHE%  AGE │
│────────────────────────────────────────────────────────────────────────────────│
│▶ claude-code   sonnet-4-6      acme/payments         135    686.1K     99%   2m │
│  claude-code   opus-4-7        infra/deploy           19     29.5K    93%   5m │
│  cursor        sonnet-4-6      frontend/dashboard      4      8.2K    41%  12m │
│                                                                                 │
│  q quit  ↑↓ navigate  ⏎ inspect  e export  r pause  h help                    │
└─────────────────────────────────────────────────────────────────────────────────┘
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
2. **Export is explicit.** `agentshark export` produces a `.aspark` file after running the secret scan and showing you the redaction diff for confirmation. Nothing is written until you say yes.

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

---

## Installation

**From source (current):**

Clone the repository, then install dependencies:

```sh
cd agentshark
npm install
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
| `AGENT` | Adapter name: `claude-code`, `codex`, `cursor`, `gemini-cli`, `copilot-cli` |
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
| `e` | Export selected session to `.aspark` file |
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

### Inspector pane

Shows the full payload of the selected event: raw arguments, response body, timing, span IDs, and cache state.

### Context Composition view (`c`)

Breaks down the current input token budget by category:
- System prompt, tool definitions, skills, conversation history, current user turn, system reminders
- Shows the largest individual blocks consuming context

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

Supported keys: `type:`, `subtype:`, `source:`, `mcp:`, `hook:`, `trace:`, `model:`, `category:`, `tokens > N`, `tokens < N`, and quoted regex.
Boolean operators: `AND`, `OR`, `NOT`. Parentheses for grouping.

---

## Export and replay

Export a session to a self-contained `.aspark` file — a versioned JSON archive containing the full event stream: every tool call, tool result, MCP roundtrip, context composition snapshot, and per-event token counts. Secrets (API keys, JWTs, bearer tokens) are automatically redacted before the file is written.

```sh
# Export most recent session (or press `e` on any session in top view)
agentshark export
agentshark export --output trace.aspark

# Replay an exported file offline
agentshark inspect --replay trace.aspark
```

**When to share a `.aspark` with a teammate:**
- Debugging unexpected tool call sequences together
- Walking through context bloat or cache miss patterns with the team
- Filing a bug report with an MCP server author — attach the file directly

The `.aspark` format is versioned and schema-validated. Schema: [`schema/aspark.v1.json`](schema/aspark.v1.json).

---

## Documentation

- [**CLI reference**](docs/cli.md) — all commands, flags, key bindings, and common flows
- [**Concepts**](docs/concepts.md) — what agents, sessions, and events are
- [**Design**](docs/design.md) — how agentshark works under the hood

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

- Built by [Buildstack](https://buildstack.dev/)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](SECURITY.md)

## License

Apache-2.0 — see [LICENSE](LICENSE).
