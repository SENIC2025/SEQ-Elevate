import "server-only";

/**
 * Small DB-backed fixed-window rate limiter. Serverless-safe (the DB is the
 * shared source of truth, so it works across Vercel lambdas) and stores no
 * PII — callers pass an already-hashed key for anything sensitive.
 *
 * Fail-open by design: if the limiter itself errors, we allow the request. A
 * hiccup in the rate-limit table must never lock a real learner out of
 * signing in — the limiter is abuse mitigation, not an auth gate.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface RateLimitResult {
  ok: boolean;
  count: number;
  limit: number;
}

/** Stable, non-reversible key for a sensitive identifier (e.g. an email). */
export function hashKey(prefix: string, value: string): string {
  const digest = createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${digest}`;
}

/**
 * Count this request against `key` in the current time window. Returns ok=false
 * once the count exceeds `limit` within `windowMs`.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / windowMs);
  try {
    const row = await prisma.rateLimit.upsert({
      where: { key_windowStart: { key, windowStart: bucket } },
      create: { key, windowStart: bucket, count: 1 },
      update: { count: { increment: 1 } },
    });

    // Opportunistic cleanup of stale buckets (older than the previous window),
    // so the table can't grow without bound. Best-effort, ignore failures.
    prisma.rateLimit
      .deleteMany({ where: { windowStart: { lt: bucket - 1 } } })
      .catch(() => {});

    return { ok: row.count <= limit, count: row.count, limit };
  } catch {
    return { ok: true, count: 0, limit };
  }
}
