import type { Command } from 'commander';
import {
  parseWhen, readAllAnnotations, readAnnotation, writeAnnotation,
  isReminderDue, isOverdue, detectIssueKeys, type AnnotationPatch,
} from '../core/annotations.js';
import { readGitBranch } from '../core/git.js';
import { currentSessionId } from '../core/liveState.js';
import { listSessions } from '../core/sessionRepo.js';
import type { Annotation } from '../core/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which session to annotate: `-s <id-or-prefix>`, else the Claude session we're running inside.
 * A full uuid skips the (slow) session scan so hook scripts stay fast.
 */
async function targetId(opt?: string): Promise<string> {
  if (opt) {
    if (UUID_RE.test(opt)) return opt;
    const { resolveId } = await import('./index.js');
    return (await resolveId(opt)).id;
  }
  const current = currentSessionId();
  if (current) return current;
  console.error('not running inside a Claude session — pass -s <session-id>');
  process.exit(2);
}

function describe(a: Annotation): string {
  const bits: string[] = [];
  if (a.name) bits.push(`name="${a.name}"`);
  if (a.labels.length) bits.push(`labels=${a.labels.join(',')}`);
  if (a.flags.length) bits.push(`flags=${a.flags.join(',')}`);
  if (a.done) bits.push('done');
  if (a.hidden) bits.push('hidden');
  if (a.deleted) bits.push('deleted');
  if (a.remindAt) bits.push(`remind=${a.remindAt}`);
  if (a.dueAt) bits.push(`due=${a.dueAt}`);
  if (a.note) bits.push(`note="${a.note.replace(/\s+/g, ' ').slice(0, 60)}"`);
  return bits.length ? bits.join('  ') : '(cleared)';
}

async function apply(sessionOpt: string | undefined, patch: AnnotationPatch, json?: boolean) {
  const id = await targetId(sessionOpt);
  const a = writeAnnotation(id, patch);
  console.log(json ? JSON.stringify(a) : `${id.slice(0, 8)}  ${describe(a)}`);
}

/**
 * Bulk form for the toggles: `agentctl hide <id> <id> …`. With no ids it falls back to the single
 * -s / current-session path, so the simple case is unchanged.
 */
async function applyMany(
  ids: string[], sessionOpt: string | undefined, patch: AnnotationPatch, json?: boolean,
) {
  if (ids.length === 0) { await apply(sessionOpt, patch, json); return; }

  // Resolve every prefix against ONE scan. Resolving them concurrently ran a full session scan
  // per id, which opened enough files at once to make some of them come back empty.
  const needScan = ids.some(id => !UUID_RE.test(id));
  const all = needScan ? await listSessions({ view: 'all' }) : [];
  const resolved: string[] = [];
  for (const id of ids) {
    if (UUID_RE.test(id)) { resolved.push(id); continue; }
    if (id.length < 4) { console.error(`id prefix must be at least 4 characters: ${id}`); process.exit(2); }
    const matches = all.filter(s => s.id.startsWith(id));
    if (matches.length === 0) { console.error(`not found: ${id}`); process.exit(1); }
    if (matches.length > 1) {
      console.error(`ambiguous prefix '${id}', matches:`);
      for (const m of matches) console.error(`  ${m.id}  ${m.name}`);
      process.exit(2);
    }
    resolved.push(matches[0].id);
  }
  const out = resolved.map(id => writeAnnotation(id, patch));
  if (json) { console.log(JSON.stringify(out)); return; }
  for (const a of out) console.log(`${a.sessionId.slice(0, 8)}  ${describe(a)}`);
  if (out.length > 1) console.log(`${out.length} sessions updated`);
}

