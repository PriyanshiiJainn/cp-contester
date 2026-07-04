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

/**
 * Verdicts that incur an ICPC / CF wrong-attempt penalty.
 * Compilation errors and in-queue / skipped rows do not count.
 */
const PENALIZED_VERDICTS = new Set([
  "WRONG_ANSWER",
  "TIME_LIMIT_EXCEEDED",
  "MEMORY_LIMIT_EXCEEDED",
  "RUNTIME_ERROR",
  "IDLENESS_LIMIT_EXCEEDED",
  "PRESENTATION_ERROR",
  "FAILED",
  "BAD_JUDGE_VERDICT",
]);

/** Per-problem progress extracted from CF submissions during a virtual round. */
export interface RoundProblemProgress {
  /** Minutes from round start to first OK, or null if never fully solved. */
  minute: number | null;
  /** Penalized verdicts strictly before the first OK (0 if unsolved). */
  wrongAttempts: number;
  /**
   * IOI-style fraction in [0, 1].
   * Full AC ⇒ 1; else best `points` seen / `ioiMaxPoints` (capped at 1).
   */
  partial: number;
}

export interface RoundProgressOptions {
  /** Epoch ms when the virtual round started. */
  startedAt: number;
  /** Epoch ms when the virtual round ended (or now, while running). */
  endedAt: number;
  /** Problem keys (contestId+index) that belong to the round. */
  slotIds: ReadonlySet<string>;
  /**
   * Denominator for IOI partials when CF returns `points` without OK.
   * Default 100 (one IOI problem).
   */
  ioiMaxPoints?: number;
}

/**
 * Collapse a CF submission list into per-problem progress for one virtual
 * round. Only submissions whose creation time falls inside [startedAt, endedAt]
 * and whose problem is in `slotIds` are considered.
 */
export function roundProgress(
  submissions: CfSubmission[],
  opts: RoundProgressOptions,
): Map<string, RoundProblemProgress> {
  const ioiMax = opts.ioiMaxPoints ?? 100;
  const startSec = opts.startedAt / 1000;
  const endSec = opts.endedAt / 1000;

  // Group in-window submissions by problem key, oldest first.
  const byProblem = new Map<string, CfSubmission[]>();
  for (const sub of submissions) {
    const cid = sub.problem.contestId ?? sub.contestId;
    if (cid === undefined) continue;
    const key = problemKey(cid, sub.problem.index);
    if (!opts.slotIds.has(key)) continue;
    const t = sub.creationTimeSeconds;
    if (t < startSec || t > endSec) continue;
    const list = byProblem.get(key);
    if (list) list.push(sub);
    else byProblem.set(key, [sub]);
  }

  const out = new Map<string, RoundProblemProgress>();
  for (const [key, list] of byProblem) {
    list.sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds);

    let wrongAttempts = 0;
    let minute: number | null = null;
    let bestPoints = 0;

    for (const sub of list) {
      if (sub.points != null && sub.points > bestPoints) {
        bestPoints = sub.points;
      }
      if (minute != null) continue; // post-AC submissions don't affect scoring
      if (sub.verdict === "OK") {
        minute = Math.floor((sub.creationTimeSeconds * 1000 - opts.startedAt) / 60_000);
        continue;
      }
      if (sub.verdict && PENALIZED_VERDICTS.has(sub.verdict)) {
        wrongAttempts += 1;
      }
    }

    const partial =
      minute != null ? 1 : Math.min(1, bestPoints > 0 ? bestPoints / ioiMax : 0);

    // Only emit rows with some signal (AC, wrongs, or partial points).
    if (minute == null && wrongAttempts === 0 && partial === 0) continue;

    out.set(key, {
      minute,
      // ICPC/CF: wrongs only attach to problems that are eventually solved.
      // For unsolved problems we still surface the count in the UI, but scoring
      // helpers ignore wrongs when minute is null.
      wrongAttempts,
      partial,
    });
  }
  return out;
}
