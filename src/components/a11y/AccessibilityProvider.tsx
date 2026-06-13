"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { loadA11yPrefs, saveA11yPrefs } from "@/app/actions/a11y";

type FontSize = "normal" | "lg" | "xl";

interface A11yState {
  fontSize: FontSize;
  dyslexia: boolean;
  contrast: boolean;
  setFontSize: (s: FontSize) => void;
  setDyslexia: (v: boolean) => void;
  setContrast: (v: boolean) => void;
}

interface Prefs {
  fontSize: FontSize;
  dyslexia: boolean;
  contrast: boolean;
}

const A11yContext = React.createContext<A11yState | null>(null);

const STORAGE_KEY = "seq-elevate-a11y-v1";

function isDefault(p: Prefs) {
  return p.fontSize === "normal" && !p.dyslexia && !p.contrast;
}

function readLocal(): Prefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      fontSize: (["normal", "lg", "xl"] as const).includes(p.fontSize)
        ? p.fontSize
        : "normal",
      dyslexia: !!p.dyslexia,
      contrast: !!p.contrast,
    };
  } catch {
    return null;
  }
}

/**
 * Accessibility preferences. For AUTHENTICATED users they persist to the
 * User row (Postgres) and follow the learner across devices; for GUESTS
 * they fall back to localStorage. localStorage is also kept as a mirror for
 * authed users — for instant paint on the next load and to survive sign-out.
 */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSize] = React.useState<FontSize>("normal");
  const [dyslexia, setDyslexia] = React.useState(false);
  const [contrast, setContrast] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [dbReady, setDbReady] = React.useState(false);

  const { status } = useSession();
  const authed = status === "authenticated";
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  // Set the moment the user changes a setting, so a late-arriving DB load
  // can't clobber a choice they've already made (the async-load race).
  const touched = React.useRef(false);

  // User-facing setters mark the prefs as touched.
  const setFontSizeUser = React.useCallback((s: FontSize) => {
    touched.current = true;
    setFontSize(s);
  }, []);
  const setDyslexiaUser = React.useCallback((v: boolean) => {
    touched.current = true;
    setDyslexia(v);
  }, []);
  const setContrastUser = React.useCallback((v: boolean) => {
    touched.current = true;
    setContrast(v);
  }, []);

  // ---- Hydration: DB for authed users, localStorage for guests ----
  React.useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    const apply = (p: Prefs) => {
      setFontSize(p.fontSize);
      setDyslexia(p.dyslexia);
      setContrast(p.contrast);
    };
    (async () => {
      const local = readLocal();
      if (authed) {
        // Optimistic instant paint from the local mirror while the DB loads.
        if (local && !touched.current) apply(local);
        const db = await loadA11yPrefs();
        if (cancelled) return;
        // Don't overwrite a setting the user changed while the DB was loading.
        if (!touched.current) {
          let next: Prefs = db ?? {
            fontSize: "normal",
            dyslexia: false,
            contrast: false,
          };
          // First-login migration: if the account has no custom prefs yet but
          // the guest set some, carry them up. The DB wins in every other case.
          if (db && isDefault(db) && local && !isDefault(local)) {
            next = local;
            await saveA11yPrefs(next);
          }
          apply(next);
        }
        setDbReady(true);
      } else if (local && !touched.current) {
        apply(local);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, authed]);

  // ---- Apply to <html> + persist (localStorage mirror always; DB when authed) ----
  React.useEffect(() => {
    const html = document.documentElement;
    if (fontSize === "normal") html.removeAttribute("data-font-size");
    else html.setAttribute("data-font-size", fontSize);
    html.setAttribute("data-dyslexic", String(dyslexia));
    html.setAttribute("data-contrast", String(contrast));

    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fontSize, dyslexia, contrast })
      );
    } catch {
      /* ignore */
    }
    if (authed && dbReady) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveA11yPrefs({ fontSize, dyslexia, contrast });
      }, 600);
    }
  }, [fontSize, dyslexia, contrast, hydrated, authed, dbReady]);

  return (
    <A11yContext.Provider
      value={{
        fontSize,
        dyslexia,
        contrast,
        setFontSize: setFontSizeUser,
        setDyslexia: setDyslexiaUser,
        setContrast: setContrastUser,
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
