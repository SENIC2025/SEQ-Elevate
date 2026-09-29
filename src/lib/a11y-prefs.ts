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
 * `raw` as the settings it holds validly, one by one: a setting it doesn't
 * hold, or holds a value for that isn't one (see toA11yPrefs), is left out.
 */
export function toPartialPrefs(raw: unknown): Partial<A11yPrefs> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { fontSize?: unknown; dyslexia?: unknown; contrast?: unknown };
  const out: Partial<A11yPrefs> = {};
  if ((FONT_SIZES as readonly unknown[]).includes(r.fontSize)) {
    out.fontSize = r.fontSize as FontSize;
  }
  if (typeof r.dyslexia === "boolean") out.dyslexia = r.dyslexia;
  if (typeof r.contrast === "boolean") out.contrast = r.contrast;
  return out;
}

/**
 * This browser's copy of the settings (localStorage): a guest's only
 * copy, and for a signed-in user a mirror for an instant paint on the next
 * load, kept after they sign out — so what's shown (`prefs`) may be an
 * account's. `unclaimed` are the settings chosen in this browser that no
 * account holds yet, one entry per setting chosen: a guest's, or chosen
 * while an account's settings loaded. Only these move into an account
 * (prefsAfterLoad): an account's settings must not move into the next
 * account that signs in on this browser, and a guest's choice made on top
 * of them moves in alone. They're kept until an account holds them — its
 * save of them confirmed — so a save lost on the way (the page closed
 * within the debounce, every try failed) is made again on the next visit.
 */
export interface LocalPrefs {
  prefs: A11yPrefs;
  unclaimed: Partial<A11yPrefs>;
}

/**
 * The stored copy (`raw`, as localStorage holds it), or null if there is
 * none or it can't be read. A copy stored before `unclaimed` was kept is
 * all a guest's, as every copy counted then.
 */
export function parseLocalPrefs(raw: string | null): LocalPrefs | null {
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const prefs = toA11yPrefs(p);
    const unclaimed = (p as { unclaimed?: unknown }).unclaimed;
    return {
      prefs,
      unclaimed: unclaimed === undefined ? { ...prefs } : toPartialPrefs(unclaimed),
    };
  } catch {
    return null;
  }
}

/** The stored copy of `local`, as parseLocalPrefs reads it back. */
export function serializeLocalPrefs(local: LocalPrefs): string {
  return JSON.stringify({ ...local.prefs, unclaimed: local.unclaimed });
}

/**
 * The settings to show once an account's saved settings (`saved`) have
 * loaded. The saved ones win, except:
 *
 * - on first sign-in, an account still on the defaults takes the settings
 *   chosen in this browser that no account holds (`unclaimed`, see
 *   LocalPrefs) — the defaults for those not chosen. `movedIn` says it
 *   did: they're this account's to save, and no one else's to take;
 * - a setting chosen while they loaded (`chosen`, one entry per setting
 *   the user changed) is newer, and kept. The settings not chosen are the
 *   saved ones: the whole on-screen set would save this browser's copy, or
 *   the defaults, over them.
 */
export function prefsAfterLoad(
  saved: A11yPrefs,
  unclaimed: Partial<A11yPrefs>,
  chosen: Partial<A11yPrefs>
): { prefs: A11yPrefs; movedIn: boolean } {
  const guest: A11yPrefs = { ...DEFAULT_A11Y_PREFS, ...unclaimed };
  const movedIn = isDefaultPrefs(saved) && !isDefaultPrefs(guest);
  return { prefs: { ...(movedIn ? guest : saved), ...chosen }, movedIn };
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
