"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InteractiveVideoPlayer } from "@/components/course/InteractiveVideoPlayer";
import { detectProvider, formatTimecode } from "@/lib/video";
import { saveLessonVideo } from "@/app/actions/lesson";
import { STAGES } from "@/data/course";
import type { VideoContent, VideoCue } from "@/lib/cms/types";
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
 */

let cueSeq = 0;
const newCue = (): EditableCue => ({
  key: `cue-${cueSeq++}`,
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

export function VideoBlockAuthor({
  courses = [],
}: {
  courses?: { slug: string; title: string }[];
}) {
  const [tab, setTab] = React.useState<"upload" | "url">("upload");
  const [targetCourse, setTargetCourse] = React.useState(courses[0]?.slug ?? "");
  const [targetStage, setTargetStage] = React.useState("concept");
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = React.useState("");
  const [provider, setProvider] = React.useState<"file" | "youtube">("file");
  const [src, setSrc] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fromUpload, setFromUpload] = React.useState(false);
  const upload = useBlobUpload(VIDEO_UPLOAD);
  const noticeId = React.useId();
  const saveHintId = React.useId();
  const [title, setTitle] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [captionSrc, setCaptionSrc] = React.useState("");
  const [captionLabel, setCaptionLabel] = React.useState("English");
  // captionFromUpload: captionSrc is a picked file (local, then stored), not a
  // pasted link. captionPicked: the upload's outcome is still worth showing.
  const [captionFromUpload, setCaptionFromUpload] = React.useState(false);
  const [captionPicked, setCaptionPicked] = React.useState(false);
  const captionUpload = useBlobUpload(CAPTION_UPLOAD);
  const captionNoticeId = React.useId();
  const [cues, setCues] = React.useState<EditableCue[]>([]);
  const objectUrl = React.useRef<string | null>(null);
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
                lang: "en",
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
    if (!draft || !targetCourse || saveBlocked) return;
    setSaveState("saving");
    try {
      const res = await saveLessonVideo(targetCourse, targetStage, draft);
      if (res.ok) {
        setSaveState("saved");
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

  return (
    <Card className="border-[var(--accent)]/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <Film className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Interactive video</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Add a lesson video, then drop in questions that pause it.
            </p>
          </div>
          <Badge variant="primary" className="ml-auto text-[10px]">
            New
          </Badge>
        </div>

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
                      onClick={() => setTab("url")}
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
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
                Video URL (direct .mp4/.webm or a YouTube link)
              </label>
              <input
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
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Speaking up without blame"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
              Caption (optional)
            </label>
            <input
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

        {/* Save to a lesson (persists to the DB) */}
        {courses.length ? (
          <div className="mt-5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
            <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Save className="h-4 w-4 text-[var(--accent)]" />
              Save this video to a lesson
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted-foreground)]">
                <span className="block mb-1">Course</span>
                <select
                  value={targetCourse}
                  onChange={(e) => {
                    setTargetCourse(e.target.value);
                    setSaveState("idle");
                  }}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  {courses.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--muted-foreground)]">
                <span className="block mb-1">Lesson stage</span>
                <select
                  value={targetStage}
                  onChange={(e) => {
                    setTargetStage(e.target.value);
                    setSaveState("idle");
                  }}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm capitalize"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                disabled={
                  !draft ||
                  !targetCourse ||
                  saveBlocked ||
                  saveState === "saving"
                }
                onClick={handleSaveToLesson}
                aria-describedby={saveHint ? saveHintId : undefined}
              >
                {saveState === "saving" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save to lesson
                  </>
                )}
              </Button>
              <span role="status" aria-live="polite">
                {saveState === "saved" ? (
                  <span className="text-xs text-[var(--success)] inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Saved — learners see it on this lesson.
                  </span>
                ) : saveState === "error" ? (
                  <span className="text-xs text-[var(--danger)] inline-flex items-start gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    {saveError}
                  </span>
                ) : null}
              </span>
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
        ) : (
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Create a course first — then you can save this video, with its
            questions, to one of its lessons.
          </p>
        )}
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
