import { findLinks, type FoundLink } from "./linkify";
import { beyondDns, hostAfterUser, staysInHost } from "./link-host";
import { checkLinkHref, emailAddressOf, isEmailAddress, isSafeLinkHost } from "./link-url";
import { MOST_SUFFIX_LABELS, PUBLIC_SUFFIX_RULES, TOP_LEVEL_DOMAINS, publicSuffixLength } from "./top-level-domains";
import { UNASSIGNED_CLASS } from "./unassigned";

/**
 * What a link's words say, against where it goes (D104, D107): the text a
 * named link shows in a lesson, and the title of a further-reading link.
 *
 * - linkTextProblem: the text shows nothing, or shows an address that
 *   points somewhere else than the link opens ("https://bank.example"
 *   opening another site). A refusal, wherever links are made: the
 *   sanitizer, the Link form, paste, and the further-reading actions.
 *   (addressesShown and showsAnotherAddress are its two halves, for a text
 *   compared with several links.)
 * - linkTextWarnings: words that don't say where the link goes ("click
 *   here"), or text too long to follow with a screen reader. The Link form's
 *   warnings only, never refusals.
 * - toLinkInput: what an author typed into an address field, completed (a
 *   bare email address or host) and unwrapped (an Outlook safe link, a
 *   Google redirect) before it is checked. The form's only: the server never
 *   guesses, and checkLinkHref itself requires the scheme.
 *
 * A text is read as learners see it (visibleLinkText, readingsOf):
 * characters that show nothing (a hair space among them) don't split an
 * address, compatibility forms (fullwidth letters, a one dot leader, a
 * Roman numeral, a raised or circled letter) read as the characters they
 * show, inside a name or ending it ("rabobank.nⅼ"), a raised sign or a
 * modifier letter after a name ("paypal.com¹", "PayPal.com™",
 * "paypal.comʼs") ends it, and a mark that follows no letter or digit
 * belongs to none and is read as nothing ("paypal.̲com"). A character that
 * Unicode 16 (the server's) doesn't assign is read as a space and as
 * nothing, as a browser of a newer Unicode reads it too (unassigned.ts); a
 * name the URL parser refuses that ends in a top-level domain is read as
 * written ("xn--a.paypal.com"; hostnameOf). So the editor, the save and the
 * page a learner gets give one answer. An address
 * is read wherever a quick link would find one, and also wherever a text
 * shows "https:" or "http:" followed by a host with a dot, whether or not
 * it could be a link (with a user name, as an Outlook safe link, over 2,048
 * characters), and wherever it shows "mailto:" and an email address. A bare
 * host shown in the text ("www.bank.example", "bank.example/login",
 * "paypal.com") is an address of its site too (D104, the owner's decision of
 * 22 October 2026), while an ordinary word with a dot ("v1.2", "e.g.",
 * "M.Sc.", the end of a sentence) is not (addBareHosts). A name is read as
 * it shows in Latin letters, through Cyrillic and Greek look-alikes and
 * marks (readAsLatin); and the first part of an email address shown over a
 * web link is read as a host when it is one by its look (hostInMailbox).
 *
 * Addresses are compared by site (D104, the owner's decision of 22 October
 * 2026): the registrable domain of a host, so "europa.eu" shown over a link
 * to ec.europa.eu shows the link's site, and "paypal.com.evil.example",
 * which shows paypal.com in front, doesn't show evil.example's (Place). A
 * public suffix named by itself ("gov.gr", "GOV.UK") shows every site under
 * it.
 *
 * A name with a label longer than DNS allows (more than 63 letters and
 * digits; beyondDns, link-host.ts) is no host: it is read as the URL parser
 * reads it, without parsing that label whole (hostnameOf), so a text costs
 * time in proportion to its length.
 *
 * Pure, like link-url.ts.
 */

export type LinkTextProblem = "empty" | "misleading";
export type LinkTextWarning = "vague" | "long";

/** Link text over this many characters gets the "long" warning. */
export const LONG_LINK_TEXT = 100;

// Characters that show nothing by default (zero-width and direction marks,
// a soft hyphen, fillers, invisible operators, variation selectors, …), and
// the hair space, too thin to be seen between two letters.
const SHOWS_NOTHING = /[\p{Default_Ignorable_Code_Point}\u200A]/gu;

/**
 * A text as learners see it: without the characters that show nothing, and
 * with compatibility forms as the characters they show (NFKC).
 */
export function visibleLinkText(text: string): string {
  return text.replace(SHOWS_NOTHING, "").normalize("NFKC").replace(SHOWS_NOTHING, "");
}

// Characters that may stand apart from the letters before them though
// compatibility normalisation makes letters or digits of them: a raised or
// lowered one ("¹", "™", "ʰ", "₂"), a circled one, a Roman numeral, a sign
// of letters ("№"); read in runs.
const MAY_STAND_APART = /[\p{S}\p{No}\p{Nl}\p{Lm}ªº]+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const MODIFIER_LETTERS_ONLY = /^\p{Lm}+$/u;
// Spacing modifier letters and modifier tone letters, which show as
// apostrophes, primes and accents ("paypal.comʼs").
const MODIFIER_LETTER = /[\u02B0-\u02FF\uA700-\uA721\uA788]/gu;

/** `char` as an address is read: a space when it stands apart (see MAY_STAND_APART), else itself. */
function standsApart(char: string): string {
  const shown = char.normalize("NFKC");
  if (shown === char || !LETTER_OR_DIGIT.test(shown)) return char;
  // A modifier letter that normalises to another one stays (the halfwidth prolonged sound mark).
  return MODIFIER_LETTERS_ONLY.test(shown) ? char : " ";
}

// The end of a name: a letter, a digit or a mark.
const AFTER_NAME = /[\p{L}\p{N}\p{M}]$/u;
// More of a name: a letter, a digit or a mark, or a dot or a hyphen before one (as they show).
const NAME_GOES_ON = /^(?:[\p{L}\p{N}\p{M}]|[.。-][\p{L}\p{N}])/u;
// A mark that follows no letter or digit: it belongs to none ("paypal.̲com").
const MARKS_OF_NONE = /(^|[^\p{L}\p{N}\p{M}])\p{M}+/gu;
const ANY_CHAR = /[^]/gu;

