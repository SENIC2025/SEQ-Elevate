"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * The course player's one polite live region (spec 5.2): what Continue
 * waits for, where the learner was taken on opening, what is still to do
 * before the course can finish. Every part of the player says things here
 * (useAnnounce), so there's one voice, never two regions talking over each
 * other — Release 1's sectioned view had its own.
 *
 * The region is at the end of <body>, outside the page's main landmark, so
 * the learner walk's snapshots of `main` keep their shape (spec 5.12). It
 * is there from the first client render, empty, so the first message is
 * announced. The same words said twice (Continue pressed again) are
 * announced again: every other time they carry a trailing no-break space,
 * which makes them new text.
 */

const AnnounceContext = createContext<(text: string) => void>(() => {});

/** Say `text` politely, through the player's live region (a no-op outside a player). */
export function useAnnounce(): (text: string) => void {
  return useContext(AnnounceContext);
}

const noSubscribe = () => () => {};

export function PlayerAnnouncer({ children }: { children: ReactNode }) {
  const [said, setSaid] = useState({ text: "", n: 0 });
  const announce = useCallback((text: string) => setSaid((s) => ({ text, n: s.n + 1 })), []);
  // Portals need the browser's document: none on the server, nor in the
  // render that hydrates the server's markup.
  const inBrowser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      {inBrowser
        ? createPortal(
            <p role="status" aria-live="polite" className="sr-only" data-player-announcer="">
              {said.text ? `${said.text}${said.n % 2 ? "" : " "}` : ""}
            </p>,
            document.body
          )
        : null}
    </AnnounceContext.Provider>
  );
}
