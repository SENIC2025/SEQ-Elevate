"use server";

/**
 * User-global accessibility preferences: font size, dyslexia-friendly font,
 * high contrast. Unlike learner progress these are NOT project-scoped — they
 * live on the User and follow the person across every project and device.
 * Persisting them matters especially for this audience: a learner who sets a
 * dyslexia-friendly font on a shared computer should find it already on their
 * phone.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isPrefsOwner, toA11yPrefs, type A11yPrefs } from "@/lib/a11y-prefs";

/**
 * The signed-in user, for the settings' load and save. AccessibilityProvider
 * calls them only once the session says someone is signed in, so no user
 * here means the session lookup failed, not that nothing is saved: Auth.js's
 * database session lookup logs a database error (a cold start, a dropped
 * connection) and answers "no session" instead of failing. Answering "no
 * saved settings" had the provider show the defaults and save them over the
 * user's own, and answering a save as done would lose it, so this fails,
 * and the provider tries again (src/components/a11y/prefs-save.ts,
 * src/store/retry.ts). A real sign-out ends the same way: nothing loads or
 * saves, and the provider stops trying once it sees the session change.
 */
async function signedInUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No signed-in user, or the session lookup failed");
  return user;
}

/** The signed-in user's saved accessibility preferences. */
export async function loadA11yPrefs(): Promise<A11yPrefs> {
  const user = await signedInUser();
  return toA11yPrefs({
    fontSize: user.fontSize,
    // Schema field is `dyslexic`; the client uses `dyslexia`.
    dyslexia: user.dyslexic,
    contrast: user.contrast,
  });
}

/**
 * Persist the signed-in user's accessibility preferences. They must be
 * `forUser`, the account whose settings the provider loaded (isPrefsOwner):
 * a save still on its way when another account signed in on this browser
 * is dropped, not written to that account.
 */
export async function saveA11yPrefs(prefs: A11yPrefs, forUser: string) {
  const user = await signedInUser();
  if (!isPrefsOwner(user, forUser)) return;
  if (!prefs || typeof prefs !== "object") throw new Error("Invalid settings");
  const p = toA11yPrefs(prefs);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      fontSize: p.fontSize,
      dyslexic: p.dyslexia,
      contrast: p.contrast,
    },
  });
}