/** A run of what may stand apart (MAY_STAND_APART), each character read as a space where it stands apart (standsApart). */
const apartOf = (run: string) => run.replace(ANY_CHAR, standsApart);
// One letter, as a character shows it after compatibility normalisation.
const ONE_LETTER_SHOWN = /^\p{L}$/u;
/**
 * The same run read as part of a name: a character that shows one letter
 * as that letter ("ᵒ", "ⓒ", "ⅽ"), and one that stands apart otherwise (a
 * raised digit, a sign of letters: "¹", "™") as nothing.
 */
const lettersOf = (run: string) =>
  run.replace(ANY_CHAR, (char) => (ONE_LETTER_SHOWN.test(char.normalize("NFKC")) ? char : standsApart(char) === " " ? "" : char));

/**
 * Does the run at `at` (`length` long) of `text` end a name: right after
 * one, with nothing of a name after it ("paypal.com¹ ", "PayPal.com™")?
 */
function endsName(text: string, at: number, length: number): boolean {
  return AFTER_NAME.test(text.slice(Math.max(0, at - 2), at)) && !NAME_GOES_ON.test(text.slice(at + length, at + length + 4).normalize("NFKC"));
}

/**
 * `text` (without the characters that show nothing) as learners see it
 * (visibleLinkText), a modifier letter read as a space and each mark of no
 * letter dropped.
 */
const asShown = (text: string) => text.normalize("NFKC").replace(SHOWS_NOTHING, "").replace(MODIFIER_LETTER, " ").replace(MARKS_OF_NONE, "$1");

/**
 * A text as its addresses are read, once to three times: as learners see it
 * (asShown), each run of characters that may stand apart from a name
 * (MAY_STAND_APART) read as a space, as part of the name (lettersOf), and
 * as part of a name inside one and a space where it ends one (endsName).
 * So "paypal.com¹", "PayPal.com™" and "paypal.comʼs" show paypal.com, and
 * so do "paypal.cᵒm", "paypal.ⓒⓞⓜ", "paypaⅼ.com" (a Roman numeral),
 * "PayPal™.com" and "paypal.com¹.evil.example"; "rabobank.nⅼ" and
 * "sparkasse.dᵉ" show rabobank.nl and sparkasse.de.
 */
function readingsOf(text: string): string[] {
  const unseen = text.replace(SHOWS_NOTHING, "");
  const apart = unseen.replace(MAY_STAND_APART, apartOf);
  if (apart === unseen) return [asShown(unseen)];
  const letters = unseen.replace(MAY_STAND_APART, lettersOf);
  const endsApart = unseen.replace(MAY_STAND_APART, (run: string, at: number) => (endsName(unseen, at, run.length) ? apartOf(run) : lettersOf(run)));
  return [...new Set([apart, letters, endsApart])].map(asShown);
}

// A character that Unicode 16, the server's, doesn't assign (unassigned.ts).
const UNASSIGNED = new RegExp(UNASSIGNED_CLASS, "gu");
const HOLDS_UNASSIGNED = new RegExp(UNASSIGNED_CLASS, "u");

/**
 * `text` with each character that Unicode 16 doesn't assign read as a
 * space, and as nothing: once, when it holds none. A browser of a newer
 * Unicode knows some of them, the server none; both read them so.
 */
const placedOf = (text: string): string[] => (HOLDS_UNASSIGNED.test(text) ? [text.replace(UNASSIGNED, " "), text.replace(UNASSIGNED, "")] : [text]);

/**
 * Where a host goes, as compared here (D104, the owner's decision of 22
 * October 2026: sites, not exact hosts):
 * - `site`: its registrable domain ("en.wikipedia.org" → "wikipedia.org",
 *   "www.bbc.co.uk" → "bbc.co.uk"; top-level-domains.ts), or, when that
 *   can't be told (an IP address, a host under a top-level domain whose
 *   rules aren't all known), the host itself;
 * - `host`: the host, without one leading "www.";
 * - `shown`: the names it shows in front of its site that end in a
 *   top-level domain, each by its site ("paypal.com" in
 *   "paypal.com.evil.example"): learners read them as sites too;
 * - `everySite`: a public suffix of more than one label named by itself
 *   ("gov.gr", "GOV.UK", the name of a state's digital services): no one
 *   host, but every site under it (bareHost).
 */
interface Place {
  site: string;
  host: string;
  shown: readonly string[];
  everySite?: true;
}

/** At most this many names in front of a site are read (a host with more is made up). */
const MOST_SHOWN = 4;

/**
 * The top-level domain a label shows a name ending in: the label itself
 * ("com" in "paypal.com.evil.example"), or what comes before its first
 * hyphen ("com" in "paypal.com-login.evil.example"). Null for any other.
 */
function topLevelDomainShown(label: string): string | null {
  if (TOP_LEVEL_DOMAINS.has(label)) return label;
  const hyphen = label.indexOf("-");
  return hyphen > 0 && TOP_LEVEL_DOMAINS.has(label.slice(0, hyphen)) ? label.slice(0, hyphen) : null;
}

/**
 * The place of a hostname the URL parser gave (see Place), one leading
 * "www." removed first (§3.2): www.gov.uk is gov.uk's site.
 */
