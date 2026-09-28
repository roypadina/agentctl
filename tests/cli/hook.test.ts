import { describe, it, expect } from 'vitest';
import { parseSessionId, sessionStartContext } from '../../src/cli/hook.js';
import type { Annotation } from '../../src/core/types.js';

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const payload = JSON.stringify({ session_id: ID, hook_event_name: 'SessionStart', source: 'startup' });
const ann = (o: Partial<Annotation> = {}): Annotation => ({ sessionId: ID, flags: [], labels: [], done: false, hidden: false, deleted: false, ...o });
const none = { annotation: () => null, all: () => new Map<string, Annotation>() };

describe('parseSessionId', () => {
  it('reads session_id and survives junk', () => {
    expect(parseSessionId(payload)).toBe(ID);
    expect(parseSessionId('not json')).toBeNull();
    expect(parseSessionId('{}')).toBeNull();
  });
});

describe('sessionStartContext', () => {
  it('says nothing at all when there is no session id', () => {
    expect(sessionStartContext('not json', none)).toBe('');
  });

  it('nudges an unnamed session to name itself', () => {
    expect(sessionStartContext(payload, none)).toContain('has no Agentctl name');
  });

  it('hands a named session its own name instead of the nudge', () => {
    const out = sessionStartContext(payload, { ...none, annotation: () => ann({ name: 'billing spike' }) });
    expect(out).toContain('"billing spike"');
    expect(out).not.toContain('has no Agentctl name');
  });

  it('surfaces flags, notes, done state and a due reminder', () => {
    const out = sessionStartContext(payload, {
      ...none,
      annotation: () => ann({ flags: ['todo'], note: 'waiting on Dor', done: true, remindAt: '2020-01-01T00:00:00Z' }),
      now: new Date('2026-08-29T12:00:00Z'),
    });
    expect(out).toContain('#todo');
    expect(out).toContain('waiting on Dor');
    expect(out).toContain('agentctl done --undo');
    // a done session never nags about its reminder
    expect(out).not.toContain('reminder is due');
  });

  it('reports reminders that came due on OTHER sessions', () => {
    const other = ann({ sessionId: 'bbbb', name: 'the other one', remindAt: '2020-01-01T00:00:00Z' });
    const out = sessionStartContext(payload, {
      annotation: () => null,
      all: () => new Map([['bbbb', other]]),
      now: new Date('2026-08-29T12:00:00Z'),
    });
    expect(out).toContain('1 other session(s)');
    expect(out).toContain('the other one');
    expect(out).toContain('`agentctl resume bbbb`');
  });

  it('always ends with the tool list so the model knows the commands', () => {
    const last = sessionStartContext(payload, none).trimEnd().split('\n').at(-1)!;
    expect(last).toContain('agentctl name/note/label/flag/remind/due/done');
    expect(last).toContain('agentctl-sessions');
  });

  it('points at the branch issue key when the session has no labels yet', () => {
    const out = sessionStartContext(payload, { ...none, branch: () => 'feature/RD-12345-thing' });
    expect(out).toContain('RD-12345');
    expect(out).toContain('agentctl label RD-12345');
  });

  it('says nothing about the branch once labels exist', () => {
    const out = sessionStartContext(payload, {
      ...none,
      annotation: () => ann({ labels: ['RD-999'] }),
      branch: () => 'feature/RD-12345-thing',
    });
    expect(out).toContain('RD-999');
    expect(out).not.toContain('RD-12345');
  });

  it('flags an overdue session and reports a future due date plainly', () => {
    const now = new Date('2026-08-29T12:00:00Z');
    const overdue = sessionStartContext(payload, {
      ...none, annotation: () => ann({ dueAt: '2020-01-01T00:00:00Z' }), now,
    });
    expect(overdue).toContain('past its due date');
    const upcoming = sessionStartContext(payload, {
      ...none, annotation: () => ann({ dueAt: '2030-01-01T00:00:00Z' }), now,
    });
    expect(upcoming).toContain('Due 2030-01-01');
    expect(upcoming).not.toContain('past its due date');
  });
});
