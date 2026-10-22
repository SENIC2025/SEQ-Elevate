import { checkLinkHref, isSafeLinkHost } from "@/lib/rich-text/link-url";
import { linkTextProblem, toLinkInput, visibleLinkText } from "@/lib/rich-text/link-text";
import { ownFileHost } from "@/lib/rich-text/own-file-host";

/**
 * Links pasted from Word, Google Docs or a web page (D106, spec 3.8): which
 * ones the editor keeps, and what it tells the author about the others.
 * paste-cleanup.ts applies this to every <a> of a paste (in the browser);
 * this is the pure part, so every rule is unit-tested in node.
 *
 * An anchor's text is always kept (an Outlook safe link in it shows the
 * original address instead, as it carries the address of the mailbox it was
 * sent to); only its link is kept or not:
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

/** `text`: the anchor's text to show instead, when it held an Outlook safe link. */
export type PastedLink =
  | { keep: true; href: string; http: boolean; text?: string }
  | { keep: false; counted: "not-kept" | "uploaded" | "misleading" | null; text?: string };

/**
 * What a paste did with its links: how many weren't kept, and why; how many
 * use http; how many showed an Outlook safe link as their text.
 */
export interface PasteReport {
  notKept: number;
  uploaded: number;
  misleading: number;
  http: number;
  safeLinkText: number;
}

export const NO_LINKS_DROPPED: PasteReport = { notKept: 0, uploaded: 0, misleading: 0, http: 0, safeLinkText: 0 };

// An address in an anchor's text: to whitespace, quotes or angle brackets.
const ADDRESS_IN_TEXT = /https?:\/\/[^\s<>"`]+/gi;
// Punctuation that ends a sentence or closes a bracket, after an address.
const AFTER_ADDRESS = /[.,;:!?'")\]}»”’]+$/u;

/** How many safe links inside safe links are unwrapped before only the wrapper's host is shown. */
const MAX_WRAPPED = 4;

/**
 * An anchor's text with every Outlook safe link in it replaced by the
 * address it wraps (the `url` parameter, decoded, itself unwrapped if it is
 * one too), or by the wrapper's own host when it wraps none, so the mailbox
 * address in its `data` never shows. Null when the text holds none.
 */
export function withoutSafeLinks(text: string): string | null {
  let found = false;
  const unwrap = (match: string, depth: number): string => {
    const trailing = AFTER_ADDRESS.exec(match)?.[0] ?? "";
    const address = match.slice(0, match.length - trailing.length);
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return match;
    }
    if (!isSafeLinkHost(url.hostname)) return match;
    found = true;
    const target = url.searchParams.get("url")?.trim();
    const host = `${url.protocol}//${url.host}/`;
    if (!target || depth >= MAX_WRAPPED) return host + trailing;
    return target.replace(ADDRESS_IN_TEXT, (inner) => unwrap(inner, depth + 1)) + trailing;
  };
  const replaced = text.replace(ADDRESS_IN_TEXT, (match) => unwrap(match, 0));
  return found ? replaced : null;
}

/**
 * What to do with one pasted anchor: its `href` and `name` attributes (null
 * when absent) and its text.
 */
export function classifyPastedLink(anchor: {
  href: string | null;
  name: string | null;
  text: string;
}): PastedLink {
  const shown = withoutSafeLinks(anchor.text);
  const text = shown ?? anchor.text;
  const result = (link: PastedLink): PastedLink => (shown === null ? link : { ...link, text: shown });
  const typed = anchor.href?.trim() ?? "";
  if (!typed || typed.startsWith("#")) return result({ keep: false, counted: null });
  if (!visibleLinkText(text).trim()) return result({ keep: false, counted: null });
  // Only an absolute web address can be a wrapper; anything else is judged
  // as it is (a relative "page.html" must not become "https://page.html").
  const target = /^https?:\/\//i.test(typed) ? toLinkInput(typed) : typed;
  const check = checkLinkHref(target, { ownFileHost: ownFileHost() });
  if (!check.ok) return result({ keep: false, counted: "not-kept" });
  if (check.ownFile) return result({ keep: false, counted: "uploaded" });
  if (linkTextProblem(text, check.href) === "misleading") return result({ keep: false, counted: "misleading" });
  return result({ keep: true, href: check.href, http: check.insecure });
}

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

/** The status line's notes after a paste: one sentence per count that isn't zero (authoring copy, English). */
export function pasteNotes(report: PasteReport): string[] {
  const notes: string[] = [];
  const { notKept, uploaded, misleading, http, safeLinkText } = report;
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
  if (safeLinkText) {
    notes.push(
      plural(
        safeLinkText,
        "1 link's text was an Outlook safe link, which carries the address of the mailbox it was sent to: it now shows the original address.",
        `${safeLinkText} links' text was an Outlook safe link, which carries the address of the mailbox it was sent to: they now show the original address.`
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