function placeOf(hostname: string): Place {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  const host = name.startsWith("www.") ? name.slice(4) : name;
  const labels = host.split(".");
  const suffix = IPV4.test(host) || host.startsWith("[") ? null : publicSuffixLength(labels);
  if (suffix === null) return { site: host, host, shown: [] };
  const siteStart = Math.max(0, labels.length - suffix - 1);
  const shown = new Set<string>();
  for (let end = 2; end <= siteStart && shown.size < MOST_SHOWN; end++) {
    const top = topLevelDomainShown(labels[end - 1]);
    if (top === null) continue;
    // Its site: by its public suffix, or its last three labels where that can't be told
    // (a suffix has at most MOST_SUFFIX_LABELS labels: no more are looked at).
    const named = [...labels.slice(Math.max(0, end - 1 - MOST_SUFFIX_LABELS), end - 1), top];
    const inner = publicSuffixLength(named) ?? 2;
    shown.add(named.slice(Math.max(0, named.length - inner - 1)).join("."));
  }
  return { site: labels.slice(siteStart).join("."), host, shown: [...shown] };
}

/** The top-level domain of a hostname the URL parser gave (or of a name as written), in lower case. */
const topOf = (hostname: string) => {
  const name = hostname.replace(/\.$/, "");
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
};

/**
 * The hostname the URL parser gives `name` (lower case, an international
 * one in punycode). When it gives none to a name that ends in a top-level
 * domain as written, the name as written, in lower case: the parsers of
 * the server and of the browsers differ at the edges ("xn--a.paypal.com",
 * whose punycode label the server's refuses and a browser's keeps), and
 * the name shows its site all the same. Null for any other. A name with a
 * label longer than DNS allows is read without parsing that label whole
 * (longLabelsRead).
 */
function hostnameOf(name: string): string | null {
  try {
    return longLabelsRead(name) ?? new URL(`https://${name}`).hostname;
  } catch {
    return TOP_LEVEL_DOMAINS.has(topOf(name)) ? name.toLowerCase() : null;
  }
}

// Characters the URL parser may read as a digit and a full stop ("\u2488" as
// "1."): a name that holds one is parsed whole.
const MAKES_FULL_STOP = /[\u2488-\u249B\u{1F100}]/u;
// What no host holds once its escapes are decoded (WHATWG's forbidden
// domain code points): the URL parser refuses a name with one.
const NO_HOST_CHAR = /[\u0000-\u0020#%/:<>?@[\\\]^|\u007F]/;
// A letter of a right-to-left script, or an Arabic-Indic digit: a host with
// one is read by the Bidi Rule. Other digits, and characters outside ASCII:
// with these, what decides how the parser checks a label.
const RIGHT_TO_LEFT =
  /(?=\p{L})[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]|[\u0600-\u0605\u0660-\u0669\u066B\u066C\u06DD\u0890\u0891\u08E2\u{10D30}-\u{10D39}\u{10E60}-\u{10E7E}]/u;
const OTHER_DIGIT =
  /[0-9\u00B2\u00B3\u00B9\u06F0-\u06F9\u2070\u2074-\u2079\u2080-\u2089\uFF10-\uFF19\u{102E1}-\u{102FB}\u{1D7CE}-\u{1D7FF}\u{1F101}-\u{1F10A}\u{1FBF0}-\u{1FBF9}]/u;
const NOT_ASCII = /[^\u0000-\u007F]/;
/** Letters and digits of a long label in one piece (piecesOf). */
const PIECE = 32;

/**
 * The hostname of a name with a label outside ASCII of more than
 * MAX_LABEL_CHARS letters and digits (beyondDns): as the URL parser gives
 * it, but each such label as "xn--" and the label itself, in lower case.
 * No host has such a label, nor this stand-in for its punycode, which the
 * parser writes in time in proportion to its length times the characters
 * it holds: so the label is checked in pieces (piecesOf), the other labels
 * parsed with one of its pieces in its place. Throws as the parser does
 * when it refuses the name. Null for a name without such a label (or with
 * a character the parser reads as a full stop and more): it is parsed
 * whole. Escapes ("%41") are decoded first, as the parser does.
 */
function longLabelsRead(name: string): string | null {
  if (!beyondDns(name)) return null;
  const decoded = percentDecoded(name);
  if (NO_HOST_CHAR.test(decoded)) throw new TypeError("not a host");
  if (MAKES_FULL_STOP.test(decoded)) return null;
  const labels = decoded.split(/[.\u3002\uFF0E\uFF61]/);
  const pieces = labels.map((label) => (NOT_ASCII.test(label) && beyondDns(label) ? piecesOf(label) : null));
  if (pieces.every((piece) => piece === null)) return null;
  // A host with a right-to-left letter is read by the Bidi Rule in every label.
  const last = RIGHT_TO_LEFT.test(decoded) ? "\u05D0" : "a";
  for (const piece of pieces.flatMap((each) => each ?? [])) new URL(`https://${piece}.${last}`);
  const parsed = new URL(`https://${labels.map((label, i) => pieces[i]?.[0] ?? label).join(".")}`).hostname.split(".");
  if (parsed.length !== labels.length) return null;
  return parsed.map((label, i) => (pieces[i] ? `xn--${labels[i].toLowerCase()}` : label)).join(".");
}

/**
 * A long label in pieces the URL parser reads quickly, each of the label's
 * own characters in its order: its start (to its fifth letter or digit),
 * the first of its letters and digits (with its marks) to hold a
 * right-to-left letter, another digit, or a character outside ASCII
 * (which decide which way the label runs, and whether it is international),
 * PIECE letters and digits of the rest, and its end (from its last letter
 * or digit but one). The parser checks each character of a label, its start
 * and end, and the kinds of letters and digits it holds together: it
 * accepts the label when it accepts every piece. Pieces part the label only
 * before a letter or digit, which joins none before it (staysInHost).
 */
function piecesOf(label: string): string[] {
  const starts: number[] = [];
  for (let at = 0; at < label.length; ) {
    const char = String.fromCodePoint(label.codePointAt(at) as number);
    if (staysInHost(char)) starts.push(at);
    at += char.length;
  }
  const endOf = (k: number) => (k + 1 < starts.length ? starts[k + 1] : label.length);
  /** The letter or digit, with its marks, holding the character at `at` (none before the first). */
  const holding = (at: number) => {
    let k = starts.length - 1;
    while (k >= 0 && starts[k] > at) k--;
    return k < 0 ? "" : label.slice(starts[k], endOf(k));
  };
  const endAt = starts.length - 2;
  const middle = label.slice(starts[4], starts[endAt]);
  const kinds = new Set([RIGHT_TO_LEFT, OTHER_DIGIT, NOT_ASCII].map((kind) => {
    const found = kind.exec(middle);
    return found ? holding(starts[4] + found.index) : "";
  }));
  const start = label.slice(0, starts[4]) + [...kinds].join("");
  const end = label.slice(starts[endAt]);
  const pieces: string[] = [];
  for (let k = 4; k < endAt; k += PIECE) pieces.push(start + label.slice(starts[k], starts[Math.min(k + PIECE, endAt)]) + end);
  return pieces;
}

/** `text` with its escapes ("%41") decoded as UTF-8, as the URL parser decodes a host. */
function percentDecoded(text: string): string {
  if (!text.includes("%")) return text;
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const escaped = bytes[i] === 0x25 && i + 2 < bytes.length && isHex(bytes[i + 1]) && isHex(bytes[i + 2]);
    out[n++] = escaped ? parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16) : bytes[i];
    if (escaped) i += 2;
  }
  return new TextDecoder().decode(out.subarray(0, n));
}

