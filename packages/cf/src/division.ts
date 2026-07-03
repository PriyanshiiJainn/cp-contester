/**
 * Extract the division ("1".."4") from a Codeforces contest title.
 *
 * Matches "Div. N" anywhere in the name, so it covers:
 *   "Codeforces Round 950 (Div. 3)"            -> "3"
 *   "Educational Codeforces Round (Rated for Div. 2)" -> "2"
 *   "Codeforces Round 900 (Div. 1 + Div. 2)"   -> "1" (first match wins; v1
 *     files combined rounds under the harder division)
 * Returns null when no division is present (Global Rounds, April Fools, ...).
 */
export function divisionOf(contestName: string): string | null {
  const m = contestName.match(/Div\.\s?([1-4])/);
  return m ? m[1] : null;
}
