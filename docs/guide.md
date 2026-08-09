# guide.md — commands and UI flows

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
┌─ agentshark top ──────────────────────────────────────────────────────── [live] ─┐
│ AGENT              MODEL          PROJECT             TURNS  BILLED_IN  CACHE% AGE │
│ claude-code +2     sonnet-4-6     acme/payments         135    686.1K    99%   2m  │
│ claude-code        opus-4-7       infra/deploy           19     29.5K    93%   5m  │
│ cursor             sonnet-4-6     frontend/dashboard      4      8.2K    41%  12m  │
└────────────────────────────────────────────────────────────────────────────────────┘
 ↑↓ select · ⏎ inspect · s show sub-agents · e export · r pause · h help · q quit
```

Sub-agent rows are hidden by default — only the parent row with its `+N` badge appears. Press `s` to expand the children inline; they show up directly under their parent with a `└─` connector. Reach a child with `↑↓ ⏎` like any other row. Press `s` again to collapse.

| Column | Meaning |
|--------|---------|
| `AGENT` | Adapter label (`claude-code`, `claude-cowork`, `codex`, `cursor`, `gemini-cli`, `copilot-cli`). Cursor / Gemini CLI / Copilot CLI are **discovery only** today — sessions surface but TURNS / BILLED_IN / CACHE% render as `—`. A `+N` suffix means "this session spawned N sub-agents — press `s` to reveal them as `└─` rows directly beneath. |
| `MODEL` | Model the session is using |
| `PROJECT` | Project name inferred from the session path |
| `TURNS` | Number of completed assistant turns |
| `BILLED_IN` | Total billed input tokens (formatted, e.g. `686.1K`) |
| `CACHE%` | Percentage of input tokens served from cache |
| `AGE` | Time since last activity (e.g. `2m`, `1h`) |

> See [Understanding context metrics](#understanding-context-metrics) for how to read `BILLED_IN` and `CACHE%` together to diagnose a session.

**Inspect** (`Enter`): drops into `agentshark inspect` for the selected row. When the inspected session is a parent or child of another, the header line surfaces `sub-agents: N` or `sub-agent of <parent-id>` respectively.

**Show / hide sub-agents** (`s`): toggles whether sub-agent rows are listed alongside top-level sessions. Default is hidden — only parents and standalone sessions appear, keeping the list focused on agents the user is driving directly. When toggled on, children are grouped right under their parent with a `└─` tree connector and can be opened with `↑↓ ⏎` like any other row.

**Export** (`e`): exports the selected session to a `.aspark` file in `~/agentshark-exports/` — prompts y/N after showing the redaction diff (see `agentshark export` below).

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

| Field | Description |
|-------|-------------|
| `[live]` / `[paused]` | Live-tailing new events vs. frozen replay |
| `N tok avg` | Average billed input tokens per API turn (`BILLED_IN ÷ turns`) |
| `last billed=N` | Billed input on the most recent turn only |
| `N% cache` | Cache hit rate — fraction of input served from cache (green = healthy) |

> See [Understanding context metrics](#understanding-context-metrics) for how to interpret these together.

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
- `cache:X` — per-event cache state: `cache:hit`, `cache:write`, `cache:none`
- `tokens > N` — only events larger than N input tokens
- `tokens < N` — only events smaller than N input tokens
- `"regex"` — matches the regex against payload text
- `AND`, `OR`, `NOT` — boolean composition
- Parentheses for grouping

#### Event list
- Each line: time, type, subtype, tokens, percentage of turn tokens, short detail.
- Cache state badges in the TOK column: `H` (green) cache hit, `W` (yellow) cache write, blank = non-cached.
- `▶` marker on the currently inspected row.

> `TOK` and `%TOK` interpretation, cache badge meanings, and how to spot bloat: see [Understanding context metrics](#understanding-context-metrics).

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
| `s` | Cycle sort order: step ↑ / step ↓ / tok ↓ / tok ↑ |
| `>` | Drill into a sub-agent of this session, cycling siblings on repeat presses (works in live and replay) |
| `<` | Pop back to the parent session |
| `t` | Toggle live tail (pause / resume) |
| `h` | Toggle help |
| `q` | Back to `top` (or quit if `inspect` was launched directly) |

---

### `agentshark inspect` → Context Composition view (press `c`)

```
Context Composition · claude-opus-4-7
Current input · 217,955 / 200,000 tokens · 109% of window
████████████████████████████████████████

  System prompt + tool defs + memory    91,964  █████████░░░░░░░░░░░░░  42%
  User messages                         42,408  ████░░░░░░░░░░░░░░░░░░  19%
  Tool results (misc)                   36,172  ████░░░░░░░░░░░░░░░░░░  17%
  File writes                           26,649  ███░░░░░░░░░░░░░░░░░░░  12%
  Tool calls (misc)                     14,851  █░░░░░░░░░░░░░░░░░░░░░   7%
  Assistant messages                     2,847  ░░░░░░░░░░░░░░░░░░░░░░   1%
  Loaded skills / commands               1,063  ░░░░░░░░░░░░░░░░░░░░░░   0%
  Sub-agent spawns                         895  ░░░░░░░░░░░░░░░░░░░░░░   0%
  Bash outputs                             522  ░░░░░░░░░░░░░░░░░░░░░░   0%
  File reads                               317  ░░░░░░░░░░░░░░░░░░░░░░   0%
  System messages                          237  ░░░░░░░░░░░░░░░░░░░░░░   0%
  System reminders (auto-injected)          30  ░░░░░░░░░░░░░░░░░░░░░░   0%

