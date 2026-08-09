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
import { prepareExport, writeExport, gatherDescendants, type PreparedExport } from '../export/pack.js';
import { computeContextComposition } from '../extract/contextComposition.js';
import { compileFilter } from '../store/filter.js';
import { loadReplay } from '../replay/replay.js';
import { RedactionConfirm } from './RedactionConfirm.js';
import { sessionRegistry } from '../store/sessionRegistry.js';
import { SORT_LABELS, nextSortMode, type SortMode } from './sortMode.js';
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
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null);
  const [showSubagents, setShowSubagents] = React.useState(false);
  const [selectedSession, setSelectedSession] = React.useState<SessionRef | null>(null);
  const [events, setEvents] = React.useState<AgentEvent[]>([]);
  const [summary, setSummary] = React.useState<SessionSummary | null>(null);
  const [eventIndex, setEventIndex] = React.useState(0);
  const [sortMode, setSortMode] = React.useState<SortMode>('step-asc');
  const [view, setView] = React.useState<'events' | 'context'>('events');
  const [filterText, setFilterText] = React.useState('');
  const [filterEditing, setFilterEditing] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showInspector, setShowInspector] = React.useState(false);
  const [exportPrepared, setExportPrepared] = React.useState<PreparedExport | null>(null);
  const [exportStatus, setExportStatus] = React.useState<string | null>(null);

  // When replaying a v2 bundle we hold each session's events in memory keyed by
  // session id, so drill-down between parent and children works without disk
  // access. `replaySessionRefs` keeps a matching map of synthesized SessionRefs
  // so `<`/`>` navigation can look up either side.
  const replaySessionEventsRef = React.useRef<Map<string, AgentEvent[]>>(new Map());
  const replaySessionRefsRef = React.useRef<Map<string, SessionRef>>(new Map());

  // Tracks progress through a parent's sibling sub-agents so repeated `>`
  // presses cycle rather than always landing on the most-recent child.
  // Reset whenever the user lands on a session by any other means.
  const childCycleRef = React.useRef<{ parentId: string; index: number; childId: string } | null>(null);

  // Load sessions list and refresh while in top mode
  React.useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function reload() {
      // discoverSessions clears the shared sessionRegistry synchronously at
      // the start of each pass — an overlapping tick (poll takes longer than
      // REFRESH_MS, plausible now that discovery also walks each session's
      // subagents/ dir) would otherwise interleave and cause sub-agent
      // badges/rows to flicker.
      if (inFlight) return;
      inFlight = true;
      try {
        const list = await discoverAllSessions({ limit: 30 });
        const enriched = await Promise.all(list.map(s => enrichSession(s).catch(() => ({
          ...s, model: null, turns: 0, billedInput: 0, cacheReadPct: 0,
        } as EnrichedSession))));
        if (!cancelled) setSessions(enriched);
      } catch (err) {
        if (!cancelled) setStatus(`error: ${(err as Error).message}`);
      } finally {
        inFlight = false;
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
    loadReplay(replayPath).then(({ session, events: replayEvents, children }) => {
      const parentRef: SessionRef = {
        source: session.source,
        id: session.id,
        jsonlPath: '',
        projectLabel: session.projectLabel,
        projectDir: session.projectDir,
        lastActivity: new Date(),
        sizeBytes: 0,
      };
      // Replay is the source of truth — clear any registry state from a live
      // discovery pass before seeding from the bundle.
      sessionRegistry.clear();
      replaySessionEventsRef.current.clear();
      replaySessionRefsRef.current.clear();
      replaySessionEventsRef.current.set(parentRef.id, replayEvents);
      replaySessionRefsRef.current.set(parentRef.id, parentRef);
      for (const child of children) {
        const childRef: SessionRef = {
          source: child.session.source,
          id: child.session.id,
          jsonlPath: '',
          projectLabel: child.session.projectLabel,
          projectDir: child.session.projectDir,
          lastActivity: new Date(),
          sizeBytes: 0,
          parentSessionId: child.session.parentSessionId,
          parentToolUseId: child.session.parentToolUseId,
          agentType: child.session.agentType,
        };
        sessionRegistry.recordChild(
          child.session.parentSessionId,
          child.session.parentToolUseId ?? '',
          childRef,
        );
        replaySessionEventsRef.current.set(childRef.id, child.events);
        replaySessionRefsRef.current.set(childRef.id, childRef);
      }
      setSelectedSession(parentRef);
      setEvents(replayEvents);
      setStatus(null);
    }).catch(err => setStatus(`replay error: ${(err as Error).message}`));
  }, [replayPath]);

  async function enterInspectFor(session: SessionRef, replayEvents?: AgentEvent[]) {
    setSelectedSession(session);
    setMode('inspect');
    setEventIndex(0);
    setSortMode('step-asc');
    setView('events');
    setShowInspector(false);
    if (replayEvents) {
      // Drill-down within a replay — events are already in memory.
      setEvents(replayEvents);
      setSummary(null);
      setStatus(null);
      return;
    }
    setIsReplay(false);
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

  // Group children directly under their parent so the top view reads as a tree.
  // Orphan children (parent outside the discovery window) keep their original
  // position. The result is stable across re-renders as long as IDs don't change.
  // When `showSubagents` is false, child rows are dropped entirely — only top-
  // level sessions survive, and their `+N` badge tells the user that sub-agents
  // exist (press `s` to reveal them).
  const treeSorted = React.useMemo((): EnrichedSession[] => {
    const result: EnrichedSession[] = [];
    const seen = new Set<string>();
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const s of sessions) {
      if (seen.has(s.id)) continue;
      if (s.parentSessionId && byId.has(s.parentSessionId)) continue;
      result.push(s);
      seen.add(s.id);
      if (!showSubagents) continue;
      const childRefs = sessionRegistry.childrenOf(s.id);
      for (const child of childRefs) {
        const enriched = byId.get(child.id);
        if (enriched && !seen.has(enriched.id)) {
          result.push(enriched);
          seen.add(enriched.id);
        }
      }
    }
    if (showSubagents) {
      // Second pass: append any orphan children whose parent isn't in `sessions`.
      for (const s of sessions) {
        if (!seen.has(s.id)) {
          result.push(s);
          seen.add(s.id);
        }
      }
    }
    return result;
  }, [sessions, showSubagents]);

  const topIndex = React.useMemo(() => {
    if (!selectedSessionId) return 0;
    const idx = treeSorted.findIndex(s => s.id === selectedSessionId);
    return idx >= 0 ? idx : 0;
  }, [selectedSessionId, treeSorted]);

  // Initialize / repair the selected-session anchor whenever the list changes.
  React.useEffect(() => {
    if (treeSorted.length === 0) return;
    if (!selectedSessionId || !treeSorted.some(s => s.id === selectedSessionId)) {
      setSelectedSessionId(treeSorted[0].id);
    }
  }, [treeSorted, selectedSessionId]);

  const filterFn = React.useMemo(() => compileFilter(filterText), [filterText]);
  const filteredWithIdx = React.useMemo(
    () => events.map((e, i) => ({ event: e, originalIdx: i })).filter(({ event }) => filterFn(event)),
    [events, filterFn]
  );
  const sortedWithIdx = React.useMemo(() => {
    switch (sortMode) {
      case 'step-asc': return filteredWithIdx;
      case 'step-desc': return [...filteredWithIdx].reverse();
      case 'tok-desc': return [...filteredWithIdx].sort((a, b) =>
        (b.event.tokensIn ?? 0) - (a.event.tokensIn ?? 0) || a.originalIdx - b.originalIdx);
      case 'tok-asc': return [...filteredWithIdx].sort((a, b) =>
        (a.event.tokensIn ?? 0) - (b.event.tokensIn ?? 0) || a.originalIdx - b.originalIdx);
    }
  }, [filteredWithIdx, sortMode]);
  const filteredEvents = React.useMemo(() => sortedWithIdx.map(x => x.event), [sortedWithIdx]);
  const filteredOriginalIdx = React.useMemo(() => sortedWithIdx.map(x => x.originalIdx), [sortedWithIdx]);
  React.useEffect(() => {
    if (eventIndex >= filteredEvents.length) setEventIndex(Math.max(0, filteredEvents.length - 1));
  }, [filteredEvents.length, eventIndex]);

  // Re-sorting reorders the whole list — snap the cursor back to the top of
  // the new order rather than trying to track a moving row.
  React.useEffect(() => {
    setEventIndex(0);
  }, [sortMode]);

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
    // The export-confirm dialog must be handled before the `q`/mode checks
    // below — otherwise, since preparing an export doesn't change `mode` away
    // from 'top', those checks intercept y/n/q first and `q` falls through to
    // exit() instead of aborting the export.
    if (exportPrepared) {
      if (input === 'y' || input === 'Y') {
        const prepared = exportPrepared;
        setExportStatus('writing…');
        writeExport(prepared)
          .then(outPath => {
            setExportPrepared(null);
            setExportStatus(null);
            setStatus(`exported → ${outPath}`);
          })
          .catch(err => {
            setExportStatus(`write error: ${(err as Error).message}`);
          });
        return;
      }
      if (input === 'n' || input === 'N' || input === 'q' || key.escape) {
        setExportPrepared(null);
        setExportStatus(null);
        setStatus('export aborted — no file written');
        return;
      }
      return;
    }
    if (input === 'q') {
      if (showHelp) { setShowHelp(false); return; }
      if (mode === 'inspect') {
        if (isReplay) {
          // Leaving replay back to top — clear the registry so seeded replay
          // entries don't leak into the next live discovery pass.
          sessionRegistry.clear();
          replaySessionEventsRef.current.clear();
          replaySessionRefsRef.current.clear();
          setIsReplay(false);
        }
        setMode('top');
        setSelectedSession(null);
        return;
      }
      exit();
      return;
    }
    if (showHelp) return;
    if (mode === 'top') {
      if (key.upArrow) {
        const next = Math.max(0, topIndex - 1);
        setSelectedSessionId(treeSorted[next]?.id ?? null);
      }
      else if (key.downArrow) {
        const next = Math.min(treeSorted.length - 1, topIndex + 1);
        setSelectedSessionId(treeSorted[next]?.id ?? null);
      }
      else if (key.return && treeSorted[topIndex]) enterInspectFor(treeSorted[topIndex]);
      else if (input === 'r') setPaused(p => !p);
      else if (input === 's') setShowSubagents(v => !v);
      else if (input === 'e' && treeSorted[topIndex] && !exportPrepared) {
        const s = treeSorted[topIndex];
        setStatus(`preparing export for ${s.projectLabel}…`);
        loadSessionEntries(s)
          .then(async entries => {
            const evs = extractEvents(entries, s);
            const children = await gatherDescendants(s);
            const suffix = children.length > 0 ? ` + ${children.length} sub-agent${children.length === 1 ? '' : 's'}` : '';
            setStatus(`preparing export for ${s.projectLabel}${suffix}…`);
            const prepared = prepareExport(s, evs, {}, children);
            setExportPrepared(prepared);
            setStatus(null);
          })
          .catch(err => setStatus(`export error: ${(err as Error).message}`));
      }
      return;
    }
    if (mode === 'inspect') {
      if (input === 'c') { setView(v => v === 'events' ? 'context' : 'events'); return; }
      if (input === '/') { setFilterEditing(true); return; }
      if (input === 't') { setPaused(p => !p); return; }
      if (input === '>') {
        // Drill into a sub-agent of the current session. Repeated presses
        // cycle through all of that parent's children instead of always
        // landing on the most-recent one.
        if (!selectedSession) return;
        const cycling = childCycleRef.current?.childId === selectedSession.id;
        const parentId = cycling ? childCycleRef.current!.parentId : selectedSession.id;
        const children = sessionRegistry.childrenOf(parentId);
        if (children.length === 0) {
          childCycleRef.current = null;
          setStatus('no sub-agents to inspect');
          return;
        }
        const index = cycling ? (childCycleRef.current!.index + 1) % children.length : 0;
        const child = children[index];
        const advance = () => { childCycleRef.current = { parentId, index, childId: child.id }; };
        if (isReplay) {
          const evs = replaySessionEventsRef.current.get(child.id);
          if (evs) { advance(); enterInspectFor(child, evs); }
          else setStatus('sub-agent not in this replay bundle');
        } else {
          advance();
          enterInspectFor(child);
        }
        return;
      }
      if (input === '<') {
        // Pop back to the parent session.
        if (!selectedSession?.parentSessionId) { setStatus('already at root'); return; }
        const parentId = selectedSession.parentSessionId;
        if (isReplay) {
          const parentRef = replaySessionRefsRef.current.get(parentId);
          const parentEvents = replaySessionEventsRef.current.get(parentId);
          if (parentRef && parentEvents) enterInspectFor(parentRef, parentEvents);
          else setStatus('parent not in this replay bundle');
        } else {
          const parentRef = sessions.find(s => s.id === parentId);
          if (parentRef) enterInspectFor(parentRef);
          else setStatus('parent not in current session list');
        }
        return;
      }
      if (view === 'events') {
        if (key.upArrow) setEventIndex(i => Math.max(0, i - 1));
        else if (key.downArrow) setEventIndex(i => Math.min(filteredEvents.length - 1, i + 1));
        else if (key.pageUp) setEventIndex(i => Math.max(0, i - 10));
        else if (key.pageDown) setEventIndex(i => Math.min(filteredEvents.length - 1, i + 10));
        else if (input === 'g') setEventIndex(0);
        else if (input === 'G') setEventIndex(Math.max(0, filteredEvents.length - 1));
        else if (input === 'i') setShowInspector(v => !v);
        else if (input === 's') setSortMode(nextSortMode);
      }
    }
  }, { isActive: isRawModeSupported });

  const replayLabel = isReplay ? ' · REPLAY' : '';
  const hasAnySubagent = React.useMemo(
    () => sessions.some(s => sessionRegistry.hasChildren(s.id)),
    [sessions]
  );
  const topFooter = hasAnySubagent
    ? showSubagents
      ? '↑↓ select · ⏎ inspect · s hide sub-agents · e export · r pause/resume · h help · q quit'
      : '↑↓ select · ⏎ inspect · s show sub-agents · e export · r pause/resume · h help · q quit'
    : '↑↓ select · ⏎ inspect · e export · r pause/resume · h help · q quit';
  const footer = showHelp
    ? 'h close help · q close help'
    : mode === 'top'
      ? topFooter
      : view === 'events'
        ? `/ filter · ↑↓ select · i inspector · c context · < > parent/child · t tail · g/G top/bottom · s sort (${SORT_LABELS[sortMode]}) · h help · q back`
        : 'c back · h help · q back';

  const subagentNote = React.useMemo(() => {
    if (mode !== 'inspect' || !selectedSession) return undefined;
    // Sub-agent ids are `${parentSessionId}/${agentId}` — slicing the raw id
    // would just show the parent's own prefix for every child, so strip the
    // parent portion first.
    const displayId = (id: string) => (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id).slice(0, 8);
    const selfId = `id: ${displayId(selectedSession.id)}`;
    const childCount = sessionRegistry.childrenOf(selectedSession.id).length;
    if (childCount > 0) return `${selfId} · sub-agents: ${childCount} (press >)`;
    if (selectedSession.parentSessionId) {
      const cycle = childCycleRef.current;
      const position = cycle?.childId === selectedSession.id
        ? ` (${cycle.index + 1}/${sessionRegistry.childrenOf(cycle.parentId).length})`
        : '';
      return `${selfId} · sub-agent of ${displayId(selectedSession.parentSessionId)}${position}`;
    }
    return selfId;
  }, [mode, selectedSession]);

  return (
    <Box flexDirection="column">
      <Header
        session={mode === 'top' ? hottestSession : selectedSession}
        summary={mode === 'top' ? hottestSummary : summary}
        mode={mode === 'top'
          ? `top · ${sessions.length} sessions`
          : `inspect · ${filteredEvents.length} / ${events.length} events · sort: ${SORT_LABELS[sortMode]}${replayLabel}`}
        paused={paused}
        view={view === 'context' ? 'context' : mode}
        subagentNote={subagentNote}
        replayFile={isReplay ? replayPath : undefined}
      />
      {status ? <Text color="yellow">{status}</Text> : null}
      {exportPrepared ? (
        <RedactionConfirm
          diff={exportPrepared.diff}
          outputPath={exportPrepared.defaultPath}
          status={exportStatus}
        />
      ) : showHelp
        ? <HelpView mode={mode === 'top' ? 'top' : 'events'} />
        : mode === 'top'
          ? <TopView rows={treeSorted} selectedIndex={topIndex} />
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
              <EventList events={filteredEvents} selectedIndex={eventIndex} height={listHeight} originalIndices={filteredOriginalIdx} sortMode={sortMode} />
              {showInspector && <Inspector event={filteredEvents[eventIndex]} />}
            </>}
      <Box marginTop={1}>
        <Text color="gray">{footer}</Text>
      </Box>
    </Box>
  );
}
