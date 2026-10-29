import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions, getSession } from '../../src/core/sessionRepo.js';

let home: string;
let cwd: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentctl-repo-'));
  cwd = mkdtempSync(join(tmpdir(), 'agentctl-cwd-'));
  origHome = process.env.AGENTCTL_HOME;
  process.env.AGENTCTL_HOME = home;
  const encoded = cwd.replaceAll('/', '-');
  const projDir = join(home, 'projects', encoded);
  mkdirSync(projDir, { recursive: true });
  const id1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const id2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  writeFileSync(join(projDir, `${id1}.jsonl`),
    `{"type":"user","timestamp":1700000000000,"message":{"role":"user","content":"first session"}}\n`);
  writeFileSync(join(projDir, `${id2}.jsonl`),
    `{"type":"user","timestamp":1700000010000,"message":{"role":"user","content":"second session"}}\n`);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = origHome;
});

describe('listSessions', () => {
  it('returns one record per .jsonl with decoded cwd', async () => {
    const records = await listSessions();
    expect(records).toHaveLength(2);
    expect(records[0].cwd).toBe(cwd);
    expect(records[0].cwdDecodeConfident).toBe(true);
    expect(records[0].active).toBe(false);
    expect(records[0].status).toBe('inactive');
  });

  it('filters by cwd', async () => {
    const records = await listSessions({ cwd });
    expect(records).toHaveLength(2);
    const none = await listSessions({ cwd: '/no/such/place' });
    expect(none).toHaveLength(0);
  });

  it('never lists a session finder transcript, and exposes the first prompt', async () => {
    const origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(home, 'xdg.cfg');
    try {
      const finder = join(home, 'projects', join(home, 'xdg.cfg', 'agentctl', 'find').replace(/[^A-Za-z0-9]/g, '-'));
      mkdirSync(finder, { recursive: true });
      writeFileSync(join(finder, 'cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl'),
        `{"type":"user","timestamp":1700000020000,"message":{"role":"user","content":"catalog"}}\n`);
      const records = await listSessions();
      expect(records.map(r => r.id[0]).sort()).toEqual(['a', 'b']);
      expect(records.map(r => r.firstPrompt).sort()).toEqual(['first session', 'second session']);
    } finally {
      if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = origXdg;
    }
  });

  it('separates tool runs from interactive sessions, and filters on it', async () => {
    // A third transcript, stamped the way `claude -p` stamps a headless run.
    const encoded = cwd.replaceAll('/', '-');
    writeFileSync(join(home, 'projects', encoded, 'cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl'),
      `{"type":"user","entrypoint":"sdk-cli","timestamp":1700000020000,"message":{"role":"user","content":"headless run"}}\n`);

    const all = await listSessions();
    expect(all).toHaveLength(3);
    expect(all.filter(r => r.kind === 'tool').map(r => r.name)).toEqual(['headless run']);

    const tools = await listSessions({ kind: 'tool' });
    expect(tools.map(r => r.name)).toEqual(['headless run']);
    expect(tools[0].entrypoint).toBe('sdk-cli');

    const human = await listSessions({ kind: 'interactive' });
    expect(human).toHaveLength(2);
    expect(human.every(r => r.kind === 'interactive')).toBe(true);
  });

  it('lists where the work happened, not where claude was launched', async () => {
    // Claude Code stamps `cwd` on every record and it follows the session as it moves; the
    // project directory name only ever encodes the launch directory.
    const worked = mkdtempSync(join(tmpdir(), 'agentctl-worked-'));
    const encoded = cwd.replaceAll('/', '-');
    writeFileSync(join(home, 'projects', encoded, 'dddddddd-dddd-dddd-dddd-dddddddddddd.jsonl'),
      `{"type":"user","cwd":${JSON.stringify(cwd)},"timestamp":1700000030000,"message":{"role":"user","content":"moved session"}}\n`
      + `{"type":"user","cwd":${JSON.stringify(worked)},"timestamp":1700000031000,"message":{"role":"user","content":"later"}}\n`);

    const rec = (await listSessions()).find(r => r.name === 'moved session')!;
    expect(rec.cwd).toBe(worked);
    expect(rec.launchCwd).toBe(cwd);
    expect(rec.cwdDecodeConfident).toBe(true);
    rmSync(worked, { recursive: true, force: true });
  });

  it('falls back to the launch directory when the recorded one is gone', async () => {
    const encoded = cwd.replaceAll('/', '-');
    writeFileSync(join(home, 'projects', encoded, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.jsonl'),
      `{"type":"user","cwd":"/no/such/place","timestamp":1700000040000,"message":{"role":"user","content":"dead cwd"}}\n`);

    const rec = (await listSessions()).find(r => r.name === 'dead cwd')!;
    expect(rec.cwd).toBe(cwd);
    expect(rec.launchCwd).toBe(cwd);
  });

  it('limits and sorts by name', async () => {
    const records = await listSessions({ sortBy: 'name', limit: 1 });
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('first session');
  });

  it('returns [] when projects dir missing', async () => {
    rmSync(join(home, 'projects'), { recursive: true, force: true });
    expect(await listSessions()).toEqual([]);
  });
});

describe('getSession', () => {
  it('matches by prefix', async () => {
    const matches = await getSession('aaaa');
    expect(matches).toHaveLength(1);
    expect(matches[0].id.startsWith('aaaa')).toBe(true);
  });
});
