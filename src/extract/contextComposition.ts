import type { AgentEvent } from '../schema/event.js';

interface CompositionRow {
  key: string;
  label: string;
  tokens: number;
}

interface LargestBlock {
  tokens: number;
  type: string;
  subtype?: string;
  detail: string;
}

export interface ContextComposition {
  rows: CompositionRow[];
  largestBlocks: LargestBlock[];
  billedInput: number;
  modelMax: number;
  fillPct: number;
  model: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  system_overhead: 'System prompt + tool defs + memory',
  message_user: 'User messages',
  message_assistant: 'Assistant messages',
  message_system: 'System messages',
  file_read: 'File reads',
  file_write: 'File writes',
  bash: 'Bash outputs',
  search: 'Search results',
  web: 'Web fetches',
  mcp_request: 'MCP requests',
  mcp_response: 'MCP responses',
  tool_result: 'Tool results (misc)',
  tool_other: 'Tool calls (misc)',
  subagent: 'Sub-agent spawns',
  system_reminder: 'System reminders (auto-injected)',
  skill: 'Loaded skills / commands',
  cache: 'Cache events',
  api_turn: 'Turn markers',
};

const MODEL_MAX: Record<string, number> = {
  'claude-3-haiku': 200_000,
  'claude-3-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4': 200_000,
};

export function computeContextComposition(events: AgentEvent[]): ContextComposition {
  let lastTurn: AgentEvent | null = null;
  let lastTurnIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'api_turn' && events[i].turnUsage) {
      lastTurn = events[i];
      lastTurnIdx = i;
      break;
    }
  }

  const inputEvents = lastTurnIdx >= 0 ? events.slice(0, lastTurnIdx) : events;

  const byCategory: Record<string, number> = {};
  const largestBlocks: LargestBlock[] = [];
  for (const e of inputEvents) {
    const cat = e.category || 'tool_other';
    if (cat === 'cache' || cat === 'api_turn') continue;
    byCategory[cat] = (byCategory[cat] || 0) + (e.tokensIn || 0);
    if ((e.tokensIn ?? 0) > 200) {
      largestBlocks.push({ tokens: e.tokensIn!, type: e.type, subtype: e.subtype, detail: e.detail });
    }
  }
  const totalVisible = Object.values(byCategory).reduce((a, b) => a + b, 0);

  let billedInput = 0;
  let systemOverhead = 0;
  if (lastTurn?.turnUsage) {
    const u = lastTurn.turnUsage as Record<string, number>;
    billedInput = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    systemOverhead = Math.max(0, billedInput - totalVisible);
  }

  const modelMax = Object.entries(MODEL_MAX).find(([k]) => lastTurn?.model?.includes(k))?.[1] ?? 200_000;

  const rows: CompositionRow[] = [];
  if (systemOverhead > 0) {
    rows.push({ key: 'system_overhead', label: CATEGORY_LABELS.system_overhead, tokens: systemOverhead });
  }
  for (const [key, tokens] of Object.entries(byCategory)) {
    if (tokens <= 0) continue;
    rows.push({ key, label: CATEGORY_LABELS[key] || key, tokens });
  }
  rows.sort((a, b) => b.tokens - a.tokens);
  largestBlocks.sort((a, b) => b.tokens - a.tokens);

  return {
    rows,
    largestBlocks: largestBlocks.slice(0, 10),
    billedInput,
    modelMax,
    fillPct: modelMax > 0 ? billedInput / modelMax : 0,
    model: lastTurn?.model ?? null,
  };
}
