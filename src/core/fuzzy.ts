// fzf-v1-style fuzzy subsequence scorer. Pure core — reused by the New + Resume filters
// Returns matched positions so callers can highlight.
// No substring pre-filter anywhere: that would exclude exactly the gapped matches this exists to surface.

export interface FuzzyResult {
  score: number;
  positions: number[];
}

const BONUS_CONSECUTIVE = 8; // contiguous runs beat scattered boundary hits
const BONUS_BOUNDARY = 6; // match at a word boundary (start / after separator / camelCase)
const SEP = /[/\\_\-. ]/;

/**
 * Score `text` against `query` (case-insensitive subsequence). Higher = better.
 * Returns null if `query` is not a subsequence of `text`. Empty query → score 0, no positions.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const positions: number[] = [];
  let qi = 0;
  let score = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    if (prevMatch === ti - 1) bonus += BONUS_CONSECUTIVE;
    const prev = ti > 0 ? text[ti - 1] : '';
    if (ti === 0 || SEP.test(prev)) {
      bonus += BONUS_BOUNDARY;
    } else if (prev && prev === prev.toLowerCase() && text[ti] !== text[ti].toLowerCase()) {
      bonus += BONUS_BOUNDARY - 2; // camelCase boundary (lower→Upper)
    }
    score += bonus;
    positions.push(ti);
    prevMatch = ti;
    qi++;
  }

  if (qi < q.length) return null; // not all query chars consumed
  // Prefer earlier first match and tighter spans.
  const span = positions[positions.length - 1] - positions[0];
  score -= positions[0] * 0.5 + span * 0.2;
  // Relevance floor: a subsequence whose spread penalty outweighs its bonuses is noise, not a
  // match (e.g. "LanGuard" scattered across an unrelated session). Surfacing it makes a picker
  // resume the wrong row. Contiguous/boundary matches stay comfortably positive.
  if (score < 0) return null;
  return { score, positions };
}

/** Rank items by fuzzy score against `getText(item)`, dropping non-matches. Stable for empty query. */
export function fuzzyRank<T>(query: string, items: T[], getText: (item: T) => string): Array<{ item: T; result: FuzzyResult }> {
  if (!query) return items.map((item) => ({ item, result: { score: 0, positions: [] } }));
  const scored: Array<{ item: T; result: FuzzyResult; i: number }> = [];
  items.forEach((item, i) => {
    const result = fuzzyMatch(query, getText(item));
    if (result) scored.push({ item, result, i });
  });
  scored.sort((a, b) => (b.result.score - a.result.score) || (a.i - b.i)); // stable on ties
  return scored.map(({ item, result }) => ({ item, result }));
}
