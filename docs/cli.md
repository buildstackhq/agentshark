# cli.md — commands and UI flows

Audience: a user about to install agentshark. This is the user-facing surface.

If you haven't yet, read `concepts.md` for what agents are and `design.md` for how agentshark works under the hood.

---

## Installation

```sh
# zero-install trial
npx agentshark

# or install globally
npm install -g agentshark
```

agentshark needs no configuration to work locally. On first run it scans for installed agents.

---

## Commands

### `agentshark`
Default. Equivalent to `agentshark top`.

### `agentshark top`
Live list of every agent session the tool can see — local file-tailed.

```
┌─ agentshark top ──────────────────────────────────────────────────── [live] ─┐
│ AGENT         MODEL           PROJECT               TURNS  BILLED_IN  CACHE%  AGE │
│ claude-code   sonnet-4-6      acme/payments             135    686.1K     99%   2m  │
│ claude-code   opus-4-7        infra/deploy               19     29.5K     93%   5m  │
│ cursor        sonnet-4-6      frontend/dashboard          4      8.2K     41%  12m  │
└──────────────────────────────────────────────────────────────────────────────────┘
 ↑↓ select · ⏎ inspect · e export · r pause/resume · h help · q quit
```

| Column | Meaning |
|--------|---------|
| `AGENT` | Adapter label (`claude-code`, `codex`, `cursor`, `gemini-cli`, `copilot-cli`) |
| `MODEL` | Model the session is using |
| `PROJECT` | Project name inferred from the session path |
| `TURNS` | Number of completed assistant turns |
| `BILLED_IN` | Total billed input tokens (formatted, e.g. `686.1K`) |
| `CACHE%` | Percentage of input tokens served from cache |
| `AGE` | Time since last activity (e.g. `2m`, `1h`) |

**Inspect** (`Enter`): drops into `agentshark inspect` for the selected row.

**Export** (`e`): exports the selected session to a `.aspark` file in `~/agentshark-exports/`.

**Refresh** (`r`): pause / resume auto-refresh.

**Quit** (`q`): exits the TUI.

---

### `agentshark inspect`
The Wire shark view — deep, event-level introspection of one session.

```sh
agentshark inspect                       # most-recently-active local session
agentshark inspect --replay=FILE.aspark  # offline replay of an exported trace
```

Three-pane layout:

```
┌─ agentshark inspect · claude-code · sonnet-4.6 · ht/prd ──────────┐
│  Live · 142K/200K ctx · 84% cache · 23 events  · v live tail      │
├─ [ Filter: type:mcp OR type:hook                  ]──────────────  ┤
│     TIME      TYPE         SUBTYPE       TOK   %TOK  DETAIL       │
│  14:22:01  tool_call    read          +2.1K   14%  file.ts        │
│  14:22:01  hook         pre_tool        +0     0%  post_tool_use  │
│▶ 14:22:03  mcp          request       H +890    6%  gmail/list     │
│  14:22:04  mcp          response      +1.2K    8%  12 msgs        │
│  14:22:04  system_rem   injected        +180    1%  tool reminder  │
├─ INSPECTOR: event #3 ──────────────────────────────────────────── ┤
│  type: mcp · subtype: request                                     │
│  server: gmail · tool: list_messages                              │
│  tokens (input): 890 [cache-hit]   duration: ~0.4s                │
│  payload:                                                         │
│    { "filter": "unread", "limit": 20 }                            │
└───────────────────────────────────────────────────────────────────┘
 / filter · ↑↓ select · i inspector · c context · t tail · h help · q back
```

#### Top header
`Live` or `Paused` · context fill · cache hit rate · event count · tail state.

#### Filter bar
A Wire shark-style display filter. Supported tokens:
- `type:X` — `type:mcp`, `type:hook`, `type:tool_call`
- `subtype:X` — `subtype:hit`, `subtype:pre_tool`
- `source:X` — `source:claude-code`, `source:codex`
- `mcp:X` — `mcp:gmail`, `mcp:pinecone`
- `hook:X` — `hook:pre_tool`, `hook:user_prompt_submit`
- `trace:X` — events tied to a multi-agent trace id
- `model:X` — `model:sonnet`, `model:opus`
- `category:X` — event category label
- `tokens > N` — only events larger than N input tokens
- `tokens < N` — only events smaller than N input tokens
- `"regex"` — matches the regex against payload text
- `AND`, `OR`, `NOT` — boolean composition
- Parentheses for grouping

#### Event list
- Each line: time, type, subtype, tokens, percentage of turn tokens, short detail.
- Cache state badges in the TOK column: `H` (green) cache hit, `W` (yellow) cache write, blank = non-cached.
- `▶` marker on the currently inspected row.

#### Inspector
- Updates as you `↑↓` through the list.
- Shows the full normalised event including its tags.

