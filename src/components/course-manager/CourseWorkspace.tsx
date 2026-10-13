"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  CONTENT_LOCALES,
  type CourseCopyState,
  type CourseOutline,
  type CourseStatus,
  type LessonOutline,
  type NarrativeInitial,
} from "@/lib/cms/course-admin-types";
import type {
  LessonDocumentRef,
  Locale,
  StageKey,
  VideoContent,
} from "@/lib/cms/types";
import type { StoredStructure } from "@/lib/cms/structure";
import { DirtyProvider, useDirtyRegistry } from "./dirty-registry";
import { CourseHeader, type TimeLabel } from "./CourseHeader";
import { CourseCopyEditor } from "./CourseCopyEditor";
import { LessonNav } from "./LessonNav";
import { LessonSection } from "./LessonSection";

/* ---------------------------------- state ---------------------------------- */

interface State {
  /**
   * The lessons as the editors know them. Seeded once from the outline and
   * then changed by the editors' own save callbacks — so a page refresh that
   * raced a save can never put the old content back into an editor.
   */
  lessons: LessonOutline[];
  /** Per "lesson:language": bumped when its text was re-read (see "reread"). */
  revs: Record<string, number>;
  /**
   * "lesson:language" pairs waiting for a re-read, each with the version of
   * the text it's moving away from (null = none was stored).
   */
  pending: Record<string, string | null>;
  /** The outline last taken in (see "outline"). */
  seen: CourseOutline;
}

type Action =
  | { type: "outline"; outline: CourseOutline }
  | {
      type: "narrativeSaved";
      key: StageKey;
      lang: Locale;
      value: NarrativeInitial;
    }
  | { type: "reread"; key: StageKey; lang: Locale; stale: string | null }
  | { type: "structureSaved"; key: StageKey; structure: StoredStructure }
  | { type: "draftChanged"; key: StageKey; draft: StoredStructure | null }
  | { type: "structureCleared"; key: StageKey }
  | { type: "videoSaved"; key: StageKey; video: VideoContent | null }
  | { type: "documentsChanged"; key: StageKey; documents: LessonDocumentRef[] };

const pair = (key: StageKey, lang: Locale) => `${key}:${lang}`;

function patchLesson(
  state: State,
  key: StageKey,
  patch: (l: LessonOutline) => LessonOutline
): State {
  return {
    ...state,
    lessons: state.lessons.map((l) => (l.key === key ? patch(l) : l)),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "outline":
      return takeRefreshedOutline(state, action.outline);
    case "narrativeSaved":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        byLang: {
          ...l.byLang,
          [action.lang]: { ...l.byLang[action.lang], narrative: action.value },
        },
      }));
    case "reread":
      // The text was removed, or a colleague saved a newer one: take the
      // next outline whose text differs from the editor's (`stale`).
      return {
        ...state,
        pending: {
          ...state.pending,
          [pair(action.key, action.lang)]: action.stale,
        },
      };
    case "structureSaved":
      // A new interactive lesson now exists for learners — and can take a
      // video and documents like any other. The save cleared any draft.
      return patchLesson(state, action.key, (l) => ({
        ...l,
        structure: action.structure,
        draft: null,
        present: true,
        addable: false,
        editable: { ...l.editable, media: true },
      }));
    case "draftChanged":
      // Learners see no change: only the lesson's "Draft" mark.
      return patchLesson(state, action.key, (l) => ({
        ...l,
        draft: action.draft,
      }));
    case "structureCleared":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        structure: null,
        draft: null,
        present: false,
        addable: true,
        editable: { ...l.editable, media: false },
      }));
    case "videoSaved":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        video: action.video,
      }));
    case "documentsChanged":
      return patchLesson(state, action.key, (l) => ({
        ...l,
        documents: action.documents,
      }));
  }
}

/**
 * A fresh outline after router.refresh(): take what learners see now (for
 * the read views), and fresh start points for texts nobody wrote in that
 * language yet (a fallback may have changed). A text an editor saved is kept
 * — unless it is waiting for a re-read, which is what the refresh was for.
 */
