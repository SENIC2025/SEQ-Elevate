/**
 * The sign-in address rule (D116): what an email address must be before the
 * site sends it a sign-in link or an invitation, or stores it for an account.
 * One function, used by both Auth.js email providers (`normalizeIdentifier`
 * in src/auth.ts), the sign-in form's action, the invitation flow and adding
 * people, so an address that can't sign in can't be stored either.
 *
 * Normalised first, then checked:
 * 1. Normalised: surrounding white space trimmed, Unicode compatibility forms
 *    folded (NFKC: a full-width letter or full stop becomes its plain form),
 *    lower-cased.
 * 2. Checked, on the result: plain printable ASCII in the grammar of the
 *    browser's own email field (WHATWG HTML: letters, digits and
 *    .!#$%&'*+/=?^_`{|}~- before the "@"; a host name of letters, digits and
 *    hyphens in dot-separated labels after it), so no white space, control
 *    character, quote, comma or bracket; exactly one "@", with a local part
 *    before it and a domain with a dot after it; at most 254 characters (the
 *    longest address SMTP carries). An "@" must be the plain "@": a character
 *    that only folds into one (a full-width or small "@") is refused, as the
 *    browser's field refuses it.
 *
 * What passes is the address every later step uses: the one looked up,
 * stored, counted, and handed to the email service. It is already in its
 * folded, plain form, so no later step can read it as another address.
 *
 * A plain module (no "server-only"): the rule is the same wherever it runs.
 */

/** The longest address accepted, in characters (RFC 5321's path limit, less the brackets). */
export const MAX_SIGN_IN_ADDRESS = 254;

/** The browser email field's grammar (WHATWG HTML), lower case, with at least one dot in the domain. */
const LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

const countAt = (s: string) => s.split("@").length - 1;

/**
 * The address, normalised, when it follows the rule above; null when it
 * doesn't (or isn't text). Never throws.
 */
export function signInAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const folded = trimmed.normalize("NFKC");
  // An "@" that only folding made (a look-alike) is refused, not repaired.
  if (countAt(folded) !== countAt(trimmed)) return null;
  const address = folded.toLowerCase();
  if (address.length === 0 || address.length > MAX_SIGN_IN_ADDRESS) return null;
  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!LOCAL.test(local) || !DOMAIN.test(domain)) return null;
  return address;
}

/**
 * For Auth.js's `normalizeIdentifier`: the address, normalised, or an error
 * (which Auth.js turns into its error page, sending and storing nothing).
 * The error never repeats the address.
 */
export function normalizeIdentifier(identifier: string): string {
  const address = signInAddress(identifier);
  if (address === null) throw new Error("This email address can't be used to sign in.");
  return address;
}
