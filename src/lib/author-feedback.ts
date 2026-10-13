/**
 * Plain-language feedback for authors: upload progress, why an upload or a
 * save didn't work, and what (if anything) stops this account from uploading.
 *
 * Messages only ever state a cause that was actually observed — an error the
 * SDK threw, a refusal the server returned, or what GET /api/storage/status
 * reports right now. When nothing tells us why, they say so rather than guess.
 *
 * Pure (no server imports), so client components can use it too.
 */

import type { StorageStatus } from "@/lib/uploads";

const MB = 1024 * 1024;

/** Don't estimate time left until there's this much upload history. */
const ESTIMATE_AFTER_MS = 3000;

/* ------------------------------- Progress ------------------------------- */

/** Seconds left at the average speed so far, or null while it'd be a guess. */
export function secondsLeft(
  loaded: number,
  total: number,
  elapsedMs: number
): number | null {
  if (elapsedMs < ESTIMATE_AFTER_MS || loaded <= 0 || loaded >= total) {
    return null;
  }
  return ((total - loaded) * elapsedMs) / loaded / 1000;
}

/** "less than a minute left", "about 2 min left", "about 1 h 5 min left". */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}

/**
 * "Uploading… 48.2 of 126.3 MB · about 2 min left". Both figures use the unit
 * that suits the whole file, so a small handout reads "12 of 38 KB" rather
 * than "0.0 of 0.0 MB".
 */
export function formatUploadProgress({
  loaded,
  total,
  elapsedMs,
}: {
  loaded: number;
  total: number;
  elapsedMs: number;
}): string {
  const [unit, size]: [string, (bytes: number) => string] =
    total >= MB
      ? ["MB", (b) => (b / MB).toFixed(1)]
      : total >= 1024
        ? ["KB", (b) => String(Math.round(b / 1024))]
        : ["B", (b) => String(Math.round(b))];
  const text = `Uploading… ${size(loaded)} of ${size(total)} ${unit}`;
  const left = secondsLeft(loaded, total, elapsedMs);
  return left === null ? text : `${text} · ${formatTimeLeft(left)}`;
}

/* -------------------------------- Access -------------------------------- */

export type AccessProblem = "signed-out" | "not-editor" | "storage-missing";

/** What stops this account uploading right now, per the status endpoint. */
export function accessProblem(
  status: StorageStatus | null | undefined
): AccessProblem | null {
  if (!status) return null;
  if (!status.signedIn) return "signed-out";
  if (!status.canUpload) return "not-editor";
  if (status.storage === "missing") return "storage-missing";
  return null;
}

export const ACCESS_MESSAGES: Record<AccessProblem, string> = {
  "signed-out":
    "You're not signed in, so files can't be uploaded. Open the site in a new tab and sign in, then come back here — what you've entered on this page stays.",
  "not-editor":
    "Your account can't upload files. Ask an administrator to give you the Editor role in Manage people.",
  "storage-missing":
    "File storage isn't connected on this site yet, so uploads can't be saved. Please tell the team that runs the site's hosting: they need to connect the Blob store to this project in Vercel (Storage → the Blob store → connect to this project) and redeploy.",
};

/* ----------------------------- Upload errors ---------------------------- */

// Messages browsers (and undici) use for a request that never completed.
const NETWORK_MESSAGES = new Set([
  "Failed to fetch", // Chrome
  "NetworkError when attempting to fetch resource.", // Firefox
  "Load failed", // Safari
  "The Internet connection appears to be offline.", // Safari
  "network error",
  "Network request failed", // @vercel/blob's XHR path
  "Network request timed out", // @vercel/blob's XHR path
  "fetch failed", // undici
  "terminated", // undici
]);

/** Did a request fail because it never reached the server (or never returned)? */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_MESSAGES.has(error.message);
}

export type UploadFailure =
  /** The token request failed; the browser SDK doesn't pass on why. */
  | { kind: "unexplained" }
  | { kind: "interrupted" }
  | { kind: "failed"; reason: string };

const failed = (reason: string): UploadFailure => ({ kind: "failed", reason });

// @vercel/blob errors (after its "Vercel Blob: " prefix) → what to tell authors.
const KNOWN_ERRORS: [RegExp, UploadFailure][] = [
  // Any non-OK answer from our upload route. The SDK spells it with one or
  // two spaces depending on the code path.
  [/^Failed to\s+retrieve the client token/i, { kind: "unexplained" }],
  // Multipart uploads report a dropped connection as this.
  [/^The blob service is currently not available/i, { kind: "interrupted" }],
  [/^The request was aborted/i, { kind: "interrupted" }],
  [/^File is too large/i, failed("the file is larger than the upload limit")],
  [/^Content type mismatch/i, failed("this file type isn't accepted")],
  [
    /^Client token has expired/i,
    failed("it took longer than the one-hour upload window"),
  ],
  [
    /^This store does not exist/i,
    failed("the file storage couldn't be found — please tell an administrator"),
  ],
  [
    /^This store has been suspended/i,
    failed("the file storage is suspended — please tell an administrator"),
  ],
  [
    /^Access denied/i,
    failed("the file storage refused access — please tell an administrator"),
  ],
  [
    /^Too many requests/i,
    failed("the storage service is receiving too many requests — wait a minute"),
  ],
  [/^Unknown error/i, failed("the storage service reported an unknown error")],
];

