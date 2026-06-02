import type { AgentEvent } from '../schema/event.js';

// Filter expression grammar (deliberately minimal for MVP):
//   atom      := key:value | tokens > N | tokens < N | "regex"
//   factor    := atom | ( expr )
//   not       := factor | NOT factor
//   and       := not ( AND not )*
//   expr      := and ( OR and )*
//
// Keys: type, subtype, source, mcp, hook, trace, model, category

const KEYS = new Set(['type', 'subtype', 'source', 'mcp', 'hook', 'trace', 'model', 'category']);

type TokenType = '(' | ')' | 'AND' | 'OR' | 'NOT' | 'kv' | 'tokens' | 'regex';

interface Token {
  t: TokenType;
  key?: string;
  value?: string;
  op?: '>' | '<';
  n?: number;
  v?: string;
}

type ASTNode =
  | { t: 'true' }
  | { t: 'and'; left: ASTNode; right: ASTNode }
  | { t: 'or'; left: ASTNode; right: ASTNode }
  | { t: 'not'; child: ASTNode }
  | { t: 'kv'; key: string; value: string }
  | { t: 'tokens'; op: '>' | '<'; n: number }
  | { t: 'regex'; v: string };

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c as '(' | ')' }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"') j++;
      out.push({ t: 'regex', v: input.slice(i + 1, j) });
      i = j + 1; continue;
    }
    let j = i;
    while (j < input.length && !/\s|\(|\)/.test(input[j])) j++;
    const word = input.slice(i, j);
    const upper = word.toUpperCase();
    if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
      out.push({ t: upper as 'AND' | 'OR' | 'NOT' });
    } else if (word.includes(':')) {
      const idx = word.indexOf(':');
      const key = word.slice(0, idx).toLowerCase();
      const value = word.slice(idx + 1);
      if (KEYS.has(key)) out.push({ t: 'kv', key, value });
      else out.push({ t: 'regex', v: word });
    } else if (word === 'tokens') {
      let k = j;
      while (k < input.length && /\s/.test(input[k])) k++;
      const op = input[k] as '>' | '<';
      if (op === '>' || op === '<') {
        k++;
        while (k < input.length && /\s/.test(input[k])) k++;
        let m = k;
        while (m < input.length && /\d/.test(input[m])) m++;
        const n = Number(input.slice(k, m));
        out.push({ t: 'tokens', op, n });
        j = m;
      } else {
        out.push({ t: 'regex', v: word });
      }
    } else {
      out.push({ t: 'regex', v: word });
    }
    i = j;
  }
  return out;
}

function parse(tokens: Token[]): ASTNode {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr(): ASTNode {
    let left = parseAnd();
    while (peek()?.t === 'OR') { consume(); const right = parseAnd(); left = { t: 'or', left, right }; }
    return left;
  }
  function parseAnd(): ASTNode {
    let left = parseNot();
    while (peek()?.t === 'AND') { consume(); const right = parseNot(); left = { t: 'and', left, right }; }
    return left;
  }
  function parseNot(): ASTNode {
    if (peek()?.t === 'NOT') { consume(); return { t: 'not', child: parseFactor() }; }
    return parseFactor();
  }
  function parseFactor(): ASTNode {
    const tok = peek();
    if (!tok) return { t: 'true' };
    if (tok.t === '(') { consume(); const e = parseExpr(); if (peek()?.t === ')') consume(); return e; }
    if (tok.t === 'kv') { consume(); return { t: 'kv', key: tok.key!, value: tok.value! }; }
    if (tok.t === 'tokens') { consume(); return { t: 'tokens', op: tok.op!, n: tok.n! }; }
    if (tok.t === 'regex') { consume(); return { t: 'regex', v: tok.v! }; }
    consume();
    return { t: 'true' };
  }
  return parseExpr();
}

function evalNode(node: ASTNode, event: AgentEvent): boolean {
  switch (node.t) {
    case 'true': return true;
    case 'and': return evalNode(node.left, event) && evalNode(node.right, event);
    case 'or':  return evalNode(node.left, event) || evalNode(node.right, event);
    case 'not': return !evalNode(node.child, event);
    case 'kv': {
      const val = node.value.toLowerCase();
      if (val === '') return true;
      switch (node.key) {
        case 'type':     return String(event.type || '').toLowerCase().startsWith(val);
        case 'subtype':  return String(event.subtype || '').toLowerCase().startsWith(val);
        case 'source':   return String(event.source || '').toLowerCase().startsWith(val);
        case 'mcp':      return String(event.tags?.mcp_server || '').toLowerCase().startsWith(val);
        case 'hook':     return String(event.tags?.hook_event || '').toLowerCase().startsWith(val);
        case 'trace':    return String(event.traceId || '').toLowerCase().startsWith(val);
        case 'model':    return String(event.model || '').toLowerCase().startsWith(val);
        case 'category': return String(event.category || '').toLowerCase().startsWith(val);
        default: return true;
      }
    }
    case 'tokens': {
      const n = event.tokensIn || 0;
      return node.op === '>' ? n > node.n : n < node.n;
    }
    case 'regex': {
      let re: RegExp;
      try { re = new RegExp(node.v, 'i'); } catch { return false; }
      const haystack = JSON.stringify({ detail: event.detail, payload: event.payload, tags: event.tags });
      return re.test(haystack);
    }
  }
}

export function compileFilter(expr: string): (event: AgentEvent) => boolean {
  const trimmed = (expr || '').trim();
  if (!trimmed) return () => true;
  const node = parse(tokenize(trimmed));
  return (event) => evalNode(node, event);
}
