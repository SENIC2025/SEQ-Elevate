/**
 * Pure helpers for interactive video — kept out of the React component so the
 * cue logic is unit-testable in isolation.
 */

import type { VideoCue } from "@/lib/cms/types";

/**
 * The question that should be showing right now, or null. Returns the
 * earliest unanswered cue whose time has been reached — so questions are
 * always asked in order and none are skipped, even if the learner seeks
 * forward past several at once.
 */
export function dueCue(
  cues: VideoCue[],
  currentTime: number,
  answeredIds: string[]
): VideoCue | null {
  let due: VideoCue | null = null;
  for (const c of cues) {
    if (answeredIds.includes(c.id)) continue;
    if (currentTime + 0.001 < c.atSeconds) continue; // not reached yet
    if (!due || c.atSeconds < due.atSeconds) due = c;
  }
  return due;
}

/** Cues sorted by time, for stable rendering of markers. */
export function sortCues(cues: VideoCue[]): VideoCue[] {
  return [...cues].sort((a, b) => a.atSeconds - b.atSeconds);
}

/** mm:ss timecode. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Extract an 11-char YouTube id from a watch / share / embed URL, a bare id,
 * or return null if it isn't recognisably YouTube.
 */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const m = url.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  }
  return null;
}

/** Detect the provider for a pasted URL (for the authoring UI). */
export function detectProvider(url: string): "file" | "youtube" {
  return parseYouTubeId(url) ? "youtube" : "file";
}
