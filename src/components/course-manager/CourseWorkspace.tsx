"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Pencil } from "lucide-react";
import type {
  CourseCopyState,
  CourseOutline,
  LessonOutline,
} from "@/lib/cms/course-admin-types";
import { isLegacySectionId } from "@/lib/cms/sections/contract";
import type { Locale, StageKey } from "@/lib/cms/types";
import { DirtyProvider, useDirtyRegistry } from "./dirty-registry";
import { CourseHeader, type TimeLabel } from "./CourseHeader";
import { CourseCopyEditor } from "./CourseCopyEditor";
import { LessonNav } from "./LessonNav";
import { LessonSection } from "./LessonSection";
import { LessonListPanel, type RenameRequest } from "./lesson-list/LessonListPanel";
import { usualOrder, type ContentNames } from "./lesson-list/list-model";
import { initWorkspace, lessonContentCallbacks, pair, workspaceReducer } from "./workspace-reducer";

const NO_REASONS = [] as const;

/* -------------------------------- component -------------------------------- */

/**
 * Everything for one course on one page (D33): header with language and
 * publishing, the title and subtitle, then every lesson in learner order —
 * read view by default, the lesson's editors when opened.
 *
 * A course created here has its lesson list beside the lessons (Release 1,
 * lesson-list/LessonListPanel): add, move, rename, hide and delete lessons.
 * A built-in course keeps Release 0's lesson navigation exactly.
 */
export function CourseWorkspace(props: {
  outline: CourseOutline;
  initialLang: Locale;
  /** A lesson id the page checked against the outline (`?lesson=`). */
  initialLesson?: string;
  lastEdited: TimeLabel | null;
  /** Standard and template names in every content language (the server's messages). */
  names: ContentNames;
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
  names,
}: {
  outline: CourseOutline;
  initialLang: Locale;
  initialLesson?: string;
  lastEdited: TimeLabel | null;
  names: ContentNames;
}) {
  const t = useTranslations("courseManager.page");
  const tStage = useTranslations("course.stageLabel");
  const tList = useTranslations("lessonList");
  const router = useRouter();
  const registry = useDirtyRegistry();
  const [, startTransition] = React.useTransition();

  const [lang, setLang] = React.useState<Locale>(initialLang);
  const [copy, setCopy] = React.useState(outline.copy);
  const [state, dispatch] = React.useReducer(workspaceReducer, outline, (o) =>
    initWorkspace(o, initialLesson)
  );
  const { open, status } = state;
  // The lesson list of a course created here (null for a built-in course).
  const sections = outline.kind === "cms" ? state.sections : null;

  // The page's one polite live region (moves, adds, deletes, names). Each
  // message gets a fresh node, so the same words twice are read twice.
  const [announcement, setAnnouncement] = React.useState({ text: "", n: 0 });
  const announce = React.useCallback(
    (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })),
    []
  );
  // The lesson card's Rename opens the name in the lesson list.
  const [renameRequest, setRenameRequest] = React.useState<RenameRequest | null>(null);
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
  // A standard lesson's standard name: in the content language for a
  // created course (as its lesson list names it), in the menu language for a
  // built-in course (as in Release 0).
  const standardName = (key: StageKey) => (sections ? names.standard[lang][key] : tStage(key));
  // The lesson's name in the content language: its own step name when the
  // lesson list has one, else the standard name. A Release 1 lesson always
  // has a section, so the standard names are only asked for standard keys.
  const lessonName = (lesson: LessonOutline) =>
    lesson.section?.name[lang]?.text ??
    (isLegacySectionId(lesson.key) ? standardName(lesson.key) : lesson.key);
  const byKey = new Map(state.lessons.map((l) => [l.key, l]));
  /**
   * A lesson's name by id, also for one that is no longer on the page (a
   * deleted standard lesson, named in the publishing blockers).
   */
  const nameById = (key: string) => {
    const lesson = byKey.get(key);
    if (lesson) return lessonName(lesson);
    return isLegacySectionId(key) ? standardName(key) : key;
  };
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

  /**
   * A structural action's result: the whole outline, built after it
   * committed. The refresh then brings the read views up to date and
   * outruns any refresh still in flight from before it.
   */
  function takeOutline(next: CourseOutline) {
    dispatch({ type: "outlineReplaced", outline: next });
    refresh();
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
        labelsLater={sections?.hasLabels ?? false}
        lessonName={sections ? nameById : undefined}
        usualOrder={
          sections ? usualOrder(sections.resolved.sections.map((s) => s.id)).map(nameById) : undefined
        }
        onLangChange={switchLang}
        onStatusChange={(next) => {
          dispatch({ type: "statusChanged", status: next });
          refresh();
        }}
        onRefresh={refresh}
      />

      <p id="workspace-announcements" role="status" aria-live="polite" className="sr-only">
        <span key={announcement.n}>{announcement.text}</span>
      </p>

      <div
        className={`mt-8 lg:grid lg:gap-8 ${
          sections ? "lg:grid-cols-[18rem_minmax(0,1fr)]" : "lg:grid-cols-[15rem_minmax(0,1fr)]"
        }`}
      >
        {sections ? (
          <LessonListPanel
            slug={outline.slug}
            kind={outline.kind}
            status={status}
            sections={sections}
            lessons={state.lessons}
            enrolled={state.enrolled}
            lang={lang}
            names={names}
            lessonLabel={lessonLabel}
            onAddStage={(key) => openLesson(key, true)}
            onOutline={takeOutline}
            onRenamed={(key, label, version, name) =>
              dispatch({ type: "renamed", key, lang, label, version, name })
            }
            onAdded={(id) => openLesson(id, true)}
            refresh={refresh}
            announce={announce}
            renameRequest={renameRequest}
          />
        ) : (
          <LessonNav
            lessons={state.lessons}
            lang={lang}
            lessonLabel={lessonLabel}
            onAdd={(key) => openLesson(key, true)}
          />
        )}

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
                  headerExtra={
                    sections && lesson.section ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRenameRequest((r) => ({ id: lesson.key, n: (r?.n ?? 0) + 1 }))
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-muted)]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        {tList("rename.action")}
                        <span className="sr-only">
                          : <span lang={lang}>{lessonLabel(lesson.key)}</span>
                        </span>
                      </button>
                    ) : undefined
                  }
                  onOpen={() => openLesson(lesson.key)}
                  onClose={() => closeLesson(lesson.key)}
                  {...lessonContentCallbacks(lesson.key, lang, dispatch, refresh)}
                  onOutline={takeOutline}
                  announce={announce}
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
