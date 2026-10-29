import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { projectsDirs } from './paths.js';
import { decodeCwd } from './decode.js';
import { scanJsonl, kindOf } from './jsonlScan.js';
import { liveSessionMap } from './liveState.js';
import { readGitBranch } from './git.js';
import { readAllAnnotations } from './annotations.js';
import { findDir } from './config/paths.js';
import type { Stats } from 'node:fs';
import type { Annotation, ListOptions, LiveSession, SessionRecord, SessionView } from './types.js';

export async function listSessions(opts: ListOptions = {}): Promise<SessionRecord[]> {
  const out: SessionRecord[] = [];
  const live = liveSessionMap();
  const annotations = readAllAnnotations();
  // The session finder runs with --no-session-persistence; should a transcript appear anyway, it
  // must never list (or feed the next finder catalog). Claude encodes every non-alnum char as '-'.
  const fd = findDir();
  const finderDir = (existsSync(fd) ? realpathSync(fd) : fd).replace(/[^A-Za-z0-9]/g, '-');
  for (const root of projectsDirs()) {
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of projectDirs) {
      if (!dir.startsWith('-') || dir === finderDir) continue;
      const decoded = decodeCwd(dir);
      if (opts.cwd && decoded.cwd !== opts.cwd) continue;
      const projectPath = join(root, dir);
      let entries: string[];
      try {
        entries = readdirSync(projectPath);
      } catch {
        continue;
      }
      for (const file of entries) {
        if (!file.endsWith('.jsonl')) continue;
        const id = file.replace(/\.jsonl$/, '');
        const jsonlPath = join(projectPath, file);
        const st = statSync(jsonlPath);
        const scan = await scanJsonl(jsonlPath);
        const rec = buildRecord(id, jsonlPath, st, scan, decoded, live.get(id) ?? null, annotations.get(id), dirname(root));
        if (opts.activeOnly && !rec.active) continue;
        if (opts.kind && rec.kind !== opts.kind) continue;
        if (!inView(rec.annotation, opts.view ?? 'normal')) continue;
        out.push(rec);
      }
    }
  }
  const sortBy = opts.sortBy ?? 'updated';
  out.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    const aKey = sortBy === 'started' ? a.startedAt : a.lastUpdatedAt;
    const bKey = sortBy === 'started' ? b.startedAt : b.lastUpdatedAt;
    return bKey.getTime() - aKey.getTime();
  });
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export type SortColumn = 'used' | 'name' | 'status' | 'branch' | 'work' | 'cwd';
/** Order `o` cycles through in the TUI; the first is the default. */
export const SORT_COLUMNS: SortColumn[] = ['used', 'name', 'status', 'branch', 'work', 'cwd'];

const STATUS_RANK = { busy: 0, idle: 1, inactive: 2 } as const;

/**
 * Sort by one column. Natural order (`desc` false): newest first for `used`, busy → idle →
 * inactive for `status`, A→Z for the text columns; `desc` flips it. Rows without a value
 * (no branch, no work folder) always sink to the bottom. Ties keep the incoming order.
 */
export function sortRecords(records: SessionRecord[], col: SortColumn, desc = false): SessionRecord[] {
  const key = (r: SessionRecord): string | number | undefined => {
    switch (col) {
      case 'used': return -r.lastUpdatedAt.getTime();
      case 'status': return STATUS_RANK[r.status];
      case 'name': return r.name.toLowerCase();
      case 'branch': return r.gitBranch?.toLowerCase();
      case 'work': return r.workDir?.toLowerCase();
      case 'cwd': return r.cwd.toLowerCase();
    }
  };
  return records
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === undefined || b.k === undefined) return a.k === b.k ? a.i - b.i : a.k === undefined ? 1 : -1;
      const c = typeof a.k === 'number' ? a.k - (b.k as number) : (a.k as string).localeCompare(b.k as string);
      return (desc ? -c : c) || a.i - b.i;
    })
    .map(x => x.r);
}

function buildRecord(
  id: string,
  jsonlPath: string,
  st: Stats,
  scan: Awaited<ReturnType<typeof scanJsonl>>,
  decoded: ReturnType<typeof decodeCwd>,
  live: LiveSession | null,
  annotation: Annotation | undefined,
  configDir: string,
): SessionRecord {
  const transcriptName = scan.customTitle ?? scan.aiTitle ?? scan.firstPrompt ?? '(no prompt yet)';
  // The transcript's own last cwd beats both the pid file and the decoded directory name: those
  // two only ever know where `claude` was launched. Trust it only while it still exists on disk,
  // so a resume never drops into a directory that has since been deleted.
  const launchCwd = live?.cwd ?? decoded.cwd;
  const working = scan.lastCwd && existsSync(scan.lastCwd) ? scan.lastCwd : null;
  const cwd = working ?? launchCwd;
  const workDir = scan.workDirName ? join(homedir(), 'ClaudWork', scan.workDirName) : null;
  return {
    id,
    name: annotation?.name ?? transcriptName,
    transcriptName,
    firstPrompt: scan.firstPrompt ?? undefined,
    cwd,
    launchCwd,
    workDir: workDir && existsSync(workDir) ? workDir : undefined,
    // A directory the transcript names and that exists is not a guess, however the name decoded.
    cwdDecodeConfident: working !== null || live !== null || decoded.confident,
    jsonlPath,
    sizeBytes: st.size,
    startedAt: live ? new Date(live.startedAt) : (scan.firstTimestamp ?? st.ctime),
    lastUpdatedAt: live ? new Date(live.updatedAt) : st.mtime,
    active: !!live,
    status: live ? live.status : 'inactive',
    pid: live?.pid,
    version: live?.version,
    gitBranch: readGitBranch(cwd) ?? undefined,
    kind: kindOf(scan.entrypoint),
    entrypoint: scan.entrypoint ?? undefined,
    // A live session's pid file pins the real profile; otherwise fall back to the scan root.
    configDir: live?.profile ?? configDir,
    annotation,
  };
}

/**
 * Hidden and deleted are listing preferences only — nothing is ever removed from ~/.claude, and a
 * session excluded here still resumes normally if you address it by id.
 */
function inView(a: Annotation | undefined, view: SessionView): boolean {
  if (view === 'all') return true;
  if (view === 'hidden') return a?.hidden === true && a?.deleted !== true;
  if (view === 'deleted') return a?.deleted === true;
  return a?.hidden !== true && a?.deleted !== true;
}

export async function getSession(prefix: string): Promise<SessionRecord[]> {
  // id lookups see everything — you must be able to un-delete what you cannot list.
  const all = await listSessions({ view: 'all' });
  return all.filter(s => s.id.startsWith(prefix));
}
