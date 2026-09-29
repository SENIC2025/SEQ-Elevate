"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InteractiveVideoPlayer } from "@/components/course/InteractiveVideoPlayer";
import { cn } from "@/lib/utils";
import { detectProvider, formatTimecode } from "@/lib/video";
import {
  clearLessonVideo,
  getLessonMedia,
  saveLessonVideo,
} from "@/app/actions/lesson";
import { CONTENT_LOCALES, isContentLocale } from "@/lib/cms/course-admin-types";
import type {
  Locale,
  StageKey,
  VideoContent,
  VideoCue,
} from "@/lib/cms/types";
import {
  CAPTION_UPLOAD,
  VIDEO_UPLOAD,
  acceptAttribute,
  checkFile,
  formatSize,
} from "@/lib/uploads";
import { isStorableMediaUrl, mediaUrlMessage } from "@/lib/media-url";
import { saveFailureMessage } from "@/lib/author-feedback";
import {
  fetchStorageStatus,
  useBlobUpload,
} from "@/components/role/useBlobUpload";
import { StorageNotice, UploadStatus } from "@/components/role/UploadFeedback";
import {
  Upload,
  Link2,
  Film,
  Plus,
  Trash2,
  HelpCircle,
  Eye,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Save,
} from "lucide-react";

/**
 * Authoring container for an interactive video — the partner-author surface
 * for "add a video when building a course". Source is an uploaded file or a
 * pasted URL (direct media or YouTube); cues add in-video questions. A live
 * preview renders with the very same player the learner sees.
 *
 * An uploaded file goes straight to Vercel Blob (see useBlobUpload). While it
 * uploads — or if it can't — the preview plays from an in-browser object URL,
 * labelled "Not saved yet", and it can't be saved to a lesson until the file
 * is stored: a blob: URL would be a broken video for every learner. A picked
 * .vtt caption file goes the same way (the server refuses blob: URLs too).
 *
 * The course page gives the lesson (`courseSlug`, `stageKey`): the form
 * starts from the video stored there, which can be saved or removed.
 */

// Learners' answers are stored against the cue id alone, so a new cue's id
// must be unique across every lesson, not just this one.
function newCueId(): string {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `cue-${unique}`;
}

const newCue = (): EditableCue => ({
  key: newCueId(),
  atSeconds: 5,
  question: "",
  options: [
    { id: "a", text: "" },
    { id: "b", text: "" },
  ],
  correctOptionId: "a",
  explanation: "",
});

interface EditableCue {
  key: string;
  atSeconds: number;
  question: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  el: "Ελληνικά",
};

/** The form's content fields — what a save stores. */
interface VideoFields {
  provider: "file" | "youtube";
  src: string;
  title: string;
  caption: string;
  captionSrc: string;
  captionLabel: string;
  captionLang: Locale;
  cues: EditableCue[];
}

/** A stored video as form fields; an empty form when there's none. */
function fieldsFrom(video: VideoContent | null, lang: Locale): VideoFields {
  const track = video?.captions?.[0];
  return {
    provider: video?.provider ?? "file",
    src: video?.src ?? "",
    title: video?.title ?? "",
    caption: video?.caption ?? "",
    captionSrc: track?.src ?? "",
    captionLabel: track?.label ?? LANGUAGE_NAMES[lang],
    captionLang: track && isContentLocale(track.lang) ? track.lang : lang,
    // The stored ids stay: learners' answers are recorded against them.
    cues: (video?.cues ?? []).map((c) => ({
      key: c.id,
      atSeconds: c.atSeconds,
      question: c.question,
      options: c.options.map((o) => ({ id: o.id, text: o.text })),
      correctOptionId: c.correctOptionId,
      explanation: c.explanation ?? "",
    })),
  };
}

/** The form's content as one string, to tell edited from saved. */
function snapshotOf(f: VideoFields): string {
  return JSON.stringify([
    f.provider,
    f.src,
    f.title,
    f.caption,
    f.captionSrc,
    f.captionLabel,
    f.captionLang,
    f.cues,
  ]);
}

/**
 * Tell the page when unsaved edits appear and when they're gone — saved,
 * or discarded because the editor closed.
 */
