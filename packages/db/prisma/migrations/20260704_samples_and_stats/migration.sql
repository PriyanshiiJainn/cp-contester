-- Sample tests cached from CF problem statements (filled on demand).
ALTER TABLE "Problem" ADD COLUMN IF NOT EXISTS "samples" JSONB;

-- Per-problem solve minute for finished rounds: { "1352A": 12, ... }
ALTER TABLE "VirtualRound" ADD COLUMN IF NOT EXISTS "solveMinutes" JSONB;

-- Drop rating-predictor / unused scoring columns.
ALTER TABLE "VirtualRound" DROP COLUMN IF EXISTS "ioiPoints";
ALTER TABLE "VirtualRound" DROP COLUMN IF EXISTS "score";
ALTER TABLE "VirtualRound" DROP COLUMN IF EXISTS "perf";
ALTER TABLE "VirtualRound" DROP COLUMN IF EXISTS "delta";
ALTER TABLE "VirtualRound" DROP COLUMN IF EXISTS "ratingBefore";