#### Keys
| Key | Action |
|-----|--------|
| `↑` `↓` | Select event |
| `PgUp` `PgDn` | Page through event list |
| `g` / `G` | Jump to first / last event |
| `/` | Edit filter |
| `Esc` | Close filter bar |
| `i` | Toggle inspector pane |
| `c` | Toggle Context Composition view |
| `t` | Toggle live tail (pause / resume) |
| `h` | Toggle help |
| `q` | Back to `top` (or quit if `inspect` was launched directly) |

---

### `agentshark inspect` → Context Composition view (press `c`)

```
Current input · 142,310 / 200,000 tokens · ht/prd · sonnet-4.6

  System prompt          8,420   ████░░░░░░░░░░░░░░░░░░  6%
  CLAUDE.md / memory     3,100   ██░░░░░░░░░░░░░░░░░░░░  2%
  Tool definitions      12,800   ██████░░░░░░░░░░░░░░░░  9%
  Conversation history  58,200   █████████████████████░ 41%
  File reads            45,900   ████████████████░░░░░░ 32%
  Tool results (other)  13,890   ██████░░░░░░░░░░░░░░░░ 10%

Largest single blocks:
  ▸ Read /Users/.../big-file.ts                12,400
  ▸ Bash output: rg --files (truncated)         8,100
  ▸ MCP gmail.list_messages response            6,200

 c back to events · h help · q back to top
```

Categories are derived from the event taxonomy + content-block role classification:
- **System prompt + Tool definitions + Memory** = the "system overhead" bucket that the attribution algorithm can't see in local mode. Surfaced as one collapsed line.
- **Conversation history** = sum of past user + assistant text messages.
- **File reads** = `tool_result` blocks where the parent `tool_call` was `Read`.
- **Tool results (other)** = everything else (`Bash`, `Edit`, MCP responses, ...).

"Largest single blocks" is the actionable section — it tells you exactly what to trim or replace with a reference.

---

### `agentshark export`
Produces a portable, redacted `.aspark` trace file.

```sh
agentshark export                     # exports most recent session
agentshark export --output=NAME.aspark  # output path (default: ~/agentshark-exports/<id>.aspark)
```

Flow:
1. agentshark assembles the normalised event stream for the session.
2. Runs the redactor against all payloads — secret patterns + `.agentshark-redact` config.
3. Shows you the redaction diff: count of hits per pattern, sample matches with context.
4. You confirm (or hit `q` to abort).
5. The `.aspark` file is written. Nothing is uploaded.

### `agentshark adapters`
Lists every adapter and whether it detected anything on the local machine.

```
claude-code     ✓ 5+ sessions detected
claude-cowork   ✓ 2+ sessions detected
codex           ─ not detected
cursor          ✓ 3+ sessions detected
gemini-cli      ─ not detected
copilot-cli     ─ not detected
```

Use this to debug "why doesn't agentshark see my agent".

---

## Environment variables

> **Not yet implemented** — these variables are planned but not currently read by the CLI.

| Var | Planned purpose |
|-----|----------------|
| `AGENTSHARK_REDACT_CONFIG` | Path to `.agentshark-redact` (default: `.agentshark-redact` in cwd) |
| `AGENTSHARK_LOG_LEVEL` | `error` / `warn` / `info` / `debug` |
| `AGENTSHARK_NO_TELEMETRY` | Disable telemetry pings (anonymous version + command counts) |

---

## Common flows

### "My Claude Code session feels slow — what happened?"
1. `agentshark inspect` against the live session.
2. Watch the event stream as you type. Spot the spike in `+TOK` column.
3. `c` to confirm what category swelled.
4. Inspect the largest blocks — they're the trim targets.

### "Did my hook actually fire on that command?"
1. `agentshark inspect`.
2. Filter: `hook:pre_tool`.
3. Run the command. Watch for the event.
4. Inspector shows hook script output and exit code.

### "Which MCP server is slowing things down?"
1. `agentshark inspect`.
2. Filter: `type:mcp AND subtype:response`.
3. Look at the `duration` field in the inspector pane for each event — top offenders surface.

### "I want to bug-report this to my MCP server author"
1. Export: `agentshark export --output=mcp-bug.aspark`.
2. Review the redaction diff — confirm no secrets leak.
3. Attach the `.aspark` file to the issue.

### "I want to share a session with my team to debug tool calls or context usage"
1. In top view, press `e` on the session (or run `agentshark export --output=debug.aspark`).
2. The file contains the full event stream — tool calls, tool results, MCP roundtrips, context composition, and per-event token counts.
3. Secrets (API keys, JWTs, bearer tokens) are automatically redacted before writing.
4. Send the `.aspark` file to your teammate. They can replay it offline with `agentshark inspect --replay debug.aspark`.

---

That's the whole user surface. Anything not described here is not in the product.
