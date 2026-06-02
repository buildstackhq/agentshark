import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface FilterBarProps {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  matched: number;
  total: number;
}

export function FilterBar({ editing, value, onChange, onSubmit, matched, total }: FilterBarProps) {
  return (
    <Box flexDirection="row" gap={2}>
      <Text color={editing ? 'cyanBright' : 'gray'}>Filter:</Text>
      {editing
        ? <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="type:mcp OR tokens > 500" />
        : <Text color="white">{value || '<all>'}</Text>}
      <Text color="gray">  matched {matched} / {total}</Text>
    </Box>
  );
}
