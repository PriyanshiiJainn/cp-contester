import { describe, expect, it } from "vitest";
import { estimate, expectedSolved } from "./index";

const DIV2 = [800, 1100, 1400, 1700, 2000, 2300];

describe("expectedSolved", () => {
  it("is strictly increasing in R", () => {
    let prev = expectedSolved(0, DIV2);
    for (let r = 100; r <= 4000; r += 100) {
      const cur = expectedSolved(r, DIV2);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("gives probability 0.5 for a problem at exactly the user's rating", () => {
    expect(expectedSolved(1500, [1500])).toBeCloseTo(0.5, 10);
  });
});

describe("estimate", () => {
  it("solving nothing yields a large negative delta", () => {
    const { perf, delta } = estimate({
      slotRatings: DIV2,
      solvedCount: 0,
      rating: 1400,
    });
    expect(perf).toBe(0); // clamped to the bottom of the search range
    expect(delta).toBeLessThan(-300);
  });

  it("solving everything yields a large positive delta", () => {
    const { perf, delta } = estimate({
      slotRatings: DIV2,
      solvedCount: DIV2.length,
      rating: 1400,
    });
    expect(perf).toBe(4000); // clamped to the top of the search range
    expect(delta).toBeGreaterThan(300);
  });

  it("solving exactly the expected middle gives a delta near zero", () => {
    // Slots symmetric around 1500: P(1500-x) + P(1500+x) = 1, so
    // expectedSolved(1500) is exactly 2 out of 4. A 1500-rated user solving
    // exactly 2 should therefore land at perf ~= 1500 and delta ~= 0.
    const symmetric = [1100, 1300, 1700, 1900];
    const { perf, delta } = estimate({
      slotRatings: symmetric,
      solvedCount: 2,
      rating: 1500,
    });
    expect(Math.abs(perf - 1500)).toBeLessThanOrEqual(1);
    expect(Math.abs(delta)).toBeLessThanOrEqual(1);
  });

  it("clamps out-of-range solvedCount instead of diverging", () => {
    const over = estimate({ slotRatings: DIV2, solvedCount: 99, rating: 2000 });
    expect(over.perf).toBe(4000);
    const under = estimate({ slotRatings: DIV2, solvedCount: -5, rating: 2000 });
    expect(under.perf).toBe(0);
  });

  it("throws on an empty contest", () => {
    expect(() =>
      estimate({ slotRatings: [], solvedCount: 0, rating: 1500 }),
    ).toThrow();
  });
});
