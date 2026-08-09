import React from 'react';
import { Box, Text } from 'ink';
import type { RedactionDiff } from '../export/pack.js';

interface RedactionConfirmProps {
  diff: RedactionDiff;
  outputPath: string;
  status?: string | null;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

export function RedactionConfirm({ diff, outputPath, status }: RedactionConfirmProps) {
  const counts = new Map<string, number>();
  for (const s of diff.samples) counts.set(s.pattern, (counts.get(s.pattern) ?? 0) + 1);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">Confirm export — redaction diff</Text>
      <Text color="gray">  output: {outputPath}</Text>
      <Text color="gray">  engine: {diff.engine}</Text>
      {diff.matchCount === 0 ? (
        <Text color="green">  no secret matches</Text>
      ) : (
        <>
          <Text color="white">  {diff.matchCount} match(es) across patterns [{diff.patternsApplied.join(', ')}]</Text>
          <Box marginTop={1} flexDirection="column">
            {[...counts.entries()].map(([pattern, count]) => {
              const sample = diff.samples.find(s => s.pattern === pattern);
              return (
                <Box key={pattern} flexDirection="column">
                  <Text>
                    <Text color="cyan">  {pad(pattern, 10)}</Text>
                    <Text color="white">{String(count).padStart(4)} match(es)</Text>
                  </Text>
                  {sample ? (
                    <Text color="gray">    …{sample.context.slice(0, 80)}…</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        </>
      )}
      <Box marginTop={1}>
        {status ? (
          <Text color="yellow">{status}</Text>
        ) : (
          <Text color="white">
            <Text bold color="greenBright">y</Text>
            <Text> write file · </Text>
            <Text bold color="redBright">n</Text>
            <Text>/Esc abort</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
