/**
 * Blanks at either end of a link's words (spaces, no-break spaces, tabs:
 * JavaScript's whitespace) belong outside the link. Word, and a browser on
 * Windows, select a word with the space after it; linked so, the space is
 * underlined and the site's box after the words (link-site.ts) sits after
 * the space, against the next word ("Feedbackbogen ␣[forms.gle]nach").
 * Moved out of the link, the blank stays in the text, never deleted, and
 * the box follows the words.
 *
 * Done where a link is made or kept: on paste (paste-cleanup.ts), by the
 * Link form (RichTextEditor), and in the stored format (sanitize.ts), which
 * every save, every editor opening and every learner page reads. The link
 * rule (link-text.ts) reads the words as before.
 *
 * Pure.
 */

const BLANK = /\s/;

/**
 * How many blanks `text` starts with and ends with (all of it, both, when
 * it is only blanks). Character by character: time in proportion to the
 * blanks, never a regular expression's backtracking over a long text.
 */
export function edgeBlanks(text: string): { lead: number; trail: number } {
  let lead = 0;
  while (lead < text.length && BLANK.test(text[lead])) lead++;
  if (lead === text.length) return { lead, trail: lead };
  let trail = 0;
  while (BLANK.test(text[text.length - 1 - trail])) trail++;
  return { lead, trail };
}
