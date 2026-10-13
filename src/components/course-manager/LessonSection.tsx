"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LessonNarrativeEditor } from "@/components/role/LessonNarrativeEditor";
import { VideoBlockAuthor } from "@/components/role/VideoBlockAuthor";
import { LessonDocumentManager } from "@/components/role/LessonDocumentManager";
import { DraftBadge, StructureAuthor } from "@/components/role/StructureAuthor";
import type {
  CourseKind,
  CourseStatus,
  LessonOutline,
  NarrativeInitial,
} from "@/lib/cms/course-admin-types";
import type { LessonDocumentRef, Locale, VideoContent } from "@/lib/cms/types";
import type { StoredStructure, StructureStageKey } from "@/lib/cms/structure";
import { offersAdd } from "@/lib/cms/course-derive";
import { DirtyScope } from "./dirty-registry";
import { LessonReadView } from "./LessonReadView";
import { BuiltInNotice } from "./BuiltInNotice";
import { PreviewLink } from "./CourseHeader";
import { Check, FileText, PenLine, Plus, Video } from "lucide-react";

/**
 * One lesson on the course page. Closed, it shows what learners see
 * (LessonReadView). Opened ("Edit lesson"), it shows the lesson's editors in
 * the order learners meet the content: video, documents, then the lesson
 * itself (CoursePlayer's order). Editors mount only while open — each upload
 * tool checks storage when it mounts, and a course has up to seven lessons.
 */
