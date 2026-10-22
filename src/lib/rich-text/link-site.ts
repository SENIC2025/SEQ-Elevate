import { checkLinkHref, comparableHost } from "./link-url";
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
 *   itself, as D104 then compares it. Always ASCII: an international name in
 *   punycode ("xn--…"), as the URL parser writes it, so a look-alike name
 *   shows what it is. Every box therefore ends the host the browser opens,
 *   at a dot. None for an email link (its words are heard with what it
 *   opens) or an address the check refuses (never drawn as a link). Our own
 *   file store's links show their site like any other.
 * - textIsSite: whether the box is left out, because the link's words, as a
 *   whole, already are its address: the whole text, trimmed, is the link's
 *   address with or without its scheme (the link's own), one leading
 *   "www.", or one trailing slash, its host in any letter case
 *   ("example.org/guide", "https://www.Example.org/guide/"). Words that
 *   begin with the address and go on, that name the site of a longer
 *   address, or hold anything but printable ASCII (an international name,
 *   an invisible or right-to-left character) keep the box.
 *
 * Pure: no DOM, no server imports. Each runs in time in proportion to its
 * input (the address check bounds an address at 2,048 characters).
 */

/** "www." removed once, unless that would leave no dot ("www.com" stays). */
function withoutWww(host: string): string {
  return host.startsWith("www.") && host.indexOf(".", 4) > 4 ? host.slice(4) : host;
}

/** The accepted web address `href` is, parsed; null for email links and refused addresses. */
function webAddress(href: string): URL | null {
  const check = checkLinkHref(href);
  return check.ok && check.kind === "web" ? new URL(check.href) : null;
}

/** The site a link opens, for the box after its words; null for none. */
export function linkSite(href: string): string | null {
  const url = webAddress(href);
  if (!url) return null;
  const host = withoutWww(comparableHost(url.hostname));
  return registrableDomain(host) ?? host;
}

// Printable ASCII, no space: anything else can't spell an address as the
// URL parser writes it.
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

/** The address after its host, as compared: one trailing slash removed. */
const rest = (tail: string) => (tail.endsWith("/") ? tail.slice(0, -1) : tail);

/** Are the link's words, as a whole, its address (so the box would repeat it)? */
export function textIsSite(text: string, href: string): boolean {
  const url = webAddress(href);
  if (!url) return false;
  const words = text.trim();
  if (!PRINTABLE_ASCII.test(words)) return false;
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
  return rest(tail) === rest(url.pathname + url.search + url.hash);
}
