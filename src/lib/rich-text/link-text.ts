import { MAX_LABEL_CHARS, beyondDns, hostAfterUser, punycodeEncode } from "./link-host";
import { checkLinkHref, emailAddressOf, isEmailAddress, isSafeLinkHost } from "./link-url";
import { MOST_SUFFIX_LABELS, TOP_LEVEL_DOMAINS, publicSuffixLength, registrableDomain } from "./top-level-domains";

/**
 * What a link's words say, against where it goes (D104, D107): the text a
 * named link shows in a lesson, and the title of a further-reading link.
 *
 * - linkTextProblem: the text shows nothing, or shows an address that
 *   points somewhere else than the link opens ("https://bank.example"
 *   opening another site). A refusal, wherever links are made: the
 *   sanitizer, the Link form, paste, and the further-reading actions.
 *   (addressesShown and showsAnotherAddress are its two halves, for a text
 *   compared with several links; showsAnotherAddressOverAny compares it
 *   with them all at once.)
 * - linkTextWarnings: words that don't say where the link goes ("click
 *   here"), or text too long to follow with a screen reader. The Link form's
 *   warnings only, never refusals.
 * - toLinkInput: what an author typed into an address field, completed (a
 *   bare email address or host) and unwrapped (an Outlook safe link, a
 *   Google redirect) before it is checked. The form's only: the server never
 *   guesses, and checkLinkHref itself requires the scheme.
 *
 * Learners see the site every named link opens, in a box after its words
 * (link-site.ts; the owner's decision of 22 October 2026, which amends
 * D104 and D105): the box says where a link goes, whatever its words say.
 * This rule refuses only words that show, by their look, an address of
 * another site. Words show an address where they show
 * - a name after a scheme ("https://", "ftp:", "hxxps://") or after two
 *   slashes at a word's start ("//paypal.com");
 * - a name of three labels or more that starts with "www.";
 * - a name a path, a query, a fragment or a port follows
 *   ("bank.example/login", "bank.example:8443");
 * - an email address ("help@bank.example");
 * - a name of Latin letters ending in a common top-level domain in lower
 *   case (COMMON_TOP_LEVEL_DOMAINS: "paypal.com", "PayPal.com", "bpb.de");
 * and words show somewhere else, whatever the link opens, where they show a
 * user name before a host after a scheme ("https://paypal.com@evil.example")
 * or a label that mixes Latin letters with Greek or Cyrillic ones
 * ("pаypal.com", with a Cyrillic а).
 *
 * Text is read as learners see it: in normal form (NFC), without the
 * characters that show nothing, without a combining mark left over (one
 * that joins no letter in normal form, as a low line under a letter), and
 * with the full stops the URL parser reads as dots (ideographic, fullwidth
 * and halfwidth ideographic) read as dots; then once more as compatibility
 * normalisation (NFKC) shows it (fullwidth, circled and raised letters,
 * Roman numerals: "paypal.ⅽom" with the numeral ⅽ), a sign it makes a word
 * of read as nothing ("Moodle™.org" is moodle.org). A name is read in the
 * letters of ASCII, Latin-1, Latin Extended-A and -B, Greek and Cyrillic, by
 * their code points, so every engine reads the same characters as a name's;
 * any other character ends a name. A name inside a path belongs to it
 * ("docs/report.de"), as does one in an address's path, query or fragment,
 * to its word's end ("https://web.archive.org/web/2020/https://example.org"),
 * and a last label that starts with a top-level domain and a hyphen ends the
 * name there ("www.ams.at-Seite" is www.ams.at).
 *
 * Not refused, and shown by the box: a name in capitals or title case
 * ("ASP.NET", "Modul 3.IT"), one ending in any other top-level domain
 * ("course-materials.zip", "README.md"), titles and abbreviations ("Dr.in",
 * "M.Sc."), and words that name no site at all.
 *
 * Addresses are compared by site (D104, the owner's decision of 22 October
 * 2026): the registrable domain of a host by the ICANN section of the
 * Public Suffix List, one leading "www." removed (top-level-domains.ts), so
 * "europa.eu" shown over a link to ec.europa.eu shows the link's site. A
 * host shown that holds a common top-level domain in front of its site
 * shows that name too ("paypal.com.evil.example" shows paypal.com), in an
 * email address's domain as well. A public suffix named by itself ("gov.gr",
 * "GOV.UK") shows every site under it; with a scheme, "www.", a path or a
 * port it is that host. An email address shown over an email link is
 * compared by its mailbox.
 *
 * Pure, like link-url.ts. A text is read in time in proportion to its
 * length: a label longer than DNS allows (more than MAX_LABEL_CHARS
 * characters, every one counted) is no host's, and stands for itself
 * rather than being written in punycode. What it shows is compared with its
 * links in time that follows the number of addresses shown and of links,
 * each site looked up once.
 */

