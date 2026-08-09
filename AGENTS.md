# agentshark

## Keep HelpView in sync

`src/ui/HelpView.tsx` contains the in-app reference shown when users press `h`. It must be updated whenever any of the following change:

- **Columns in TopView** (`src/ui/TopView.tsx`) — column added, removed, renamed, or its meaning changes → update the `COLUMNS` section of `TopHelp` in `HelpView.tsx`
- **Key bindings in App.tsx** (`src/ui/App.tsx`, `useInput`) — key added, removed, or rebound in top or inspect/events mode → update the `KEYS` section of `TopHelp` or `EventsHelp`
- **Event types** (`src/schema/event.ts` or `typeColor` in `src/ui/EventList.tsx`) — type added or removed → update the `EVENT TYPES` section of `EventsHelp`
- **Cache badge logic** (`cacheBadge` in `src/ui/EventList.tsx`) — badge character or subtype changes → update the `CACHE BADGES` section of `EventsHelp`
- **Event list columns** (`src/ui/EventList.tsx` header row) — column added, removed, or renamed → update the `COLUMNS` section of `EventsHelp`

Never leave `HelpView.tsx` describing keys, columns, or event types that no longer exist, and never omit ones that were added.

## Keep README, docs, and CLI help in sync

Three surfaces must always agree with the code:

- **`README.md`** — quick-start examples, top-view keys table, inspect-view keys table, Export section
- **`docs/guide.md`** — per-command reference, keybinding tables, export examples
- **`src/cli.ts` meow usage string** — `Usage` block and `Options` list

Update all three whenever any of the following change:

- **CLI commands or flags** (`src/cli.ts`) — command added, removed, renamed, or a flag added/removed → update the meow `Usage`/`Options` string **and** the quick-start block in `README.md` **and** the relevant command section in `docs/guide.md`
- **Top-view keybindings** (`src/ui/App.tsx`, `useInput`, `mode === 'top'` block) — key added, removed, or rebound → update the top-view keys table in `README.md` **and** `docs/guide.md`
- **Inspect-view keybindings** (`src/ui/App.tsx`, `useInput`, `mode === 'inspect'` block) — key added, removed, or rebound → update the inspect-view keys table in `README.md` **and** `docs/guide.md`

Never leave any of the three surfaces describing commands, flags, or keys that no longer exist, and never omit ones that were added.

- **Context Composition categories** (`src/extract/contextComposition.ts`, `CATEGORY_LABELS`) — category added, removed, or renamed → update the category reference table in the `### agentshark inspect → Context Composition view` section of `docs/guide.md`

## Never let CLI parsing fail silently

`src/cli.ts` is the only command-line surface. Whenever you add, remove, or modify a command, flag, or dispatch branch:

- **Unknown commands** (positional args not matching the whitelist in `KNOWN_COMMANDS`) must print a clear error to stderr — e.g. `agentshark: unknown command "<x>"` — followed by the usage block, then `process.exit(2)`. Never silently fall through to a default mode.
- **Unknown flags** must error. Keep `allowUnknownFlags: false` in the meow options. Never quietly drop typos like `--reply` (for `--replay`).
- **Extra positional args** must error with the same exit code and usage output. `agentshark inspect foo bar` is a misuse, not a no-op.
- When you add a new command, add it to `KNOWN_COMMANDS` in `src/cli.ts` in the same change. When you remove a command, remove it from the set.

A user who mistypes anything should see a message explaining what was wrong, never a silently-launched default view.

## Use Conventional Commits

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

- Format: `<type>[optional scope]: <description>`, e.g. `fix(cli): reject unknown flags instead of ignoring them`
- Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- Breaking changes: append `!` after the type/scope (e.g. `feat(cli)!: ...`) and/or include a `BREAKING CHANGE:` footer describing the change
- Description is a short, imperative summary (no trailing period); body and footers go below a blank line when more detail is needed

