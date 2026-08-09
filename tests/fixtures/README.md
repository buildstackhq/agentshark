# Test fixtures

Each `*.jsonl` here is a structurally-real session captured from this machine, scrubbed with `scripts/scrub-session.ts` before commit. JSON shape, field names, types, ordering, and `usage` numbers are preserved verbatim; identifying content (paths, file content, user text, IDs, timestamps) is replaced deterministically.

## How to regenerate

```sh
tsx scripts/scrub-session.ts <real-session.jsonl> tests/fixtures/<dest>.jsonl
```

The scrubber:

- Hashes UUIDs, request IDs, `toolUseId` etc. with a stable SHA-1 prefix (`fix-…`, `msg_…`, `toolu_…`) so cross-references inside the session still resolve.
- Offsets all timestamps to base `2026-01-01T00:00:00.000Z` preserving relative ordering.
- Replaces file paths with `/Users/dev/projects/example/<basename>` (preserving extension).
- Replaces file contents / Bash commands / Bash output / message text / `thinking` blocks with a `scrubbed <field> (N chars)` size marker.
- Re-scans using the app's own secret patterns (`src/redact/redact.ts`) and replaces matches with `<<REDACTED:pattern>>`.
- Normalizes `cshanmugam` → `dev`, `sekar.fa@gmail.com` → `dev@example.com`.

The `session-with-secrets.jsonl` fixture is a scrubbed base + **synthetic** secret-shaped strings injected by hand so the redactor has something to match. None of the secrets in it are real.

## Files

### `claude-code/`

| Fixture | Source shape | Used by |
|---|---|---|
| `short-session.jsonl` | 2-turn Claude Code session, no MCP / hooks / sub-agents | baseline tokenization, Context Composition, smoke test |
| `with-hooks.jsonl` | Session that fired `PreToolUse`, `PostToolUse`, `Stop` hooks | hook extractor tests, `hook:` filter tests |
| `with-attachment.jsonl` | Session that loaded a `file` attachment (`attachment.type:"file"`) | attachment extractor, diagnostics handling |
| `long-session.jsonl` | 7-turn session with ~99.7% cache hit rate | token attribution reconciliation, per-event `cacheState` tests |
| `parent-with-subagent.jsonl` | Session that spawned 2 `Agent` sub-agents (the parent log) | sub-agent linkage, `type:'subagent'` event extraction |
| `subagent-child.jsonl` + `subagent-child.meta.json` | The child sub-agent log + its `meta.json` linking back to the parent's `tool_use.id` | sub-agent registry tests |
| `session-with-secrets.jsonl` | Short session + injected synthetic secrets | redactor pattern coverage |

### `codex/`

| Fixture | Source shape | Used by |
|---|---|---|
| `short-session.jsonl` | Small Codex `rollout-…jsonl` session | Codex adapter parsing tests |

## Pre-commit safety

`scripts/check-fixtures.ts` scans every `tests/fixtures/**/*.jsonl` for the same secret patterns that `src/redact/redact.ts` looks for and fails loudly on any match outside of `session-with-secrets.jsonl` (where synthetic secrets are intentional). This is a belt-and-suspenders check against accidental real content leaking through scrubber misses.
