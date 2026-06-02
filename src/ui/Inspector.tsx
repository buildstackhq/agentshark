import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../schema/event.js';

interface InspectorProps {
  event: AgentEvent | undefined;
}

function pretty(obj: unknown, max = 4000): string {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (!s) return '';
    if (s.length > max) return s.slice(0, max) + '\n... [truncated]';
    return s;
  } catch {
    return '[unserializable]';
  }
}

export function Inspector({ event }: InspectorProps) {
  const body = React.useMemo(() => pretty(event?.payload), [event]);
  if (!event) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray" italic>select an event to inspect</Text>
      </Box>
    );
  }
  const tagsLine = event.tags
    ? Object.entries(event.tags).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>INSPECTOR · {event.type}{event.subtype ? '/' + event.subtype : ''}</Text>
      <Box flexDirection="row" gap={2}>
        <Text color="gray">ts {event.ts}</Text>
        <Text color="gray">tokensIn {event.tokensIn ?? 0}</Text>
        {event.model ? <Text color="gray">model {event.model}</Text> : null}
      </Box>
      {tagsLine ? <Text color="yellow">tags: {tagsLine}</Text> : null}
      <Text color="gray">payload:</Text>
      <Text>{body}</Text>
    </Box>
  );
}
