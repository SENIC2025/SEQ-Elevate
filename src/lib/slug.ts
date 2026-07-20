/**
 * URL-safe slugs for CMS-created courses. Pure and unit-tested — the slug is
 * a permanent identifier (it ends up in learner URLs and enrolment rows), so
 * it deserves to be predictable rather than incidental.
 */

/** "Giving Feedback!" → "giving-feedback"; "Röckchen" → "rockchen". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD") // split accented letters into base + combining mark…
    .replace(/[\u0300-\u036f]/g, "") // …then drop the marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, ""); // a trailing dash can survive the slice
}
