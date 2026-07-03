import { NextRequest, NextResponse } from "next/server";
import { createCfClient, divisionOf, problemKey } from "@cp/cf";
import { getPrisma } from "@cp/db";

/**
 * Daily ingest: pull the whole CF problemset (one call) + contest list,
 * stamp each problem's division from its contest title, and rebuild the
 * Problem cache table. Guarded by CRON_SECRET — Vercel Cron sends it as
 * "Authorization: Bearer <CRON_SECRET>"; manual runs may also use the
 * "x-ingest-secret" header.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.headers.get("x-ingest-secret") === secret
  );
}

async function ingest(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const cf = createCfClient("https://codeforces.com/api");

  // Two calls total — this is the entire "extraction".
  const contests = await cf.getContestList();
  const problemset = await cf.getProblemset();

  const divisionByContest = new Map<number, string | null>(
    contests.map((c) => [c.id, divisionOf(c.name)]),
  );

  const seen = new Set<string>();
  const rows = [];
  for (const p of problemset.problems) {
    if (p.contestId === undefined) continue;
    const id = problemKey(p.contestId, p.index);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating ?? null,
      tags: p.tags,
      division: divisionByContest.get(p.contestId) ?? null,
    });
  }

  // The table is a pure cache of public data: wipe & refill atomically.
  const prisma = getPrisma();
  const CHUNK = 1000;
  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    chunks.push(rows.slice(i, i + CHUNK));
  }
  await prisma.$transaction([
    prisma.problem.deleteMany({}),
    ...chunks.map((chunk) =>
      prisma.problem.createMany({ data: chunk, skipDuplicates: true }),
    ),
  ]);

  const withDivision = rows.filter((r) => r.division !== null).length;
  return NextResponse.json({
    ok: true,
    problems: rows.length,
    withDivision,
    contests: contests.length,
  });
}

export async function GET(req: NextRequest) {
  return ingest(req);
}

export async function POST(req: NextRequest) {
  return ingest(req);
}
