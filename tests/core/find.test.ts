import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCatalog, parseFindOutput, findSessions, FindError, FIND_SCHEMA, MAX_HISTORY, type FindTurn,
} from '../../src/core/find.js';
import { spawnRun, type RecapRun } from '../../src/core/recap.js';
import type { SessionRecord } from '../../src/core/types.js';

function rec(id: string, name: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id, name, transcriptName: name, cwd: '/tmp/proj', launchCwd: '/tmp/proj',
    cwdDecodeConfident: true, kind: 'interactive', jsonlPath: '/x.jsonl', sizeBytes: 0,
    startedAt: new Date('2026-10-20T10:00:00'), lastUpdatedAt: new Date('2026-10-27T14:03:00'),
    active: false, status: 'inactive', ...extra,
  };
}

const A = rec('aaaa1111-0000-0000-0000-000000000000', 'WAF deploy to prod', {
  firstPrompt: 'deploy the WAF with terraform', workDir: '/Users/x/ClaudWork/2026-10-25-reeco-waf',
  annotation: { sessionId: 'aaaa1111', flags: [], labels: ['RD-14001'], note: 'waiting on Dor', done: false, hidden: false, deleted: false },
});
const B = rec('bbbb2222-0000-0000-0000-000000000000', 'mongo indexes', { lastUpdatedAt: new Date('2026-10-28T09:00:00') });
const T = rec('cccc3333-0000-0000-0000-000000000000', 'recap run', { kind: 'tool' });

const ok = (so: unknown) => JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: so });
const noRecap = { readRecap: () => null };

describe('buildCatalog', () => {
  it('lists newest first with the row fields, omitting empty ones', () => {
    const cat = buildCatalog([A, B, T], { readRecap: id => (id === A.id ? '\n- Terraform WAF on CloudFront\n- more' : null) });
    const lines = cat.split('\n');
    expect(lines[0]).toBe('=== CATALOG: 3 sessions, newest first ===');
    expect(lines[1]).toMatch(/^bbbb2222 \| used 2026-10-28 09:00 \| started 2026-10-20 \| name: mongo indexes \| cwd: \/tmp\/proj$/);
    const a = lines.find(l => l.startsWith('aaaa1111'))!;
    expect(a).toContain('work: 2026-10-25-reeco-waf');
    expect(a).toContain('labels: RD-14001');
    expect(a).toContain('note: waiting on Dor');
    expect(a).toContain('first: deploy the WAF with terraform');
    expect(a).toContain('recap: - Terraform WAF on CloudFront');
    expect(lines.find(l => l.startsWith('cccc3333'))).toContain('| [tool] |');
  });

  it('shows the original title only when a rename overrides it', () => {
    const renamed = rec('dddd4444-0000-0000-0000-000000000000', 'my name', { transcriptName: 'ai title here' });
    expect(buildCatalog([renamed], noRecap)).toContain('title: ai title here');
    expect(buildCatalog([B], noRecap)).not.toContain('title:');
  });

  it('caps interactive and tool rows separately', () => {
    const many = Array.from({ length: 450 }, (_, i) => rec(`i${String(i).padStart(7, '0')}-x`, `s${i}`));
    const tools = Array.from({ length: 150 }, (_, i) => rec(`t${String(i).padStart(7, '0')}-x`, `t${i}`, { kind: 'tool' }));
    expect(buildCatalog([...many, ...tools], noRecap).split('\n')[0]).toContain('500 sessions');
  });
});

