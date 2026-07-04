import { NextResponse } from "next/server";
import { getPrisma } from "@cp/db";

/**
 * Public readiness probe: DB connectivity, problem-cache size, last ingest.
 * Returns 503 when the cache is empty or the DB is unreachable.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prisma = getPrisma();
    const [problems, byDivisionRows, meta] = await Promise.all([
      prisma.problem.count(),
      prisma.problem.groupBy({
        by: ["division"],
        where: { division: { not: null }, rating: { not: null } },
        _count: { _all: true },
      }),
      prisma.ingestMeta.findUnique({ where: { id: 1 } }),
    ]);

    const byDivision: Record<string, number> = {};
    for (const row of byDivisionRows) {
      if (row.division) byDivision[row.division] = row._count._all;
    }

    const ready = problems > 0;
    return NextResponse.json(
      {
        ok: ready,
        db: true,
        problems,
        byDivision,
        lastIngestAt: meta?.lastOkAt?.toISOString() ?? null,
        lastIngestError: meta?.lastError ?? null,
        lastIngestErrorAt: meta?.lastErrorAt?.toISOString() ?? null,
      },
      { status: ready ? 200 : 503 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "database unreachable";
    return NextResponse.json(
      {
        ok: false,
        db: false,
        problems: 0,
        byDivision: {},
        lastIngestAt: null,
        lastIngestError: message,
        lastIngestErrorAt: null,
        error: message,
      },
      { status: 503 },
    );
  }
}
