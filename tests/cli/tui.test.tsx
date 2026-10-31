import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/cli/tui.js';
import type { SessionRecord } from '../../src/core/types.js';

/** One timestamp for every record: the TUI sorts newest-first, so a per-record `new Date()` that
 * crosses a millisecond tick mid-build reorders the list and flakes order-dependent tests. */
const NOW = new Date();

function rec(id: string, name: string): SessionRecord {
  return {
    id, name, transcriptName: name, cwd: '/tmp', launchCwd: '/tmp',
    cwdDecodeConfident: true,
    kind: 'interactive' as const,
    jsonlPath: '/x.jsonl',
    sizeBytes: 0,
    startedAt: NOW,
    lastUpdatedAt: NOW,
    active: false,
    status: 'inactive',
  };
}

/** Wait for ink's useEffect (setRawMode) to wire up, then write input and wait for re-render. */
async function sendKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise(r => setTimeout(r, 10));
  stdin.write(key);
  await new Promise(r => setTimeout(r, 10));
}

describe('App', () => {
  it('renders the session count and first session name', () => {
    const { lastFrame } = render(<App initial={[rec('aaaa1111-0000-0000-0000-000000000000', 'first')]} />);
    expect(lastFrame()).toContain('1 sessions');
    expect(lastFrame()).toContain('first');
  });

  it('cursor moves on arrow down', async () => {
    const { stdin, lastFrame } = render(
      <App initial={[
        rec('aaaa1111-0000-0000-0000-000000000000', 'first'),
        rec('bbbb2222-0000-0000-0000-000000000000', 'second'),
      ]} />
    );
    await sendKey(stdin, '\x1B[B');
    expect(lastFrame()).toContain('second');
  });

  it('filter mode shows the filter input', async () => {
    const { stdin, lastFrame } = render(
      <App initial={[rec('aaaa1111-0000-0000-0000-000000000000', 'first')]} />
    );
    await sendKey(stdin, '/');
    expect(lastFrame()).toContain('filter:');
  });
});

describe('long lists', () => {
  const many = Array.from({ length: 80 }, (_, i) =>
    rec(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, `session-${i}`));

  /** ink writes to a fake stdout with no real rows; the code falls back to 30. */
  const TERM_ROWS = 30;

  it('never renders more rows than the terminal can show', () => {
    const { lastFrame } = render(<App initial={many} />);
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(TERM_ROWS);
  });

  it('keeps the highlighted row inside the window while paging down', async () => {
    const { stdin, lastFrame } = render(<App initial={many} />);
    await sendKey(stdin, 'G');                       // jump to the last session
    expect(lastFrame()).toContain('session-79');
    expect(lastFrame()).toContain('▶');
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(TERM_ROWS);
    await sendKey(stdin, 'g');                       // back to the first
    expect(lastFrame()).toContain('session-0');
  });

  it('shows a scroll position counter and a scrollbar thumb', () => {
    const { lastFrame } = render(<App initial={many} />);
    expect(lastFrame()).toContain('1/80');
    expect(lastFrame()).toContain('█');
  });

  it('one arrow press moves one row after the filter shrinks the list', async () => {
    const { stdin, lastFrame } = render(<App initial={many} />);
    await sendKey(stdin, 'G');                       // cursor at 79
    await sendKey(stdin, '/');                       // filter mode
    await sendKey(stdin, 'session-1');               // matches session-1, -10..-19
    await sendKey(stdin, '\r');                      // back to list mode
    // Without the cursor reset the selection would sit on the last match and ↓ would do nothing.
    expect(lastFrame()).toContain('1/');
    await sendKey(stdin, '\x1B[B');
    expect(lastFrame()).toContain('2/');
  });
});

describe('filter box owns plain letters', () => {
  const many = Array.from({ length: 80 }, (_, i) =>
    rec(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, `jam-${i}`));

  it('typing j/k filters instead of moving the cursor', async () => {
    const { stdin, lastFrame } = render(<App initial={many} />);
    await sendKey(stdin, '/');
    await sendKey(stdin, 'j');
    expect(lastFrame()).toContain('filter j');
    expect(lastFrame()).toContain('1/80');   // still on the first match
    await sendKey(stdin, '\x1B[B');          // arrows still move
    expect(lastFrame()).toContain('2/80');
  });
});

describe('short terminals', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    rec(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, `session-${i}`));

  /** ink's fake stdout reports no size, so the code falls back to 30 rows / 80 cols. */
  it('keeps the whole render inside the terminal even with a note and a recap on screen', () => {
    const annotated = many.map((r, i) => i === 0
      ? { ...r, annotation: { sessionId: r.id, flags: ['todo'], labels: [], done: false, hidden: false, deleted: false, note: 'a\nb\nc' } }
      : r);
    const { lastFrame } = render(<App initial={annotated} />);
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(30);
    expect(lastFrame()).toContain('resume');   // header survived
  });
});

