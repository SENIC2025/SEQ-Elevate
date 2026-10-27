/**
 * The way to sign in from a page that needs an account (a staff page's
 * access notice, SignInPrompt): the sign-in page in the page's language,
 * with the page's own path as `callbackUrl`. The sign-in page hands it to
 * Auth.js as the address the email's link lands on, and Auth.js lands only
 * on a path, or on an address of its own origin. So the way back is only
 * ever a path of this site: anything else ("//host", "/\host", an address
 * with a scheme, a control character the URL parser would drop) is left
 * out, and the sign-in page lands on the language's home page as before.
 *
 * Pure: the page's path comes from its caller (SignInHereLink).
 */

import { routing } from "@/i18n/routing";

const ORIGIN = "http://same-site.invalid";

/** Is `path` a path that stays on this site, read as a browser reads it against any address of it? */
export function isSameSitePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  // A backslash reads as a slash ("/\host" is "//host"); the URL parser drops
  // tabs and line breaks ("/\t/host" is "//host"). Neither is in a page's path.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return false;
  }
  try {
    return new URL(path, ORIGIN).origin === ORIGIN;
  } catch {
    return false;
  }
}

/** The sign-in page for `locale` (one of the platform's, else English), with `from` as the way back when it is a path of this site. */
export function signInHref(locale: string, from: string): string {
  const lang = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  const page = `/${lang}/signin`;
  return isSameSitePath(from) ? `${page}?callbackUrl=${encodeURIComponent(from)}` : page;
}
