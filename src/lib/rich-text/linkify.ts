import { checkLinkHref, isEmailAddress } from "./link-url";
import type { RtInline, RtText } from "./types";

/**
 * Quick links: web and email addresses typed in lesson text become links
 * when the text is shown to learners (Release 0, amending D36). Only at
 * render time — nothing stored changes, and the editor keeps a typed
 * address as plain text (named links are the editor's link marks, D104).
 *
 * What counts as an address, and nothing else:
 * - `https://…` and `http://…`, the scheme in any letter case, with a host
 *   that has a dot in it;
 * - `mailto:` followed by an email address (and an optional `?subject=…`);
 * - a bare email address such as `help@example.org`, linked as mailto.
 * A typed address is a link exactly when the one address check
 * (checkLinkHref, link-url.ts; D103) accepts it, so a typed address and a
 * named link to the same place are accepted or refused alike: an address
 * over 2,048 characters, a mailto: with anything but a subject, and an
 * Outlook safe link stay text. An address of our own file store stays a
 * quick link (only new named links refuse those). Every other scheme —
 * javascript:, data:, vbscript:, file: and the rest — is never linked.
 * A host — a web address's, or an email address's domain — has no label
 * over 63 characters and is itself at most 253 (DNS's limits), every
 * character counted as typed, letters or not, before anything parses it:
 * a run past them isn't an address, and the URL parser never sees it (it
 * converts an international label at a cost that grows with the square
 * of its length). The address check then holds a web address's host to
 * the same limits as DNS writes it (in punycode).
 *
 * Trailing punctuation (". , ; : ! ?" and closing quotes, Greek and German
 * ones included) and unbalanced closing brackets stay outside the link, so
 * "(see https://example.org)." links just the address. An address glued to
 * the word before it ("xhttps://…") or hiding its real host behind a user
 * name ("https://bank.example@evil.example") isn't linked.
 *
 * Pure and linear in the length of the text (lesson text is at most
 * RT_LIMITS.maxTextChars a block), so server and client agree and every
 * render can afford it; the URL parser only ever sees a host within DNS's
 * limits.
 */

export type LinkKind = "web" | "email";

/** An address in a text: `text.slice(start, end)`, opened by `href`. */
export interface FoundLink {
  start: number;
  end: number;
  href: string;
  kind: LinkKind;
}

/** A run of linked text in a paragraph: its text nodes keep their marks. */
export interface RtLinkRun {
  type: "link";
  href: string;
  kind: LinkKind;
  content: RtText[];
}

export type LinkedInline = RtInline | RtLinkRun;

// Where an address may start. "@" stands for a bare email address, found
// around it. A fresh copy per call: a global regex carries its position.
const CANDIDATE = /https?:\/\/|mailto:|@/gi;

// The run of characters an address can span: it ends at whitespace, at
// quotes and angle brackets (which delimit addresses in prose), at control
// characters, and at the invisible direction marks that could make an
// address look like another one.
const RUN = /[^\s<>"`\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]*/uy;

// Characters that may end a typed run but are never part of the address:
// sentence punctuation (the Greek question mark is ";", its ano teleia "·")
// and closing quotes in English, German and Greek style.
const TRAILING = new Set([
  ".", ",", ";", ":", "!", "?", "'", '"', "*", "_", "~",
  "…", "·", "·",
  "“", "”", "‘", "’", "„", "«", "»", "‹", "›",
]);

const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

// Before a scheme: a letter, digit or one of these glues it to a word or a
// scheme ("javascript:https://…"), so it isn't an address of its own.
const GLUED_BEFORE_SCHEME = /[\p{L}\p{N}\p{M}_:/@.+-]/u;

// The user part of an email address, and what may not come right before
// it: a letter or digit (the user part would have taken it in) or another
// scheme's separator ("ftp://user@…", "ssh:user@…").
const LOCAL_CHAR = /[\p{L}\p{N}\p{M}._+-]/u;
const GLUED_BEFORE_EMAIL = /[\p{L}\p{N}\p{M}_/:@.+-]/u;
const DOMAIN_CHAR = /[\p{L}\p{N}\p{M}.-]/u;

// The longest a host's label and a whole host may be (DNS's 63 and 253),
// in code points as typed.
const MAX_LABEL = 63;
const MAX_HOST = 253;

/** Every address in `text`, in order and never overlapping. */
export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  const candidates = new RegExp(CANDIDATE.source, CANDIDATE.flags);
  // Text before `floor` is already linked or ruled out.
  let floor = 0;
  let match: RegExpExecArray | null;
  while ((match = candidates.exec(text))) {
    const at = match.index;
    const token = match[0].toLowerCase();
    let next: number;
    if (token === "@") {
      next = email(text, at, floor, found);
    } else {
      next = scheme(text, at, token === "mailto:" ? "mailto" : "web", found);
    }
    floor = next;
    candidates.lastIndex = next;
  }
  return found;
}

