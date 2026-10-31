"use server";

/**
 * Auth server actions.
 *
 * signInWithEmail triggers the magic-link flow. In dev without a Resend
 * key, the link is logged to the server console (see src/auth.ts).
 */

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { signInAddress } from "@/lib/signin-address";
import { SIGN_IN_EMAIL_LIMITED, signInErrorType } from "@/lib/signin-result";

/** Why the form's address got no link, when the form is the one to say so. */
export type SignInFormError = "invalid-email" | "rate-limited";

/**
 * Ask for a sign-in link. The address is checked with the sign-in rule
 * (D116) before Auth.js is asked for anything, and Auth.js is asked for the
 * normalised address. Over a sign-in email limit (D116), Auth.js answers with
 * the sign-in page and `error=rate-limited`: the form is told, and stays.
 * Anything else Auth.js answers ("check your email", its error page) is
 * followed, as before.
 */
export async function signInWithEmail(formData: FormData): Promise<{ error: SignInFormError } | undefined> {
  const email = signInAddress(formData.get("email"));
  if (email === null) return { error: "invalid-email" };
  const callbackUrl = String(formData.get("callbackUrl") ?? "/en");
  const url: string = await signIn("resend", { email, redirectTo: callbackUrl, redirect: false });
  if (signInErrorType(url) === SIGN_IN_EMAIL_LIMITED) return { error: "rate-limited" };
  redirect(url);
}

export async function signOutAction() {
  await signOut({ redirectTo: "/en" });
}
