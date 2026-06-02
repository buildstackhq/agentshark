// Claude Cowork adapter — discovers sessions from the Claude Cowork desktop app.
//
// Cowork runs Claude Code in a sandboxed VM. Session layout on disk (macOS):
//   ~/Library/Application Support/Claude/local-agent-mode-sessions/
//     <account-uuid>/
//       <cowork-session-uuid>/
//         local_<sandbox-uuid>/
//           .claude/
//             projects/
//               <encoded-cwd>/
//                 <session-uuid>.jsonl
//
// The JSONL format is identical to the claudeCode adapter; loadSessionEntries
// and summarizeSession are re-exported from there unchanged.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionRef } from './types.js';
export { loadSessionEntries, summarizeSession } from './claudeCode.js';

export const NAME = 'claude-cowork';

const BASE_DIR = join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');

// Distinguishes account/session UUID dirs from non-session siblings like "skills-plugin".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function detect(): Promise<boolean> {
  try {
    await stat(BASE_DIR);
    return true;
  } catch {
    return false;
  }
}

export async function discoverSessions({ limit = 50 } = {}): Promise<SessionRef[]> {
  if (!(await detect())) return [];
  const sessions: SessionRef[] = [];

  let accountDirs;
  try { accountDirs = await readdir(BASE_DIR, { withFileTypes: true }); }
  catch { return []; }

  for (const accountEntry of accountDirs) {
    if (!accountEntry.isDirectory() || !UUID_RE.test(accountEntry.name)) continue;
    const accountPath = join(BASE_DIR, accountEntry.name);

    let sessionDirs;
    try { sessionDirs = await readdir(accountPath, { withFileTypes: true }); }
    catch { continue; }

    for (const sessionEntry of sessionDirs) {
      if (!sessionEntry.isDirectory() || !UUID_RE.test(sessionEntry.name)) continue;
      const coworkSessionId = sessionEntry.name;
      const coworkSessionPath = join(accountPath, coworkSessionId);

      let sandboxDirs;
      try { sandboxDirs = await readdir(coworkSessionPath, { withFileTypes: true }); }
      catch { continue; }

      for (const sandboxEntry of sandboxDirs) {
        if (!sandboxEntry.isDirectory() || !sandboxEntry.name.startsWith('local_')) continue;
        const projectsPath = join(coworkSessionPath, sandboxEntry.name, '.claude', 'projects');

        let encodedCwdDirs;
        try { encodedCwdDirs = await readdir(projectsPath, { withFileTypes: true }); }
        catch { continue; }

        for (const cwdEntry of encodedCwdDirs) {
          if (!cwdEntry.isDirectory()) continue;
          const cwdPath = join(projectsPath, cwdEntry.name);

          let jsonlFiles;
          try { jsonlFiles = await readdir(cwdPath, { withFileTypes: true }); }
          catch { continue; }

          for (const fileEntry of jsonlFiles) {
            if (!fileEntry.isFile() || !fileEntry.name.endsWith('.jsonl')) continue;
            const jsonlPath = join(cwdPath, fileEntry.name);
            let s;
            try { s = await stat(jsonlPath); } catch { continue; }

            sessions.push({
              source: NAME,
              id: fileEntry.name.replace(/\.jsonl$/, ''),
              jsonlPath,
              projectDir: coworkSessionId,
              projectLabel: `cowork/${coworkSessionId.slice(0, 8)}`,
              lastActivity: s.mtime,
              sizeBytes: s.size,
            });
          }
        }
      }
    }
  }

  sessions.sort((a, b) => +b.lastActivity - +a.lastActivity);
  return sessions.slice(0, limit);
}
