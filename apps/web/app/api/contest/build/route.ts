import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCfClient, solvedKeys, CfApiError } from "@cp/cf";
import { getPrisma } from "@cp/db";
import { throttleCf } from "@/lib/cf-throttle";
import { pickSlots } from "@/lib/contest-slots";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Build a virtual contest for a handle: filter the cached problemset to the
 * chosen division, subtract everything the handle has already solved
 * (user.status is fetched server-side so the client can't be tricked), and
 * fill each slot with the unsolved problem nearest to the slot's target
 * rating (random among ties, so two rounds don't always look identical).
 */

export const dynamic = "force-dynamic";

/** Five slots A–E; targets are typical CF difficulties for that division. */
const SLOT_TARGETS: Record<string, number[]> = {
  "4": [800, 900, 1000, 1200, 1400],
  "3": [800, 1000, 1200, 1500, 1800],
  "2": [800, 1200, 1600, 2000, 2400],
  "1": [1500, 1900, 2300, 2700, 3100],
};

const BodySchema = z.object({
  handle: z.string().min(1).max(64),
  division: z.enum(["1", "2", "3", "4"]),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(`contest-build:${ip}`, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json(
      { error: "too many contest builds — try again in a minute" },
      { status: 429 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const { handle, division } = body;
  const targets = SLOT_TARGETS[division];

  const cf = createCfClient("https://codeforces.com/api");
  let solved: Set<string>;
  try {
    await throttleCf();
    solved = solvedKeys(await cf.getUserStatus(handle));
  } catch (e) {
    const msg = e instanceof CfApiError ? e.message : "failed to fetch user status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const prisma = getPrisma();
  const [pool, totalProblems, meta] = await Promise.all([
    prisma.problem.findMany({
      where: { division, rating: { not: null } },
      select: { id: true, contestId: true, index: true, name: true, rating: true },
    }),
    prisma.problem.count(),
    prisma.ingestMeta.findUnique({ where: { id: 1 } }),
  ]);

  if (pool.length === 0) {
    const lastAt = meta?.lastOkAt?.toISOString() ?? null;
    const hint =
      totalProblems === 0
        ? "problem cache is empty — an operator must run POST /api/ingest with CRON_SECRET (see GET /api/health)"
        : `no rated Div. ${division} problems in the cache — run /api/ingest to refresh (see GET /api/health)`;
    return NextResponse.json(
      {
        error: hint,
        problems: totalProblems,
        lastIngestAt: lastAt,
      },
      { status: 503 },
    );
  }

  const typedPool = pool.map((p) => ({
    id: p.id,
    contestId: p.contestId,
    index: p.index,
    name: p.name,
    rating: p.rating as number,
  }));

  const picked = pickSlots(typedPool, targets, solved);
  if (!picked.ok) {
    return NextResponse.json(
      {
        error: `not enough unsolved Div. ${division} problems to fill slot ${picked.slotIndex + 1}`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ slots: picked.slots });
}
