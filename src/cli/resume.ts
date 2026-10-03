import { existsSync } from 'node:fs';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { isPrimaryHome } from '../core/profiles.js';
import type { SessionRecord } from '../core/types.js';

export class ResumeError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'ResumeError';
  }
}

export interface ResumeOptions {
  yes?: boolean;
  cwdOverride?: string;
}

export interface ResumeDeps {
  exists?: (p: string) => boolean;
  spawn?: (
    cmd: string,
    args: string[],
    opts: { cwd: string; stdio: 'inherit'; env: NodeJS.ProcessEnv },
  ) => SpawnSyncReturns<Buffer>;
  exit?: (code: number) => never;
}

/**
 * Pin CLAUDE_CONFIG_DIR to the session's own profile, so resuming does not inherit whichever
 * profile happened to launch the menu.
 *
 * The default profile is the exception and must be UNSET rather than pinned: its config lives at
 * `~/.claude.json`, beside the directory. Setting `CLAUDE_CONFIG_DIR=~/.claude` sends Claude to
 * `~/.claude/.claude.json` instead — a different, usually logged-out profile — which shows up as
 * an unexpected login prompt.
 */
export function resumeEnv(s: SessionRecord, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!s.configDir) return env;
  if (isPrimaryHome(s.configDir)) {
    const next = { ...env };
    delete next.CLAUDE_CONFIG_DIR;
    return next;
  }
  return { ...env, CLAUDE_CONFIG_DIR: s.configDir };
}

export function resume(
  s: SessionRecord,
  opts: ResumeOptions = {},
  deps: ResumeDeps = {},
): void {
  const exists = deps.exists ?? existsSync;
  const spawn = deps.spawn ?? (spawnSync as unknown as NonNullable<ResumeDeps['spawn']>);
  const exit = deps.exit ?? ((code: number) => { process.exit(code); }) as (code: number) => never;

  const targetCwd = opts.cwdOverride ?? s.cwd;
  if (!targetCwd || !exists(targetCwd)) {
    throw new ResumeError(3, `session cwd missing: ${targetCwd ?? '(unknown)'}`);
  }
  if (s.active && s.status === 'busy' && !opts.yes) {
    throw new ResumeError(4, `session ${s.id.slice(0, 8)} is busy; pass --yes to resume anyway`);
  }
  const bin = process.env.AGENTCTL_CLAUDE_BIN ?? 'claude';
  const child = spawn(
    bin,
    ['--resume', s.id, '--dangerously-skip-permissions'],
    { cwd: targetCwd, stdio: 'inherit', env: resumeEnv(s) },
  );
  const err = child.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === 'ENOENT') {
    throw new ResumeError(127, `claude not found on PATH (override via AGENTCTL_CLAUDE_BIN)`);
  }
  exit(child.status ?? 1);
}
