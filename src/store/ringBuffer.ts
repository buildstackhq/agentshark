import type { AgentEvent } from '../schema/event.js';

export interface RingBuffer {
  push(item: AgentEvent): void;
  readonly all: AgentEvent[];
  byTraceId(id: string): AgentEvent[];
  bySessionId(id: string): AgentEvent[];
  clear(): void;
}

export function createRingBuffer(maxSize = 10_000): RingBuffer {
  const buf: AgentEvent[] = [];
  return {
    push(item) {
      buf.push(item);
      if (buf.length > maxSize) buf.shift();
    },
    get all() { return buf; },
    byTraceId(id) { return buf.filter(e => e.traceId === id); },
    bySessionId(id) { return buf.filter(e => e.traceId === id); },
    clear() { buf.length = 0; },
  };
}
