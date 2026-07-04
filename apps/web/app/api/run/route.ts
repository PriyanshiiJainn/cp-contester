import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";
import { runWithPiston, type RunLanguage } from "@/lib/piston";
import {
  fetchCfProblemHtml,
  outputsMatch,
  parseSamplesFromHtml,
  type SampleTest,
} from "@/lib/samples";

/**
 * Run source code against a problem's sample tests (Parse-tests style).
 * Samples are loaded from the DB cache or scraped from CF on demand.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  problemId: z.string().min(1).max(32),
  language: z.enum(["cpp", "python", "java", "javascript"]),
  source: z.string().min(1).max(100_000),
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

async function loadSamples(problemId: string): Promise<SampleTest[] | null> {
  const prisma = getPrisma();
  const row = await prisma.problem.findUnique({
    where: { id: problemId },
    select: { id: true, contestId: true, index: true, samples: true },
  });

  if (row && isSampleArray(row.samples) && row.samples.length > 0) {
    return row.samples;
  }

  let contestId = row?.contestId;
  let index = row?.index;
  if (contestId == null || !index) {
    const m = /^(\d+)(.+)$/.exec(problemId);
    if (!m) return null;
    contestId = Number(m[1]);
    index = m[2];
  }

  const html = await fetchCfProblemHtml(contestId, index);
  const samples = parseSamplesFromHtml(html);
  if (samples.length === 0) return null;

  if (row) {
    await prisma.problem
      .update({ where: { id: problemId }, data: { samples } })
      .catch(() => null);
  }
  return samples;
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  let samples: SampleTest[] | null;
  try {
    samples = await loadSamples(body.problemId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "failed to load samples";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!samples || samples.length === 0) {
    return NextResponse.json(
      { error: "no sample tests available for this problem" },
      { status: 404 },
    );
  }

  const results = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const run = await runWithPiston(
      body.language as RunLanguage,
      body.source,
      sample.input,
    );
    if (!run.ok) {
      results.push({
        index: i + 1,
        status: "error" as const,
        passed: false,
        expected: sample.output,
        got: run.stdout,
        stderr: run.stderr || run.error,
      });
      continue;
    }
    const passed = outputsMatch(run.stdout, sample.output);
    results.push({
      index: i + 1,
      status: passed ? ("pass" as const) : ("fail" as const),
      passed,
      expected: sample.output,
      got: run.stdout,
      stderr: run.stderr || null,
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  return NextResponse.json({
    problemId: body.problemId,
    passed: passedCount,
    total: results.length,
    allPassed: passedCount === results.length,
    results,
  });
}
