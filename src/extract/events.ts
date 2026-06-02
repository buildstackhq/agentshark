import { countTokens } from '@anthropic-ai/tokenizer';
import type { AgentEvent, EventType } from '../schema/event.js';
import type { SessionRef } from '../adapters/types.js';

// Re-export AgentEvent for convenience
export type { AgentEvent };

type ToolSubtype = 'file_read' | 'file_write' | 'bash' | 'search' | 'web' | 'subagent' | 'mcp' | 'tool_other';

function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name || !name.startsWith('mcp__')) return null;
  const parts = name.split('__');
  if (parts.length < 3) return { server: parts[1] || '', tool: '' };
  return { server: parts[1], tool: parts.slice(2).join('__') };
}

function classifyToolCall(name: string | undefined): ToolSubtype {
  if (!name) return 'tool_other';
  if (name === 'Read') return 'file_read';
  if (name === 'Write' || name === 'Edit') return 'file_write';
  if (name === 'Bash') return 'bash';
  if (name === 'Grep' || name === 'Glob') return 'search';
  if (name === 'Agent' || name === 'Task') return 'subagent';
  if (name === 'WebFetch' || name === 'WebSearch') return 'web';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'tool_other';
}

function stringifyToolInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try { return JSON.stringify(input); } catch { return String(input); }
}

function toolUseSignature(requestId: string | undefined, name: string | undefined, input: unknown): string {
  return `${requestId ?? ''}|${name ?? ''}|${stringifyToolInput(input)}`;
}

function containsSystemReminder(content: unknown): boolean {
  if (typeof content === 'string') return content.includes('<system-reminder>');
  if (!Array.isArray(content)) return false;
  return content.some((b: unknown) => typeof (b as { text?: string })?.text === 'string' && (b as { text: string }).text.includes('<system-reminder>'));
}

const _tokenCache = new Map<string, number>();
const TOKEN_CACHE_MAX = 50_000;

