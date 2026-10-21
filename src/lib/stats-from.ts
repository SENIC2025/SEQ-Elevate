/**
 * Release 3 (D83, spec 7.3): the moment statistics count from. Activity
 * before it (enrolments, telemetry, badges) is left out of the Statistics
 * page, so the trials before launch don't count.
 *
 *   STATS_FROM unset or blank  2026-12-01T00:00:00+01:00
 *              an ISO date     that moment (a date alone is midnight UTC,
 *                              as Date reads it)
 *              "off"           no date: everything counts
 *              anything else   the default, and one log line
 *
 * A server environment variable, read on every call, so a changed value
 * takes effect on the next request of a redeploy. Separate from
 * RESTRUCTURE_CLOSED_FROM (cms/sections/cutoff.ts), although both default to
 * 1 December. There is no query-string override.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_STATS_FROM = "2026-12-01T00:00:00+01:00";

/** YYYY-MM-DD, optionally with a time and a zone (Z or ±hh:mm). */
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Values already reported as unreadable: each is logged once per server. */
const reported = new Set<string>();

/** The moment statistics count from, or null when switched off. */
export function statsFrom(env: Env = process.env, log: (line: string) => void = console.warn): Date | null {
  const value = env.STATS_FROM?.trim() ?? "";
  if (value.toLowerCase() === "off") return null;
  const ms = value && ISO.test(value) ? Date.parse(value) : NaN;
  if (Number.isFinite(ms)) return new Date(ms);
  if (value && !reported.has(value)) {
    reported.add(value);
    // The value itself stays out of the log: only that it couldn't be read.
    log(`[statistics] STATS_FROM is neither an ISO date nor "off"; using the default, ${DEFAULT_STATS_FROM}.`);
  }
  return new Date(DEFAULT_STATS_FROM);
}
