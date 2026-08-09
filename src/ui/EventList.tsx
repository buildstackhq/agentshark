import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../schema/event.js';
import type { SortMode } from './sortMode.js';

interface EventListProps {
  events: AgentEvent[];
  selectedIndex: number;
  height: number;
  originalIndices?: number[];
  sortMode?: SortMode;
}

function formatTokens(n: number | undefined | null): string {
  if (n == null) return '';
  if (n === 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function computePcts(events: AgentEvent[]): Map<string, string> {
  const total = events.reduce((s, e) => s + (e.tokensIn ?? 0), 0);
  const result = new Map<string, string>();
  if (total === 0) return result;

  const raw = events.map(e => {
    const n = e.tokensIn ?? 0;
    const exact = (n / total) * 1000;
    return { spanId: e.spanId, n, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  const sumFloors = raw.reduce((s, r) => s + r.floor, 0);
  const leftover = 1000 - sumFloors;
  const bumped = new Set(
    [...raw].sort((a, b) => b.remainder - a.remainder).slice(0, leftover).map(r => r.spanId)
  );

  for (const r of raw) {
    if (r.n === 0) { result.set(r.spanId, ''); continue; }
    const tenths = r.floor + (bumped.has(r.spanId) ? 1 : 0);
    result.set(r.spanId, (tenths / 10).toFixed(1) + '%');
  }
  return result;
}

function timeOf(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch { return ''; }
}

type InkColor = 'yellow' | 'green' | 'magenta' | 'cyan' | 'red' | 'blueBright' | 'magentaBright' | 'gray' | 'white' | 'greenBright';

function typeColor(type: string): InkColor {
  switch (type) {
    case 'tool_call': return 'yellow';
    case 'tool_result': return 'green';
    case 'mcp': return 'magenta';
    case 'hook': return 'cyan';
    case 'system_reminder': return 'red';
    case 'skill': return 'blueBright';
    case 'subagent': return 'magentaBright';
    case 'api_turn': return 'gray';
    case 'cache': return 'gray';
    case 'message': return 'white';
    default: return 'white';
  }
}

function cacheBadge(event: AgentEvent): 'H' | 'W' | ' ' {
  // Prefer the per-event cacheState set during extraction (Gap 3); fall back
  // to the legacy turn-level derivation for backwards compatibility with old
  // fixtures / replays whose events predate the cacheState field.
  if (event.cacheState === 'hit') return 'H';
  if (event.cacheState === 'write') return 'W';
  if (event.cacheState === 'none') return ' ';
  if (event.type === 'cache' && event.subtype === 'hit') return 'H';
  if (event.type === 'cache' && event.subtype === 'write') return 'W';
  return ' ';
}

export function EventList({ events, selectedIndex, height, originalIndices, sortMode }: EventListProps) {
  const usableHeight = Math.max(5, (height || 20) - 2);
  const half = Math.floor(usableHeight / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = Math.min(events.length, start + usableHeight);
  if (end - start < usableHeight) start = Math.max(0, end - usableHeight);
  const view = events.slice(start, end);
  const pcts = React.useMemo(() => computePcts(events), [events]);

  const stepArrow = sortMode === 'step-asc' ? '↑' : sortMode === 'step-desc' ? '↓' : '';
  const tokArrow = sortMode === 'tok-desc' ? '↓' : sortMode === 'tok-asc' ? '↑' : '';
  const stepLabel = `step${stepArrow}`.padEnd(7);
  const tokLabel = `TOK${tokArrow}`.padEnd(7);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray"> {stepLabel}TIME      TYPE          SUBTYPE       {tokLabel}%TOK   DETAIL</Text>
      </Box>
      <Box>
        <Text color="gray">{''.padStart(43)}</Text>
        <Text color="yellow">W</Text><Text color="gray">=write · </Text>
        <Text color="greenBright">H</Text><Text color="gray">=hit</Text>
      </Box>
      {view.map((ev, i) => {
        const idx = start + i;
        const displayIdx = originalIndices ? (originalIndices[idx] ?? idx) : idx;
        const sel = idx === selectedIndex;
        const color = typeColor(ev.type);
        const tok = formatTokens(ev.tokensIn);
        const badge = cacheBadge(ev);
        const pct = pcts.get(ev.spanId) ?? '';
        return (
          <Box key={ev.spanId}>
            <Text color={sel ? 'cyan' : 'gray'}>{sel ? '▶' : ' '} {String(displayIdx).padStart(4)}</Text>
            <Text color="gray"> {timeOf(ev.ts).padEnd(8)}</Text>
            <Text color={color}> {String(ev.type).padEnd(13)}</Text>
            <Text color="gray">{String(ev.subtype || '').padEnd(12)}</Text>
            <Text color={badge === 'H' ? 'greenBright' : badge === 'W' ? 'yellow' : 'white'}> {badge} {tok.padStart(5)}</Text>
            <Text color="gray"> {pct.padStart(6)}</Text>
            <Text> {ev.detail || ''}</Text>
          </Box>
        );
      })}
      {events.length === 0 && <Text color="gray" italic>  (no events match)</Text>}
    </Box>
  );
}
