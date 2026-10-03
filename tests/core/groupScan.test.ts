import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseZDb, sortGroup, listProjects } from '../../src/core/groupScan.js';
import type { GroupConfig } from '../../src/core/config/types.js';

let base: string;
const group = (path: string, name = 'G', color = '#6C91BF'): GroupConfig => ({ name, path, pathRaw: path, color });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agentctl-scan-'));
  for (const d of ['alpha', 'beta', 'gamma']) mkdirSync(join(base, d));
  mkdirSync(join(base, 'alpha', 'nested')); // one-level guard (mutates alpha mtime — set times AFTER)
  // distinct mtimes: gamma newest, alpha oldest
  utimesSync(join(base, 'alpha'), new Date(1000_000), new Date(1000_000));
  utimesSync(join(base, 'beta'), new Date(2000_000), new Date(2000_000));
  utimesSync(join(base, 'gamma'), new Date(3000_000), new Date(3000_000));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('parseZDb', () => {
  it('reads path|rank|time with time in seconds (field 2)', () => {
    const z = join(base, '.z');
    writeFileSync(z, `${join(base, 'beta')}|9|1700000000\n/other|1|1\nbadline\n`);
    const m = parseZDb(z);
    expect(m.get(join(base, 'beta'))).toBe(1700000000 * 1000);
    expect(m.size).toBe(2);
  });
  it('returns empty map when file missing', () => {
    expect(parseZDb(join(base, 'no.z')).size).toBe(0);
  });
});

describe('sortGroup', () => {
  it('one level only, mtime sort newest-first without z', () => {
    const dirs = sortGroup(group(base), new Map());
    expect(dirs.map(d => d.name)).toEqual(['gamma', 'beta', 'alpha']);
    expect(dirs.every(d => d.scoreSource === 'mtime')).toBe(true);
    expect(dirs.find(d => d.name === 'nested')).toBeUndefined();
  });

  it('z-scored dir sorts first', () => {
    const z = new Map([[join(base, 'alpha'), 9_000_000_000_000]]);
    const dirs = sortGroup(group(base), z);
    expect(dirs[0].name).toBe('alpha');
    expect(dirs[0].scoreSource).toBe('z');
  });

  it('attaches gitBranch only with withGit', () => {
    mkdirSync(join(base, 'beta', '.git'));
    writeFileSync(join(base, 'beta', '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    const off = sortGroup(group(base), new Map());
    expect(off.find(d => d.name === 'beta')?.gitBranch).toBeUndefined();
    const on = sortGroup(group(base), new Map(), true);
    expect(on.find(d => d.name === 'beta')?.gitBranch).toBe('feature/x');
  });

  it('skips dangling symlinks', () => {
    symlinkSync(join(base, 'does-not-exist'), join(base, 'broken'));
    const dirs = sortGroup(group(base), new Map());
    expect(dirs.find(d => d.name === 'broken')).toBeUndefined();
  });

  it('returns [] for a missing base path', () => {
    expect(sortGroup(group(join(base, 'ghost')), new Map())).toEqual([]);
  });
});

describe('listProjects', () => {
  it('preserves group order and uses zDataPath', async () => {
    const z = join(base, '.z');
    writeFileSync(z, `${join(base, 'alpha')}|9|1800000000\n`);
    const g2 = mkdtempSync(join(tmpdir(), 'agentctl-scan2-'));
    mkdirSync(join(g2, 'solo'));
    try {
      const out = await listProjects([group(base, 'First'), group(g2, 'Second')], { zDataPath: z });
      expect(out).toHaveLength(2);
      expect(out[0][0].name).toBe('alpha'); // z-boosted to top of group 1
      expect(out[1][0].name).toBe('solo');
    } finally {
      rmSync(g2, { recursive: true, force: true });
    }
  });
});
