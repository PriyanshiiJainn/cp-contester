-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "contestId" INTEGER NOT NULL,
    "index" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER,
    "tags" TEXT[],
    "division" TEXT,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualRound" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "problemIds" TEXT[],
    "solvedIds" TEXT[],
    "perf" INTEGER,
    "delta" INTEGER,
    "ratingBefore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Problem_division_rating_idx" ON "Problem"("division", "rating");

-- CreateIndex
CREATE INDEX "VirtualRound_handle_createdAt_idx" ON "VirtualRound"("handle", "createdAt");