const isHex = (byte: number) => (byte >= 0x30 && byte <= 0x39) || ((byte | 0x20) >= 0x61 && (byte | 0x20) <= 0x66);

/**
 * The hostname of `name` when it ends in a top-level domain
 * (TOP_LEVEL_DOMAINS); null for any other. Most words with a dot end in
 * none: no parse for them.
 */
function endingInTopLevelDomain(name: string): string | null {
  const bare = name.replace(/\.$/, "");
  const top = bare.slice(bare.lastIndexOf(".") + 1);
  if (ASCII_TOP_LABEL.test(top) && !TOP_LEVEL_DOMAINS.has(top.toLowerCase())) return null;
  const hostname = hostnameOf(name);
  return hostname !== null && TOP_LEVEL_DOMAINS.has(topOf(hostname)) ? hostname : null;
}

/**
 * The place of a host or an email domain as written, through the URL
 * parser (so an international name and its punycode are equal): as it
 * shows in Latin letters when that ends in a top-level domain
 * (readAsLatin: "pаypal.com" with a Cyrillic а is paypal.com's), else as
 * written. Null when it can't be read.
 */
function placeOfName(host: string): Place | null {
  const latin = readAsLatin(host);
  const hostname = (latin === null ? null : endingInTopLevelDomain(latin)) ?? hostnameOf(host);
  return hostname === null ? null : placeOf(hostname);
}

/**
 * Does an address shown in text, at `shown`, go somewhere else than a link
 * to `link`? Another site; or, on the link's site, another host that shows
 * a name of another site in front ("paypal.com.evil.example" over a link to
 * evil.example). The link's own host, shown as it is, shows where it goes.
 * A public suffix named by itself goes to every host under it ("gov.gr"
 * over wallet.gov.gr), and to no other.
 */
function goesElsewhere(shown: Place, link: Place): boolean {
  if (shown.everySite) return link.host !== shown.host && !link.host.endsWith(`.${shown.host}`);
  if (shown.site !== link.site) return true;
  return shown.host !== link.host && shown.shown.some((site) => site !== link.site);
}

/**
 * Where an address goes: a mailbox (email: with the place of its domain,
 * and the place its first part shows as a host, if it shows one) or a
 * place (web).
 */
type Target =
  | { kind: "email"; mailbox: string; place: Place | null; inMailbox: Place | null }
  | { kind: "web"; place: Place | null };

function emailTarget(mailbox: string): Target {
  const at = mailbox.lastIndexOf("@");
  return {
    kind: "email",
    mailbox: mailbox.toLowerCase(),
    place: placeOfName(mailbox.slice(at + 1)),
    inMailbox: hostInMailbox(mailbox.slice(0, at)),
  };
}

// The top-level domains an email address's first part is read as a host
// by, besides one starting with "www.": a country's (two letters) and the
// generic ones of before 2000. Not the newer ones, which hold surnames and
// first names ("schmidt", "weber", "kim", "george").
const GENERIC_TOP_LEVEL_DOMAINS: ReadonlySet<string> = new Set(["com", "net", "org", "edu", "gov", "mil", "int", "info", "biz"]);

/**
 * The place an email address's first part shows as a host, if it shows
 * one by its look: it starts with "www." or ends in a country's or a
 * generic top-level domain ("paypal.com@evil.example",
 * "www.paypal.com@evil.example"). Null for any other ("anna.schmidt@…",
 * "info@…"). Read in Latin letters, as a bare host is (readAsLatin).
 */
function hostInMailbox(local: string): Place | null {
  const name = readAsLatin(local) ?? local;
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  const top = labels[labels.length - 1].toLowerCase();
  const country = top.length === 2 && TOP_LEVEL_DOMAINS.has(top);
  if (labels[0].toLowerCase() !== "www" && !country && !GENERIC_TOP_LEVEL_DOMAINS.has(top)) return null;
  const hostname = hostnameOf(name);
  return hostname === null ? null : placeOf(hostname);
}

// The host an address with a scheme is written with ("https://bank.example:8443/x": "bank.example:8443").
const WRITTEN_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^/\\?#]*)/i;

/**
 * Where an address a quick link would find goes: as its host is written,
 * when that reads otherwise in Latin letters ("https://pаypal.com" with a
 * Cyrillic а goes, as shown, to paypal.com); else where its link goes.
 */
function foundTarget(typed: string, found: FoundLink): Target | null {
  if (found.kind === "web") {
    const host = WRITTEN_AUTHORITY.exec(typed)?.[1].replace(/:\d*$/, "");
    if (host && !host.includes("@") && readAsLatin(host) !== null) {
      const place = placeOfName(host);
      if (place) return { kind: "web", place };
    }
  }
  return targetOf(found.href);
}

