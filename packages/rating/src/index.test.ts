import { describe, expect, it } from "vitest";
import {
  estimate,
  expectedScore,
  expectedSolved,
  icpcScore,
  ioiScore,
  problemCredit,
  solveCredit,
  solveProbability,
  totalCredit,
  type ProblemResult,
} from "./index";

const DIV2_RATINGS = [800, 1100, 1400, 1700, 2000];

function unsolved(rating: number): ProblemResult {
  return { rating, minute: null, wrongAttempts: 0, partial: 0 };
}

function solved(
  rating: number,
  minute: number,
  wrongAttempts = 0,
): ProblemResult {
  return { rating, minute, wrongAttempts, partial: 1 };
}

describe("solveProbability", () => {
  it("is 0.5 when rating equals difficulty", () => {
    expect(solveProbability(1500, 1500)).toBeCloseTo(0.5, 10);
  });
});

describe("expectedSolved", () => {
  it("is strictly increasing in R", () => {
    let prev = expectedSolved(0, DIV2_RATINGS);
    for (let r = 100; r <= 4000; r += 100) {
      const cur = expectedSolved(r, DIV2_RATINGS);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("solveCredit / problemCredit", () => {
  it("awards full credit for an instant clean AC", () => {
    expect(solveCredit(0, 0)).toBe(1);
    expect(problemCredit(solved(1400, 0))).toBe(1);
  });

  it("decays with time and wrongs but floors at 0.3", () => {
    expect(solveCredit(100, 0)).toBeCloseTo(0.6, 5);
    expect(solveCredit(0, 4)).toBeCloseTo(0.8, 5);
    expect(solveCredit(200, 10)).toBe(0.3);
  });

  it("returns IOI partial as-is when not fully solved", () => {
    expect(
      problemCredit({
        rating: 1400,
        minute: null,
        wrongAttempts: 2,
        partial: 0.4,
      }),
    ).toBeCloseTo(0.4, 10);
  });

  it("returns 0 for no progress", () => {
    expect(problemCredit(unsolved(1400))).toBe(0);
  });
});

describe("icpcScore", () => {
  it("sums minutes and 20·wrongs over full solves only", () => {
    const problems = [
      solved(800, 10, 1),
      solved(1100, 30, 0),
      {
        rating: 1400,
        minute: null,
        wrongAttempts: 5,
        partial: 0.5,
      },
      unsolved(1700),
    ];
    expect(icpcScore(problems)).toEqual({
      solved: 2,
      // (10 + 20·1) + (30 + 20·0) = 60
      penalty: 60,
    });
  });
});

describe("ioiScore", () => {
  it("awards 100 points per problem × partial", () => {
    const problems = [
      solved(800, 5),
      {
        rating: 1100,
        minute: null,
        wrongAttempts: 0,
        partial: 0.35,
      },
      unsolved(1400),
    ];
    expect(ioiScore(problems)).toEqual({ points: 135, maxPoints: 300 });
  });
});

describe("expectedScore", () => {
  it("is strictly increasing in R", () => {
    const problems = DIV2_RATINGS.map(unsolved);
    let prev = expectedScore(0, problems, 120);
    for (let r = 100; r <= 4000; r += 100) {
      const cur = expectedScore(r, problems, 120);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("estimate", () => {
  it("solving nothing yields a large negative delta", () => {
    const { perf, delta, score } = estimate({
      problems: DIV2_RATINGS.map(unsolved),
      durationMin: 120,
      rating: 1400,
    });
    expect(score).toBe(0);
    expect(perf).toBe(0);
    expect(delta).toBeLessThan(-300);
  });

  it("instant clean sweep yields a large positive delta", () => {
    const { perf, delta, score, maxScore } = estimate({
      problems: DIV2_RATINGS.map((r) => solved(r, 0)),
      durationMin: 120,
      rating: 1400,
    });
    expect(score).toBe(maxScore);
    expect(perf).toBe(4000);
    expect(delta).toBeGreaterThan(300);
  });

  it("rewards speed: same solves, earlier ACs → higher perf", () => {
    const ratings = [1100, 1300, 1700, 1900];
    const fast = estimate({
      problems: ratings.map((r) => solved(r, 5)),
      durationMin: 120,
      rating: 1500,
    });
    const slow = estimate({
      problems: ratings.map((r) => solved(r, 100)),
      durationMin: 120,
      rating: 1500,
    });
    expect(fast.score).toBeGreaterThan(slow.score);
    expect(fast.perf).toBeGreaterThan(slow.perf);
  });

  it("penalises wrong attempts", () => {
    const ratings = [1100, 1300, 1700, 1900];
    const clean = estimate({
      problems: ratings.map((r) => solved(r, 20, 0)),
      durationMin: 120,
      rating: 1500,
    });
    const messy = estimate({
      problems: ratings.map((r) => solved(r, 20, 4)),
      durationMin: 120,
      rating: 1500,
    });
    expect(clean.score).toBeGreaterThan(messy.score);
    expect(clean.perf).toBeGreaterThan(messy.perf);
  });

  it("counts IOI partials toward performance", () => {
    const none = estimate({
      problems: [unsolved(1500)],
      durationMin: 120,
      rating: 1500,
    });
    const partial = estimate({
      problems: [
        { rating: 1500, minute: null, wrongAttempts: 0, partial: 0.7 },
      ],
      durationMin: 120,
      rating: 1500,
    });
    expect(partial.score).toBeGreaterThan(none.score);
    expect(partial.perf).toBeGreaterThan(none.perf);
  });

  it("a mid-pack result near expectation lands near current rating", () => {
    // Two easy + two hard around 1500; solve the easy ones at a typical pace.
    const problems = [
      solved(1100, 25, 0),
      solved(1300, 40, 1),
      unsolved(1700),
      unsolved(1900),
    ];
    const { perf, delta } = estimate({
      problems,
      durationMin: 120,
      rating: 1500,
    });
    // Not exact (speed model shifts the target), but should be in-band.
    expect(perf).toBeGreaterThan(1000);
    expect(perf).toBeLessThan(2000);
    expect(Math.abs(delta)).toBeLessThan(300);
  });

  it("throws on an empty contest", () => {
    expect(() =>
      estimate({ problems: [], durationMin: 120, rating: 1500 }),
    ).toThrow();
  });

  it("totalCredit matches estimate.score", () => {
    const problems = [solved(800, 10, 1), unsolved(2000)];
    const { score } = estimate({
      problems,
      durationMin: 120,
      rating: 1200,
    });
    expect(score).toBeCloseTo(totalCredit(problems), 10);
  });
});
