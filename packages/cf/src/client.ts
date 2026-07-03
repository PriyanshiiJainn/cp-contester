import { z } from "zod";
import {
  CfContestSchema,
  CfEnvelopeSchema,
  CfProblemsetResultSchema,
  CfSubmissionSchema,
  CfUserSchema,
  type CfContest,
  type CfProblemsetResult,
  type CfSubmission,
  type CfUser,
} from "./schemas";

export class CfApiError extends Error {
  constructor(
    message: string,
    public readonly method: string,
  ) {
    super(message);
    this.name = "CfApiError";
  }
}

/**
 * Typed Codeforces client.
 *
 * In the browser, `base` MUST stay the default "/api/cf" so every call goes
 * through our Next.js proxy (codeforces.com has no CORS headers). Server-side
 * code (ingest, contest build) may pass "https://codeforces.com/api" to call
 * CF directly.
 */
export function createCfClient(base = "/api/cf") {
  async function call<S extends z.ZodTypeAny>(
    method: string,
    params: Record<string, string>,
    schema: S,
  ): Promise<z.output<S>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${base}/${method}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CfApiError(`CF returned non-JSON (HTTP ${res.status})`, method);
    }
    const envelope = CfEnvelopeSchema.parse(body);
    if (envelope.status !== "OK") {
      throw new CfApiError(envelope.comment ?? "CF request failed", method);
    }
    return schema.parse(envelope.result);
  }

  return {
    /** user.info — public rating/rank for a handle. */
    async getUserInfo(handle: string): Promise<CfUser> {
      const users = await call("user.info", { handles: handle }, z.array(CfUserSchema));
      if (users.length === 0) throw new CfApiError(`handle not found: ${handle}`, "user.info");
      return users[0];
    },

    /** user.status — the user's submissions (all of them by default). */
    async getUserStatus(
      handle: string,
      opts?: { from?: number; count?: number },
    ): Promise<CfSubmission[]> {
      const params: Record<string, string> = { handle };
      if (opts?.from) params.from = String(opts.from);
      if (opts?.count) params.count = String(opts.count);
      return call("user.status", params, z.array(CfSubmissionSchema));
    },

    /** problemset.problems — the entire ~9k problem archive in one call. */
    async getProblemset(): Promise<CfProblemsetResult> {
      return call("problemset.problems", {}, CfProblemsetResultSchema);
    },

    /** contest.list — all non-gym contests (id + name + phase). */
    async getContestList(): Promise<CfContest[]> {
      return call("contest.list", { gym: "false" }, z.array(CfContestSchema));
    },
  };
}

export type CfClient = ReturnType<typeof createCfClient>;

/** Canonical problem key, e.g. contestId 1352 + index "A" -> "1352A". */
export function problemKey(contestId: number, index: string): string {
  return `${contestId}${index}`;
}

/**
 * Reduce a submission list to the set of solved problem keys
 * (verdict === "OK"). Submissions without a contestId (e.g. from private
 * groups) are skipped.
 */
export function solvedKeys(submissions: CfSubmission[]): Set<string> {
  const solved = new Set<string>();
  for (const sub of submissions) {
    const cid = sub.problem.contestId ?? sub.contestId;
    if (sub.verdict === "OK" && cid !== undefined) {
      solved.add(problemKey(cid, sub.problem.index));
    }
  }
  return solved;
}