/**
 * A web or mailto address starting at `start`. Adds it to `found` when it
 * is one; returns where scanning goes on. A run that isn't an address is
 * skipped whole, so no part of it is linked on its own.
 */
function scheme(
  text: string,
  start: number,
  kind: "web" | "mailto",
  found: FoundLink[]
): number {
  RUN.lastIndex = start;
  const runEnd = start + (RUN.exec(text)?.[0].length ?? 0);
  if (start > 0 && GLUED_BEFORE_SCHEME.test(text[start - 1])) return runEnd;

  const end = trimEnd(text, start, runEnd);
  const typed = text.slice(start, end);
  const href = kind === "web" ? webHref(typed) : mailtoHref(typed);
  if (href) {
    found.push({ start, end, href, kind: kind === "web" ? "web" : "email" });
    return end;
  }
  return runEnd;
}

/** An https or http href for a typed address (checkLinkHref), or null if it isn't one. */
function webHref(typed: string): string | null {
  // A host past DNS's limits as typed is none, before anything parses it.
  const [from, to] = webHost(typed);
  if (!hostFits(typed, from, to)) return null;
  const check = checkLinkHref(typed);
  return check.ok && check.kind === "web" ? check.href : null;
}

/**
 * Where the host of a typed "https://…" or "http://…" is in it, [from, to),
 * as the URL parser finds it: past the scheme and its slashes (backslashes
 * too), up to the path, query or fragment, after a user name, before a
 * port. One pass.
 */
function webHost(typed: string): [number, number] {
  let from = typed.indexOf(":") + 1;
  while (from < typed.length && (typed[from] === "/" || typed[from] === "\\")) from++;
  let to = from;
  for (; to < typed.length; to++) {
    const char = typed[to];
    if (char === "/" || char === "\\" || char === "?" || char === "#") break;
    if (char === "@") from = to + 1;
  }
  // "[…]" holds an IPv6 address's colons; otherwise a colon starts the port.
  const bracketed = typed[from] === "[";
  for (let i = from; i < to; i++) {
    if (bracketed ? typed[i] === "]" : typed[i] === ":") return [from, bracketed ? i + 1 : i];
  }
  return [from, to];
}

/**
 * Could `text.slice(from, to)` be a host? None of its labels over MAX_LABEL
 * code points, and itself at most MAX_HOST (a final dot, the root, aside):
 * every code point counts, letters or not. The full stop and the ones the
 * URL parser reads as it (ideographic, fullwidth, halfwidth) separate
 * labels. Linear, and it stops at the first that is too long.
 */
function hostFits(text: string, from: number, to: number): boolean {
  let host = 0;
  let label = 0;
  let lastDot = false;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    // A surrogate pair is one code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < to) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) i++;
    }
    lastDot = code === 0x2e || code === 0x3002 || code === 0xff0e || code === 0xff61;
    if (lastDot) label = 0;
    else if (++label > MAX_LABEL) return false;
    if (++host > MAX_HOST + 1) return false;
  }
  return host - (lastDot ? 1 : 0) <= MAX_HOST;
}

/** The href for a typed "mailto:address[?subject=…]" (checkLinkHref), or null. */
function mailtoHref(typed: string): string | null {
  const check = checkLinkHref(typed);
  return check.ok && check.kind === "email" ? check.href : null;
}

