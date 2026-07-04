import { describe, expect, it } from "vitest";
import { pickSlots, type PoolProblem } from "./contest-slots";

const pool: PoolProblem[] = [
  { id: "1A", contestId: 1, index: "A", name: "A", rating: 800 },
  { id: "1B", contestId: 1, index: "B", name: "B", rating: 1200 },
  { id: "1C", contestId: 1, index: "C", name: "C", rating: 1600 },
  { id: "2A", contestId: 2, index: "A", name: "A2", rating: 800 },
];

describe("pickSlots", () => {
  it("picks nearest unused problems for each target", () => {
    const result = pickSlots(pool, [800, 1200, 1600], new Set(), () => 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.map((s) => s.id)).toEqual(["1A", "1B", "1C"]);
    expect(result.slots.map((s) => s.label)).toEqual(["A", "B", "C"]);
  });

  it("skips already-solved problems", () => {
    const result = pickSlots(pool, [800], new Set(["1A"]), () => 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots[0].id).toBe("2A");
  });

  it("fails when the pool is exhausted", () => {
    const result = pickSlots(pool, [800, 900, 1000, 1100, 1200], new Set(pool.map((p) => p.id)));
    expect(result).toEqual({ ok: false, slotIndex: 0 });
  });

  it("breaks ties with the provided random source", () => {
    const ties: PoolProblem[] = [
      { id: "x", contestId: 1, index: "A", name: "X", rating: 1000 },
      { id: "y", contestId: 2, index: "A", name: "Y", rating: 1000 },
    ];
    const first = pickSlots(ties, [1000], new Set(), () => 0);
    const second = pickSlots(ties, [1000], new Set(), () => 0.99);
    expect(first.ok && first.slots[0].id).toBe("x");
    expect(second.ok && second.slots[0].id).toBe("y");
  });
});
