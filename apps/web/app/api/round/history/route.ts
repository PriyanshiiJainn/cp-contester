import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@cp/db";
import { createCfClient, solvedKeys } from "@cp/cf";

/** Finished virtual rounds for a CF handle, with problem details for profile. */

export const dynamic = "force-dynamic";

function parseProblemId(id: string): { contestId: number; index: string } | null {
  const m = /^(\d+)(.+)$/.exec(id);
  if (!m) return null;
  return { contestId: Number(m[1]), index: m[2] };
}

function asSolveMinutes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle")?.trim();
  if (!handle || handle.length > 64) {
    return NextResponse.json({ error: "handle is required" }, { status: 400 });
  }

  try {
    const prisma = getPrisma();
    const rounds = await prisma.virtualRound.findMany({
      where: {
        handle: { equals: handle, mode: "insensitive" },
        endedAt: { not: null },
      },
      orderBy: { endedAt: "desc" },
      take: 50,
    });

    const allIds = [...new Set(rounds.flatMap((r) => r.problemIds))];
    const problems = allIds.length
      ? await prisma.problem.findMany({
          where: { id: { in: allIds } },
          select: { id: true, contestId: true, index: true, name: true, rating: true },
        })
      : [];
    const byId = new Map(problems.map((p) => [p.id, p]));

    const items = rounds.map((r) => {
      const solvedSet = new Set(r.solvedIds);
      const minutes = asSolveMinutes(r.solveMinutes);
      return {
        id: r.id,
        division: r.division,
        durationMin: r.durationMin,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt!.toISOString(),
        penalty: r.penalty,
        problems: r.problemIds.map((pid) => {
          const cached = byId.get(pid);
          const parsed = cached ?? parseProblemId(pid);
          return {
            id: pid,
            contestId: cached?.contestId ?? parsed?.contestId ?? 0,
            index: cached?.index ?? parsed?.index ?? pid,
            name: cached?.name ?? pid,
            rating: cached?.rating ?? null,
            solved: solvedSet.has(pid),
            minute: minutes[pid] ?? null,
          };
        }),
      };
    });

    const contestsGiven = items.length;
    const problemsSolved = new Set(rounds.flatMap((r) => r.solvedIds)).size;

    let displayHandle = handle;
    let cfRating: number | null = null;
    let cfSolvedTotal: number | null = null;
    try {
      const cf = createCfClient("https://codeforces.com/api");
      const [info, subs] = await Promise.all([
        cf.getUserInfo(handle),
        cf.getUserStatus(handle),
      ]);
      displayHandle = info.handle;
      cfRating = info.rating ?? null;
      cfSolvedTotal = solvedKeys(subs).size;
    } catch {
      /* CF is optional for profile history */
    }

    return NextResponse.json({
      handle: displayHandle,
      contestsGiven,
      problemsSolved,
      cfRating,
      cfSolvedTotal,
      rounds: items,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "database read failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
