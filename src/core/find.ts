import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { findDir } from './config/paths.js';
import { readCachedRecap, spawnRun, type RecapRun } from './recap.js';
import type { SessionRecord } from './types.js';

// "Find me the session where we…" — ask Claude to pick sessions from a compact metadata catalog.
// One isolated `claude -p` turn, no tools. The chat history lives here (resent each turn), so no
// finder transcript is ever written. Isolation flags are mandatory: without them Roy's plugins, MCP
// servers and CLAUDE.md load into every run (measured $0.75 / 32 s vs $0.0003 / 3 s).

export class FindError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'FindError';
  }
}

export interface FindMatch { session: SessionRecord; why: string }
export interface FindTurn { role: 'user' | 'finder'; text: string; ids?: string[] }
export interface FindResult { reply: string; matches: FindMatch[] }

export interface FindDeps {
  /** Agent spawn (tests). Default: spawnRun(bin, { cwd: findDir(), signal }). */
  run?: (args: string[], input: string) => RecapRun | Promise<RecapRun>;
  signal?: AbortSignal;
  /** Default $AGENTCTL_FIND_MODEL → 'haiku'. */
  model?: string;
  /** Default $AGENTCTL_CLAUDE_BIN → 'claude'. */
  bin?: string;
  now?: () => Date;
  /** Cached recap text for a session, or null. Default: readCachedRecap (never generates). */
  readRecap?: (id: string) => string | null;
}

// shortcut: catalog = metadata only (no transcript grep), newest 400 interactive + 100 tool rows;
// add a Grep tool (`--tools Grep --add-dir <projects>`) if real questions miss mid-transcript topics.
export const MAX_INTERACTIVE = 400;
export const MAX_TOOL = 100;
export const MAX_HISTORY = 8;
export const MAX_MATCHES = 10;

export const FIND_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'matches'],
  properties: {
    reply: { type: 'string' },
    matches: {
      type: 'array',
      maxItems: MAX_MATCHES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
});

const stamp = (d: Date) => d.toLocaleString('sv-SE').slice(0, 16); // 2026-10-27 14:03, local time

export function systemPrompt(now: Date): string {
  const human = now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return [
    'You are the session finder inside agentctl, a terminal tool that lists past Claude Code sessions.',
    'The user describes a session from memory. Pick the catalog rows that match and explain briefly.',
    `Now: ${stamp(now)} local (${human}). Catalog rows are newest first. Row fields:`,
    'id | used (last activity) | started | [tool] marks an automated run | name | title (original',
    'title when the user renamed it) | cwd | work (ClaudWork folder) | labels | note | first (first',
    'prompt) | recap.',
    'Rules:',
    '- Read relative time ("past few days", "last week") against Now and prefer rows whose "used" date',
    '  fits; if nothing recent fits, include the best older match and say it is older.',
    '- Match meaning, not exact words (WAF = web application firewall; "deploying" covers helm,',
    '  terraform, argocd, release). A Jira key, repo or folder name in the question is a strong signal.',
    '- Prefer interactive sessions. [tool] rows are automated helpers (recaps, subagents): include them',
    '  only when the question clearly asks for one or nothing else fits.',
    '- A row whose first prompt is itself a request to find a session is an earlier search, not the work:',
    '  rank it below the sessions where the work happened.',
    `- At most ${MAX_MATCHES} matches, best first. Copy the id exactly from the row. Never invent an id.`,
    '- reply: 1-3 plain sentences for a terminal: what you found, what separates the top candidates,',
    '  or which detail would narrow it down. No markdown, no lists.',
    '- why: at most 15 words per match: what in the row matches.',
    '- Follow-up messages refine the same search: keep earlier matches unless the user rules them out.',
  ].join('\n');
}

/** Model text goes straight to the terminal: no ESC/CSI/OSC (e.g. an injected OSC 52 clipboard write). */
const plain = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function catalogRow(r: SessionRecord, readRecap: (id: string) => string | null): string {
  const a = r.annotation;
  const parts = [r.id.slice(0, 8), `used ${stamp(r.lastUpdatedAt)}`, `started ${stamp(r.startedAt).slice(0, 10)}`];
  if (r.kind === 'tool') parts.push('[tool]');
  parts.push(`name: ${clip(r.name, 100)}`);
  if (r.transcriptName !== r.name && r.transcriptName !== r.firstPrompt) parts.push(`title: ${clip(r.transcriptName, 100)}`);
  parts.push(`cwd: ${tildify(r.cwd)}`);
  if (r.workDir) parts.push(`work: ${basename(r.workDir)}`);
  if (a?.labels.length) parts.push(`labels: ${a.labels.join(' ')}`);
  if (a?.note) parts.push(`note: ${clip(a.note, 80)}`);
  if (r.firstPrompt && r.firstPrompt !== r.name) parts.push(`first: ${clip(r.firstPrompt, 140)}`);
  const recap = readRecap(r.id)?.split('\n').find(l => l.trim());
  if (recap) parts.push(`recap: ${clip(recap, 120)}`);
  return parts.join(' | ');
}

