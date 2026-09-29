/**
 * Which media URLs can be saved to a lesson. Only a web link (http or https)
 * loads for every learner. A blob: URL is the in-browser preview of an upload
 * that hasn't been stored — it plays for the author and is broken for
 * everyone else — and anything else (data:, javascript:, a relative path) is
 * not a link to a hosted file. saveLessonVideo refuses both, with a message
 * the authoring UI shows as is.
 *
 * Pure (no server imports), so client components can use it too.
 */

import { parseYouTubeId } from "@/lib/video";
import type { VideoContent } from "@/lib/cms/types";

/** "local": only in the author's browser; "not-web": not an http(s) link. */
export type MediaUrlProblem = "local" | "not-web";

// Schemes whose URLs point at data held in the author's own browser.
const LOCAL_SCHEMES = new Set(["blob:", "filesystem:"]);

/** Why `url` can't be stored for learners, or null if it's a web link. */
export function mediaUrlProblem(url: unknown): MediaUrlProblem | null {
  // Server actions take whatever the browser sends, so don't trust the type.
  if (typeof url !== "string") return "not-web";
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return "not-web"; // empty, relative or malformed
  }
  if (protocol === "http:" || protocol === "https:") return null;
  return LOCAL_SCHEMES.has(protocol) ? "local" : "not-web";
}

/** Is `url` a web link every learner can load (http or https)? */
export function isStorableMediaUrl(url: unknown): boolean {
  return mediaUrlProblem(url) === null;
}

const MESSAGES: Record<"video" | "caption", Record<MediaUrlProblem, string>> =
  {
    video: {
      local: "Save the upload first — this video is only on your computer.",
      "not-web":
        "This video link can't be used: paste the full web address (https://…).",
    },
    caption: {
      local:
        "Save the upload first — this caption file is only on your computer.",
      "not-web":
        "This caption link can't be used: paste the full web address of the .vtt file (https://…).",
    },
  };

/** What to tell the author about a video or caption URL that can't be saved. */
export function mediaUrlMessage(
  part: "video" | "caption",
  problem: MediaUrlProblem
): string {
  return MESSAGES[part][problem];
}

/**
 * Why this video can't be saved to a lesson, for the author — or null when
 * its source and every caption track are web links. A YouTube source may
 * also be a bare video id (the embed builds the link from it).
 */
export function unstorableVideoMessage(
  video: Pick<VideoContent, "provider" | "src" | "captions">
): string | null {
  if (typeof video !== "object" || video === null) {
    return mediaUrlMessage("video", "not-web");
  }
  // Only the bare id is exempt: parseYouTubeId also reads the id out of a
  // non-web link such as javascript://youtube.com/watch?v=…
  const isBareYouTubeId =
    video.provider === "youtube" &&
    typeof video.src === "string" &&
    parseYouTubeId(video.src) === video.src.trim();
  const source = isBareYouTubeId ? null : mediaUrlProblem(video.src);
  if (source) return mediaUrlMessage("video", source);
  const tracks: unknown = video.captions ?? [];
  if (!Array.isArray(tracks)) return mediaUrlMessage("caption", "not-web");
  for (const track of tracks) {
    const problem = mediaUrlProblem((track as { src?: unknown } | null)?.src);
    if (problem) return mediaUrlMessage("caption", problem);
  }
  return null;
}
