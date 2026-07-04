import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";
import {
  fetchCfProblemHtml,
  parseSamplesFromHtml,
  type SampleTest,
} from "@/lib/samples";

/**
 * Return sample tests for a CF problem, scraping the statement once and
 * caching them on the Problem row.
 */

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  id: z.string().min(1).max(32).optional(),
  contestId: z.coerce.number().int().positive().optional(),
  index: z.string().min(1).max(8).optional(),
});

function isSampleArray(v: unknown): v is SampleTest[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof (s as SampleTest).input === "string" &&
        typeof (s as SampleTest).output === "string",
    )
  );
}

export async function GET(req: NextRequest) {
  let query: z.infer<typeof QuerySchema>;
  try {
    query = QuerySchema.parse({
      id: req.nextUrl.searchParams.get("id") ?? undefined,
      contestId: req.nextUrl.searchParams.get("contestId") ?? undefined,
      index: req.nextUrl.searchParams.get("index") ?? undefined,
    });
  } catch {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  const prisma = getPrisma();
  let contestId = query.contestId;
  let index = query.index;
  let problemId = query.id;

  if (problemId) {
    const row = await prisma.problem.findUnique({
      where: { id: problemId },
      select: { id: true, contestId: true, index: true, samples: true },
    });
    if (row) {
      if (isSampleArray(row.samples) && row.samples.length > 0) {
        return NextResponse.json({ id: row.id, samples: row.samples, cached: true });
      }
      contestId = row.contestId;
      index = row.index;
    } else {
      const m = /^(\d+)(.+)$/.exec(problemId);
      if (!m) {
        return NextResponse.json({ error: "unknown problem id" }, { status: 404 });
      }
      contestId = Number(m[1]);
      index = m[2];
    }
  }

  if (contestId == null || !index) {
    return NextResponse.json(
      { error: "id or contestId+index required" },
      { status: 400 },
    );
  }

  problemId = problemId ?? `${contestId}${index}`;

  try {
    const html = await fetchCfProblemHtml(contestId, index);
    const samples = parseSamplesFromHtml(html);
    if (samples.length === 0) {
      return NextResponse.json(
        { error: "no sample tests found on the problem page" },
        { status: 404 },
      );
    }

    // Cache when the problem row exists (ingest may not have run yet).
    await prisma.problem
      .update({
        where: { id: problemId },
        data: { samples },
      })
      .catch(() => null);

    return NextResponse.json({ id: problemId, samples, cached: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed to load samples";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