/**
 * A bare email address around the "@" at `at`, its user part starting no
 * earlier than `floor`. Adds it to `found` when it is one; returns where
 * scanning goes on.
 */
function email(
  text: string,
  at: number,
  floor: number,
  found: FoundLink[]
): number {
  let start = at;
  while (start > floor && LOCAL_CHAR.test(text[start - 1])) start--;
  let end = at + 1;
  while (end < text.length && DOMAIN_CHAR.test(text[end])) end++;
  // A sentence's full stop, or a dash after the address, isn't part of it.
  while (end > at + 1 && (text[end - 1] === "." || text[end - 1] === "-")) {
    end--;
  }
  if (start > 0 && GLUED_BEFORE_EMAIL.test(text[start - 1])) return at + 1;
  const address = text.slice(start, end);
  if (!isEmail(address)) return at + 1;
  // As a link, through the one check (an address too long to be one stays text).
  const href = mailtoHref(`mailto:${address}`);
  if (!href) return at + 1;
  found.push({ start, end, href, kind: "email" });
  return end;
}

/**
 * "user@example.org" (isEmailAddress, link-url.ts), its domain first
 * measured against DNS's limits as typed (hostFits), before anything else
 * reads it.
 */
function isEmail(address: string): boolean {
  const at = address.indexOf("@");
  if (at <= 0 || at !== address.lastIndexOf("@")) return false;
  if (!hostFits(address, at + 1, address.length)) return false;
  return isEmailAddress(address);
}

/**
 * Where an address typed in `text[start, end)` really ends: trailing
 * punctuation and closing brackets without a partner inside it come off,
 * as often as they appear ("…/page).", "…_(planet))"). Bracket counts are
 * kept as it goes, so a long run of them stays linear.
 */
function trimEnd(text: string, start: number, end: number): number {
  const open: Record<string, number> = { "(": 0, "[": 0, "{": 0 };
  const close: Record<string, number> = { ")": 0, "]": 0, "}": 0 };
  for (let i = start; i < end; i++) {
    const char = text[i];
    if (char in open) open[char]++;
    else if (char in close) close[char]++;
  }
  while (end > start) {
    const char = text[end - 1];
    const opener = CLOSE_TO_OPEN[char];
    if (TRAILING.has(char)) {
      end--;
    } else if (opener && close[char] > open[opener]) {
      close[char]--;
      end--;
    } else {
      break;
    }
  }
  return end;
}

/**
 * A paragraph's inline content with its addresses as link runs. The text
 * nodes' own text is searched as one, so an address that is bold for part
 * of its length is still one link; a line break ends an address. Content
 * without an address comes back as the same array, so it renders exactly
 * as it did before quick links.
 */
export function linkifyInline(
  content: readonly RtInline[]
): readonly LinkedInline[] {
  const joined = content
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
  const links = findLinks(joined);
  if (!links.length) return content;

  const out: LinkedInline[] = [];
  let run: RtLinkRun | null = null;
  let linkIndex = 0;
  let offset = 0;
  for (const node of content) {
    if (node.type !== "text") {
      out.push(node);
      offset += 1;
      continue;
    }
    let from = 0;
    while (from < node.text.length) {
      const at = offset + from;
      const link: FoundLink | undefined = links[linkIndex];
      if (link && at >= link.start) {
        // Inside a link: up to its end, or this node's.
        const to = Math.min(node.text.length, link.end - offset);
        if (!run) {
          run = { type: "link", href: link.href, kind: link.kind, content: [] };
          out.push(run);
        }
        run.content.push(piece(node, from, to));
        from = to;
        if (offset + from >= link.end) {
          run = null;
          linkIndex++;
        }
      } else {
        // Before the next link, or after the last one.
        const to = link
          ? Math.min(node.text.length, link.start - offset)
          : node.text.length;
        out.push(piece(node, from, to));
        from = to;
      }
    }
    offset += node.text.length;
  }
  return out;
}

/** Part of a text node, keeping its marks; the whole node when it's all. */
function piece(node: RtText, from: number, to: number): RtText {
  if (from === 0 && to === node.text.length) return node;
  const text = node.text.slice(from, to);
  return node.marks ? { type: "text", text, marks: node.marks } : { type: "text", text };
}