/** A short, lower-case-led reason from an unrecognised error message. */
function shortReason(message: string): string {
  let s = message.replace(/[.\s]+$/, "");
  if (/^[A-Z][a-z]/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

/** Sort an error thrown by @vercel/blob's upload() into what we can tell. */
export function classifyUploadError(error: unknown): UploadFailure {
  if (isNetworkError(error)) return { kind: "interrupted" };
  const message =
    error instanceof Error
      ? error.message.replace(/^Vercel Blob:\s*/, "").trim()
      : "";
  if (!message) return failed("something unexpected happened");
  for (const [pattern, failure] of KNOWN_ERRORS) {
    if (pattern.test(message)) return failure;
  }
  return failed(shortReason(message));
}

/** The message for an interrupted or failed upload. */
export function uploadFailureMessage(
  failure: Exclude<UploadFailure, { kind: "unexplained" }>
): string {
  return failure.kind === "interrupted"
    ? "The upload was interrupted. Check your connection and try again."
    : `The upload didn't finish: ${failure.reason}.`;
}

/**
 * The message for an upload the server wouldn't start, given the storage
 * status fetched just afterwards (null if that couldn't be checked either).
 */
export function unexplainedUploadMessage(status: StorageStatus | null): string {
  if (!status) {
    return "The upload couldn't start, and the reason couldn't be checked. Check your connection and try again.";
  }
  // The picker's notice already shows the full reason (the hook refreshes it
  // from the same status), so don't repeat it here.
  if (accessProblem(status)) return "The upload didn't start.";
  return "The server didn't accept the upload. Wait a minute and try again — if it keeps happening, please tell an administrator.";
}

/* --------------------------------- Saves -------------------------------- */

/**
 * Release 1's refusals for a lesson of a created course's own (G6, G8): it
 * left the lesson list, its main content is now of another kind, or the
 * list can't be read. Saving again can't succeed, so the message says to
 * reload or to ask an admin, never to try again.
 */
export type LessonListRefusal = "not-a-section" | "kind-mismatch" | "outline-unreadable";

const LESSON_LIST_REFUSALS: readonly string[] = [
  "not-a-section",
  "kind-mismatch",
  "outline-unreadable",
] satisfies LessonListRefusal[];

/** The action's error as a lesson list refusal, or null for any other. */
export function lessonListRefusal(error: string): LessonListRefusal | null {
  return LESSON_LIST_REFUSALS.includes(error) ? (error as LessonListRefusal) : null;
}

/** Why, after "Couldn't save:" or "it wasn't added:". */
const LESSON_LIST_REASON: Record<LessonListRefusal, string> = {
  "not-a-section": "this lesson isn't in the course's lesson list any more",
  "kind-mismatch": "this content doesn't match the lesson any more",
  "outline-unreadable":
    "this course's lesson list can't be read, so nothing can be changed until an admin repairs it",
};

/** What to do next, if anything: an admin's repair needs no reload. */
const LESSON_LIST_NEXT: Record<LessonListRefusal, string | null> = {
  "not-a-section": "reload the page to see the list as it is now",
  "kind-mismatch": "reload the page to see the lesson as it is now",
  "outline-unreadable": null,
};

export type SaveFailure =
  /** The action answered { ok: false, error: "forbidden" }. */
  | { kind: "refused"; access: StorageStatus | null }
  /** The action refused a lesson of the course's own (see LessonListRefusal). */
  | { kind: "lesson-list"; error: LessonListRefusal }
  /** The action call itself threw (connection lost, server error). */
  | { kind: "thrown"; error: unknown };

const NO_EDIT_PERMISSION =
  "You don't have permission to edit courses. Ask an administrator for the Editor role.";

const couldntSave = (reason: string) =>
  `Couldn't save: ${reason}. Your changes are still here — try again.`;

/**
 * Why a CMS save didn't work. The actions answer "forbidden" both when signed
 * out and when not an editor, so a refusal is explained from the status
 * endpoint's view of the account (fetched just afterwards).
 */
export function saveFailureMessage(failure: SaveFailure): string {
  if (failure.kind === "thrown") {
    return couldntSave(
      isNetworkError(failure.error)
        ? "the connection was interrupted"
        : "the server ran into a problem"
    );
  }
  if (failure.kind === "lesson-list") {
    // The edits are still on the page, but a reload replaces them.
    const next = LESSON_LIST_NEXT[failure.error];
    return `Couldn't save: ${LESSON_LIST_REASON[failure.error]}.${
      next ? ` Copy anything you want to keep, then ${next}.` : ""
    }`;
  }
  const { access } = failure;
  if (access && !access.signedIn) {
    return "You're not signed in any more, so this wasn't saved. Sign in again in a new tab, then press Save here — your changes are still on this page.";
  }
  if (access?.signedIn && !access.canUpload) {
    return NO_EDIT_PERMISSION;
  }
  return couldntSave("the server refused the change");
}

/**
 * Why an uploaded document couldn't be added to its lesson (the file itself
 * is stored, so "Try again" only needs to repeat this step).
 */
export function attachFailureMessage(failure: SaveFailure): string {
  if (failure.kind === "thrown") {
    return isNetworkError(failure.error)
      ? "The file was uploaded, but adding it to the lesson was interrupted. Check your connection and try again."
      : "The file was uploaded, but adding it to the lesson didn't work: the server ran into a problem. Try again.";
  }
  if (failure.kind === "lesson-list") {
    const next = LESSON_LIST_NEXT[failure.error];
    const reason = `The file was uploaded, but it wasn't added: ${LESSON_LIST_REASON[failure.error]}.`;
    return next ? `${reason} ${next[0].toUpperCase()}${next.slice(1)}.` : reason;
  }
  const { access } = failure;
  if (access && !access.signedIn) {
    return "The file was uploaded, but you're not signed in any more, so it wasn't added to the lesson. Sign in again in a new tab, then press Try again here.";
  }
  if (access?.signedIn && !access.canUpload) {
    return NO_EDIT_PERMISSION;
  }
  return "The file was uploaded, but the server refused to add it to the lesson. Try again.";
}
