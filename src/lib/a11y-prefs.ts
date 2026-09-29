/**
 * Reading-help (accessibility) settings: text size, a dyslexia-friendly
 * ("easy-read") font, high contrast. Shared by the server actions
 * (src/app/actions/a11y.ts) and AccessibilityProvider, which applies the
 * rules below — no React, no database.
 */

export type FontSize = "normal" | "lg" | "xl";

export interface A11yPrefs {
  fontSize: FontSize;
  dyslexia: boolean;
  contrast: boolean;
}

export const FONT_SIZES: readonly FontSize[] = ["normal", "lg", "xl"];

export const DEFAULT_A11Y_PREFS: A11yPrefs = {
  fontSize: "normal",
  dyslexia: false,
  contrast: false,
};

/**
 * `raw` as settings: a font size that isn't one of FONT_SIZES is "normal",
 * and the two switches are on only when they're `true`. For what comes
 * from outside the code — the database, this browser's copy, a request.
 */
export function toA11yPrefs(raw: {
  fontSize?: unknown;
  dyslexia?: unknown;
  contrast?: unknown;
}): A11yPrefs {
  return {
    fontSize: (FONT_SIZES as readonly unknown[]).includes(raw.fontSize)
      ? (raw.fontSize as FontSize)
      : "normal",
    dyslexia: raw.dyslexia === true,
    contrast: raw.contrast === true,
  };
}

export function isDefaultPrefs(p: A11yPrefs): boolean {
  return samePrefs(p, DEFAULT_A11Y_PREFS);
}

export function samePrefs(a: A11yPrefs, b: A11yPrefs): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.dyslexia === b.dyslexia &&
    a.contrast === b.contrast
  );
}

/**
 * This browser's copy of the settings (localStorage): a guest's only
 * copy, and for a signed-in user a mirror for an instant paint on the next
 * load, kept after they sign out. `fromAccount` says whose they are: true
 * once they're a signed-in account's (loaded from it, or chosen while
 * signed in), false while they're a guest's own choice. Only a guest's own
 * settings move into an account (prefsAfterLoad): an account's must not
 * move into the next account that signs in on this browser.
 */
export interface LocalPrefs {
  prefs: A11yPrefs;
  fromAccount: boolean;
}

/**
 * The stored copy (`raw`, as localStorage holds it), or null if there is
 * none or it can't be read. A copy stored before `fromAccount` was kept
 * counts as a guest's, as every copy did then.
 */
export function parseLocalPrefs(raw: string | null): LocalPrefs | null {
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      prefs: toA11yPrefs(p),
      fromAccount: (p as { fromAccount?: unknown }).fromAccount === true,
    };
  } catch {
    return null;
  }
}

/** The stored copy of `local`, as parseLocalPrefs reads it back. */
export function serializeLocalPrefs(local: LocalPrefs): string {
  return JSON.stringify({ ...local.prefs, fromAccount: local.fromAccount });
}

/**
 * The settings to show once an account's saved settings (`saved`) have
 * loaded. The saved ones win, except:
 *
 * - on first sign-in, an account still on the defaults takes the settings
 *   a guest chose in this browser (`guest`; null when what this browser
 *   holds is an account's — see LocalPrefs);
 * - a setting chosen while they loaded (`chosen`, one entry per setting
 *   the user changed) is newer, and kept. The settings not chosen are the
 *   saved ones: the whole on-screen set would save this browser's copy, or
 *   the defaults, over them.
 */
export function prefsAfterLoad(
  saved: A11yPrefs,
  guest: A11yPrefs | null,
  chosen: Partial<A11yPrefs>
): A11yPrefs {
  const base =
    guest && isDefaultPrefs(saved) && !isDefaultPrefs(guest) ? guest : saved;
  return { ...base, ...chosen };
}

/**
 * Is `user` the account a save was made for? The provider sends whose
 * settings it saves (`forUser`: the account whose settings it loaded —
 * their id, or their email if a session had no id; see sessionOwner in
 * src/store/session-owner.ts). A save still on its way when another
 * account signed in on this browser must not land in that account: it's
 * dropped. A call without it comes from a page loaded before the provider
 * sent it, and is saved for whoever is signed in, as it was then.
 */
export function isPrefsOwner(
  user: { id: string; email: string | null },
  forUser: unknown
): boolean {
  if (typeof forUser !== "string") return true;
  return user.id === forUser || (user.email !== null && user.email === forUser);
}

/**
 * Has the session changed hands, from `held` to `now` (see sessionOwner:
 * an account, null for a guest, undefined while the session loads)? Signed
 * in, signed out, or another account signed in — not the session loading,
 * nor the first owner it finds.
 */
export function ownerChanged(
  held: string | null | undefined,
  now: string | null | undefined
): boolean {
  return held !== undefined && now !== undefined && now !== held;
}
