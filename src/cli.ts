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
    --version  Print version
`, {
  importMeta: import.meta,
  flags: {
    output: { type: 'string' },
    replay: { type: 'string' },
    print: { type: 'boolean' },
  },
});

const cmd = cli.input[0] || 'top';

if (cmd === 'adapters') {
  const { ADAPTERS } = await import('./adapters/index.js');
  for (const adapter of ADAPTERS) {
    const found = await adapter.detect();
    if (found) {
      const sessions = await adapter.discoverSessions({ limit: 5 });
      console.log(`${adapter.NAME.padEnd(14)} ✓ ${sessions.length}+ sessions detected`);
    } else {
      console.log(`${adapter.NAME.padEnd(14)} ─ not detected`);
    }
  }
  process.exit(0);
}

if (cmd === 'export') {
  const { discoverAllSessions, loadSessionEntries } = await import('./adapters/index.js');
  const { extractEvents } = await import('./extract/events.js');
  const { exportSession } = await import('./export/pack.js');

  const sessions = await discoverAllSessions({ limit: 1 });
  if (!sessions[0]) {
    console.error('no sessions detected');
    process.exit(1);
  }
  const session = sessions[0];
  const entries = await loadSessionEntries(session);
  const events = extractEvents(entries, session);
  const outPath = await exportSession(session, events, { outputPath: cli.flags.output });
  console.log(`exported → ${outPath}`);
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