function targetOf(href: string): Target | null {
  const mailbox = emailAddressOf(href);
  if (mailbox !== null) return emailTarget(mailbox);
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    return { kind: "web", place: placeOf(new URL(href).hostname) };
  } catch {
    return null;
  }
}

/** The addresses a text shows, as compared with a link (see addressesShown). */
export interface ShownAddresses {
  /** Where the web addresses shown go. */
  readonly web: readonly Place[];
  /** The mailboxes (lower case) of the email addresses shown, and where their domains go. */
  readonly mailboxes: ReadonlySet<string>;
  readonly email: readonly Place[];
  /**
   * Where the first parts of the email addresses shown go, those that show
   * a host (hostInMailbox): over a web link, somewhere else when not the
   * link's site.
   */
  readonly inMailboxes: readonly Place[];
  /**
   * An address shown whose place can't be read, or one with a user name
   * (which no link may have): somewhere else, whatever the link.
   */
  readonly elsewhere: boolean;
  /**
   * Every address shown is a name read only by the top-level domain it
   * ends in ("paypal.com", "course-materials.zip"): none has a scheme,
   * "www.", a path or a port, and none is an email address. Such text looks
   * like a web address, as a file's name can (the owner's decision of 22
   * October 2026: refused all the same, which fails safe).
   */
  readonly namesOnly: boolean;
}

type Shown = {
  web: Place[];
  mailboxes: Set<string>;
  email: Place[];
  inMailboxes: Place[];
  elsewhere: boolean;
  names: number;
  others: number;
};

function addTarget(shown: Shown, target: Target | null) {
  shown.others++;
  if (!target || target.place === null) {
    shown.elsewhere = true;
  } else if (target.kind === "email") {
    shown.mailboxes.add(target.mailbox);
    shown.email.push(target.place);
    if (target.inMailbox) shown.inMailboxes.push(target.inMailbox);
  } else {
    shown.web.push(target.place);
  }
}

// Where a loose address starts, and the run of characters it can span (to
// whitespace, quotes or angle brackets, as a quick link's run).
const LOOSE_START = /https?:|mailto:/gi;
const LOOSE_RUN = /[^\s<>"`\u0000-\u001f\u007f]*/uy;
// Punctuation that ends a sentence, closes a quote or a bracket: not part of a host.
const HOST_TRAILING = /[.,;:!?'"*_~…··“”‘’„«»‹›)\]}]/u;
const DOT = /\./;
const FULL_STOP = /[.\u3002]/;
const DOT_OR_HYPHEN = /[.-]/;

/**
 * `text` without the characters `trailing` matches at its end. Read from
 * the end, one character at a time: a long run of them costs its length,
 * once (a pattern anchored at the end would be tried from every position).
 */
function trimEnd(text: string, trailing: RegExp): string {
  let to = text.length;
  while (to > 0 && trailing.test(text[to - 1])) to--;
  return text.slice(0, to);
}

/**
 * Addresses in `text` beyond what a quick link would find: every "https:"
 * or "http:" followed by a host with a dot (by the place of its host; a user
 * name makes it elsewhere; in a host longer than DNS allows, which no quick
 * link reads, an ideographic full stop is a dot), and every "mailto:" followed by an email
 * address, whatever follows them. A run is read once: an address inside another's path
 * ("https://web.archive.org/web/2020/https://example.org") is part of it.
 * Each run read, an address or not, is added to `read` (start, end).
 */
function addLooseAddresses(shown: Shown, text: string, read: [number, number][]): boolean {
  let any = false;
  let consumed = 0;
  const starts = new RegExp(LOOSE_START.source, LOOSE_START.flags);
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text))) {
    const at = match.index;
    if (at < consumed) continue;
    LOOSE_RUN.lastIndex = at;
    const runEnd = at + (LOOSE_RUN.exec(text)?.[0].length ?? 0);
    consumed = runEnd;
    starts.lastIndex = runEnd;
    read.push([at, runEnd]);
    let from = at + match[0].length;
    if (match[0].toLowerCase() === "mailto:") {
      const rest = text.slice(from, runEnd);
      const q = rest.indexOf("?");
      const address = trimEnd(q < 0 ? rest : rest.slice(0, q), HOST_TRAILING);
      if (isEmailAddress(address)) {
        addTarget(shown, emailTarget(address));
        any = true;
      }
      continue;
    }
    while (from < runEnd && (text[from] === "/" || text[from] === "\\")) from++;
    let to = from;
    while (to < runEnd && !"/\\?#".includes(text[to])) to++;
    const authority = trimEnd(text.slice(from, to), HOST_TRAILING);
    const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
    // A host has a dot, as for any address on the platform ("https://bank." isn't one);
    // one longer than DNS allows (beyondDns), which no quick link reads, may have an
    // ideographic full stop for it, as the URL parser reads one.
    const dot = beyondDns(host) ? FULL_STOP : DOT;
    if (!dot.test(trimEnd(host, dot))) continue;
    any = true;
    if (host !== authority.replace(/:\d*$/, "")) {
      shown.others++;
      shown.elsewhere = true;
      continue;
    }
    addTarget(shown, { kind: "web", place: placeOfName(host) });
  }
  return any;
}

