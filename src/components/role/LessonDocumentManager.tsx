"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getLessonMedia,
  addLessonDocument,
  removeLessonDocument,
  setLessonDocumentOrder,
  setLessonDocumentPublished,
} from "@/app/actions/lesson";
import { setLessonDocumentLanguages } from "@/app/actions/lesson-reading";
import type { StaffLessonLink } from "@/lib/cms/lesson-links";
import type { LessonDocumentRef, Locale } from "@/lib/cms/types";
import { LessonLinkManager } from "@/components/role/LessonLinkManager";
import { Button } from "@/components/ui/button";
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
  Languages,
  Plus,
} from "lucide-react";

/** The languages a document can be for (D108), in the order they are named. */
const LANGUAGES: { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
];
const EVERY: Locale[] = ["en", "de", "el"];
const nameOf = (code: Locale) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
/** Three boxes ticked, or none stored ([]): every language. */
const isEvery = (languages: readonly Locale[] | undefined) =>
  !languages?.length || EVERY.every((l) => languages.includes(l));

/** Why an upload's (or a row's) languages can't be used: none ticked. Null when they can. */
export function uploadLanguagesProblem(languages: readonly Locale[]): string | null {
  return languages.length ? null : "Choose at least one language.";
}

/** A document's badge: the languages it is for, named; null when it is for every language. */
export function documentLanguagesBadge(languages: readonly Locale[] | undefined): string | null {
  return isEvery(languages) ? null : EVERY.filter((l) => languages!.includes(l)).map(nameOf).join(", ");
}

/** What the status line says once a document's languages are saved. */
function languagesNotice(name: string, languages: readonly Locale[]): string {
  if (isEvery(languages)) return `“${name}” is for every language.`;
  const names = EVERY.filter((l) => languages.includes(l)).map(nameOf);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `“${name}” is for ${list} learners.`;
}

/** Said on a row whose languages couldn't be set after its upload (spec 4.6). */
export const LANGUAGES_FAILED = "Added for every language; set its languages again.";

