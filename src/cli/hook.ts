import type { Command } from 'commander';
import {
  detectIssueKeys, isOverdue, isReminderDue, isValidSessionId, readAllAnnotations, readAnnotation, writeAnnotation,
} from '../core/annotations.js';
import { readGitBranch } from '../core/git.js';
import { bumpPromptCount, registryEntry } from '../core/liveState.js';
import type { Annotation, RegistryEntry } from '../core/types.js';

// Entry points for the agentctl-sessions Claude Code plugin. A hook must NEVER break the session it
// runs in, so every path here exits 0 and prints nothing rather than throwing.

export interface HookDeps {
  annotation?: (id: string) => Annotation | null;
  all?: () => Map<string, Annotation>;
  now?: Date;
  branch?: (cwd: string | undefined) => string | null;
  registry?: (id: string) => RegistryEntry | null;
  setName?: (id: string, name: string) => void;
  bump?: (id: string) => number;
}

/** Claude Code tracks a human `/rename` for this session, so the prompt hook owns naming. */
function registryNames(e: RegistryEntry | null): e is RegistryEntry {
  return e?.kind === 'interactive' && typeof e.nameSource === 'string';
}

/** The session's working directory, used to read its git branch for an issue key. */
export function parseCwd(raw: string): string | undefined {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    return typeof d.cwd === 'string' && d.cwd ? d.cwd : undefined;
  } catch {
    return undefined;
  }
}

/** Hook payloads are external JSON: pull the id out defensively. */
export function parseSessionId(raw: string): string | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    return typeof d.session_id === 'string' && d.session_id ? d.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Context injected at SessionStart: what this session is called and what is attached to it, so a
 * resumed session knows its own name, plus a nudge to name a brand-new one. Kept to a handful of
 * lines — it is paid for on every single session start.
 */
export function sessionStartContext(raw: string, deps: HookDeps = {}): string {
  const id = parseSessionId(raw);
  if (!id) return '';
  const cwd = parseCwd(raw);
  const readOne = deps.annotation ?? ((i: string) => readAnnotation(i));
  const readAll = deps.all ?? (() => readAllAnnotations());
  const now = deps.now ?? new Date();
  const a = readOne(id);
  const lines: string[] = [];

  if (a?.name) lines.push(`Agentctl calls this session "${a.name}".`);
  else if (!registryNames((deps.registry ?? registryEntry)(id))) {
    lines.push(
      'This session has no Agentctl name. Once the user\'s first task is clear, name it with' +
      ' `agentctl name "<3-5 words>"` — run it once, quietly, and do not ask permission or announce it.',
    );
  }
  if (a?.labels.length) lines.push(`Labels: ${a.labels.join(', ')}.`);
  else {
    const keys = detectIssueKeys(deps.branch ? deps.branch(cwd) : readGitBranch(cwd));
    if (keys.length) {
      lines.push(
        `The branch here names ${keys.join(', ')} — label the session with it: \`agentctl label ${keys.join(' ')}\`.`,
      );
    }
  }
  if (a?.flags.length) lines.push(`Flags on it: ${a.flags.map(f => `#${f}`).join(' ')}.`);
  if (a?.note) lines.push(`Note saved on it: ${a.note.replace(/\s*\n\s*/g, ' / ')}`);
  if (a?.done) lines.push('It is marked done — if the user reopens the work, run `agentctl done --undo`.');
  if (isReminderDue(a ?? undefined, now)) lines.push('Its reminder is due: tell the user once, up front.');
  if (isOverdue(a ?? undefined, now)) lines.push('It is past its due date: say so once, up front.');
  else if (a?.dueAt) lines.push(`Due ${a.dueAt}.`);

  const dueElsewhere = [...readAll().values()].filter(x => x.sessionId !== id && isReminderDue(x, now));
  if (dueElsewhere.length > 0) {
    lines.push(
      `${dueElsewhere.length} other session(s) have a reminder due. Mention each once, with its session and` +
      ' resume command:',
    );
    for (const x of dueElsewhere.slice(0, 3)) {
      const short = x.sessionId.slice(0, 8);
      lines.push(`- "${x.name ?? short}" (session ${short}) — resume: \`agentctl resume ${short}\``);
    }
    lines.push(
      'This list is a snapshot from when this session started; reminders get cleared from other sessions.' +
      ' Before mentioning any of them again later, run `agentctl annotations --due` and mention only what it still lists.',
    );
  }

  lines.push(
    'Session tools (the `agentctl-sessions` skill has the details), all targeting THIS session with' +
    ' no id needed: `agentctl name/note/label/flag/remind/due/done`, and `agentctl annotations --due`' +
    ' for what has come due. Use them whenever the user asks to name, label, flag, annotate, remind' +
    ' about, schedule, or close out a session.',
  );
  return lines.join('\n') + '\n';
}

/**
 * Context injected at UserPromptSubmit: until the user gives this session a human `/rename` name
 * (other sessions can only @-address those), ask the model to propose one. Silent — zero tokens —
 * once named, and on the first prompt, which rarely makes the task clear. Once named, the Agentctl
 * name follows the `/rename` name, so there is one name everywhere.
 */
export function userPromptContext(raw: string, deps: HookDeps = {}): string {
  const id = parseSessionId(raw);
  if (!id || !isValidSessionId(id)) return '';
  const entry = (deps.registry ?? registryEntry)(id);
  if (!registryNames(entry)) return '';
  if (entry.nameSource !== 'derived') {
    const a = (deps.annotation ?? ((i: string) => readAnnotation(i)))(id);
    if (entry.name && a?.name !== entry.name) {
      (deps.setName ?? ((i: string, n: string) => { writeAnnotation(i, { name: n }); }))(id, entry.name);
    }
    return '';
  }
  if ((deps.bump ?? ((i: string) => bumpPromptCount(i)))(id) < 2) return '';
  return (
    'This session has no human name yet, so other sessions cannot @-address it. Propose ONE short' +
    ' kebab-case name from the subject plus a Jira key / PR number / role (e.g. RD-14189-linear-history,' +
    ' pr-412-review; keep your earlier pick unless the task changed), run `agentctl name "<name>"`, and end' +
    ' your reply with `Rename: **/rename <name>**` on its own line.\n'
  );
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
  });
}

export function registerHookCommands(program: Command) {
  const hook = program
    .command('hook')
    .description('entry points for the agentctl-sessions Claude Code plugin (hook JSON on stdin)');

  hook
    .command('session-start')
    .description('print SessionStart context: this session\'s name, note, flags and due reminders')
    .action(async () => {
      try {
        process.stdout.write(sessionStartContext(await readStdin()));
      } catch {
        // never break the session that ran us
      }
    });

  hook
    .command('user-prompt-submit')
    .description('print UserPromptSubmit context: ask for a /rename until the session has a human name')
    .action(async () => {
      try {
        process.stdout.write(userPromptContext(await readStdin()));
      } catch {
        // never break the session that ran us
      }
    });
}
