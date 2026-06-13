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

export interface A11yPrefs {
  fontSize: "normal" | "lg" | "xl";
  dyslexia: boolean;
  contrast: boolean;
}

const FONT_SIZES = ["normal", "lg", "xl"] as const;

/** The current user's saved accessibility preferences, or null if guest. */
export async function loadA11yPrefs(): Promise<A11yPrefs | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    fontSize: (FONT_SIZES as readonly string[]).includes(user.fontSize)
      ? (user.fontSize as A11yPrefs["fontSize"])
      : "normal",
    // Schema field is `dyslexic`; the client uses `dyslexia`.
    dyslexia: user.dyslexic,
    contrast: user.contrast,
  };
}

/** Persist the current user's accessibility preferences (no-op for guests). */
export async function saveA11yPrefs(prefs: A11yPrefs) {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      fontSize: prefs.fontSize,
      dyslexic: prefs.dyslexia,
      contrast: prefs.contrast,
    },
  });
}
