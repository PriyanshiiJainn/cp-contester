-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- AlterTable
ALTER TABLE "VirtualRound" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "VirtualRound_userId_createdAt_idx" ON "VirtualRound"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VirtualRound" ADD CONSTRAINT "VirtualRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
