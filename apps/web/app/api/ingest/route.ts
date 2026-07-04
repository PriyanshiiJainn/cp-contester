import { NextRequest, NextResponse } from "next/server";
import { createCfClient, divisionOf, problemKey } from "@cp/cf";
import { getPrisma } from "@cp/db";
import { throttleCf } from "@/lib/cf-throttle";

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

async function recordIngestOk(problems: number, withDivision: number) {
  const prisma = getPrisma();
  await prisma.ingestMeta.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      lastOkAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      problems,
      withDivision,
    },
    update: {
      lastOkAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      problems,
      withDivision,
    },
  });
}

async function recordIngestError(message: string) {
  try {
    const prisma = getPrisma();
    await prisma.ingestMeta.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
      },
      update: {
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
      },
    });
  } catch {
    /* meta write is best-effort */
  }
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

  try {
    const cf = createCfClient("https://codeforces.com/api");

    await throttleCf();
    const contests = await cf.getContestList();
    await throttleCf();
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

    // Wipe & refill metadata, but keep any sample tests we already scraped.
    const prisma = getPrisma();
    const priorSamples = await prisma.problem.findMany({
      select: { id: true, samples: true },
    });
    const samplesById = new Map(
      priorSamples
        .filter((p) => p.samples != null)
        .map((p) => [p.id, p.samples]),
    );
    const rowsWithSamples = rows.map((r) => {
      const samples = samplesById.get(r.id);
      return samples != null ? { ...r, samples } : r;
    });

    const CHUNK = 1000;
    const chunks = [];
    for (let i = 0; i < rowsWithSamples.length; i += CHUNK) {
      chunks.push(rowsWithSamples.slice(i, i + CHUNK));
    }
    await prisma.$transaction([
      prisma.problem.deleteMany({}),
      ...chunks.map((chunk) =>
        prisma.problem.createMany({ data: chunk, skipDuplicates: true }),
      ),
    ]);

    const withDivision = rows.filter((r) => r.division !== null).length;
    await recordIngestOk(rows.length, withDivision);

    return NextResponse.json({
      ok: true,
      problems: rows.length,
      withDivision,
      contests: contests.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ingest failed";
    await recordIngestError(message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return ingest(req);
}

export async function POST(req: NextRequest) {
  return ingest(req);
}
