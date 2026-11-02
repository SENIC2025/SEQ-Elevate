/**
 * Upload rules shared by the Blob upload routes (which enforce them) and the
 * authoring UI (which checks a file BEFORE sending it, so an author hears
 * "too large" in a second rather than after minutes of uploading). One source
 * of truth for sizes and types, plus the stable refusal codes the routes
 * return and the storage status shape GET /api/storage/status reports.
 *
 * Pure (no server imports), so client components can use it too.
 */

const MB = 1024 * 1024;

/** Files above this go up in parallel, individually retried parts. */
export const MULTIPART_FROM_BYTES = 50 * MB;

export interface UploadRules {
  /** The route that issues the client-upload token. */
  handleUploadUrl: string;
  maxBytes: number;
  /** Content types the route allows (the Blob token enforces them too). */
  contentTypes: readonly string[];
  /** Lower-case extension → content type, for files the browser can't type. */
  extensions: Readonly<Record<string, string>>;
  /** Human list of the formats, for messages ("Use …"). */
  formats: string;
  /** Advice after "this file is too large". */
  tooLargeTip: string;
  /**
   * A file's type is the one its name's extension implies, never the
   * browser's, and a name without one of `extensions` is refused. The route
   * then lets the file be stored as that type only, so the address a file
   * is kept under says what it is served as (D119).
   */
  typeFromName?: boolean;
}

export const VIDEO_UPLOAD: UploadRules = {
  handleUploadUrl: "/api/video/upload",
  maxBytes: 500 * MB,
  contentTypes: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"],
  extensions: {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".ogg": "video/ogg",
    ".mov": "video/quicktime",
  },
  formats: "MP4, WebM, OGG or MOV",
  tooLargeTip: "Try exporting at 720p or 1080p.",
};

/** WebVTT captions for a lesson video (browsers often leave `type` empty). */
export const CAPTION_UPLOAD: UploadRules = {
  handleUploadUrl: "/api/caption/upload",
  maxBytes: 2 * MB,
  contentTypes: ["text/vtt"],
  extensions: { ".vtt": "text/vtt" },
  formats: "WebVTT (.vtt)",
  tooLargeTip:
    "Caption files are usually far smaller, so check it's a WebVTT file.",
};

export const DOCUMENT_UPLOAD: UploadRules = {
  handleUploadUrl: "/api/document/upload",
  maxBytes: 50 * MB,
  contentTypes: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
  extensions: {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  },
  formats:
    "PDF, Word, PowerPoint, Excel, plain text, CSV or an image (PNG, JPG, GIF, WebP or SVG)",
  tooLargeTip: "Try compressing it, or split it into smaller files.",
  typeFromName: true,
};

/** The file picker's `accept` attribute for a set of rules. */
export function acceptAttribute(rules: UploadRules): string {
  return [...rules.contentTypes, ...Object.keys(rules.extensions)].join(",");
}

/** "512 B", "38 KB", "4.2 MB", "500 MB" — for sizes shown to people. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / MB).toFixed(1))} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** The type a file name's extension implies under `rules`; null for a name without one of them. */
export function typeForName(name: string, rules: UploadRules): string | null {
  return Object.hasOwn(rules.extensions, extensionOf(name)) ? rules.extensions[extensionOf(name)] : null;
}

/**
 * The type the file at `url` is named as (its path's extension), for an
 * address of our own: an upload's, or a bundled sample's path. Null when
 * the path has no extension of `rules`, or the address can't be read.
 */
export function typeOfAddress(url: string, rules: UploadRules): string | null {
  let path: string;
  try {
    path = new URL(url, "https://app.invalid").pathname;
  } catch {
    return null;
  }
  return typeForName(path.slice(path.lastIndexOf("/") + 1), rules);
}

export type FileCheck =
  | { ok: true; contentType: string }
  | { ok: false; message: string };

/**
 * Can this file be uploaded under `rules`? On success, the content type to
 * send: the browser's when it's allowed, otherwise the one its extension
 * implies (browsers leave `type` empty, or use an odd alias, for some files);
 * under `typeFromName`, always the one its extension implies.
 */
export function checkFile(
  file: { name: string; size: number; type: string },
  rules: UploadRules
): FileCheck {
  const contentType = rules.typeFromName
    ? typeForName(file.name, rules)
    : rules.contentTypes.includes(file.type)
      ? file.type
      : rules.extensions[extensionOf(file.name)];
  if (!contentType) {
    return {
      ok: false,
      message: `This file type isn't supported. Use ${rules.formats}.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: "This file is empty. Choose another file." };
  }
  if (file.size > rules.maxBytes) {
    return {
      ok: false,
      message: `This file is ${formatSize(file.size)} — the limit is ${formatSize(
        rules.maxBytes
      )}. ${rules.tooLargeTip}`,
    };
  }
  return { ok: true, contentType };
}

/* ---------------------------- Route refusals ---------------------------- */

/** Stable codes the upload routes return, so the UI can explain a refusal. */
export type UploadRefusalCode =
  | "storage-missing"
  | "signed-out"
  | "not-editor"
  | "rate-limited"
  | "file-type";

const REFUSALS: Record<UploadRefusalCode, { status: number; error: string }> =
  {
    "storage-missing": { status: 503, error: "Storage is not connected" },
    "signed-out": { status: 401, error: "Not signed in" },
    "not-editor": { status: 403, error: "Not allowed to upload" },
    "rate-limited": {
      status: 429,
      error: "Too many uploads — please slow down.",
    },
    "file-type": { status: 400, error: "This file type isn't supported" },
  };

/**
 * What an upload route answers when a token request fails for any other
 * reason: the same words whatever went wrong (the route logs the cause).
 */
export const UPLOAD_FAILED = { error: "The upload couldn't be started", code: "failed" } as const;

/** Thrown from onBeforeGenerateToken; the route turns it into its response. */
export class UploadRefusedError extends Error {
  constructor(readonly code: UploadRefusalCode) {
    super(REFUSALS[code].error);
    this.name = "UploadRefusedError";
  }
}

/** The JSON response for a refusal: `{ error, code }` with its HTTP status. */
export function refusalResponse(code: UploadRefusalCode): Response {
  const { status, error } = REFUSALS[code];
  return Response.json({ error, code }, { status });
}

/* ---------------------------- Storage status ---------------------------- */

/** GET /api/storage/status. `source` is only ever sent to admins. */
export type StorageStatus =
  | { signedIn: false }
  | {
      signedIn: true;
      /** Same rule as the upload routes and the CMS actions (canEditContent). */
      canUpload: boolean;
      storage: "ready" | "missing";
      source?: "standard" | "prefixed";
    };