function takeRefreshedOutline(state: State, outline: CourseOutline): State {
  if (outline === state.seen) return state;
  const fresh = new Map(outline.lessons.map((l) => [l.key, l]));
  const revs = { ...state.revs };
  const pending: State["pending"] = {};

  const lessons = state.lessons.map((lesson) => {
    const f = fresh.get(lesson.key);
    if (!f) return lesson;
    const byLang = { ...lesson.byLang };
    for (const lang of CONTENT_LOCALES) {
      const id = pair(lesson.key, lang);
      const mine = lesson.byLang[lang].narrative;
      const theirs = f.byLang[lang].narrative;
      let narrative = mine;
      if (id in state.pending) {
        // Wait for an outline without the text this page had (a refresh
        // started before the revert or the colleague's save may still
        // arrive first).
        const stale = state.pending[id];
        if (theirs && theirs.version !== stale) {
          narrative = theirs;
          revs[id] = (revs[id] ?? 0) + 1;
        } else {
          pending[id] = stale;
        }
      } else if (mine && !mine.hasOverride && theirs) {
        narrative = theirs;
      }
      byLang[lang] = { stage: f.byLang[lang].stage, narrative };
    }
    return { ...lesson, byLang, updatedAt: f.updatedAt };
  });

  return { lessons, revs, pending, seen: outline };
}

/* -------------------------------- component -------------------------------- */

/**
 * Everything for one course on one page (D33): header with language and
 * publishing, the title and subtitle, then every lesson in learner order —
 * read view by default, the lesson's editors when opened.
 */
export function CourseWorkspace(props: {
  outline: CourseOutline;
  initialLang: Locale;
  initialLesson?: StageKey;
  lastEdited: TimeLabel | null;
}) {
  return (
    <DirtyProvider>
      <Workspace {...props} />
    </DirtyProvider>
  );
}