describe('find (S / agentctl -p)', () => {
  const waf = rec('aaaa1111-0000-0000-0000-000000000000', 'WAF deploy to prod');
  const other = rec('bbbb2222-0000-0000-0000-000000000000', 'mongo indexes');
  const answer = JSON.stringify({
    type: 'result', is_error: false,
    structured_output: { reply: 'The Oct 27 session did the terraform apply.', matches: [{ id: 'aaaa1111', why: 'name says WAF deploy' }] },
  });
  const settle = () => new Promise(r => setTimeout(r, 50));

  it('S opens the ask box; a question renders the reply and the match, ⏎ resumes it', async () => {
    const questions: string[] = [];
    const resumed: SessionRecord[] = [];
    const { stdin, lastFrame } = render(
      <App initial={[other, waf]} onResume={s => resumed.push(s)}
        findDeps={{ readRecap: () => null, run: (_a, input) => { questions.push(input); return { stdout: answer, status: 0 }; } }} />,
    );
    await sendKey(stdin, 'S');
    expect(lastFrame()).toContain('ask:');
    await sendKey(stdin, 'the waf one');
    await sendKey(stdin, '\r');
    await settle();
    expect(questions[0]).toContain('user: the waf one');
    expect(lastFrame()).toContain('terraform apply');
    expect(lastFrame()).toContain('name says WAF deploy');
    await sendKey(stdin, '\r'); // focus jumped to the results — ⏎ resumes the top match
    expect(resumed.map(s => s.id)).toEqual([waf.id]);
  });

  it('initialFind asks on mount; a follow-up resends the earlier exchange', async () => {
    const inputs: string[] = [];
    const { stdin, lastFrame } = render(
      <App initial={[other, waf]} initialFind="waf last week"
        findDeps={{ readRecap: () => null, run: (_a, input) => { inputs.push(input); return { stdout: answer, status: 0 }; } }} />,
    );
    await settle();
    expect(inputs).toHaveLength(1);
    expect(lastFrame()).toContain('waf last week');
    await sendKey(stdin, '\t');
    await sendKey(stdin, 'the terraform one');
    await sendKey(stdin, '\r');
    await settle();
    expect(inputs[1]).toContain('user: waf last week\nfinder: The Oct 27 session did the terraform apply. [matched: aaaa1111]\nuser: the terraform one');
  });

  it('a late answer leaves focus in the ask box while a follow-up is being typed', async () => {
    let release: (v: { stdout: string; status: number }) => void = () => {};
    const { stdin, lastFrame } = render(
      <App initial={[other, waf]} findDeps={{ readRecap: () => null, run: () => new Promise(r => { release = r; }) }} />,
    );
    await sendKey(stdin, 'S');
    await sendKey(stdin, 'waf');
    await sendKey(stdin, '\r');
    await sendKey(stdin, 'quick'); // typing the next question while Claude thinks
    release({ stdout: answer, status: 0 });
    await settle();
    expect(lastFrame()).toContain('name says WAF deploy');
    expect(lastFrame()).toContain('ask: quick');      // q/u/i/c/k went into the box, not to the list
    expect(lastFrame()).toContain('ask Claude');
  });

  it('esc: cancels a running ask, then clears the box, then leaves find', async () => {
    const { stdin, lastFrame } = render(
      <App initial={[waf]} findDeps={{ readRecap: () => null, run: () => new Promise(() => {}) }} />,
    );
    await sendKey(stdin, 'S');
    await sendKey(stdin, 'waf');
    await sendKey(stdin, '\r');
    expect(lastFrame()).toContain('thinking…');
    await sendKey(stdin, '\x1B');
    expect(lastFrame()).not.toContain('thinking…');
    await sendKey(stdin, 'abc');
    await sendKey(stdin, '\x1B');
    expect(lastFrame()).toContain('ask:');
    expect(lastFrame()).not.toContain('abc');
    await sendKey(stdin, '\x1B');
    expect(lastFrame()).not.toContain('ask:');
  });

  it('a long reply and ten long matches still fit a 30-row terminal', async () => {
    const recs = Array.from({ length: 10 }, (_, i) => rec(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, `session-${i}`));
    const long = JSON.stringify({ type: 'result', is_error: false, structured_output: {
      reply: 'word '.repeat(200), matches: recs.map(r => ({ id: r.id.slice(0, 8), why: 'because '.repeat(40) })) } });
    const { lastFrame } = render(
      <App initial={recs} initialFind="q" findDeps={{ readRecap: () => null, run: () => ({ stdout: long, status: 0 }) }} />,
    );
    await settle();
    expect(lastFrame()).toContain('10 matches');
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(28); // + 2-line tab bar in AppShell = 30
  });

  it('shows a claude error instead of crashing', async () => {
    const { stdin, lastFrame } = render(
      <App initial={[waf]} findDeps={{ readRecap: () => null, run: () => ({ stdout: JSON.stringify({ is_error: true, result: 'Not logged in' }), status: 1 }) }} />,
    );
    await sendKey(stdin, 'S');
    await sendKey(stdin, 'x');
    await sendKey(stdin, '\r');
    await settle();
    expect(lastFrame()).toContain('Not logged in');
  });
});
