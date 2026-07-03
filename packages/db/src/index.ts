import { PrismaClient } from "@prisma/client";

/**
 * Lazy singleton: the client is only constructed on first use, so importing
 * this package (e.g. during `next build`) never requires DATABASE_URL.
 * In dev, the instance is cached on globalThis to survive HMR reloads.
 */
const globalForPrisma = globalThis as unknown as { __cpPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__cpPrisma) {
    globalForPrisma.__cpPrisma = new PrismaClient();
  }
  return globalForPrisma.__cpPrisma;
}

export type { Problem, VirtualRound } from "@prisma/client";
