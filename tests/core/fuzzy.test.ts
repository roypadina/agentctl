import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyRank } from '../../src/core/fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches a gapped subsequence and returns positions', () => {
    const r = fuzzyMatch('wap', 'web-app');
    expect(r).not.toBeNull();
    expect(r!.positions.map((p) => 'web-app'[p]).join('')).toBe('wap');
  });

  it('returns null when not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'web-app')).toBeNull();
    expect(fuzzyMatch('appx', 'app')).toBeNull();
  });

  it('empty query scores 0 with no positions', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('API', 'my-api-service')).not.toBeNull();
  });

  it('scores word-boundary + consecutive matches higher than scattered', () => {
    const boundary = fuzzyMatch('api', 'be-api')!;        // 'api' contiguous at a boundary
    const scattered = fuzzyMatch('api', 'aaa-p-iii')!;     // a..p..i scattered
    expect(boundary.score).toBeGreaterThan(scattered.score);
  });

  it('prefers an earlier match', () => {
    const early = fuzzyMatch('app', 'app-web')!;
    const late = fuzzyMatch('app', 'web-app')!;
    expect(early.score).toBeGreaterThan(late.score);
  });
});

describe('fuzzyRank', () => {
  it('ranks closer matches first and drops non-matches', () => {
    const items = ['design-system', 'web-app', 'api', 'auth-service'];
    const ranked = fuzzyRank('ap', items, (s) => s).map((r) => r.item);
    expect(ranked).toContain('web-app');
    expect(ranked).toContain('api');
    expect(ranked).not.toContain('design-system'); // no subsequence 'ap'... actually 'design-system' has no a..p
  });

  it('empty query keeps original order', () => {
    const items = ['b', 'a', 'c'];
    expect(fuzzyRank('', items, (s) => s).map((r) => r.item)).toEqual(['b', 'a', 'c']);
  });
});

// Regression: the Resume picker resumed the WRONG session. Searching "LanGuard" surfaced an
// unrelated session as a scattered gapped subsequence (negative score) — so the only result on
// screen was the wrong one, while the intended session (named "LanGurd") didn't match at all.
// A subsequence whose spread penalty exceeds its bonuses is noise, not a match.
describe('fuzzyMatch — relevance floor', () => {
  const unrelated =
    'Create example-create-plugin wrapper with naming and deduplication  ~/Code/Work/Example-Plugins';

  it('rejects a scattered subsequence that scores below neutral', () => {
    // "LanGuard" letters appear scattered across `unrelated` (pre-fix score ≈ -2.9).
    expect(fuzzyMatch('LanGuard', unrelated)).toBeNull();
  });

  it('keeps legitimate gapped / acronym matches (positive score)', () => {
    expect(fuzzyMatch('agentctl', 'Agentctl')).not.toBeNull(); // acronym ≈ 15.4
    expect(fuzzyMatch('wap', 'web-app')).not.toBeNull(); // ≈ 22
    expect(fuzzyMatch('api', 'aaa-p-iii')).not.toBeNull(); // scattered but positive ≈ 19.8
  });

  it('never returns a negative score', () => {
    const m = fuzzyMatch('api', 'aaa-p-iii');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(0);
  });
});

describe('fuzzyRank — never surfaces an unrelated session as the only match', () => {
  const sessions = [
    { name: 'LanGurd', text: 'LanGurd  ~/Code  2cb6745a-6bda-4e44-9d98-9b3da5fb1f30' },
    {
      name: 'example',
      text: 'Create example-create-plugin wrapper with naming and deduplication  ~/Code/Work/Example-Plugins',
    },
  ];

  it('returns no matches when only a garbage scattered subsequence exists', () => {
    // "LanGuard" (with the 2nd "a") matches neither session meaningfully → empty list,
    // NOT the unrelated example session (which clicking would have resumed).
    expect(fuzzyRank('LanGuard', sessions, (s) => s.text).map((r) => r.item.name)).toEqual([]);
  });

  it('still finds the intended session for the correctly-spelled query', () => {
    expect(fuzzyRank('LanGurd', sessions, (s) => s.text).map((r) => r.item.name)[0]).toBe('LanGurd');
  });
});