Largest single blocks:
  ▸ tool_result · read — src/ui/App.tsx          4,270 tok
  ▸ message · user — update the readme…          3,993 tok
  ▸ tool_result · write — docs/guide.md          3,656 tok

 c back to events · h help · q back to top
```

#### Header bar

`Current input · N / M tokens · P% of window` — total billed input on the most recent turn vs. the model's context window limit. The bar fills to 100%; above that the model silently truncates older conversation history. Each model defaults to a 200K token window.

#### Category reference

| Category | What it contains | Large when… |
|----------|-----------------|-------------|
| **System prompt + tool defs + memory** | Inferred residual: `billedInput − Σ(event tokens)` — system prompt, tool schemas, CLAUDE.md/memory that Claude Code doesn't log as individual events | Large system prompt or many tools/MCP servers registered |
| **User messages** | Your typed messages to the agent | Long conversation; use `/compact` or start a fresh session |
| **Assistant messages** | Model response text | Long responses (rarely the main bloat source) |
| **System messages** | System-role messages injected into the conversation | |
| **File reads** | Output of `Read` tool calls returned to the model | Large files read repeatedly |
| **File writes** | Output of `Write` / `Edit` tool calls returned to the model | Large files written back into context |
| **Bash outputs** | Output of `Bash` tool calls | Verbose command output — add `\| head` or truncate |
| **Search results** | Search tool results | Broad queries returning many results |
| **Web fetches** | `WebFetch` tool results | Large web pages fetched |
| **MCP requests** | Outbound MCP tool call messages | Many MCP calls in one turn |
| **MCP responses** | Inbound MCP tool responses | Large MCP response payloads |
| **Tool results (misc)** | Other tool results not matched above | |
| **Tool calls (misc)** | Other tool call messages not matched above | |
| **Sub-agent spawns** | Sub-agent spawn / completion events | |
| **System reminders (auto-injected)** | Auto-injected system reminders | |
| **Loaded skills / commands** | Skill load events | |

**"System prompt + tool defs + memory" is inferred**, not measured directly. It is the gap between what the API reports as `billedInput` and the sum of all token-attributed events. System prompt, tool definitions, and memory files are lumped together here; you can't drill further into that bucket from agentshark alone.

#### Largest single blocks

The top 10 events by token count (threshold: > 200 tokens). This is the actionable trim list. Select any event in the list (`↑↓`) and press `i` to open the inspector and see its full payload.

#### Interpreting the view

```
Fill > 100%              → Context window exceeded. Model is truncating history.
                           Fix: /compact, start fresh, or stop re-reading large files.

System overhead 40%+     → Normal if you have a large CLAUDE.md or many registered tools.
                           Not directly trimmable, but it limits headroom for the rest.

User messages rising     → Conversation accumulating. Time to /compact.

File writes spiking      → Agent wrote large content into context.
                           Check "Largest blocks" for the specific file.

Tool results (misc) 15%+ → Non-file tool outputs accumulating.
                           Filter type:tool_result in the event list to locate them.

Bash outputs present     → Verbose shell output in context.
                           Add | head -20 or similar to the commands in your prompt.
