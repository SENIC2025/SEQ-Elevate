"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  saveLessonNarrative,
  clearLessonNarrative,
} from "@/app/actions/lesson";
import type { Locale, NarrativeBlock, StageKey } from "@/lib/cms/types";
import type {
  CourseKind,
  NarrativeInitial,
} from "@/lib/cms/course-admin-types";
import { saveFailureMessage } from "@/lib/author-feedback";
import { fetchStorageStatus } from "@/components/role/useBlobUpload";
import { BlockList, withKeys } from "@/components/role/narrative/BlockList";
import { inputCls } from "@/components/role/narrative/BlockEditor";
import { stripKey } from "@/components/role/narrative/block-ops";
import {
  PenSquare,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Undo2,
  RefreshCw,
} from "lucide-react";

// Authoring-tool copy stays English (like the other tools), so language
// names are English too.
const LANGUAGE: Record<Locale, string> = {
  en: "English",
  de: "German",
  el: "Greek",
};

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "reverting"
  | "reverted"
  | "reloading"
  | "reloaded"
  | "discarded";

/** The first paragraph's text — all a reflection lesson's intro is. */
const introOf = (blocks: NarrativeBlock[]) =>
  blocks.find((b) => b.kind === "paragraph")?.text ?? "";

/**
 * The teaching text of one lesson in one language, on the course page.
 *
 * The page chooses the course, lesson and language, and hands in where to
 * start (`initial`, from the course outline) — so the editor never loads
 * anything itself and can't save one lesson's text into another. The page
 * remounts it (keyed by language) to switch language.
 *
 * mode "reflection" edits a created course's reflection lesson: just its
 * title and introduction (the questions learners answer are fixed). The
 * learner view reads back exactly the title and the first paragraph.
 *
 * Saves go live at once on a published course (D33); the page says so.
 *
 * Each save (and "Remove") sends back the fingerprint of the text it started
 * from. If a colleague saved this language since, the server refuses, and the
 * editor offers to load their version instead of overwriting it unseen.
 */
