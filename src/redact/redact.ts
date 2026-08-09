interface RedactPattern {
  name: string;
  re: RegExp;
}

const PATTERNS: RedactPattern[] = [
  // Common API key prefixes
  { name: 'api_key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: 'api_key', re: /\bANTHROPIC_API_KEY\s*[=:]\s*\S+/g },
  { name: 'api_key', re: /\bOPENAI_API_KEY\s*[=:]\s*\S+/g },
  { name: 'api_key', re: /\b[A-Z_]{3,}(?:KEY|TOKEN|SECRET)\s*[=:]\s*\S+/g },
  // JWTs
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Long base64-like blobs — must contain + or end with = to rule out file paths
  // Real base64 secrets commonly contain '+' and '=' padding; file paths do not
  { name: 'secret', re: /[A-Za-z0-9+/]{40,}={1,2}\b/g },
  { name: 'secret', re: /[A-Za-z0-9]{20,}\+[A-Za-z0-9+/]{20,}/g },
];

const CONTEXT_RADIUS = 40;
const MAX_SAMPLES_PER_PATTERN = 3;

function buildContext(source: string, offset: number, matchLength: number): string {
  const start = Math.max(0, offset - CONTEXT_RADIUS);
  const end = Math.min(source.length, offset + matchLength + CONTEXT_RADIUS);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

export function redactString(s: string): string {
  let result = s;
  for (const { name, re } of PATTERNS) {
    result = result.replace(re, `<<REDACTED:${name}>>`);
    re.lastIndex = 0; // reset stateful regex
  }
  return result;
}

export function redactDeep(obj: unknown): unknown {
  if (typeof obj === 'string') return redactString(obj);
  if (Array.isArray(obj)) return obj.map(redactDeep);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = redactDeep(v);
    }
    return result;
  }
  return obj;
}

export interface RedactionSample {
  pattern: string;
  match: string;
  context: string;
}

export interface RedactionScanResult {
  samples: RedactionSample[];
  matchCount: number;
}

function scanString(s: string, out: RedactionSample[], counts: Map<string, number>): void {
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const count = counts.get(name) ?? 0;
      if (count < MAX_SAMPLES_PER_PATTERN) {
        // Keep at most 3 sample snippets per pattern for the confirmation UI;
        // matchCount (below) still reflects every match.
        out.push({ pattern: name, match: m[0], context: buildContext(s, m.index, m[0].length) });
      }
      counts.set(name, count + 1);
      // For non-global regexes the loop would be infinite; all our patterns
      // are /g so this is fine.
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    re.lastIndex = 0;
  }
}

/**
 * Walk an object tree and report every secret-pattern match without modifying
 * the input. `samples` holds up to 3 example snippets per pattern; `matchCount`
 * is the true total across all matches, not capped by the sample limit.
 */
export function scanForRedaction(obj: unknown): RedactionScanResult {
  const out: RedactionSample[] = [];
  const counts = new Map<string, number>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') scanString(v, out, counts);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x);
    }
  };
  visit(obj);
  const matchCount = [...counts.values()].reduce((a, b) => a + b, 0);
  return { samples: out, matchCount };
}

/**
 * A stateful collector that redacts an object tree while recording sample
 * matches and a running total count as a side effect of the same walk —
 * avoids scanning the tree once for samples and again to redact it.
 */
export function createRedactionCollector() {
  const samples: RedactionSample[] = [];
  const counts = new Map<string, number>();

  function redactStringCollecting(s: string): string {
    let result = s;
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      const source = result;
      result = result.replace(re, (match: string, offset: number) => {
        const count = counts.get(name) ?? 0;
        if (count < MAX_SAMPLES_PER_PATTERN) {
          samples.push({ pattern: name, match, context: buildContext(source, offset, match.length) });
        }
        counts.set(name, count + 1);
        return `<<REDACTED:${name}>>`;
      });
    }
    return result;
  }

  function redact(obj: unknown): unknown {
    if (typeof obj === 'string') return redactStringCollecting(obj);
    if (Array.isArray(obj)) return obj.map(redact);
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        result[k] = redact(v);
      }
      return result;
    }
    return obj;
  }

  return {
    redact,
    get samples(): RedactionSample[] { return samples; },
    get matchCount(): number { return [...counts.values()].reduce((a, b) => a + b, 0); },
  };
}
