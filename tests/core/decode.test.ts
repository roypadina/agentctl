import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCwd } from '../../src/core/decode.js';

describe('decodeCwd', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'agentctl-decode-'));
    mkdirSync(join(root, 'Users/roy/Code/Work/My-App-Repo/sub'), { recursive: true });
    mkdirSync(join(root, 'Users/roy/Code/plain'), { recursive: true });
    // Claude Code encodes `.` as `-` too, so a worktree under a dot-directory looks identical
    // to a path separator. This is the case that used to be permanently "cwd uncertain".
    mkdirSync(join(root, 'Users/roy/Code/Work/.bo-worktrees/bo-guides-poc'), { recursive: true });
  });
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  it('decodes pure-separator paths', () => {
    const enc = root.replaceAll('/', '-') + '-Users-roy-Code-plain';
    const r = decodeCwd(enc);
    expect(r.cwd).toBe(join(root, 'Users/roy/Code/plain'));
    expect(r.confident).toBe(true);
  });

  it('decodes paths with real dashes in leaf', () => {
    const enc = root.replaceAll('/', '-') + '-Users-roy-Code-Work-My-App-Repo';
    const r = decodeCwd(enc);
    expect(r.cwd).toBe(join(root, 'Users/roy/Code/Work/My-App-Repo'));
    expect(r.confident).toBe(true);
  });

  it('decodes paths with real dashes mid-tree', () => {
    const enc = root.replaceAll('/', '-') + '-Users-roy-Code-Work-My-App-Repo-sub';
    const r = decodeCwd(enc);
    expect(r.cwd).toBe(join(root, 'Users/roy/Code/Work/My-App-Repo/sub'));
    expect(r.confident).toBe(true);
  });

  it('returns aggressive non-confident result when nothing matches', () => {
    const r = decodeCwd('-nonexistent-path-xyz');
    expect(r.cwd).toBe('/nonexistent/path/xyz');
    expect(r.confident).toBe(false);
  });

  it('resolves directories whose name contains a dot', () => {
    const enc = root.replaceAll('/', '-') + '-Users-roy-Code-Work--bo-worktrees-bo-guides-poc';
    const r = decodeCwd(enc);
    expect(r.cwd).toBe(join(root, 'Users/roy/Code/Work/.bo-worktrees/bo-guides-poc'));
    expect(r.confident).toBe(true);
  });

  it('sees a directory created after the first decode (no stale listing cache)', () => {
    const enc = root.replaceAll('/', '-') + '-Users-roy-Code-later';
    expect(decodeCwd(enc).confident).toBe(false);
    mkdirSync(join(root, 'Users/roy/Code/later'), { recursive: true });
    expect(decodeCwd(enc).confident).toBe(true);
  });
});
