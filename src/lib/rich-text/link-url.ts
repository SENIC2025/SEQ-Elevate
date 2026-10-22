/**
 * The one address check for every link on the platform (D103): a named link
 * in lesson text, a pasted link, a quick link, a further-reading link, and
 * every stored address read back for a page. Each caller imports this module;
 * none keeps a copy of these rules.
 *
 * An address is accepted only when it is
 * - a web address, `https://…` or `http://…` (the scheme in any letter
 *   case), with a host that has a dot and no empty label, and no user name
 *   or password; or
 * - an email address, `mailto:` followed by the address and, at most, a
 *   `subject`;
 * - at most MAX_HREF_CHARS characters, before and after it is normalised;
 * - free of whitespace inside, control characters, invisible direction and
 *   zero-width marks, a byte-order mark and unpaired surrogates;
 * - not an Outlook safe link, which carries the address of the mailbox it
 *   was sent to (callers that want its target unwrap it first: toLinkInput
 *   and paste do; this check never unwraps).
 *
 * An accepted address comes back normalised: web addresses as the URL parser
 * writes them (ASCII: international hosts in punycode, other characters
 * percent-encoded), email addresses as given after `mailto:`. Checking a
 * normalised address again gives the same address.
 *
 * `ownFile` flags an address of our own file store; it is a flag, not a
 * refusal, and each caller decides (new links refuse it; quick links ignore
 * it). With `ownFileHost` given (BLOB_PUBLIC_HOST, see own-file-host.ts) it
 * is exactly that host; without one, every Vercel Blob store's public host
 * counts as ours, so a browser that doesn't know the host is stricter than
 * the server, never looser.
 *
 * Pure: no DOM, no server imports. It runs in the editor, the sanitizer, the
 * renderer, the server actions and node tests alike.
 */

export const MAX_HREF_CHARS = 2048;

export type LinkKind = "web" | "email";

/** Why an address can't be a link. */
export type LinkRefusal =
  /** Not a string, or nothing but spaces. */
  | "empty"
  /** Over MAX_HREF_CHARS characters, as given or once normalised. */
  | "too-long"
  /** Whitespace inside, or an invisible or control character. */
  | "characters"
  /** Not https://, http:// or mailto: (javascript:, data:, file:, a relative path, …). */
  | "scheme"
  /** A web address with a user name or password before its host. */
  | "credentials"
  /** A web address the URL parser refuses, or whose host has no dot. */
  | "host"
  /** A mailto: that isn't one email address with, at most, a subject. */
  | "email"
  /** An Outlook safe link. */
  | "redirect";

export type LinkCheck =
  | { ok: true; href: string; kind: LinkKind; insecure: boolean; ownFile: boolean }
  | { ok: false; reason: LinkRefusal };

/** The host every Vercel Blob store's public files are served from ends with this. */
export const BLOB_STORE_FAMILY = ".public.blob.vercel-storage.com";

/** Outlook's safe-link wrapper: this host, or any host under it. */
const SAFE_LINK_HOST = "safelinks.protection.outlook.com";

// Spaces trimmed from both ends: ASCII whitespace, as browsers strip it from
// an href. Every other space or invisible character is refused (below).
const isEndSpace = (code: number) =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;

/** `raw` without the ASCII whitespace at its ends (a loop: linear on any input). */
function trimEnds(raw: string): string {
  let from = 0;
  let to = raw.length;
  while (from < to && isEndSpace(raw.charCodeAt(from))) from++;
  while (to > from && isEndSpace(raw.charCodeAt(to - 1))) to--;
  return raw.slice(from, to);
}

// Whitespace of any kind; C0 controls, DEL and C1 controls; zero-width and
// direction marks (U+200B–U+200F), embeddings and overrides (U+202A–U+202E),
// isolates (U+2066–U+2069); the byte-order mark.
const FORBIDDEN =
  /[\s\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/u;

// Half of a surrogate pair without its other half: not a character, and
// Postgres refuses JSON holding one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A percent-encoded control character in an email link's subject would put
// a line break into the message's headers.
const ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f)/i;

