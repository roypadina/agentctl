import { describe, it, expect } from 'vitest';
import {
  planLaunch, planNewDir, resolveNewDir, defaultNewDirChoice, sanitizeTmuxName,
  type LaunchRequest,
} from '../../src/core/launchSpec.js';
import type { GroupConfig, ToolConfig, IdeConfig } from '../../src/core/config/types.js';

const tool: ToolConfig = { name: 'claude', runs: 'claude --x', label: ' c ', color: '#6C91BF' };
const ide: IdeConfig = { key: 'ctrl-v', label: 'code', cmd: 'code "$dir"' };
const groups: GroupConfig[] = [
  { name: 'FE', path: '/code/fe', pathRaw: '~/code/fe', color: '#1' },
  { name: 'BE', path: '/code/be', pathRaw: '~/code/be', color: '#2' },
];
const req = (over: Partial<LaunchRequest>): LaunchRequest =>
  ({ dir: '/code/fe/app', key: '', tool, insideTmux: false, ...over });

describe('planLaunch', () => {
  it('enter → interactive single run', () => {
    const p = planLaunch(req({ key: '' }));
    expect(p.kind).toBe('interactive');
    expect(p.requiresTeardown).toBe(true);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ command: 'claude --x', cwd: '/code/fe/app', stdio: 'inherit' });
  });

  it('ctrl-p → 2-step pull then run, both inherit', () => {
    const p = planLaunch(req({ key: 'ctrl-p' }));
    expect(p.steps.map(s => s.command)).toEqual(['git -C "$dir" pull', 'claude --x']);
    expect(p.steps.every(s => s.stdio === 'inherit')).toBe(true);
  });

  it('ide key → detached open then interactive run', () => {
    const p = planLaunch(req({ key: 'ctrl-v', ide }));
    expect(p.steps[0]).toMatchObject({ command: 'code "$dir"', stdio: 'ignore', detached: true });
    expect(p.steps[1].command).toBe('claude --x');
    expect(p.requiresTeardown).toBe(true);
  });

  it('ctrl-f → detached finder, returns to TUI, no tool launch', () => {
    const p = planLaunch(req({ key: 'ctrl-f' }));
    expect(p.kind).toBe('detached');
    expect(p.returnsToTui).toBe(true);
    expect(p.requiresTeardown).toBe(false);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].command).toBe('open "$dir"');
  });

  it('ctrl-t outside tmux → attached new-session', () => {
    const p = planLaunch(req({ key: 'ctrl-t', insideTmux: false }));
    expect(p.kind).toBe('tmux-attached');
    expect(p.steps[0].command).toBe('tmux new-session -A -s claude-app -c "$dir" claude --x');
    expect(p.steps[0].stdio).toBe('inherit');
  });

  it('ctrl-t inside tmux → background + switch-client', () => {
    const p = planLaunch(req({ key: 'ctrl-t', insideTmux: true }));
    expect(p.kind).toBe('tmux-background');
    expect(p.steps.map(s => s.command)).toEqual([
      'tmux new-session -d -s claude-app -c "$dir" claude --x',
      'tmux switch-client -t claude-app',
    ]);
  });
});

describe('planNewDir', () => {
  it('mkdir then interactive run', () => {
    const p = planNewDir('/code/fe/new', tool);
    expect(p.mkdir).toBe('/code/fe/new');
    expect(p.steps[0]).toMatchObject({ command: 'claude --x', cwd: '/code/fe/new', stdio: 'inherit' });
  });
});

describe('resolveNewDir', () => {
  it('group mode (1-based) joins under the group path', () => {
    expect(resolveNewDir({ mode: 'group', index: 2, name: 'svc', cwd: '/x' }, groups))
      .toEqual({ path: '/code/be/svc', base: '/code/be' });
  });
  it('group index out of range throws', () => {
    expect(() => resolveNewDir({ mode: 'group', index: 9, name: 'x', cwd: '/x' }, groups)).toThrow(RangeError);
  });
  it('under mode uses highlighted dir, falls back to cwd', () => {
    expect(resolveNewDir({ mode: 'under', name: 'sub', highlightedDir: '/code/fe/app', cwd: '/x' }, groups).path)
      .toBe('/code/fe/app/sub');
    expect(resolveNewDir({ mode: 'under', name: 'sub', cwd: '/x' }, groups).path).toBe('/x/sub');
  });
  it('full mode: absolute as-is, relative resolved against cwd, ~ expands', () => {
    expect(resolveNewDir({ mode: 'full', name: '/abs/p', cwd: '/x' }, groups).path).toBe('/abs/p');
    expect(resolveNewDir({ mode: 'full', name: 'rel/p', cwd: '/x' }, groups).path).toBe('/x/rel/p');
    expect(resolveNewDir({ mode: 'full', name: '~/p', cwd: '/x' }, groups).path).toMatch(/\/p$/);
  });
});

describe('defaultNewDirChoice', () => {
  it('returns the group index containing the highlighted dir', () => {
    expect(defaultNewDirChoice('/code/be/api', groups)).toBe(2);
    expect(defaultNewDirChoice('/code/fe', groups)).toBe(1);
  });
  it('returns 1 when no match, full when no groups', () => {
    expect(defaultNewDirChoice('/elsewhere', groups)).toBe(1);
    expect(defaultNewDirChoice('/x', [])).toBe('full');
  });
});

describe('sanitizeTmuxName', () => {
  it('replaces non-word chars', () => {
    expect(sanitizeTmuxName('claude', '/a/b/My Proj.v2')).toBe('claude-My_Proj_v2');
  });
});