function useReportDirty(dirty: boolean, onDirtyChange?: (d: boolean) => void) {
  const report = React.useRef(onDirtyChange);
  React.useEffect(() => {
    report.current = onDirtyChange;
  });
  React.useEffect(() => {
    if (!dirty) return;
    report.current?.(true);
    return () => report.current?.(false);
  }, [dirty]);
}

export interface VideoBlockAuthorProps {
  /** The lesson the video belongs to. */
  courseSlug: string;
  stageKey: StageKey;
  /** The video stored on the lesson (null = none). Left out, it's fetched first. */
  initialVideo?: VideoContent | null;
  /** The platform supplies a video here that a saved one replaces. */
  builtInVideo?: boolean;
  /** The language being edited: the default for a new caption track. */
  locale?: Locale;
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  /** After a save (the stored video) or a removal (null). */
  onSaved?: (video: VideoContent | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function VideoBlockAuthor(props: VideoBlockAuthorProps) {
  // The video isn't to hand: load it, then edit it.
  if (props.initialVideo === undefined) return <StoredVideoLoader {...props} />;
  return <VideoEditor {...props} />;
}

/** Fetches the lesson's stored video, then shows the editor seeded with it. */
function StoredVideoLoader(props: VideoBlockAuthorProps) {
  const { courseSlug, stageKey } = props;
  const key = `${courseSlug}:${stageKey}`;
  const [loaded, setLoaded] = React.useState<{
    key: string;
    video: VideoContent | null;
    failed?: boolean;
  } | null>(null);

  React.useEffect(() => {
    const at = `${courseSlug}:${stageKey}`;
    let cancelled = false;
    getLessonMedia(courseSlug, stageKey).then(
      (media) => {
        if (!cancelled) setLoaded({ key: at, video: media.video });
      },
      () => {
        if (!cancelled) setLoaded({ key: at, video: null, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [courseSlug, stageKey]);

  if (loaded?.key !== key || loaded.failed) {
    return (
      <Card className={props.embedded ? "shadow-none" : undefined}>
        <CardContent
          className="p-5 text-sm text-[var(--muted-foreground)]"
          role={loaded?.failed ? "alert" : undefined}
        >
          {loaded?.failed
            ? "Couldn't load this lesson's video. Reload the page to try again."
            : "Loading the lesson's video…"}
        </CardContent>
      </Card>
    );
  }
  return <VideoEditor key={key} {...props} initialVideo={loaded.video} />;
}

function VideoEditor({
  courseSlug,
  stageKey,
  initialVideo,
  builtInVideo = false,
  locale = "en",
  embedded = false,
  onSaved,
  onDirtyChange,
}: VideoBlockAuthorProps) {
  // The form starts from the stored video, if the page handed one over.
  const [seed] = React.useState(() =>
    fieldsFrom(initialVideo ?? null, locale)
  );
  const [tab, setTab] = React.useState<"upload" | "url">(
    seed.src ? "url" : "upload"
  );
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // What's stored on the lesson now.
  const [stored, setStored] = React.useState<VideoContent | null>(
    initialVideo ?? null
  );
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "saved" | "removing" | "removed" | "error"
  >("idle");
  const [saveError, setSaveError] = React.useState("");
  const [provider, setProvider] = React.useState(seed.provider);
  const [src, setSrc] = React.useState(seed.src);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fromUpload, setFromUpload] = React.useState(false);
  const upload = useBlobUpload(VIDEO_UPLOAD);
  const noticeId = React.useId();
  const saveHintId = React.useId();
  const [title, setTitle] = React.useState(seed.title);
  const [caption, setCaption] = React.useState(seed.caption);
  const titleId = React.useId();
  const captionId = React.useId();
  const [captionSrc, setCaptionSrc] = React.useState(seed.captionSrc);
  const [captionLabel, setCaptionLabel] = React.useState(seed.captionLabel);
  const [captionLang, setCaptionLang] = React.useState<Locale>(
    seed.captionLang
  );
  const captionLangId = React.useId();
  // captionFromUpload: captionSrc is a picked file (local, then stored), not a
  // pasted link. captionPicked: the upload's outcome is still worth showing.
  const [captionFromUpload, setCaptionFromUpload] = React.useState(false);
  const [captionPicked, setCaptionPicked] = React.useState(false);
  const captionUpload = useBlobUpload(CAPTION_UPLOAD);
  const captionNoticeId = React.useId();
  const [cues, setCues] = React.useState<EditableCue[]>(seed.cues);

  // Unsaved edits: the form differs from what was last loaded or saved.
  const snapshot = snapshotOf({
    provider,
    src,
    title,
    caption,
    captionSrc,
    captionLabel,
    captionLang,
    cues,
  });
  const [cleanSnapshot, setCleanSnapshot] = React.useState(snapshot);
  const dirty = snapshot !== cleanSnapshot;
  useReportDirty(dirty, onDirtyChange);
  const objectUrl = React.useRef<string | null>(null);
  const urlInputRef = React.useRef<HTMLInputElement>(null);
  const urlInputId = React.useId();
  const captionObjUrl = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (captionObjUrl.current) URL.revokeObjectURL(captionObjUrl.current);
    };
  }, []);

  const captionPickerDisabled =
    captionUpload.problem !== null ||
    captionUpload.state.phase === "uploading";

  // A .vtt is stored like the video: the preview uses the local copy while it
  // uploads, but only the stored URL can be saved to a lesson.
  function onCaptionFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!f) return;
    setCaptionPicked(true);
    if (checkFile(f, CAPTION_UPLOAD).ok) {
      if (captionObjUrl.current) URL.revokeObjectURL(captionObjUrl.current);
      const url = URL.createObjectURL(f);
      captionObjUrl.current = url;
      setCaptionSrc(url);
      setCaptionFromUpload(true);
      setSaveState("idle");
    }
    void sendCaption(f);
  }

  async function sendCaption(f: File) {
    const local = captionObjUrl.current;
    const stored = await captionUpload.start(f);
    if (stored) {
      setCaptionSrc((current) => (current === local ? stored.url : current));
    }
  }

  function onCaptionUrl(value: string) {
    setCaptionSrc(value.trim());
    setCaptionFromUpload(false);
    setCaptionPicked(false);
  }

  const captionMessage = !captionPicked
    ? null
    : captionUpload.state.phase === "stored"
      ? {
          tone: "success" as const,
          text: "Uploaded — the caption file is stored.",
        }
      : captionUpload.state.phase === "failed" ||
          captionUpload.state.phase === "rejected"
        ? { tone: "error" as const, text: captionUpload.state.message }
        : null;
  const failedCaption =
    captionPicked && captionUpload.state.phase === "failed"
      ? captionUpload.state
      : null;

  // Uploading needs a signed-in editor and connected storage; until the
  // status says otherwise the picker stays usable (the route still checks).
  const pickerDisabled =
    upload.problem !== null || upload.state.phase === "uploading";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (f) handleFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault(); // never let the browser navigate to the dropped file
    const f = e.dataTransfer.files[0];
    if (f && !pickerDisabled) handleFile(f);
  }

