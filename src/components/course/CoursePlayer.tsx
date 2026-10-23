"use client";

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Link } from "@/i18n/navigation";
import { recordVideoCueAnswer } from "@/app/actions/video";
import { recordCourseOpened } from "@/app/actions/telemetry";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDemoState } from "@/store/demo-state";
import type { LearnerCourse, LearnerLesson } from "@/lib/cms/learner-course";
import { frontierOf, isReachable } from "@/lib/cms/sections/learner-nav";
import type { SectionId } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";
import { StageBreadcrumb } from "./StageBreadcrumb";
import { NarrativeStage } from "./NarrativeStage";
import { SimulationStage } from "./SimulationStage";
import { ScenarioStage } from "./ScenarioStage";
import { ReflectionStage } from "./ReflectionStage";
import { AssessmentStage } from "./AssessmentStage";
import { CompletionStage } from "./CompletionStage";
import { InteractiveVideoPlayer } from "./InteractiveVideoPlayer";
import { LessonDocuments } from "./LessonDocuments";
import { LessonFurtherReading } from "./LessonFurtherReading";
import { SectionView } from "./sectioned/SectionView";
import { completionCourse } from "./sectioned/completion-course";
import { PlayerAnnouncer, useAnnounce } from "./PlayerAnnouncer";
import { StaleBuildBanner } from "./StaleBuildBanner";
import { LessonNote } from "./lesson-note";
import { afterContinue, backFrom, type Position } from "./player-nav";
import { initialPosition, useResume } from "./useResume";
import { useStageTimer } from "./useStageTimer";
import { openStepAtTop } from "./step-focus";
import { ContentLangContext } from "./CourseText";
import { nameInSentence, sentenceStart } from "@/lib/cms/language-name";
import { ChevronLeft, Languages, Pencil } from "lucide-react";

export interface CoursePlayerProps {
  course: LearnerCourse;
  /** Editor previewing an unpublished course — learners never see this. */
  draftPreview?: boolean;
  /** Editor's sandboxed preview: nothing is saved, every step is reachable. */
  preview?: boolean;
  /** The viewer may edit content (checked on the server): "Edit this lesson". */
  canEdit?: boolean;
  /** Preview only: the lesson to open first. Ignored if the course lacks it. */
  initialLesson?: SectionId;
  /**
   * Preview opened from the course page: the editor's own menu language.
   * The links back to editing use it, and "Back to editing" closes this tab
   * to return to the course page it came from, when the browser allows.
   */
  editLocale?: Locale;
  /**
   * A signed-in learner's position, worked out on the server from their
   * enrolment (spec 5.5): where they open, with no flash of lesson 1.
   */
  serverResume?: SectionId | "complete" | null;
  /**
   * An editor's preview in a language learners don't get yet (D90): the
   * preview shows it, and says learners get English until it is switched on.
   */
  languageNotLive?: Locale;
}

/**
 * The one course player, for every course (D63). Renders the lessons
 * learners get (LearnerCourse, the course's lesson plan): in their order,
 * under their step names (D58), hidden lessons and lessons with nothing to
 * show left out. Each lesson is drawn one of two ways (spec 5.3): a
 * standard lesson with only its main content by its Release 0 stage
 * screen; a lesson of the course's own, or one with extra content, by the
 * sectioned view. Built-in courses only ever have stage lessons. Content
 * comes from props (CMS); only the chrome is i18n.
 *
 * In order, can go back (Q4): the step bar reaches up to the first lesson
 * not done; Back always works; the last Continue goes to any lesson still
 * to do, and says so — on the screen and in the live region — before the
 * completion. A course with no lessons says so and never completes (no
 * badge for nothing).
 *
 * Resume (useResume): a signed-in learner opens where the server says,
 * then the player checks once more when their progress has loaded, never
 * moving a learner who has started. A lesson not done placed before done
 * ones (added, shown again or moved there mid-course) says it is still to
 * do (LessonNote).
 *
 * A step name written in another language than the page's (a lesson of
 * the course's own named only in English, on a Greek page) is marked with
 * its lang wherever it shows: the step bar, Back, the counter and the
 * still-to-do note (WCAG 3.1.2).
 *
 * In an editor's preview (`preview`) nothing is recorded: the page wraps the
 * player in PreviewStateProvider, so progress stays in memory, and the
 * telemetry below is switched off. Preview may start at any lesson
 * (`initialLesson`) and lets the editor jump to any step.
 *
 * Release 3 (D90, spec 9.3): a course shown in English under another menu
 * language (its language isn't switched on yet) says so above the step
 * bar, and its text is marked with its language element by element
 * (ContentLangContext, CourseText): the lesson area as a whole isn't,
 * since its parts hold the page's own words too. "Edit this lesson" opens
 * the page's language, the one asked for.
 */
