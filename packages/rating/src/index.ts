/**
 * Pure performance / rating-delta estimator and contest score helpers. No I/O.
 *
 * Performance model
 * -----------------
 * Each problem contributes a fractional *credit* in [0, 1] (IOI partials scale
 * it). Full solves use a Codeforces-style time/wrong decay:
 *
 *   credit = partial · max(0.3, 1 − 0.004·minute − 0.05·wrongs)
 *
 * "Performance" is the rating R at which a typical contestant would earn the
 * same total credit on this set (binary search). Expected credit for rating R
 * on a problem of difficulty d is
 *
 *   P(solve) · credit(E[minute|R,d], E[wrongs|R,d])
 *
 * with Elo P(solve) = 1 / (1 + 10^((d−R)/400)). That is the field-strength
 * prior: we compare you to a synthetic field of rating-R contestants, not to
 * a live scoreboard.
 *
 * ICPC / IOI
 * ----------
 * `icpcScore` — classic (solved count, penalty = Σ(minute + 20·wrongs)).
 * `ioiScore`  — Σ partial · 100 (one problem = 100 points).
 */

/** Per-problem outcome fed into scoring / estimation. */
export interface ProblemResult {
  /** Problem difficulty rating (e.g. 1400). */
  rating: number;
  /**
   * Minutes from contest start to full AC, or `null` if not fully solved.
   * Ignored when `partial < 1` (IOI partial without a full solve).
   */
  minute: number | null;
  /** Unsuccessful submissions before AC (CE excluded by the caller). */
  wrongAttempts: number;
  /**
   * IOI-style fraction in [0, 1]. Full AC ⇒ 1; unsolved ⇒ 0;
   * partial credit ⇒ (0, 1).
   */
  partial: number;
}

export interface EstimateInput {
  /** One entry per contest slot, in slot order. */
  problems: ProblemResult[];
  /** Contest length in minutes (used for expected-time prior). */
  durationMin: number;
  /** The user's current CF rating. */
  rating: number;
}

export interface EstimateResult {
  /** Estimated performance rating in [0, 4000]. */
  perf: number;
  /** Estimated rating change, round((perf - rating) / 2). */
  delta: number;
  /** Sum of per-problem credits actually earned. */
  score: number;
  /** Max possible credit (= number of problems). */
  maxScore: number;
}

export interface IcpcScore {
  /** Number of fully solved problems (partial === 1 and minute != null). */
  solved: number;
  /** Σ (minute + 20 · wrongAttempts) over fully solved problems. */
  penalty: number;
}

export interface IoiScore {
  /** Σ partial · 100. */
  points: number;
  /** 100 · problem count. */
  maxPoints: number;
}

const R_MIN = 0;
const R_MAX = 4000;

/** CF-style floor: a late AC still earns 30% of the problem. */
const MIN_SOLVE_CREDIT = 0.3;
/** CF decreasing-points coefficient (per minute). */
const TIME_DECAY = 0.004;
/** Wrong-attempt debit as a fraction of full credit (≈ 50/1000 on CF). */
const WRONG_DEBIT = 0.05;
/** Classic ICPC penalty minutes per wrong submission. */
export const ICPC_WRONG_PENALTY = 20;
/** Points per problem under IOI scoring. */
export const IOI_POINTS_PER_PROBLEM = 100;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Elo win expectancy: P(rating R solves difficulty d). */
export function solveProbability(R: number, d: number): number {
  return 1 / (1 + Math.pow(10, (d - R) / 400));
}

/**
 * Credit earned for a full solve at `minute` with `wrongAttempts` prior fails.
 * Matches the shape of CF's points formula (time decay + wrong debit, 30% floor).
 */
export function solveCredit(minute: number, wrongAttempts: number): number {
  const m = Math.max(0, minute);
  const w = Math.max(0, wrongAttempts);
  return Math.max(MIN_SOLVE_CREDIT, 1 - TIME_DECAY * m - WRONG_DEBIT * w);
}

