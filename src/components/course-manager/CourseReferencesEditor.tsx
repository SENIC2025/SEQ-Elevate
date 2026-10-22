"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LazyRichTextEditor } from "@/components/rich-text/LazyRichTextEditor";
import {
  loadCourseReferencesForEditor,
  saveCourseReferences,
} from "@/app/actions/course-references";
import type {
  CourseReferencesForEditor,
  SaveCourseReferencesResult,
} from "@/app/actions/course-references";
import { hasText } from "@/lib/cms/text-fallback";
import type { Locale } from "@/lib/cms/types";
import { markContentLang } from "./blocks/content-lang";
import { useDirty } from "./dirty-registry";

/* ---------------------------------------------------------------- state --- */

/** One language's list as stored, with the base its next save sends (null: none stored). */
export interface StoredReferences {
  text: string;
  rich?: unknown;
  base: string | null;
}

/** Nothing stored in this language. */
const NONE: StoredReferences = { text: "", base: null };

export type ReferencesStatus =
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "discarded"
  | "reloading"
  | "reloaded";

/** Why the last save or load didn't go through, as the screen says it. */
export type ReferencesProblem = "invalid" | "forbidden" | "not-found" | "generic" | "load";

export interface ReferencesEditorState {
  /** What is stored for this language: null until it has loaded. */
  stored: StoredReferences | null;
  /** The list couldn't be read (shown with "Try again"). */
  loadFailed: boolean;
  /** Bumped to open the text editor afresh on `stored` (it keeps its own state once open). */
  rev: number;
  /** The text as edited since `stored` was opened; null until then. */
  draft: { rich: unknown; text: string } | null;
  /** Edits made, and how many of them are saved (or discarded): unsaved = edits !== cleanAt. */
  edits: number;
  cleanAt: number;
  status: ReferencesStatus;
  problem: ReferencesProblem | null;
  /** Why the server refused the last save, one sentence per problem (D36). */
  issues: string[];
  /** Someone else saved this language's list since it was opened (D39). */
  conflict: boolean;
}

export const INITIAL_REFERENCES_STATE: ReferencesEditorState = {
  stored: null,
  loadFailed: false,
  rev: 0,
  draft: null,
  edits: 0,
  cleanAt: 0,
  status: "idle",
  problem: null,
  issues: [],
  conflict: false,
};

export type ReferencesEvent =
  /** The stored list arrived: on opening, or to load a colleague's save ("Load their version"). */
  | { type: "loaded"; stored: StoredReferences; reload: boolean }
  | { type: "loading" }
  | { type: "loadFailed" }
  | { type: "reloading" }
  | { type: "edited"; rich: unknown; text: string }
  | { type: "saving" }
  /** A save's answer; `at` = the edits it carried (what was typed meanwhile stays unsaved). */
  | { type: "answered"; at: number; result: SaveCourseReferencesResult }
  | { type: "failed" }
  | { type: "discarded" };

/** Is there anything typed that isn't saved? */
export const isDirty = (s: ReferencesEditorState) => s.edits !== s.cleanAt;

/** The language's stored list, from what loadCourseReferencesForEditor answered. */
export function storedFor(loaded: CourseReferencesForEditor, lang: Locale): StoredReferences {
  const entry = loaded.locales[lang];
  return entry ? { text: entry.text, rich: entry.rich, base: entry.base } : NONE;
}

