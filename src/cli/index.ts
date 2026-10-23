import { Command } from 'commander';
import { listSessions, getSession } from '../core/sessionRepo.js';

// Version is baked in at build time from package.json (tsup `define`), so it never drifts from a
// hardcoded literal. Running from source via tsx (no define) falls back to 'dev'.
declare const __AGENTCTL_VERSION__: string;
const PKG_VERSION = typeof __AGENTCTL_VERSION__ === 'string' ? __AGENTCTL_VERSION__ : 'dev';
import { renderTable } from './render.js';
import { renderPeek } from './peek.js';
import { resume, ResumeError } from './resume.js';
import { getRecap, RecapError } from '../core/recap.js';
import { registerConfigCommands } from './config.js';
import { registerAnnotateCommands } from './annotate.js';
import { registerHookCommands } from './hook.js';

export async function resolveId(prefix: string) {
  if (prefix.length < 4) {
    console.error('id prefix must be at least 4 characters');
    process.exit(2);
  }
  const matches = await getSession(prefix);
  if (matches.length === 0) {
    console.error('not found');
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`ambiguous prefix '${prefix}', matches:`);
    for (const m of matches) console.error(`  ${m.id}  ${m.name}`);
    process.exit(2);
  }
  return matches[0];
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('agentctl')
    .description('Agentctl — start a new Claude/Codex session in a project, or search + resume an existing one')
    .version(PKG_VERSION)
    .option('-r, --resume', 'open the Resume menu (default opens New)')
    .addHelpText('after', `
Two menus
  agentctl                 New — pick a project directory, start a session there
  agentctl -r              Resume — search every past session and pick one up
  ? inside either menu     the full keymap and what every marker means

Annotate a session
  Run these INSIDE a Claude session and they target that session. From anywhere
  else add -s <id-or-prefix>.
  agentctl name "billing spike"      rename it (as often as you like)
  agentctl note "waiting on Dor"     a note, shown under the row
  agentctl label RD-12345            what it relates to — Jira key, repo, topic
  agentctl flag todo later           short markers you set for yourself
  agentctl remind 2h                 nudge me at...   (see \`remind --help\`)
  agentctl due friday 17:00          the work is due at...
  agentctl done                      finished; silences its reminder
  agentctl annotations --due         everything that has come due

Tidy the list
  agentctl hide <id>...              out of the default list, kept in --hidden
  agentctl delete <id>...            out of every list; --undo restores it
  Neither touches the transcript. Nothing is ever removed from ~/.claude, and a
  hidden or deleted session still resumes if you name its id.

Where things live
  ~/.config/agentctl/config.toml           groups, tools, terminal, hotkey
  ~/.config/agentctl/annotations/<id>.json one small file per annotated session
`)
    .action(async (opts: { resume?: boolean }) => {
      const { runApp } = await import('./router.js');
      await runApp(opts.resume ? 'resume' : 'new');
    });

  program
    .command('ls')
    .description('list sessions as a table (--json for the raw records)')
    .option('--cwd <path>', 'only sessions whose working directory is this')
    .option('--active')
    .option('--json')
    .option('--sort <key>', 'updated|started|name', 'updated')
    .option('--hidden', 'list only hidden sessions')
    .option('--deleted', 'list only deleted sessions')
    .option('--all', 'list everything, hidden and deleted included')
    .option('--tool', 'only sessions a tool started (claude -p, the SDK, MCP…)')
    .option('--interactive', 'only real interactive sessions')
    .option('--limit <n>', '', v => parseInt(v, 10))
    .action(async opts => {
      const records = await listSessions({
        cwd: opts.cwd, activeOnly: opts.active, sortBy: opts.sort, limit: opts.limit,
        view: opts.all ? 'all' : opts.deleted ? 'deleted' : opts.hidden ? 'hidden' : 'normal',
        kind: opts.tool ? 'tool' : opts.interactive ? 'interactive' : undefined,
      });
      if (opts.json) {
        console.log(JSON.stringify(records.map(r => ({
          ...r,
          startedAt: r.startedAt.toISOString(),
          lastUpdatedAt: r.lastUpdatedAt.toISOString(),
        })), null, 2));
      } else {
        console.log(renderTable(records));
      }
    });

  program
    .command('peek <id>')
    .description('print a session transcript (tail by default)')
    .option('--full', 'print the whole transcript instead of the tail')
    .option('--head <n>', '', v => parseInt(v, 10))
    .option('--tail <n>', '', v => parseInt(v, 10))
    .action(async (id: string, opts) => {
      const s = await resolveId(id);
      console.log(await renderPeek(s, { full: opts.full, head: opts.head, tail: opts.tail }));
    });

  // resume with an id → resume that session; without an id → open the Resume menu.
  program
    .command('resume [id]')
    .description('resume a session by id, or open the Resume menu with no id')
    .option('--yes', 'skip the confirmation when the working directory is a guess')
    .option('--cwd <path>')
    .option('-p, --profile <name>', 'Claude account to resume under: an email, a home path, or a profile name')
    .action(async (id: string | undefined, opts) => {
      if (!id) { const { runApp } = await import('./router.js'); await runApp('resume'); return; }
      const s = await resolveId(id);
      if (opts.profile) {
        const { resolveProfile, listProfiles } = await import('../core/profiles.js');
        const p = resolveProfile(opts.profile);
        if (!p) {
          console.error(`no logged-in Claude profile matches '${opts.profile}'. Known:`);
          for (const known of listProfiles()) console.error(`  ${known.account}  (${known.home})`);
          process.exit(2);
        }
        s.configDir = p.home;
      }
      try {
        resume(s, { yes: opts.yes, cwdOverride: opts.cwd });
      } catch (e) {
        if (e instanceof ResumeError) { console.error(e.message); process.exit(e.code); }
        throw e;
      }
    });

  program
    .command('new')
    .description('open the New-session launcher')
    .action(async () => { const { runApp } = await import('./router.js'); await runApp('new'); });

  program
    .command('profiles')
    .description('list the Claude accounts on this machine (for `resume --profile`)')
    .option('--json')
    .action(async (opts: { json?: boolean }) => {
      const { listProfiles } = await import('../core/profiles.js');
      const all = listProfiles();
      if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
      if (all.length === 0) { console.log('no logged-in Claude profiles found'); return; }
      for (const p of all) {
        console.log(`${p.account.padEnd(28)} ${p.home}${p.isPrimary ? '   (default)' : ''}`);
      }
    });

  program
    .command('path <id>')
    .description('print the transcript .jsonl path for a session')
    .action(async (id: string) => { const s = await resolveId(id); console.log(s.jsonlPath); });

  program
    .command('recap <id>')
    .description('summarize a session via claude -p (cached; --refresh to regenerate)')
    .option('--refresh', 'ignore the cache and regenerate')
    .action(async (id: string, opts: { refresh?: boolean }) => {
      const s = await resolveId(id);
      try {
        const r = await getRecap({ id: s.id, jsonlPath: s.jsonlPath }, { refresh: opts.refresh });
        console.log(r.text);
      } catch (e) {
        if (e instanceof RecapError) { console.error(e.message); process.exit(e.code); }
        throw e;
      }
    });

  registerAnnotateCommands(program);
  registerHookCommands(program);
  registerConfigCommands(program);
  return program;
}

async function main() {
  // Bare `agentctl` → New; `-r`/`--resume` → Resume; both via the root action.
  await buildProgram().parseAsync(process.argv);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
