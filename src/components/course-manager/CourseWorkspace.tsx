"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type {
  CourseCopyState,
  CourseOutline,
  CourseStatus,
  LessonOutline,
} from "@/lib/cms/course-admin-types";
import { isLegacySectionId } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { DirtyProvider, useDirtyRegistry } from "./dirty-registry";
import { CourseHeader, type TimeLabel } from "./CourseHeader";
import { CourseCopyEditor } from "./CourseCopyEditor";
import { LessonNav } from "./LessonNav";
import { LessonSection } from "./LessonSection";
import { initWorkspace, pair, workspaceReducer } from "./workspace-reducer";

const NO_REASONS = [] as const;

/* -------------------------------- component -------------------------------- */

/**
 * Everything for one course on one page (D33): header with language and
 * publishing, the title and subtitle, then every lesson in learner order —
 * read view by default, the lesson's editors when opened.
 */
export function CourseWorkspace(props: {
  outline: CourseOutline;
  initialLang: Locale;
  /** A lesson id the page checked against the outline (`?lesson=`). */
  initialLesson?: string;
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
  initialLesson?: string;
  lastEdited: TimeLabel | null;
}) {
  const t = useTranslations("courseManager.page");
  const tStage = useTranslations("course.stageLabel");
  const router = useRouter();
  const registry = useDirtyRegistry();
  const [, startTransition] = React.useTransition();

  const [lang, setLang] = React.useState<Locale>(initialLang);
  const [copy, setCopy] = React.useState(outline.copy);
  const [status, setStatus] = React.useState<CourseStatus>(outline.status);
  const [state, dispatch] = React.useReducer(workspaceReducer, outline, (o) =>
    initWorkspace(o, initialLesson)
  );
  const { open } = state;
  // A refreshed outline arrived (router.refresh after a save): take it in.
  // The reducer takes each server-rendered outline once (workspace-reducer.ts).
  if (outline !== state.seen) dispatch({ type: "outline", outline });

  // Scroll to a lesson and put focus on its heading (deep link, "Add …").
  const [focusLesson, setFocusLesson] = React.useState<{
    key: string;
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

  // Numbers follow what learners see: "Add …" slots aren't numbered. A
  // lesson in a created course's lesson list carries its own number.
  const numbers = new Map<string, number | null>();
  state.lessons
    .filter((l) => l.present)
    .forEach((l, i) => numbers.set(l.key, i + 1));
  for (const l of state.lessons) {
    if (l.section) numbers.set(l.key, l.section.number);
  }
  // The lesson's name in the content language: its own step name when the
  // lesson list has one, else the standard name. A Release 1 lesson always
  // has a section, so the standard names are only asked for standard keys.
  const lessonName = (lesson: LessonOutline) =>
    lesson.section?.name[lang]?.text ??
    (isLegacySectionId(lesson.key) ? tStage(lesson.key) : lesson.key);
  const byKey = new Map(state.lessons.map((l) => [l.key, l]));
  const lessonLabel = (key: string) => {
    const lesson = byKey.get(key);
    const name = lesson ? lessonName(lesson) : key;
    const n = numbers.get(key);
    return n ? `${n}. ${name}` : name;
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

  function openLesson(key: string, focus = false) {
    dispatch({ type: "opened", key });
    if (focus) setFocusLesson((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  }

  function closeLesson(key: string) {
    const unsaved = registry.dirtyLabels({ idPrefix: `lesson:${key}:` });
    if (
      unsaved.length &&
      !window.confirm(t("unsavedClose", { list: unsaved.join(", ") }))
    ) {
      return;
    }
    dispatch({ type: "closed", key });
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
        enrolled={state.enrolled}
        readiness={state.readiness}
        languages={state.languages}
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
                  enrolled={state.enrolled}
                  reasons={state.sections?.reasons ?? NO_REASONS}
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
                  onOutline={(next) => {
                    dispatch({ type: "outlineReplaced", outline: next });
                    // The result is the server's state right after the
                    // action; a refresh then brings the read views up to
                    // date and outruns any refresh still in flight from
                    // before it.
                    refresh();
                  }}
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
