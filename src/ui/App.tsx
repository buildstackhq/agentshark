import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import React from 'react';
import { Header } from './Header.js';
import { TopView } from './TopView.js';
import { EventList } from './EventList.js';
import { Inspector } from './Inspector.js';
import { ContextView } from './ContextView.js';
import { FilterBar } from './FilterBar.js';
import { HelpView } from './HelpView.js';
import { discoverAllSessions, loadSessionEntries, summarizeSession } from '../adapters/index.js';
import { extractEvents } from '../extract/events.js';
import { exportSession } from '../export/pack.js';
import { computeContextComposition } from '../extract/contextComposition.js';
import { compileFilter } from '../store/filter.js';
import { loadReplay } from '../replay/replay.js';
import type { SessionRef, EnrichedSession, SessionSummary } from '../adapters/types.js';
import type { AgentEvent } from '../schema/event.js';

const REFRESH_MS = 2000;

// Module-level cache — keyed by `path:size`, persists across renders
const summaryCache = new Map<string, Pick<EnrichedSession, 'model' | 'turns' | 'billedInput' | 'cacheReadPct'>>();

async function enrichSession(s: SessionRef): Promise<EnrichedSession> {
  const key = `${s.jsonlPath}:${s.sizeBytes}`;
  const cached = summaryCache.get(key);
  if (cached) return { ...s, ...cached };
  const entries = await loadSessionEntries(s);
  const sum = summarizeSession(s, entries);
  const data = {
    model: sum.lastModel,
    turns: sum.assistantTurns,
    billedInput: sum.billedInput,
    cacheReadPct: sum.cacheReadPct,
  };
  summaryCache.set(key, data);
  return { ...s, ...data };
}

interface AppProps {
  initialMode?: 'top' | 'inspect';
  replayPath?: string;
}

