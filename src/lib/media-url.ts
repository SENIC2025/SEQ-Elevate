/**
 * Which media URLs can be saved to a lesson. Only a web link (http or https)
 * loads for every learner. A blob: URL is the in-browser preview of an upload
 * that hasn't been stored — it plays for the author and is broken for
 * everyone else — and anything else (data:, javascript:, a relative path) is
 * not a link to a hosted file. saveLessonVideo refuses both, with a message
 * the authoring UI shows as is.
 *
 * Release 3 (D91, spec 10.3): a lesson's video, poster, captions and
 * documents come from our own store only, so nothing from another host
 * loads in a learner's page without a click (isFirstPartyMediaUrl); a
 * YouTube link is stored as YouTube, whatever the browser said it was, and
 * plays only behind the click-to-load gate (storableVideo). Rows stored
 * before keep working: the player shows another host's video or document
 * as a link out (markExternalMedia).
 *
 * Pure (no server imports), so client components can use it too.
 */

import en from "@/messages/en.json";
import { parseYouTubeId, youTubeWatchUrl } from "@/lib/video";
import type { LessonDocumentRef, VideoCaptionTrack, VideoContent, VideoCue } from "@/lib/cms/types";

type Env = Record<string, string | undefined>;

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
  video: Pick<VideoContent, "provider" | "src" | "captions" | "poster">
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
  // The authoring screens never set a poster, but a crafted request could.
  const poster: unknown = video.poster;
  if (poster !== undefined && poster !== null && poster !== "") {
    const problem = mediaUrlProblem(poster);
    if (problem) return mediaUrlMessage("video", problem);
  }
  return null;
}

/* ------------------------------------------- our own store (D91) --- */

/**
 * Why a media link can't be used: it isn't one of our own files
 * ("host-refused"), or it is on a Vercel Blob store while this production
 * site doesn't know which store is its own ("host-unconfigured").
 */
export type HostProblem = "host-refused" | "host-unconfigured";

/** Every Vercel customer's public stores look like this. */
const VERCEL_BLOB_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/;

/** BLOB_PUBLIC_HOST (our store's exact host), in lower case; null while it isn't set. */
export function blobPublicHost(env: Env = process.env): string | null {
  const host = env.BLOB_PUBLIC_HOST?.trim().toLowerCase();
  return host ? host : null;
}

let warnedWildcard = false;

/**
 * Is this (already resolved) address a file of our own store? https: and
 * exactly BLOB_PUBLIC_HOST. While that isn't set: outside production any
 * Vercel Blob store, said once in the log; on production none, since that
 * would admit every Vercel customer's files ("host-unconfigured").
 */
function ownStoreProblem(url: URL, env: Env): HostProblem | null {
  if (url.protocol !== "https:") return "host-refused";
  const host = blobPublicHost(env);
  if (host) return url.host === host ? null : "host-refused";
  if (!VERCEL_BLOB_HOST.test(url.host)) return "host-refused";
  if (env.VERCEL_ENV === "production") return "host-unconfigured";
  if (!warnedWildcard) {
    warnedWildcard = true;
    console.warn("[media] BLOB_PUBLIC_HOST isn't set: any Vercel Blob store counts as ours (never on production).");
  }
  return null;
}

/**
 * Why `url` isn't one of our own media files, or null when it is (D91): the
 * address is resolved against `appOrigin` (new URL, never by looking for a
 * leading "/"), and is ours only when it is
 *   (a) on `appOrigin` itself, under /demo/ (the bundled sample files), or
 *   (b) on our own store (ownStoreProblem).
 * So "//other.host/v.mp4", "/\\other.host/…", encoded slashes and pages of
 * our own such as /api/… are refused. `appOrigin` is serverAppOrigin() on
 * the server and window.location.origin in the browser.
 */
export function mediaHostProblem(url: unknown, appOrigin: string, env: Env = process.env): HostProblem | null {
  if (typeof url !== "string" || !url.trim()) return "host-refused";
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(appOrigin);
    resolved = new URL(url.trim(), base);
  } catch {
    return "host-refused";
  }
  if (resolved.origin === base.origin && resolved.pathname.startsWith("/demo/")) return null;
  return ownStoreProblem(resolved, env);
}

