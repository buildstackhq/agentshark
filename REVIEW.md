# Review: agentshark v0.0.1 — Where's the Wow Factor?

## Context

agentshark is a Node.js TUI ("Wireshark + top for AI agents") that tails Claude Code / Codex / Cursor session logs and surfaces tool calls, MCP roundtrips, hooks, cache events, and per-event input-token attribution. Posted to the community at pre-alpha. Almost no engagement; the single substantive comment asked:

> *"What has been the most surprising thing you've discovered while tracing agent behavior so far? When you started digging into tool calls, context usage, and execution flow, was there anything agents were doing that you did not expect?"*

This review diagnoses the gap and offers ranked options. You'll pick what to act on.

## What the one comment actually means

That commenter was not asking about the tool. They were asking for **findings** — the insights the tool revealed. That signal matters more than the silence around it:

- **The tool is interesting; the story isn't there yet.** People scrolled past "here's a thing I built" looking for "here's what I learned." A microscope post lands; a microscope-and-no-slide post doesn't.
- **You're showing the instrument, not what's under it.** The README shows columns, badges, and screenshots of the *interface*. It never shows a single concrete, surprising insight that only this tool surfaces. ("Did you know your average Claude Code session has 8% of its context consumed by system reminders you never see?" — that's the kind of thing.)
- **The next launch needs a findings post, not just a tool post.** A "5 weird things I learned tracing 1000 Claude Code sessions with agentshark" — even with N=10 sessions — would invert the dynamic: instead of asking the audience to imagine the value, you hand them the value and they go *"how did you find that?"* → answer is the tool.

This re-frames everything below. The hook isn't just wrong because it's metaphor-led; it's wrong because there's no payload behind it.

## Verdict

**Yes — it solves a real problem.** Context bloat and cache economics are genuinely opaque for Claude Code / Codex power users, and there's no local-first, dev-time inspector that surfaces them. The token-attribution algorithm and cache-state badges are technically strong (`docs/design.md` § 6 validates within ~10% on real sessions).

**No — the wow isn't landing.** Five root causes, ordered by how much they're hurting you:

### 1. The pitch sells the wrong story

"Wireshark + top for AI agents" appeals to nostalgic sysadmins. The actual user pain is *"why did my agent burn $14?"* or *"why did this session blow past 180K tokens?"* — neither phrase appears in `README.md`. The reader's first 100ms is spent decoding a metaphor instead of feeling a problem.

### 2. The README oversells; the code under-delivers (trust erosion)

- "Multi-agent topologies as a tree" (`README.md:22`) is admitted as unimplemented in `docs/design.md:307`. The `parentSpanId` field exists in the schema but is never populated or rendered. `TopView.tsx` is a flat list.
- "Export ... after showing you the redaction diff for confirmation" (`README.md:70`, also promised in `docs/design.md:200`) is **not implemented** — `src/export/pack.ts:36-43` silently writes the file on `e`. Stated "non-negotiable privacy invariant" violated by the code.
- "Tested status by agent" table claims ✅ for Claude Cowork on macOS, but `summarizeSession` is partial there too. Cursor / Copilot CLI / Gemini CLI adapters return zeros from `summarizeSession` (`src/adapters/cursor.ts:73-84`, `src/adapters/copilotCli.ts:62-74`).

A curious developer who pokes for 5 minutes finds at least one of these. Trust drops. They never come back.

### 3. The screenshot doesn't punch you in the face

`README.md:33-43`'s top-view leads with `TURNS BILLED_IN CACHE% AGE`. Tokens are abstract; cache% only matters once you already care; the AGE column is neutral. There's **no `$` column**, no "burning at $X/min," no "cache just collapsed 47% of the way through." The one image that has to sell the tool ships without the moment.

### 4. The killer feature is buried

The Context Composition view (`c` in inspect) directly answers `docs/concepts.md:33`'s stated thesis: *"the single biggest question vibe coders have is 'what's filling my context?' and current tools don't answer it well."* It's hidden behind a sub-keybinding inside a sub-mode of a sub-view. It should be the screenshot. It's not even *named* in the top of the README.

### 5. The wedge is too wide

Six adapters in the README, two actually work. "Wireshark + top for AI agents" implies all agents. The strongest path forward is to **own Claude Code first** and then expand — but the current framing forces a generic posture that nothing in the code yet delivers on.

## Where the gap actually is

This is not "build more features." The strongest features are buried, the loudest promises are vapor, and the pitch sells the wrong story. Re-stated:

- **Hook** → lead with money + context bloat, not Wireshark muscle memory.
- **Proof** → one screenshot that creates a "holy crap" moment in <5 seconds.
- **Trust** → cut every claim that isn't shipped; over-deliver on what is.
- **Scope** → own one user (Claude Code power users) before broadening.

## Options (ranked by leverage, not by sequence)

### Option A — ship a findings post (the highest-leverage move you haven't tried)

Before changing the tool at all, write **one** post titled something like *"5 surprising things I found tracing my own Claude Code sessions with agentshark"*. Concrete examples to mine from your own sessions tonight:

- *"X% of every Claude Code turn is `<system-reminder>` blocks the user never typed."*
- *"My average session burns $Y in cache writes during turns 1–3, before any work starts."*
- *"Tool Z's response is the single biggest context hog across every session I traced."*
- *"My cache hit rate cratered from 95% to 40% the moment my CLAUDE.md was edited mid-session."*
- *"Sub-agent spawns silently cost N× because the orchestrator re-sends the tool definitions."*

Each finding gets one screenshot from agentshark showing the thing. The tool becomes the *evidence*, not the headline. This is the move that responds to the one engaged commenter directly and converts the next launch into a different category of post.

Cost: a few hours of session-mining + writing. No code changes. Highest expected return per hour spent.

### Option B — credibility + positioning fixes on the README (≈ 1 day)

If/when you re-launch, make these changes first or the trust gap will surface again:

- **Rewrite the README hook.** Replace the Wireshark line with something user-facing: *"See exactly what's eating your Claude Code context — and what it's costing you."* Lead with the **Context Composition** screenshot, not the flat session list.
- **Add `$` cost everywhere.** `$0.42` next to `686.1K` tokens. Per-event, per-turn, per-session. The attribution code in `src/extract/events.ts:207-238` already partitions tokens by cache tier — multiply each tier by its published rate. Single biggest "oh shit" moment in the product.
- **Cut vapor.** Delete "multi-agent topologies as a tree" from `README.md:22` (or mark `(planned)`). Either implement the redaction confirmation dialog (~30 lines: render the redaction diff before the `pack.ts` write) or rewrite the privacy section to match the code. Mark `cursor`, `copilot-cli`, `gemini-cli`, `claude-cowork` honestly as ⚠️ partial / discovery-only in the status table.
- **Reshoot the screenshots** against a real, ugly session — high cache-miss rate, a big system_reminder pile, a tool call that exploded the context. Synthetic-looking screenshots ("update the readme …") read as toy projects.

### Option C — one wow feature (≈ a week)

If positioning is fixed and the next launch still doesn't land, the highest-leverage feature additions, in order of "would someone tweet about it":

- **Cache-miss diagnosis.** When a turn's cache hit rate drops, name the cause: *"Turn 23 invalidated 78K cached tokens because `~/.claude/CLAUDE.md` changed at offset 12,840. Cost delta: +$0.31."* No other tool does this; it maps directly onto your cache-aware attribution algorithm. This is the *single* feature most likely to produce a viral screenshot.
- **Top-N context hogs.** A first-class view answering "what is filling my context *right now*?" — `(1) Read /large.log → 24K, (2) Bash tool def → 9K, (3) system reminder accumulating → 7.2K …`. Most of this is already computed in `src/extract/contextComposition.ts`; promote it from a sub-view to a 1-key answer.
- **`agentshark report`.** One command, one self-contained HTML file. Shareable in a GitHub issue without the recipient installing anything. Solves the friction the `.aspark` format does not — and it's also the natural format for the Option A findings post.
- **Slow-tool / retry detector.** Flag tools >5s, tools retried in a turn. Critical for MCP server authors — the user segment most likely to evangelise.

### Option D — strategic re-frame (≈ a quarter)

- **Pick a wedge user explicitly.** Either (a) MCP server authors — the de facto MCP debugger, or (b) Claude Code cost-anxious power users — *"`/cost` on steroids."* The two are not the same product. Picking will sharpen every decision downstream.
- **Ship inside Claude Code as a skill / slash command** so users don't `npm install` anything. `/agentshark` → a report. Zero-friction distribution beats any TUI polish.
- **Finish one adapter beyond Claude Code or remove it.** Codex is the obvious pick (already most complete at 579 lines). The other three should leave the README until they actually work.

## Critical files this review touched

- `README.md:22, 33-43, 65-72, 81-87` — pitch, top-view screenshot, privacy claims, adapter status
- `docs/design.md:200, 307` — admits-but-doesn't-ship redaction confirmation and multi-agent tree
- `src/export/pack.ts:36-43` — silent export; privacy invariant violation
- `src/adapters/cursor.ts:73-84`, `src/adapters/copilotCli.ts:62-74` — stub `summarizeSession` returns
- `src/ui/TopView.tsx:38-52` — column set with no `$`
- `src/extract/contextComposition.ts` + `src/ui/ContextView.tsx` — the buried headline feature
- `src/extract/events.ts:207-238` — cache-tier partition (already there for `$` math)
- `src/ui/HelpView.tsx` + `docs/guide.md` + `src/cli.ts` meow string — required sync targets per `CLAUDE.md` if any keys / columns / commands change

## How to verify any of these actually move the needle

Same test regardless of which option you pick:

1. **5-second test.** Show one screenshot (or the first paragraph of the findings post) to three Claude Code users with no context. Ask *"what does this tell you?"* If they say "what my context / cost is doing" or name a specific finding, ship. If they say "Wireshark thing for agents" or shrug, rework.
2. **Narrow re-launch first.** One specific Slack / Discord / single tweet — not a multi-channel blast. Cost of a flop is much lower; you get cleaner signal.
3. **Measure follow-up questions, not upvotes.** The one engaged commenter from the original launch is the model. *Did anyone ask a follow-up?* That's the only signal that matters at pre-alpha.
4. After any code change: `npm test` still passes; `HelpView.tsx` + `docs/guide.md` + `src/cli.ts` meow string updated per `CLAUDE.md` sync rules if any keys / columns / commands changed.

## My honest recommendation

Do Option A this week — no code changes. It addresses the exact question the one engaged commenter asked, and it changes the next launch from "here's a tool" to "here's something I found." Even if nothing else changes, the post-with-findings outperforms the post-with-feature-list. Then, depending on response, decide between B (polish for re-launch) and C (one wow feature). D is a fork in the road that should wait until you have one validated finding-and-feature pair from A+C.