export function LessonSection({
  lesson,
  label,
  slug,
  kind,
  status,
  lang,
  open,
  rev,
  onOpen,
  onClose,
  onNarrativeSaved,
  onReread,
  onStructureSaved,
  onStructureDraftChanged,
  onStructureCleared,
  onVideoSaved,
  onDocumentsChanged,
}: {
  lesson: LessonOutline;
  /** "2. Skill concept" (unnumbered for a lesson not added yet). */
  label: string;
  slug: string;
  kind: CourseKind;
  /** The course's status: whether a save for learners goes live at once. */
  status: CourseStatus;
  lang: Locale;
  open: boolean;
  /** Bumped when this lesson's text in `lang` was re-read after a revert. */
  rev: number;
  onOpen: () => void;
  onClose: () => void;
  onNarrativeSaved: (value: NarrativeInitial) => void;
  /**
   * Re-read this lesson's text in `lang` from the server, once it is no
   * longer the `stale` version the editor had (then `rev` bumps).
   */
  onReread: (stale: string | null) => void;
  onStructureSaved: (structure: StoredStructure) => void;
  /** An interactive lesson's draft was saved (as stored) or is gone (null). */
  onStructureDraftChanged: (draft: StoredStructure | null) => void;
  onStructureCleared: () => void;
  onVideoSaved: (video: VideoContent | null) => void;
  onDocumentsChanged: (documents: LessonDocumentRef[]) => void;
}) {
  const t = useTranslations("courseManager");
  const tDraft = useTranslations("exerciseEditor.page");
  // The exercise editor's heading, which also names its region for screen
  // readers: in the menu language, like everything under it.
  const tRegion = useTranslations("exerciseEditor.region");
  const { key } = lesson;
  const headingId = `lesson-${key}-h`;
  const panelId = `lesson-${key}-panel`;
  const stage = lesson.byLang[lang].stage;
  const narrative = lesson.byLang[lang].narrative;
  const interactive = lesson.body === "interactive";

  // A lesson that so far exists only as a draft is edited, not added.
  const toggle = offersAdd(lesson) ? (
    <Button
      size="sm"
      variant={open ? "outline" : "primary"}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={open ? onClose : onOpen}
    >
      {open ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {open ? t("page.done") : t(`page.addStage.${key as StructureStageKey}`)}
    </Button>
  ) : (
    <Button
      size="sm"
      variant={open ? "primary" : "outline"}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={open ? onClose : onOpen}
    >
      {open ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <PenLine className="h-4 w-4" aria-hidden />
      )}
      {open ? t("page.done") : t("page.editLesson")}
    </Button>
  );

  // The lesson body's editor, or why there isn't one.
  let body: React.ReactNode;
  if (!lesson.editable.body) {
    body = (
      <div className="space-y-3">
        <BuiltInNotice />
        <LessonReadView lesson={lesson} stage={stage} bodyOnly />
      </div>
    );
  } else if (interactive) {
    const stageKind = key as StructureStageKey;
    body = (
      // Not keyed by language: its draft holds every language, so unsaved
      // work survives a language switch. It reads the stage itself when the
      // lesson opens — the outline is from page load, and a colleague may
      // have saved another language since.
      <DirtyScope id={`lesson:${key}:structure`} label={label}>
        {(report) => (
          <StructureAuthor
            courseSlug={slug}
            kind={stageKind}
            locale={lang}
            courseStatus={status}
            regionLabel={tRegion(stageKind)}
            embedded
            onSaved={onStructureSaved}
            onDraftChange={onStructureDraftChanged}
            onCleared={onStructureCleared}
            onDirtyChange={report}
          />
        )}
      </DirtyScope>
    );
  } else if (narrative) {
    body = (
      <DirtyScope key={lang} id={`lesson:${key}:text`} label={label} langBound>
        {(report) => (
          <LessonNarrativeEditor
            courseSlug={slug}
            stageKey={key}
            locale={lang}
            initial={narrative}
            initialRev={rev}
            courseKind={kind}
            mode={lesson.body === "reflection" ? "reflection" : "narrative"}
            prompts={stage?.reflection?.prompts.map((p) => p.label)}
            embedded
            onSaved={onNarrativeSaved}
            onDirtyChange={report}
            onReread={onReread}
          />
        )}
      </DirtyScope>
    );
  } else {
    body = <LessonReadView lesson={lesson} stage={stage} bodyOnly />;
  }

  return (
    <section
      id={`lesson-${key}`}
      aria-labelledby={headingId}
      className={`scroll-mt-20 rounded-xl border bg-[var(--surface)] ${
        open ? "border-[var(--accent)]/40 shadow-sm" : "border-[var(--border)]"
      } ${lesson.addable && !open ? "border-dashed" : ""}`}
    >
      <div className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1 basis-64">
          <h2
            id={headingId}
            tabIndex={-1}
            className="text-base font-semibold sm:text-lg"
          >
            {label}
          </h2>
          {lesson.addable ? (
            <Badge variant="muted" className="mt-1 text-[10px]">
              {t("page.notAddedYet")}
            </Badge>
          ) : stage?.title ? (
            <p className="mt-0.5 break-words text-sm text-[var(--muted-foreground)]">
              {stage.title}
            </p>
          ) : null}
          {lesson.draft ? (
            <p className="mt-1">
              <DraftBadge label={tDraft("draftBadge")} />
            </p>
          ) : null}
          {lesson.present ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {lesson.video || lesson.builtInVideo ? (
                <Badge variant="default" className="text-[10px]">
                  <Video className="h-3 w-3" aria-hidden />
                  {t("page.read.video")}
                </Badge>
              ) : null}
              {lesson.documents.length ? (
                <Badge variant="default" className="text-[10px]">
                  <FileText className="h-3 w-3" aria-hidden />
                  {t("page.read.documents")}: {lesson.documents.length}
                </Badge>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lesson.present ? (
            <PreviewLink
              slug={slug}
              lang={lang}
              lesson={key}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-muted)]"
            >
              {t("page.previewLesson")}
            </PreviewLink>
          ) : null}
          {toggle}
        </div>
      </div>

      <div id={panelId} className="border-t border-[var(--border)] p-4 sm:p-5">
        {open ? (
          <div className="space-y-6">
            {/* Learner order: video, documents, then the lesson itself.
                Kept in fixed slots so the body editor isn't remounted when
                a newly added lesson gains its video and documents. */}
            {lesson.editable.media ? (
              <DirtyScope id={`lesson:${key}:video`} label={label}>
                {(report) => (
                  <VideoBlockAuthor
                    courseSlug={slug}
                    stageKey={key}
                    initialVideo={lesson.video}
                    builtInVideo={lesson.builtInVideo}
                    locale={lang}
                    embedded
                    onSaved={onVideoSaved}
                    onDirtyChange={report}
                  />
                )}
              </DirtyScope>
            ) : null}
            {lesson.editable.media ? (
              <LessonDocumentManager
                courseSlug={slug}
                stageKey={key}
                initialDocuments={lesson.documents}
                embedded
                onChange={onDocumentsChanged}
              />
            ) : null}
            {body}
          </div>
        ) : (
          <LessonReadView lesson={lesson} stage={stage} />
        )}
      </div>
    </section>
  );
}
