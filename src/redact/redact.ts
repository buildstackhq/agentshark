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
