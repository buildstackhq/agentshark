import meow from 'meow';
import { render } from 'ink';
import React from 'react';
import { App } from './ui/App.js';

const cli = meow(`
  Usage
    $ agentshark               # top view (default)
    $ agentshark top           # explicit top view
    $ agentshark inspect       # inspect most recent local session
    $ agentshark inspect --replay=FILE     # replay a .aspark file
    $ agentshark inspect --print           # dump events to stdout (no TUI)
    $ agentshark export        # export most recent session to .aspark
    $ agentshark adapters      # list detected adapters

  Options
    --output   Output path for .aspark export
    --replay   Path to a .aspark file to replay
    --print    Print events as JSONL to stdout instead of opening the TUI
    --yes      Skip the redaction-diff confirmation prompt on export
    --version  Print version
`, {
  importMeta: import.meta,
  allowUnknownFlags: false,
  flags: {
    output: { type: 'string' },
    replay: { type: 'string' },
    print: { type: 'boolean' },
    yes: { type: 'boolean' },
  },
});

const KNOWN_COMMANDS = new Set(['top', 'inspect', 'export', 'adapters']);

if (cli.input[0] && !KNOWN_COMMANDS.has(cli.input[0])) {
  console.error(`agentshark: unknown command "${cli.input[0]}"`);
  console.error(cli.help);
  process.exit(2);
}

if (cli.input.length > 1) {
  console.error(`agentshark: unexpected extra arguments: ${cli.input.slice(1).join(' ')}`);
  console.error(cli.help);
  process.exit(2);
}

const cmd = cli.input[0] || 'top';

if (cmd === 'adapters') {
  const { ADAPTERS } = await import('./adapters/index.js');
  for (const adapter of ADAPTERS) {
    const found = await adapter.detect();
    const summaryless = !adapter.CAPABILITIES.has('summary');
    const suffix = summaryless ? ' (discovery only — token / cache data not yet supported)' : '';
    if (found) {
      const sessions = await adapter.discoverSessions({ limit: 5 });
      console.log(`${adapter.NAME.padEnd(14)} ✓ ${sessions.length}+ sessions detected${suffix}`);
    } else {
      console.log(`${adapter.NAME.padEnd(14)} ─ not detected${suffix}`);
    }
  }
  process.exit(0);
}

if (cmd === 'export') {
  const { discoverAllSessions, loadSessionEntries } = await import('./adapters/index.js');
  const { extractEvents } = await import('./extract/events.js');
  const { prepareExport, writeExport, gatherDescendants } = await import('./export/pack.js');

  // Discover the whole list (not limit:1) so the in-memory sessionRegistry
  // gets populated with parent→child links before we gather descendants.
  const sessions = await discoverAllSessions({ limit: 50 });
  if (!sessions[0]) {
    console.error('no sessions detected');
    process.exit(1);
  }
  const session = sessions[0];
  const entries = await loadSessionEntries(session);
  const events = extractEvents(entries, session);
  const children = await gatherDescendants(session);
  const prepared = prepareExport(session, events, { outputPath: cli.flags.output }, children);
  const outPath = cli.flags.output ?? prepared.defaultPath;

  // Print the redaction diff so the user sees what will be stripped.
  console.error(`agentshark export → ${outPath}`);
  const childSuffix = children.length > 0 ? ` (+ ${children.length} sub-agent session${children.length === 1 ? '' : 's'})` : '';
  console.error(`session: ${session.projectLabel} · ${events.length} events${childSuffix}`);
  const diff = prepared.diff;
  if (diff.matchCount === 0) {
    console.error('redaction: 0 secret matches');
  } else {
    console.error(`redaction: ${diff.matchCount} match(es) across patterns [${diff.patternsApplied.join(', ')}]`);
    const byPattern = new Map<string, number>();
    for (const s of diff.samples) byPattern.set(s.pattern, (byPattern.get(s.pattern) ?? 0) + 1);
    for (const [p, count] of byPattern) {
      const sample = diff.samples.find(s => s.pattern === p);
      const preview = sample ? ` · sample: …${sample.context.slice(0, 60)}…` : '';
      console.error(`  ${p.padEnd(10)} ${String(count).padStart(4)} match(es)${preview}`);
    }
  }

  // Confirmation step. --yes skips. No-TTY also requires --yes (refuse silently
  // writing in a non-interactive context without explicit consent).
  if (!cli.flags.yes) {
    if (!process.stdin.isTTY) {
      console.error('non-interactive shell: pass --yes to confirm the redaction diff and write the file');
      process.exit(2);
    }
    const { stdin, stdout } = process;
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer: string = await new Promise(resolve => rl.question('write file? [y/N] ', resolve));
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.error('aborted; no file written');
      process.exit(1);
    }
  }

  const finalPath = await writeExport(prepared, cli.flags.output);
  console.log(`exported → ${finalPath}`);
  process.exit(0);
}

const initialMode = cmd === 'inspect' ? 'inspect' : 'top';
const replayPath = cli.flags.replay;

if (cli.flags.print) {
  const { discoverAllSessions, loadSessionEntries } = await import('./adapters/index.js');
  const { extractEvents } = await import('./extract/events.js');
  const sessions = await discoverAllSessions({ limit: 1 });
  if (!sessions[0]) {
    console.error('no sessions detected');
    process.exit(1);
  }
  const session = sessions[0];
  const entries = await loadSessionEntries(session);
  const events = extractEvents(entries, session);
  for (const ev of events) {
    const { raw, payload, ...slim } = ev;
    process.stdout.write(JSON.stringify(slim) + '\n');
  }
  process.exit(0);
}

render(React.createElement(App, { initialMode, replayPath }));