export function registerAnnotateCommands(program: Command) {
  const session = (c: Command) =>
    c.option('-s, --session <id>', 'session id or prefix (default: the session you are in)')
      .option('--json', 'print the resulting annotation as JSON');

  session(program.command('name [words...]'))
    .description('set a session display name (overrides the transcript title; rename as often as you like)')
    .option('--clear', 'remove the name override')
    .addHelpText('after', `
Stored beside the session, never written into the transcript: Claude Code
re-flushes its own cached title after almost every turn, so a rename appended to
the .jsonl is silently reverted. --clear puts the transcript title back.
`)
    .action(async (words: string[], opts) => {
      const text = words.join(' ').trim();
      if (!text && !opts.clear) { console.error('give a name, or --clear'); process.exit(2); }
      await apply(opts.session, { name: opts.clear ? null : text }, opts.json);
    });

  session(program.command('note [words...]'))
    .description('attach a free-text note to a session')
    .option('--clear', 'remove the note')
    .option('--append', 'append to the existing note instead of replacing it')
    .action(async (words: string[], opts) => {
      const text = words.join(' ').trim();
      if (!text && !opts.clear) { console.error('give some text, or --clear'); process.exit(2); }
      if (opts.clear) { await apply(opts.session, { note: null }, opts.json); return; }
      const id = await targetId(opts.session);
      const prev = opts.append ? readAnnotation(id)?.note : undefined;
      const a = writeAnnotation(id, { note: prev ? `${prev}\n${text}` : text });
      console.log(opts.json ? JSON.stringify(a) : `${id.slice(0, 8)}  ${describe(a)}`);
    });

  session(program.command('flag [flags...]'))
    .description('tag a session (e.g. todo, later, bug) so it stands out in the menu')
    .option('--remove', 'remove the given flags instead of adding them')
    .addHelpText('after', `
Flags are short states for you — todo, later, blocked — lowercased and
dash-joined. The row shows ⚑ and the menu's / filter matches them.
Use \`label\` for what the session is about (a Jira key, a repo, a topic).
`)
    .action(async (flags: string[], opts) => {
      if (flags.length === 0) { console.error('give at least one flag'); process.exit(2); }
      await apply(opts.session, opts.remove ? { removeFlags: flags } : { addFlags: flags }, opts.json);
    });

  session(program.command('done [ids...]'))
    .description('mark sessions finished (--undo to reopen them)')
    .option('--undo', 'mark them not-done again')
    .action(async (ids: string[], opts) => {
      await applyMany(ids, opts.session, { done: !opts.undo }, opts.json);
    });

  session(program.command('remind [when...]'))
    .description('set a reminder: 2h, 30m, 3d, tomorrow, "tomorrow 9am", 17:00, or an ISO date')
    .option('--clear', 'drop the reminder')
    .addHelpText('after', `
When it comes due nothing is pushed at you — it surfaces where you already look:
  · the row's ◆ turns red in the Resume menu, and the header counts "◆ N due"
  · \`agentctl annotations --due\` lists everything that has come due
  · the agentctl-sessions plugin tells a session, at start, that it is due
Marking the session done silences it. Use \`due\` for when the WORK is due.

Formats   30m · 2h · 3d · 1w · tomorrow · "tomorrow 9am" · 17:00 · 2026-09-01T09:00
A bare clock time that has already passed today rolls to tomorrow. A bare number
is rejected — "45" is a forgotten unit, not the year 2045.

  agentctl remind 2h                     the session you are in
  agentctl remind tomorrow 9am -s 3aa518bf
  agentctl remind --clear
`)
    .action(async (when: string[], opts) => {
      if (opts.clear) { await apply(opts.session, { remindAt: null }, opts.json); return; }
      const raw = when.join(' ').trim();
      const at = raw ? parseWhen(raw) : null;
      if (!at) { console.error(`can't read a time out of "${raw}" — try 2h, tomorrow 9am, or an ISO date`); process.exit(2); }
      await apply(opts.session, { remindAt: at.toISOString() }, opts.json);
    });

  session(program.command('hide [ids...]'))
    .description('keep sessions out of the default list (they stay in `--hidden`; transcripts untouched)')
    .option('--undo', 'show them in the default list again')
    .addHelpText('after', `
A listing preference, nothing more: the transcript is untouched, nothing leaves
~/.claude, and a hidden session still resumes if you name its id. \`v\` in the menu
shows the hidden ones; \`agentctl ls --hidden\` does the same from here.
Takes several ids at once. In zsh, split a variable with \${=IDS} or the whole
list arrives as one argument.
`)
    .action(async (ids: string[], opts) => {
      await applyMany(ids, opts.session, { hidden: !opts.undo }, opts.json);
    });

  session(program.command('delete [ids...]'))
    .description('keep sessions out of every list (recover with --undo; nothing is removed from ~/.claude)')
    .option('--undo', 'restore them')
    .addHelpText('after', `
Like \`hide\`, but out of every list the menu can show — which is what makes it
safe to press. Also just a listing preference: nothing is removed from ~/.claude
and the session still resumes by id.
Recover with \`agentctl delete --undo <id>\`; \`agentctl ls --deleted\` finds it.
Deliberately not reachable from the menu.
`)
    .action(async (ids: string[], opts) => {
      await applyMany(ids, opts.session, { deleted: !opts.undo }, opts.json);
    });

  session(program.command('label [labels...]'))
    .description('tag a session with what it relates to — a Jira key, a repo, a topic (searchable)')
    .option('--remove', 'remove the given labels instead of adding them')
    .option('--auto', 'add any issue key found in the current git branch (e.g. RD-12345)')
    .addHelpText('after', `
Labels say what a session is ABOUT — a ticket, a repo, a topic — and keep their
case, so RD-12345 reads back as you typed it. The menu's / filter matches them,
so one ticket key finds every session on that ticket.

  agentctl label RD-12345 catalog
  agentctl label --auto                  take the issue key out of the branch name
  agentctl label --remove catalog
Use \`flag\` instead for short states you set for yourself (todo, later, blocked).
`)
    .action(async (labels: string[], opts) => {
      const all = [...labels];
      if (opts.auto) {
        const found = detectIssueKeys(readGitBranch(process.cwd()));
        if (found.length === 0 && labels.length === 0) {
          console.error(`no issue key in the branch here (${readGitBranch(process.cwd()) ?? 'not a repo'})`);
          process.exit(1);
        }
        all.push(...found);
      }
      if (all.length === 0) { console.error('give at least one label, or --auto'); process.exit(2); }
      await apply(opts.session, opts.remove ? { removeLabels: all } : { addLabels: all }, opts.json);
    });

  session(program.command('due [when...]'))
    .description('set when the work is due: 2h, 3d, tomorrow, "friday 17:00", or an ISO date')
    .option('--clear', 'drop the due date')
    .addHelpText('after', `
The deadline for the work itself, as opposed to \`remind\`, which is a nudge to
look at the session. Shown as ✱, red once the date has passed, and listed by
\`agentctl annotations --due\`. Same time formats as \`remind\`; done clears it.
`)
    .action(async (when: string[], opts) => {
      if (opts.clear) { await apply(opts.session, { dueAt: null }, opts.json); return; }
      const raw = when.join(' ').trim();
      const at = raw ? parseWhen(raw) : null;
      if (!at) { console.error(`can't read a time out of "${raw}" — try 3d, tomorrow 9am, or an ISO date`); process.exit(2); }
      await apply(opts.session, { dueAt: at.toISOString() }, opts.json);
    });

  program
    .command('annotations')
    .description('list every annotated session')
    .option('--json')
    .option('--due', 'only sessions whose reminder has come due or whose due date has passed')
    .addHelpText('after', `
  agentctl annotations --due             what needs you now
  agentctl annotations --label RD-12345  every session on one ticket
`)
    .option('--label <label>', 'only sessions carrying this label')
    .action(async (opts: { json?: boolean; due?: boolean; label?: string }) => {
      const all = [...readAllAnnotations().values()]
        .filter(a => !opts.due || isReminderDue(a) || isOverdue(a))
        .filter(a => !opts.label || a.labels.some(l => l.toLowerCase() === opts.label!.toLowerCase()))
        .sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? ''));
      if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
      if (all.length === 0) { console.log(opts.due ? 'nothing due' : 'no annotations yet'); return; }
      // Names come from the annotation itself; fall back to the transcript title only when needed.
      const missing = all.filter(a => !a.name);
      const titles = new Map<string, string>();
      if (missing.length) {
        // 'all' — a hidden or deleted session still has a name worth showing here.
        for (const s of await listSessions({ view: 'all' })) titles.set(s.id, s.name);
      }
      for (const a of all) {
        const label = a.name ?? titles.get(a.sessionId) ?? '(unknown session)';
        const marks = [
          a.done ? '✓' : '',
          isReminderDue(a) ? '⏰' : '',
          isOverdue(a) ? 'OVERDUE' : '',
          ...a.labels.map(l => `[${l}]`),
          ...a.flags.map(f => `#${f}`),
        ].filter(Boolean).join(' ');
        console.log(`${a.sessionId.slice(0, 8)}  ${label}${marks ? '  ' + marks : ''}`);
        if (a.note) for (const line of a.note.split('\n')) console.log(`          ${line}`);
      }
    });

}
