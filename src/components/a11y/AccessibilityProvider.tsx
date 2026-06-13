"use client";

import * as React from "react";

type FontSize = "normal" | "lg" | "xl";

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

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSize] = React.useState<FontSize>("normal");
  const [dyslexia, setDyslexia] = React.useState(false);
  const [contrast, setContrast] = React.useState(false);

  React.useEffect(() => {
    // Hydrate client-only persisted prefs on mount. localStorage isn't
    // available during SSR, so reading it here (not in a lazy initializer)
    // is the correct pattern — the synchronous setState is intentional.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.fontSize) setFontSize(parsed.fontSize);
        if (typeof parsed.dyslexia === "boolean") setDyslexia(parsed.dyslexia);
        if (typeof parsed.contrast === "boolean") setContrast(parsed.contrast);
      }
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  React.useEffect(() => {
    const html = document.documentElement;
    if (fontSize === "normal") html.removeAttribute("data-font-size");
    else html.setAttribute("data-font-size", fontSize);
    html.setAttribute("data-dyslexic", String(dyslexia));
    html.setAttribute("data-contrast", String(contrast));
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fontSize, dyslexia, contrast })
      );
    } catch {}
  }, [fontSize, dyslexia, contrast]);

  return (
    <A11yContext.Provider
      value={{ fontSize, dyslexia, contrast, setFontSize, setDyslexia, setContrast }}
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
