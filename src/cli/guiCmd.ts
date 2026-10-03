import { writeFileSync, chmodSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { stringify as tomlStringify } from 'smol-toml';
import { loadConfig, getTool, clearConfigCache } from '../core/config/loadConfig.js';
import { configPath } from '../core/config/paths.js';
import { listProjects } from '../core/groupScan.js';
import { listSessions, getSession } from '../core/sessionRepo.js';
import { readTranscript } from '../core/transcript.js';
import { getRecap, readCachedRecap } from '../core/recap.js';
import { planTerminal, resolveCustomTemplate } from '../core/terminalLaunch.js';
import { setGuiTerminal } from './config.js';
import { shellQuote } from './launch.js';
import { isPrimaryHome, profileAccount } from '../core/profiles.js';
import {
  isReminderDue, isOverdue, isValidSessionId, normalizeFlag, normalizeLabel, parseWhen,
  readAnnotation, writeAnnotation,
  type AnnotationPatch,
} from '../core/annotations.js';
import type { AgentctlConfig } from '../core/config/types.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { d += c; });
    process.stdin.on('end', () => resolve(d));
  });
}

const SHELL = process.env.SHELL ?? '/bin/zsh';

/** Known terminals offered in the GUI settings picker (+ "default" and "custom"). */
const KNOWN_TERMINALS: Array<{ id: string; label: string; appPaths: string[] }> = [
  { id: 'default', label: 'System default', appPaths: [] },
  { id: 'Terminal', label: 'Terminal', appPaths: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'] },
  { id: 'iTerm', label: 'iTerm2', appPaths: ['/Applications/iTerm.app'] },
  { id: 'Ghostty', label: 'Ghostty', appPaths: ['/Applications/Ghostty.app'] },
  { id: 'Warp', label: 'Warp', appPaths: ['/Applications/Warp.app'] },
  { id: 'kitty', label: 'kitty', appPaths: ['/Applications/kitty.app'] },
  { id: 'WezTerm', label: 'WezTerm', appPaths: ['/Applications/WezTerm.app'] },
  { id: 'cmux', label: 'cmux', appPaths: ['/Applications/cmux.app'] },
  { id: 'custom', label: 'Custom command…', appPaths: [] },
];

function spawnDetached(cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.unref();
}

/** Open `command` in the configured terminal, running in `cwd`. */
export function openSession(command: string, cwd: string, config: AgentctlConfig): void {
  const plan = planTerminal({
    terminal: config.gui.terminal,
    customTemplate: config.gui.launchCommand,
    command,
    cwd,
  });
  const dir = mkdtempSync(join(tmpdir(), 'agentctl-'));
  const script = join(dir, 'launch.command');
  writeFileSync(script, plan.scriptBody);
  chmodSync(script, 0o755);

  if (plan.mode === 'default') {
    spawnDetached('open', [script]);
  } else if (plan.mode === 'app') {
    spawnDetached('open', ['-a', plan.appName ?? 'Terminal', script]);
  } else {
    const line = resolveCustomTemplate(plan.customTemplate ?? '', {
      script,
      cmd: `cd ${JSON.stringify(cwd)} && ${command}`,
      dir: cwd,
    });
    if (line.trim()) spawnDetached(SHELL, ['-c', line]);
    else spawnDetached('open', [script]); // empty custom template → fall back to default
  }
}

export function registerGuiCommands(program: Command): void {
  const gui = program.command('gui').description('GUI back-end (internal JSON + launch commands)');

  gui.command('projects')
    .description('list configured groups + their project dirs as JSON')
    .action(async () => {
      const { config } = loadConfig();
      const grouped = await listProjects(config.groups, { withGit: true });
      const out = config.groups.map((g, i) => ({
        name: g.name,
        color: g.color,
        path: g.path,
        dirs: (grouped[i] ?? []).map((d) => ({
          name: d.name, path: d.path, branch: d.gitBranch ?? null, timeMs: d.timeMs, scoreSource: d.scoreSource,
        })),
      }));
      console.log(JSON.stringify({ groups: out, tools: config.tools.map(t => ({ name: t.name, label: t.label.trim() })), defaultTool: config.defaultTool }));
    });

  gui.command('sessions')
    .description('list resumable sessions as JSON')
    .action(async () => {
      // Everything, including hidden and deleted — the GUI filters client-side so switching
      // views is instant. Hidden/deleted are listing preferences; transcripts are untouched.
      const records = await listSessions({ view: 'all' });
      console.log(JSON.stringify(records.map((r) => ({
        id: r.id, name: r.name, transcriptName: r.transcriptName,
        cwd: r.cwd, launchCwd: r.launchCwd, status: r.status, active: r.active,
        gitBranch: r.gitBranch ?? null, cwdConfident: r.cwdDecodeConfident,
        kind: r.kind, entrypoint: r.entrypoint ?? null,
        lastUpdatedAt: r.lastUpdatedAt.toISOString(),
        startedAt: r.startedAt.toISOString(),
        flags: r.annotation?.flags ?? [],
        labels: r.annotation?.labels ?? [],
        note: r.annotation?.note ?? null,
        done: r.annotation?.done ?? false,
        hidden: r.annotation?.hidden ?? false,
        deleted: r.annotation?.deleted ?? false,
        remindAt: r.annotation?.remindAt ?? null,
        remindDue: isReminderDue(r.annotation),
        dueAt: r.annotation?.dueAt ?? null,
        overdue: isOverdue(r.annotation),
        account: r.configDir ? profileAccount(r.configDir) : null,
      }))));
    });

  gui.command('profiles')
    .description('list the logged-in Claude accounts as JSON')
    .action(async () => {
      const { listProfiles } = await import('../core/profiles.js');
      console.log(JSON.stringify(listProfiles()));
    });

  gui.command('new-dir')
    .description('mkdir -p <base>/<name>, print the path as JSON')
    .requiredOption('--base <dir>')
    .requiredOption('--name <name>')
    .action((opts: { base: string; name: string }) => {
      const path = join(opts.base, opts.name);
      mkdirSync(path, { recursive: true });
      console.log(JSON.stringify({ path }));
    });

  gui.command('launch')
    .description('open the tool in <dir> in the configured terminal')
    .requiredOption('--dir <dir>')
    .option('--tool <name>')
    .action((opts: { dir: string; tool?: string }) => {
      const { config } = loadConfig();
      const tool = getTool(config, opts.tool ?? config.defaultTool);
      openSession(tool.runs, opts.dir, config);
      console.log(JSON.stringify({ ok: true, dir: opts.dir, tool: tool.name }));
    });

  gui.command('resume')
    .description('resume a session in the configured terminal')
    .requiredOption('--id <id>')
    .option('--profile <home>', 'Claude home to resume under')
    .action(async (opts: { id: string; profile?: string }) => {
      const { config } = loadConfig();
      const matches = await getSession(opts.id);
      if (matches.length !== 1) {
        console.log(JSON.stringify({ ok: false, error: matches.length === 0 ? 'not found' : 'ambiguous' }));
        process.exit(matches.length === 0 ? 1 : 2);
      }
      const s = matches[0];
      // s.id is interpolated into a shell command (terminalLaunch) — refuse anything but the
      // known session-id charset so a hostile transcript filename can't inject.
      if (!/^[A-Za-z0-9._-]+$/.test(s.id)) {
        console.log(JSON.stringify({ ok: false, error: 'invalid id' }));
        process.exit(3);
      }
      const bin = process.env.AGENTCTL_CLAUDE_BIN ?? 'claude';
      // Same rule as the TUI (see cli/resume.ts resumeEnv): pin a side profile, but never the
      // default one — its config is ~/.claude.json, so pinning ~/.claude picks a logged-out stub.
      const home = opts.profile ?? s.configDir;
      const profile = home && !isPrimaryHome(home) ? `CLAUDE_CONFIG_DIR=${shellQuote(home)} ` : '';
      openSession(`${profile}${bin} --resume ${s.id} --dangerously-skip-permissions`, s.cwd, config);
      console.log(JSON.stringify({ ok: true, id: s.id, cwd: s.cwd }));
    });

  gui.command('annotate')
    .description('update one session annotation (name/note/flags/done/reminder)')
    .requiredOption('--id <id>')
    .option('--name <name>', 'set the name override ("" clears it)')
    .option('--note <note>', 'set the note ("" clears it)')
    .option('--flags <csv>', 'replace the whole flag set (comma separated, "" clears)')
    .option('--labels <csv>', 'replace the whole label set (comma separated, "" clears)')
    .option('--done <bool>', 'true|false')
    .option('--hidden <bool>', 'true|false — keep it out of the default list')
    .option('--deleted <bool>', 'true|false — keep it out of every list')
    .option('--remind <when>', '2h | tomorrow 9am | ISO ("" clears)')
    .option('--due <when>', '3d | friday 17:00 | ISO ("" clears)')
    .action((opts: {
      id: string; name?: string; note?: string; flags?: string; labels?: string;
      done?: string; hidden?: string; deleted?: string; remind?: string; due?: string;
    }) => {
      if (!isValidSessionId(opts.id)) {
        console.log(JSON.stringify({ ok: false, error: 'invalid id' }));
        process.exit(3);
      }
      const patch: AnnotationPatch = {};
      if (opts.name !== undefined) patch.name = opts.name.trim() || null;
      if (opts.note !== undefined) patch.note = opts.note.trim() || null;
      if (opts.done !== undefined) patch.done = opts.done === 'true';
      if (opts.hidden !== undefined) patch.hidden = opts.hidden === 'true';
      if (opts.deleted !== undefined) patch.deleted = opts.deleted === 'true';
      for (const [opt, field] of [['remind', 'remindAt'], ['due', 'dueAt']] as const) {
        const value = opts[opt];
        if (value === undefined) continue;
        const raw = value.trim();
        if (!raw) { patch[field] = null; continue; }
        const at = parseWhen(raw);
        if (!at) {
          console.log(JSON.stringify({ ok: false, error: `unrecognised time: ${raw}` }));
          process.exit(4);
        }
        patch[field] = at.toISOString();
      }
      // The GUI sends whole sets; turn them into the add/remove the store speaks.
      const current = readAnnotation(opts.id);
      if (opts.flags !== undefined) {
        const want = opts.flags.split(',').map(normalizeFlag).filter(Boolean);
        const have = current?.flags ?? [];
        patch.addFlags = want.filter((f) => !have.includes(f));
        patch.removeFlags = have.filter((f) => !want.includes(f));
      }
      if (opts.labels !== undefined) {
        const want = opts.labels.split(',').map(normalizeLabel).filter(Boolean);
        const have = current?.labels ?? [];
        patch.addLabels = want.filter((l) => !have.includes(l));
        patch.removeLabels = have.filter((l) => !want.includes(l));
      }
      const a = writeAnnotation(opts.id, patch);
      console.log(JSON.stringify({ ok: true, annotation: a }));
    });

  gui.command('peek')
    .description('transcript tail of a session as JSON turns ({role,kind,text})')
    .requiredOption('--id <id>')
    .option('--lines <n>', 'max turns to return (from the end)', '60')
    .action(async (opts: { id: string; lines: string }) => {
      const matches = await getSession(opts.id);
      if (matches.length === 0) { console.log('[]'); return; }
      if (matches.length > 1) { console.error(JSON.stringify({ error: 'ambiguous', count: matches.length })); process.exit(2); }
      const turns = await readTranscript(matches[0].jsonlPath);
      const n = Math.max(1, parseInt(opts.lines, 10) || 60);
      const tail = turns.slice(-n).map((t) => ({ role: t.role, kind: t.kind, text: t.text }));
      console.log(JSON.stringify(tail));
    });

  gui.command('recap')
    .description('summarize a session via claude -p (cached); JSON {ok,text,generatedAt,fromCache}')
    .requiredOption('--id <id>')
    .option('--refresh', 'ignore the cache and regenerate')
    .option('--cached-only', 'return the cached recap if any, without generating')
    .action(async (opts: { id: string; refresh?: boolean; cachedOnly?: boolean }) => {
      // Always exit 0 and convey status in the JSON — the GUI decodes {ok,error} and shows the
      // real reason. (A non-zero exit collapses to an opaque "exit 1" on the Swift side.)
      const matches = await getSession(opts.id);
      if (matches.length !== 1) {
        console.log(JSON.stringify({ ok: false, error: matches.length === 0 ? 'session not found' : 'ambiguous id' }));
        return;
      }
      const s = matches[0];
      if (opts.cachedOnly) {
        const c = readCachedRecap(s.id);
        console.log(JSON.stringify(c
          ? { ok: true, text: c.text, generatedAt: c.generatedAt.toISOString(), fromCache: true }
          : { ok: false, error: 'no cached recap', fromCache: false }));
        return;
      }
      try {
        const r = await getRecap({ id: s.id, jsonlPath: s.jsonlPath }, { refresh: !!opts.refresh });
        console.log(JSON.stringify({ ok: true, text: r.text, generatedAt: r.generatedAt.toISOString(), fromCache: r.fromCache }));
      } catch (e) {
        console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    });

  gui.command('config-get')
    .description('the full editable config as JSON (shared with the TUI)')
    .action(() => {
      const { config } = loadConfig();
      console.log(JSON.stringify({
        defaultTool: config.defaultTool,
        terminal: config.gui.terminal,
        launchCommand: config.gui.launchCommand ?? null,
        hotkey: config.gui.hotkey ?? null,
        groups: config.groups.map((g) => ({ name: g.name, path: g.pathRaw, color: g.color })),
        tools: config.tools.map((t) => ({ name: t.name, runs: t.runs, label: t.label, color: t.color })),
        ides: config.ides.map((i) => ({ key: i.key, label: i.label, cmd: i.cmd })),
      }));
    });

  gui.command('config-save')
    .description('write the full config (reads editable JSON from stdin)')
    .action(async () => {
      const c = JSON.parse(await readStdin()) as {
        defaultTool?: string; terminal?: string; launchCommand?: string | null; hotkey?: string | null;
        groups?: Array<{ name: string; path: string; color: string }>;
        tools?: Array<{ name: string; runs: string; label: string; color: string }>;
        ides?: Array<{ key: string; label: string; cmd: string }>;
      };
      const obj: Record<string, unknown> = {};
      if (c.defaultTool) obj.default_tool = c.defaultTool;
      obj.group = (c.groups ?? []).filter((g) => g.name || g.path).map((g) => ({ name: g.name, path: g.path, color: g.color || '#8888aa' }));
      obj.tool = (c.tools ?? []).filter((t) => t.name).map((t) => ({ name: t.name, runs: t.runs, label: t.label, color: t.color || '#8888aa' }));
      obj.ide = (c.ides ?? []).filter((i) => i.key).map((i) => ({ key: i.key, label: i.label, cmd: i.cmd }));
      const guiObj: Record<string, unknown> = { terminal: c.terminal || 'default' };
      if (c.launchCommand) guiObj.launch_command = c.launchCommand;
      if (c.hotkey) guiObj.hotkey = c.hotkey;
      obj.gui = guiObj;
      const text = `# Agentctl config — editable by hand or via the GUI (agentctl config --edit).\n\n${tomlStringify(obj)}\n`;
      const p = configPath();
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
      clearConfigCache();
      console.log(JSON.stringify({ ok: true, path: p }));
    });

  gui.command('set-terminal <value>')
    .description('set [gui].terminal (value = "default" | app name | "custom")')
    .option('--command <template>', 'launch_command template for "custom"')
    .action((value: string, opts: { command?: string }) => {
      const p = setGuiTerminal(value, opts.command);
      console.log(JSON.stringify({ ok: true, terminal: value, configPath: p }));
    });

  gui.command('terminals')
    .description('list terminal options for the settings picker (with installed flag)')
    .action(() => {
      const { config } = loadConfig();
      const out = KNOWN_TERMINALS.map((t) => ({
        id: t.id, label: t.label,
        installed: t.appPaths.length === 0 ? true : t.appPaths.some((p) => existsSync(p)),
        selected: config.gui.terminal === t.id,
      }));
      console.log(JSON.stringify({ terminals: out, current: config.gui.terminal, customCommand: config.gui.launchCommand ?? null }));
    });
}
