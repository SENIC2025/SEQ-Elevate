/**
 * The 1 December rule's date (D67, spec 4.7): from then on, a course with
 * learners — published or not, so unpublishing it to rework it doesn't get
 * round the rule — can't have lessons or content added, moved or removed
 * (live-rules.ts). Hiding and showing lessons, renaming them and editing
 * text and questions stay open.
 *
 *   RESTRUCTURE_CLOSED_FROM unset or blank  2026-12-01T00:00:00+01:00
 *                           an ISO date     that moment (a date alone is
 *                                           midnight UTC, as Date reads it)
 *                           "off"           never
 *                           anything else   the default, and one log line
 *
 * A server environment variable, read on every call, so a changed value
 * takes effect on the next request of a redeploy. The clock is passed in,
 * so the tests (and the e2e "cutoff" project, which sets the variable to
 * 2020) choose which side of the date they are on.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_RESTRUCTURE_CLOSED_FROM = "2026-12-01T00:00:00+01:00";

/** When restructuring closes, and whether `now` is past it. */
export interface Cutoff {
  /** The moment as an ISO string (UTC), or null when switched off. */
  from: string | null;
  closed: boolean;
}

/** YYYY-MM-DD, optionally with a time and a zone (Z or ±hh:mm). */
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Values already reported as unreadable: each is logged once per server. */
const reported = new Set<string>();

function parse(raw: string | undefined, log: (line: string) => void): number | null {
  const value = raw?.trim() ?? "";
  if (value.toLowerCase() === "off") return null;
  const ms = value && ISO.test(value) ? Date.parse(value) : NaN;
  if (Number.isFinite(ms)) return ms;
  if (value && !reported.has(value)) {
    reported.add(value);
    // The value itself stays out of the log: only that it couldn't be read.
    log(
      `[cutoff] RESTRUCTURE_CLOSED_FROM is neither an ISO date nor "off"; using the default, ${DEFAULT_RESTRUCTURE_CLOSED_FROM}.`
    );
  }
  return Date.parse(DEFAULT_RESTRUCTURE_CLOSED_FROM);
}

export function restructureClosedFrom(
  env: Env = process.env,
  now: Date = new Date(),
  log: (line: string) => void = console.warn
): Cutoff {
  const ms = parse(env.RESTRUCTURE_CLOSED_FROM, log);
  if (ms === null) return { from: null, closed: false };
  return { from: new Date(ms).toISOString(), closed: now.getTime() >= ms };
}
