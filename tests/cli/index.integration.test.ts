import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', '..', 'src', 'cli', 'index.ts');
let home: string;
let cwdDir: string;

function runCli(args: string[]) {
  return spawnSync('npx', ['tsx', entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AGENTCTL_HOME: home, XDG_CONFIG_HOME: home, FORCE_COLOR: '0' },
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'agentctl-cli-'));
  cwdDir = mkdtempSync(join(tmpdir(), 'agentctl-cwd-'));
  const encoded = cwdDir.replaceAll('/', '-');
  const projDir = join(home, 'projects', encoded);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl'),
    `{"type":"user","timestamp":1700000000000,"message":{"role":"user","content":"hi from fixture"}}\n`,
  );
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwdDir, { recursive: true, force: true });
});

describe('agentctl CLI', () => {
  it('ls --json returns an array with the fixture session', () => {
    const r = runCli(['ls', '--json']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ id: string; name: string }>;
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('hi from fixture');
  });

  it('peek prints transcript turns', () => {
    const r = runCli(['peek', 'aaaaaaaa']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('hi from fixture');
  });

  it('exits 1 on missing id', () => {
    const r = runCli(['peek', 'zzzzzzzz']);
    expect(r.status).toBe(1);
  });
});

describe('hidden and deleted sessions', () => {
  const jsonl = () => join(home, 'projects', cwdDir.replaceAll('/', '-'),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl');
  const ids = (args: string[]) => JSON.parse(runCli([...args, '--json']).stdout).map((r: {id: string}) => r.id);
  const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('moves a session between the views, and back, without touching its transcript', () => {
    const before = statSync(jsonl());

    expect(ids(['ls'])).toContain(ID);

    runCli(['hide', '-s', ID]);
    expect(ids(['ls'])).not.toContain(ID);
    expect(ids(['ls', '--hidden'])).toContain(ID);
    expect(ids(['ls', '--all'])).toContain(ID);

    runCli(['delete', '-s', ID]);
    expect(ids(['ls'])).not.toContain(ID);
    expect(ids(['ls', '--hidden'])).not.toContain(ID);   // deleted outranks hidden
    expect(ids(['ls', '--deleted'])).toContain(ID);

    runCli(['delete', '-s', ID, '--undo']);
    runCli(['hide', '-s', ID, '--undo']);
    expect(ids(['ls'])).toContain(ID);

    // the whole point: none of that may write to ~/.claude
    const after = statSync(jsonl());
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('still resolves a deleted session by id, so it can be recovered', () => {
    runCli(['delete', '-s', ID]);
    const r = runCli(['path', ID.slice(0, 8)]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(jsonl());
    runCli(['delete', '-s', ID, '--undo']);
  });
});
