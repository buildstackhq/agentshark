import { Box, Text } from 'ink';
import type { SessionRef, SessionSummary } from '../adapters/types.js';

interface HeaderProps {
  session: SessionRef | null;
  summary: SessionSummary | null;
  mode: string;
  paused: boolean;
  view: string;
  subagentNote?: string;
  replayFile?: string;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function Header({ session, summary, mode, paused, view, subagentNote, replayFile }: HeaderProps) {
  const ctxStr = summary?.lastUsage
    ? `${formatTokens(summary.billedInput / Math.max(1, summary.assistantTurns))} avg · last billed=${formatTokens(
        (summary.lastUsage.input_tokens || 0) +
        (summary.lastUsage.cache_creation_input_tokens || 0) +
        (summary.lastUsage.cache_read_input_tokens || 0)
      )}`
    : '';
  const cachePct = summary?.cacheReadPct ? `${(summary.cacheReadPct * 100).toFixed(0)}%` : '?';
  const isChildNote = subagentNote?.includes('sub-agent of');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>agentshark · {view}</Text>
        <Text color="gray">{mode}{paused ? ' (paused)' : ''}</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text>{session?.projectLabel || '—'}</Text>
        <Text color="gray">{summary?.lastModel || '—'}</Text>
        <Text color="gray">turns: {summary?.assistantTurns ?? 0}</Text>
        <Text color="gray">{ctxStr}</Text>
        <Text color="green">cache: {cachePct}</Text>
        {subagentNote && (
          <Text color={isChildNote ? 'magenta' : 'cyan'} bold>{subagentNote}</Text>
        )}
      </Box>
      {replayFile && (
        <Box>
          <Text>
            <Text color="gray">replay: </Text>
            {replayFile}
          </Text>
        </Box>
      )}
    </Box>
  );
}
