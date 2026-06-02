import { Box, Text } from 'ink';
import type { EnrichedSession } from '../adapters/types.js';

interface TopViewProps {
  rows: EnrichedSession[];
  selectedIndex: number;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function shortModel(m: string | null | undefined): string {
  if (!m) return '—';
  const s = m.replace(/^claude-/, '');
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}

function ago(date: Date | string | null | undefined): string {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function TopView({ rows, selectedIndex }: TopViewProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">  AGENT          MODEL          PROJECT          TURNS  BILLED_IN   CACHE%  AGE</Text>
      </Box>
      {rows.length === 0
        ? <Text color="gray" italic>  no sessions detected yet — open Claude Code in another terminal</Text>
        : rows.map((r, i) => {
          const sel = i === selectedIndex;
          return (
            <Box key={r.id}>
              <Text color={sel ? 'cyan' : 'gray'}>{sel ? '▶' : ' '} {String(r.source).padEnd(14)}</Text>
              <Text color="gray">{shortModel(r.model).padEnd(15)}</Text>
              <Text>{String(r.projectLabel || '').padEnd(16)}</Text>
              <Text color="gray">{String(r.turns ?? 0).padStart(5)}</Text>
              <Text>  {String(formatTokens(r.billedInput)).padStart(8)}</Text>
              <Text color="green">  {String(((r.cacheReadPct || 0) * 100).toFixed(0) + '%').padStart(5)}</Text>
              <Text color="gray">  {ago(r.lastActivity).padStart(4)}</Text>
            </Box>
          );
        })}
      {rows.length > 0 && (
        <Box marginTop={1} paddingLeft={2}>
          <Text color="gray">tip  </Text>
          <Text color="cyan" bold>e</Text>
          <Text color="gray"> — export any session to a shareable .aspark file (tool calls · context · token usage · secrets auto-redacted)</Text>
        </Box>
      )}
    </Box>
  );
}
