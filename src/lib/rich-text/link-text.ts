import { findLinks } from "./linkify";
import { checkLinkHref, emailAddressOf, isEmailAddress, isSafeLinkHost } from "./link-url";
import { TOP_LEVEL_DOMAINS } from "./top-level-domains";

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
 * A text is read as learners see it (visibleLinkText): characters that show
 * nothing don't split an address, and compatibility forms (fullwidth
 * letters, a one dot leader) read as the characters they show. An address
 * is read wherever a quick link would find one, and also wherever a text
 * shows "https:" or "http:" followed by a host with a dot, whether or not
 * it could be a link (with a user name, as an Outlook safe link, over 2,048
 * characters), and wherever it shows "mailto:" and an email address. A bare
 * host shown in the text ("www.bank.example", "bank.example/login",
 * "paypal.com") is an address of its site too (D104, the owner's decision of
 * 22 October 2026), while an ordinary word with a dot ("v1.2", "e.g.", the
 * end of a sentence) is not (addBareHosts).
 *
 * Pure, like link-url.ts.
 */

export type LinkTextProblem = "empty" | "misleading";
export type LinkTextWarning = "vague" | "long";

/** Link text over this many characters gets the "long" warning. */
export const LONG_LINK_TEXT = 100;

// Characters that show nothing by default (zero-width and direction marks,
// a soft hyphen, fillers, invisible operators, variation selectors, …).
const SHOWS_NOTHING = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * A text as learners see it: without the characters that show nothing, and
 * with compatibility forms as the characters they show (NFKC).
 */
export function visibleLinkText(text: string): string {
  return text.replace(SHOWS_NOTHING, "").normalize("NFKC").replace(SHOWS_NOTHING, "");
}

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
  return siteOfHostname(name);
}

/** The site of a hostname the URL parser gave (see siteOf). */
function siteOfHostname(hostname: string): string {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return name.startsWith("www.") ? name.slice(4) : name;
}

/** Where an address goes: a mailbox (email) or a site (web). */
type Target = { kind: "email"; mailbox: string; site: string | null } | { kind: "web"; site: string | null };

function emailTarget(mailbox: string): Target {
  return { kind: "email", mailbox: mailbox.toLowerCase(), site: siteOf(mailbox.slice(mailbox.indexOf("@") + 1)) };
}

function targetOf(href: string): Target | null {
  const mailbox = emailAddressOf(href);
  if (mailbox !== null) return emailTarget(mailbox);
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    return { kind: "web", site: siteOf(new URL(href).hostname) };
  } catch {
    return null;
  }
}

/** The addresses a text shows, as compared with a link (see addressesShown). */
export interface ShownAddresses {
  /** The sites of the web addresses shown. */
  readonly webSites: ReadonlySet<string>;
  /** The mailboxes (lower case) and the sites of the email addresses shown. */
  readonly mailboxes: ReadonlySet<string>;
  readonly emailSites: ReadonlySet<string>;
  /**
   * An address shown whose place can't be read, or one with a user name
   * (which no link may have): somewhere else, whatever the link.
   */
  readonly elsewhere: boolean;
}

type Shown = { webSites: Set<string>; mailboxes: Set<string>; emailSites: Set<string>; elsewhere: boolean };

function addTarget(shown: Shown, target: Target | null) {
  if (!target || target.site === null) {
    shown.elsewhere = true;
  } else if (target.kind === "email") {
    shown.mailboxes.add(target.mailbox);
    shown.emailSites.add(target.site);
  } else {
    shown.webSites.add(target.site);
  }
}

