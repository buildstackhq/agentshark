import { Box, Text } from 'ink';
import { ADAPTERS } from '../adapters/index.js';
import { sessionRegistry } from '../store/sessionRegistry.js';
import type { EnrichedSession } from '../adapters/types.js';

interface TopViewProps {
  rows: EnrichedSession[];
  selectedIndex: number;
}

function adapterHasSummary(source: string): boolean {
  const a = ADAPTERS.find(x => x.NAME === source);
  return a?.CAPABILITIES.has('summary') ?? true;
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

const AGENT_COL = 17;

export function TopView({ rows, selectedIndex }: TopViewProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">    AGENT             MODEL          PROJECT              TURNS  BILLED_IN   CACHE%  AGE</Text>
      </Box>
      {rows.length === 0
        ? <Text color="gray" italic>  no sessions detected yet — open Claude Code in another terminal</Text>
        : rows.map((r, i) => {
          const sel = i === selectedIndex;
          // Discovery-only adapters report 0 for turns / billed / cache. Render
          // "—" so empty cells read as "unsupported" rather than "broken".
          const hasSummary = adapterHasSummary(r.source);
          const turnsCell = hasSummary ? String(r.turns ?? 0) : '—';
          const billedCell = hasSummary ? formatTokens(r.billedInput) : '—';
          const cacheCell = hasSummary ? ((r.cacheReadPct || 0) * 100).toFixed(0) + '%' : '—';
          // Sub-agent linkage indicators (Gap 6).
          const isChild = Boolean(r.parentSessionId);
          const childCount = sessionRegistry.childrenOf(r.id).length;
          const hasChildren = childCount > 0;
          // Color-independent linkage indicators: `+N` count badge on parent rows,
          // `└─` tree prefix on children. No `→` arrows — children are reached
          // via normal navigation (`↑↓ ⏎`) once `s` reveals them.
          const linkGlyph = isChild ? '↳' : ' ';
          const agentText = isChild
            ? `└─ ${r.source}`.padEnd(AGENT_COL)
            : hasChildren
              ? `${r.source} +${childCount}`.padEnd(AGENT_COL)
              : r.source.padEnd(AGENT_COL);
          // Selection must always change the row's color — previously `sel`
          // only applied in the fallback branch, so selecting a child row or a
          // parent-with-children row produced no visible change beyond the
          // small `▶` glyph.
          const agentColor = sel ? 'cyan' : isChild ? 'magenta' : hasChildren ? 'cyan' : 'gray';
          return (
            <Box key={r.id}>
              <Text color={sel ? 'cyan' : 'gray'}>{sel ? '▶' : ' '} </Text>
              <Text color={isChild ? 'magenta' : 'gray'}>{linkGlyph} </Text>
              <Text color={agentColor}>{agentText}</Text>
              <Text color="gray">{shortModel(r.model).padEnd(15)}</Text>
              <Text>{String(r.projectLabel || '').padEnd(20)}</Text>
              <Text color="gray">{turnsCell.padStart(5)}</Text>
              <Text>  {billedCell.padStart(8)}</Text>
              <Text color={hasSummary ? 'green' : 'gray'}>  {cacheCell.padStart(5)}</Text>
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