export type LinkTextProblem = "empty" | "misleading";
export type LinkTextWarning = "vague" | "long";

/** Link text over this many characters gets the "long" warning. */
export const LONG_LINK_TEXT = 100;

/**
 * The top-level domains a bare name is read by ("paypal.com", "bpb.de"):
 * the generic ones and those of the partners' countries and their
 * neighbours, as hosts are written (lower case). Not "pl", which ends Perl
 * scripts' names ("script.pl").
 */
export const COMMON_TOP_LEVEL_DOMAINS: ReadonlySet<string> = new Set([
  // Generic.
  "com", "net", "org", "edu", "gov", "int", "info", "biz", "io", "app", "eu",
  // Countries.
  "de", "at", "ch", "gr", "cy", "uk", "fr", "it", "es", "nl", "be", "pt", "ie", "se", "dk", "fi", "cz", "ro", "bg",
  "hu", "sk", "si", "hr", "lu", "mt", "lt", "lv", "ee", "li", "no", "ru", "ua", "us", "ca", "au",
]);

// The letters a name is read in, by code point: ASCII letters and digits,
// Latin-1, Latin Extended-A and -B, Greek and Cyrillic (not their marks).
const LETTERS = "A-Za-z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0386\\u0388-\\u03FF\\u0400-\\u0482\\u048A-\\u04FF";
// A run of a name's letters, dots and hyphens: one class, so a text is
// scanned once, without backtracking.
const NAME_RUN = new RegExp(`[${LETTERS}.-]+`, "g");
// A character of an email address's first part.
const LOCAL_CHAR = new RegExp(`[${LETTERS}._%+-]`);
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
// Combining marks NFC leaves over: none joins the letter before it.
const LEFTOVER_MARKS = /[\u0300-\u036F]/g;
// The full stops the URL parser reads as dots: ideographic, fullwidth, halfwidth ideographic.
const IDNA_DOTS = /[\u3002\uFF0E\uFF61]/g;
// A sign that compatibility normalisation makes a word of ("™" is "TM", "℡" is "TEL").
const SIGN = /\p{S}/gu;
const WORD_OF_TWO = /^\p{L}{2,}$/u;
const ASCII_ONLY = /^[\x00-\x7F]*$/;
const ASCII_LETTERS = /^[a-z]+$/;
const LATIN = /[A-Za-z\u00C0-\u024F]/;
const GREEK_OR_CYRILLIC = /[\u0386-\u03FF\u0400-\u04FF]/;
const LATIN_NAME = /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F.-]+$/;
// Before a name: a scheme, its colon and any slashes ("https://", "ftp:", "hxxps:/").
const SCHEME_BEFORE = /(?:^|[^A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:[/\\]*$/;
// Before a name: two slashes at a word's start ("//paypal.com").
const SLASHES_AT_WORD_START = /(?:^|[\s(["'<])[/\\]{2}$/;
// Before a name: a path's slash after a word ("docs/report.de").
const IN_PATH = /[A-Za-z0-9._~%-][/\\]$/;
// After a name: its path, query, fragment or port.
const PATH_AFTER = /^(?:[/\\?#]|:\d)/;
// After a name: an "@" and more ("paypal.com@evil.example": a user name, or an email address's first part).
const AT_AFTER = /^@\S/;
const WORD_END = /[\s<>"`]/;
// A top-level domain as the URL parser writes one: letters, or punycode.
const TOP_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Characters before a name looked at for a scheme or a path's slash. */
const LOOK_BEHIND = 24;

/** `text` as learners see it (see the module's note): its first reading, before compatibility normalisation. */
export function visibleLinkText(text: string): string {
  return text.normalize("NFC").replace(INVISIBLE, "").replace(LEFTOVER_MARKS, "");
}

/** A sign read as nothing when compatibility normalisation makes a word of it (see SIGN); any other character as itself. */
const signAsNothing = (sign: string) => (WORD_OF_TWO.test(sign.normalize("NFKC")) ? "" : sign);

/** The readings of `text`: as learners see it, IDNA dots read as dots, and as compatibility normalisation shows that (once when the same). */
function readingsOf(text: string): string[] {
  const seen = visibleLinkText(text).replace(IDNA_DOTS, ".");
  const compatible = seen.replace(SIGN, signAsNothing).normalize("NFKC");
  return compatible === seen ? [seen] : [seen, compatible];
}

/**
 * A label as the URL parser writes it: lower case, in punycode ("xn--…")
 * when not ASCII. A label longer than DNS allows, counting every
 * character, is no host's: "xn--" and the label itself, which no host the
 * address check accepts can be, written without the cost of punycode.
 */
function asciiLabel(label: string): string {
  const lower = label.toLowerCase();
  if (ASCII_ONLY.test(lower)) return lower;
  return longerThan(lower, MAX_LABEL_CHARS) ? `xn--${lower}` : `xn--${punycodeEncode(lower)}`;
}

/** Does `text` hold more than `most` characters (code points, a surrogate pair one)? Read up to that many. */
function longerThan(text: string, most: number): boolean {
  if (text.length <= most) return false;
  let chars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    if (++chars > most) return true;
  }
  return false;
}

/** A domain as the URL parser writes it (asciiLabel, label by label): an email link's domain as D104 compares it, and as its box shows it (link-site.ts). */
export const asciiDomain = (domain: string) => domain.split(".").map(asciiLabel).join(".");

/** A host shown: its name without one leading "www.", and whether it was read only by its top-level domain (`named`: no scheme, "www.", path or port). */
export interface ShownHost {
  readonly host: string;
  readonly named: boolean;
}

/** The addresses a text shows, as compared with a link (see addressesShown). */
export interface ShownAddresses {
  /** The web hosts shown, as the URL parser writes them, and the names a host shows in front of its site. */
  readonly web: readonly ShownHost[];
  /** The email addresses shown, in lower case, their domains as the URL parser writes them. */
  readonly email: readonly string[];
  /** A user name before a host, or a label mixing Latin with Greek or Cyrillic letters: somewhere else, whatever the link. */
  readonly elsewhere: boolean;
}

// What a text shows as it is read, and the names in front of the site of each
// host it shows (namesInFront), found once a host.
type Shown = { web: ShownHost[]; email: string[]; elsewhere: boolean; fronts: Map<string, string[]> };

/**
 * The names in a run of name characters (NAME_RUN) that starts at `at`:
 * its parts between two dots or more, without dots and hyphens at either
 * end, those with a dot inside. Each with where it starts.
 */
function namesIn(run: string, at: number): [string, number][] {
  const names: [string, number][] = [];
  let start = 0;
  while (start < run.length) {
    let end = run.indexOf("..", start);
    if (end < 0) end = run.length;
    let from = start;
    while (from < end && (run[from] === "." || run[from] === "-")) from++;
    let to = end;
    while (to > from && (run[to - 1] === "." || run[to - 1] === "-")) to--;
    const dot = run.indexOf(".", from);
    if (dot >= 0 && dot < to) names.push([run.slice(from, to), at + from]);
    start = end;
    while (start < run.length && run[start] === ".") start++;
  }
  return names;
}

/** The first part of an email address whose "@" is at `at` in `text`: the characters of one right before it. */
function localPartBefore(text: string, at: number): string {
  let from = at;
  while (from > 0 && LOCAL_CHAR.test(text[from - 1])) from--;
  return text.slice(from, at);
}

/**
 * The names a host shows in front of its site, each as its own site: one
 * per label of a common top-level domain before the site's labels
 * ("paypal.com" in "paypal.com.evil.example"). Its public suffix is looked
 * for over at most the longest rule's labels, so a host is read once.
 */
function namesInFront(host: string): string[] {
  const site = registrableDomain(host);
  if (site === null) return [];
  const labels = host.split(".");
  const inFront = labels.length - site.split(".").length;
  const names: string[] = [];
  for (let k = 1; k < inFront; k++) {
    if (!COMMON_TOP_LEVEL_DOMAINS.has(labels[k])) continue;
    const name = labels.slice(Math.max(0, k + 1 - MOST_SUFFIX_LABELS), k + 1);
    const suffix = publicSuffixLength(name) ?? 1;
    names.push(name.slice(Math.max(0, name.length - suffix - 1)).join("."));
  }
  return names;
}

/** namesInFront of a host a text shows, found once however often the text shows it. */
function frontsOf(shown: Shown, host: string): string[] {
  let names = shown.fronts.get(host);
  if (!names) {
    names = namesInFront(host);
    shown.fronts.set(host, names);
  }
  return names;
}

/** Adds a host shown, and the names it shows in front of its site. */
function addHost(shown: Shown, host: string, named: boolean) {
  const bare = host.startsWith("www.") && host.indexOf(".", 4) > 4 ? host.slice(4) : host;
  shown.web.push({ host: bare, named });
  for (const name of frontsOf(shown, bare)) shown.web.push({ host: name, named: false });
}

/** Where the word that holds `from` ends: the next whitespace, quote or angle bracket. */
function wordEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && !WORD_END.test(text[end])) end++;
  return end;
}

/** Reads one reading of a text into `shown` (see the module's note). */
function readInto(shown: Shown, text: string) {
  // An address's path, query or fragment runs to its word's end: no name in it is read.
  let pathEnd = 0;
  for (const match of text.matchAll(NAME_RUN)) {
    for (const [name, start] of namesIn(match[0], match.index ?? 0)) {
      if (start < pathEnd) continue;
      const before = text.slice(Math.max(0, start - LOOK_BEHIND), start);
      const scheme = SCHEME_BEFORE.test(before) || SLASHES_AT_WORD_START.test(before);
      if (!scheme && IN_PATH.test(before)) continue;
      let token = name;
      // A last label that starts with a top-level domain and a hyphen ends the name there ("www.ams.at-Seite").
      const dot = token.lastIndexOf(".");
      const hyphen = token.indexOf("-", dot);
      if (hyphen > dot && TOP_LEVEL_DOMAINS.has(token.slice(dot + 1, hyphen).toLowerCase())) token = token.slice(0, hyphen);
      const end = start + token.length;
      const after = text.slice(end, end + 2);
      const labels = token.split(".");
      const top = asciiLabel(labels[labels.length - 1]);
      const ipv4 = IPV4.test(token);
      if (!TOP_LABEL.test(top) && !(ipv4 && (scheme || PATH_AFTER.test(after)))) continue;
      if (AT_AFTER.test(after)) {
        // With a scheme, a user name ("https://paypal.com@evil.example"); else an email address's first part.
        if (scheme) shown.elsewhere = true;
        continue;
      }
      if (labels.some((label) => LATIN.test(label) && GREEK_OR_CYRILLIC.test(label))) {
        shown.elsewhere = true;
        continue;
      }
      const host = labels.map(asciiLabel).join(".");
      if (before.endsWith("@")) {
        const local = localPartBefore(text, start - 1);
        if (local && TOP_LEVEL_DOMAINS.has(top)) {
          shown.email.push(`${local.toLowerCase()}@${host}`);
          for (const inFront of frontsOf(shown, host)) shown.web.push({ host: inFront, named: false });
        }
        continue;
      }
      const www = labels.length >= 3 && labels[0].toLowerCase() === "www";
      const path = PATH_AFTER.test(after);
      const sure = scheme || www || path;
      if (!sure) {
        const written = labels[labels.length - 1];
        const named = ASCII_LETTERS.test(top) && LATIN_NAME.test(token) && COMMON_TOP_LEVEL_DOMAINS.has(top) && written === top;
        if (!named) continue;
      }
      addHost(shown, host, !sure);
      if (path) pathEnd = wordEnd(text, end);
    }
  }
}

/** The addresses `text` shows (see the module's note), read once; null when it shows none. */
export function addressesShown(text: string): ShownAddresses | null {
  const shown: Shown = { web: [], email: [], elsewhere: false, fronts: new Map() };
  for (const reading of readingsOf(text)) readInto(shown, reading);
  const { web, email, elsewhere } = shown;
  return web.length || email.length || elsewhere ? { web, email, elsewhere } : null;
}

/** Is `host` a public suffix ("gov.gr", "co.uk")? */
function isPublicSuffix(host: string): boolean {
  const labels = host.split(".");
  return publicSuffixLength(labels) === labels.length;
}

/**
 * Does every host shown go to the site of every link's host (all as the URL
 * parser writes them, one leading "www." removed)? A host shown goes to a
 * link's host that is it, or is under it ("zoom.us" over us02web.zoom.us),
 * or has its registrable domain. A public suffix named by itself goes to
 * every host under it, and shown with a scheme, "www.", a path or a port to
 * itself only.
 *
 * Each host's site is looked up once (`siteOfLink` holds the links'), and
 * each host shown is compared with all the links' hosts at once: those of
 * its site are counted together, and each link's host adds the hosts shown
 * it is or ends in after a dot. So the cost follows the number of hosts
 * shown and links, never their product.
 */
function allSameSite(shown: readonly ShownHost[], linkHosts: ReadonlySet<string>, siteOfLink: ReadonlyMap<string, string | null>): boolean {
  if (!shown.length || !linkHosts.size) return true;
  const linksOfSite = new Map<string, number>();
  for (const host of linkHosts) {
    const site = siteOfLink.get(host) ?? null;
    if (site !== null) linksOfSite.set(site, (linksOfSite.get(site) ?? 0) + 1);
  }
  // Each host shown once with each way it was shown, and how many links' hosts it goes to.
  type Compared = { named: boolean; suffix: boolean; site: string | null; goesTo: number };
  const byHost = new Map<string, Compared[]>();
  const lengths = new Set<number>();
  for (const { host, named } of shown) {
    const same = byHost.get(host);
    if (same?.some((compared) => compared.named === named)) continue;
    const suffix = isPublicSuffix(host);
    const site = suffix ? null : registrableDomain(host);
    const compared = { named, suffix, site, goesTo: site === null ? 0 : (linksOfSite.get(site) ?? 0) };
    if (same) same.push(compared);
    else byHost.set(host, [compared]);
    lengths.add(host.length);
  }
  for (const host of linkHosts) {
    const linkSite = siteOfLink.get(host) ?? null;
    // The host itself, then what follows each of its dots.
    for (let from = 0; ; ) {
      if (lengths.has(host.length - from)) {
        for (const compared of byHost.get(from ? host.slice(from) : host) ?? []) {
          // A link's host of the site shown is counted above.
          const goes = compared.suffix ? compared.named || from === 0 : compared.site === null || compared.site !== linkSite;
          if (goes) compared.goesTo++;
        }
      }
      const dot = host.indexOf(".", from);
      if (dot < 0) break;
      from = dot + 1;
    }
  }
  for (const all of byHost.values()) {
    if (all.some((compared) => compared.goesTo !== linkHosts.size)) return false;
  }
  return true;
}

/**
 * Do the addresses shown (addressesShown) point somewhere else than `href`?
 * Over an email link, an email address shown of another mailbox, or a host
 * shown of another site than its domain's; over a web link, a host or an
 * email domain shown of another site (allSameSite). A user name or a mixed
 * label shown (`elsewhere`), and an `href` the address check refuses,
 * count every address shown as somewhere else.
 */
export function showsAnotherAddress(shown: ShownAddresses | null, href: string): boolean {
  return showsAnotherAddressOverAny(shown, [href]);
}

/**
 * Do the addresses shown point somewhere else than any of `hrefs`
 * (showsAnotherAddress of each, for a text read over several links: links
 * that touch)? Each address is checked once however often it is given, and
 * each host's site is looked up once, so the cost follows the number of
 * addresses shown and of links, never their product. False for no link.
 */
export function showsAnotherAddressOverAny(shown: ShownAddresses | null, hrefs: Iterable<string>): boolean {
  const links = new Set(hrefs);
  if (!shown || !links.size) return false;
  if (shown.elsewhere) return true;
  // Every link's host (a web link's, or an email link's domain), the web links' hosts, and the email links' mailboxes as compared.
  const linkHosts = new Set<string>();
  const webHosts = new Set<string>();
  const mailboxes = new Set<string>();
  for (const href of links) {
    const check = checkLinkHref(href);
    if (!check.ok) return true;
    const mailbox = emailAddressOf(check.href)?.toLowerCase() ?? null;
    const at = mailbox?.lastIndexOf("@") ?? -1;
    const linkDomain = mailbox ? asciiDomain(mailbox.slice(at + 1)) : new URL(check.href).hostname;
    const linkHost = linkDomain.startsWith("www.") && linkDomain.indexOf(".", 4) > 4 ? linkDomain.slice(4) : linkDomain;
    linkHosts.add(linkHost);
    if (mailbox) mailboxes.add(`${mailbox.slice(0, at)}@${linkDomain}`);
    else webHosts.add(linkHost);
  }
  // Over an email link, only its own mailbox.
  if (mailboxes.size && shown.email.length && (mailboxes.size > 1 || shown.email.some((address) => !mailboxes.has(address)))) {
    return true;
  }
  const siteOfLink = new Map<string, string | null>();
  for (const host of linkHosts) siteOfLink.set(host, registrableDomain(host));
  const emailDomains = shown.email.map((address) => ({ host: address.slice(address.lastIndexOf("@") + 1), named: true }));
  if (webHosts.size && !allSameSite(emailDomains, webHosts, siteOfLink)) return true;
  return !allSameSite(shown.web, linkHosts, siteOfLink);
}

/**
 * "empty" when `text` shows nothing (blank, or only characters that show
 * nothing); "misleading" when it shows an address that points somewhere
 * else than `href` (showsAnotherAddress). Else null.
 */
export function linkTextProblem(text: string, href: string): LinkTextProblem | null {
  if (!visibleLinkText(text).trim()) return "empty";
  return showsAnotherAddress(addressesShown(text), href) ? "misleading" : null;
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
 * Anything else comes back as typed (trimmed), for checkLinkHref to judge:
 * an address whose host DNS can't hold (beyondDns) without being parsed.
 */
export function toLinkInput(raw: string): string {
  let typed = raw.trim();
  if (!typed) return typed;
  if (isEmailAddress(typed)) return `mailto:${typed}`;
  if (!SCHEME.test(typed) && BARE_HOST.test(typed)) typed = `https://${typed}`;
  if (!/^https?:\/\//i.test(typed) || beyondDns(hostAfterUser(typed))) return typed;
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