// A name as hosts are written: labels of letters, marks and digits, with
// hyphens inside, joined by dots (an ideographic full stop is one, as the
// URL parser reads it).
const NAME_RUN = /[\p{L}\p{N}\p{M}.。-]+/gu;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?$/u;
// The last label of a host: two letters or more (with their marks), or punycode.
const TOP_LABEL = /^(?:\p{L}\p{M}*){2,}$|^xn--[a-z0-9-]+$/iu;
const ASCII_TOP_LABEL = /^[a-z]+$/i;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// What a name right after it belongs to: a path ("docs/report.de"), a word
// ("my_site.de"), an encoded or a query's value ("%2Fbank.example",
// "?next=bank.example").
const CONTINUES = /[/\\_%=&~]/;
// What wraps a word for emphasis ("_paypal.com_", "~paypal.com~"): at the
// start of a word, a name after it is read.
const WRAPS = /[_~*]/;
const WORD_START = /[\s([{<"'“‘„«‹]/u;
const SLASH = /[/\\]/;
// After a name: a path or a port, which only a host has.
const PATH_OR_PORT = /^(?:[/\\]|:\d)/;
// After a host: its path, query, fragment or port, to the end of the word
// (a colon followed by no digit starts none: "evil.example:paypal.com").
const HOST_GOES_ON = /^(?:[/\\?#]|:\d)/;
const WORD_END = /[\s<>"`]/u;

/** Is the name at `at` wrapped for emphasis at the start of a word ("_paypal.com_")? */
function wrapped(text: string, at: number): boolean {
  let from = at;
  while (from > 0 && WRAPS.test(text[from - 1])) from--;
  return from < at && (from === 0 || WORD_START.test(text[from - 1]));
}

/**
 * Does a host start at `at`, after two slashes ("//paypal.com",
 * "ftp://paypal.com", "https꞉//paypal.com")? What follows them is a host,
 * not a path.
 */
const afterTwoSlashes = (text: string, at: number) => at >= 2 && SLASH.test(text[at - 1]) && SLASH.test(text[at - 2]);

/** Is the name at `at` after one slash at the start of a word ("Login: /paypal.com"), where no path comes before it? */
const afterSlashAtWordStart = (text: string, at: number) =>
  at >= 1 && SLASH.test(text[at - 1]) && (at === 1 || WORD_START.test(text[at - 2]));

/**
 * Cyrillic and Greek letters that look like Latin ones, by the Latin letter
 * they look like (as text is compared: after compatibility normalisation, so
 * the Greek lunate sigma is "ς").
 */
const LOOK_ALIKE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    a: "аАΑα",
    b: "ВΒ",
    c: "сСς",
    d: "ԁԀ",
    e: "еЕΕ",
    h: "һҺНΗ",
    i: "іІΙιӀ",
    j: "јЈϳͿ",
    k: "кКΚκ",
    l: "ӏ",
    m: "мМΜ",
    n: "Νηп",
    o: "оОΟο",
    p: "рРΡρ",
    q: "ԛԚ",
    r: "г",
    s: "ѕЅ",
    t: "тТΤ",
    u: "υ",
    v: "ѵѴν",
    w: "ԝԜ",
    x: "хХΧχ",
    y: "уУүҮΥγ",
    z: "Ζ",
  }).flatMap(([latin, letters]) => [...letters].map((letter) => [letter, latin] as const))
);
const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;
const MARK = /\p{M}/u;

/** Is `char` a letter neither Latin nor a look-alike of a Latin one? */
const otherLetter = (char: string) => LETTER.test(char) && !LATIN_LETTER.test(char) && !LOOK_ALIKE.has(char);

/**
 * How a name reads in Latin letters, or null when it reads as written.
 * Read so: a name with a Latin letter, or one whose every letter is a
 * look-alike, a Cyrillic one among them ("аррӏе.сом"); in it, each label
 * whose letters are all Latin or look-alikes, each look-alike read as the
 * Latin letter it shows and each mark dropped (a mark left after
 * compatibility normalisation belongs to no letter of its own, as under
 * "m̲": it hides under a link's underline). So "pаypal.com" with a
 * Cyrillic а, "PAYPAL.СОМ", "paypal.соm.evil.example" and "paypal.co̲m"
 * read as paypal.com's names. A label with a letter of another kind stays
 * as written ("ευ", the Greek one of the European Union's, "сбербанк"),
 * and so does a name of such letters only ("Αθήνα.Το", "сбербанк.рф") or
 * of Greek look-alikes only ("ΚΑΙ.ΤΟ").
 */
function readAsLatin(name: string): string | null {
  let latin = false;
  let cyrillic = false;
  let other = false;
  for (const char of name) {
    if (LATIN_LETTER.test(char)) latin = true;
    else if (otherLetter(char)) other = true;
    else if (CYRILLIC_LETTER.test(char)) cyrillic = true;
  }
  if (!latin && (other || !cyrillic)) return null;
  let changed = false;
  const labels = name.split(".").map((label) => {
    const chars = [...label];
    if (chars.some(otherLetter)) return label;
    const read = chars.map((char) => (MARK.test(char) ? "" : (LOOK_ALIKE.get(char) ?? char))).join("");
    if (read !== label) changed = true;
    return read;
  });
  return changed ? labels.join(".") : null;
}

// Titles and company forms written with dots ("Dr.med.", "Univ.Prof.",
// "Co.KG"), in title case: a name that starts with one, or with words of
// one or two letters and then one ("o.Univ.Prof.", "ao.Univ.Prof."), is no
// host.
const TITLE_PREFIXES: ReadonlySet<string> = new Set(["Ass", "Assoc", "Co", "Dipl", "Dott", "Dr", "Hon", "Mag", "Priv", "Prof", "Univ"]);
const UP_TO_TWO_LETTERS = /^\p{L}{1,2}$/u;
// Titles and company forms that end a name, in title case, after words of
// at most four letters ("Jun.Prof.", "apl.Prof.", "Pty.Ltd.").
const TITLE_ENDS: ReadonlySet<string> = new Set(["Prof", "Ltd"]);
const UP_TO_FOUR_LETTERS = /^\p{L}{1,4}$/u;
// Titles written with the feminine ending "in" in Austrian usage ("Dir.in",
// "Bgm.in", "OStR.in"), in their written case: a name of one of them and
// "in" is an abbreviation (a title prefix's is anyway: "Dr.in", "Prof.in").
const TITLES_WITH_ENDING: ReadonlySet<string> = new Set(["Abg", "BEd", "Bgm", "DDr", "DI", "Dir", "Doz", "GR", "HR", "LAbg", "OStR", "StR", "Vzbgm"]);
const FEMININE_ENDING = "in";
const TITLE_CASE = /^\p{Lu}\p{Ll}+$/u;
const LOWER_CASE = /^\p{Ll}+$/u;
const ONE_LETTER = /^\p{L}$/u;

/**
 * Do `labels`, from `start` on, begin a public suffix of more than one
 * label ("Co.UK": co.uk, "Com.Au": com.au)? A suffix has at most
 * MOST_SUFFIX_LABELS labels: no more are looked at.
 */
function startsPublicSuffix(labels: readonly string[], start: number): boolean {
  let rule = labels[start].toLowerCase();
  let rest = "";
  for (let end = start + 1; end < labels.length && end - start < MOST_SUFFIX_LABELS; end++) {
    const label = labels[end].toLowerCase();
    rule = `${rule}.${label}`;
    rest = rest ? `${rest}.${label}` : label;
    if (PUBLIC_SUFFIX_RULES.has(rule) || PUBLIC_SUFFIX_RULES.has(`*.${rest}`)) return true;
  }
  return false;
}

/**
 * Is a name of `labels` an abbreviation rather than a host?
 * - A title or a company form at its start, or after words of one or two
 *   letters ("Dr.med.vet.", "Hon.Prof.", "Co.KG", "o.Univ.Prof."), unless
 *   it and the labels after it make a public suffix as a host's name is
 *   written ("Co.UK" is co.uk, so "Co.UK" and "EE.Co.UK" are hosts); a word
 *   in lower case after it is an abbreviation's ("Dr.in", "Mag.a",
 *   "Dr.med."), whatever the public suffixes hold ("dr.in" is one);
 * - a title or a company form at its end, after words of at most four
 *   letters ("Jun.Prof.", "apl.Prof.", "Pty.Ltd.");
 * - one letter followed by a label in title case ("M.Sc.", "B.Com.",
 *   "B.Tech.");
 * - a title and its feminine ending "in", as Austrian usage writes them
 *   ("Dir.in", "Bgm.in", "OStR.in"; TITLES_WITH_ENDING).
 * Hosts are written in lower case or in capitals ("x.com", "X.com",
 * "PAYPAL.COM", "paypal.ltd").
 */
function isAbbreviation(labels: readonly string[]): boolean {
  const last = labels.length - 1;
  if (last === 1 && labels[1] === FEMININE_ENDING && TITLES_WITH_ENDING.has(labels[0])) return true;
  for (let i = 0; i < last; i++) {
    if (TITLE_PREFIXES.has(labels[i])) {
      if (LOWER_CASE.test(labels[i + 1]) || !startsPublicSuffix(labels, i)) return true;
      break;
    }
    if (!UP_TO_TWO_LETTERS.test(labels[i])) break;
  }
  if (TITLE_ENDS.has(labels[last]) && labels.slice(0, last).every((label) => UP_TO_FOUR_LETTERS.test(label))) return true;
  return ONE_LETTER.test(labels[0]) && labels.slice(1).some((label) => TITLE_CASE.test(label));
}

/**
 * A name `written` as a bare host: where it goes (null when it is a host
 * whose place can't be read), and whether it was read only by the
 * top-level domain it ends in (`byName`: no "www.", no path or port, not
 * after two slashes). Null when it isn't one. `after` is the text right
 * after it; `afterSlashes`, whether two slashes come right before it. A
 * last label that starts with a top-level domain in lower case and a
 * hyphen ends the name there ("paypal.com-login" is paypal.com;
 * topLevelDomainBeforeHyphen). It is read as it shows in Latin letters
 * (readAsLatin) when that ends in a top-level domain, else as written. A
 * public suffix of more than one label read by name ("gov.gr", "GOV.UK") is
 * every site under it (Place). See addBareHosts.
 */
function bareHost(written: string, after: string, afterSlashes: boolean): { place: Place | null; byName: boolean } | null {
  const labels = written.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  // A last label that starts with a top-level domain in lower case and a
  // hyphen shows the name that ends there ("paypal.com-login").
  const ending = topLevelDomainBeforeHyphen(labels[labels.length - 1]);
  if (ending !== null) labels[labels.length - 1] = ending;
  const name = labels.join(".");
  const pathOrPort = PATH_OR_PORT.test(after);
  if (IPV4.test(name)) return pathOrPort || afterSlashes ? { place: placeOf(name), byName: false } : null;
  const top = labels[labels.length - 1];
  if (!TOP_LABEL.test(top)) return null;
  const www = labels[0].toLowerCase() === "www";
  if (!www && isAbbreviation(labels)) return null;
  const sure = pathOrPort || www || afterSlashes;
  const latin = readAsLatin(name);
  for (const shown of latin === null ? [name] : [latin, name]) {
    const hostname = endingInTopLevelDomain(shown);
    if (hostname === null) continue;
    const place = placeOf(hostname);
    return { place: !sure && isPublicSuffix(place.host) ? { ...place, everySite: true } : place, byName: !sure };
  }
  if (!sure) return null;
  const hostname = (latin === null ? null : hostnameOf(latin)) ?? hostnameOf(name);
  return { place: hostname === null ? null : placeOf(hostname), byName: false };
}

/**
 * What a name's last label shows before its first hyphen when that is a
 * top-level domain in lower case, as a host is written ("com" in
 * "paypal.com-login", "de" in "amazon.de-bestellung"), through look-alike
 * letters; null for any other ("Online" in "bzw.Online-Kurs", "IT" in
 * "1.IT-Sicherheit").
 */
function topLevelDomainBeforeHyphen(label: string): string | null {
  const hyphen = label.indexOf("-");
  if (hyphen <= 0) return null;
  const head = label.slice(0, hyphen);
  return LOWER_CASE.test(head) && TOP_LEVEL_DOMAINS.has(readAsLatin(head) ?? head) ? head : null;
}

/** Is `host` (as placeOf gives it) a public suffix of more than one label ("gov.gr", "co.uk")? */
function isPublicSuffix(host: string): boolean {
  const labels = host.split(".");
  return labels.length > 1 && publicSuffixLength(labels) === labels.length;
}

/** `raw` without dots and hyphens at either end. */
function trimDotsAndHyphens(raw: string): string {
  let from = 0;
  while (from < raw.length && DOT_OR_HYPHEN.test(raw[from])) from++;
  return trimEnd(raw.slice(from), DOT_OR_HYPHEN);
}

/**
 * Bare hosts in `text`, each read as a web address of its site (D104, the
 * owner's decision of 22 October 2026). A name of two labels or more whose
 * last is two letters or more (or punycode) is a host when it starts with
 * "www." or a path or a port follows it ("www.bank.example",
 * "bank.example/login", "bank.example:8443"), or when it ends in a
 * top-level domain (TOP_LEVEL_DOMAINS: "paypal.com", "bank.example"), as
 * written or as it shows in Latin letters ("paypal.соm", "pаypal.com";
 * readAsLatin), or one in lower case and a hyphen ("paypal.com-login");
 * an IPv4 address is one with a path or a port. So an
 * ordinary word with a dot isn't one: a version ("v1.2"), an abbreviation
 * ("e.g.", "z.B.", "κ.λπ.", "M.Sc.", "Dr.med.", "Jun.Prof."; isAbbreviation),
 * the end of a sentence (a trailing dot ends it), a file's name ending in no
 * top-level domain ("report.pdf"). Two dots or more ("wait...then") part
 * names; a name right after a path, a word or a value (CONTINUES) belongs
 * to it, unless only characters that wrap a word for emphasis come before
 * it at the word's start ("_paypal.com_"), or it comes after two slashes
 * ("//paypal.com", "ftp://paypal.com", which start a host) or after one
 * slash at a word's start ("Login: /paypal.com"); and so does what follows
 * a host's path or port. `text` is as its addresses are read
 * (readingsOf), with what was already read as an address blanked out.
 */
function addBareHosts(shown: Shown, text: string): boolean {
  let any = false;
  // A host's path, query or fragment runs to here: none of it is read again.
  let skipTo = 0;
  const runs = new RegExp(NAME_RUN.source, NAME_RUN.flags);
  let match: RegExpExecArray | null;
  while ((match = runs.exec(text))) {
    const at = match.index;
    if (at < skipTo) continue;
    const slashes = afterTwoSlashes(text, at);
    if (at > 0 && CONTINUES.test(text[at - 1]) && !wrapped(text, at) && !slashes && !afterSlashAtWordStart(text, at)) continue;
    const end = at + match[0].length;
    const after = text.slice(end, end + 2);
    const names = match[0].replace(/。/g, ".").split(/\.{2,}/);
    names.forEach((raw, i) => {
      const last = i === names.length - 1;
      const host = bareHost(trimDotsAndHyphens(raw), last ? after : "..", i === 0 && slashes && !raw.startsWith("."));
      if (host === null) return;
      any = true;
      if (host.byName) shown.names++;
      else shown.others++;
      if (host.place === null) shown.elsewhere = true;
      else shown.web.push(host.place);
      if (last && HOST_GOES_ON.test(after)) {
        let stop = end;
        while (stop < text.length && !WORD_END.test(text[stop])) stop++;
        skipTo = stop;
      }
    });
  }
  return any;
}

/** `text` with each span of `read` blanked out (spaces), so nothing in it is read again. */
function blankOut(text: string, read: readonly [number, number][]): string {
  if (!read.length) return text;
  let out = "";
  let from = 0;
  for (const [start, end] of [...read].sort((a, b) => a[0] - b[0])) {
    if (end <= from) continue;
    const begin = Math.max(start, from);
    out += text.slice(from, begin) + " ".repeat(end - begin);
    from = end;
  }
  return out + text.slice(from);
}

/**
 * The addresses `text` shows (see the module's note), read once; null when
 * it shows none.
 */
export function addressesShown(text: string): ShownAddresses | null {
  const shown: Shown = { web: [], mailboxes: new Set(), email: [], inMailboxes: [], elsewhere: false, names: 0, others: 0 };
  let any = false;
  for (const placed of placedOf(text)) {
    const readings = readingsOf(placed);
    // The text as written, too, as a quick link would find its addresses.
    if (!readings.includes(placed)) {
      for (const found of findLinks(placed)) {
        addTarget(shown, foundTarget(placed.slice(found.start, found.end), found));
        any = true;
      }
    }
    for (const reading of readings) {
      // What has been read of it as an address: not read again as a bare host.
      const read: [number, number][] = [];
      for (const found of findLinks(reading)) {
        addTarget(shown, foundTarget(reading.slice(found.start, found.end), found));
        any = true;
        read.push([found.start, found.end]);
      }
      if (addLooseAddresses(shown, reading, read)) any = true;
      if (addBareHosts(shown, blankOut(reading, read))) any = true;
    }
  }
  if (!any) return null;
  const { web, mailboxes, email, inMailboxes, elsewhere } = shown;
  return { web, mailboxes, email, inMailboxes, elsewhere, namesOnly: shown.names > 0 && shown.others === 0 };
}

/** Does `set` hold anything but `value`? */
const holdsOther = (set: ReadonlySet<string>, value: string) => set.size > 1 || (set.size === 1 && !set.has(value));

/**
 * Do the addresses shown (addressesShown) point somewhere else than `href`?
 * Another mailbox, for an email address shown over an email link; somewhere
 * else (goesElsewhere: another site, by registrable domain), in every other
 * pairing, an email address's first part that shows a host included over a
 * web link ("paypal.com@evil.example"). An `href` that isn't a web or email
 * address counts every address shown as somewhere else.
 */
export function showsAnotherAddress(shown: ShownAddresses | null, href: string): boolean {
  if (!shown) return false;
  if (shown.elsewhere) return true;
  const link = targetOf(href);
  if (!link || link.place === null) return true;
  const to = link.place;
  const elsewhere = (places: readonly Place[]) => places.some((place) => goesElsewhere(place, to));
  if (link.kind === "email") return holdsOther(shown.mailboxes, link.mailbox) || elsewhere(shown.web);
  return elsewhere(shown.web) || elsewhere(shown.email) || elsewhere(shown.inMailboxes);
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
