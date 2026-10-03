import { join, resolve, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { GroupConfig, IdeConfig, ToolConfig } from './config/types.js';

export type LaunchKind =
  | 'interactive'      // ends in a stdio:inherit launch; tear down ink, spawn, exit
  | 'detached'         // open something + return to the menu (no tool launch)
  | 'tmux-attached'    // tmux new-session -A (attaches; inherit)
  | 'tmux-background'  // inside tmux: new-session -d + switch-client (leaves menu)
  | 'fs-only';         // (reserved; new-dir folds into 'interactive' with mkdir)

export interface LaunchStep {
  /** Shell command line; may reference $dir (lowercase) which the executor sets + quotes. */
  command: string;
  cwd: string;
  stdio: 'inherit' | 'ignore';
  detached?: boolean;
}

export interface LaunchPlan {
  kind: LaunchKind;
  /** must unmount ink + spawn from the chokepoint (and usually process.exit after). */
  requiresTeardown: boolean;
  /** execute steps inline (no teardown) then re-render the menu. */
  returnsToTui: boolean;
  /** mkdir -p this before running steps. */
  mkdir?: string;
  steps: LaunchStep[];
  tmuxSession?: string;
}

export interface NewDirRequest {
  mode: 'group' | 'under' | 'full';
  name: string;
  /** 1-based group index for mode 'group'. */
  index?: number;
  /** for mode 'under'; caller passes only when it's a real project dir. */
  highlightedDir?: string;
  cwd: string;
}

export interface LaunchRequest {
  /** selected project dir (or, for new-dir, the resolved target). */
  dir: string;
  /** '' = enter; otherwise a ctrl-key. */
  key: '' | string;
  tool: ToolConfig;
  /** present when key matches a configured ide key. */
  ide?: IdeConfig;
  insideTmux: boolean;
}

export function sanitizeTmuxName(tool: string, dir: string): string {
  return `${tool}-${basename(dir)}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

const run = (cmd: string, cwd: string): LaunchStep => ({ command: cmd, cwd, stdio: 'inherit' });

/** Map a key + selection to a launch plan, mirroring the shell launcher dispatch. */
export function planLaunch(req: LaunchRequest): LaunchPlan {
  const { dir, key, tool, ide, insideTmux } = req;
  const runs = tool.runs;

  // IDE key: open editor (detached) then launch the tool (interactive). `eval cmd; cd && run`.
  if (ide) {
    return {
      kind: 'interactive',
      requiresTeardown: true,
      returnsToTui: false,
      steps: [
        { command: ide.cmd, cwd: dir, stdio: 'ignore', detached: true },
        run(runs, dir),
      ],
    };
  }

  switch (key) {
    case 'ctrl-f': // finder: open dir, stay in menu
      return {
        kind: 'detached',
        requiresTeardown: false,
        returnsToTui: true,
        steps: [{ command: 'open "$dir"', cwd: dir, stdio: 'ignore', detached: true }],
      };

    case 'ctrl-p': // git pull then launch
      return {
        kind: 'interactive',
        requiresTeardown: true,
        returnsToTui: false,
        steps: [run('git -C "$dir" pull', dir), run(runs, dir)],
      };

    case 'ctrl-t': {
      const session = sanitizeTmuxName(tool.name, dir);
      if (insideTmux) {
        return {
          kind: 'tmux-background',
          requiresTeardown: true,
          returnsToTui: false,
          tmuxSession: session,
          steps: [
            { command: `tmux new-session -d -s ${session} -c "$dir" ${runs}`, cwd: dir, stdio: 'ignore' },
            { command: `tmux switch-client -t ${session}`, cwd: dir, stdio: 'ignore' },
          ],
        };
      }
      return {
        kind: 'tmux-attached',
        requiresTeardown: true,
        returnsToTui: false,
        tmuxSession: session,
        steps: [run(`tmux new-session -A -s ${session} -c "$dir" ${runs}`, dir)],
      };
    }

    case '': // enter → launch in dir
    default:
      return {
        kind: 'interactive',
        requiresTeardown: true,
        returnsToTui: false,
        steps: [run(runs, dir)],
      };
  }
}

/** Plan for a new-dir creation that then launches the tool. */
export function planNewDir(targetDir: string, tool: ToolConfig): LaunchPlan {
  return {
    kind: 'interactive',
    requiresTeardown: true,
    returnsToTui: false,
    mkdir: targetDir,
    steps: [run(tool.runs, targetDir)],
  };
}

function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve a new-dir request to an absolute target path + its base. Pure (no fs). */
export function resolveNewDir(req: NewDirRequest, groups: GroupConfig[]): { path: string; base: string } {
  if (req.mode === 'full') {
    const expanded = expandTilde(req.name);
    const path = isAbsolute(expanded) ? expanded : resolve(req.cwd, expanded);
    return { path, base: '' };
  }
  let base: string;
  if (req.mode === 'group') {
    const i = (req.index ?? 0) - 1; // 1-based
    if (i < 0 || i >= groups.length) {
      throw new RangeError(`group index ${req.index} out of range (1..${groups.length})`);
    }
    base = groups[i].path;
  } else {
    // 'under'
    base = req.highlightedDir && req.highlightedDir.trim() ? req.highlightedDir : req.cwd;
  }
  return { path: join(base, req.name), base };
}

/** Default new-dir choice: the group whose path contains the highlighted dir, else group 1, else 'full'. */
export function defaultNewDirChoice(
  highlightedDir: string | undefined,
  groups: GroupConfig[],
): number | 'full' {
  if (groups.length === 0) return 'full';
  if (highlightedDir) {
    for (let i = 0; i < groups.length; i++) {
      const base = groups[i].path;
      if (highlightedDir === base || highlightedDir.startsWith(base + '/')) return i + 1;
    }
  }
  return 1;
}
