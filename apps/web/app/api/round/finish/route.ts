import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";

/** Persist a finished virtual round. */

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  handle: z.string().min(1).max(64),
  division: z.enum(["1", "2", "3", "4"]),
  durationMin: z.number().int().min(1).max(600),
  startedAt: z.number(), // epoch ms
  endedAt: z.number(), // epoch ms
  problemIds: z.array(z.string()).min(1),
  solvedIds: z.array(z.string()),
  perf: z.number().int(),
  delta: z.number().int(),
  ratingBefore: z.number().int().nullable(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const prisma = getPrisma();
  const round = await prisma.virtualRound.create({
    data: {
      handle: body.handle,
      division: body.division,
      durationMin: body.durationMin,
      startedAt: new Date(body.startedAt),
      endedAt: new Date(body.endedAt),
      problemIds: body.problemIds,
      solvedIds: body.solvedIds,
      perf: body.perf,
      delta: body.delta,
      ratingBefore: body.ratingBefore,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: round.id });
}
