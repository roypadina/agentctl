import { describe, it, expect } from 'vitest';
import { executePlan, type LaunchDeps } from '../../src/cli/launch.js';
import { planLaunch, planNewDir } from '../../src/core/launchSpec.js';
import type { ToolConfig, IdeConfig } from '../../src/core/config/types.js';

const tool: ToolConfig = { name: 'claude', runs: 'claude --x', label: '', color: '#6C91BF' };
const ide: IdeConfig = { key: 'ctrl-v', label: 'code', cmd: 'code "$dir"' };

interface Call { cmd: string; args: string[]; opts: { cwd?: string; stdio?: string; detached?: boolean }; async?: boolean }
function harness() {
  const calls: Call[] = [];
  const mkdirs: string[] = [];
  const deps: LaunchDeps = {
    spawnSync: ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args, opts: opts as Call['opts'] });
      return { status: 0, error: undefined } as never;
    }) as unknown as LaunchDeps['spawnSync'],
    spawn: ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args, opts: opts as Call['opts'], async: true });
      return { unref() {} } as never;
    }) as unknown as LaunchDeps['spawn'],
    mkdir: (p: string) => { mkdirs.push(p); },
    exists: () => true,
  };
  return { calls, mkdirs, deps };
}

describe('executePlan', () => {
  it('enter: runs the tool via shell -c with lowercase $dir set + shell-quoted (B5)', () => {
    const { calls, deps } = harness();
    const code = executePlan(planLaunch({ dir: '/a b/app', key: '', tool, insideTmux: false }), deps);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('-c');
    expect(calls[0].args[1]).toContain("dir='/a b/app'");
    expect(calls[0].args[1]).toContain('claude --x');
    expect(calls[0].opts.cwd).toBe('/a b/app');
    expect(calls[0].opts.stdio).toBe('inherit');
  });

  it('ide: opens editor detached (async spawn) then runs the tool (sync inherit)', () => {
    const { calls, deps } = harness();
    executePlan(planLaunch({ dir: '/a/app', key: 'ctrl-v', tool, ide, insideTmux: false }), deps);
    expect(calls).toHaveLength(2);
    expect(calls[0].async).toBe(true);
    expect(calls[0].opts.detached).toBe(true);
    expect(calls[0].args[1]).toContain('code "$dir"');
    expect(calls[1].async).toBeUndefined();
    expect(calls[1].args[1]).toContain('claude --x');
    expect(calls[1].opts.stdio).toBe('inherit');
  });

  it('ctrl-p: pull then run, both inherit', () => {
    const { calls, deps } = harness();
    executePlan(planLaunch({ dir: '/a/app', key: 'ctrl-p', tool, insideTmux: false }), deps);
    expect(calls.map(c => c.args[1].includes('git -C "$dir" pull'))).toEqual([true, false]);
    expect(calls[1].args[1]).toContain('claude --x');
  });

  it('new-dir: mkdir -p before launching', () => {
    const { calls, mkdirs, deps } = harness();
    executePlan(planNewDir('/new/svc', tool), deps);
    expect(mkdirs).toEqual(['/new/svc']);
    expect(calls[0].opts.cwd).toBe('/new/svc');
  });

  it('finder (returnsToTui): only a detached open, returns 0, no interactive step', () => {
    const { calls, deps } = harness();
    const plan = planLaunch({ dir: '/a/app', key: 'ctrl-f', tool, insideTmux: false });
    const code = executePlan(plan, deps);
    expect(plan.returnsToTui).toBe(true);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].async).toBe(true);
    expect(calls[0].args[1]).toContain('open "$dir"');
  });
});
