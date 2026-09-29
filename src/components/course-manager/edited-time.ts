/**
 * The course cards' "Edited …" line: a relative time ("3 days ago") plus the
 * exact moment for its tooltip. Pure — `now` is a parameter — so it is
 * unit-tested, and the server renders it once (no hydration mismatch).
 */

const MINUTE = 60_000;

/**
 * "now", "5 minutes ago", "3 days ago", "2 weeks ago", "1 year ago" in the
 * viewer's language, or null for a timestamp that doesn't parse.
 *
 * Always numeric: "auto" phrasing ("last month", "yesterday") reads wrongly
 * after "Edited" in Greek, and "yesterday" can be two calendar days back.
 */
export function editedAgo(
  iso: string,
  locale: string,
  now: number = Date.now()
): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  // A stamp slightly ahead of this server's clock (DB clock skew) is "now".
  const minutes = Math.max(0, Math.floor((now - then) / MINUTE));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (minutes < 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      0,
      "second"
    );
  }
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

/**
 * The exact time for the tooltip, e.g. "29 September 2026 at 11:23 UTC".
 * UTC and labelled as such: the server can't know the viewer's time zone.
 */
export function editedAt(iso: string, locale: string): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(then);
}
