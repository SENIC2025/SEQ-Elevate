"use server";

/**
 * Auth server actions.
 *
 * signInWithEmail triggers the magic-link flow. In dev without a Resend
 * key, the link is logged to the server console (see src/auth.ts).
 */

import { signIn, signOut } from "@/auth";

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const callbackUrl = String(formData.get("callbackUrl") ?? "/en");
  if (!email) return;
  await signIn("resend", { email, redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/en" });
}