// Where a loose address starts, and the run of characters it can span (to
// whitespace, quotes or angle brackets, as a quick link's run).
const LOOSE_START = /https?:|mailto:/gi;
const LOOSE_RUN = /[^\s<>"`\u0000-\u001f\u007f]*/uy;
// Punctuation that ends a sentence, closes a quote or a bracket: not part of a host.
const HOST_TRAILING = /[.,;:!?'"*_~…·\u0387“”‘’„«»‹›)\]}]+$/u;

/**
 * Addresses in `text` beyond what a quick link would find: every "https:"
 * or "http:" followed by a host with a dot (by the site of its host; a user
 * name makes it elsewhere), and every "mailto:" followed by an email
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
      const address = (q < 0 ? rest : rest.slice(0, q)).replace(HOST_TRAILING, "");
      if (isEmailAddress(address)) {
        addTarget(shown, emailTarget(address));
        any = true;
      }
      continue;
    }
    while (from < runEnd && (text[from] === "/" || text[from] === "\\")) from++;
    let to = from;
    while (to < runEnd && !"/\\?#".includes(text[to])) to++;
    const authority = text.slice(from, to).replace(HOST_TRAILING, "");
    const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
    // A host has a dot, as for any address on the platform ("https://bank." isn't one).
    if (!host.replace(/\.+$/, "").includes(".")) continue;
    any = true;
    if (host !== authority.replace(/:\d*$/, "")) {
      shown.elsewhere = true;
      continue;
    }
    addTarget(shown, { kind: "web", site: siteOf(host) });
  }
  return any;
}

// A name as hosts are written: labels of letters, marks and digits, with
// hyphens inside, joined by dots (an ideographic full stop is one, as the
// URL parser reads it).
const NAME_RUN = /[\p{L}\p{N}\p{M}.\u3002-]+/gu;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?$/u;
// The last label of a host: two letters or more (with their marks), or punycode.
const TOP_LABEL = /^(?:\p{L}\p{M}*){2,}$|^xn--[a-z0-9-]+$/iu;
const ASCII_TOP_LABEL = /^[a-z]+$/i;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// What a name right after it belongs to: a path ("docs/report.de"), a word
// ("my_site.de"), an encoded or a query's value ("%2Fbank.example",
// "?next=bank.example").
const CONTINUES = /[/\\_%=&~]/;
// After a name: a path or a port, which only a host has.
const PATH_OR_PORT = /^(?:[/\\]|:\d)/;
// After a host: its path, query or fragment, to the end of the word.
const HOST_GOES_ON = /^[/\\?#:]/;
const WORD_END = /[\s<>"`]/u;

/**
 * The site of `name` when it is a bare host; "elsewhere" when it is one
 * whose place can't be read; null when it isn't one. `after` is the text
 * right after it. See addBareHosts.
 */
function bareHostSite(name: string, after: string): string | "elsewhere" | null {
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  const pathOrPort = PATH_OR_PORT.test(after);
  if (IPV4.test(name)) return pathOrPort ? name : null;
  const top = labels[labels.length - 1];
  if (!TOP_LABEL.test(top)) return null;
  const sure = pathOrPort || labels[0].toLowerCase() === "www";
  // Most words with a dot end in no top-level domain: no parse for them.
  if (!sure && ASCII_TOP_LABEL.test(top) && !TOP_LEVEL_DOMAINS.has(top.toLowerCase())) return null;
  let hostname: string;
  try {
    hostname = new URL(`https://${name}`).hostname;
  } catch {
    return sure ? "elsewhere" : null;
  }
  if (!sure && !TOP_LEVEL_DOMAINS.has(hostname.slice(hostname.lastIndexOf(".") + 1).toLowerCase())) return null;
  return siteOfHostname(hostname);
}

/**
 * Bare hosts in `text`, each read as a web address of its site (D104, the
 * owner's decision of 22 October 2026). A name of two labels or more whose
 * last is two letters or more (or punycode) is a host when it starts with
 * "www." or a path or a port follows it ("www.bank.example",
 * "bank.example/login", "bank.example:8443"), or when it ends in a
 * top-level domain (TOP_LEVEL_DOMAINS: "paypal.com", "bank.example"); an
 * IPv4 address is one with a path or a port. So an ordinary word with a dot
 * isn't one: a version ("v1.2"), an abbreviation ("e.g.", "z.B.", "κ.λπ."),
 * the end of a sentence (a trailing dot ends it), a file's name
 * ("report.pdf"). Two dots or more ("wait...then") part names; a name right
 * after a path, a word or a value (CONTINUES) belongs to it, and so does
 * what follows a host's path. `text` is as learners see it, with what was
 * already read as an address blanked out.
 */
function addBareHosts(shown: Shown, text: string): boolean {
  let any = false;
  // A host's path, query or fragment runs to here: none of it is read again.
  let skipTo = 0;
  const runs = new RegExp(NAME_RUN.source, NAME_RUN.flags);
  let match: RegExpExecArray | null;
  while ((match = runs.exec(text))) {
    const at = match.index;
    if (at < skipTo || (at > 0 && CONTINUES.test(text[at - 1]))) continue;
    const end = at + match[0].length;
    const after = text.slice(end, end + 2);
    const names = match[0].replace(/\u3002/g, ".").split(/\.{2,}/);
    names.forEach((raw, i) => {
      const last = i === names.length - 1;
      const site = bareHostSite(raw.replace(/^[.-]+|[.-]+$/g, ""), last ? after : "..");
      if (site === null) return;
      any = true;
      if (site === "elsewhere") shown.elsewhere = true;
      else shown.webSites.add(site);
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
  const shown: Shown = { webSites: new Set(), mailboxes: new Set(), emailSites: new Set(), elsewhere: false };
  let any = false;
  const visible = visibleLinkText(text);
  // What has been read of `visible` as an address: not read again as a bare host.
  const read: [number, number][] = [];
  for (const each of visible === text ? [text] : [text, visible]) {
    for (const found of findLinks(each)) {
      addTarget(shown, targetOf(found.href));
      any = true;
      if (each === visible) read.push([found.start, found.end]);
    }
  }
  if (addLooseAddresses(shown, visible, read)) any = true;
  if (addBareHosts(shown, blankOut(visible, read))) any = true;
  return any ? shown : null;
}

/** Does `set` hold anything but `value`? */
const holdsOther = (set: ReadonlySet<string>, value: string) => set.size > 1 || (set.size === 1 && !set.has(value));

/**
 * Do the addresses shown (addressesShown) point somewhere else than `href`?
 * Another mailbox, for an email address shown over an email link; another
 * site, in every other pairing. An `href` that isn't a web or email address
 * counts every address shown as somewhere else.
 */
export function showsAnotherAddress(shown: ShownAddresses | null, href: string): boolean {
  if (!shown) return false;
  if (shown.elsewhere) return true;
  const link = targetOf(href);
  if (!link || link.site === null) return true;
  if (link.kind === "email") return holdsOther(shown.mailboxes, link.mailbox) || holdsOther(shown.webSites, link.site);
  return holdsOther(shown.webSites, link.site) || holdsOther(shown.emailSites, link.site);
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
