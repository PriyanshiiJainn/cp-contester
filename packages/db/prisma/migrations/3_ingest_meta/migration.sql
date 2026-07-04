-- CreateTable
CREATE TABLE "IngestMeta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "problems" INTEGER,
    "withDivision" INTEGER,

    CONSTRAINT "IngestMeta_pkey" PRIMARY KEY ("id")
);