describe('parseFindOutput', () => {
  it('maps ids (full or prefix) to sessions in model order and drops unknown/ambiguous/dupes', () => {
    const recs = [A, B, T, rec('bbbb2299-0000-0000-0000-000000000000', 'other')];
    const r = parseFindOutput(ok({
      reply: 'Found it.',
      matches: [
        { id: 'aaaa1111', why: 'name says WAF' },
        { id: 'zzzz9999', why: 'invented' },
        { id: 'bbbb', why: 'ambiguous prefix' },
        { id: A.id, why: 'dupe' },
        { id: 'cccc3333-0000-0000-0000-000000000000', why: 'tool' },
      ],
    }), recs);
    expect(r.reply).toBe('Found it.');
    expect(r.matches.map(m => m.session.id.slice(0, 8))).toEqual(['aaaa1111', 'cccc3333']);
    expect(r.matches[0].why).toBe('name says WAF');
  });

  it('accepts an empty match list', () => {
    expect(parseFindOutput(ok({ reply: 'nothing', matches: [] }), [A]).matches).toEqual([]);
  });

  it('throws FindError on non-JSON, is_error and missing structured_output', () => {
    expect(() => parseFindOutput('boom', [A])).toThrow(/no JSON/);
    expect(() => parseFindOutput(JSON.stringify({ is_error: true, result: 'Not logged in' }), [A])).toThrow('Not logged in');
    expect(() => parseFindOutput(JSON.stringify({ is_error: false, result: 'hi' }), [A])).toThrow(/structured answer/);
  });

  it('strips terminal control sequences from model text', () => {
    const r = parseFindOutput(ok({ reply: 'hi\x1b]52;c;ZXZpbA==\x07 there', matches: [{ id: 'aaaa1111', why: '\x1b[2Jboom' }] }), [A]);
    expect(r.reply).toBe('hi ]52;c;ZXZpbA== there');
    expect(r.matches[0].why).toBe('[2Jboom');
  });

  it('reads the last line when something precedes the JSON', () => {
    expect(parseFindOutput('warning\n' + ok({ reply: 'r', matches: [] }), [A]).reply).toBe('r');
  });
});

describe('findSessions', () => {
  afterEach(() => { delete process.env.AGENTCTL_FIND_MODEL; });

  it('runs an isolated, tool-less claude -p and sends catalog + conversation on stdin', async () => {
    let args: string[] = [];
    let input = '';
    const history: FindTurn[] = [
      { role: 'user', text: 'the waf one' },
      { role: 'finder', text: 'Two candidates.', ids: ['aaaa1111', 'bbbb2222'] },
    ];
    const r = await findSessions([A, B], history, 'the terraform one', {
      ...noRecap,
      now: () => new Date('2026-10-29T12:00:00'),
      run: (a, i) => { args = a; input = i; return { stdout: ok({ reply: 'This one.', matches: [{ id: 'aaaa1111', why: 'terraform' }] }), status: 0 }; },
    });
    expect(r.matches[0].session).toBe(A);
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'haiku']);
    expect(args[args.indexOf('--json-schema') + 1]).toBe(FIND_SCHEMA);
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('project');
    expect(args).toEqual(expect.arrayContaining(['--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']));
    expect(args).not.toContain('--bare');
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('Now: 2026-10-29 12:00');
    expect(input).toMatch(/^=== CATALOG: 2 sessions/);
    expect(input).toContain('=== CONVERSATION ===\nuser: the waf one\nfinder: Two candidates. [matched: aaaa1111, bbbb2222]\nuser: the terraform one\n');
  });

  it('honours AGENTCTL_FIND_MODEL and caps history', async () => {
    process.env.AGENTCTL_FIND_MODEL = 'sonnet';
    let args: string[] = [];
    let input = '';
    const history: FindTurn[] = Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, text: `q${i}` }));
    await findSessions([A], history, 'now', {
      ...noRecap, run: (a, i) => { args = a; input = i; return { stdout: ok({ reply: '', matches: [] }), status: 0 }; },
    });
    expect(args[2]).toBe('sonnet');
    expect(input).not.toContain('user: q3\n');
    expect(input).toContain(`user: q${12 - MAX_HISTORY}\n`);
  });

  it('maps runner failures to FindError codes', async () => {
    const fail = (res: RecapRun) => findSessions([A], [], 'x', { ...noRecap, bin: 'nope', run: () => res });
    const enoent = Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' });
    await expect(fail({ stdout: '', status: null, error: enoent })).rejects.toMatchObject({ code: 127, message: expect.stringContaining('AGENTCTL_CLAUDE_BIN') });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(fail({ stdout: '', status: null, error: abort })).rejects.toMatchObject({ code: 130 });
    await expect(fail({ stdout: '', status: 2 })).rejects.toBeInstanceOf(FindError);
    await expect(fail({ stdout: '', status: 2 })).rejects.toMatchObject({ code: 2 });
    await expect(fail({ stdout: '', status: 0 })).rejects.toMatchObject({ code: 1 }); // never a "success" exit
  });
});

describe('spawnRun abort', () => {
  it('kills the child and resolves with an AbortError', async () => {
    const ac = new AbortController();
    const p = spawnRun('/bin/sleep', { signal: ac.signal })(['5'], '');
    ac.abort();
    const r = await p;
    expect(r.error?.name).toBe('AbortError');
  });
});
