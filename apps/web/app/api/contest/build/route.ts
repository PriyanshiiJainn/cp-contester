import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCfClient, solvedKeys, CfApiError } from "@cp/cf";
import { getPrisma } from "@cp/db";

/**
 * Build a virtual contest for a handle: filter the cached problemset to the
 * chosen division, subtract everything the handle has already solved
 * (user.status is fetched server-side so the client can't be tricked), and
 * fill each slot with the unsolved problem nearest to the slot's target
 * rating (random among ties, so two rounds don't always look identical).
 */

export const dynamic = "force-dynamic";

const SLOT_TARGETS: Record<string, number[]> = {
  "4": [800, 900, 1000, 1100, 1300, 1500],
  "3": [800, 900, 1100, 1300, 1500, 1700, 1900],
  "2": [800, 1100, 1400, 1700, 2000, 2300],
  "1": [1500, 1800, 2100, 2400, 2700, 3000],
};

const BodySchema = z.object({
  handle: z.string().min(1).max(64),
  division: z.enum(["1", "2", "3", "4"]),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const { handle, division } = body;
  const targets = SLOT_TARGETS[division];

  // Server-side CF call (2 req max, well under the rate limit).
  const cf = createCfClient("https://codeforces.com/api");
  let solved: Set<string>;
  try {
    solved = solvedKeys(await cf.getUserStatus(handle));
  } catch (e) {
    const msg = e instanceof CfApiError ? e.message : "failed to fetch user status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const prisma = getPrisma();
  const pool = await prisma.problem.findMany({
    where: { division, rating: { not: null } },
    select: { id: true, contestId: true, index: true, name: true, rating: true },
  });

  if (pool.length === 0) {
    return NextResponse.json(
      { error: "problem cache is empty for this division — run /api/ingest first" },
      { status: 503 },
    );
  }

  const unsolved = pool.filter((p) => !solved.has(p.id));
  const used = new Set<string>();
  const slots = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    let best = Infinity;
    let candidates: typeof unsolved = [];
    for (const p of unsolved) {
      if (used.has(p.id)) continue;
      const diff = Math.abs((p.rating as number) - target);
      if (diff < best) {
        best = diff;
        candidates = [p];
      } else if (diff === best) {
        candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: `not enough unsolved Div. ${division} problems to fill slot ${i + 1}` },
        { status: 409 },
      );
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(pick.id);
    slots.push({
      label: String.fromCharCode(65 + i), // A, B, C, ...
      id: pick.id,
      contestId: pick.contestId,
      index: pick.index,
      name: pick.name,
      rating: pick.rating as number,
    });
  }

  return NextResponse.json({ slots });
}