/** Is `url` one of our own media files (mediaHostProblem)? */
export function isFirstPartyMediaUrl(url: unknown, appOrigin: string, env: Env = process.env): boolean {
  return mediaHostProblem(url, appOrigin, env) === null;
}

/**
 * Is `url` a file of our own store (case (b) alone): one the admin run may
 * delete once nothing uses it (blob-files.ts). The bundled samples never are.
 */
export function isOwnStoreUrl(url: unknown, env: Env = process.env): boolean {
  if (typeof url !== "string") return false;
  try {
    return ownStoreProblem(new URL(url.trim()), env) === null;
  } catch {
    return false;
  }
}

/**
 * For the editor's live preview, in the browser, which doesn't know
 * BLOB_PUBLIC_HOST: could `url` be ours? Our origin's /demo/ samples, or
 * any Vercel Blob store (the save checks the exact one). A link that can't
 * be ours is previewed as learners would get it: a link out, never loaded.
 */
export function previewMediaIsOurs(url: string, appOrigin: string): boolean {
  try {
    const base = new URL(appOrigin);
    const resolved = new URL(url.trim(), base);
    if (resolved.origin === base.origin && resolved.pathname.startsWith("/demo/")) return true;
    return resolved.protocol === "https:" && VERCEL_BLOB_HOST.test(resolved.host);
  } catch {
    return false;
  }
}

/**
 * The site's own origin on the server, from AUTH_URL. Without one, an
 * origin no address can have: only the bundled samples' paths (/demo/…)
 * then resolve to it.
 */
export function serverAppOrigin(env: Env = process.env): string {
  try {
    if (env.AUTH_URL) return new URL(env.AUTH_URL).origin;
  } catch {
    // An unreadable AUTH_URL: as unset.
  }
  return "https://app.invalid";
}

/**
 * A document is only ever uploaded: one the server refuses landed outside
 * our own store (BLOB_PUBLIC_HOST names another), which only SENIC can put
 * right. Editor wording, English as the editor screens are.
 */
const DOCUMENT_HOST_REFUSED = "This file can't be attached: it isn't in the site's storage. Tell SENIC.";

/**
 * What to tell the author about a file that isn't ours (the editor screens
 * are in English): for a video, to upload it or paste a YouTube link; for
 * a document, which can't be a link, to tell SENIC.
 */
export function hostProblemMessage(problem: HostProblem, media: "video" | "document" = "video"): string {
  if (problem === "host-unconfigured") return en.video.hostUnconfigured;
  return media === "document" ? DOCUMENT_HOST_REFUSED : en.video.hostRefused;
}

export type VideoCheck =
  | { ok: true; video: VideoContent }
  | { ok: false; error: "unstorable-media" | HostProblem; message: string };

const str = (v: unknown): v is string => typeof v === "string";
const optional = (v: unknown) => (str(v) && v !== "" ? v : undefined);

/** A cue as the player reads it; null for anything else. */
function cleanCue(raw: unknown): VideoCue | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!str(c.id) || !str(c.question) || !str(c.correctOptionId) || !Array.isArray(c.options)) return null;
  if (typeof c.atSeconds !== "number" || !Number.isFinite(c.atSeconds) || c.atSeconds < 0) return null;
  const options = c.options.flatMap((o) =>
    o && typeof o === "object" && str((o as { id?: unknown }).id) && str((o as { text?: unknown }).text)
      ? [{ id: (o as { id: string }).id, text: (o as { text: string }).text }]
      : []
  );
  const explanation = optional(c.explanation);
  return {
    id: c.id,
    atSeconds: c.atSeconds,
    question: c.question,
    options,
    correctOptionId: c.correctOptionId,
    ...(explanation !== undefined ? { explanation } : {}),
  };
}

/**
 * The video as it may be stored for a lesson (D91), worked out on the
 * server, never taken from the browser: a YouTube link (parseYouTubeId) is
 * stored as YouTube's watch page, with no poster or caption files (YouTube
 * has its own); anything else is a file whose source, poster and every
 * caption track must be ours (mediaHostProblem), or the save is refused
 * with what to tell the author. A file still in the author's browser
 * (blob:) is refused as before. Only the fields the player reads are kept.
 */
