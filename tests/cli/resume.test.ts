import { describe, it, expect, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resume, resumeEnv, ResumeError } from '../../src/cli/resume.js';
import type { SessionRecord } from '../../src/core/types.js';

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'x',
    transcriptName: 'x',
    cwd: '/tmp',
    launchCwd: '/tmp',
    cwdDecodeConfident: true,
    kind: 'interactive' as const,
    jsonlPath: '/x.jsonl',
    sizeBytes: 0,
    startedAt: new Date(),
    lastUpdatedAt: new Date(),
    active: false,
    status: 'inactive',
    ...overrides,
  };
}

describe('resume', () => {
  it('throws ResumeError(3) when cwd does not exist', () => {
    const exit = vi.fn();
    expect(() =>
      resume(record({ cwd: '/no/such/dir' }), {}, {
        exists: () => false,
        spawn: vi.fn() as never,
        exit: exit as never,
      })
    ).toThrow(ResumeError);
  });

  it('refuses busy active session without --yes', () => {
    expect(() =>
      resume(record({ active: true, status: 'busy' }), {}, {
        exists: () => true,
        spawn: vi.fn() as never,
        exit: vi.fn() as never,
      })
    ).toThrow(/busy/);
  });

  it('spawns claude with --resume and --permission-mode auto by default', () => {
    const spawn = vi.fn(() => ({ status: 0, error: undefined })) as never;
    const exit = vi.fn();
    resume(record(), {}, { exists: () => true, spawn, exit: exit as never, permissionMode: () => 'auto' });
    expect(spawn).toHaveBeenCalledOnce();
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe('claude');
    expect(call[1]).toEqual([
      '--resume',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '--permission-mode',
      'auto',
    ]);
    expect((call[2] as { cwd: string }).cwd).toBe('/tmp');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('opt-in bypassPermissions resumes with --dangerously-skip-permissions', () => {
    const spawn = vi.fn(() => ({ status: 0, error: undefined })) as never;
    resume(record(), {}, { exists: () => true, spawn, exit: vi.fn() as never, permissionMode: () => 'bypassPermissions' });
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[1]).toEqual(['--resume', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '--dangerously-skip-permissions']);
  });

  it('throws ResumeError(127) when claude binary missing', () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    const spawn = vi.fn(() => ({ status: null, error: enoent })) as never;
    expect(() =>
      resume(record(), {}, {
        exists: () => true,
        spawn,
        exit: vi.fn() as never,
      })
    ).toThrow(/not found on PATH/);
  });
});

describe('profile pinning', () => {
  it('resumes under the session own profile, not the ambient one', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    resume(
      record({ configDir: '/Users/x/.claude3' }),
      {},
      { exists: () => true, spawn: spawn as never, exit: (() => undefined) as never },
    );
    expect(spawn.mock.calls[0][2].env.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude3');
  });

  it('leaves the environment alone when the profile is unknown', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    resume(record(), {}, { exists: () => true, spawn: spawn as never, exit: (() => undefined) as never });
    expect(spawn.mock.calls[0][2].env).toBe(process.env);
  });
});

describe('the default profile must not be pinned', () => {
  it('unsets CLAUDE_CONFIG_DIR for the primary home, even when one is ambient', () => {
    const env = resumeEnv(
      record({ configDir: join(homedir(), '.claude') }),
      { PATH: '/bin', CLAUDE_CONFIG_DIR: '/Users/x/.claude3' },
    );
    // ~/.claude.json is the primary's config; pinning ~/.claude would pick the wrong one
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
    expect(env.PATH).toBe('/bin');
  });

  it('still pins a real side profile', () => {
    const env = resumeEnv(record({ configDir: '/Users/x/.claude3' }), { PATH: '/bin' });
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude3');
  });
});
