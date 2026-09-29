/**
 * Reading the result of a server-side Auth.js email sign-in (invitations).
 *
 * With `redirect: false`, next-auth's signIn() does NOT throw when sending the
 * email fails: Auth.js catches the error, logs it, and hands back the URL of
 * its error page (…/api/auth/error?error=Configuration) instead. Only a
 * redirect to the "check your email" step (…/api/auth/verify-request) means
 * the email was actually handed to the email service. So "no exception" must
 * never be read as "sent" — that mistake once told an admin an invitation
 * had gone out when it hadn't.
 */

/** Did this signIn() result come from a successfully sent email? */
export function wasVerificationSent(result: unknown): boolean {
  if (typeof result !== "string") return false;
  try {
    return new URL(result, "http://localhost").pathname.endsWith(
      "/verify-request"
    );
  } catch {
    return false;
  }
}

/** The Auth.js error type in a failed result (e.g. "Configuration"), if any. */
export function signInErrorType(result: unknown): string | null {
  if (typeof result !== "string") return null;
  try {
    return new URL(result, "http://localhost").searchParams.get("error");
  } catch {
    return null;
  }
}
