import { Box, Text } from 'ink';

interface HelpViewProps {
  mode: 'top' | 'events';
}

export function HelpView({ mode }: HelpViewProps) {
  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {mode === 'top' ? <TopHelp /> : <EventsHelp />}
      <Box marginTop={1}>
        <Text color="gray">press h to close</Text>
      </Box>
    </Box>
  );
}

function TopHelp() {
  return (
    <>
      <Text bold color="white">COLUMNS</Text>
      <Row label="AGENT    " desc="source adapter (claude-code, codex); `+N` suffix = this row spawned N sub-agents (press `s` to reveal them as `└─` rows directly beneath)" />
      <Row label="MODEL    " desc='last model used; "claude-" prefix stripped' />
      <Row label="PROJECT  " desc="project directory name" />
      <Row label="TURNS    " desc="number of assistant turns in session" />
      <Row label="BILLED_IN" desc="total billed input tokens (fresh + cache writes + cache reads)" />
      <Row label="CACHE%   " desc="cache_read_tokens ÷ billed_input — higher means cheaper repeated context" />
      <Row label="AGE      " desc="time since last activity (s=seconds m=minutes h=hours d=days)" />
      <Box marginTop={1}>
        <Text bold color="white">KEYS</Text>
      </Box>
      <Row label="↑ ↓     " desc="navigate session list" />
      <Row label="⏎       " desc="inspect selected session" />
      <Row label="s       " desc="show / hide sub-agent rows in this list (default: hidden)" />
      <Row label="e       " desc="prepare export — shows redaction diff before any file is written" />
      <Row label="y / n   " desc="confirm / abort the export (only shown after pressing e)" />
      <Row label="r       " desc="pause / resume auto-refresh" />
      <Row label="h       " desc="toggle this help" />
      <Row label="q       " desc="quit" />
    </>
  );
}

function EventsHelp() {
  return (
    <>
      <Text bold color="white">EVENT TYPES</Text>
      <Row label="tool_call      " desc="agent invoked a tool" />
      <Row label="tool_result    " desc="tool returned output" />
      <Row label="mcp            " desc="MCP server call" />
      <Row label="hook           " desc="Claude Code hook executed" />
      <Row label="skill          " desc="built-in skill invoked" />
      <Row label="subagent       " desc="spawned sub-agent turn" />
      <Row label="api_turn       " desc="raw API request/response turn" />
      <Row label="cache          " desc="prompt cache event (see badges below)" />
      <Row label="message        " desc="user or assistant message" />
      <Row label="system_reminder" desc="system reminder block injected into context" />
      <Row label="attachment     " desc="file or data attachment in context" />
      <Box marginTop={1}>
        <Text bold color="white">CACHE BADGES</Text>
      </Box>
      <Box>
        <Text color="yellow">  W</Text>
        <Text color="gray"> — cache write: tokens added to the prompt cache (costs ~25% more to write)</Text>
      </Box>
      <Box>
        <Text color="greenBright">  H</Text>
        <Text color="gray"> — cache hit:  tokens served from cache (~90% cheaper than fresh input)</Text>
      </Box>
      <Box>
        <Text color="gray">    blank  — non-cached input · filter `cache:none`</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold color="white">COLUMNS</Text>
      </Box>
      <Row label="TOK  " desc="input tokens for this event" />
      <Row label="%TOK " desc="this event's share of total session input tokens" />
      <Box marginTop={1}>
        <Text bold color="white">KEYS</Text>
      </Box>
      <Row label="↑ ↓      " desc="navigate events" />
      <Row label="PgUp PgDn" desc="page up / down" />
      <Row label="g / G    " desc="jump to top / bottom" />
      <Row label="i        " desc="toggle inspector panel" />
      <Row label="/        " desc="filter events" />
      <Row label="t        " desc="toggle tail / pause" />
      <Row label="c        " desc="toggle context composition view" />
      <Row label="s        " desc="cycle sort: step ↑ / step ↓ / tok ↓ / tok ↑" />
      <Row label=">        " desc="drill into a sub-agent of this session (repeat to cycle siblings)" />
      <Row label="<        " desc="pop back to parent session" />
      <Row label="h        " desc="toggle this help" />
      <Row label="q        " desc="back to session list" />
    </>
  );
}

function Row({ label, desc }: { label: string; desc: string }) {
  return (
    <Box>
      <Text color="cyan">  {label}</Text>
      <Text color="gray"> — {desc}</Text>
    </Box>
  );
}
