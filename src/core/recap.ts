import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configDir } from './config/paths.js';
import { readTranscript } from './transcript.js';

// On-demand session recap. No transcript stores a summary, so we generate one: a token-capped
// head+tail excerpt fed to `claude -p --model haiku` (cheap/fast), cached to a sidecar .md so a
// re-open is instant. Pure-ish: all I/O + the agent spawn are dependency-injected for tests.

export class RecapError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'RecapError';
  }
}

export interface CachedRecap {
  text: string;
  generatedAt: Date;
}

export interface RecapTarget {
  id: string;
  jsonlPath: string;
}

export interface RecapRun {
  stdout: string;
  status: number | null;
  error?: Error;
}

export interface RecapDeps {
  /** Override the cache dir (tests). Default: ~/.config/agentctl/recaps. */
  recapsDir?: string;
  /** Override transcript→excerpt (tests). */
  buildExcerpt?: (jsonlPath: string) => Promise<string>;
  /** Override the agent spawn (tests). Receives argv (after the bin) + the prompt on stdin. */
  run?: (args: string[], input: string) => RecapRun | Promise<RecapRun>;
  now?: () => Date;
  /** Model for `--model`. Default $AGENTCTL_RECAP_MODEL → 'haiku'. */
  model?: string;
  /** Binary. Default $AGENTCTL_CLAUDE_BIN → 'claude'. */
  bin?: string;
}

const HEAD = 16;
const TAIL = 28;
const MAX_CHARS = 12_000;

const PROMPT_PREFIX =
  'Recap this coding-agent session for someone deciding whether to resume it. Give 4-6 short ' +
  'bullets: what was being worked on, the key decisions/outcomes, the current state, and any open ' +
  'follow-ups. No preamble or sign-off — just the bullets.\n\n--- TRANSCRIPT EXCERPT ---\n';

function recapsDir(deps: RecapDeps): string {
  return deps.recapsDir ?? join(configDir(), 'recaps');
}

export function recapPath(id: string, deps: RecapDeps = {}): string {
  return join(recapsDir(deps), `${id}.md`);
}

/** Read a cached recap, or null if none. Parses the `generatedAt` header we write. */
export function readCachedRecap(id: string, deps: RecapDeps = {}): CachedRecap | null {
  const p = recapPath(id, deps);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8');
  const m = raw.match(/^<!--\s*generatedAt:\s*(.+?)\s*-->\n([\s\S]*)$/);
  if (m) {
    const d = new Date(m[1]);
    return { text: m[2].trim(), generatedAt: Number.isNaN(d.getTime()) ? new Date(0) : d };
  }
  return { text: raw.trim(), generatedAt: new Date(0) };
}

export function writeRecap(id: string, text: string, deps: RecapDeps = {}): string {
  const now = (deps.now ?? (() => new Date()))();
  const p = recapPath(id, deps);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `<!-- generatedAt: ${now.toISOString()} -->\n${text.trim()}\n`);
  return p;
}

async function defaultExcerpt(jsonlPath: string): Promise<string> {
  const turns = await readTranscript(jsonlPath, { head: HEAD, tail: TAIL });
  let out = turns
    .map((t) => `[${t.role}] ${t.text.replace(/\s+/g, ' ').trim()}`)
    .filter((l) => l.length > 4)
    .join('\n');
  if (out.length > MAX_CHARS) out = out.slice(0, MAX_CHARS) + '\n…(truncated)';
  return out;
}

function defaultRun(bin: string): (args: string[], input: string) => RecapRun {
  return (args, input) => {
    const r = spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return { stdout: r.stdout ?? '', status: r.status, error: r.error as Error | undefined };
  };
}

/**
 * Non-blocking spawn runner for in-process callers (the ink TUI) — `spawnSync` would freeze the
 * event loop while the agent thinks. Resolves once the child exits.
 */
export function spawnRun(bin = process.env.AGENTCTL_CLAUDE_BIN ?? 'claude') {
  return (args: string[], input: string): Promise<RecapRun> =>
    new Promise((resolve) => {
      let stdout = '';
      let settled = false;
      let child;
      try {
        child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
      } catch (error) {
        resolve({ stdout: '', status: null, error: error as Error });
        return;
      }
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (d: string) => { stdout += d; });
      child.on('error', (error) => { if (!settled) { settled = true; resolve({ stdout, status: null, error }); } });
      child.on('close', (status) => { if (!settled) { settled = true; resolve({ stdout, status }); } });
      child.stdin?.end(input);
    });
}

/** Generate a fresh recap (no caching). Throws RecapError on empty transcript / missing bin / no output. */
export async function generateRecap(target: RecapTarget, deps: RecapDeps = {}): Promise<string> {
  const model = deps.model ?? process.env.AGENTCTL_RECAP_MODEL ?? 'haiku';
  const bin = deps.bin ?? process.env.AGENTCTL_CLAUDE_BIN ?? 'claude';
  const excerpt = await (deps.buildExcerpt ?? defaultExcerpt)(target.jsonlPath);
  if (!excerpt.trim()) throw new RecapError(4, 'transcript is empty — nothing to recap');
  const prompt = PROMPT_PREFIX + excerpt;
  const run = deps.run ?? defaultRun(bin);
  const res = await run(['-p', '--model', model], prompt);
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new RecapError(127, `${bin} not found on PATH (override via AGENTCTL_CLAUDE_BIN)`);
  }
  const text = (res.stdout ?? '').trim();
  if (!text) throw new RecapError(res.status ?? 1, 'recap produced no output');
  return text;
}

/** Cached recap if present (unless refresh), else generate + cache. */
export async function getRecap(
  target: RecapTarget,
  opts: { refresh?: boolean } = {},
  deps: RecapDeps = {},
): Promise<CachedRecap & { fromCache: boolean }> {
  if (!opts.refresh) {
    const cached = readCachedRecap(target.id, deps);
    if (cached) return { ...cached, fromCache: true };
  }
  const text = await generateRecap(target, deps);
  writeRecap(target.id, text, deps);
  const written = readCachedRecap(target.id, deps)!;
  return { ...written, fromCache: false };
}