export function LessonNarrativeEditor({
  courseSlug,
  stageKey,
  locale,
  initial,
  initialRev = 0,
  courseKind,
  mode = "narrative",
  prompts = [],
  embedded = false,
  onSaved,
  onDirtyChange,
  onReread,
}: {
  courseSlug: string;
  stageKey: StageKey;
  locale: Locale;
  /** What learners see now, in this language (from the course outline). */
  initial: NarrativeInitial;
  /**
   * The page bumps this after re-reading the lesson (see onReread): the
   * editor then starts over from `initial`. Any other change to `initial`
   * is ignored, so a refresh never overwrites what is being typed.
   */
  initialRev?: number;
  courseKind: CourseKind;
  mode?: "narrative" | "reflection";
  /** Reflection only: the fixed questions learners answer (shown read-only). */
  prompts?: string[];
  /** On the course page: no card of its own. */
  embedded?: boolean;
  onSaved?: (value: NarrativeInitial) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Ask the page to re-read this lesson and bump `initialRev` once the text
   * is no longer `stale` (the version this editor had) — after this
   * language's text was deleted (only the server knows what learners see
   * instead: built-in text, the English text, or the defaults), or to load a
   * colleague's newer save.
   */
  onReread: (stale: string | null) => void;
}) {
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const lang = LANGUAGE[locale];
  const reflection = mode === "reflection";

  const [title, setTitle] = React.useState(initial.title);
  const [subtitle, setSubtitle] = React.useState(initial.subtitle);
  const [blocks, setBlocks] = React.useState(() => withKeys(initial.blocks));
  const [intro, setIntro] = React.useState(() => introOf(initial.blocks));
  const [hasOverride, setHasOverride] = React.useState(initial.hasOverride);
  const [fallbackFrom, setFallbackFrom] = React.useState(initial.fallbackFrom);
  // What a save or "Discard changes" goes back to.
  const [baseline, setBaseline] = React.useState(initial);
  // Unsaved = edits made since the last save / load. Counting (rather than a
  // flag) keeps a change typed while a save is in flight unsaved.
  const [edits, setEdits] = React.useState(0);
  const [cleanAt, setCleanAt] = React.useState(0);
  const dirty = edits !== cleanAt;
  const [status, setStatus] = React.useState<Status>("idle");
  const [saveError, setSaveError] = React.useState("");
  // Someone else saved this language's text after it was loaded here: kept
  // until the editor loads their version or a save goes through.
  const [conflict, setConflict] = React.useState(false);
  // Why the page is re-reading the lesson, for what to say once it has.
  const [rereadFor, setRereadFor] = React.useState<"revert" | "reload" | null>(
    null
  );
  // Bumped on save / discard, so the block list drops its "Undo".
  const [resetKey, setResetKey] = React.useState(0);

  function load(from: NarrativeInitial) {
    setTitle(from.title);
    setSubtitle(from.subtitle);
    setBlocks(withKeys(from.blocks));
    setIntro(introOf(from.blocks));
    setBaseline(from);
    setCleanAt(edits);
    setResetKey((k) => k + 1);
  }

  // The page re-read the lesson (after "Remove", or to load a colleague's
  // save): start over from it.
  const [seenRev, setSeenRev] = React.useState(initialRev);
  if (initialRev !== seenRev) {
    setSeenRev(initialRev);
    load(initial);
    setHasOverride(initial.hasOverride);
    setFallbackFrom(initial.fallbackFrom);
    setConflict(false);
    setStatus(rereadFor === "reload" ? "reloaded" : "reverted");
    setRereadFor(null);
  }

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function edited() {
    setEdits((n) => n + 1);
    if (
      status !== "saving" &&
      status !== "reverting" &&
      status !== "reloading"
    ) {
      setStatus("idle");
    }
  }

  async function handleSave() {
    const at = edits;
    const text = reflection
      ? {
          title,
          subtitle: "",
          blocks: [{ kind: "paragraph" as const, text: intro }],
        }
      : { title, subtitle, blocks: blocks.map(stripKey) };
    setStatus("saving");
    try {
      const res = await saveLessonNarrative(
        courseSlug,
        stageKey,
        locale,
        {
          title: text.title,
          subtitle: reflection ? undefined : text.subtitle || undefined,
          blocks: text.blocks,
        },
        baseline.version
      );
      if (res.ok) {
        const saved: NarrativeInitial = {
          ...text,
          hasOverride: true,
          version: res.version,
        };
        setCleanAt(at);
        setBaseline(saved);
        setHasOverride(true);
        setFallbackFrom(undefined);
        setConflict(false);
        setResetKey((k) => k + 1);
        setStatus("saved");
        onSaved?.(saved);
        return;
      }
      if (res.error === "changed-elsewhere") {
        // Nothing was written; the edits stay on screen.
        setConflict(true);
        setStatus("idle");
        return;
      }
      // "forbidden" covers both signed out and not an editor — ask which.
      setSaveError(
        saveFailureMessage({
          kind: "refused",
          access: res.error === "forbidden" ? await fetchStorageStatus() : null,
        })
      );
    } catch (error) {
      setSaveError(saveFailureMessage({ kind: "thrown", error }));
    }
    setStatus("error");
  }

  function handleDiscard() {
    if (!window.confirm("Discard your unsaved changes to this lesson?")) return;
    load(baseline);
    // "Discard changes" goes away with the changes: keep focus in the editor.
    headingRef.current?.focus();
    setStatus("discarded");
  }

  function handleReload() {
    if (
      dirty &&
      !window.confirm(
        `Load the saved ${lang} text of this lesson? Your unsaved edits here will be replaced.`
      )
    ) {
      return;
    }
    headingRef.current?.focus();
    setRereadFor("reload");
    setStatus("reloading");
    onReread(baseline.version);
  }

  // What learners see once this language's text is gone.
  const fallbackText =
    courseKind === "bundled"
      ? "the built-in text"
      : locale !== "en"
        ? "the English text"
        : reflection
          ? "the standard reflection text"
          : "an empty lesson";

  async function handleRevert() {
    if (
      !window.confirm(
        `Discard the ${lang} text of this lesson and go back to ${fallbackText}? This can't be undone.`
      )
    ) {
      return;
    }
    // The buttons are disabled while this runs, and "Remove" then goes away:
    // keep focus in the editor rather than letting it fall to the page.
    headingRef.current?.focus();
    setStatus("reverting");
    try {
      const res = await clearLessonNarrative(
        courseSlug,
        stageKey,
        locale,
        baseline.version
      );
      if (res.ok) {
        setRereadFor("revert");
        onReread(baseline.version);
        return;
      }
      if (res.error === "changed-elsewhere") {
        setConflict(true);
        setStatus("idle");
        return;
      }
      setSaveError(
        saveFailureMessage({
          kind: "refused",
          access: res.error === "forbidden" ? await fetchStorageStatus() : null,
        })
      );
    } catch (error) {
      setSaveError(saveFailureMessage({ kind: "thrown", error }));
    }
    setStatus("error");
  }

  const busy =
    status === "saving" || status === "reverting" || status === "reloading";
  const heading = reflection ? "Reflection text" : "Lesson text";

  const badge = hasOverride ? (
    <Badge variant="accent" className="text-[10px]">
      Customised
    </Badge>
  ) : (
    <Badge variant="muted" className="text-[10px]">
      {courseKind === "bundled"
        ? "Built-in text"
        : fallbackFrom
          ? `Not written in ${lang} yet`
          : reflection
            ? "Standard text"
            : "Not written yet"}
    </Badge>
  );

  const body = (
    <section aria-labelledby={`${ids}-h`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
          <PenSquare className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            id={`${ids}-h`}
            ref={headingRef}
            tabIndex={-1}
            className="font-semibold"
          >
            {heading} ({lang})
          </h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {reflection
              ? "The title and introduction learners read before they reflect."
              : "The title and teaching text learners read in this lesson."}
          </p>
        </div>
        {badge}
      </div>

      {fallbackFrom ? (
        <p className="mb-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Not written in {lang} yet — showing the {LANGUAGE[fallbackFrom]} text,
          which is what learners see. Saving creates the {lang} version.
        </p>
      ) : null}

      <div className={reflection ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
        <div>
          <label
            htmlFor={`${ids}-title`}
            className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
          >
            Lesson title
          </label>
          <input
            id={`${ids}-title`}
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              edited();
            }}
            className={inputCls}
          />
        </div>
        {reflection ? (
          <div>
            <label
              htmlFor={`${ids}-intro`}
              className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
            >
              Introduction
            </label>
            <textarea
              id={`${ids}-intro`}
              value={intro}
              rows={3}
              onChange={(e) => {
                setIntro(e.target.value);
                edited();
              }}
              className={`${inputCls} resize-y`}
            />
          </div>
        ) : (
          <div>
            <label
              htmlFor={`${ids}-subtitle`}
              className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]"
            >
              Lesson subtitle (optional)
            </label>
            <input
              id={`${ids}-subtitle`}
              value={subtitle}
              maxLength={200}
              aria-describedby={`${ids}-subtitle-hint`}
              onChange={(e) => {
                setSubtitle(e.target.value);
                edited();
              }}
              className={inputCls}
            />
            <p
              id={`${ids}-subtitle-hint`}
              className="mt-1 text-xs text-[var(--muted-foreground)]"
            >
              A short line shown in small capitals above the title.
            </p>
          </div>
        )}
      </div>

      {reflection ? (
        prompts.length ? (
          <div className="mt-4">
            <p className="text-sm font-semibold">
              Questions learners answer privately
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              The same for every course, so they can&rsquo;t be changed here.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {prompts.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        ) : null
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">Content blocks</p>
          <BlockList
            blocks={blocks}
            onBlocksChange={(next) => {
              setBlocks(next);
              edited();
            }}
            resetKey={resetKey}
          />
        </div>
      )}

      {conflict ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 p-3 text-sm"
        >
          <p className="flex items-start gap-1.5">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--warning)]"
              aria-hidden
            />
            <span>
              Someone else saved the {lang} text of this lesson since you
              opened it, so nothing was changed. Load their version to see it —
              your edits stay here until you do, so you can copy anything you
              want to keep.
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={handleReload}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Load the saved version
          </Button>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button size="sm" disabled={busy} onClick={handleSave}>
          {status === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Save {lang}
        </Button>
        {dirty ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handleDiscard}
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Discard changes
          </Button>
        ) : null}
        {hasOverride ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={handleRevert}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {courseKind === "bundled"
              ? "Use built-in text"
              : `Remove ${lang} text`}
          </Button>
        ) : null}
        <span role="status" aria-live="polite" className="text-xs">
          {status === "saving" ? (
            <span className="text-[var(--muted-foreground)]">Saving…</span>
          ) : status === "saved" ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Saved
            </span>
          ) : status === "reverting" ? (
            <span className="text-[var(--muted-foreground)]">
              Going back to {fallbackText}…
            </span>
          ) : status === "reverted" ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Back to {fallbackText}.
            </span>
          ) : status === "reloading" ? (
            <span className="text-[var(--muted-foreground)]">
              Loading the saved version…
            </span>
          ) : status === "reloaded" ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Loaded the saved version.
            </span>
          ) : status === "discarded" ? (
            <span className="text-[var(--muted-foreground)]">
              Changes discarded.
            </span>
          ) : status === "error" ? (
            <span className="inline-flex items-start gap-1 text-[var(--danger)]">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                aria-hidden
              />
              {saveError}
            </span>
          ) : dirty ? (
            <span className="text-[var(--muted-foreground)]">
              Unsaved changes
            </span>
          ) : null}
        </span>
      </div>
    </section>
  );

  if (embedded) return body;
  return (
    <Card>
      <CardContent className="p-5">{body}</CardContent>
    </Card>
  );
}
