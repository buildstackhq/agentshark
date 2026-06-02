import type { SessionRef } from '../adapters/types.js';

const sessions = new Map<string, SessionRef>();

export function upsertSession(ref: SessionRef): void {
  sessions.set(ref.id, ref);
}

export function removeSession(id: string): void {
  sessions.delete(id);
}

export function getSession(id: string): SessionRef | undefined {
  return sessions.get(id);
}

export function listSessions(): SessionRef[] {
  return [...sessions.values()].sort((a, b) => +b.lastActivity - +a.lastActivity);
}

export function clear(): void {
  sessions.clear();
}