function Workspace({
  outline,
  initialLang,
  initialLesson,
  lastEdited,
}: {
  outline: CourseOutline;
  initialLang: Locale;
  initialLesson?: StageKey;
  lastEdited: TimeLabel | null;
}) {
  const t = useTranslations("courseManager.page");
  const tStage = useTranslations("course.stageLabel");
  const router = useRouter();
  const registry = useDirtyRegistry();
  const [, startTransition] = React.useTransition();

  const [lang, setLang] = React.useState<Locale>(initialLang);
  const [open, setOpen] = React.useState<ReadonlySet<StageKey>>(
    () => new Set(initialLesson ? [initialLesson] : [])
  );
  const [copy, setCopy] = React.useState(outline.copy);
  const [status, setStatus] = React.useState<CourseStatus>(outline.status);
  const [state, dispatch] = React.useReducer(reducer, outline, (o): State => ({
    lessons: o.lessons,
    revs: {},
    pending: {},
    seen: o,
  }));
  // A refreshed outline arrived (router.refresh after a save): take it in.
  if (outline !== state.seen) dispatch({ type: "outline", outline });

  // Scroll to a lesson and put focus on its heading (deep link, "Add …").
  const [focusLesson, setFocusLesson] = React.useState<{
    key: StageKey;
    n: number;
  } | null>(initialLesson ? { key: initialLesson, n: 0 } : null);
  React.useEffect(() => {
    if (!focusLesson) return;
    const { key } = focusLesson;
    // The section carries the scroll margin that clears the sticky header.
    document
      .getElementById(`lesson-${key}`)
      ?.scrollIntoView({ block: "start" });
    document.getElementById(`lesson-${key}-h`)?.focus({ preventScroll: true });
  }, [focusLesson]);

  // Numbers follow what learners see: "Add …" slots aren't numbered.
  const numbers = new Map<StageKey, number>();
  state.lessons
    .filter((l) => l.present)
    .forEach((l, i) => numbers.set(l.key, i + 1));
  const lessonLabel = (key: StageKey) => {
    const n = numbers.get(key);
    return n ? `${n}. ${tStage(key)}` : tStage(key);
  };

  /** Re-read the page from the server — read views, warnings, coverage. */
  const refresh = React.useCallback(
    () => startTransition(() => router.refresh()),
    [router]
  );

  function switchLang(next: Locale) {
    if (next === lang) return;
    // Title and lesson texts are per language, so a switch discards their
    // unsaved edits. (Interactive stages keep every language in one draft.)
    const unsaved = registry.dirtyLabels({ langBound: true });
    if (
      unsaved.length &&
      !window.confirm(t("unsavedSwitch", { list: unsaved.join(", ") }))
    ) {
      return;
    }
    setLang(next);
    // Keep the address shareable without another server round trip.
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url);
  }

  function openLesson(key: StageKey, focus = false) {
    setOpen((s) => new Set(s).add(key));
    if (focus) setFocusLesson((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  }

  function closeLesson(key: StageKey) {
    const unsaved = registry.dirtyLabels({ idPrefix: `lesson:${key}:` });
    if (
      unsaved.length &&
      !window.confirm(t("unsavedClose", { list: unsaved.join(", ") }))
    ) {
      return;
    }
    setOpen((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  function onCopySaved(forLang: Locale, next: CourseCopyState) {
    setCopy((c) => ({ ...c, [forLang]: next }));
    refresh();
  }

  // The first open lesson learners can see, for "Preview as learner".
  const previewLesson = state.lessons.find(
    (l) => l.present && open.has(l.key)
  )?.key;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <CourseHeader
        slug={outline.slug}
        kind={outline.kind}
        title={copy[lang].title}
        lastEdited={lastEdited}
        status={status}
        enrolled={outline.enrolled}
        readiness={outline.readiness}
        languages={outline.languages}
        lang={lang}
        previewLesson={previewLesson}
        onLangChange={switchLang}
        onStatusChange={(next) => {
          setStatus(next);
          refresh();
        }}
      />

      <div className="mt-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <LessonNav
          lessons={state.lessons}
          lang={lang}
          lessonLabel={lessonLabel}
          onAdd={(key) => openLesson(key, true)}
        />

        <div className="min-w-0">
          <CourseCopyEditor
            key={lang}
            slug={outline.slug}
            kind={outline.kind}
            lang={lang}
            copy={copy[lang]}
            onSaved={(next) => onCopySaved(lang, next)}
          />

          <ol className="mt-6 space-y-4">
            {state.lessons.map((lesson) => (
              <li key={lesson.key}>
                <LessonSection
                  lesson={lesson}
                  label={lessonLabel(lesson.key)}
                  slug={outline.slug}
                  kind={outline.kind}
                  status={status}
                  lang={lang}
                  open={open.has(lesson.key)}
                  rev={state.revs[pair(lesson.key, lang)] ?? 0}
                  onOpen={() => openLesson(lesson.key)}
                  onClose={() => closeLesson(lesson.key)}
                  onNarrativeSaved={(value) => {
                    dispatch({
                      type: "narrativeSaved",
                      key: lesson.key,
                      lang,
                      value,
                    });
                    refresh();
                  }}
                  onReread={(stale) => {
                    dispatch({ type: "reread", key: lesson.key, lang, stale });
                    refresh();
                  }}
                  onStructureSaved={(structure) => {
                    dispatch({
                      type: "structureSaved",
                      key: lesson.key,
                      structure,
                    });
                    refresh();
                  }}
                  onStructureDraftChanged={(draft) => {
                    dispatch({ type: "draftChanged", key: lesson.key, draft });
                    // The publishing warnings list lessons with a draft.
                    refresh();
                  }}
                  onStructureCleared={() => {
                    dispatch({ type: "structureCleared", key: lesson.key });
                    refresh();
                  }}
                  onVideoSaved={(video) => {
                    dispatch({ type: "videoSaved", key: lesson.key, video });
                    refresh();
                  }}
                  onDocumentsChanged={(documents) =>
                    dispatch({
                      type: "documentsChanged",
                      key: lesson.key,
                      documents,
                    })
                  }
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
