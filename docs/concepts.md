# concepts.md — how AI agents actually work

Audience: a software / cloud engineer who can read Go and TypeScript fluently but has not built much on top of LLMs and wants the mental model from first principles before reading the rest of the agentshark docs.

This doc explains the moving parts inside an "AI agent" using analogies from systems work you already know. By the end you should be able to read `scripts/attribution-prototype.ts` and understand exactly what it is doing.

---

## 1. The model is a stateless function

A large language model (LLM) like Claude or GPT is, from the outside, a **stateless function**:

```
generate(messages, tools, system_prompt) → assistant_message + usage_stats
```

That's it. No memory between calls. No persistent connection. No state. It's an HTTP request to `api.anthropic.com/v1/messages` (or OpenAI equivalent), and you get a JSON response.

This is the most important thing to internalise. Everything else — "the agent remembered what I said earlier", "the agent ran a tool", "the agent paused and resumed" — is **fiction built by client code outside the model**. The model itself sees only what's in `messages` on this one call.

---

## 2. The context window is the working set

The model has a maximum number of tokens it can read in a single call. For Claude Sonnet 4.6 that's 200,000. For GPT-5 it's higher. This number is the **context window**.

`messages` + `tools` + `system_prompt` are tokenized and fed to the model. If they exceed the context window, the API errors out.

Think of it as a fixed-size buffer that everything visible to the model must fit into. Compare:
- CPU L1 cache size — it's the working set the model can "see" at once.
- An HTTP request body limit — everything you want the server to process has to fit.

This is the resource agentshark is built to make visible. The single biggest question vibe coders have is "what's filling my context?" and current tools don't answer it well.

---

## 3. A token is a word-ish chunk

Tokens are how the model counts text. Roughly:
- 1 token ≈ 3-4 characters of English
- 1000 tokens ≈ 750 words
- Code is denser (more tokens per visible character) because punctuation and identifiers split a lot

You're billed per token (input and output, at different rates) and the context window is measured in tokens. Tokenization is deterministic — given the same text and the same model family, you'll always get the same token count. There's a public tokenizer (`@anthropic-ai/tokenizer` for Claude, `tiktoken` for OpenAI) that produces these counts client-side.

---

## 4. A "turn" is one HTTP call

When you watch Claude Code think and run tools, you're seeing many model calls under the hood. Each call:

1. Client assembles the prompt: `[system_prompt, tool_defs, message_1, message_2, ..., message_N]`.
2. Client POSTs to the API.
3. Model returns an assistant message. That message can have several **content blocks**:
   - `text` — words for the user
   - `thinking` — extended reasoning (Claude only)
   - `tool_use` — "please call this tool with these arguments"
4. If the response contains `tool_use` blocks, the client executes the tools locally, packages results into new `tool_result` content blocks, appends them to the messages list, and goes back to step 1.

We call each of these calls a **turn**. A single user question might trigger 20+ turns: model asks for a file read, client runs `cat`, sends results back, model asks for another file, etc. The model alone never executes anything — it just emits requests that the client honours.

In Claude Code's local transcripts (`~/.claude/projects/.../<uuid>.jsonl`) each turn is identified by a `requestId`. The JSONL may contain several lines per turn because each content block gets its own line.

---

## 5. Tools are JSON-schemed function calls

A "tool" is just a JSON schema you hand to the model with the prompt:
```json
{
  "name": "read_file",
  "description": "Read a file from disk",
  "input_schema": {
    "type": "object",
    "properties": { "path": { "type": "string" } },
    "required": ["path"]
  }
}
```

The model emits `tool_use { name: "read_file", input: { path: "/etc/hosts" } }`. The client matches `name` to a local function, calls it, captures the output, and sends it back. The model has no idea whether your tool ran a Python function or hit a microservice — it sees a structured request and a structured response.

Tools are how an agent does anything beyond emit text: read files, run shell commands, query a database, call your internal API. Every action is a tool call.

---

## 6. MCP — Model Context Protocol

MCP is to tools what HTTP is to web services: a protocol for connecting a tool ecosystem to any model client.

Without MCP, every agent (Claude Code, Cursor, Codex) implements its own tool registry — there's no portability. MCP standardises the connection:

```
[Agent client] ←── MCP wire (stdio / SSE / WS) ──→ [MCP server]
                                                   ├── lists tools
                                                   ├── handles tool calls
                                                   └── streams results
```

An MCP server is a process you run that exposes one or more tools. It speaks JSON-RPC over stdin/stdout (the most common transport). The agent client discovers the server's tools at startup, merges them into its tool registry, and routes any matching tool call to the server over the wire.

In the JSONL transcripts, tool calls that came from MCP servers have names like `mcp__gmail__list_messages`. Decoding gives you `server=gmail`, `tool=list_messages`. agentshark uses this convention to tag MCP events distinctly.

You can think of an MCP server as analogous to a sidecar process exposing a structured API to the main agent process.

---

## 7. Hooks — client-side event interception

A hook is a shell command the agent runs at a specific lifecycle point. Claude Code's hook system lets you, for example:
- Block any `bash` tool call that contains `rm -rf` (`PreToolUse`)
- Log every prompt submission to a file (`UserPromptSubmit`)
- Append a CI status to the conversation after every assistant turn (`Stop`)

Hooks fire **client-side**, not in the model. They have full read/write access to the prompt and tool calls before they're sent or executed. They are the agent equivalent of HTTP middleware.

agentshark detects hook events from `hookEvent` entries in the JSONL. Each fire is its own event with metadata (which hook fired, exit code, what it modified).

---

## 8. Sub-agents — orchestration