export function CoursePlayer(props: CoursePlayerProps) {
  return (
    <PlayerAnnouncer>
      <Player {...props} />
    </PlayerAnnouncer>
  );
}

function Player({
  course,
  draftPreview = false,
  preview = false,
  canEdit = false,
  initialLesson,
  editLocale,
  serverResume,
  languageNotLive,
}: CoursePlayerProps) {
  const tPlayer = useTranslations("coursePlayer");
  const tHint = useTranslations("continueHint");
  const tCourses = useTranslations("courseManager");
  const announce = useAnnounce();
  // The language asked for (the page's); the course's own when it isn't
  // switched on for it: then its text carries its language.
  const asked = useLocale() as Locale;
  const contentLang = course.locale && course.locale !== asked ? course.locale : undefined;

  const lessons = course.lessons;
  const ids = useMemo(() => lessons.map((l) => l.id), [lessons]);
  const byId = useMemo(() => new Map<string, LearnerLesson>(lessons.map((l) => [l.id, l])), [lessons]);
  const labelOf = useCallback((id: string) => byId.get(id)?.label ?? "", [byId]);
  // A step name in another language than the course's (PlanLesson.lang),
  // else the course's own when that isn't the page's.
  const langOf = useCallback((id: string) => byId.get(id)?.lang ?? contentLang, [byId, contentLang]);
  /** A lesson's step name, marked with its language when it isn't the page's. */
  const nameOf = (id: string): ReactNode => {
    const lang = langOf(id);
    return lang ? <span lang={lang}>{labelOf(id)}</span> : labelOf(id);
  };

  const { state, dispatch } = useDemoState();
  const { status } = useSession();
  const [current, setCurrent] = useState<Position>(() =>
    initialPosition(ids, { preview, initialLesson, serverResume })
  );
  // The lesson the last Continue went back to, still to do: said above it
  // while the learner is there.
  const [stillToDo, setStillToDo] = useState<SectionId | null>(null);

  // What the learner has done in this course: the store's, only while it
  // holds this course (just opened after another course, it still holds
  // that one's) — and, until the learner's saved progress has loaded into
  // it, what the server said: every lesson before the one they open at is
  // done (nextLesson), so the step bar and the last Continue never act as
  // if it weren't. Progress only grows, so the two are a union.
  const ours = state.course.courseSlug === course.slug;
  const { stagesCompleted, sectionsCompleted } = state.course;
  const done = useMemo(() => {
    const at = serverResume && serverResume !== "complete" ? ids.indexOf(serverResume) : -1;
    const fromServer = serverResume === "complete" ? ids : at > 0 ? ids.slice(0, at) : [];
    return new Set<string>([...fromServer, ...(ours ? [...stagesCompleted, ...sectionsCompleted] : [])]);
  }, [ids, serverResume, ours, stagesCompleted, sectionsCompleted]);
  const completedAt = ours ? state.course.completedAt : null;
  const completed = !!completedAt || serverResume === "complete";
  const frontier = frontierOf(ids, done, completed);

  const indexOf = (id: Position) => (id === "complete" || id === "empty" ? -1 : ids.indexOf(id));
  const total = ids.length;

  const { interacted } = useResume({
    slug: course.slug,
    progress: { ids, done, completedAt },
    current,
    setCurrent,
    preview,
    initialLesson,
    onMoved: (to) => {
      if (to === "complete" || to === "empty") return;
      announce(tPlayer("resumed", { current: ids.indexOf(to) + 1, total, name: labelOf(to) }));
    },
  });

  // Telemetry is for signed-in learners whose own data has loaded, never
  // for an editor's preview. Before the profile step nothing of a person's
  // is saved (D79), so it never loads for them: with the profile gate off
  // they play, and nothing of what they do is recorded.
  const { accountLoaded } = useDemoState();
  const track = status === "authenticated" && !preview && accountLoaded;

  // In-video answers of signed-in learners (an engagement signal for
  // facilitators), with the lesson they belong to. Guests keep theirs in
  // the browser only.
  const onCueAnswered = useCallback(
    (cue: { cueId: string; correct: boolean; lessonId: SectionId }) => {
      if (!track) return;
      void recordVideoCueAnswer({ courseSlug: course.slug, ...cue });
    },
    [track, course.slug]
  );

  const isLesson = current !== "complete" && current !== "empty";
  // Track active time on each lesson for the facilitator analytics (authed only).
  useStageTimer(course.slug, current, track && isLesson);

  // Record the course open once per mount (for "when they open" analytics).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!track || openedRef.current) return;
    openedRef.current = true;
    void recordCourseOpened(course.slug);
  }, [track, course.slug]);

  // When the lesson changes (Continue, Back, the step bar, resume), the new
  // one opens at its top, and focus moves to it so screen-reader users hear
  // the new content (WCAG 2.4.3 Focus Order) — without the focus scrolling
  // the page, which would cut the scroll short (see step-focus.ts).
  const stageRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    openStepAtTop(stageRef.current, window);
  }, [current]);

  // Record which course is being played, so Comp Card / facilitator views
  // can show the course title + evidence without re-resolving content —
  // and so every step the learner takes here is recorded against it. At
  // once, as the player mounts: a layout effect's update is applied before
  // the first click, at the clicks' own priority. From a passive effect,
  // on a fresh page load, it has been seen waiting until the page's first
  // server action (the telemetry below) had finished — the whole walk long
  // on a slow server — while the clicks went into a store holding no
  // course: the completion screen then had no course to complete, and a
  // guest's course migrated on sign-in took the lessons over.
  // With the language the course's text is in (D90, spec 9.3: English on
  // a German or Greek page until that language is switched on), so the
  // Comp Card marks the title and the choices made here with it.
  useLayoutEffect(() => {
    dispatch({
      type: "setCourseContext",
      slug: course.slug,
      title: course.title,
      locale: course.locale,
    });
  }, [dispatch, course.slug, course.title, course.locale]);

  const goNext = useCallback(() => {
    if (current === "complete" || current === "empty") return;
    dispatch({ type: "completeLesson", id: current });
    const next = afterContinue(ids, done, current, completed);
    if (next.stillToDo) {
      announce(tHint.markup("stillToDo", { name: labelOf(next.stillToDo), lesson: (chunks) => chunks }));
    }
    setStillToDo(next.stillToDo ?? null);
    setCurrent(next.to);
  }, [current, dispatch, ids, done, completed, announce, tHint, labelOf]);

  const goBack = useCallback(() => {
    const to = backFrom(ids, current);
    if (!to) return;
    setStillToDo(null);
    setCurrent(to);
  }, [ids, current]);

  const currentIndex = indexOf(current);
  const jumpTo = useCallback(
    (id: SectionId) => {
      if (!isReachable(ids.indexOf(id), frontier, currentIndex, preview)) return;
      setStillToDo(null);
      setCurrent(id);
    },
    [ids, frontier, currentIndex, preview]
  );

  const breadcrumbCurrent = current === "complete" ? ids[ids.length - 1] : isLesson ? current : undefined;
  const completedLessons = current === "complete" ? [...ids] : [...done];

  const progressPct =
    current === "complete" ? 100 : isLesson ? Math.round(((currentIndex + 1) / total) * 100) : 0;

  const lesson = isLesson ? byId.get(current) : undefined;
  // A lesson not done, with a later one done: added, shown again or moved
  // there after the learner started (spec 5.5, 7.4).
  const isNew =
    !preview && lesson !== undefined && !done.has(lesson.id) && ids.slice(currentIndex + 1).some((id) => done.has(id));

  // This lesson on the course page, in the language asked for (not the
  // English a learner may be shown instead).
  const editHref = `/content/courses/${course.slug}?${isLesson ? `lesson=${current}&` : ""}lang=${asked}`;

  // Opened from the course page in a new tab: that page is still open, so go
  // back to it instead of starting a second copy (whose saves could then
  // overwrite each other). Only a tab with nothing else in its history may
  // close itself; otherwise the link is followed as usual.
  const backToOpener = (e: MouseEvent) => {
    if (window.history.length !== 1) return;
    window.close();
    if (window.closed) e.preventDefault();
  };

  const back = backFrom(ids, current);

  return (
    // Anything the learner does here — a step, an answer, Continue — means
    // they have started: the resume check then leaves them where they are.
    <div
      className="mx-auto max-w-3xl px-4 py-6 sm:py-8"
      onClickCapture={interacted}
      onChangeCapture={interacted}
      onInputCapture={interacted}
    >
      <StaleBuildBanner />
      {preview || draftPreview ? (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--foreground)]"
        >
          <p>
            {tPlayer.rich(draftPreview ? "draftPreview" : "preview", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {languageNotLive ? (
            <p className="basis-full">
              {sentenceStart(
                tPlayer("languageNotLive", {
                  language: nameInSentence(tCourses(`languageName.${languageNotLive}`), asked),
                }),
                asked
              )}
            </p>
          ) : null}
          {canEdit ? (
            <Link
              href={editHref}
              locale={editLocale}
              onClick={editLocale ? backToOpener : undefined}
              className="font-medium text-[var(--accent)] underline underline-offset-2"
            >
              {tPlayer("backToEditing")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Top bar. It wraps on a phone, where an editor's longer links
          ("Edit this lesson" in Greek) and the title don't fit one line. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/learner"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {tPlayer("dashboard")}
          </Link>
          {/* canEdit comes from the server page: roles aren't on the client
              session. Opens the lesson being played on its course page. */}
          {canEdit && isLesson ? (
            <Link
              href={editHref}
              locale={editLocale}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm hover:bg-[var(--surface-muted)] transition-colors"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {tPlayer("editLesson")}
            </Link>
          ) : null}
        </div>
        <div className="min-w-0 text-right">
          <p lang={contentLang} className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
            {course.clusterLabel}
          </p>
          <h1 lang={contentLang} className="text-sm sm:text-base font-semibold">
            {course.title}
          </h1>
        </div>
      </div>

      {contentLang ? (
        <p
          role="note"
          className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm"
        >
          <Languages className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--accent)]" aria-hidden />
          {tPlayer("languageFallback")}
        </p>
      ) : null}

      {current === "empty" ? (
        <Card>
          <CardContent className="p-6 sm:p-8">
            <p className="text-base">{tPlayer("noLessons")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Breadcrumb — enforces visible sequence */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-2">
            <StageBreadcrumb<SectionId>
              current={breadcrumbCurrent ?? ids[0]}
              completed={completedLessons}
              onJump={jumpTo}
              stages={ids}
              labelOf={labelOf}
              langOf={langOf}
              allReachable={preview}
              frontier={frontier}
              doneLabel={tPlayer("stepDone")}
            />
          </div>
          <Progress value={progressPct} className="mb-6" />

          {/* Current lesson. Focus moves here on lesson change so SR users
              hear the new content; in-lesson feedback uses its own live
              regions, and the player's own messages its one region. */}
          <ContentLangContext.Provider value={contentLang}>
            <div key={current} ref={stageRef} tabIndex={-1} className="outline-none space-y-4">
              {lesson && stillToDo === lesson.id ? (
                <LessonNote kind="stillToDo" name={lesson.label} lang={langOf(lesson.id)} />
              ) : isNew ? (
                <LessonNote kind="new" />
              ) : null}
              {current === "complete" ? (
                <CompletionStage course={completionCourse(course)} />
              ) : lesson?.kind === "section" ? (
                <SectionView
                  stage={lesson.section}
                  stageNumber={currentIndex + 1}
                  onContinue={goNext}
                  onCueAnswered={onCueAnswered}
                  replacedPrompts={lesson.replacedPrompts}
                />
              ) : lesson?.kind === "stage" ? (
                <StageLesson
                  lesson={lesson}
                  stageNumber={currentIndex + 1}
                  onContinue={goNext}
                  onCueAnswered={onCueAnswered}
                />
              ) : null}
            </div>
          </ContentLangContext.Provider>

          {/* Nav */}
          {isLesson ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={goBack} disabled={back === null}>
                <ChevronLeft className="h-4 w-4" />
                {nameOf(back ?? ids[0])}
              </Button>
              <p className="text-xs text-[var(--muted-foreground)]">
                {currentIndex + 1} / {total} · {nameOf(current)}
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * A standard lesson with only its main content, by its Release 0 stage
 * screen (spec 5.3), with its video and documents above it. An unknown kind
 * of stage draws nothing — never the completion screen, which would
 * complete the course.
 *
 * Release 4 (D107, spec 4.5): its further reading comes after the stage
 * screen, which ends with its own Continue, so learners meet the lesson
 * before its links out and the list is the last thing in the lesson. A
 * lesson without links is drawn as before.
 */
function StageLesson({
  lesson,
  stageNumber,
  onContinue,
  onCueAnswered,
}: {
  lesson: Extract<LearnerLesson, { kind: "stage" }>;
  stageNumber: number;
  onContinue: () => void;
  onCueAnswered: (cue: { cueId: string; correct: boolean; lessonId: SectionId }) => void;
}) {
  const stage = lesson.stage;
  return (
    <>
      {stage.video ? (
        <InteractiveVideoPlayer
          video={stage.video}
          onCueAnswered={(cueId, correct) => onCueAnswered({ cueId, correct, lessonId: lesson.id })}
        />
      ) : null}
      {stage.documents?.length ? (
        <LessonDocuments documents={stage.documents} stageNumber={stageNumber} />
      ) : null}
      {stage.key === "context" || stage.key === "concept" || stage.key === "behaviour" ? (
        <NarrativeStage stage={stage} onContinue={onContinue} />
      ) : stage.key === "simulation" ? (
        <SimulationStage stage={stage} onContinue={onContinue} />
      ) : stage.key === "scenario" ? (
        <ScenarioStage stage={stage} onContinue={onContinue} />
      ) : stage.key === "reflection" ? (
        <ReflectionStage stage={stage} onContinue={onContinue} />
      ) : stage.key === "assessment" ? (
        <AssessmentStage stage={stage} onContinue={onContinue} />
      ) : null}
      <LessonFurtherReading links={stage.links} />
    </>
  );
}