```

---

### `agentshark export`
Produces a portable, redacted `.aspark` trace file. When the chosen session spawned sub-agents, the export bundles the parent's events **and every descendant sub-agent session's events** into one file — replaying it reconstructs the full sub-agent tree and lets you drill into any child with `>` / `<`.

```sh
agentshark export                       # exports most recent session + descendants, prompts y/N
agentshark export --output=NAME.aspark  # output path (default: ~/agentshark-exports/<id>.aspark)
agentshark export --yes                 # skip the y/N prompt (CI / scripting)
```

Flow:
1. agentshark assembles the normalised event stream for the parent session and every descendant sub-agent (BFS over the in-memory parent→child registry, depth-capped at 8).
2. Runs the redactor across every event field of every session — one family-wide pass, with one combined `matchCount` and sample list.
3. Prints the redaction diff: count of hits per pattern, one sample snippet per pattern with surrounding context.
4. Prompts `write file? [y/N]` on stdin (or, in the TUI, the same diff renders as a panel — press `y` to write or `n` / `Esc` to abort). One confirmation covers the whole family.
5. Only on `y` is the `.aspark` file written. Nothing is uploaded.

`--yes` skips step 4. In a non-interactive shell (no TTY) without `--yes`, the command refuses and exits non-zero — never silently writes without consent.

**Format**: the current schema is `.aspark` **v2** ([`schema/aspark.v2.json`](../schema/aspark.v2.json)) — adds a `children` array bundling sub-agent sessions and preserves the per-turn `turnUsage` field so the Context Composition view replays accurately. v1 files (single-session, no `children`) still load via `--replay`; see [`schema/aspark.v1.json`](../schema/aspark.v1.json) for that legacy shape. Large families produce larger files (each child's full event stream is included) — for very deep trees, prefer exporting an inner subtree by selecting a sub-agent row in `top` and pressing `e`.

### `agentshark adapters`
Lists every adapter, whether it detected anything on the local machine, and whether it produces token / cache summary data.

```
claude-code     ✓ 5+ sessions detected
claude-cowork   ✓ 2+ sessions detected
codex           ─ not detected
cursor          ✓ 3+ sessions detected (discovery only — token / cache data not yet supported)
gemini-cli      ─ not detected (discovery only — token / cache data not yet supported)
copilot-cli     ─ not detected (discovery only — token / cache data not yet supported)
```

Use this to debug "why doesn't agentshark see my agent" and to see at a glance which adapters are still discovery-only.

---

## Environment variables

> **Not yet implemented** — these variables are planned but not currently read by the CLI.

| Var | Planned purpose |
|-----|----------------|
| `AGENTSHARK_REDACT_CONFIG` | Path to `.agentshark-redact` (default: `.agentshark-redact` in cwd) |
| `AGENTSHARK_LOG_LEVEL` | `error` / `warn` / `info` / `debug` |
| `AGENTSHARK_NO_TELEMETRY` | Disable telemetry pings (anonymous version + command counts) |

---

## Understanding context metrics

Every numeric field agentshark shows is derived from the same underlying token counts. Here is how they relate across views and how to use them together.

### How the numbers relate

```
Top view BILLED_IN          = total billed input across all turns
                            = Σ (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)

Inspect header "N tok avg"  = BILLED_IN ÷ number of assistant turns
Inspect header "last billed"= billed input on the most recent API turn only

Top view CACHE%             = same ratio as inspect header cache%
                            = Σ cache_read_input_tokens ÷ BILLED_IN
```

### What each metric signals

| Metric | Where | What it signals | Healthy | Warning |
|--------|-------|----------------|---------|---------|
| `BILLED_IN` | top | Total API cost exposure for the session | Growing gradually | Jumping suddenly between turns |
| `CACHE%` | top / inspect | Fraction of input served from cache | ≥ 80% after the first few turns | < 50% in a mature session — cache isn't sticking |
| `avg` | inspect header | Average context size per turn | Stable or slowly rising | Doubling across turns — context is bloating |
| `last billed` | inspect header | Context size on the most recent turn | Close to `avg` | Significantly above `avg` — something just swelled the context |
| `TOK` | event list | Token cost of one specific event | Small relative to session total | A single event at > 20% of total — a trim target |
| `%TOK` | event list | This event's share of total session input | Spread across many small events | One event at 30%+ — the bloat culprit |
| `W` badge | event list | This turn wrote tokens to the prompt cache | Occasional writes followed by hits | All `W`, no `H` — writes not being reused |
| `H` badge | event list | This turn read tokens from cache | Frequent `H` after the first few turns | Rare `H` — turns not benefiting from prior cache writes |

### Diagnostic workflow

1. **Spot a session worth investigating** in top view: high `BILLED_IN` relative to `TURNS`, or `CACHE%` below 60%.
2. **Enter inspect (`Enter`)** and read the header bar: if `last billed` is much higher than `avg`, the most recent turn was anomalously large — scroll to the bottom of the event list to find what caused it.
3. **Look for high `%TOK` events** — anything in the double digits is a trim target. Open the inspector pane (`i`) to see the full payload.
4. **Check the cache badge column**: a long run of `W` with no `H` means the cache is being written but not reused — check whether system prompts or tool definitions are changing between turns.
5. **Press `c`** to open Context Composition view — it ranks contributors by category and surfaces the single largest blocks, confirming what the `%TOK` column showed.

### Quick rules of thumb

- `CACHE%` ≥ 80% after turn 3 → context is stable and cheap
- `last billed` > 1.5× `avg` → something just swelled the context; inspect the last few events
- Any single event at `%TOK` ≥ 20% → trim it or replace it with a reference
- All `W`, no `H` → cache writes are not being reused; likely something in the prompt is changing each turn

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
2. The file contains the full event stream — tool calls, tool results, MCP roundtrips, context composition, and per-event token counts — **plus every sub-agent the session spawned**, so the recipient sees the same tree you do.
3. Secrets (API keys, JWTs, bearer tokens) are automatically redacted before writing. One confirmation covers the whole family.
4. Send the `.aspark` file to your teammate. They can replay it offline with `agentshark inspect --replay debug.aspark` and drill into any sub-agent with `>` / `<`.

---

That's the whole user surface. Anything not described here is not in the product.
