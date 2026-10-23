import { checkLinkHref, comparableHost, emailAddressOf, standardPath } from "./link-url";
import { asciiDomain } from "./link-text";
import { registrableDomain } from "./top-level-domains";

/**
 * The site a named link opens, as learners see it after the link's words
 * (the owner's decision of 22 October 2026; D104, D105): a small box inside
 * the link, so every named link says where it goes, whatever its words say,
 * and screen readers hear it with the link ("the guide, example.org (opens
 * in a new tab)"). RichTextView draws it.
 *
 * - linkSite: what the box says. The link's site as D104 compares sites:
 *   the host the URL parser gives, without one leading "www.", taken to its
 *   registrable domain by the ICANN section of the Public Suffix List
 *   (top-level-domains.ts: "en.wikipedia.org" → "wikipedia.org",
 *   "www.bbc.co.uk" → "bbc.co.uk", "www.gov.gr" → "gov.gr"). Where no
 *   registrable domain can be told (an IP address, a host under a top-level
 *   domain whose rules aren't all listed: it, jp, no, pl, us), the host
 *   itself, as D104 then compares it. An email link's site is its
 *   address's domain's, told the same way, the domain as D104 compares it
 *   (lower case, in punycode: asciiDomain): "support@paypal.com.evil.example"
 *   → "evil.example". Always ASCII: an international name in punycode
 *   ("xn--…"), so a look-alike name shows what it is. Every box therefore
 *   ends the host the browser opens, or the domain the mail goes to, at a
 *   dot. None for an address the check refuses (never drawn as a link).
 *   Our own file store's links show their site like any other.
 * - textIsSite: whether the box is left out, because the link's words, as a
 *   whole, already are its address. A web link's: the whole text, trimmed,
 *   is the link's address with or without its scheme (the link's own), one
 *   leading "www.", or one trailing slash, its host in any letter case
 *   ("example.org/guide", "https://www.Example.org/guide/"). An email
 *   link's: the whole text, trimmed, is its bare address, with or without
 *   "mailto:", in any letter case ("help@example.org"). Words that begin
 *   with the address and go on, that name the site of a longer address, or
 *   hold anything but printable ASCII (an international name, an invisible
 *   or right-to-left character) keep the box.
 * - linkWords: a named link's words as they are drawn before the box. Each
 *   run of characters that draw nothing but take room in a line
 *   (whitespace, the braille blank, the Hangul fillers, the interlinear
 *   annotation marks), with whatever shows nothing among them, is drawn as
 *   one space, across the link's bold and italic parts too; one space, one
 *   no-break space or one narrow no-break space stays as typed. So no blank
 *   in a link's words pushes its box away from the words learners read,
 *   below the screen or past an imitation of a box. Every other character
 *   is drawn as typed.
 *
 * Pure: no DOM, no server imports. Each runs in time in proportion to its
 * input (the address check bounds an address at 2,048 characters, and a
 * host or an email address's domain at what DNS holds).
 */

/** "www." removed once, unless that would leave no dot ("www.com" stays). */
function withoutWww(host: string): string {
  return host.startsWith("www.") && host.indexOf(".", 4) > 4 ? host.slice(4) : host;
}

/** The site of a host (ASCII, as compared): without one leading "www.", its registrable domain, else itself. */
function siteOf(host: string): string {
  const bare = withoutWww(host);
  return registrableDomain(bare) ?? bare;
}

/** The site a link opens, for the box after its words; null for none. */
export function linkSite(href: string): string | null {
  const check = checkLinkHref(href);
  if (!check.ok) return null;
  if (check.kind === "email") {
    const address = emailAddressOf(check.href);
    return address === null ? null : siteOf(asciiDomain(address.slice(address.lastIndexOf("@") + 1)));
  }
  return siteOf(comparableHost(new URL(check.href).hostname));
}

// Printable ASCII, no space: anything else can't spell an address as the
// URL parser writes it.
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

/** The address after its host, as compared: one trailing slash removed. */
const rest = (tail: string) => (tail.endsWith("/") ? tail.slice(0, -1) : tail);

/** Are the link's words, as a whole, its address (so the box would repeat it)? */
export function textIsSite(text: string, href: string): boolean {
  const check = checkLinkHref(href);
  if (!check.ok) return false;
  const words = text.trim();
  if (!PRINTABLE_ASCII.test(words)) return false;
  if (check.kind === "email") {
    const address = emailAddressOf(check.href);
    return address !== null && words.replace(/^mailto:/i, "").toLowerCase() === address.toLowerCase();
  }
  const url = new URL(check.href);
  let address = words;
  const scheme = /^https?:\/\//i.exec(address)?.[0];
  if (scheme) {
    if (scheme.toLowerCase() !== `${url.protocol}//`) return false;
    address = address.slice(scheme.length);
  }
  const end = address.search(/[/?#]/);
  const host = end < 0 ? address : address.slice(0, end);
  const tail = end < 0 ? "" : address.slice(end);
  const linkHost = comparableHost(url.hostname) + (url.port ? `:${url.port}` : "");
  if (withoutWww(host.toLowerCase()) !== withoutWww(linkHost)) return false;
  return rest(tail) === rest(standardPath(url.pathname) + url.search + url.hash);
}

// Characters that draw nothing but take room in a line, in the fonts
// browsers draw lesson text with: whitespace (spaces of every width, the
// ideographic space), the braille blank, the Hangul fillers and the
// interlinear annotation marks.
const BLANK = "\\p{White_Space}\\u115F\\u1160\\u2800\\u3164\\uFFA0\\uFFF9-\\uFFFB";
// A run of them, with whatever shows nothing among them (zero-width
// characters, joiners, variation selectors, a soft hyphen): one class
// after the first, so a scan never backtracks (linear time).
const BLANK_RUN = new RegExp(`[${BLANK}][${BLANK}\\p{Default_Ignorable_Code_Point}]*`, "gu");
// The rest of a run a part before began.
const RUN_GOES_ON = new RegExp(`^[${BLANK}\\p{Default_Ignorable_Code_Point}]*`, "u");
// What ends a part in a run.
const ENDS_IN_RUN = new RegExp(`[${BLANK}][${BLANK}\\p{Default_Ignorable_Code_Point}]*$`, "u");
/** A blank kept as typed when it stands alone: a space, a no-break space, a narrow no-break space. */
const KEPT_ALONE = new Set([" ", " ", " "]);

/** A named link's words, part by part (its bold and italic runs), as drawn before its box. */
export function linkWords(parts: readonly string[]): string[] {
  let inRun = false;
  return parts.map((part) => {
    const words = (inRun ? part.replace(RUN_GOES_ON, "") : part).replace(BLANK_RUN, (run) =>
      KEPT_ALONE.has(run) ? run : " "
    );
    if (words) inRun = ENDS_IN_RUN.test(words);
    return words;
  });
}