// The parts of an email address (also what linkify.ts accepts as one).
const LOCAL_CHAR = /[\p{L}\p{N}\p{M}._+-]/u;
const DOMAIN_LABEL = /^[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?$/u;
const TOP_LEVEL = /^[\p{L}\p{M}]{2,}$/u;

/** "user@example.org": a user part and a domain with a dot, nothing else. */
export function isEmailAddress(address: string): boolean {
  const at = address.indexOf("@");
  if (at <= 0 || at !== address.lastIndexOf("@")) return false;
  const local = address.slice(0, at);
  for (const char of local) if (!LOCAL_CHAR.test(char)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  const labels = address.slice(at + 1).split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TOP_LEVEL.test(labels[labels.length - 1]);
}

/** A host name as compared here: lower case, without a trailing dot. */
export function comparableHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/** Is `hostname` Outlook's safe-link wrapper? */
export function isSafeLinkHost(hostname: string): boolean {
  const host = comparableHost(hostname);
  return host === SAFE_LINK_HOST || host.endsWith(`.${SAFE_LINK_HOST}`);
}

const refuse = (reason: LinkRefusal): LinkCheck => ({ ok: false, reason });

/**
 * Whether `raw` can be a link, and its normalised address if it can. Never
 * throws; a string over MAX_HREF_CHARS is refused before it is parsed.
 */
export function checkLinkHref(raw: unknown, opts?: { ownFileHost?: string | null }): LinkCheck {
  if (typeof raw !== "string") return refuse("empty");
  const typed = trimEnds(raw);
  if (!typed) return refuse("empty");
  if (typed.length > MAX_HREF_CHARS) return refuse("too-long");
  if (FORBIDDEN.test(typed) || LONE_SURROGATE.test(typed)) return refuse("characters");

  const start = typed.slice(0, 8).toLowerCase();
  if (start.startsWith("https://") || start.startsWith("http://")) return web(typed, opts);
  if (start.startsWith("mailto:")) return email(typed.slice("mailto:".length));
  return refuse("scheme");
}

function web(typed: string, opts?: { ownFileHost?: string | null }): LinkCheck {
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return refuse("host");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return refuse("scheme");
  // "https://bank.example@evil.example" goes to evil.example.
  if (url.username || url.password) return refuse("credentials");
  // A host with a dot ("example.org", "192.0.2.1"), its labels not empty.
  const host = comparableHost(url.hostname);
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return refuse("host");
  if (isSafeLinkHost(host)) return refuse("redirect");
  const href = url.href;
  if (href.length > MAX_HREF_CHARS) return refuse("too-long");
  return {
    ok: true,
    href,
    kind: "web",
    insecure: url.protocol === "http:",
    ownFile: isOwnFileHost(host, opts?.ownFileHost),
  };
}

/** `rest`: what follows "mailto:", as typed. */
function email(rest: string): LinkCheck {
  const q = rest.indexOf("?");
  const address = q < 0 ? rest : rest.slice(0, q);
  if (!isEmailAddress(address)) return refuse("email");
  if (q >= 0) {
    // Only a subject: a link must not copy a learner's message to someone
    // unseen (cc, bcc) or write it for them (body).
    const query = rest.slice(q + 1);
    if (!/^subject=/i.test(query) || query.includes("&") || ENCODED_CONTROL.test(query)) {
      return refuse("email");
    }
  }
  return { ok: true, href: `mailto:${rest}`, kind: "email", insecure: false, ownFile: false };
}

/** Is `host` (comparable) our own file store's? */
function isOwnFileHost(host: string, ownFileHost: string | null | undefined): boolean {
  const own = ownFileHost ? comparableHost(ownFileHost) : "";
  if (own) return host === own;
  return host.endsWith(BLOB_STORE_FAMILY);
}

/**
 * The bare email address of an accepted `mailto:` address (no scheme, no
 * query), or null for anything else.
 */
export function emailAddressOf(href: string): string | null {
  if (!/^mailto:/i.test(href)) return null;
  const rest = href.slice("mailto:".length);
  const q = rest.indexOf("?");
  const address = q < 0 ? rest : rest.slice(0, q);
  return isEmailAddress(address) ? address : null;
}
