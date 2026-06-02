import { Box, Text } from 'ink';
import type { ContextComposition } from '../extract/contextComposition.js';

interface ContextViewProps {
  composition: ContextComposition;
}

function bar(pct: number, width = 22): string {
  const filled = Math.min(width, Math.max(0, Math.round(pct * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '?';
  return n.toLocaleString('en-US');
}

export function ContextView({ composition }: ContextViewProps) {
  if (!composition || composition.billedInput === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>Context Composition</Text>
        <Text color="gray" italic>no api_turn observed yet — pick a session with completed turns</Text>
      </Box>
    );
  }
  const { rows, largestBlocks, billedInput, modelMax, fillPct, model } = composition;
  const totalForBars = rows.reduce((a, r) => a + r.tokens, 0) || 1;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>Context Composition · {model || ''}</Text>
      <Text>Current input · {formatTokens(billedInput)} / {formatTokens(modelMax)} tokens · {(fillPct * 100).toFixed(0)}% of window</Text>
      <Text>{bar(fillPct, 40)}</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map(r => {
          const pct = r.tokens / totalForBars;
          return (
            <Box key={r.key}>
              <Text>  {r.label.padEnd(32)}</Text>
              <Text color="gray">{String(formatTokens(r.tokens)).padStart(10)}</Text>
              <Text> {bar(pct, 22)}</Text>
              <Text color="gray"> {(pct * 100).toFixed(0).padStart(3)}%</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow" bold>Largest single blocks</Text>
        {largestBlocks.length === 0
          ? <Text color="gray" italic>(no oversized blocks)</Text>
          : largestBlocks.map((b, i) => (
            <Box key={i}>
              <Text>  ▸ {(b.detail || '').padEnd(50)}</Text>
              <Text color="gray">{String(formatTokens(b.tokens)).padStart(10)} tok</Text>
            </Box>
          ))}
      </Box>
    </Box>
  );
}