  function handleFile(f: File) {
    // Instant in-browser preview while it uploads — only for files that can
    // be uploaded at all; useBlobUpload explains why the others can't.
    if (checkFile(f, VIDEO_UPLOAD).ok) {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const localUrl = URL.createObjectURL(f);
      objectUrl.current = localUrl;
      setSrc(localUrl);
      setProvider("file");
      setFromUpload(true);
      setFileName(`${f.name} · ${formatSize(f.size)}`);
      setSaveState("idle");
    }
    void send(f);
  }

  // Upload straight to Vercel Blob (client upload — large files bypass the
  // serverless body limit), then swap the preview to the stored file unless
  // the author has moved on to another source meanwhile.
  async function send(f: File) {
    const local = objectUrl.current;
    const stored = await upload.start(f);
    if (stored) {
      setSrc((current) => (current === local ? stored.url : current));
    }
  }

  const uploadMessage =
    upload.state.phase === "stored"
      ? { tone: "success" as const, text: "Uploaded — the video file is stored." }
      : upload.state.phase === "failed" || upload.state.phase === "rejected"
        ? { tone: "error" as const, text: upload.state.message }
        : null;
  const failedUpload = upload.state.phase === "failed" ? upload.state : null;

  function onUrl(value: string) {
    setSrc(value.trim());
    setFromUpload(false);
    setFileName(null);
    setProvider(detectProvider(value.trim()));
  }