function tokensOf(text: string | undefined | null): number {
  if (!text) return 0;
  const hit = _tokenCache.get(text);
  if (hit !== undefined) return hit;
  try {
    const n = countTokens(text);
    if (_tokenCache.size >= TOKEN_CACHE_MAX) _tokenCache.clear();
    _tokenCache.set(text, n);
    return n;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function textOfMessage(msg: { content?: unknown }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const chunks: string[] = [];
  for (const b of msg.content as unknown[]) {
    const block = b as Record<string, unknown>;
    if (typeof b === 'string') { chunks.push(b); continue; }
    if (block.type === 'text' && block.text) chunks.push(block.text as string);
    else if (block.type === 'thinking' && block.thinking) chunks.push(block.thinking as string);
    else if (block.type === 'tool_use') {
      chunks.push((block.name as string) || '');
      try { chunks.push(JSON.stringify(block.input || {})); } catch {}
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') chunks.push(block.content);
      else if (Array.isArray(block.content)) {
        for (const c of block.content as unknown[]) {
          const cc = c as { type?: string; text?: string };
          if (cc?.type === 'text' && cc.text) chunks.push(cc.text);
        }
      }
    }
  }
  return chunks.join('\n');
}

function shortText(s: string | undefined | null, max = 80): string {
  if (!s) return '';
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + '…';
}

export function extractEvents(entries: unknown[], sessionRef: SessionRef): AgentEvent[] {
  const events: AgentEvent[] = [];
  const seenReqs = new Map<string, number>();
  const seenToolUses = new Set<string>();
  // Local counter — reset per call so spanIds are stable within a session load
  let localId = 0;
  const nextId = (prefix: string) => `${prefix}-${++localId}`;

  for (const raw of entries) {
    const e = raw as Record<string, unknown>;
    if (!e || !e.timestamp) continue;
    const baseCtx = {
      ts: e.timestamp as string,
      sessionLabel: `${sessionRef.source} · ${sessionRef.projectLabel}`,
      source: sessionRef.source,
      traceId: sessionRef.id,
      tags: {} as Record<string, string>,
    };

    if (e.type === 'user' && e.message) {
      const msg = e.message as { content?: unknown };
      const text = textOfMessage(msg);
      if (!text) continue;
      const isSystemReminder = containsSystemReminder(msg.content);

      if (Array.isArray(msg.content)) {
        for (const b of msg.content as unknown[]) {
          const block = b as Record<string, unknown>;
          if (block?.type === 'tool_result') {
            const t = textOfMessage({ content: [block] });
            events.push({
              ...baseCtx,
              spanId: nextId('evt'),
              type: 'tool_result' as EventType,
              subtype: block.is_error ? 'error' : 'success',
              tokensIn: tokensOf(t),
              detail: shortText(t),
              payload: { tool_use_id: block.tool_use_id, content: block.content },
              tags: { role: 'user' },
              category: 'tool_result',
              raw: e,
            });
          }
        }
      }

      if (isSystemReminder) {
        events.push({
          ...baseCtx,
          spanId: nextId('evt'),
          type: 'system_reminder' as EventType,
          subtype: 'injected',
          tokensIn: tokensOf(text),
          detail: shortText(text),
          payload: { text },
          tags: { role: 'user' },
          category: 'system_reminder',
          raw: e,
        });
      } else if (text.includes('<command-name>')) {
        const m = text.match(/<command-name>([^<]+)<\/command-name>/);
        events.push({
          ...baseCtx,
          spanId: nextId('evt'),
          type: 'skill' as EventType,
          subtype: 'loaded',
          tokensIn: tokensOf(text),
          detail: m ? m[1] : 'command',
          payload: { text },
          tags: { role: 'user' },
          category: 'skill',
          raw: e,
        });
      } else if (!e.isMeta) {
        events.push({
          ...baseCtx,
          spanId: nextId('evt'),
          type: 'message' as EventType,
          subtype: 'user',
          tokensIn: tokensOf(text),
          detail: shortText(text),
          payload: { text },
          tags: { role: 'user' },
          category: 'message_user',
          raw: e,
        });
      }
      continue;
    }

    if (e.type === 'assistant' && e.message) {
      const msg = e.message as Record<string, unknown>;
      const reqId = e.requestId as string | undefined;
      const usage = msg.usage as Record<string, number> | undefined;
      const firstSightingOfTurn = reqId && !seenReqs.has(reqId);

      if (firstSightingOfTurn) {
        seenReqs.set(reqId!, events.length);
        events.push({
          ...baseCtx,
          spanId: nextId('evt'),
          type: 'api_turn' as EventType,
          subtype: 'start',
          model: msg.model as string | undefined,
          tokensIn: 0,
          detail: `req ${reqId?.slice(0, 16) || '?'} · ${msg.model || ''}`,
          payload: { usage, requestId: reqId },
          tags: { req_id: reqId || '' },
          category: 'api_turn',
          raw: e,
          turnUsage: usage,
        });

        if (usage) {
          const cw = (usage.cache_creation_input_tokens as number) || 0;
          const cr = (usage.cache_read_input_tokens as number) || 0;
          if (cw > 0) {
            events.push({
              ...baseCtx,
              spanId: nextId('evt'),
              type: 'cache' as EventType,
              subtype: 'write',
              tokensIn: cw,
              detail: `+${cw} tokens cached`,
              payload: { usage },
              tags: {},
              category: 'cache',
              raw: e,
            });
          }
          if (cr > 0) {
            events.push({
              ...baseCtx,
              spanId: nextId('evt'),
              type: 'cache' as EventType,
              subtype: 'hit',
              tokensIn: cr,
              detail: `read ${cr} cached tokens`,
              payload: { usage },
              tags: {},
              category: 'cache',
              raw: e,
            });
          }
        }
      }

      if (Array.isArray(msg.content)) {
        for (const b of msg.content as unknown[]) {
          const block = b as Record<string, unknown>;
          if (block.type === 'thinking' && block.thinking) {
            events.push({
              ...baseCtx,
              spanId: nextId('evt'),
              type: 'message' as EventType,
              subtype: 'thinking',
              tokensIn: tokensOf(block.thinking as string),
              detail: shortText(block.thinking as string),
              payload: { text: block.thinking },
              tags: { role: 'assistant' },
              category: 'message_assistant',
              raw: e,
            });
          } else if (block.type === 'text' && block.text) {
            events.push({
              ...baseCtx,
              spanId: nextId('evt'),
              type: 'message' as EventType,
              subtype: 'assistant',
              tokensIn: tokensOf(block.text as string),
              detail: shortText(block.text as string),
              payload: { text: block.text },
              tags: { role: 'assistant' },
              category: 'message_assistant',
              raw: e,
            });
          } else if (block.type === 'tool_use') {
            const name = block.name as string | undefined;
            const mcp = name ? parseMcpToolName(name) : null;
            const inputStr = stringifyToolInput(block.input || {});
            const signature = toolUseSignature(reqId, name, block.input);
            if (seenToolUses.has(signature)) continue;
            seenToolUses.add(signature);
            const tok = tokensOf(`${name || ''}\n${inputStr}`);
            if (mcp) {
              events.push({
                ...baseCtx,
                spanId: nextId('evt'),
                type: 'mcp' as EventType,
                subtype: 'request',
                tokensIn: tok,
                detail: `${mcp.server}/${mcp.tool} ${shortText(inputStr, 40)}`,
                payload: { name, input: block.input },
                tags: { mcp_server: mcp.server, mcp_tool: mcp.tool },
                category: 'mcp_request',
                raw: e,
              });
            } else {
              const subtype = classifyToolCall(name);
              const eventType = subtype === 'subagent' ? 'subagent' : 'tool_call';
              events.push({
                ...baseCtx,
                spanId: nextId('evt'),
                type: eventType as EventType,
                subtype,
                tokensIn: tok,
                detail: `${name} ${shortText(inputStr, 40)}`,
                payload: { name, input: block.input },
                tags: { tool_name: name || '' },
                category: subtype,
                raw: e,
              });
            }
          }
        }
      }
      continue;
    }

    if (e.type === 'system' && e.content) {
      const text = typeof e.content === 'string' ? e.content : '';
      events.push({
        ...baseCtx,
        spanId: nextId('evt'),
        type: 'message' as EventType,
        subtype: 'system',
        tokensIn: tokensOf(text),
        detail: shortText(typeof e.content === 'string' ? e.content : '[system]'),
        payload: { text: e.content },
        tags: { role: 'system' },
        category: 'message_system',
        raw: e,
      });
      continue;
    }

    if (e.type === 'attachment' && e.attachment) {
      const att = e.attachment as Record<string, unknown>;
      switch (att.type) {
        case 'hook_success':
        case 'hook_error': {
          events.push({
            ...baseCtx,
            spanId: nextId('evt'),
            type: 'hook' as EventType,
            subtype: ((att.hookEvent as string) || 'unknown').toLowerCase(),
            tokensIn: 0,
            durationApproxMs: typeof att.durationMs === 'number' ? att.durationMs : undefined,
            detail: `${att.hookName || 'hook'} → exit ${att.exitCode ?? '?'}`,
            payload: {
              hookName: att.hookName,
              hookEvent: att.hookEvent,
              command: att.command,
              stdout: att.stdout,
              stderr: att.stderr,
              exitCode: att.exitCode,
              toolUseID: att.toolUseID,
            },
            tags: {
              hook_name: (att.hookName as string) || '',
              hook_event: (att.hookEvent as string) || '',
              tool_use_id: (att.toolUseID as string) || '',
              outcome: att.type === 'hook_success' ? 'success' : 'error',
            },
            category: 'hook',
            raw: e,
          });
          break;
        }
        case 'task_reminder':
        case 'nested_memory': {
          const text = typeof att.content === 'string' ? att.content : JSON.stringify(att);
          events.push({
            ...baseCtx,
            spanId: nextId('evt'),
            type: 'system_reminder' as EventType,
            subtype: att.type as string,
            tokensIn: tokensOf(text),
            detail: shortText(text),
            payload: att,
            tags: { attachment_type: att.type as string },
            category: 'system_reminder',
            raw: e,
          });
          break;
        }
        case 'skill_listing':
        case 'dynamic_skill': {
          const text = typeof att.content === 'string' ? att.content : '';
          events.push({
            ...baseCtx,
            spanId: nextId('evt'),
            type: 'skill' as EventType,
            subtype: att.type === 'dynamic_skill' ? 'dynamic' : 'listing',
            tokensIn: tokensOf(text),
            detail: shortText(text),
            payload: att,
            tags: { attachment_type: att.type as string },
            category: 'skill',
            raw: e,
          });
          break;
        }
        case 'diagnostics': {
          const text = typeof att.content === 'string' ? att.content : JSON.stringify(att);
          events.push({
            ...baseCtx,
            spanId: nextId('evt'),
            type: 'message' as EventType,
            subtype: 'diagnostics',
            tokensIn: tokensOf(text),
            detail: shortText(text),
            payload: att,
            tags: { attachment_type: att.type as string },
            category: 'tool_result',
            raw: e,
          });
          break;
        }
        default: {
          const text = typeof att.content === 'string' ? att.content : JSON.stringify(att).slice(0, 500);
          events.push({
            ...baseCtx,
            spanId: nextId('evt'),
            type: 'attachment' as EventType,
            subtype: (att.type as string) || 'unknown',
            tokensIn: tokensOf(text),
            detail: shortText(text),
            payload: att,
            tags: { attachment_type: (att.type as string) || '' },
            category: 'tool_other',
            raw: e,
          });
          break;
        }
      }
    }
  }

  events.sort((a, b) => {
    const ta = Date.parse(a.ts);
    const tb = Date.parse(b.ts);
    if (ta !== tb) return ta - tb;
    return 0;
  });

  return events;
}