/** An uploaded file waiting to be added to the lesson. */
interface PendingDocument {
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

type AddAnswer = Awaited<ReturnType<typeof addLessonDocument>>;

/**
 * Adds an uploaded file to the lesson with the languages it is for (D108):
 * first for every language, as addLessonDocument always adds one (D68: no
 * new required argument), then, for a choice other than every language,
 * its languages (setLessonDocumentLanguages). A document whose languages
 * couldn't be set stays, a draft, for every language (`languages:
 * "failed"`), and the card says to set them again. Throws only what adding
 * it throws.
 */
export async function attachDocument(
  courseSlug: string,
  stageKey: string,
  doc: PendingDocument,
  languages: readonly Locale[],
  actions: {
    addLessonDocument: typeof addLessonDocument;
    setLessonDocumentLanguages: typeof setLessonDocumentLanguages;
  } = { addLessonDocument, setLessonDocumentLanguages }
): Promise<
  | { added: false; answer: Exclude<AddAnswer, { ok: true }> }
  | { added: true; id: string; languages: "every" | "set" | "failed" }
> {
  const answer = await actions.addLessonDocument(courseSlug, stageKey, doc);
  if (!answer.ok) return { added: false, answer };
  if (isEvery(languages)) return { added: true, id: answer.id, languages: "every" };
  try {
    const set = await actions.setLessonDocumentLanguages(answer.id, [...languages]);
    return { added: true, id: answer.id, languages: set.ok ? "set" : "failed" };
  } catch {
    return { added: true, id: answer.id, languages: "failed" };
  }
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
 * A lesson's documents and further reading, in one card ("Documents and
 * further reading", Release 4, spec 4.6).
 *
 * Documents (PDF/Office/images): two steps, the file goes to Vercel Blob
 * (useBlobUpload), then the lesson gets a row pointing at it — each with
 * its own "Try again". The languages a document is for (D108) are chosen
 * before the upload (three boxes, every language ticked) and changed on its
 * row ("Languages"); a row for some languages only names them.
 *
 * Further reading (D107): "Add a link" sits next to "Upload document" and
 * opens the link manager's form; the links follow the documents
 * (LessonLinkManager). Further reading is never content: it makes no lesson
 * appear (`linkHints`, the page's words on that).
 *
 * A new document or link starts hidden from learners (even on a live
 * course) until the editor chooses "Show to learners"; the list says so in
 * words.
 *
 * The course page gives the lesson (`courseSlug`, `stageKey`, its documents
 * as `initialDocuments` and its links as `initialLinks`); `onChange` and
 * `onLinksChanged` report the lists after every change that went through.
 */
export function LessonDocumentManager({
  courseSlug,
  stageKey,
  initialDocuments,
  initialLinks,
  embedded = false,
  onChange,
  onLinksChanged,
  linkHints = [],
}: {
  courseSlug: string;
  /** The lesson's id: a stage key, or a Release 1 lesson's "s-…". */
  stageKey: string;
  /** Every document on the lesson, drafts included; skips the first load. */
  initialDocuments?: LessonDocumentRef[];
  /** Every further-reading link on the lesson, drafts included; skips their first load. */
  initialLinks?: StaffLessonLink[];
  /** Inside a lesson on the course page: lighter frame. */
  embedded?: boolean;
  onChange?: (docs: LessonDocumentRef[]) => void;
  onLinksChanged?: (links: StaffLessonLink[]) => void;
  /** What the page knows of the lesson, in words (LessonLinkManager's linkHints). */
  linkHints?: readonly string[];
}) {
  const [docs, setDocs] = React.useState<LessonDocumentRef[]>(
    initialDocuments ?? []
  );
  // The page's language: a document's name keeps it (see the render).
  const pageLang = useLocale() as Locale;
  // The languages of the next upload (D108): every language unless changed.
  const [uploadLanguages, setUploadLanguages] = React.useState<Locale[]>(EVERY);
  const uploadProblem = uploadLanguagesProblem(uploadLanguages);
  // Documents whose languages couldn't be set after their upload.
  const [languagesFailed, setLanguagesFailed] = React.useState<ReadonlySet<string>>(new Set());
  // The row whose "Languages" are open, and the link form opened from this card.
  const [editingLanguages, setEditingLanguages] = React.useState<string | null>(null);
  const [addingLink, setAddingLink] = React.useState(false);
  const addLinkRef = React.useRef<HTMLButtonElement>(null);
  const ids = React.useId();
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
  const pickerDisabled = upload.problem !== null || busy || uploadProblem !== null;

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
      const attached = await attachDocument(courseSlug, stageKey, doc, uploadLanguages);
      if (attached.added) {
        if (attached.languages === "failed") setLanguagesFailed((s) => new Set(s).add(attached.id));
        setAttach({ phase: "done", name: doc.name });
        refresh();
        return;
      }
      const res = attached.answer;
      // A file that isn't on our own store (D91): trying again can't work.
      if (res.error === "host-refused" || res.error === "host-unconfigured") {
        setAttach({ phase: "failed", message: res.message, retry: null });
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
    if (
      !window.confirm(
        `Remove “${doc.name}” from this lesson? Learners will no longer see it. The file is deleted for good about a week later.`
      )
    )
      return;
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
    // The pressed arrow moves with its row; at either end it can't be
    // pressed again, so focus goes to the row's other arrow.
    const moved = docs[index].id;
    if (j === 0 || j === docs.length - 1) {
      requestAnimationFrame(() =>
        document.getElementById(`${ids}-${j === 0 ? "down" : "up"}-${moved}`)?.focus()
      );
    }
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

  /** A row's languages saved (D108): the list follows, and the status line says what they are now. */
  async function saveLanguages(doc: LessonDocumentRef, languages: Locale[]): Promise<string | null> {
    const what = `Couldn't set the languages of “${doc.name}”`;
    setListError("");
    setListNotice("");
    try {
      const res = await setLessonDocumentLanguages(doc.id, languages);
      if (!res.ok) return await changeFailure(what, "refused");
    } catch (thrown) {
      return await changeFailure(what, { thrown });
    }
    const stored = isEvery(languages) ? [] : EVERY.filter((l) => languages.includes(l));
    const next = docs.map((d) => (d.id === doc.id ? { ...d, languages: stored } : d));
    setDocs(next);
    report.current?.(next);
    setLanguagesFailed((s) => {
      const left = new Set(s);
      left.delete(doc.id);
      return left;
    });
    setListNotice(languagesNotice(doc.name, stored));
    return null;
  }

  // Its own words are English on every locale's page: marked lang="en"
  // (WCAG 3.1.2). A document's name, or a link's title, is in the one
  // language it is for, else in a language no one has recorded, so it
  // keeps the page's, as the lesson's read view and learners' pages show it.
  const nameLang = (languages: readonly Locale[] | undefined) =>
    languages?.length === 1 ? languages[0] : pageLang;
  return (
    <Card lang="en" className={cn(embedded && "shadow-none")}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
              Documents and further reading
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Attach PDFs, Office files or images to a lesson, and links to read further.
            </p>
          </div>
        </div>

        <fieldset className="mb-3" aria-describedby={uploadProblem ? `${ids}-upload-languages-p` : undefined}>
          <legend className="text-xs font-medium">Languages of the next document you upload</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {LANGUAGES.map((l) => (
              <label key={l.code} className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={uploadLanguages.includes(l.code)}
                  onChange={(e) =>
                    setUploadLanguages(
                      e.target.checked
                        ? EVERY.filter((c) => c === l.code || uploadLanguages.includes(c))
                        : uploadLanguages.filter((c) => c !== l.code)
                    )
                  }
                />
                {l.name}
              </label>
            ))}
          </div>
          {uploadProblem ? (
            <p id={`${ids}-upload-languages-p`} className="mt-1 flex items-start gap-1 text-xs text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {uploadProblem}
            </p>
          ) : null}
        </fieldset>

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
              aria-describedby={
                [upload.storage ? noticeId : null, uploadProblem ? `${ids}-upload-languages-p` : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="sr-only"
            />
          </label>
          <Button
            ref={addLinkRef}
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={addingLink}
            onClick={() => setAddingLink(true)}
            className="h-auto py-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add a link
          </Button>
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
                    {/* Each arrow a 24 × 24 pixel target (WCAG 2.5.8), as the link list's. */}
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        id={`${ids}-up-${d.id}`}
                        type="button"
                        onClick={() => move(i, "up")}
                        disabled={i === 0}
                        aria-label={`Move ${d.name} up`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        id={`${ids}-down-${d.id}`}
                        type="button"
                        onClick={() => move(i, "down")}
                        disabled={i === docs.length - 1}
                        aria-label={`Move ${d.name} down`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--accent)] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <FileText className="h-4 w-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      lang={nameLang(d.languages)}
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
                    {documentLanguagesBadge(d.languages) ? (
                      <Badge variant="muted" className="text-[10px]">
                        {documentLanguagesBadge(d.languages)}
                      </Badge>
                    ) : null}
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
                      id={`${ids}-languages-${d.id}`}
                      type="button"
                      onClick={() => setEditingLanguages(editingLanguages === d.id ? null : d.id)}
                      aria-expanded={editingLanguages === d.id}
                      aria-label={`Languages: ${d.name}`}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
                    >
                      <Languages className="h-3.5 w-3.5" aria-hidden />
                      Languages
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
                  {languagesFailed.has(d.id) ? (
                    <p className="basis-full flex items-start gap-1 text-xs text-[var(--danger)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                      {LANGUAGES_FAILED}
                    </p>
                  ) : null}
                  {editingLanguages === d.id ? (
                    <DocumentLanguages
                      name={d.name}
                      initial={isEvery(d.languages) ? EVERY : (d.languages as Locale[])}
                      onSave={async (languages) => {
                        const problem = await saveLanguages(d, languages);
                        if (problem) return problem;
                        setEditingLanguages(null);
                        requestAnimationFrame(() => document.getElementById(`${ids}-languages-${d.id}`)?.focus());
                        return null;
                      }}
                      onCancel={() => {
                        setEditingLanguages(null);
                        requestAnimationFrame(() => document.getElementById(`${ids}-languages-${d.id}`)?.focus());
                      }}
                    />
                  ) : null}
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

        {/* Further reading (D107): its own list, after the documents; its
            form opens from "Add a link" above. */}
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <LessonLinkManager
            courseSlug={courseSlug}
            stageKey={stageKey}
            initialLinks={initialLinks}
            onLinksChanged={onLinksChanged}
            adding={addingLink}
            onAddingChange={(open) => {
              setAddingLink(open);
              // The form closed: focus goes back to the button that opened it.
              if (!open) requestAnimationFrame(() => addLinkRef.current?.focus());
            }}
            hints={linkHints}
            textLang={pageLang}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A document's languages (D108), on its row: three boxes, at least one
 * ticked; Save sends them, Cancel or Escape leaves them as they were.
 * Problems show under the boxes, which they describe. Not a <form>: the card
 * may sit inside one.
 */
function DocumentLanguages({
  name,
  initial,
  onSave,
  onCancel,
}: {
  name: string;
  initial: readonly Locale[];
  /** Saves; answers a problem in words, or null once saved. */
  onSave: (languages: Locale[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const ids = React.useId();
  const [languages, setLanguages] = React.useState<Locale[]>([...initial]);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const first = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    first.current?.focus();
  }, []);

  async function save() {
    if (saving) return;
    const none = uploadLanguagesProblem(languages);
    if (none) {
      setProblem(none);
      first.current?.focus();
      return;
    }
    setSaving(true);
    try {
      setProblem(await onSave(languages));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={`Languages of “${name}”`}
      className="basis-full space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <fieldset aria-describedby={problem ? `${ids}-p` : undefined}>
        <legend className="text-xs font-medium">Languages it is for</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {LANGUAGES.map((l, i) => (
            <label key={l.code} className="inline-flex items-center gap-1.5 text-sm">
              <input
                ref={i === 0 ? first : undefined}
                type="checkbox"
                checked={languages.includes(l.code)}
                onChange={(e) =>
                  setLanguages(
                    e.target.checked
                      ? EVERY.filter((c) => c === l.code || languages.includes(c))
                      : languages.filter((c) => c !== l.code)
                  )
                }
              />
              {l.name}
            </label>
          ))}
        </div>
      </fieldset>
      {problem ? (
        <p id={`${ids}-p`} role="alert" className="flex items-start gap-1 text-xs text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void save()} aria-disabled={saving ? true : undefined}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
