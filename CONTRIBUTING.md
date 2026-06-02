# Contributing to agentshark

Thank you for your interest in contributing. This document covers how to get the project running locally and how to submit changes.

## Prerequisites

- **Node.js 20+** — `node --version`
- **npm 10+** — `npm --version`

## Setup

Clone the repository, then install dependencies:

```bash
cd agentshark
npm install
```

## Development workflow

```bash
# Run the TUI in dev mode (requires a real terminal / TTY)
npm run dev -- top          # session list
npm run dev -- inspect      # most recent session
npm run dev -- adapters     # show which adapters detect on this machine
npm run dev -- export       # export most recent session to .aspark

# Headless smoke test — validates the full data pipeline without a TTY
npm test

# Type checking
npm run typecheck

# Build distributable
npm run build
```

> **Note:** `npm test` (the smoke test) requires at least one local Claude Code session on disk.
> It reads `~/.claude/projects/` and will skip if none exist.

## Project structure

```
agentshark/
├── src/
│   ├── cli.ts              # CLI entry point (meow-based command routing)
│   ├── adapters/           # One file per supported agent (claude-code, codex, cursor, …)
│   │   └── types.ts        # SessionRef, Adapter, SessionSummary interfaces
│   ├── extract/            # Event extraction & context composition
│   │   ├── events.ts       # JSONL → normalized AgentEvent stream
│   │   └── contextComposition.ts
│   ├── export/             # .aspark export packaging
│   ├── replay/             # Offline replay from .aspark files
│   ├── store/              # Filter language, ring buffer, event bus
│   ├── ui/                 # React/Ink TUI components
│   ├── schema/             # Shared AgentEvent type definitions
│   └── redact/             # Secret redaction engine
├── bin/
│   └── agentshark.js       # Binary shim (registers tsx, imports src/cli.ts)
├── scripts/
│   └── smoke-test.ts       # Headless integration test
├── schema/
│   └── aspark.v1.json      # Versioned .aspark export format (JSON Schema)
└── docs/
    ├── cli.md              # Command & UI reference
    ├── concepts.md         # Mental models for AI agent observability
    └── design.md           # Technical architecture
```

## Adding a new agent adapter

1. Create `src/adapters/<agentName>.ts` implementing the `Adapter` interface from `src/adapters/types.ts`.
2. Register it in `src/adapters/index.ts`.
3. Run `npm run dev -- adapters` to confirm detection.
4. Run `npm run test:codex` to run the codex-specific adapter tests (adapt the script path for your adapter).
5. Run `npm test` to verify it doesn't break the existing pipeline.

## Keeping documentation in sync

Three surfaces must always agree with the code. Update them whenever the relevant code changes:

### HelpView (`src/ui/HelpView.tsx`)

Must be updated when:
- **Columns in TopView** (`src/ui/TopView.tsx`) — column added, removed, renamed, or its meaning changes → update the `COLUMNS` section of `TopHelp`
- **Key bindings in App.tsx** (`src/ui/App.tsx`, `useInput`) — key added, removed, or rebound in top or inspect/events mode → update the `KEYS` section of `TopHelp` or `EventsHelp`
- **Event types** (`src/schema/event.ts` or `typeColor` in `src/ui/EventList.tsx`) — type added or removed → update the `EVENT TYPES` section of `EventsHelp`
- **Cache badge logic** (`cacheBadge` in `src/ui/EventList.tsx`) — badge character or subtype changes → update the `CACHE BADGES` section of `EventsHelp`
- **Event list columns** (`src/ui/EventList.tsx` header row) — column added, removed, or renamed → update the `COLUMNS` section of `EventsHelp`

### README, docs/cli.md, and CLI help string

Must be updated when:
- **CLI commands or flags** (`src/cli.ts`) — command added, removed, renamed, or a flag changed → update the meow `Usage`/`Options` string, the quick-start block in `README.md`, and the relevant section in `docs/cli.md`
- **Top-view keybindings** (`src/ui/App.tsx`) — key added, removed, or rebound → update the top-view keys table in `README.md` and `docs/cli.md`
- **Inspect-view keybindings** (`src/ui/App.tsx`) — key added, removed, or rebound → update the inspect-view keys table in `README.md` and `docs/cli.md`

Never leave any of these surfaces describing commands, keys, or event types that no longer exist, and never omit ones that were added.

## Pull request checklist

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` (smoke test) passes on at least one local session
- [ ] No new `@ts-ignore` or `as any` casts without a comment explaining why
- [ ] Privacy invariants preserved: local mode sends no data, redaction runs before any export

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(adapters): add Gemini CLI adapter
fix(filter): handle empty filter string without throwing
docs(readme): add filter expression cheatsheet
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

If you discover a vulnerability, follow [SECURITY.md](SECURITY.md) rather than opening a public issue with exploit details.