  // Build the live-preview model. Only cues with a question + a correct option
  // text are included, so a half-typed cue doesn't break the preview.
  const previewCues: VideoCue[] = cues
    .filter((c) => c.question.trim() && c.options.some((o) => o.text.trim()))
    .map((c) => ({
      id: c.key,
      atSeconds: c.atSeconds,
      question: c.question,
      options: c.options
        .filter((o) => o.text.trim())
        .map((o) => ({ id: o.id, text: o.text })),
      correctOptionId: c.correctOptionId,
      explanation: c.explanation || undefined,
    }));

  const draft: VideoContent | null = src
    ? {
        provider,
        src,
        title: title || undefined,
        caption: caption || undefined,
        captions: captionSrc
          ? [
              {
                src: captionSrc,
                label: captionLabel || "Captions",
                lang: captionLang,
                default: true,
              },
            ]
          : undefined,
        cues: previewCues,
      }
    : null;

  // A preview playing from this browser (blob:) isn't a video learners can
  // load, and neither are captions that haven't been stored yet.
  const localOnly = src.startsWith("blob:");
  const captionLocalOnly = captionSrc.startsWith("blob:");
  const saveBlocked = localOnly || captionLocalOnly;
  const saveHint = !draft
    ? null
    : localOnly && captionLocalOnly
      ? "Finish uploading the video and its captions (or paste links) before saving them to a lesson."
      : localOnly
        ? "Finish uploading the video (or paste a link) before saving it to a lesson."
        : captionLocalOnly
          ? "Finish uploading the captions (or paste a link to a .vtt file) before saving the video to a lesson."
          : null;

  async function handleSaveToLesson() {
    if (!draft || saveBlocked) return;
    // Edits made while this save is in flight stay unsaved.
    const sent = snapshot;
    setSaveState("saving");
    try {
      const res = await saveLessonVideo(courseSlug, stageKey, draft);
      if (res.ok) {
        setSaveState("saved");
        setCleanSnapshot(sent);
        setStored(draft);
        onSaved?.(draft);
        return;
      }
      if (res.error === "unstorable-media") {
        // Names what learners couldn't load, e.g. a file still in this browser.
        setSaveError(res.message);
      } else {
        // "forbidden" covers both signed out and not an editor — ask which.
        setSaveError(
          saveFailureMessage({
            kind: "refused",
            access: await fetchStorageStatus(),
          })
        );
      }
    } catch (error) {
      setSaveError(saveFailureMessage({ kind: "thrown", error }));
    }
    setSaveState("error");
  }

  // Take the video off the lesson and empty the form.
  async function handleRemove() {
    if (!stored) return;
    const question = builtInVideo
      ? "Remove this video? Learners will see the built-in video for this lesson again."
      : "Remove this video? Learners will no longer see it on this lesson.";
    if (!window.confirm(question)) return;
    // "Remove video" goes away once it's done: keep focus in this editor.
    headingRef.current?.focus();
    setSaveState("removing");
    try {
      const res = await clearLessonVideo(courseSlug, stageKey);
      if (res.ok) {
        const empty = fieldsFrom(null, locale);
        setTab("upload");
        setProvider(empty.provider);
        setSrc(empty.src);
        setFileName(null);
        setFromUpload(false);
        setTitle(empty.title);
        setCaption(empty.caption);
        setCaptionSrc(empty.captionSrc);
        setCaptionLabel(empty.captionLabel);
        setCaptionLang(empty.captionLang);
        setCaptionFromUpload(false);
        setCaptionPicked(false);
        setCues(empty.cues);
        setCleanSnapshot(snapshotOf(empty));
        setStored(null);
        setSaveState("removed");
        onSaved?.(null);
        return;
      }
      setSaveError(
        saveFailureMessage({
          kind: "refused",
          access: await fetchStorageStatus(),
        })
      );
    } catch (error) {
      setSaveError(saveFailureMessage({ kind: "thrown", error }));
    }
    setSaveState("error");
  }

  // The caption label follows the language unless the author wrote their own.
  function onCaptionLang(next: Locale) {
    setCaptionLabel((label) =>
      !label.trim() || label === LANGUAGE_NAMES[captionLang]
        ? LANGUAGE_NAMES[next]
        : label
    );
    setCaptionLang(next);
  }

