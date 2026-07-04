import { describe, expect, it } from "vitest";
import { divisionOf } from "./division";
import { roundProgress, solvedKeys } from "./client";
import type { CfSubmission } from "./schemas";

const sub = (over: Partial<CfSubmission>): CfSubmission => ({
  id: 1,
  contestId: 1352,
  creationTimeSeconds: 0,
  problem: { contestId: 1352, index: "A", name: "x", tags: [] },
  verdict: "OK",
  ...over,
});

describe("divisionOf", () => {
  it("extracts plain divisions", () => {
    expect(divisionOf("Codeforces Round 950 (Div. 3)")).toBe("3");
    expect(divisionOf("Codeforces Round 949 (Div. 2)")).toBe("2");
    expect(divisionOf("Codeforces Round 948 (Div. 4)")).toBe("4");
    expect(divisionOf("Codeforces Round #100 (Div. 1)")).toBe("1");
  });

  it("handles educational rounds (Rated for Div. 2)", () => {
    expect(
      divisionOf("Educational Codeforces Round 170 (Rated for Div. 2)"),
    ).toBe("2");
  });

  it("takes the first division of combined rounds", () => {
    expect(divisionOf("Codeforces Round 900 (Div. 1 + Div. 2)")).toBe("1");
  });

  it("returns null when there is no division", () => {
    expect(divisionOf("Codeforces Global Round 27")).toBeNull();
    expect(divisionOf("April Fools Day Contest 2024")).toBeNull();
  });
});

describe("solvedKeys", () => {
  it("keeps only OK verdicts, keyed contestId+index", () => {
    const keys = solvedKeys([
      sub({}),
      sub({ id: 2, verdict: "WRONG_ANSWER" }),
      sub({ id: 3, problem: { contestId: 1352, index: "B", name: "y", tags: [] } }),
    ]);
    expect(keys).toEqual(new Set(["1352A", "1352B"]));
  });

  it("skips submissions with no contestId anywhere", () => {
    const keys = solvedKeys([
      sub({ contestId: undefined, problem: { index: "A", name: "x", tags: [] } }),
    ]);
    expect(keys.size).toBe(0);
  });
});

describe("roundProgress", () => {
  const startedAt = 1_000_000_000_000; // ms
  const endedAt = startedAt + 120 * 60_000;
  const slotIds = new Set(["1352A", "1352B"]);

  const timed = (
    offsetMin: number,
    over: Partial<CfSubmission> & { verdict?: string },
  ): CfSubmission =>
    sub({
      creationTimeSeconds: Math.floor(startedAt / 1000) + offsetMin * 60,
      ...over,
    });

  it("records minute, pre-AC wrongs, and ignores CE", () => {
    const progress = roundProgress(
      [
        timed(5, { id: 1, verdict: "WRONG_ANSWER" }),
        timed(6, { id: 2, verdict: "COMPILATION_ERROR" }),
        timed(10, { id: 3, verdict: "TIME_LIMIT_EXCEEDED" }),
        timed(15, { id: 4, verdict: "OK" }),
        timed(20, { id: 5, verdict: "WRONG_ANSWER" }), // post-AC
      ],
      { startedAt, endedAt, slotIds },
    );
    expect(progress.get("1352A")).toEqual({
      minute: 15,
      wrongAttempts: 2,
      partial: 1,
    });
  });

  it("tracks IOI partials from points without OK", () => {
    const progress = roundProgress(
      [
        timed(8, {
          id: 1,
          verdict: "PARTIAL",
          points: 40,
          problem: { contestId: 1352, index: "B", name: "y", tags: [] },
        }),
        timed(12, {
          id: 2,
          verdict: "PARTIAL",
          points: 70,
          problem: { contestId: 1352, index: "B", name: "y", tags: [] },
        }),
      ],
      { startedAt, endedAt, slotIds },
    );
    expect(progress.get("1352B")).toEqual({
      minute: null,
      wrongAttempts: 0,
      partial: 0.7,
    });
  });

  it("ignores submissions outside the window or slot set", () => {
    const progress = roundProgress(
      [
        timed(-1, { id: 1, verdict: "OK" }),
        timed(10, {
          id: 2,
          verdict: "OK",
          problem: { contestId: 99, index: "A", name: "z", tags: [] },
          contestId: 99,
        }),
      ],
      { startedAt, endedAt, slotIds },
    );
    expect(progress.size).toBe(0);
  });
});
