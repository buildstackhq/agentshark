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
- **`docs/cli.md`** — per-command reference, keybinding tables, export examples
- **`src/cli.ts` meow usage string** — `Usage` block and `Options` list

Update all three whenever any of the following change:

- **CLI commands or flags** (`src/cli.ts`) — command added, removed, renamed, or a flag added/removed → update the meow `Usage`/`Options` string **and** the quick-start block in `README.md` **and** the relevant command section in `docs/cli.md`
- **Top-view keybindings** (`src/ui/App.tsx`, `useInput`, `mode === 'top'` block) — key added, removed, or rebound → update the top-view keys table in `README.md` **and** `docs/cli.md`
- **Inspect-view keybindings** (`src/ui/App.tsx`, `useInput`, `mode === 'inspect'` block) — key added, removed, or rebound → update the inspect-view keys table in `README.md` **and** `docs/cli.md`

Never leave any of the three surfaces describing commands, flags, or keys that no longer exist, and never omit ones that were added.