Sub-agents are nested model calls. One agent (the "orchestrator") emits a `tool_use` of type `Agent` (or similar), and the client spins up a fresh model invocation with its own prompt, tools, and message history. The sub-agent runs to completion, returns a final summary, and that summary becomes the `tool_result` in the parent's conversation.

Why this matters:
- The sub-agent has its OWN context window. Spawning one is how you scale beyond a single 200K window — the orchestrator only ever sees the summary, not the sub-agent's full transcript.
- Sub-agents can be cheaper models (Haiku) doing grunt work while the orchestrator (Opus) plans.
- Sub-agents preserve **trace topology** — there's a parent-child relationship you need to render in the UI.

In production agent frameworks (LangGraph, CrewAI, AutoGen, Anthropic Agent SDK), this is the norm — a "multi-agent system" is a tree of model calls. agentshark renders that tree natively in `top`.

---

## 9. Prompt caching — the cost story

For Anthropic specifically, **prompt caching** is critical. You can mark portions of the prompt with `cache_control: { type: "ephemeral" }`. The API server hashes that portion, caches it for ~5 minutes (or 1 hour with a different marker), and on the next call within the TTL it bills you a fraction of the original cost for the same content.

The `usage` object the API returns has three input-token fields that, summed, equal the total tokens read:
- `input_tokens` — non-cached input (billed at full price)
- `cache_creation_input_tokens` — newly cached content (billed at full price + a small premium)
- `cache_read_input_tokens` — content retrieved from cache (billed at ~10% of full price)

A well-architected agent might have a 95%+ cache hit rate by turn 3 because the system prompt + tool defs + conversation history don't change between turns — only the latest user/assistant pair gets appended. Bad cache structure can blow your bill by 10×.

This is why agentshark's attribution algorithm has to be **cache-aware**: you can't just tokenize content and multiply by a price — you have to know whether each block was read from cache, freshly cached, or sent uncached.

---

## 10. System reminders — the invisible context

Claude Code injects content blocks into the conversation that the user never typed, marked with `<system-reminder>...</system-reminder>` tags. Examples:

- "The task tools haven't been used recently. Consider using TaskCreate..."
- "Plan mode still active..."
- "The user's CLAUDE.md is shown below."

These accumulate over a session. Each is small (200-2000 tokens) but they compound. They're a big reason why a session that "shouldn't have grown much" silently inflates by 10-20K tokens over a few dozen turns.

agentshark surfaces these as their own event type so you can see exactly when and how much they're costing you.

---

## 11. Skills — late-bound capability bundles

A "skill" in Claude Code is a markdown file + an `allowedTools` list, loaded into the prompt only when triggered. They're a way to keep the base tool registry small while letting the user invoke specialised behaviours.

When you type `/init` or `/security-review`, the matching skill's content is injected as a `<command-name>` block. From the model's perspective, the skill's text is now part of the prompt for this turn forward.

agentshark detects skill loads from those tags in the JSONL.

---

## 12. Putting it together — a single turn's lifecycle

```
USER types "fix the failing test"
   │
   ▼
PRE-USER-PROMPT-SUBMIT HOOK fires (maybe rewrites the prompt)
   │
   ▼
CLAUDE CODE builds the API request:
   system_prompt + CLAUDE.md memory + tool defs + conversation history
   + system reminders + new user message
   │
   ▼
HTTP POST → api.anthropic.com/v1/messages
   │
   ▼
API responds with assistant content:
   [thinking, tool_use(Read), tool_use(Bash)]
   + usage { input, cache_create, cache_read, output }
   │
   ▼
CLAUDE CODE writes one JSONL line per content block, all with same requestId
   │
   ▼
PRE-TOOL-USE HOOK fires for each tool_use (maybe blocks)
   │
   ▼
Tools execute → tool_result blocks written
   │
   ▼
POST-TOOL-USE HOOK fires
   │
   ▼
LOOP: back to "build the API request" with the new turn appended
   │
   ▼
When model emits stop_reason=end_turn, the cycle pauses
   │
   ▼
STOP HOOK fires (maybe re-injects work)
```

agentshark captures this whole cycle. Every arrow above produces one or more events in the event stream.

---

## 13. Glossary

| Term | Meaning |
|------|---------|
| **Agent** | A program that drives an LLM in a loop with tools, hooks, and possibly sub-agents. |
| **Context window** | Maximum tokens the model can see in a single call. |
| **Token** | The model's unit of input/output measurement. ~3-4 chars in English. |
| **Turn** | One HTTP call to the model API. |
| **Content block** | A single piece inside an assistant message: text, thinking, tool_use, tool_result. |
| **Tool** | A JSON-schemed function the model can request. |
| **MCP** | Model Context Protocol — a standard for exposing tools to any agent client. |
| **MCP server** | A process exposing tools via the MCP protocol (usually stdio JSON-RPC). |
| **Hook** | A shell command run at a lifecycle event, client-side. Can read/write the prompt. |
| **Sub-agent** | A nested model call spawned by another agent. Own context window. |
| **Prompt caching** | API server-side caching of repeated prompt prefixes. Cuts cost dramatically. |
| **System reminder** | Auto-injected content block the user didn't type. |
| **Skill** | A markdown bundle loaded into the prompt on demand. |
| **`usage`** | Per-turn token accounting in the API response: input, cache_create, cache_read, output. |
| **`requestId`** | Anthropic API identifier tying multiple JSONL lines back to one turn. |
| **JSONL transcript** | One JSON object per line; how Claude Code records sessions locally. |
| **`.aspark`** | agentshark's portable, redacted trace file format. |

---

Next: read `docs/design.md` for how agentshark turns all of this into something inspectable.
