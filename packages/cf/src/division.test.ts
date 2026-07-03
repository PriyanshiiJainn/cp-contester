import { describe, expect, it } from "vitest";
import { divisionOf } from "./division";
import { solvedKeys } from "./client";
import type { CfSubmission } from "./schemas";

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
  const sub = (over: Partial<CfSubmission>): CfSubmission => ({
    id: 1,
    contestId: 1352,
    creationTimeSeconds: 0,
    problem: { contestId: 1352, index: "A", name: "x", tags: [] },
    verdict: "OK",
    ...over,
  });

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
