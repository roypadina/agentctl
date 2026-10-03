import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLiveSessions, isPidAlive, liveSessionById } from '../../src/core/liveState.js';

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentctl-live-'));
  mkdirSync(join(home, 'sessions'), { recursive: true });
  origHome = process.env.AGENTCTL_HOME;
  process.env.AGENTCTL_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = origHome;
});

describe('readLiveSessions', () => {
  it('returns empty when sessions dir missing', () => {
    rmSync(join(home, 'sessions'), { recursive: true, force: true });
    expect(readLiveSessions()).toEqual([]);
  });

  it('parses valid session files and skips corrupt ones', () => {
    writeFileSync(join(home, 'sessions', '1111.json'), JSON.stringify({
      pid: 1111, sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cwd: '/x', startedAt: 1, updatedAt: 2, status: 'idle',
    }));
    writeFileSync(join(home, 'sessions', 'bad.json'), 'not json');
    writeFileSync(join(home, 'sessions', 'wrong.json'), JSON.stringify({ foo: 1 }));
    const out = readLiveSessions();
    expect(out).toHaveLength(1);
    expect(out[0].pid).toBe(1111);
  });
});

describe('isPidAlive', () => {
  it('returns true for the current process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for an obviously dead PID', () => {
    expect(isPidAlive(2147483646)).toBe(false);
  });
});

describe('side profiles', () => {
  it('reads sessions from every ~/.claude* profile', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agentctl-profiles-'));
    const origHome = process.env.HOME;
    const origAgentctlHome = process.env.AGENTCTL_HOME;
    process.env.HOME = fakeHome;
    delete process.env.AGENTCTL_HOME;
    try {
      for (const [profile, pid] of [['.claude', 1111], ['.claude3', 2222]] as const) {
        mkdirSync(join(fakeHome, profile, 'sessions'), { recursive: true });
        writeFileSync(join(fakeHome, profile, 'sessions', `${pid}.json`), JSON.stringify({
          pid, sessionId: `id-${pid}`, cwd: '/x', startedAt: 1, updatedAt: 2, status: 'idle',
        }));
      }
      expect(readLiveSessions().map(s => s.pid).sort()).toEqual([1111, 2222]);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
      if (origAgentctlHome === undefined) delete process.env.AGENTCTL_HOME; else process.env.AGENTCTL_HOME = origAgentctlHome;
    }
  });
});

describe('liveSessionById', () => {
  it('returns null when no matching session', () => {
    expect(liveSessionById('not-there')).toBeNull();
  });
});
