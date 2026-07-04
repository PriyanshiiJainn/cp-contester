/**
 * Pure contest slot picker: for each target rating, pick an unused unsolved
 * problem nearest to the target (random among ties).
 */

export interface PoolProblem {
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number;
}

export interface ContestSlot extends PoolProblem {
  label: string;
}

export type PickSlotsResult =
  | { ok: true; slots: ContestSlot[] }
  | { ok: false; slotIndex: number };

export function pickSlots(
  pool: PoolProblem[],
  targets: number[],
  solved: Set<string>,
  random: () => number = Math.random,
): PickSlotsResult {
  const unsolved = pool.filter((p) => !solved.has(p.id));
  const used = new Set<string>();
  const slots: ContestSlot[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let best = Infinity;
    let candidates: PoolProblem[] = [];
    for (const p of unsolved) {
      if (used.has(p.id)) continue;
      const diff = Math.abs(p.rating - target);
      if (diff < best) {
        best = diff;
        candidates = [p];
      } else if (diff === best) {
        candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      return { ok: false, slotIndex: i };
    }
    const pick = candidates[Math.floor(random() * candidates.length)];
    used.add(pick.id);
    slots.push({
      label: String.fromCharCode(65 + i),
      id: pick.id,
      contestId: pick.contestId,
      index: pick.index,
      name: pick.name,
      rating: pick.rating,
    });
  }

  return { ok: true, slots };
}
