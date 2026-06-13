/**
 * Prisma client singleton (Prisma 7 + Postgres adapter).
 *
 * Next.js dev hot-reloads modules, so without this singleton each
 * reload spawns a new client and exhausts connections. The global
 * cache pattern keeps a single instance across reloads.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
}

export const prisma = global.prismaGlobal ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
