/**
 * What the Statistics page says its figures count (spec 7.5, D83): from
 * when (STATS_FROM, stats-from.ts), without whom (staff, former staff and
 * test accounts), and for partner staff, of which organisation; and, when
 * there is nothing to show, why. English only, as the rest of the page.
 */

/** "1 December 2026": the day a moment falls on in Brussels, where the project runs. */
export function countingDay(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  }).format(at);
}

/** What the live figures count. `from` as countingDay gives it; null: no date (STATS_FROM=off). */
export interface Counting {
  from: string | null;
  /** The viewer's organisation when the figures are only its learners' (organisation scope). */
  organisation: string | null;
}

/** The line under the page's title. */
export function countingLine({ from, organisation }: Counting): string {
  const line = from
    ? `Counting from ${from}. Staff, former staff and test accounts are left out.`
    : "Staff, former staff and test accounts are left out.";
  return organisation ? `${line} ${organisation} only.` : line;
}

/**
 * Why there are no figures to show, most specific first: staff whose
 * account isn't linked to an organisation see none; other staff with no
 * scope (partner access switched off, D77) see none either, whatever the
 * date; a read that failed says so, never that nobody started (spec 7.3);
 * before the start date nothing is counted yet; after it, no learner (of
 * the organisation) has started.
 */
export function emptyStatistics({
  from,
  organisation,
  noOrganisation,
  noScope = false,
  unreadable = false,
  now = Date.now(),
}: {
  from: Date | null;
  organisation: string | null;
  noOrganisation: boolean;
  /** The viewer's scope is none: no learner is read for them at all. */
  noScope?: boolean;
  /** The read failed (buildRealAnalytics's "unreadable"). */
  unreadable?: boolean;
  now?: number;
}): string {
  if (noOrganisation) {
    return "Your account isn't linked to an organisation yet, so no learners are counted. Ask DIESIS to link it.";
  }
  if (noScope) return "Statistics can't be shown to your account right now.";
  if (unreadable) return "The statistics couldn't be read just now. Try reloading the page in a few minutes.";
  if (from && now < from.getTime()) return `Counting starts on ${countingDay(from)}.`;
  if (organisation) {
    return from
      ? `No learners in ${organisation} have started since ${countingDay(from)}.`
      : `No learners in ${organisation} have started yet.`;
  }
  return "No statistics to show yet. They appear here as soon as a learner starts a course. If learners have already started, try reloading the page.";
}