/** The references editor's state, step by step (pure, so it is tested without a browser). */
export function referencesReducer(s: ReferencesEditorState, e: ReferencesEvent): ReferencesEditorState {
  switch (e.type) {
    case "loading":
      return { ...s, loadFailed: false, status: "idle" };
    case "loaded":
      // Opened afresh on what is stored: nothing typed is kept.
      return {
        ...s,
        stored: e.stored,
        loadFailed: false,
        rev: s.rev + 1,
        draft: null,
        cleanAt: s.edits,
        issues: [],
        problem: null,
        conflict: false,
        status: e.reload ? "reloaded" : "idle",
      };
    case "loadFailed":
      // A failed reload keeps what is on screen, and says so.
      return s.stored ? { ...s, status: "error", problem: "load" } : { ...s, loadFailed: true };
    case "reloading":
      return { ...s, status: "reloading", problem: null };
    case "edited":
      return {
        ...s,
        draft: { rich: e.rich, text: e.text },
        edits: s.edits + 1,
        status: s.status === "saving" || s.status === "reloading" ? s.status : "idle",
        problem: s.status === "saving" || s.status === "reloading" ? s.problem : null,
      };
    case "saving":
      return { ...s, status: "saving", issues: [], problem: null };
    case "answered": {
      const r = e.result;
      if (r.ok) {
        return {
          ...s,
          stored: r.saved ? { text: r.saved.text, rich: r.saved.rich, base: r.base } : NONE,
          cleanAt: e.at,
          conflict: false,
          issues: [],
          status: "saved",
        };
      }
      // Nothing was written in any of these; the edits stay on screen.
      if (r.error === "changed-elsewhere") return { ...s, conflict: true, status: "idle" };
      if (r.error === "invalid") return { ...s, issues: r.issues, status: "error", problem: "invalid" };
      return {
        ...s,
        status: "error",
        problem: r.error === "forbidden" ? "forbidden" : r.error === "not-found" ? "not-found" : "generic",
      };
    }
    case "failed":
      return { ...s, status: "error", problem: "generic" };
    case "discarded":
      return { ...s, rev: s.rev + 1, draft: null, cleanAt: s.edits, issues: [], problem: null, status: "discarded" };
  }
}

/**
 * Marks the text box under `root` with the language being written (WCAG
 * 3.1.2), now and whenever the editor draws it anew (it loads lazily, and
 * opens afresh after a save is discarded or reloaded). Returns the stop.
 */
export function watchContentLang(root: HTMLElement, lang: string): () => void {
  markContentLang(root, lang);
  const watch = new MutationObserver(() => markContentLang(root, lang));
  watch.observe(root, { childList: true, subtree: true });
  return () => watch.disconnect();
}

/* ------------------------------------------------------------ component --- */

/**
 * A created course's references and bibliography in the content language
 * the course page shows (D109, spec 5.5): one list per language, one entry
 * per paragraph, in APA 7, written in the lesson-text editor (italics for
 * titles; links as the editor allows them). It goes live when saved.
 *
 * - Loads its own data (loadCourseReferencesForEditor), so the course
 *   page's outline doesn't carry the list. The page keys it by language.
 * - Reports unsaved changes to the page's registry, bound to the language:
 *   switching the content language, closing or leaving the page asks first.
 * - Each save sends back what it started from (D39): if a colleague saved
 *   this language meanwhile, nothing is written and the editor offers to
 *   load their version; refusals (D36) are listed under the box.
 * - Its text box carries the language being written; the controls around
 *   it keep the page's. The box is styled as learners see the list
 *   (.seq-references, the editor's "references" variant).
 *
 * Outside the course copy editor's form: Enter in the list never submits it.
 */
