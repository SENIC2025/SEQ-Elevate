import { findLinks } from "./linkify";
import { checkLinkHref, emailAddressOf, isEmailAddress, isSafeLinkHost } from "./link-url";

/**
 * What a link's words say, against where it goes (D104, D107): the text a
 * named link shows in a lesson, and the title of a further-reading link.
 *
 * - linkTextProblem: the text is blank, or shows an address that points
 *   somewhere else than the link opens ("https://bank.example" opening
 *   another site). A refusal, wherever links are made: the sanitizer, the
 *   Link form, paste, and the further-reading actions.
 * - linkTextWarnings: words that don't say where the link goes ("click
 *   here"), or text too long to follow with a screen reader. The Link form's
 *   warnings only, never refusals.
 * - toLinkInput: what an author typed into an address field, completed (a
 *   bare email address or host) and unwrapped (an Outlook safe link, a
 *   Google redirect) before it is checked. The form's only: the server never
 *   guesses, and checkLinkHref itself requires the scheme.
 *
 * Pure, like link-url.ts.
 */

export type LinkTextProblem = "empty" | "misleading";
export type LinkTextWarning = "vague" | "long";

/** Link text over this many characters gets the "long" warning. */
export const LONG_LINK_TEXT = 100;

/**
 * The site of an address, as compared here: the host of a web address or
 * the domain of an email address, through the URL parser (so an
 * international name and its punycode are equal), in lower case, without a
 * trailing dot or one leading "www.". Null when it has none.
 */
function siteOf(host: string): string | null {
  let name: string;
  try {
    name = new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
  name = name.toLowerCase().replace(/\.$/, "");
  return name.startsWith("www.") ? name.slice(4) : name;
}

/** Where an address goes: a mailbox (email) or a site (web). */
type Target = { kind: "email"; mailbox: string; site: string | null } | { kind: "web"; site: string | null };

function targetOf(href: string): Target | null {
  const mailbox = emailAddressOf(href);
  if (mailbox !== null) {
    return { kind: "email", mailbox: mailbox.toLowerCase(), site: siteOf(mailbox.slice(mailbox.indexOf("@") + 1)) };
  }
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    return { kind: "web", site: siteOf(new URL(href).hostname) };
  } catch {
    return null;
  }
}

/** Does an address shown in the text (`shown`) point somewhere else than `link`? */
function pointsElsewhere(shown: Target, link: Target): boolean {
  if (shown.kind === "email" && link.kind === "email") return shown.mailbox !== link.mailbox;
  return shown.site === null || link.site === null || shown.site !== link.site;
}

/**
 * "empty" when `text` is blank; "misleading" when it shows an address (as a
 * quick link would find it) that points somewhere else than `href`: another
 * mailbox, for an email address shown over an email link; another site, in
 * every other pairing. Else null. An `href` that isn't a web or email
 * address counts every address shown as somewhere else.
 */
export function linkTextProblem(text: string, href: string): LinkTextProblem | null {
  if (!text.trim()) return "empty";
  const shown = findLinks(text);
  if (!shown.length) return null;
  const link = targetOf(href);
  for (const found of shown) {
    const target = targetOf(found.href);
    if (!link || !target || pointsElsewhere(target, link)) return "misleading";
  }
  return null;
}

/**
 * Link text that says nothing about where it goes, in English, German and
 * Greek, as compared (see vagueKey).
 */
const VAGUE = [
  // en
  "click here", "here", "link", "more", "read more", "learn more", "this", "this link",
  // de
  "hier", "hier klicken", "klicken Sie hier", "klick hier", "mehr", "mehr erfahren", "weiterlesen", "Link", "dieser Link",
  // el
  "εδώ", "κλικ εδώ", "πατήστε εδώ", "πάτα εδώ", "κάντε κλικ εδώ", "περισσότερα", "διαβάστε περισσότερα",
];

const TRAILING = /[\s\p{P}]/u;

/**
 * Text as compared with the vague list: accents removed (NFD without
 * combining marks), lower case, spaces collapsed, and trailing punctuation
 * and spaces removed, so "ΕΔΩ" and "Hier!" match.
 */
function vagueKey(text: string): string {
  const key = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  let end = key.length;
  while (end > 0 && TRAILING.test(key[end - 1])) end--;
  return key.slice(0, end);
}

const VAGUE_KEYS = new Set(VAGUE.map(vagueKey));
/** Longer text is never one of the vague words, whatever punctuation follows. */
const VAGUE_MAX = 60;

/** The Link form's warnings for `text`: "vague" and "long" (never refusals). */
export function linkTextWarnings(text: string): LinkTextWarning[] {
  const out: LinkTextWarning[] = [];
  if (text.trim().length <= VAGUE_MAX && VAGUE_KEYS.has(vagueKey(text))) out.push("vague");
  if (text.trim().length > LONG_LINK_TEXT) out.push("long");
  return out;
}

/** A scheme at the start ("javascript:", "tel:"); a host's port ("example.org:8080") isn't one. */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
/** A bare host, maybe with a port, a path, a query or a fragment: "www.bpb.de/x". */
const BARE_HOST = /^[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)+\.?(?::\d+)?(?:[/?#]\S*)?$/u;

/** Google's redirect: www.google.com/url?q=… (or url=…). */
function googleTarget(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((host !== "www.google.com" && host !== "google.com") || url.pathname !== "/url") return null;
  return url.searchParams.get("q") ?? url.searchParams.get("url");
}

/**
 * What an author typed into an address field, as the Link form checks it:
 * - spaces at either end trimmed;
 * - a bare email address gains "mailto:", a bare host ("www.bpb.de/x", no
 *   scheme, a dot, no spaces) "https://";
 * - an Outlook safe link or a Google redirect becomes its target, decoded,
 *   when that target passes checkLinkHref; otherwise it stays as typed (a
 *   safe link is then refused by checkLinkHref, as "redirect").
 * Anything else comes back as typed (trimmed), for checkLinkHref to judge.
 */
export function toLinkInput(raw: string): string {
  let typed = raw.trim();
  if (!typed) return typed;
  if (isEmailAddress(typed)) return `mailto:${typed}`;
  if (!SCHEME.test(typed) && BARE_HOST.test(typed)) typed = `https://${typed}`;
  if (!/^https?:\/\//i.test(typed)) return typed;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return typed;
  }
  const wrapped = isSafeLinkHost(url.hostname) ? url.searchParams.get("url") : googleTarget(url);
  if (wrapped && checkLinkHref(wrapped).ok) return wrapped.trim();
  return typed;
}
