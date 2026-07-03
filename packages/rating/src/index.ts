/**
 * Pure performance / rating-delta estimator. No I/O.
 *
 * Model: the probability that a user of rating R solves a problem of
 * difficulty d follows the Elo win expectancy
 *
 *   P(solve) = 1 / (1 + 10^((d - R) / 400))
 *
 * expectedSolved(R) = sum of P over the contest's slot difficulties.
 * "Performance" is the R at which expectedSolved(R) equals the number of
 * problems the user actually solved (found by binary search — the sum is
 * strictly increasing in R). The rating delta is half the gap between
 * performance and current rating, mimicking the shape (not the exactness)
 * of CF's rating update.
 */

export interface EstimateInput {
  /** Difficulty rating of each contest slot (e.g. [800, 1100, 1400, ...]). */
  slotRatings: number[];
  /** How many of those the user solved during the round. */
  solvedCount: number;
  /** The user's current CF rating. */
  rating: number;
}

export interface EstimateResult {
  /** Estimated performance rating in [0, 4000]. */
  perf: number;
  /** Estimated rating change, round((perf - rating) / 2). */
  delta: number;
}

const R_MIN = 0;
const R_MAX = 4000;

/** Expected number of solved problems for a user of rating R. */
export function expectedSolved(R: number, slotRatings: number[]): number {
  return slotRatings.reduce(
    (sum, d) => sum + 1 / (1 + Math.pow(10, (d - R) / 400)),
    0,
  );
}

export function estimate({
  slotRatings,
  solvedCount,
  rating,
}: EstimateInput): EstimateResult {
  if (slotRatings.length === 0) {
    throw new Error("slotRatings must not be empty");
  }
  const target = Math.max(0, Math.min(solvedCount, slotRatings.length));

  // expectedSolved is strictly increasing in R, so binary-search the R whose
  // expectation matches the actual solve count. Targets outside the reachable
  // range (0 solved, or all solved) clamp to the search bounds — which is the
  // behaviour we want: extreme results give extreme performances.
  let lo = R_MIN;
  let hi = R_MAX;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (expectedSolved(mid, slotRatings) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const perf = Math.round((lo + hi) / 2);
  const delta = Math.round((perf - rating) / 2);
  return { perf, delta };
}
