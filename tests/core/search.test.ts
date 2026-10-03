import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from '../../src/core/sessionRepo.js';
import { searchSessions } from '../../src/core/search.js';

let home: string;
let cwd: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentctl-search-'));
  cwd = mkdtempSync(join(tmpdir(), 'agentctl-search-cwd-'));
  origHome = process.env.AGENTCTL_HOME;
  process.env.AGENTCTL_HOME = home;
  const encoded = cwd.replaceAll('/', '-');
  const projDir = join(home, 'projects', encoded);
  mkdirSync(projDir, { recursive: true });
  const id1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const id2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const id3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  writeFileSync(join(projDir, `${id1}.jsonl`),
    `{"type":"user","timestamp":1700000000000,"message":{"role":"user","content":"talk about kubernetes deployment"}}\n` +
    `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"sure here is the answer"}]}}\n`);
  writeFileSync(join(projDir, `${id2}.jsonl`),
    `{"type":"user","timestamp":1700000010000,"message":{"role":"user","content":"snowflake cli installation help"}}\n`);
  writeFileSync(join(projDir, `${id3}.jsonl`),
    `{"type":"user","timestamp":1700000020000,"message":{"role":"user","content":"random unrelated chat"}}\n` +
    `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"more about snowflake here"}]}}\n`);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = origHome;
});

describe('searchSessions', () => {
  it('yields a match per session containing the query (any field)', async () => {
    const records = await listSessions();
    const results = [];
    for await (const m of searchSessions(records, 'snowflake')) results.push(m);
    expect(results.length).toBe(2);
    expect(results.map(r => r.session.id.slice(0, 4)).sort()).toEqual(['bbbb', 'cccc']);
  });

  it('matches all whitespace-split terms in any order (smart fuzzy)', async () => {
    const records = await listSessions();
    const results = [];
    for await (const m of searchSessions(records, 'help cli snowflake')) results.push(m);
    expect(results).toHaveLength(1);
    expect(results[0].excerpt.toLowerCase()).toContain('snowflake');
  });

  it('returns no results for missing query', async () => {
    const records = await listSessions();
    const results = [];
    for await (const m of searchSessions(records, 'doesnotexist_xyz')) results.push(m);
    expect(results).toEqual([]);
  });

  it('aborts mid-iteration when AbortSignal fires', async () => {
    const records = await listSessions();
    const ac = new AbortController();
    const results = [];
    for await (const m of searchSessions(records, 'a', { signal: ac.signal })) {
      results.push(m);
      ac.abort();
    }
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