export function CourseReferencesEditor({ slug, lang }: { slug: string; lang: Locale }) {
  const t = useTranslations("courseReading.references");
  const tText = useTranslations("lessonBlocks.textEditor");
  const tLanguage = useTranslations("courseManager.languageName");
  const tPage = useTranslations("courseManager.page");
  const tSystem = useTranslations("system");
  const ids = React.useId();
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [state, dispatch] = React.useReducer(referencesReducer, INITIAL_REFERENCES_STATE);
  const dirty = isDirty(state);

  const reportDirty = useDirty("references", t("heading"), true);
  React.useEffect(() => reportDirty(dirty), [dirty, reportDirty]);

  // A load still on its way when the page moves on is ignored.
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = React.useCallback(
    async (reload: boolean) => {
      dispatch(reload ? { type: "reloading" } : { type: "loading" });
      try {
        const loaded = await loadCourseReferencesForEditor(slug);
        if (!live.current) return;
        dispatch(loaded ? { type: "loaded", stored: storedFor(loaded, lang), reload } : { type: "loadFailed" });
      } catch {
        if (live.current) dispatch({ type: "loadFailed" });
      }
    },
    [slug, lang]
  );

  React.useEffect(() => {
    void load(false);
  }, [load]);

  React.useEffect(() => {
    const root = boxRef.current;
    return root ? watchContentLang(root, lang) : undefined;
  }, [lang]);

  const busy = state.status === "saving" || state.status === "reloading";
  const language = tLanguage(lang);

  async function save() {
    if (!state.stored || !state.draft || busy || !dirty) return;
    const at = state.edits;
    dispatch({ type: "saving" });
    try {
      const result = await saveCourseReferences(slug, lang, { rich: state.draft.rich }, state.stored.base);
      dispatch({ type: "answered", at, result });
    } catch {
      dispatch({ type: "failed" });
    }
  }

  function discard() {
    if (!window.confirm(tText("discardConfirm"))) return;
    dispatch({ type: "discarded" });
  }

  function reload() {
    if (dirty && !window.confirm(tText("reloadConfirm", { language }))) return;
    void load(true);
  }

  const problemText =
    state.problem === "invalid"
      ? tText("invalid")
      : state.problem === "forbidden"
        ? tPage("errors.forbidden")
        : state.problem === "not-found"
          ? tPage("errors.unknownCourse")
          : state.problem === "generic"
            ? tPage("errors.generic")
            : state.problem === "load"
              ? tSystem("errorBody")
              : "";

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${ids}-h`} className="text-base font-semibold">
          {t("heading")}
        </h2>
        <Badge variant="muted" className="text-[10px]">
          {language}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("hint")}</p>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("languageNote")}</p>
      {state.stored && !hasText(state.stored.text) ? (
        <p className="mt-2 text-sm font-medium">{t("empty")}</p>
      ) : null}

      <div ref={boxRef} className="mt-3">
        {state.stored ? (
          <LazyRichTextEditor
            key={state.rev}
            rich={state.stored.rich}
            text={state.stored.text}
            variant="references"
            labelledBy={`${ids}-h`}
            onChange={(rich, text) => dispatch({ type: "edited", rich, text })}
          />
        ) : state.loadFailed ? (
          <div role="alert" className="rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 px-3 py-2 text-sm">
            <p>{tSystem("errorBody")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void load(false)}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {tSystem("tryAgain")}
            </Button>
          </div>
        ) : (
          <p
            aria-busy="true"
            className="min-h-[8.5rem] animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
          >
            {tSystem("loading")}
          </p>
        )}
      </div>

      {state.issues.length ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-3 text-sm"
        >
          <p className="flex items-center gap-1.5 font-medium text-[var(--danger)]">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
            {tText("issuesTitle")}
          </p>
          <ul className="mt-1 ml-6 list-disc">
            {state.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.conflict ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 p-3 text-sm"
        >
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--warning)]" aria-hidden />
            <span>{t("changedElsewhere")}</span>
          </p>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={reload}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t("reload")}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button size="sm" disabled={busy || !state.stored || !dirty} onClick={() => void save()}>
          {state.status === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {t("save")}
        </Button>
        {dirty ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={discard}>
            <Undo2 className="h-4 w-4" aria-hidden />
            {t("discard")}
          </Button>
        ) : null}
        <span role="status" aria-live="polite" className="text-xs">
          {state.status === "saving" ? (
            <span className="text-[var(--muted-foreground)]">{tText("saving")}</span>
          ) : state.status === "saved" ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {t("saved")}
            </span>
          ) : state.status === "reloading" ? (
            <span className="text-[var(--muted-foreground)]">{tText("reloading")}</span>
          ) : state.status === "reloaded" ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {tText("reloaded")}
            </span>
          ) : state.status === "discarded" ? (
            <span className="text-[var(--muted-foreground)]">{tText("discarded")}</span>
          ) : state.status === "error" ? (
            <span className="inline-flex items-start gap-1 text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {problemText}
            </span>
          ) : dirty ? (
            <span className="text-[var(--muted-foreground)]">{tText("unsaved")}</span>
          ) : null}
        </span>
      </div>
    </section>
  );
}
