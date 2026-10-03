import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, render as inkRender } from 'ink';
import TextInput from 'ink-text-input';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { listSessions } from '../core/sessionRepo.js';
import { readTranscript } from '../core/transcript.js';
import { searchSessions, type SearchMatch } from '../core/search.js';
import { formatDate, timeAgo } from './format.js';
import { resumeEnv } from './resume.js';
import { copyToClipboard, resumeCommand } from '../core/clipboard.js';
import { listProfiles, profileAccount, type Profile } from '../core/profiles.js';
import { fuzzyRank } from '../core/fuzzy.js';
import { getRecap, readCachedRecap, spawnRun } from '../core/recap.js';
import { windowFor, scrollbar } from './viewport.js';
import { useKeyChunk, upCount, downCount } from './useKeyChunk.js';
import {
  writeAnnotation, parseWhen, isReminderDue, isOverdue, detectIssueKeys, type AnnotationPatch,
} from '../core/annotations.js';
import type { SessionKind, SessionRecord, SessionStatus, SessionView, TranscriptTurn } from '../core/types.js';

interface RecapState { text?: string; loading?: boolean; error?: string }

const STATUS_DOT: Record<SessionStatus, string> = { busy: '●', idle: '●', inactive: '○' };
const STATUS_COLOR: Record<SessionStatus, 'green' | 'yellow' | 'gray'> = {
  busy: 'green',
  idle: 'yellow',
  inactive: 'gray',
};

function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

type Mode = 'list' | 'filter' | 'peek' | 'search-input' | 'search-results' | 'help' | 'annotate';
type PromptKind = 'name' | 'note' | 'flag' | 'label' | 'remind' | 'due';

const PROMPTS: Record<PromptKind, string> = {
  name: 'name (empty clears the override): ',
  note: 'note (empty clears it): ',
  flag: 'flags, space separated (-flag removes one, empty clears all): ',
  label: 'labels — Jira key, repo, topic (-label removes one, empty clears all): ',
  remind: 'remind me in / at — 2h, tomorrow 9am, 17:00 (empty clears): ',
  due: 'due — 3d, tomorrow 9am, 17:00, an ISO date (empty clears): ',
};

interface AppProps {
  initial: SessionRecord[];
  /** Router hooks. When provided, the screen hands control back instead of spawning itself. */
  onResume?: (s: SessionRecord) => void;
  onBack?: () => void;
  onQuit?: () => void;
  /** ⇥ switches to the New tab (handled by AppShell). */
  onSwitchTab?: () => void;
}

