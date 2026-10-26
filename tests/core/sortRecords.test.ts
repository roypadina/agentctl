import { describe, it, expect } from 'vitest';
import { sortRecords } from '../../src/core/sessionRepo.js';
import type { SessionRecord } from '../../src/core/types.js';

const rec = (id: string, o: Partial<SessionRecord>): SessionRecord => ({
  id, name: id, transcriptName: id, cwd: '/tmp', launchCwd: '/tmp', cwdDecodeConfident: true,
  jsonlPath: '/x.jsonl', sizeBytes: 0, startedAt: new Date(0), lastUpdatedAt: new Date(0),
  active: false, status: 'inactive', kind: 'interactive', ...o,
});
const ids = (rs: SessionRecord[]) => rs.map(r => r.id).join(',');

describe('sortRecords', () => {
  const rs = [
    rec('a', { name: 'zeta', lastUpdatedAt: new Date(1), workDir: '/h/ClaudWork/b-task', status: 'idle' }),
    rec('b', { name: 'Alpha', lastUpdatedAt: new Date(3), status: 'busy' }),
    rec('c', { name: 'mid', lastUpdatedAt: new Date(2), workDir: '/h/ClaudWork/a-task' }),
  ];
  it('used: newest first, reversed with desc', () => {
    expect(ids(sortRecords(rs, 'used'))).toBe('b,c,a');
    expect(ids(sortRecords(rs, 'used', true))).toBe('a,c,b');
  });
  it('name: case-insensitive A→Z', () => expect(ids(sortRecords(rs, 'name'))).toBe('b,c,a'));
  it('status: busy, idle, inactive', () => expect(ids(sortRecords(rs, 'status'))).toBe('b,a,c'));
  it('work: rows without a folder sink in both directions', () => {
    expect(ids(sortRecords(rs, 'work'))).toBe('c,a,b');
    expect(ids(sortRecords(rs, 'work', true))).toBe('a,c,b');
  });
});