export function storableVideo(input: unknown, appOrigin: string, env: Env = process.env): VideoCheck {
  if (!input || typeof input !== "object" || !str((input as { src?: unknown }).src)) {
    return { ok: false, error: "unstorable-media", message: mediaUrlMessage("video", "not-web") };
  }
  const v = input as Record<string, unknown> & { src: string };
  const text = {
    ...(optional(v.title) !== undefined ? { title: v.title as string } : {}),
    ...(optional(v.caption) !== undefined ? { caption: v.caption as string } : {}),
  };
  const cues = Array.isArray(v.cues) ? v.cues.flatMap((c) => cleanCue(c) ?? []) : [];

  const id = parseYouTubeId(v.src);
  if (id) return { ok: true, video: { provider: "youtube", src: youTubeWatchUrl(id), ...text, cues } };

  const tracks: unknown[] = v.captions === undefined || v.captions === null ? [] : Array.isArray(v.captions) ? v.captions : [null];
  const poster = optional(v.poster);
  const links: { part: "video" | "caption"; url: unknown }[] = [
    { part: "video", url: v.src },
    ...(v.poster === undefined || v.poster === null || v.poster === "" ? [] : [{ part: "video" as const, url: v.poster }]),
    ...tracks.map((t) => ({ part: "caption" as const, url: (t as { src?: unknown } | null)?.src })),
  ];
  for (const { part, url } of links) {
    if (mediaUrlProblem(url) === "local") {
      return { ok: false, error: "unstorable-media", message: mediaUrlMessage(part, "local") };
    }
  }
  for (const { url } of links) {
    const problem = mediaHostProblem(url, appOrigin, env);
    if (problem) return { ok: false, error: problem, message: hostProblemMessage(problem) };
  }
  const captions: VideoCaptionTrack[] = tracks.map((raw) => {
    const t = raw as Record<string, unknown>;
    return {
      src: (t.src as string).trim(),
      label: str(t.label) ? t.label : "",
      lang: str(t.lang) ? t.lang : "",
      ...(t.default === true ? { default: true } : {}),
    };
  });
  return {
    ok: true,
    video: {
      provider: "file",
      src: v.src.trim(),
      ...(poster !== undefined ? { poster: poster.trim() } : {}),
      ...text,
      ...(captions.length ? { captions } : {}),
      cues,
    },
  };
}

/**
 * The course as a learner's page gets it, each video and document that
 * isn't one of our own files (`isOwn`; a video with its poster and captions)
 * marked `external`: the player then
 * shows it as a link out, never loaded in the page (rows stored before
 * D91). A YouTube video is never marked: it plays behind its gate.
 */
export function markExternalMedia<T>(course: T, isOwn: (url: string) => boolean): T {
  // A file of ours with a poster or captions elsewhere would load them too.
  const ours = (v: VideoContent) =>
    isOwn(v.src) && (!v.poster || isOwn(v.poster)) && (v.captions ?? []).every((c) => isOwn(c.src));
  const video = (v: VideoContent | undefined) =>
    v && v.provider !== "youtube" && !ours(v) ? { ...v, external: true } : v;
  const documents = (docs: LessonDocumentRef[] | undefined) =>
    docs?.map((d) => (isOwn(d.url) ? d : { ...d, external: true }));
  const media = <M extends { video?: VideoContent; documents?: LessonDocumentRef[] }>(m: M): M => ({
    ...m,
    ...(m.video ? { video: video(m.video) } : {}),
    ...(m.documents ? { documents: documents(m.documents) } : {}),
  });
  const c = course as unknown as {
    stages?: { video?: VideoContent; documents?: LessonDocumentRef[] }[];
    lessons?: ({ kind: "stage"; stage: object } | { kind: "section"; section: object })[];
  };
  return {
    ...course,
    ...(c.stages ? { stages: c.stages.map(media) } : {}),
    ...(c.lessons
      ? {
          lessons: c.lessons.map((l) =>
            l.kind === "stage" ? { ...l, stage: media(l.stage) } : { ...l, section: media(l.section) }
          ),
        }
      : {}),
  };
}
