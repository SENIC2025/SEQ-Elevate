"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getLessonMedia,
  addLessonDocument,
  removeLessonDocument,
  setLessonDocumentOrder,
  setLessonDocumentPublished,
} from "@/app/actions/lesson";
import type { LessonDocumentRef } from "@/lib/cms/types";
import { DOCUMENT_UPLOAD, acceptAttribute, formatSize } from "@/lib/uploads";
import {
  attachFailureMessage,
  isNetworkError,
  lessonListRefusal,
} from "@/lib/author-feedback";
import { cn } from "@/lib/utils";
import {
  fetchStorageStatus,
  useBlobUpload,
} from "@/components/role/useBlobUpload";
import { StorageNotice, UploadStatus } from "@/components/role/UploadFeedback";
import {
  FileText,
  Upload,
  Loader2,
  Trash2,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-react";

/** An uploaded file waiting to be added to the lesson. */
interface PendingDocument {
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

type AttachState =
  | { phase: "idle" }
  | { phase: "attaching" }
  | { phase: "done"; name: string }
  | { phase: "failed"; message: string; retry: PendingDocument | null };

/**
 * Why a change to the list didn't go through. "forbidden" covers both signed
 * out and not an editor, so a refusal asks the status endpoint which.
 */
async function changeFailure(
  what: string,
  failure: { thrown: unknown } | "refused"
): Promise<string> {
  if (failure !== "refused") {
    return isNetworkError(failure.thrown)
      ? `${what}: the connection was interrupted. Try again.`
      : `${what}: the server ran into a problem. Try again.`;
  }
  const access = await fetchStorageStatus();
  if (access && !access.signedIn) {
    return `${what}: you're not signed in any more. Sign in again in a new tab, then try again.`;
  }
  if (access?.signedIn && !access.canUpload) {
    return `${what}: your account can't edit courses. Ask an administrator for the Editor role.`;
  }
  return `${what}: the server refused the change. Try again.`;
}

/**
 * Upload documents (PDF/Office/images) and attach them to a lesson. Two
 * steps: the file goes to Vercel Blob (useBlobUpload), then the lesson gets a
 * row pointing at it — each with its own "Try again".
 *
 * A new document starts hidden from learners (even on a live course) until
 * the editor chooses "Show to learners"; the list says so in words.
 *
 * The course page gives the lesson (`courseSlug`, `stageKey`, and its
 * documents as `initialDocuments`); `onChange` reports the list after every
 * change that went through.
 */
export function LessonDocumentManager({
  courseSlug,
  stageKey,
  initialDocuments,
  embedded = false,
  onChange,
}: {
  courseSlug: string;
  /** The lesson's id: a stage key, or a Release 1 lesson's "s-…". */
  stageKey: string;
  /** Every document on the lesson, drafts included; skips the first load. */
  initialDocuments?: LessonDocumentRef[];
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  onChange?: (docs: LessonDocumentRef[]) => void;
}) {
  const [docs, setDocs] = React.useState<LessonDocumentRef[]>(
    initialDocuments ?? []
  );
  const upload = useBlobUpload(DOCUMENT_UPLOAD);
  const [attach, setAttach] = React.useState<AttachState>({ phase: "idle" });
  const [listError, setListError] = React.useState("");
  // Said once a document is removed (its row, and its buttons, are gone).
  const [listNotice, setListNotice] = React.useState("");
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const noticeId = React.useId();
  const [reloadKey, setReloadKey] = React.useState(0);
  const refresh = () => setReloadKey((k) => k + 1);
  // The page handed over the lesson's documents: the first load is done.
  const [seededKey] = React.useState(() =>
    initialDocuments !== undefined ? `${courseSlug}:${stageKey}` : null
  );
  const report = React.useRef(onChange);
  React.useEffect(() => {
    report.current = onChange;
  });

  // Load the lesson's documents whenever the lesson (or a reload) changes.
  React.useEffect(() => {
    if (reloadKey === 0 && seededKey === `${courseSlug}:${stageKey}`) return;
    let cancelled = false;
    (async () => {
      const media = await getLessonMedia(courseSlug, stageKey);
      if (cancelled) return;
      setDocs(media.documents);
      report.current?.(media.documents);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseSlug, stageKey, reloadKey, seededKey]);

  const busy =
    upload.state.phase === "uploading" || attach.phase === "attaching";
  const pickerDisabled = upload.problem !== null || busy;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (f) void send(f);
  }

  async function send(f: File) {
    setAttach({ phase: "idle" });
    setListNotice("");
    const stored = await upload.start(f);
    if (!stored) return;
    await attachToLesson({
      name: f.name,
      url: stored.url,
      mimeType: stored.contentType,
      sizeBytes: f.size,
    });
  }

  async function attachToLesson(doc: PendingDocument) {
    setAttach({ phase: "attaching" });
    try {
      const res = await addLessonDocument(courseSlug, stageKey, doc);
      if (res.ok) {
        setAttach({ phase: "done", name: doc.name });
        refresh();
        return;
      }
      // A lesson of the course's own that left the lesson list, or a list
      // that can't be read: trying again can't work (Release 1).
      const listRefusal = lessonListRefusal(res.error);
      if (listRefusal) {
        setAttach({
          phase: "failed",
          message: attachFailureMessage({ kind: "lesson-list", error: listRefusal }),
          retry: null,
        });
        return;
      }
      // "forbidden" covers both signed out and not an editor — ask which.
      const access = await fetchStorageStatus();
      const permitted = !(access?.signedIn && !access.canUpload);
      setAttach({
        phase: "failed",
        message: attachFailureMessage({ kind: "refused", access }),
        retry: permitted ? doc : null,
      });
    } catch (error) {
      setAttach({
        phase: "failed",
        message: attachFailureMessage({ kind: "thrown", error }),
        retry: doc,
      });
    }
  }

  const failedUpload = upload.state.phase === "failed" ? upload.state : null;
  const uploadMessage =
    attach.phase === "attaching"
      ? { tone: "success" as const, text: "Uploaded — adding it to the lesson…" }
      : attach.phase === "done"
        ? {
            tone: "success" as const,
            text: `Added “${attach.name}” as a draft — learners can't see it until you choose “Show to learners”.`,
          }
        : attach.phase === "failed"
          ? { tone: "error" as const, text: attach.message }
          : upload.state.phase === "failed" ||
              upload.state.phase === "rejected"
            ? { tone: "error" as const, text: upload.state.message }
            : null;
  // "Try again" repeats whichever step failed: adding the stored file to the
  // lesson, or the upload itself.
  const retryAttach = attach.phase === "failed" ? attach.retry : null;
  const onRetry = retryAttach
    ? () => void attachToLesson(retryAttach)
    : failedUpload && attach.phase === "idle" && !upload.problem
      ? () => void send(failedUpload.file)
      : undefined;

  async function onRemove(doc: LessonDocumentRef) {
    if (!window.confirm(`Remove “${doc.name}” from this lesson?`)) return;
    // Its row goes away: keep focus in this editor rather than the page.
    headingRef.current?.focus();
    setListError("");
    setListNotice("");
    const what = `Couldn't remove “${doc.name}”`;
    try {
      const res = await removeLessonDocument(doc.id);
      if (res.ok) {
        setListNotice(`Removed “${doc.name}” from this lesson.`);
        refresh();
      } else setListError(await changeFailure(what, "refused"));
    } catch (thrown) {
      setListError(await changeFailure(what, { thrown }));
    }
  }

  // Order and visibility change on screen at once, and go back as they were
  // if the server doesn't take the change.
  async function applyOptimistic(
    next: LessonDocumentRef[],
    what: string,
    save: () => Promise<{ ok: boolean }>
  ) {
    const previous = docs;
    setDocs(next);
    setListError("");
    setListNotice("");
    try {
      const res = await save();
      if (res.ok) {
        report.current?.(next);
        return;
      }
      setDocs(previous);
      setListError(await changeFailure(what, "refused"));
    } catch (thrown) {
      setDocs(previous);
      setListError(await changeFailure(what, { thrown }));
    }
  }

  async function move(index: number, dir: "up" | "down") {
    const j = dir === "up" ? index - 1 : index + 1;
    if (j < 0 || j >= docs.length) return;
    const next = [...docs];
    [next[index], next[j]] = [next[j], next[index]];
    await applyOptimistic(next, "Couldn't save the new order", () =>
      setLessonDocumentOrder(next.map((d) => d.id))
    );
  }

  async function togglePublish(doc: LessonDocumentRef, published: boolean) {
    const next = docs.map((d) => (d.id === doc.id ? { ...d, published } : d));
    await applyOptimistic(
      next,
      published
        ? `Couldn't show “${doc.name}” to learners`
        : `Couldn't hide “${doc.name}” from learners`,
      () => setLessonDocumentPublished(doc.id, published)
    );
  }

  return (
    <Card className={cn(embedded && "shadow-none")}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
              Lesson documents
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Attach PDFs, Office files or images to a lesson.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label
            className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[var(--ring)] ${
              pickerDisabled
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-[var(--surface-muted)]"
            }`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload document
            <input
              type="file"
              accept={acceptAttribute(DOCUMENT_UPLOAD)}
              onChange={onPick}
              disabled={pickerDisabled}
              aria-describedby={upload.storage ? noticeId : undefined}
              className="sr-only"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {DOCUMENT_UPLOAD.formats} · up to{" "}
          {formatSize(DOCUMENT_UPLOAD.maxBytes)} each.
        </p>
        <StorageNotice storage={upload.storage} id={noticeId} />
        <UploadStatus
          state={upload.state}
          message={uploadMessage}
          onRetry={onRetry}
        />

        <div className="mt-4">
          {docs.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              No documents on this lesson yet.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {docs.map((d, i) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-[var(--border)] px-2 py-2 text-sm"
                >
                  <div className="flex min-w-[10rem] flex-1 items-center gap-2">
                    <span className="flex h-6 w-7 flex-shrink-0 items-center justify-center rounded bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent)] tabular-nums">
                      {i + 1}
                    </span>
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => move(i, "up")}
                        disabled={i === 0}
                        aria-label={`Move ${d.name} up`}
                        className="text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, "down")}
                        disabled={i === docs.length - 1}
                        aria-label={`Move ${d.name} down`}
                        className="text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <FileText className="h-4 w-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`min-w-0 flex-1 truncate hover:underline ${
                        d.published ? "" : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {d.name}
                    </a>
                    <span className="hidden sm:inline text-xs text-[var(--muted-foreground)] tabular-nums">
                      {formatSize(d.sizeBytes)}
                    </span>
                  </div>
                  {/* Wraps under the name on a phone. */}
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    {d.published ? (
                      <Badge variant="success" className="text-[10px]">
                        Published
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">
                        Draft — hidden from learners
                      </Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => togglePublish(d, !d.published)}
                      aria-label={
                        d.published
                          ? `Hide from learners: ${d.name}`
                          : `Show to learners: ${d.name}`
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
                    >
                      {d.published ? (
                        <EyeOff className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {d.published ? "Hide from learners" : "Show to learners"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(d)}
                      aria-label={`Remove ${d.name}`}
                      className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {docs.length > 1 ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Use the arrows to set the order learners see (1, 2, 3…).
            </p>
          ) : null}
          <p
            role="status"
            aria-live="polite"
            className={
              listNotice
                ? "mt-2 text-xs text-[var(--muted-foreground)]"
                : "sr-only"
            }
          >
            {listNotice}
          </p>
          {listError ? (
            <p
              role="alert"
              className="mt-2 text-xs text-[var(--danger)] flex items-start gap-1.5"
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              {listError}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