export function App({ initial, onResume, onBack, onQuit, onSwitchTab }: AppProps) {
  const { exit } = useApp();

  const doResume = (raw: SessionRecord) => {
    const s = profileOverride ? { ...raw, configDir: profileOverride.home } : raw;
    if (onResume) { onResume(s); return; }
    exit();
    const bin = process.env.AGENTCTL_CLAUDE_BIN ?? 'claude';
    spawnSync(bin, ['--resume', s.id, '--dangerously-skip-permissions'], {
      cwd: s.cwd, stdio: 'inherit', env: resumeEnv(s),
    });
  };
  const quit = () => { if (onQuit) onQuit(); else exit(); };
  const back = () => { if (onBack) onBack(); else exit(); };
  const [records, setRecords] = useState<SessionRecord[]>(initial);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [filter, setFilter] = useState('');
  const [peek, setPeek] = useState<TranscriptTurn[] | null>(null);
  const [peekOffset, setPeekOffset] = useState(0);
  const [peekFrom, setPeekFrom] = useState<'list' | 'search'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<{ kind: PromptKind; value: string } | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [sessionView, setSessionView] = useState<SessionView>('normal');
  /** null = show both. Tool runs (claude -p, the SDK, MCP) crowd out the sessions you actually sat in. */
  const [kindFilter, setKindFilter] = useState<SessionKind | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Transient footer note after `c` — cleared by the next keypress. */
  const [copied, setCopied] = useState<string | null>(null);
  /** Claude accounts on this machine; `a` cycles an override for the next resume. */
  const profiles = useMemo(() => listProfiles(), []);
  const [profileOverride, setProfileOverride] = useState<Profile | null>(null);
  /** Single-account machines — the overwhelming majority — never see any of this. */
  const multiProfile = profiles.length > 1;
  /** space-marked sessions; hide/delete/done act on these when non-empty. */
  const [marked, setMarked] = useState<Set<string>>(new Set());

  // Hidden and deleted are listing preferences only — the transcript is never touched, and the
  // records array holds everything so switching views costs nothing.
  const inView = (r: SessionRecord) => {
    const a = r.annotation;
    if (sessionView === 'hidden') return a?.hidden === true && a?.deleted !== true;
    return a?.hidden !== true && a?.deleted !== true;
  };
  const visible = records.filter(r =>
    inView(r) && !(hideDone && r.annotation?.done) && (!kindFilter || r.kind === kindFilter));
  const haystack = (r: SessionRecord) =>
    `${r.name}  ${tildify(r.cwd)}  ${r.id}  ${(r.annotation?.flags ?? []).map(f => '#' + f).join(' ')}` +
    `  ${(r.annotation?.labels ?? []).join(' ')}  ${r.annotation?.note ?? ''}`;
  const filtered = filter ? fuzzyRank(filter, visible, haystack).map(x => x.item) : visible;
  const clamped = Math.min(cursor, Math.max(0, filtered.length - 1));
  // Re-filtering shrinks the list under the cursor. Snap back to the top, otherwise the stale
  // index leaves the selection pinned to the last row and ↑ looks dead until it counts down.
  useEffect(() => { setCursor(0); }, [filter]);
  const [confirmResumeId, setConfirmResumeId] = useState<string | null>(null);
  const activeCount = records.filter(r => r.active).length;
  const doneCount = records.filter(r => r.annotation?.done).length;
  const dueCount = records.filter(r => isReminderDue(r.annotation)).length;
  const toolCount = records.filter(r => r.kind === 'tool').length;

  /** Apply an annotation patch to the highlighted session and refresh it in place. */
  const annotate = (s: SessionRecord, patch: AnnotationPatch) => {
    const a = writeAnnotation(s.id, patch);
    setRecords(rs => rs.map(r => (r.id === s.id ? { ...r, annotation: a, name: a.name ?? r.transcriptName } : r)));
  };

  /**
   * Apply to the marked sessions, or the highlighted one when nothing is marked. The cursor stays
   * where it is (clamped) rather than jumping to the top — you are usually part-way down a long
   * list and want to carry on from the same place.
   */
  const annotateTargets = (patch: AnnotationPatch) => {
    const targets = marked.size > 0 ? filtered.filter(r => marked.has(r.id)) : [filtered[clamped]];
    for (const t of targets) if (t) annotate(t, patch);
    if (marked.size > 0) setMarked(new Set());
    setCursor(Math.max(0, Math.min(clamped, filtered.length - targets.length - 1)));
  };

  const openPrompt = (kind: PromptKind) => {
    const s = filtered[clamped];
    if (!s) return;
    const a = s.annotation;
    const value = kind === 'name' ? (a?.name ?? '')
      : kind === 'note' ? (a?.note ?? '')
      : kind === 'flag' ? (a?.flags ?? []).join(' ')
      : kind === 'label' ? ((a?.labels ?? []).join(' ') || detectIssueKeys(s.gitBranch).join(' '))
      : '';
    setPrompt({ kind, value });
    setPromptError(null);
    setMode('annotate');
  };

  const submitPrompt = (raw: string) => {
    const s = filtered[clamped];
    const kind = prompt?.kind;
    if (!s || !kind) { setMode('list'); setPrompt(null); return; }
    const v = raw.trim();
    let patch: AnnotationPatch;
    if (kind === 'name') patch = { name: v || null };
    else if (kind === 'note') patch = { note: v || null };
    else if (kind === 'flag') {
      if (!v) patch = { removeFlags: s.annotation?.flags ?? [] };
      else {
        const words = v.split(/\s+/);
        patch = {
          addFlags: words.filter(w => !w.startsWith('-')),
          removeFlags: words.filter(w => w.startsWith('-')).map(w => w.slice(1)),
        };
      }
    } else if (kind === 'label') {
      if (!v) patch = { removeLabels: s.annotation?.labels ?? [] };
      else {
        const words = v.split(/\s+/);
        patch = {
          addLabels: words.filter(w => !w.startsWith('-')),
          removeLabels: words.filter(w => w.startsWith('-')).map(w => w.slice(1)),
        };
      }
    } else {
      const field = kind === 'due' ? 'dueAt' : 'remindAt';
      if (!v) patch = { [field]: null };
      else {
        const at = parseWhen(v);
        if (!at) { setPromptError(`can't read a time out of "${v}"`); return; }
        patch = { [field]: at.toISOString() };
      }
    }
    annotate(s, patch);
    setMode('list');
    setPrompt(null);
    setPromptError(null);
  };

  // Recap (R): generated lazily via `claude -p` (haiku) and cached. The highlighted row auto-shows
  // a cached recap if one exists; R generates/refreshes it. State is keyed by session id.
  const [recaps, setRecaps] = useState<Record<string, RecapState>>({});
  const selId = filtered[clamped]?.id;
  useEffect(() => {
    if (selId && recaps[selId] === undefined) {
      const cached = readCachedRecap(selId);
      if (cached) setRecaps(p => ({ ...p, [selId]: { text: cached.text } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const runRecap = (s: SessionRecord, refresh = false) => {
    if (recaps[s.id]?.loading) return;
    setRecaps(p => ({ ...p, [s.id]: { loading: true } }));
    getRecap({ id: s.id, jsonlPath: s.jsonlPath }, { refresh }, { run: spawnRun() })
      .then(r => setRecaps(p => ({ ...p, [s.id]: { text: r.text } })))
      .catch(e => setRecaps(p => ({ ...p, [s.id]: { error: e instanceof Error ? e.message : 'recap failed' } })));
  };

  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 30;
  const peekWindow = Math.max(5, rows - 6);
  const maxPeekOffset = peek ? Math.max(0, peek.length - peekWindow) : 0;

  const stopSearch = () => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearching(false);
  };

  const startSearch = (q: string) => {
    stopSearch();
    if (!q.trim()) return;
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setSearchQuery(q);
    setSearchResults([]);
    setSearchCursor(0);
    setSearching(true);
    setMode('search-results');
    (async () => {
      try {
        for await (const m of searchSessions(records, q, { signal: ac.signal })) {
          if (ac.signal.aborted) break;
          setSearchResults(prev => [...prev, m]);
        }
      } finally {
        if (searchAbortRef.current === ac) {
          searchAbortRef.current = null;
          setSearching(false);
        }
      }
    })();
  };

  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);

  const keyChunk = useKeyChunk();

  useInput((input, key) => {
    // One stdin chunk can carry many presses (held-down arrow); ink only parses the first.
    // `moved` counts vim j/k as movement — only valid where plain letters aren't text input.
    const moved = downCount(keyChunk.current) - upCount(keyChunk.current);
    const movedArrows = downCount(keyChunk.current, false) - upCount(keyChunk.current, false);
    if (mode === 'help') { setMode('list'); return; } // any key closes
    if (mode === 'filter') {
      if (key.return || key.escape) { setMode('list'); return; }
      // fzf-style: arrow through the narrowed list without leaving the filter box
      // (ink-text-input only claims ←/→, so ↑/↓ are ours). Arrows ONLY here — j and k are
      // filter text in this mode, not movement.
      if (movedArrows !== 0) setCursor(Math.max(0, Math.min(filtered.length - 1, clamped + movedArrows)));
      return;
    }
    if (mode === 'search-input') {
      if (key.escape) { setMode('list'); return; }
      return;
    }
    if (mode === 'annotate') {
      if (key.escape) { setMode('list'); setPrompt(null); setPromptError(null); }
      return; // TextInput owns the rest
    }
    if (mode === 'peek') {
      if (key.escape || input === 'p' || input === 'q') {
        setMode('list');
        setPeek(null);
        setPeekOffset(0);
        return;
      }
      if (moved !== 0) {
        setPeekOffset(o => Math.max(0, Math.min(maxPeekOffset, o - moved)));
        return;
      }
      if (key.pageUp) { setPeekOffset(o => Math.min(maxPeekOffset, o + peekWindow)); return; }
      if (key.pageDown) { setPeekOffset(o => Math.max(0, o - peekWindow)); return; }
      if (input === 'g') { setPeekOffset(maxPeekOffset); return; }
      if (input === 'G') { setPeekOffset(0); return; }
      return;
    }
    if (mode === 'search-results') {
      if (key.escape || input === 'q') {
        stopSearch();
        setMode('list');
        return;
      }
      if (input === 'x' && searching) { stopSearch(); return; }
      if (input === 's' || input === '/') {
        stopSearch();
        setSearchInput(searchQuery);
        setMode('search-input');
        return;
      }
      if (moved !== 0) setSearchCursor(c => Math.max(0, Math.min(searchResults.length - 1, c + moved)));
      if (key.pageUp) setSearchCursor(c => Math.max(0, c - searchPerView));
      if (key.pageDown) setSearchCursor(c => Math.min(searchResults.length - 1, c + searchPerView));
      if (input === 'g') setSearchCursor(0);
      if (input === 'G') setSearchCursor(Math.max(0, searchResults.length - 1));
      if (input === 'p') {
        const hit = searchResults[searchCursor];
        if (hit) {
          readTranscript(hit.session.jsonlPath)
            .then(turns => { setPeek(turns); setPeekOffset(0); })
            .catch(() => { setPeek([]); setPeekOffset(0); });
          setPeekFrom('search');
          setMode('peek');
        }
      }
      if (key.return) {
        const hit = searchResults[searchCursor];
        if (!hit) return;
        stopSearch();
        doResume(hit.session);
      }
      return;
    }
    if (copied) setCopied(null);
    if (key.tab && onSwitchTab) { onSwitchTab(); return; }
    if (input === 'q') { quit(); return; }
    if (input === '?') { setMode('help'); return; }
    if (key.escape) {
      if (confirmDeleteId) { setConfirmDeleteId(null); return; }
      if (marked.size > 0) { setMarked(new Set()); return; }
      if (confirmResumeId) { setConfirmResumeId(null); return; }
      if (filter) { setFilter(''); setCursor(0); return; } // clear filter first (matches New + GUI)
      back();
      return;
    }
    if (moved !== 0) {
      setCursor(Math.max(0, Math.min(filtered.length - 1, clamped + moved)));
      setConfirmResumeId(null);
    }
    if (key.pageUp) { setCursor(Math.max(0, clamped - rowsPerView)); setConfirmResumeId(null); }
    if (key.pageDown) { setCursor(Math.min(filtered.length - 1, clamped + rowsPerView)); setConfirmResumeId(null); }
    if (input === 'g') { setCursor(0); setConfirmResumeId(null); }
    if (input === 'G') { setCursor(Math.max(0, filtered.length - 1)); setConfirmResumeId(null); }
    if (input === '/') setMode('filter');
    if (input === 'e') { openPrompt('name'); return; }
    if (input === 'n') { openPrompt('note'); return; }
    if (input === 'f') { openPrompt('flag'); return; }
    if (input === 't') { openPrompt('remind'); return; }
    if (input === 'l') { openPrompt('label'); return; }
    if (input === 'u') { openPrompt('due'); return; }
    if (input === 'd') {
      const sel = filtered[clamped];
      if (!sel && marked.size === 0) return;
      annotateTargets({ done: marked.size > 0 ? true : !sel!.annotation?.done });
      return;
    }
    if (input === 'H') { setHideDone(v => !v); setCursor(0); return; }
    if (input === 'T') {
      setKindFilter(k => (k === null ? 'interactive' : k === 'interactive' ? 'tool' : null));
      setCursor(0);
      return;
    }
    if (input === ' ') {
      const sel = filtered[clamped];
      if (!sel) return;
      setMarked(prev => {
        const next = new Set(prev);
        if (next.has(sel.id)) next.delete(sel.id); else next.add(sel.id);
        return next;
      });
      setCursor(Math.min(filtered.length - 1, clamped + 1));   // marking walks down the list
      return;
    }
    if (input === 'h') {
      const sel = filtered[clamped];
      if (!sel && marked.size === 0) return;
      annotateTargets({ hidden: marked.size > 0 ? true : !sel!.annotation?.hidden });
      return;
    }
    if (input === 'x') {
      const sel = filtered[clamped];
      if (!sel && marked.size === 0) return;
      // Deleting removes it from every view this screen can show, so confirm, and recover
      // elsewhere: `agentctl delete --undo` or the app's Deleted view.
      const token = marked.size > 0 ? `marked:${marked.size}` : sel!.id;
      if (confirmDeleteId !== token) { setConfirmDeleteId(token); return; }
      annotateTargets({ deleted: true });
      setConfirmDeleteId(null);
      return;
    }
    if (input === 'a') {
      if (profiles.length < 2) return;
      setProfileOverride(cur => {
        const i = cur ? profiles.findIndex(p => p.home === cur.home) : -1;
        return i + 1 >= profiles.length ? null : profiles[i + 1];
      });
      return;
    }
    if (input === 'c') {
      const sel = filtered[clamped];
      if (!sel) return;
      const cmd = resumeCommand(sel.id);
      setCopied(copyToClipboard(cmd) ? cmd : 'no clipboard tool found');
      return;
    }
    if (input === 'v') {
      setSessionView(v => (v === 'hidden' ? 'normal' : 'hidden'));
      setCursor(0);
      setConfirmDeleteId(null);
      return;
    }
    if (input === 's') {
      setSearchInput(searchQuery);
      setMode('search-input');
    }
    if (input === 'p') {
      const s = filtered[clamped];
      if (s) {
        readTranscript(s.jsonlPath)
          .then(turns => { setPeek(turns); setPeekOffset(0); })
          .catch(() => { setPeek([]); setPeekOffset(0); });
        setPeekFrom('list');
        setMode('peek');
      }
    }
    if (key.ctrl && input === 'r') {
      listSessions({ view: 'all' }).then(setRecords).catch(() => { /* noop */ });
    }
    if ((input === 'r' || input === 'R') && !key.ctrl) {
      const s = filtered[clamped];
      if (s) runRecap(s, !!recaps[s.id]?.text); // refresh if one is already shown
    }
    if (key.return) {
      const s = filtered[clamped];
      if (!s) return;
      // cwd-confidence gate: decoded cwd may be wrong — confirm before resuming into it.
      if (!s.cwdDecodeConfident && confirmResumeId !== s.id) { setConfirmResumeId(s.id); return; }
      doResume(s);
    }
  });

  // Table column widths (cwd flex-fills the rest). ink truncates each cell to its Box width.
  const tableInner = Math.max(20, cols - 4);
  // Below ~70 columns the cwd-warning and annotation-badge cells cost more than they are worth:
  // keeping them makes the fixed columns wider than the table, and ink wraps every single row.
  const showExtras = cols >= 70;
  const wBranch = cols >= 90 ? 12 : 8;
  const wUsed = 14; // "Jun 09 10:43"
  const showId = cols >= 110;
  const fixedCols = 2 + 2 + (showExtras ? 9 : 0) + (showId ? 9 : 0) + 1 + wBranch + 1 + wUsed + 1 + 2;
  const wName = Math.max(10, Math.min(44, Math.floor((tableInner - fixedCols) * 0.6)));
  // The list is the ONLY elastic block on screen, so its height is whatever the fixed chrome
  // and the (content-sized) details pane leave over. Guessing a constant here is what pushed
  // the header off-screen whenever a note, a recap or a prompt appeared.
  const sel = filtered[clamped];
  const selRecap = sel ? recaps[sel.id] : undefined;
  const CHROME = 10;      // tab bar 2 + header 2 + gap 1 + table border/header 3 + footer 2
  const MIN_LIST = 3;     // the list never shrinks below this — the details pane yields first
  const promptHeight = mode === 'filter' ? 2 : mode === 'annotate' ? (promptError ? 3 : 2) : 0;

  // The details pane is content-sized but must never grow past what the terminal has left, or it
  // pushes the header off screen. Size its variable parts against the leftover budget, and drop
  // the pane entirely on a terminal too short for even its fixed rows.
  const detailsFixed = sel
    ? 2 + 4 + (multiProfile ? 1 : 0) + (sel.annotation ? 1 : 0) + (confirmResumeId === sel.id ? 1 : 0) + 1
    : 0;
  const detailsBudget = rows - CHROME - promptHeight - MIN_LIST;
  const showDetails = !!sel && detailsBudget >= detailsFixed;
  const spare = showDetails ? Math.max(0, detailsBudget - detailsFixed) : 0;
  const noteLines = Math.min(
    sel?.annotation?.note ? Math.min(3, sel.annotation.note.split('\n').length) : 0,
    spare,
  );
  const recapBodyLines = Math.min(
    selRecap?.text ? Math.min(6, selRecap.text.split('\n').filter(l => l.trim()).length) : 1,
    spare - noteLines,
  );
  const detailsHeight = showDetails ? detailsFixed + noteLines + recapBodyLines : 0;
  const rowsPerView = Math.max(MIN_LIST, rows - CHROME - promptHeight - detailsHeight);
  const { start, end: viewEnd } = windowFor(filtered.length, clamped, rowsPerView);
  const view = filtered.slice(start, viewEnd);
  const listBar = scrollbar(filtered.length, start, view.length);
  // Search hits are two lines each and used to render ALL at once, overflowing any terminal.
  const searchPerView = Math.max(2, Math.floor((rows - 10) / 2));
  const { start: searchStart, end: searchEnd } = windowFor(searchResults.length, searchCursor, searchPerView);
  const searchView = searchResults.slice(searchStart, searchEnd);

  const renderHeader = () => (
    <Box flexDirection="column">
      <Box>
        <Text bold color={sessionView === 'hidden' ? 'yellow' : 'cyan'}>
          {sessionView === 'hidden' ? 'resume · hidden' : 'resume'}
        </Text>
        <Text dimColor>   </Text>
        <Text color="white">{records.length}</Text>
        <Text dimColor> sessions  ·  </Text>
        <Text color="green">{activeCount}</Text>
        <Text dimColor> active</Text>
        {marked.size > 0 ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color="green" bold>✓ {marked.size}</Text>
            <Text dimColor> marked</Text>
          </>
        ) : null}
        {dueCount > 0 ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color="red" bold>◆ {dueCount}</Text>
            <Text dimColor> due</Text>
          </>
        ) : null}
        {doneCount > 0 ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color="green">{doneCount}</Text>
            <Text dimColor> done{hideDone ? ' (hidden)' : ''}</Text>
          </>
        ) : null}
        {toolCount > 0 ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color={kindFilter ? 'yellow' : 'gray'}>
              {kindFilter === 'interactive' ? 'interactive only'
                : kindFilter === 'tool' ? 'tool runs only'
                : `▸ ${toolCount} tool`}
            </Text>
          </>
        ) : null}
        {filter ? (
          <>
            <Text dimColor>  ·  filter </Text>
            <Text color="yellow">{filter}</Text>
          </>
        ) : null}
        {mode !== 'search-results' ? (
          <>
            <Text dimColor>  ·  </Text>
            <Text color="gray">{filtered.length === 0 ? 0 : clamped + 1}/{filtered.length}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text color="green">●</Text>
        <Text dimColor> busy   </Text>
        <Text color="yellow">●</Text>
        <Text dimColor> idle   </Text>
        <Text color="gray">○</Text>
        <Text dimColor> inactive</Text>
        {toolCount > 0 ? (
          <>
            <Text dimColor>   </Text>
            <Text color="gray">▸</Text>
            <Text dimColor> tool run (T filters)</Text>
          </>
        ) : null}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column">
      {renderHeader()}

      {mode === 'filter' ? (
        <Box marginTop={1}>
          <Text color="yellow">filter: </Text>
          <TextInput value={filter} onChange={setFilter} onSubmit={() => setMode('list')} />
        </Box>
      ) : null}

      {mode === 'annotate' && prompt ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="yellow">{PROMPTS[prompt.kind]}</Text>
            <TextInput
              value={prompt.value}
              onChange={(v) => setPrompt(p => (p ? { ...p, value: v } : p))}
              onSubmit={submitPrompt}
            />
          </Box>
          {promptError ? <Text color="red">{promptError}</Text> : null}
        </Box>
      ) : null}

      {mode === 'search-input' ? (
        <Box marginTop={1}>
          <Text color="magenta">search: </Text>
          <TextInput
            value={searchInput}
            onChange={setSearchInput}
            onSubmit={(v) => { startSearch(v); }}
          />
          <Text dimColor>   (enter to run, esc to cancel)</Text>
        </Box>
      ) : null}

      {mode === 'list' || mode === 'filter' || mode === 'annotate' ? (
        <Box marginTop={1} flexDirection="column">
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
            <TableHeader wName={wName} wBranch={wBranch} wUsed={wUsed} extras={showExtras} showId={showId} />
            {view.map((r, i) => (
              <Row key={r.id} r={r} selected={start + i === clamped} marked={marked.has(r.id)} wName={wName} wBranch={wBranch} wUsed={wUsed} bar={listBar[i]} extras={showExtras} showId={showId} />
            ))}
            {filtered.length === 0 ? (
              <Text dimColor>{records.length === 0 ? '(no sessions yet)' : `(no matches for "${filter}")`}</Text>
            ) : null}
          </Box>
          {showDetails && sel ? (
            <DetailsPane
              s={sel}
              recap={selRecap}
              confirming={confirmResumeId === sel.id}
              deleting={confirmDeleteId === sel.id || !!confirmDeleteId?.startsWith('marked:')}
              deletingCount={confirmDeleteId?.startsWith('marked:') ? marked.size : 1}
              account={multiProfile ? (profileOverride?.account ?? (sel.configDir ? profileAccount(sel.configDir) : null)) : null}
              overridden={!!profileOverride}
              maxNoteLines={noteLines}
              maxRecapLines={recapBodyLines}
              narrow={cols < 70}
            />
          ) : null}
        </Box>
      ) : null}

      {mode === 'search-results' ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="magenta">🔍 </Text>
            <Text color="white" bold>{searchQuery}</Text>
            <Text dimColor>   </Text>
            <Text color="cyan">{searchResults.length}</Text>
            <Text dimColor> matches</Text>
            {searching ? (
              <>
                <Text dimColor>   </Text>
                <Text color="yellow">searching…</Text>
                <Text dimColor>   x stop</Text>
              </>
            ) : (
              <>
                <Text dimColor>   </Text>
                <Text color="green">done</Text>
              </>
            )}
            {searchResults.length > 0 ? (
              <>
                <Text dimColor>   </Text>
                <Text color="gray">{searchCursor + 1}/{searchResults.length}</Text>
              </>
            ) : null}
            <Text dimColor>   s/.  new search   ·  esc back</Text>
          </Box>
          {searchResults.length === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>{searching ? '(no matches yet)' : '(no matches)'}</Text>
            </Box>
          ) : (
            <Box marginTop={1} flexDirection="column">
              {searchView.map((m, vi) => {
                const i = searchStart + vi;
                const isSel = i === searchCursor;
                const marker = isSel ? '▶' : ' ';
                return (
                  <Box key={m.session.id + ':' + m.matchedLine} flexDirection="column">
                    <Box>
                      <Text bold color={isSel ? 'yellow' : 'gray'}>{marker} </Text>
                      <Text color={STATUS_COLOR[m.session.status]} bold>{STATUS_DOT[m.session.status]}</Text>
                      <Text>  </Text>
                      <Text bold color={isSel ? 'cyan' : 'white'}>{m.session.name}</Text>
                      <Text dimColor>   </Text>
                      <Text color="magenta">{m.session.id.slice(0, 8)}</Text>
                      <Text dimColor>   </Text>
                      <Text color="cyan">{formatDate(m.session.lastUpdatedAt)}</Text>
                      <Text dimColor> (</Text>
                      <Text color="yellow">{timeAgo(m.session.lastUpdatedAt)}</Text>
                      <Text dimColor>)</Text>
                    </Box>
                    <Box marginLeft={4}>
                      <Text dimColor>… </Text>
                      <Text color={isSel ? 'white' : 'gray'}>{highlight(m.excerpt, searchQuery, cols - 10)}</Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      ) : null}

      {mode === 'help' ? (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">keys — Resume</Text>
          <HelpSection t="move & open" />
          <HelpRow k="↑/↓  j/k" v="move the selection" />
          <HelpRow k="pgup/pgdn" v="page through the list   ·   g / G  jump to first / last" />
          <HelpRow k="⏎" v="resume the highlighted session where it left off" />
          <HelpRow k="p" v="peek its transcript (↑/↓ · g/G · pgup/pgdn to scroll)" />
          <HelpRow k="r" v="recap what it was about — claude -p, haiku, cached" />
          <HelpRow k="c" v="copy `agentctl resume <id>` — paste it in any terminal" />
          <HelpSection t="find" />
          <HelpRow k="/" v="fuzzy-filter on name, path, id, labels, flags, note" />
          <HelpRow k="s" v="full-text search inside every transcript" />
          <HelpRow k="H" v="show / hide the sessions marked done" />
          <HelpRow k="T" v="tool runs: everything → interactive only → tool runs only" />
          <HelpRow k="v" v="show the hidden sessions (deleted are CLI/app only)" />
          <HelpSection t="annotate the highlighted session" />
          <HelpRow k="e / n" v="name it / attach a note" />
          <HelpRow k="l / f" v="labels — Jira key, repo, topic (l pre-fills it from the branch) / flags" />
          <HelpRow k="t / u" v="remind me at… / work is due at…   2h · 3d · tomorrow 9am · 17:00" />
          <HelpRow k="d" v="done — greys it out and silences its reminder" />
          <HelpRow k="space" v="mark rows; h, x and d then act on every marked one" />
          <HelpRow k="h / x" v="hide / delete (twice). Listing only — the transcript is untouched" />
          <HelpSection t="other" />
          {multiProfile ? <HelpRow k="a" v="cycle which Claude account the resume runs under" /> : null}
          <HelpRow k="^r  ⇥  q" v="rescan from disk   ·   switch to New   ·   quit" />
          {rows >= 40 ? (
            <Box marginTop={1} flexDirection="column">
              <Box>
                <Text color="gray">▸</Text><Text dimColor> tool run   </Text>
                <Text color="green">✓</Text><Text dimColor> done   </Text>
                <Text color="yellow">⚑</Text><Text dimColor> flagged   </Text>
                <Text color="cyan">✎</Text><Text dimColor> noted   </Text>
                <Text color="magenta">◆</Text><Text dimColor> reminder   </Text>
                <Text color="blue">✱</Text><Text dimColor> due date   </Text>
                <Text color="yellow">!</Text><Text dimColor> cwd is a guess</Text>
              </Box>
              <Text dimColor>◆ and ✱ turn red once due. ! = the working directory could not be decoded with</Text>
              <Text dimColor>confidence; ⏎ twice to resume there anyway.</Text>
            </Box>
          ) : null}
          <Box marginTop={1}><Text dimColor>press any key to close</Text></Box>
        </Box>
      ) : null}

      {mode === 'peek' && peek ? (() => {
        const wide = cols >= 120;
        const railW = wide ? 34 : 0;
        const peekCols = wide ? cols - railW - 5 : cols;
        const total = peek.length;
        const end = total - peekOffset;
        const sliceStart = Math.max(0, end - peekWindow);
        const visible = peek.slice(sliceStart, end);
        const fromSearch = peekFrom === 'search' && !!searchResults[searchCursor];
        const sel = fromSearch ? searchResults[searchCursor].session : filtered[clamped];

        const peekBox = (
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
            <Box>
              <Text bold color="cyan">peek </Text>
              {sel ? <Text bold color="white">{sel.name}</Text> : null}
              <Text dimColor>   </Text>
              <Text color="cyan">{sliceStart + 1}</Text>
              <Text dimColor>–</Text>
              <Text color="cyan">{end}</Text>
              <Text dimColor> of </Text>
              <Text color="cyan">{total}</Text>
              <Text dimColor>   ↑ older · ↓ newer · pgup/pgdn · g/G · esc close</Text>
            </Box>
            {visible.length === 0 ? (
              <Text dimColor>(empty)</Text>
            ) : visible.map((t, i) => {
              const color = t.role === 'user'
                ? 'cyan'
                : t.role === 'assistant'
                  ? 'green'
                  : t.role === 'tool'
                    ? 'yellow'
                    : 'gray';
              const oneLine = t.text.replace(/[\r\n]+/g, ' ⏎ ').replace(/\s+/g, ' ').trim();
              const tag = `[${t.role}] `;
              const budget = Math.max(20, peekCols - 6 - tag.length);
              const text = oneLine.length > budget ? oneLine.slice(0, budget - 1) + '…' : oneLine;
              return (
                <Box key={sliceStart + i}>
                  <Text color={color}>{tag}</Text>
                  <Text>{text}</Text>
                </Box>
              );
            })}
          </Box>
        );

        if (!wide) return <Box marginTop={1}>{peekBox}</Box>;

        // Wide terminal: keep a slim session rail on the left for context while reading.
        const list = fromSearch ? searchResults.map((m) => m.session) : filtered;
        const cur = fromSearch ? searchCursor : clamped;
        const railStart = Math.max(0, Math.min(Math.max(0, list.length - peekWindow), cur - Math.floor(peekWindow / 2)));
        const railSlice = list.slice(railStart, railStart + peekWindow);
        return (
          <Box marginTop={1} flexDirection="row">
            <Box flexDirection="column" width={railW} marginRight={1}>
              {railSlice.map((r, i) => {
                const isSel = railStart + i === cur;
                const name = r.name.length > railW - 4 ? r.name.slice(0, railW - 5) + '…' : r.name;
                return (
                  <Box key={r.id}>
                    <Text bold color={isSel ? 'yellow' : 'gray'}>{isSel ? '▶ ' : '  '}</Text>
                    <Text color={STATUS_COLOR[r.status]}>{STATUS_DOT[r.status]}</Text>
                    <Text> </Text>
                    <Text color={isSel ? 'cyan' : 'white'}>{name}</Text>
                  </Box>
                );
              })}
            </Box>
            {peekBox}
          </Box>
        );
      })() : null}

      {mode === 'peek' && !peek ? (
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">peek </Text>
          <Text dimColor>loading transcript…</Text>
        </Box>
      ) : null}

      {mode !== 'peek' && mode !== 'search-input' && mode !== 'help' ? (
        <Box marginTop={1}>
          {copied ? (
            <Text color="green" wrap="truncate-end">✓ copied to clipboard: {copied}</Text>
          ) : mode === 'search-results' ? (
            <>
              <Text dimColor>↑/↓ </Text>
              <Text color="white">move</Text>
              <Text dimColor>  ·  enter </Text>
              <Text color="white">resume</Text>
              <Text dimColor>  ·  p </Text>
              <Text color="white">peek</Text>
              <Text dimColor>  ·  s </Text>
              <Text color="white">new search</Text>
              {searching ? (
                <>
                  <Text dimColor>  ·  x </Text>
                  <Text color="white">stop</Text>
                </>
              ) : null}
              <Text dimColor>  ·  esc </Text>
              <Text color="white">back</Text>
            </>
          ) : (
            <>
              <Text dimColor>↑/↓ </Text><Text color="white">move</Text>
              <Text dimColor> · ⏎ </Text><Text color="white">resume</Text>
              <Text dimColor> · / </Text><Text color="white">filter</Text>
              {/* Each hint that does not fit wraps the footer and steals a list row, so the
                  tiers below are sized to what actually renders. `?` has the full keymap. */}
              {cols >= 70 ? (<><Text dimColor> · s </Text><Text color="white">search</Text></>) : null}
              {cols >= 100 ? (
                <>
                  <Text dimColor> · space </Text><Text color="white">mark</Text>
                  <Text dimColor> · c </Text><Text color="white">copy</Text>
                  <Text dimColor> · h </Text><Text color="white">hide</Text>
                  <Text dimColor> · x </Text><Text color="white">delete</Text>
                  <Text dimColor> · v </Text><Text color="white">hidden</Text>
                </>
              ) : null}
              {cols >= 140 ? (
                <>
                  <Text dimColor> · r </Text><Text color="white">recap</Text>
                  <Text dimColor> · p </Text><Text color="white">peek</Text>
                  <Text dimColor> · e/n/f/l/t/u/d </Text><Text color="white">annotate</Text>
                </>
              ) : null}
              <Text dimColor> · ? </Text><Text color="white">help</Text>
              <Text dimColor> · q </Text><Text color="white">quit</Text>
            </>
          )}

        </Box>
      ) : null}
    </Box>
  );
}

function TableHeader({ wName, wBranch, wUsed, extras, showId }: {
  wName: number; wBranch: number; wUsed: number; extras: boolean; showId: boolean;
}) {
  return (
    <Box>
      <Box width={4} flexShrink={0}><Text dimColor bold>ST</Text></Box>
      {extras ? <Box width={2} flexShrink={0}><Text dimColor bold> </Text></Box> : null}
      {extras ? <Box width={2} flexShrink={0}><Text dimColor bold> </Text></Box> : null}
      <Box width={wName} marginRight={1} flexShrink={0}><Text dimColor bold>NAME</Text></Box>
      {extras ? <Box width={5} flexShrink={0}><Text dimColor bold> </Text></Box> : null}
      {showId ? <Box width={9} flexShrink={0}><Text dimColor bold>ID</Text></Box> : null}
      <Box width={wBranch} marginRight={1} flexShrink={0}><Text dimColor bold>BRANCH</Text></Box>
      <Box width={wUsed} marginRight={1} flexShrink={0}><Text dimColor bold>LAST USED</Text></Box>
      <Box flexGrow={1} minWidth={0}><Text dimColor bold>CWD</Text></Box>
      <Box width={1} marginLeft={1} flexShrink={0}><Text dimColor> </Text></Box>
    </Box>
  );
}

/** One-cell marks for the annotation state. Every glyph here measures 1 column. */
function badgeMarks(r: SessionRecord): Array<{ ch: string; color: string }> {
  const a = r.annotation;
  if (!a) return [];
  const out: Array<{ ch: string; color: string }> = [];
  if (a.done) out.push({ ch: '✓', color: 'green' });
  if (a.flags.length) out.push({ ch: '⚑', color: 'yellow' });
  if (a.note) out.push({ ch: '✎', color: 'cyan' });
  if (a.remindAt) out.push({ ch: '◆', color: isReminderDue(a) ? 'red' : 'magenta' });
  if (a.dueAt) out.push({ ch: '✱', color: isOverdue(a) ? 'red' : 'blue' });
  return out;
}

function Row({ r, selected, marked, wName, wBranch, wUsed, bar, extras, showId }: {
  r: SessionRecord; selected: boolean; marked: boolean;
  wName: number; wBranch: number; wUsed: number;
  bar?: string; extras: boolean; showId: boolean;
}) {
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text bold color={marked ? 'green' : selected ? 'yellow' : 'gray'}>
          {marked ? '✓' : selected ? '▶' : ' '}
        </Text>
      </Box>
      <Box width={2} flexShrink={0}><Text color={STATUS_COLOR[r.status]} bold>{STATUS_DOT[r.status]}</Text></Box>
      {extras ? <Box width={2} flexShrink={0}><Text bold color="yellow">{r.cwdDecodeConfident ? ' ' : '!'}</Text></Box> : null}
      {extras ? <Box width={2} flexShrink={0}><Text color="gray">{r.kind === 'tool' ? '▸' : ' '}</Text></Box> : null}
      <Box width={wName} marginRight={1} flexShrink={0}>
        <Text bold={selected} color={selected ? 'cyan' : 'white'} wrap="truncate-end">{r.name}</Text>
      </Box>
      {extras ? (
        <Box width={5} flexShrink={0}>
          {badgeMarks(r).map((m, i) => <Text key={i} color={m.color}>{m.ch}</Text>)}
        </Box>
      ) : null}
      {showId ? <Box width={9} flexShrink={0}><Text dimColor>{r.id.slice(0, 8)}</Text></Box> : null}
      <Box width={wBranch} marginRight={1} flexShrink={0}><Text color="magenta" wrap="truncate-end">{r.gitBranch ?? '–'}</Text></Box>
      <Box width={wUsed} marginRight={1} flexShrink={0}><Text color="cyan" wrap="truncate-end">{formatDate(r.lastUpdatedAt)}</Text></Box>
      <Box flexGrow={1} minWidth={0}><Text color="green" wrap="truncate-middle">{tildify(r.cwd)}</Text></Box>
      {bar ? <Box width={1} marginLeft={1} flexShrink={0}><Text dimColor>{bar}</Text></Box> : null}
    </Box>
  );
}

/** Always-visible "more info" for the highlighted row (Roy's ask): full metadata + last-used + recap. */
function DetailsPane({ s, recap, confirming, deleting, deletingCount, account, overridden, maxNoteLines, maxRecapLines, narrow }: {
  s: SessionRecord; recap?: RecapState; confirming: boolean; deleting: boolean;
  /** How many sessions the pending delete would take — >1 when marks are set. */
  deletingCount: number;
  /** Account this session will resume under, and whether `a` overrode it. */
  account: string | null; overridden: boolean;
  /** Line budgets computed by the caller — the pane must not render more than the screen has. */
  maxNoteLines: number; maxRecapLines: number;
  /** Too narrow for both timestamps on one row; keep the one that matters. */
  narrow: boolean;
}) {
  const recapLines = recap?.text
    ? recap.text.split('\n').filter((l) => l.trim()).slice(0, maxRecapLines)
    : null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color="cyan">details  </Text>
        <Text bold color="white" wrap="truncate-end">{s.name}</Text>
      </Box>
      <Box>
        {/* The full uuid plus status plus branch overflows a narrow pane and wraps onto a second
            line, which the height budget has not paid for. Shorten instead of wrapping. */}
        <Text color="magenta">{narrow ? s.id.slice(0, 8) : s.id}</Text>
        <Text dimColor>   </Text>
        <Text color={STATUS_COLOR[s.status]}>{STATUS_DOT[s.status]} {s.status}</Text>
        {s.kind === 'tool' ? (
          <Text color="gray">   ▸ tool run{s.entrypoint && !narrow ? ` (${s.entrypoint})` : ''}</Text>
        ) : null}
        {s.gitBranch && !narrow ? (<><Text dimColor>   ⎇ </Text><Text color="magenta">{s.gitBranch}</Text></>) : null}
        {!s.cwdDecodeConfident ? <Text color="yellow">{narrow ? '  ⚠' : '   ⚠ cwd uncertain'}</Text> : null}
      </Box>
      {account ? (
        <Box>
          <Text dimColor>resumes as </Text>
          <Text color={overridden ? 'yellow' : 'blue'}>{account}</Text>
          {overridden ? <Text color="yellow"> (a to change)</Text> : null}
        </Box>
      ) : null}
      <Box>
        {narrow ? null : (
          <>
            <Text dimColor>started </Text><Text color="blue">{formatDate(s.startedAt)}</Text>
            <Text dimColor>   ·   </Text>
          </>
        )}
        <Text dimColor>last used </Text><Text color="cyan">{formatDate(s.lastUpdatedAt)}</Text>
        <Text dimColor> (</Text><Text color="yellow">{timeAgo(s.lastUpdatedAt)}</Text><Text dimColor> ago)</Text>
      </Box>
      <Box>
        <Text color="green" wrap="truncate-middle">{tildify(s.cwd)}</Text>
        {s.launchCwd !== s.cwd && !narrow ? (
          <Text dimColor wrap="truncate-end">   (launched in {tildify(s.launchCwd)})</Text>
        ) : null}
      </Box>
      {s.annotation ? (
        <Box>
          {s.annotation.done ? <Text color="green">✓ done   </Text> : null}
          {s.annotation.labels.map(l => <Text key={l} color="blue">[{l}] </Text>)}
          {s.annotation.flags.map(f => <Text key={f} color="yellow">#{f} </Text>)}
          {s.annotation.remindAt ? (
            <Text color={isReminderDue(s.annotation) ? 'red' : 'magenta'}>
              {'  ◆ '}{isReminderDue(s.annotation) ? 'due ' : 'remind '}{formatDate(new Date(s.annotation.remindAt))}
            </Text>
          ) : null}
          {s.annotation.dueAt ? (
            <Text color={isOverdue(s.annotation) ? 'red' : 'blue'}>
              {'  ✱ '}{isOverdue(s.annotation) ? 'OVERDUE ' : 'due '}{formatDate(new Date(s.annotation.dueAt))}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {s.annotation?.note && maxNoteLines > 0
        ? s.annotation.note.split('\n').slice(0, maxNoteLines).map((l, i) => (
            <Text key={i} color="cyan" wrap="truncate-end">✎ {l}</Text>
          ))
        : null}
      <Box flexDirection="column">
        <Text bold color={recapLines ? 'green' : 'gray'}>recap</Text>
        {maxRecapLines <= 0 ? null : recap?.loading ? (
          <Text color="yellow">generating… (claude -p · haiku)</Text>
        ) : recap?.error ? (
          <Text color="red" wrap="truncate-end">{recap.error}</Text>
        ) : recapLines ? (
          recapLines.map((l, i) => <Text key={i} color="white" wrap="truncate-end">{l}</Text>)
        ) : (
          <Text dimColor>press R to generate a recap</Text>
        )}
      </Box>
      {deleting ? (
        <Box>
          <Text color="red">x again to delete {deletingCount > 1 ? `${deletingCount} marked sessions` : 'this'} — </Text>
          <Text dimColor>gone from this menu. Recover with `agentctl delete --undo` or the app's Deleted view. The transcript is untouched.</Text>
        </Box>
      ) : null}
      {confirming ? (
        <Box>
          <Text color="yellow">⚠ cwd uncertain — </Text>
          <Text bold color="yellow">Enter</Text>
          <Text color="yellow"> again to resume anyway, </Text>
          <Text bold color="yellow">esc</Text>
          <Text color="yellow"> to cancel</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Section heading inside the `?` panel — the flat key list read as one long soup. */
function HelpSection({ t }: { t: string }) {
  return <Text bold color="yellow">{'\n'}{t}</Text>;
}

function HelpRow({ k, v }: { k: string; v: string }) {
  return (
    <Box>
      <Box width={12}><Text color="cyan">{k}</Text></Box>
      <Text dimColor>{v}</Text>
    </Box>
  );
}

function highlight(text: string, query: string, maxLen: number): string {
  const t = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
  return t;
}

export async function runTui(): Promise<void> {
  const records = await listSessions({ view: 'all' });
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  const { waitUntilExit } = inkRender(<App initial={records} />);
  await waitUntilExit();
}