/** Newest-first catalog block (header + one row per session), capped per kind. Pure. */
export function buildCatalog(records: SessionRecord[], deps: FindDeps = {}): string {
  const readRecap = deps.readRecap ?? ((id: string) => readCachedRecap(id)?.text ?? null);
  let interactive = 0;
  let tool = 0;
  const picked = [...records]
    .sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime())
    .filter(r => (r.kind === 'tool' ? tool++ < MAX_TOOL : interactive++ < MAX_INTERACTIVE));
  return [`=== CATALOG: ${picked.length} sessions, newest first ===`, ...picked.map(r => catalogRow(r, readRecap))].join('\n');
}

/** Parse `claude -p --output-format json` stdout into matches against known sessions. Pure. */
export function parseFindOutput(stdout: string, records: SessionRecord[]): FindResult {
  let out: { is_error?: boolean; result?: unknown; structured_output?: { reply?: unknown; matches?: unknown } };
  try {
    out = JSON.parse(stdout);
  } catch {
    const last = stdout.trim().split('\n').pop() ?? '';
    try { out = JSON.parse(last); } catch {
      throw new FindError(1, `claude returned no JSON: ${clip(stdout, 120)}`);
    }
  }
  if (out.is_error) throw new FindError(1, typeof out.result === 'string' && out.result ? out.result : 'claude reported an error');
  const so = out.structured_output;
  if (!so || typeof so !== 'object') throw new FindError(1, 'claude did not return a structured answer');
  const seen = new Set<string>();
  const matches: FindMatch[] = [];
  for (const m of Array.isArray(so.matches) ? so.matches : []) {
    const id = (m as { id?: unknown })?.id;
    if (typeof id !== 'string' || id.length < 4) continue;
    const hits = records.filter(r => r.id.startsWith(id));
    if (hits.length !== 1 || seen.has(hits[0].id)) continue; // unknown or ambiguous id → dropped
    seen.add(hits[0].id);
    const why = (m as { why?: unknown }).why;
    matches.push({ session: hits[0], why: typeof why === 'string' ? plain(why) : '' });
  }
  return { reply: typeof so.reply === 'string' ? plain(so.reply) : '', matches: matches.slice(0, MAX_MATCHES) };
}

function turnLine(t: FindTurn): string {
  if (t.role === 'user') return `user: ${t.text}`;
  return `finder: ${t.text}${t.ids?.length ? ` [matched: ${t.ids.join(', ')}]` : ''}`;
}

/** Ask Claude which of `records` the user means. `history` = earlier turns of this chat. */
export async function findSessions(
  records: SessionRecord[],
  history: FindTurn[],
  question: string,
  deps: FindDeps = {},
): Promise<FindResult> {
  const model = deps.model ?? process.env.AGENTCTL_FIND_MODEL ?? 'haiku';
  const bin = deps.bin ?? process.env.AGENTCTL_CLAUDE_BIN ?? 'claude';
  const now = (deps.now ?? (() => new Date()))();
  const args = [
    '-p', '--model', model, '--output-format', 'json', '--json-schema', FIND_SCHEMA,
    '--system-prompt', systemPrompt(now), '--tools', '', '--no-session-persistence',
    '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands',
  ];
  const input = [
    buildCatalog(records, deps),
    '=== CONVERSATION ===',
    ...history.slice(-MAX_HISTORY).map(turnLine),
    `user: ${question}`,
  ].join('\n') + '\n';
  let run = deps.run;
  if (!run) {
    // Empty dedicated cwd: no project CLAUDE.md or settings for `--setting-sources project` to find.
    const cwd = findDir();
    mkdirSync(cwd, { recursive: true });
    run = spawnRun(bin, { cwd, signal: deps.signal });
  }
  const res = await run(args, input);
  if (deps.signal?.aborted || res.error?.name === 'AbortError') throw new FindError(130, 'cancelled');
  if ((res.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new FindError(127, `${bin} not found on PATH (override via AGENTCTL_CLAUDE_BIN)`);
  }
  if (!res.stdout.trim()) throw new FindError(res.status || 1, `claude exited ${res.status ?? '?'} with no output`);
  return parseFindOutput(res.stdout, records);
}