  // "Saved" / "Removed" hold only until the next edit.
  const saveStatus = (
    <span role="status" aria-live="polite">
      {saveState === "saved" && !dirty ? (
        <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved — learners see it on this lesson.
        </span>
      ) : saveState === "removed" && !dirty ? (
        <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {builtInVideo
            ? "Removed — learners see the built-in video again."
            : "Removed — learners no longer see a video on this lesson."}
        </span>
      ) : saveState === "error" ? (
        <span className="text-xs text-[var(--danger)] inline-flex items-start gap-1">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {saveError}
        </span>
      ) : null}
    </span>
  );

  return (
    <Card
      className={cn("border-[var(--accent)]/30", embedded && "shadow-none")}
    >
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <Film className="h-5 w-5" />
          </div>
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
              Interactive video
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Add a lesson video, then drop in questions that pause it.
            </p>
          </div>
          {embedded ? null : (
            <Badge variant="primary" className="ml-auto text-[10px]">
              New
            </Badge>
          )}
        </div>
        {builtInVideo && !stored ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Learners see the built-in video on this lesson. Saving a video here
            replaces it for them.
          </p>
        ) : null}

        {/* Source tabs */}
        <div className="mt-4 inline-flex rounded-lg border border-[var(--border)] p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
              tab === "upload"
                ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                : "text-[var(--muted-foreground)]"
            }`}
            aria-pressed={tab === "upload"}
          >
            <Upload className="h-4 w-4" />
            Upload file
          </button>
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
              tab === "url"
                ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                : "text-[var(--muted-foreground)]"
            }`}
            aria-pressed={tab === "url"}
          >
            <Link2 className="h-4 w-4" />
            Paste URL
          </button>
        </div>

        <div className="mt-3">
          {tab === "upload" ? (
            <div>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-6 text-center focus-within:ring-2 focus-within:ring-[var(--ring)] ${
                  pickerDisabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:border-[var(--accent)]/50"
                }`}
              >
                <Upload className="h-6 w-6 text-[var(--accent)]" />
                <span className="text-sm font-medium">
                  Choose a video file
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {VIDEO_UPLOAD.formats} · up to{" "}
                  {formatSize(VIDEO_UPLOAD.maxBytes)} · drag &amp; drop or
                  click to browse
                </span>
                <input
                  type="file"
                  accept={acceptAttribute(VIDEO_UPLOAD)}
                  onChange={onPick}
                  disabled={pickerDisabled}
                  aria-describedby={upload.storage ? noticeId : undefined}
                  className="sr-only"
                />
              </label>
              <StorageNotice
                storage={upload.storage}
                id={noticeId}
                whenMissing={
                  <p>
                    Meanwhile, you can paste a link instead — a YouTube link or
                    a direct link to an .mp4 or .webm file.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        // This button disappears with the upload tab, so
                        // move focus to the field it opens.
                        flushSync(() => setTab("url"));
                        urlInputRef.current?.focus();
                      }}
                      className="font-medium text-[var(--accent)] underline underline-offset-2"
                    >
                      Paste a link
                    </button>
                  </p>
                }
              />
              {fileName ? (
                <p className="mt-2 text-xs text-[var(--foreground)] flex items-center gap-1.5">
                  <Film className="h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-hidden />
                  {fileName}
                </p>
              ) : null}
              <UploadStatus
                label="Video upload progress"
                state={upload.state}
                message={uploadMessage}
                onRetry={
                  failedUpload && !upload.problem
                    ? () => void send(failedUpload.file)
                    : undefined
                }
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor={urlInputId}
                className="block text-xs font-medium text-[var(--muted-foreground)] mb-1"
              >
                Video URL (direct .mp4/.webm or a YouTube link)
              </label>
              <input
                id={urlInputId}
                ref={urlInputRef}
                type="url"
                value={fromUpload ? "" : src}
                onChange={(e) => onUrl(e.target.value)}
                placeholder="https://… or https://youtu.be/…"
                className={inputCls}
              />
              {src ? (
                <p className="mt-2 text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
                  <Badge variant="muted" className="text-[10px]">
                    {provider === "youtube" ? "YouTube" : "Direct file"}
                  </Badge>
                  detected
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Title + caption */}
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={titleId}
              className="block text-xs font-medium text-[var(--muted-foreground)] mb-1"
            >
              Title
            </label>
            <input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Speaking up without blame"
              className={inputCls}
            />
          </div>
          <div>
            <label
              htmlFor={captionId}
              className="block text-xs font-medium text-[var(--muted-foreground)] mb-1"
            >
              Caption (optional)
            </label>
            <input
              id={captionId}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="A short line under the player"
              className={inputCls}
            />
          </div>
        </div>

        {/* Captions (WCAG 2.2 SC 1.2.2 — required for prerecorded video) */}
        <div className="mt-4">
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
            Captions (WebVTT) — required for accessibility
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[var(--ring)] ${
                captionPickerDisabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-[var(--surface-muted)]"
              }`}
            >
              <Upload className="h-4 w-4" />
              Upload .vtt
              <input
                type="file"
                accept={acceptAttribute(CAPTION_UPLOAD)}
                onChange={onCaptionFile}
                disabled={captionPickerDisabled}
                aria-describedby={
                  captionUpload.problem ? captionNoticeId : undefined
                }
                className="sr-only"
              />
            </label>
            <span className="text-xs text-[var(--muted-foreground)]">or</span>
            <input
              type="url"
              value={captionFromUpload ? "" : captionSrc}
              onChange={(e) => onCaptionUrl(e.target.value)}
              placeholder="https://….vtt"
              aria-label="Caption file URL"
              className={`${inputCls} flex-1 min-w-[180px]`}
            />
            <input
              value={captionLabel}
              onChange={(e) => setCaptionLabel(e.target.value)}
              placeholder="Label"
              aria-label="Caption language label"
              className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <label htmlFor={captionLangId} className="sr-only">
              Caption language
            </label>
            <select
              id={captionLangId}
              value={captionLang}
              onChange={(e) => onCaptionLang(e.target.value as Locale)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
            >
              {CONTENT_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
          </div>
          {captionUpload.problem ? (
            <StorageNotice
              storage={captionUpload.storage}
              id={captionNoticeId}
              whenMissing={
                <p>Meanwhile, you can paste a link to a .vtt file instead.</p>
              }
            />
          ) : null}
          <UploadStatus
            label="Caption upload progress"
            state={captionUpload.state}
            message={captionMessage}
            onRetry={
              failedCaption && !captionUpload.problem
                ? () => void sendCaption(failedCaption.file)
                : undefined
            }
          />
          {captionLocalOnly ? (
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
              {captionUpload.state.phase === "uploading" ? (
                <span>Captions not saved yet — still uploading.</span>
              ) : (
                <span>
                  Captions not saved yet — they&apos;re only on your computer.
                  Upload the file again, paste a link to a .vtt file, or{" "}
                  <button
                    type="button"
                    onClick={() => onCaptionUrl("")}
                    className="font-medium text-[var(--accent)] underline underline-offset-2"
                  >
                    remove them
                  </button>
                  .
                </span>
              )}
            </p>
          ) : isStorableMediaUrl(captionSrc) ? (
            <p className="mt-1.5 text-xs text-[var(--success)] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Captions attached.
              {/* An uploaded file's link isn't in the URL box to clear. */}
              <button
                type="button"
                onClick={() => onCaptionUrl("")}
                aria-label="Remove captions"
                className="font-medium text-[var(--accent)] underline underline-offset-2"
              >
                Remove
              </button>
            </p>
          ) : captionSrc ? (
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
              {mediaUrlMessage("caption", "not-web")}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
              No captions yet — add a .vtt so the video meets WCAG 2.2 AA.
            </p>
          )}
        </div>

        {/* Cue editor */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-[var(--accent)]" />
              In-video questions
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCues((c) => [...c, newCue()])}
            >
              <Plus className="h-4 w-4" />
              Add question
            </Button>
          </div>

          {cues.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              No questions yet. Add one to pause the video and quiz the learner
              at a chosen moment.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {cues.map((cue, ci) => (
                <CueEditor
                  key={cue.key}
                  index={ci}
                  cue={cue}
                  onChange={(next) =>
                    setCues((all) =>
                      all.map((c) => (c.key === cue.key ? next : c))
                    )
                  }
                  onRemove={() =>
                    setCues((all) => all.filter((c) => c.key !== cue.key))
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="mt-6">
          <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <Eye className="h-4 w-4 text-[var(--accent)]" />
            Live preview — exactly what the learner sees
          </h4>
          {draft && localOnly ? (
            <p className="mb-2 text-xs text-[var(--muted-foreground)] flex flex-wrap items-center gap-1.5">
              <Badge variant="muted" className="text-[10px]">
                Not saved yet
              </Badge>
              This preview plays from your computer. It can be saved to a
              lesson once the upload has finished.
            </p>
          ) : null}
          {draft ? (
            <InteractiveVideoPlayer video={draft} />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
              Add a video above to preview it here.
            </div>
          )}
        </div>

        {/* Save to the lesson (persists to the DB) */}
        <div className="mt-5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={
                !draft ||
                saveBlocked ||
                saveState === "saving" ||
                saveState === "removing"
              }
              onClick={handleSaveToLesson}
              aria-describedby={saveHint ? saveHintId : undefined}
            >
              {saveState === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save video
            </Button>
            {stored ? (
              <Button
                size="sm"
                variant="outline"
                disabled={
                  saveState === "saving" || saveState === "removing"
                }
                onClick={handleRemove}
              >
                {saveState === "removing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {/* What learners see afterwards is in the confirm and the
                    status message, so the label stays short enough for a
                    phone. */}
                Remove video
              </Button>
            ) : null}
            {saveStatus}
          </div>
          {saveHint ? (
            <p
              id={saveHintId}
              className="mt-2 text-xs text-[var(--muted-foreground)]"
            >
              {saveHint}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CueEditor({
  index,
  cue,
  onChange,
  onRemove,
}: {
  index: number;
  cue: EditableCue;
  onChange: (c: EditableCue) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<EditableCue>) => onChange({ ...cue, ...patch });

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" className="text-[10px]">
          Q{index + 1}
        </Badge>
        <label className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
          Pause at
          <input
            type="number"
            min={0}
            value={cue.atSeconds}
            onChange={(e) =>
              set({ atSeconds: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          />
          s ({formatTimecode(cue.atSeconds)})
        </label>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove question ${index + 1}`}
          className="ml-auto rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--danger)]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <input
        value={cue.question}
        onChange={(e) => set({ question: e.target.value })}
        placeholder="Question shown when the video pauses"
        className={`${inputCls} mt-2`}
      />

      <div className="mt-2 space-y-1.5">
        {cue.options.map((o, oi) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${cue.key}-correct`}
              checked={cue.correctOptionId === o.id}
              onChange={() => set({ correctOptionId: o.id })}
              aria-label={`Mark option ${oi + 1} correct`}
              className="h-4 w-4 accent-[var(--success)]"
            />
            <input
              value={o.text}
              onChange={(e) =>
                set({
                  options: cue.options.map((x) =>
                    x.id === o.id ? { ...x, text: e.target.value } : x
                  ),
                })
              }
              placeholder={`Option ${oi + 1}${
                cue.correctOptionId === o.id ? " (correct)" : ""
              }`}
              className={inputCls}
            />
            {cue.options.length > 2 ? (
              <button
                type="button"
                onClick={() =>
                  set({
                    options: cue.options.filter((x) => x.id !== o.id),
                    correctOptionId:
                      cue.correctOptionId === o.id
                        ? cue.options.find((x) => x.id !== o.id)!.id
                        : cue.correctOptionId,
                  })
                }
                aria-label={`Remove option ${oi + 1}`}
                className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        {cue.options.length < 4 ? (
          <button
            type="button"
            onClick={() =>
              set({
                options: [
                  ...cue.options,
                  {
                    id: String.fromCharCode(97 + cue.options.length),
                    text: "",
                  },
                ],
              })
            }
            className="text-xs text-[var(--accent)] font-medium inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Add option
          </button>
        ) : null}
      </div>

      <input
        value={cue.explanation}
        onChange={(e) => set({ explanation: e.target.value })}
        placeholder="Explanation shown after answering (optional)"
        className={`${inputCls} mt-2`}
      />
    </div>
  );
}
