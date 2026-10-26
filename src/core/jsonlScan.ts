import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SessionKind } from './types.js';

export interface ScanResult {
  firstPrompt: string | null;
  customTitle: string | null;
  aiTitle: string | null;
  firstTimestamp: Date | null;
  corruptLines: number;
  /**
   * How the session was started, straight off the transcript: `cli` for a real interactive
   * session, `sdk-cli` for a headless `claude -p` run, and whatever else Claude Code stamps for
   * the SDK, MCP or IDE entry points. `null` on a transcript too old to carry the field.
   */
  entrypoint: string | null;
  /**
   * The last working directory the transcript records. Claude Code stamps `cwd` on every record
   * and it follows the session as it moves, so this is where the work actually happened — the
   * project directory name only ever encodes where `claude` was launched.
   */
  lastCwd: string | null;
  /**
   * The `~/ClaudWork/<folder>` this session worked in: the folder its own tool calls name most.
   * Bash `cd` never sticks in Claude Code, so `lastCwd` stays the launch dir for ad-hoc work.
   */
  workDirName: string | null;
}

// Assistant records hold only the model's text and tool inputs, so a ClaudWork path there is
// one it chose to work in — not one quoted back from a memory file or a system reminder.
const WORK_DIR_RE = /ClaudWork\/(\w[\w.-]*)/g; // \w first: never `.` or `..`

/** Anything that is not the interactive CLI was driven by a tool, not typed by a human. */
export function kindOf(entrypoint: string | null | undefined): SessionKind {
  return entrypoint && entrypoint !== 'cli' ? 'tool' : 'interactive';
}

const STRIP_TAGS = [
  'command-message',
  'command-name',
  'system-reminder',
  'local-command-caveat',
  'local-command-stdout',
  'local-command-stderr',
];

const KEEP_INNER_TAGS = ['command-args'];

function stripTags(text: string): string {
  let t = text;
  for (const tag of KEEP_INNER_TAGS) {
    t = t.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g'), '$1');
    t = t.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)$`, 'g'), '$1');
  }
  for (const tag of STRIP_TAGS) {
    t = t.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'g'), '');
    t = t.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*$`, 'g'), '');
  }
  return t;
}

function deriveName(raw: string): string {
  let t = stripTags(raw);
  t = t.replace(/^\/[\w-]+(?::[\w-]+)?\s+/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > 80) t = t.slice(0, 79) + '…';
  return t;
}

function extractUserText(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.type !== 'user') return null;
  const msg = o.message as { content?: unknown } | undefined;
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (const block of c) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const text = (block as { text?: unknown }).text;
        if (typeof text === 'string') return text;
      }
    }
  }
  return null;
}

/** Claude Code writes ISO-string timestamps; older/fixture data uses epoch ms. Accept both. */
function parseTimestamp(ts: unknown): Date | null {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts);
  if (typeof ts === 'string') {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function trimTitle(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 120 ? t.slice(0, 119) + '…' : t;
}

export async function scanJsonl(path: string): Promise<ScanResult> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let firstPrompt: string | null = null;
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let firstTimestamp: Date | null = null;
  let corruptLines = 0;
  let entrypoint: string | null = null;
  let lastCwd: string | null = null;
  const workDirHits = new Map<string, number>();
  try {
    for await (const line of rl) {
      if (!line) continue;
      let obj: unknown;
      try { obj = JSON.parse(line); } catch { corruptLines++; continue; }
      const o = obj as Record<string, unknown>;
      if (o.type === 'custom-title') {
        const t = trimTitle(o.customTitle);
        if (t) customTitle = t;
        continue;
      }
      if (o.type === 'ai-title') {
        const t = trimTitle(o.aiTitle);
        if (t) aiTitle = t;
        continue;
      }
      if (firstPrompt === null) {
        const raw = extractUserText(obj);
        if (raw !== null) {
          const cleaned = deriveName(raw);
          if (cleaned) firstPrompt = cleaned;
        }
      }
      if (firstTimestamp === null) {
        firstTimestamp = parseTimestamp(o.timestamp);
      }
      if (entrypoint === null && typeof o.entrypoint === 'string') {
        entrypoint = o.entrypoint;
      }
      if (typeof o.cwd === 'string' && o.cwd) lastCwd = o.cwd;
      if (o.type === 'assistant' && line.includes('ClaudWork/')) {
        for (const m of line.matchAll(WORK_DIR_RE)) workDirHits.set(m[1], (workDirHits.get(m[1]) ?? 0) + 1);
      }
    }
  } finally {
    stream.destroy();
  }
  let workDirName: string | null = null;
  let best = 0;
  for (const [name, n] of workDirHits) if (n > best) { best = n; workDirName = name; }
  return { firstPrompt, customTitle, aiTitle, firstTimestamp, corruptLines, entrypoint, lastCwd, workDirName };
}
