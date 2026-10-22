import { checkLinkHref } from "@/lib/rich-text/link-url";
import { linkTextProblem, toLinkInput } from "@/lib/rich-text/link-text";
import { ownFileHost } from "@/lib/rich-text/own-file-host";

/**
 * Links pasted from Word, Google Docs or a web page (D106, spec 3.8): which
 * ones the editor keeps, and what it tells the author about the others.
 * paste-cleanup.ts applies this to every <a> of a paste (in the browser);
 * this is the pure part, so every rule is unit-tested in node.
 *
 * An anchor's text is always kept; only its link is kept or not:
 * - no address (Word's bookmarks, `_Toc…`, `_Hlk…`), or one within the
 *   document (`#_ftn1` footnotes, a table of contents): not a link a
 *   learner could use, and not worth a word — unwrapped, not counted;
 * - an Outlook safe link or a Google redirect: judged as its target when
 *   the target passes the address check (toLinkInput unwraps it); a safe
 *   link whose target doesn't is never kept, as it carries the mailbox
 *   address of whoever it was sent to;
 * - a link to our own file store: not kept ("uploaded"), as new links to
 *   our files aren't made — the file belongs in the lesson as a document;
 * - a link whose text shows another address than it opens: not kept
 *   ("misleading");
 * - an address the check accepts: kept, normalised, nothing but its
 *   address; http ones are counted, for a note;
 * - anything else (a file on the author's computer, a relative address,
 *   javascript:, tel:, …): not kept ("not-kept").
 */

export type PastedLink =
  | { keep: true; href: string; http: boolean }
  | { keep: false; counted: "not-kept" | "uploaded" | "misleading" | null };

/** What a paste did with its links: how many weren't kept, and why; how many use http. */
export interface PasteReport {
  notKept: number;
  uploaded: number;
  misleading: number;
  http: number;
}

export const NO_LINKS_DROPPED: PasteReport = { notKept: 0, uploaded: 0, misleading: 0, http: 0 };

/**
 * What to do with one pasted anchor: its `href` and `name` attributes (null
 * when absent) and its text.
 */
export function classifyPastedLink(anchor: {
  href: string | null;
  name: string | null;
  text: string;
}): PastedLink {
  const typed = anchor.href?.trim() ?? "";
  if (!typed || typed.startsWith("#")) return { keep: false, counted: null };
  if (!anchor.text.trim()) return { keep: false, counted: null };
  // Only an absolute web address can be a wrapper; anything else is judged
  // as it is (a relative "page.html" must not become "https://page.html").
  const target = /^https?:\/\//i.test(typed) ? toLinkInput(typed) : typed;
  const check = checkLinkHref(target, { ownFileHost: ownFileHost() });
  if (!check.ok) return { keep: false, counted: "not-kept" };
  if (check.ownFile) return { keep: false, counted: "uploaded" };
  if (linkTextProblem(anchor.text, check.href) === "misleading") return { keep: false, counted: "misleading" };
  return { keep: true, href: check.href, http: check.insecure };
}

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

/** The status line's notes after a paste: one sentence per count that isn't zero (authoring copy, English). */
export function pasteNotes(report: PasteReport): string[] {
  const notes: string[] = [];
  const { notKept, uploaded, misleading, http } = report;
  if (notKept) {
    notes.push(
      plural(
        notKept,
        "1 link wasn't kept: only web and email links can be used. Add it again with the Link button.",
        `${notKept} links weren't kept: only web and email links can be used. Add them again with the Link button.`
      )
    );
  }
  if (uploaded) {
    notes.push(
      plural(
        uploaded,
        "1 link to a file uploaded to the platform wasn't kept. Add the file to the lesson as a document instead.",
        `${uploaded} links to files uploaded to the platform weren't kept. Add the files to the lesson as documents instead.`
      )
    );
  }
  if (misleading) {
    notes.push(
      plural(
        misleading,
        "1 link wasn't kept because its text shows a different address. Add it again with the Link button, using a few words.",
        `${misleading} links weren't kept because their text shows a different address. Add them again with the Link button, using a few words.`
      )
    );
  }
  if (http) {
    notes.push(
      plural(
        http,
        "1 pasted link uses http://, which isn't secure. Change it to https:// if the site offers it.",
        `${http} pasted links use http://, which isn't secure. Change them to https:// if the sites offer it.`
      )
    );
  }
  return notes;
}