/** Fractional credit in [0, 1] for one problem outcome. */
export function problemCredit(p: ProblemResult): number {
  const partial = clamp(p.partial, 0, 1);
  if (partial <= 0) return 0;
  // Full solve: apply CF time/wrong decay, then scale by partial (normally 1).
  if (p.minute != null && partial >= 1) {
    return solveCredit(p.minute, p.wrongAttempts) * partial;
  }
  // IOI partial without a full AC — score is the partial itself (no time term).
  return partial;
}

/** Total credit across the contest (estimate's observed score). */
export function totalCredit(problems: ProblemResult[]): number {
  return problems.reduce((sum, p) => sum + problemCredit(p), 0);
}

/**
 * Expected minute-of-solve for a rating-R contestant on difficulty d.
 * Stronger contestants finish earlier; weaker ones cluster near the end.
 */
function expectedMinute(R: number, d: number, durationMin: number): number {
  const D = Math.max(1, durationMin);
  // Maps gap → (0, 1); positive gap (harder than R) → later solve.
  const late = 1 / (1 + Math.pow(10, (R - d) / 400));
  return clamp(D * (0.2 + 0.7 * late), 0, D);
}

/** Expected pre-AC wrongs: more when the problem is above the contestant's level. */
function expectedWrongs(R: number, d: number): number {
  const P = solveProbability(R, d);
  return 3 * (1 - P);
}

/**
 * Expected credit a rating-R contestant earns on one problem.
 * Field-strength prior: only full-solve path (partials are user-specific).
 */
export function expectedProblemCredit(
  R: number,
  d: number,
  durationMin: number,
): number {
  const P = solveProbability(R, d);
  const credit = solveCredit(
    expectedMinute(R, d, durationMin),
    expectedWrongs(R, d),
  );
  return P * credit;
}

/** Expected total credit for rating R on the whole set. */
export function expectedScore(
  R: number,
  problems: ProblemResult[],
  durationMin: number,
): number {
  return problems.reduce(
    (sum, p) => sum + expectedProblemCredit(R, p.rating, durationMin),
    0,
  );
}

/** @deprecated Prefer expectedScore; kept for callers that only have difficulties. */
export function expectedSolved(R: number, slotRatings: number[]): number {
  return slotRatings.reduce((sum, d) => sum + solveProbability(R, d), 0);
}

/** Classic ICPC standings line. */
export function icpcScore(problems: ProblemResult[]): IcpcScore {
  let solved = 0;
  let penalty = 0;
  for (const p of problems) {
    if (p.minute == null || p.partial < 1) continue;
    solved += 1;
    penalty += p.minute + ICPC_WRONG_PENALTY * Math.max(0, p.wrongAttempts);
  }
  return { solved, penalty };
}

/** Classic IOI total (100 points per problem × partial). */
export function ioiScore(problems: ProblemResult[]): IoiScore {
  const maxPoints = problems.length * IOI_POINTS_PER_PROBLEM;
  const points = problems.reduce(
    (sum, p) => sum + clamp(p.partial, 0, 1) * IOI_POINTS_PER_PROBLEM,
    0,
  );
  return { points, maxPoints };
}

export function estimate({
  problems,
  durationMin,
  rating,
}: EstimateInput): EstimateResult {
  if (problems.length === 0) {
    throw new Error("problems must not be empty");
  }
  const D = Math.max(1, durationMin);
  const score = totalCredit(problems);
  const maxScore = problems.length;
  // Credits live in [0, maxScore]; clamp so binary search stays well-defined.
  const target = clamp(score, 0, maxScore);

  // expectedScore is strictly increasing in R, so binary-search the R whose
  // expectation matches the actual credit total.
  let lo = R_MIN;
  let hi = R_MAX;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (expectedScore(mid, problems, D) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const perf = Math.round((lo + hi) / 2);
  const delta = Math.round((perf - rating) / 2);
  return { perf, delta, score, maxScore };
}
