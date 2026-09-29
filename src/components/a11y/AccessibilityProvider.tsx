"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { loadA11yPrefs, saveA11yPrefs } from "@/app/actions/a11y";
import {
  DEFAULT_A11Y_PREFS,
  ownerChanged,
  parseLocalPrefs,
  prefsAfterLoad,
  samePrefs,
  serializeLocalPrefs,
  type A11yPrefs,
  type FontSize,
  type LocalPrefs,
} from "@/lib/a11y-prefs";
import { withRetry } from "@/store/retry";
import { sessionOwner } from "@/store/session-owner";
import { prefsSave } from "./prefs-save";

interface A11yState {
  fontSize: FontSize;
  dyslexia: boolean;
  contrast: boolean;
  setFontSize: (s: FontSize) => void;
  setDyslexia: (v: boolean) => void;
  setContrast: (v: boolean) => void;
}

const A11yContext = React.createContext<A11yState | null>(null);

const STORAGE_KEY = "seq-elevate-a11y-v1";

function readLocal(): LocalPrefs | null {
  try {
    return parseLocalPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Accessibility preferences. For AUTHENTICATED users they persist to the
 * User row (Postgres) and follow the learner across devices; for GUESTS
 * they fall back to localStorage. localStorage is also kept as a mirror for
 * authed users — for instant paint on the next load and to survive sign-out.
 *
 * A signed-in user's saved settings are only saved over once they have
 * loaded (dbReady): until then what's on screen is this browser's copy or
 * the defaults, not theirs. A load that fails — or finds no session, which
 * is what a failed session lookup looks like — is tried again (retry.ts),
 * and nothing is saved until a try gets through. Each save is made for the
 * account whose settings loaded, and never lands in another (see
 * a11y-prefs.ts and prefs-save.ts).
 */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<A11yPrefs>(DEFAULT_A11Y_PREFS);
  const [hydrated, setHydrated] = React.useState(false);
  const [dbReady, setDbReady] = React.useState(false);

  const { data: session, status } = useSession();
  // Whose settings these are: the signed-in account, null for a guest,
  // undefined while the session loads (see session-owner.ts).
  const owner = sessionOwner(status, session?.user);

  // The settings the user changed while the account's settings were
  // loading, so a late-arriving DB load can't clobber a choice they've
  // already made (the async-load race). Per setting: the others are still
  // the saved ones (see prefsAfterLoad).
  const chosen = React.useRef<Partial<A11yPrefs>>({});
  // Whether the settings shown are an account's or a guest's own choice;
  // kept with this browser's copy (see LocalPrefs).
  const fromAccount = React.useRef(false);
  // The account whose saved settings have loaded: the only one saved for.
  const loadedFor = React.useRef<string | null>(null);
  // What the server holds as far as this page knows — the settings loaded,
  // or the last ones sent; null when that isn't known. Settings that match
  // it aren't sent.
  const onServer = React.useRef<A11yPrefs | null>(null);
  // The debounced save (see prefs-save.ts).
  const [save] = React.useState(() => prefsSave(600));

  // User-facing setters record the choice (see `chosen`) — as the
  // account's while someone is signed in, as a guest's while no one is.
  const choose = React.useCallback(
    (patch: Partial<A11yPrefs>) => {
      chosen.current = { ...chosen.current, ...patch };
      if (owner !== undefined) fromAccount.current = owner !== null;
      setPrefs((p) => ({ ...p, ...patch }));
    },
    [owner]
  );
  const setFontSize = React.useCallback(
    (fontSize: FontSize) => choose({ fontSize }),
    [choose]
  );
  const setDyslexia = React.useCallback(
    (dyslexia: boolean) => choose({ dyslexia }),
    [choose]
  );
  const setContrast = React.useCallback(
    (contrast: boolean) => choose({ contrast }),
    [choose]
  );

  // ---- The session changed hands: start over for the new owner ----
  // Signed in, signed out (or the session couldn't be read), or another
  // account signed in in another tab. The save still waiting, or still
  // being tried, was made for the previous owner: it's dropped, since the
  // cookie may already be someone else's (the server drops it too, see
  // isPrefsOwner). A choice made before this isn't one made while the new
  // owner's settings load, and nothing is saved again until they have
  // loaded (below). Declared before the effects below, which see the reset
  // refs in the same commit.
  const heldBy = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const held = heldBy.current;
    if (owner !== undefined) heldBy.current = owner;
    if (!ownerChanged(held, owner)) return;
    save.drop();
    chosen.current = {};
    loadedFor.current = null;
    onServer.current = null;
    setDbReady(false);
  }, [owner, save]);

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (owner === undefined) return;
    const local = readLocal();
    if (Object.keys(chosen.current).length > 0) {
      // Chosen while the session loaded: this owner's choice.
      fromAccount.current = owner !== null;
    } else if (local) {
      fromAccount.current = local.fromAccount;
    }
    // Instant paint from this browser's copy (a guest's only copy; for an
    // account, while its settings load). A setting already chosen stays.
    if (local) setPrefs({ ...local.prefs, ...chosen.current });
    setHydrated(true);
    if (owner === null) return;

    // Nothing is saved until the account's settings have loaded, so a
    // failed try doesn't end it: it's tried again (see retry.ts), and what
    // the user chooses meanwhile is shown, kept in this browser, and saved
    // once a try gets through. A session lookup that failed is a failed
    // try too: the load fails rather than answer "no saved settings" (see
    // signedInUser in actions/a11y.ts).
    const abort = new AbortController();
    // First-login migration: an account with no custom settings yet takes
    // the ones a guest chose in this browser — never another account's.
    const guest = local && !local.fromAccount ? local.prefs : null;
    (async () => {
      let saved: A11yPrefs;
      try {
        saved = await withRetry(() => loadA11yPrefs(), { signal: abort.signal });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error(
            "Couldn't load the reading-help settings; they aren't saved on this visit.",
            err
          );
        }
        return;
      }
      if (abort.signal.aborted) return;
      // The DB wins, apart from the migration and what was chosen while
      // it loaded (see prefsAfterLoad); the save below sends what differs.
      setPrefs(prefsAfterLoad(saved, guest, chosen.current));
      chosen.current = {};
      fromAccount.current = true;
      onServer.current = saved;
      loadedFor.current = owner;
      setDbReady(true);
    })();
    return () => abort.abort();
  }, [owner]);

  // ---- Apply to <html> + mirror to this browser (always) ----
  React.useEffect(() => {
    const html = document.documentElement;
    if (prefs.fontSize === "normal") html.removeAttribute("data-font-size");
    else html.setAttribute("data-font-size", prefs.fontSize);
    html.setAttribute("data-dyslexic", String(prefs.dyslexia));
    html.setAttribute("data-contrast", String(prefs.contrast));

    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        serializeLocalPrefs({ prefs, fromAccount: fromAccount.current })
      );
    } catch {
      /* ignore */
    }
  }, [prefs, hydrated]);

  // ---- DB write-through (debounced) ----
  // Only for the account whose settings have loaded (dbReady, loadedFor —
  // reset in the commit where the session changes hands): before that,
  // what's shown is this browser's copy or the defaults, and it would be
  // saved over theirs. Nothing is sent while the settings match what the
  // server holds: just loaded, or a change undone before its save went out.
  React.useEffect(() => {
    if (!dbReady || typeof owner !== "string" || loadedFor.current !== owner) {
      return;
    }
    if (onServer.current && samePrefs(prefs, onServer.current)) {
      save.cancel();
      return;
    }
    const next = prefs;
    const forUser = owner;
    save.schedule({
      send: () => {
        onServer.current = next;
        return saveA11yPrefs(next, forUser);
      },
      onGiveUp: (err) => {
        onServer.current = null;
        console.error("Couldn't save the reading-help settings.", err);
      },
    });
  }, [prefs, dbReady, owner, save]);

  // ---- Unmounting: send what's still waiting now ----
  // Not left to a timer outliving the provider: sent now, it reaches the
  // server before a provider mounted next loads the settings back.
  React.useEffect(() => () => save.flush(), [save]);

  return (
    <A11yContext.Provider
      value={{
        ...prefs,
        setFontSize,
        setDyslexia,
        setContrast,
      }}
    >
      {children}
    </A11yContext.Provider>
  );
}

export function useA11y() {
  const ctx = React.useContext(A11yContext);
  if (!ctx) throw new Error("useA11y must be used inside AccessibilityProvider");
  return ctx;
}
