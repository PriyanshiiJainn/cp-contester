import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";
import { getSessionUser } from "@/lib/auth";

/**
 * Persist a finished virtual round. Solves and ICPC penalty are always
 * derived from outcomes on the server so a later retry never trusts a stale
 * client score.
 */

export const dynamic = "force-dynamic";

const ICPC_WRONG_PENALTY = 20;

const OutcomeSchema = z.object({
  id: z.string().min(1),
  minute: z.number().int().min(0).nullable(),
  wrongAttempts: z.number().int().min(0).max(100).default(0),
});

const BodySchema = z.object({
  handle: z.string().min(1).max(64),
  division: z.enum(["1", "2", "3", "4"]),
  durationMin: z.number().int().min(1).max(600),
  startedAt: z.number(),
  endedAt: z.number(),
  problemIds: z.array(z.string()).min(1).max(20),
  outcomes: z.array(OutcomeSchema),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  if (body.endedAt < body.startedAt) {
    return NextResponse.json({ error: "endedAt must be >= startedAt" }, { status: 400 });
  }

  const outcomeById = new Map(body.outcomes.map((o) => [o.id, o]));
  const problemSet = new Set(body.problemIds);
  const solvedIds: string[] = [];
  const solveMinutes: Record<string, number> = {};
  let penalty = 0;

  // Recompute on every request (including retries) — never trust client totals.
  for (const id of body.problemIds) {
    const o = outcomeById.get(id);
    if (o?.minute == null) continue;
    if (!problemSet.has(id)) continue;
    solvedIds.push(id);
    solveMinutes[id] = o.minute;
    penalty += o.minute + ICPC_WRONG_PENALTY * Math.max(0, o.wrongAttempts);
  }

  const session = await getSessionUser().catch(() => null);
  const userId =
    session && session.handle.toLowerCase() === body.handle.toLowerCase()
      ? session.id
      : null;

  try {
    const prisma = getPrisma();
    const round = await prisma.virtualRound.create({
      data: {
        handle: body.handle,
        userId,
        division: body.division,
        durationMin: body.durationMin,
        startedAt: new Date(body.startedAt),
        endedAt: new Date(body.endedAt),
        problemIds: body.problemIds,
        solvedIds,
        solveMinutes,
        penalty,
      },
      select: { id: true },
    });
    return NextResponse.json({
      id: round.id,
      solvedCount: solvedIds.length,
      penalty,
      solveMinutes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "database write failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
