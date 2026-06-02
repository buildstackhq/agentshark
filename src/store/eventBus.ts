import type { AgentEvent } from '../schema/event.js';

type Listener = (event: AgentEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(event: AgentEvent): void {
  listeners.forEach(fn => fn(event));
}
