# Changelog

All notable changes to **agentshark** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project tracks [Semantic Versioning](https://semver.org/spec/v2.0.0.html) while remaining in pre-`1.0` territory — breaking changes can land in any `0.x` bump.

## [Unreleased]

### Added

- **`.aspark` v2 — sub-agent family bundles.** `agentshark export` now walks the in-memory parent→child registry and bundles every descendant sub-agent's events into the same `.aspark` file under a new top-level `children` array. One redaction-diff confirmation covers the whole family (parent + descendants, scanned as one pass). Replay (`agentshark inspect --replay`) rebuilds the `sessionRegistry` from the bundle so the sub-agent tree shows correctly. (`src/export/pack.ts`, `src/replay/replay.ts`, `src/cli.ts`, `src/ui/App.tsx`)
- **Drill-down keys in inspect view.** `>` drills into a sub-agent of the current session (repeat to cycle through siblings); `<` pops back to the parent. Works in both live and replay modes — in replay, the bundled child events render without disk access. (`src/ui/App.tsx`, `src/ui/HelpView.tsx`)
- **`turnUsage` preserved on export.** The per-`api_turn` usage object is no longer stripped during export, so the Context Composition view recomputes accurately in replay. (`src/export/pack.ts`, `src/schema/event.ts`)
- **Sort key in inspect view.** `s` cycles the event list through `step ↑` (chronological, default) → `step ↓` (reverse chronological) → `tok ↓` (largest input-token consumers first) → `tok ↑`, shown in the header and footer. The cursor snaps to the top of the list on every resort. (`src/ui/App.tsx`, `src/ui/HelpView.tsx`)

### Compatibility

- v1 `.aspark` files (single-session, no `children`) still load — `loadReplay` returns `children: []` and the inspect view renders identically. New files written by this version are v2.

## [0.0.2] — 2026-06-04

A round of doc-vs-code reconciliation: privacy fix, six gap closures, test baseline, fixture infrastructure.

### Security

- **Export was leaking secrets outside of `payload`.** `agentshark export` (and the `e` keypress in `top`) ran redaction only on event `payload`, so secret-shaped strings inside `detail` (message previews) and `tags` (file paths, tool arguments) reached the `.aspark` file verbatim. Redaction now runs over every field of every event before write. Caught and locked in by tests in `src/export/pack.test.ts`. (`src/export/pack.ts`)

### Added

- **Redaction-diff confirmation on export.** `agentshark export` now prints a per-pattern diff (counts + sample contexts) and prompts `write file? [y/N]` before any file is written. Press `y` to write, `n` / `Esc` to abort. `--yes` skips the prompt for scripting. A non-TTY shell without `--yes` refuses (no silent writes). In the TUI, pressing `e` in `top` opens a `RedactionConfirm` panel with the same diff. (`src/cli.ts`, `src/ui/RedactionConfirm.tsx`, `src/ui/App.tsx`)
- **Jump-to-child key in `top`.** `→` (right arrow) jumps from a parent session into its most-recently-active sub-agent. Rows that are children of another session are marked with `↳`; parent rows that have known children are marked with `→`. Works for any Claude Code session that spawned `Agent` tool calls. (`src/ui/TopView.tsx`, `src/store/sessionRegistry.ts`)
- **`cache:` filter key.** New filter expression `cache:hit`, `cache:write`, `cache:none` matches events by per-event cache state. Composes with the existing grammar: `cache:hit AND tokens > 1000`. (`src/store/filter.ts`)
- **`--yes` flag on `export`.** Skips the confirmation prompt for CI / scripting. Documented in the `meow` usage block, `README.md`, and `docs/guide.md`. (`src/cli.ts`)
- **Adapter capability flags.** Every adapter now exports a `CAPABILITIES` set. `agentshark adapters` appends `(discovery only — token / cache data not yet supported)` to adapters that can't yet produce summary data, instead of letting them silently report zeros. (`src/adapters/types.ts`, every adapter)

### Changed

- **README tagline rewritten.** The line on `README.md:22` dropped the unimplemented "multi-agent topologies as a tree" claim. Replaced with a description of what `top` actually does: sub-agent sessions surface with a one-key jump from parent.
- **`top` view renders `—` instead of `0`** for `TURNS` / `BILLED_IN` / `CACHE%` on rows from discovery-only adapters (Cursor, Gemini CLI, Copilot CLI). Empty cells now read as "unsupported" rather than "broken". (`src/ui/TopView.tsx`)
- **Hook subtypes normalized to snake_case.** Claude Code's JSONL records hook events as `attachment.type:"hook_success"` with `attachment.hookEvent` in CamelCase (`PreToolUse`, `PostToolUse`, `Stop`). The extractor now emits the snake_case form the docs advertise (`pre_tool`, `post_tool`, `stop`, `user_prompt_submit`). Raw CamelCase is preserved in `tags.hook_event_raw` for full-fidelity inspection. (`src/extract/events.ts`)
- **Every event carries a `cacheState`.** Each emitted event inherits its surrounding `api_turn`'s predominant cache state (`hit` / `write` / `none`). The `H` / `W` badges in the inspect view derive from this directly — previously only the dedicated `cache`-type events got a badge. Old `.aspark` replays without the field still render via a legacy fallback. (`src/schema/event.ts`, `src/extract/events.ts`, `src/ui/EventList.tsx`)
- **`attachment` event type accurately described.** The README event-types table and `docs/design.md` § 5 now describe `attachment` as a catch-all for unmatched Claude Code internal `attachment.type` records (e.g. `file`, `diagnostics`, `deferred_tools_delta`) — not just "File or binary attachment". Subtype is the original `attachment.type`.
- **Adapter status table downgraded for stubs.** `README.md`, `docs/guide.md`, and `docs/design.md` mark Cursor, Gemini CLI, and Copilot CLI as ⚠️ "discovery only — token / cache data not yet supported" instead of the previous implicit ✅.

### Fixed

- **`hook:pre_tool` filter matches.** Previously the extractor lower-cased `"PreToolUse"` to `"pretooluse"`, so the form documented in `docs/guide.md` matched zero events. Now matches.
- **Doc/code round-trip is whole again.** README, `docs/guide.md`, `docs/design.md`, and `src/ui/HelpView.tsx` are back in sync with `src/cli.ts` and `src/ui/App.tsx` per `CLAUDE.md` policy. Every documented command, flag, keybinding, column, and event type maps to code; every code surface is documented.

### Internal

- **`node:test` unit test runner.** `npm test` now runs `test:fixtures` → `test:unit` → smoke test. 65 unit tests covering filter language, Claude Code adapter, export + redaction, hook normalization, per-event `cacheState`, adapter capabilities, sub-agent session registry. (`package.json`, `src/**/*.test.ts`)
- **Fixture generation infrastructure.** `scripts/scrub-session.ts` deterministically replaces identifying content in real Claude Code / Codex sessions while preserving structure, relative timestamp ordering, and ID relationships (parent ↔ child linkage survives the scrub). 8 scrubbed fixtures committed under `src/fixtures/`.
- **Pre-commit fixture safety check.** `scripts/check-fixtures.ts` scans every fixture for secret-shaped strings, username leaks, and real project paths on every `npm test`. Fails loud if the scrubber misses a pattern.
- **`docs/jsonl-shapes.md`.** Records the actual Claude Code JSONL shape this round was built against — hook entries arrive as `type:"attachment"` with `attachment.type:"hook_success"`; sub-agents link via `<parent-session>/<parent-id>/subagents/agent-<id>.meta.json::toolUseId`. Useful background when the next extractor change lands.
- **Cross-session sub-agent registry.** `src/store/sessionRegistry.ts` is populated by the Claude Code adapter during `discoverSessions` by walking each session's `subagents/` directory. The TUI consults it for the `↳` / `→` glyphs and the jump-to-child key. Cleared and rebuilt on every refresh; no persistence.

## [0.0.1] — initial commit

- Initial scaffold: `top` and `inspect` TUIs, Claude Code / Claude Cowork / Codex / Cursor / Gemini CLI / Copilot CLI adapters, `.aspark` export format, filter language, Context Composition view, token attribution algorithm.

[Unreleased]: https://github.com/buildstackhq/agentshark/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/buildstackhq/agentshark/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/buildstackhq/agentshark/releases/tag/v0.0.1
