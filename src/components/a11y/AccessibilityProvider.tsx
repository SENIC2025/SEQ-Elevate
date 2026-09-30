"use client";

import * as React from "react";
import { getSession, useSession } from "next-auth/react";
import { loadA11yPrefs, saveA11yPrefs } from "@/app/actions/a11y";
import {
  DEFAULT_A11Y_PREFS,
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
import { ownerChange, signedInAgain } from "./session-hold";

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

function writeLocal(local: LocalPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeLocalPrefs(local));
  } catch {
    /* ignore */
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
 * account whose settings loaded, and never lands in another; a session
 * that can't be read for a moment doesn't let go of them (see
 * a11y-prefs.ts, prefs-save.ts and session-hold.ts).
 */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<A11yPrefs>(DEFAULT_A11Y_PREFS);
  const [hydrated, setHydrated] = React.useState(false);
  const [dbReady, setDbReady] = React.useState(false);

  const { data: session, status, update } = useSession();
  // Whose settings the session gives: the signed-in account, null for a
  // guest, undefined while the session loads (see session-owner.ts).
  const owner = sessionOwner(status, session?.user);
  // Whose settings these are: the session's owner, but still the account
  // while its session can't be read for a moment (a hold, see
  // session-hold.ts). Undefined until the session first loads. In a ref
  // too, for the setters and the load.
  const [actingFor, setActingFor] = React.useState<string | null | undefined>(
    undefined
  );
  const actingForRef = React.useRef<string | null | undefined>(undefined);
  const actFor = React.useCallback((next: string | null) => {
    actingForRef.current = next;
    setActingFor(next);
  }, []);

  // The settings the user changed while the account's settings were
  // loading, so a late-arriving DB load can't clobber a choice they've
  // already made (the async-load race). Per setting: the others are still
  // the saved ones (see prefsAfterLoad).
  const chosen = React.useRef<Partial<A11yPrefs>>({});
  // The settings chosen in this browser that no account holds yet — a
  // guest's, or chosen while an account's settings load — kept with this
  // browser's copy. Only these move into an account still on the defaults
  // (see LocalPrefs).
  const unclaimed = React.useRef<Partial<A11yPrefs>>({});
  // The account whose saved settings have loaded: the only one saved for.
  const loadedFor = React.useRef<string | null>(null);
  // What the server holds as far as this page knows — the settings loaded,
  // or the last ones sent; null when that isn't known. Settings that match
  // it aren't sent.
  const onServer = React.useRef<A11yPrefs | null>(null);
  // The settings on screen, for this browser's copy written from a save.
  const shown = React.useRef<A11yPrefs>(DEFAULT_A11Y_PREFS);
  // The debounced save (see prefs-save.ts).
  const [save] = React.useState(() => prefsSave(600));
  // next-auth's "read the session again, and tell the other tabs", for the
  // session effect below: the latest one, without re-running it.
  const updateSession = React.useRef(update);
  React.useEffect(() => {
    updateSession.current = update;
  }, [update]);

  // User-facing setters. Until an account's settings have loaded here — a
  // guest, the session loading, an account's settings loading — a choice
  // is recorded (see `chosen`) and no account holds it yet (`unclaimed`).
  // Once they have, it's the account's, also while a hold keeps them: it
  // never moves into another account.
  const choose = React.useCallback((patch: Partial<A11yPrefs>) => {
    const account = actingForRef.current;
    if (typeof account !== "string" || loadedFor.current !== account) {
      chosen.current = { ...chosen.current, ...patch };
      unclaimed.current = { ...unclaimed.current, ...patch };
    }
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);
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

  // Lets go of the settings held: the save still waiting, or still being
  // tried, was made for their owner and is dropped, since the cookie may
  // already be someone else's (the server drops it too, see isPrefsOwner).
  // A choice made before this isn't one made while the next owner's
  // settings load, and nothing is saved again until they have loaded.
  const letGo = React.useCallback(() => {
    save.drop();
    chosen.current = {};
    loadedFor.current = null;
    onServer.current = null;
    setDbReady(false);
  }, [save]);

  // ---- The session changed hands, or can't be read ----
  // Someone signed in, or another account signed in in another tab: the
  // settings held are let go of, and loaded again for the new owner. An
  // account's session finding no one — signed out in another tab, or a
  // lookup that failed for a moment, which look the same (see
  // session-hold.ts): its settings are held, not reloaded, and the session
  // read again. What was waiting to be saved is sent now, for the account
  // it was made for (the server refuses it for anyone else, and a save
  // that finds no one is tried again); nothing new is saved meanwhile. The
  // account found again, what's on screen is saved as it is, choices made
  // meanwhile included; still no one, it's let go of. Declared before the
  // effects below, which see the reset refs in the same commit.
  React.useEffect(() => {
    if (owner === undefined) return;
    const change = ownerChange(actingForRef.current, owner);
    if (change === "hold") {
      save.flush();
      const abort = new AbortController();
      signedInAgain(
        // Read without telling the other tabs, and without this tab's
        // session going to "loading" (which would end the hold).
        async () => !!(await getSession({ broadcast: false }))?.user,
        { signal: abort.signal }
      ).then(
        (found) => {
          if (abort.signal.aborted) return;
          if (found) {
            // Someone is signed in: this tab takes the session up, and
            // this effect sees who (the same account, or another).
            void updateSession.current();
            return;
          }
          // Still no one: signed out.
          letGo();
          actFor(null);
        },
        () => {
          /* the session changed meanwhile */
        }
      );
      return () => abort.abort();
    }
    if (change === "change") letGo();
    actFor(owner);
  }, [owner, save, letGo, actFor]);

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (actingFor === undefined) return;
    const local = readLocal();
    // The settings no account holds yet: this browser's copy's, and those
    // chosen on this page (before the session loaded, the copy isn't
    // written yet).
    unclaimed.current = { ...local?.unclaimed, ...unclaimed.current };
    // Instant paint from this browser's copy (a guest's only copy; for an
    // account, while its settings load). A setting already chosen stays.
    if (local) setPrefs({ ...local.prefs, ...chosen.current });
    setHydrated(true);
    if (actingFor === null) return;

    // Nothing is saved until the account's settings have loaded, so a
    // failed try doesn't end it: it's tried again (see retry.ts), and what
    // the user chooses meanwhile is shown, kept in this browser, and saved
    // once a try gets through. A session lookup that failed is a failed
    // try too: the load fails rather than answer "no saved settings" (see
    // signedInUser in actions/a11y.ts).
    const forUser = actingFor;
    const abort = new AbortController();
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
      if (abort.signal.aborted || actingForRef.current !== forUser) return;
      // The DB wins, apart from the first-login migration and what was
      // chosen while it loaded (see prefsAfterLoad); the save below sends
      // what differs.
      const after = prefsAfterLoad(saved, unclaimed.current, chosen.current);
      setPrefs(after.prefs);
      chosen.current = {};
      // Moved in, the settings no account held stay this browser's until
      // the account's save of them is confirmed (below): a save lost on
      // the way moves them in again on the next visit. Not moved in — the
      // account has settings of its own — no account takes them.
      if (!after.movedIn) unclaimed.current = {};
      onServer.current = saved;
      loadedFor.current = forUser;
      setDbReady(true);
    })();
    return () => abort.abort();
  }, [actingFor]);

  // ---- Apply to <html> + mirror to this browser (always) ----
  React.useEffect(() => {
    const html = document.documentElement;
    if (prefs.fontSize === "normal") html.removeAttribute("data-font-size");
    else html.setAttribute("data-font-size", prefs.fontSize);
    html.setAttribute("data-dyslexic", String(prefs.dyslexia));
    html.setAttribute("data-contrast", String(prefs.contrast));

    shown.current = prefs;
    if (!hydrated) return;
    writeLocal({ prefs, unclaimed: unclaimed.current });
  }, [prefs, hydrated]);

  // ---- DB write-through (debounced) ----
  // Only for the account whose settings have loaded (dbReady, loadedFor —
  // reset in the commit where the session changes hands), and only while
  // its session is read (not during a hold): before that, what's shown is
  // this browser's copy or the defaults, and it would be saved over
  // theirs. Nothing is sent while the settings match what the server
  // holds: just loaded, or a change undone before its save went out.
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
      send: async () => {
        onServer.current = next;
        const saved = await saveA11yPrefs(next, forUser);
        // The account holds the settings moved in now: they're no longer
        // this browser's to move into an account.
        if (
          saved &&
          loadedFor.current === forUser &&
          Object.keys(unclaimed.current).length > 0
        ) {
          unclaimed.current = {};
          writeLocal({ prefs: shown.current, unclaimed: {} });
        }
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
