import { z } from "zod";

/**
 * Zod schemas for the (small) slice of the Codeforces API we consume.
 * Everything crossing the CF boundary is parsed through these — unknown
 * fields are ignored, wrong shapes fail loudly.
 */

export const CfProblemSchema = z.object({
  contestId: z.number().optional(),
  problemsetName: z.string().optional(),
  index: z.string(),
  name: z.string(),
  type: z.string().optional(),
  rating: z.number().optional(),
  tags: z.array(z.string()).default([]),
});
export type CfProblem = z.infer<typeof CfProblemSchema>;

export const CfSubmissionSchema = z.object({
  id: z.number(),
  contestId: z.number().optional(),
  creationTimeSeconds: z.number(),
  problem: CfProblemSchema,
  verdict: z.string().optional(),
});
export type CfSubmission = z.infer<typeof CfSubmissionSchema>;

export const CfUserSchema = z.object({
  handle: z.string(),
  rating: z.number().optional(),
  maxRating: z.number().optional(),
  rank: z.string().optional(),
  maxRank: z.string().optional(),
});
export type CfUser = z.infer<typeof CfUserSchema>;

export const CfContestSchema = z.object({
  id: z.number(),
  name: z.string(),
  phase: z.string(),
});
export type CfContest = z.infer<typeof CfContestSchema>;

export const CfProblemsetResultSchema = z.object({
  problems: z.array(CfProblemSchema),
});
export type CfProblemsetResult = z.infer<typeof CfProblemsetResultSchema>;

/** Every CF API response is wrapped in this envelope. */
export const CfEnvelopeSchema = z.object({
  status: z.enum(["OK", "FAILED"]),
  comment: z.string().optional(),
  result: z.unknown().optional(),
});