export function App({ initialMode = 'top', replayPath }: AppProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const listHeight = Math.max(10, (stdout?.rows ?? 40) - 12);

  const [mode, setMode] = React.useState<'top' | 'inspect'>(initialMode);
  const [isReplay, setIsReplay] = React.useState(false);
  const [sessions, setSessions] = React.useState<EnrichedSession[]>([]);
  const [topIndex, setTopIndex] = React.useState(0);
  const [selectedSession, setSelectedSession] = React.useState<SessionRef | null>(null);
  const [events, setEvents] = React.useState<AgentEvent[]>([]);
  const [summary, setSummary] = React.useState<SessionSummary | null>(null);
  const [eventIndex, setEventIndex] = React.useState(0);
  const [view, setView] = React.useState<'events' | 'context'>('events');
  const [filterText, setFilterText] = React.useState('');
  const [filterEditing, setFilterEditing] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showInspector, setShowInspector] = React.useState(false);

  // Load sessions list and refresh while in top mode
  React.useEffect(() => {
    let cancelled = false;
    async function reload() {
      try {
        const list = await discoverAllSessions({ limit: 30 });
        const enriched = await Promise.all(list.map(s => enrichSession(s).catch(() => ({
          ...s, model: null, turns: 0, billedInput: 0, cacheReadPct: 0,
        } as EnrichedSession))));
        if (!cancelled) setSessions(enriched);
      } catch (err) {
        if (!cancelled) setStatus(`error: ${(err as Error).message}`);
      }
    }
    if (mode === 'top') {
      reload();
      const id = setInterval(() => { if (!paused) reload(); }, REFRESH_MS);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [mode, paused]);

  // Load replay file on mount if --replay was passed
  React.useEffect(() => {
    if (!replayPath) return;
    setIsReplay(true);
    setMode('inspect');
    setStatus('loading replay…');
    loadReplay(replayPath).then(({ session, events: replayEvents }) => {
      setSelectedSession({
        source: session.source,
        id: session.id,
        jsonlPath: '',
        projectLabel: session.projectLabel,
        projectDir: session.projectDir,
        lastActivity: new Date(),
        sizeBytes: 0,
      });
      setEvents(replayEvents);
      setStatus(null);
    }).catch(err => setStatus(`replay error: ${(err as Error).message}`));
  }, [replayPath]);

  async function enterInspectFor(session: SessionRef) {
    setSelectedSession(session);
    setMode('inspect');
    setIsReplay(false);
    setEventIndex(0);
    setView('events');
    setShowInspector(false);
    setStatus(`loading ${session.projectLabel}…`);
    try {
      const entries = await loadSessionEntries(session);
      const evs = extractEvents(entries, session);
      const sum = summarizeSession(session, entries);
      setEvents(evs);
      setSummary(sum);
      setStatus(null);
    } catch (err) {
      setStatus(`error: ${(err as Error).message}`);
    }
  }

  // Refresh inspected session every REFRESH_MS unless paused or in replay
  React.useEffect(() => {
    if (mode !== 'inspect' || !selectedSession || isReplay) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (paused || cancelled) return;
      try {
        const entries = await loadSessionEntries(selectedSession);
        const evs = extractEvents(entries, selectedSession);
        const sum = summarizeSession(selectedSession, entries);
        if (!cancelled) { setEvents(evs); setSummary(sum); }
      } catch { /* ignore intermittent read errors during writes */ }
    }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [mode, selectedSession, paused, isReplay]);

  const filterFn = React.useMemo(() => compileFilter(filterText), [filterText]);
  const filteredWithIdx = React.useMemo(
    () => events.map((e, i) => ({ event: e, originalIdx: i })).filter(({ event }) => filterFn(event)),
    [events, filterFn]
  );
  const filteredEvents = React.useMemo(() => filteredWithIdx.map(x => x.event), [filteredWithIdx]);
  const filteredOriginalIdx = React.useMemo(() => filteredWithIdx.map(x => x.originalIdx), [filteredWithIdx]);
  React.useEffect(() => {
    if (eventIndex >= filteredEvents.length) setEventIndex(Math.max(0, filteredEvents.length - 1));
  }, [filteredEvents.length, eventIndex]);

  const hottestSession = React.useMemo((): EnrichedSession | null => {
    if (mode !== 'top' || sessions.length === 0) return null;
    return sessions.reduce((max, s) => (s.turns || 0) > (max.turns || 0) ? s : max, sessions[0]);
  }, [mode, sessions]);

  const hottestSummary = React.useMemo((): SessionSummary | null => {
    if (!hottestSession) return null;
    return {
      lastModel: hottestSession.model,
      assistantTurns: hottestSession.turns,
      billedInput: hottestSession.billedInput,
      cacheRead: Math.round(hottestSession.billedInput * hottestSession.cacheReadPct),
      outputTokens: 0,
      cacheReadPct: hottestSession.cacheReadPct,
      firstTs: null,
      lastTs: null,
      lastUsage: null,
    };
  }, [hottestSession]);

  const composition = React.useMemo(() => computeContextComposition(events), [events]);

  useInput((input, key) => {
    if (filterEditing) {
      if (key.escape) setFilterEditing(false);
      return;
    }
    if (input === 'h') { setShowHelp(v => !v); return; }
    if (input === 'q') {
      if (showHelp) { setShowHelp(false); return; }
      if (mode === 'inspect') { setMode('top'); setSelectedSession(null); return; }
      exit();
      return;
    }
    if (showHelp) return;
    if (mode === 'top') {
      if (key.upArrow) setTopIndex(i => Math.max(0, i - 1));
      else if (key.downArrow) setTopIndex(i => Math.min(sessions.length - 1, i + 1));
      else if (key.return && sessions[topIndex]) enterInspectFor(sessions[topIndex]);
      else if (input === 'r') setPaused(p => !p);
      else if (input === 'e' && sessions[topIndex]) {
        const s = sessions[topIndex];
        setStatus(`exporting ${s.projectLabel}…`);
        loadSessionEntries(s)
          .then(entries => {
            const evs = extractEvents(entries, s);
            return exportSession(s, evs, {});
          })
          .then(outPath => setStatus(`exported → ${outPath}`))
          .catch(err => setStatus(`export error: ${(err as Error).message}`));
      }
      return;
    }
    if (mode === 'inspect') {
      if (input === 'c') { setView(v => v === 'events' ? 'context' : 'events'); return; }
      if (input === '/') { setFilterEditing(true); return; }
      if (input === 't') { setPaused(p => !p); return; }
      if (view === 'events') {
        if (key.upArrow) setEventIndex(i => Math.max(0, i - 1));
        else if (key.downArrow) setEventIndex(i => Math.min(filteredEvents.length - 1, i + 1));
        else if (key.pageUp) setEventIndex(i => Math.max(0, i - 10));
        else if (key.pageDown) setEventIndex(i => Math.min(filteredEvents.length - 1, i + 10));
        else if (input === 'g') setEventIndex(0);
        else if (input === 'G') setEventIndex(Math.max(0, filteredEvents.length - 1));
        else if (input === 'i') setShowInspector(v => !v);
      }
    }
  }, { isActive: isRawModeSupported });

  const replayLabel = isReplay ? ' · REPLAY' : '';
  const footer = showHelp
    ? 'h close help · q close help'
    : mode === 'top'
      ? '↑↓ select · ⏎ inspect · e export · r pause/resume · h help · q quit'
      : view === 'events'
        ? '/ filter · ↑↓ select · i inspector · c context · t tail · g/G top/bottom · h help · q back'
        : 'c back · h help · q back';

  return (
    <Box flexDirection="column">
      <Header
        session={mode === 'top' ? hottestSession : selectedSession}
        summary={mode === 'top' ? hottestSummary : summary}
        mode={mode === 'top'
          ? `top · ${sessions.length} sessions`
          : `inspect · ${filteredEvents.length} / ${events.length} events${replayLabel}`}
        paused={paused}
        view={view === 'context' ? 'context' : mode}
      />
      {status ? <Text color="yellow">{status}</Text> : null}
      {showHelp
        ? <HelpView mode={mode === 'top' ? 'top' : 'events'} />
        : mode === 'top'
          ? <TopView rows={sessions} selectedIndex={topIndex} />
          : view === 'context'
            ? <ContextView composition={composition} />
            : <>
              <FilterBar
                editing={filterEditing}
                value={filterText}
                onChange={setFilterText}
                onSubmit={() => setFilterEditing(false)}
                matched={filteredEvents.length}
                total={events.length}
              />
              <EventList events={filteredEvents} selectedIndex={eventIndex} height={listHeight} originalIndices={filteredOriginalIdx} />
              {showInspector && <Inspector event={filteredEvents[eventIndex]} />}
            </>}
      <Box marginTop={1}>
        <Text color="gray">{footer}</Text>
      </Box>
    </Box>
  );
}
