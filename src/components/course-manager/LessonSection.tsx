"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LessonNarrativeEditor } from "@/components/role/LessonNarrativeEditor";
import { VideoBlockAuthor } from "@/components/role/VideoBlockAuthor";
import { LessonDocumentManager } from "@/components/role/LessonDocumentManager";
import { DraftBadge, StructureAuthor } from "@/components/role/StructureAuthor";
import type { StoredStructure, StructureStageKey } from "@/lib/cms/structure";
import { offersAdd } from "@/lib/cms/course-derive";
import { DirtyScope } from "./dirty-registry";
import { LessonReadView } from "./LessonReadView";
import { BuiltInNotice } from "./BuiltInNotice";
import { PreviewLink } from "./CourseHeader";
import type { LessonSectionProps } from "./lesson-section-props";
import { PartList } from "./blocks/PartList";
import { Check, FileText, PenLine, Plus, Video } from "lucide-react";

/**
 * One lesson on the course page. Closed, it shows what learners see
 * (LessonReadView). Opened ("Edit lesson"), it shows the lesson's editors in
 * the order learners meet the content: video, documents, then the lesson
 * itself (CoursePlayer's order). Editors mount only while open — each upload
 * tool checks storage when it mounts, and a course has up to fifteen lessons.
 *
 * A lesson of a created course's lesson list (Release 1) shows its content
 * as a list (PartList): the main content in today's editor, with the same
 * names and ids, and any content added around it, each with its own editor.
 * A lesson of the course's own is edited by its id, with the editor its
 * template gives (mainKind).
 */
export function LessonSection(props: LessonSectionProps) {
  // Every prop of the contract arrives (CourseWorkspace passes them all);
  // `enrolled` is for the lesson list's own hints.
  const {
    lesson,
    label,
    labelLang,
    slug,
    kind,
    status,
    lang,
    open,
    rev,
    headerExtra,
    onOpen,
    onClose,
    onNarrativeSaved,
    onReread,
    onStructureSaved,
    onStructureDraftChanged,
    onStructureCleared,
    onVideoSaved,
    onDocumentsChanged,
    reasons,
    onOutline,
    announce,
  } = props;
  const t = useTranslations("courseManager");
  const tDraft = useTranslations("exerciseEditor.page");
  // The exercise editor's heading, which also names its region for screen
  // readers: in the menu language, like everything under it.
  const tRegion = useTranslations("exerciseEditor.region");
  const tBlocks = useTranslations("lessonBlocks");
  const { key } = lesson;
  const headingId = `lesson-${key}-h`;
  const panelId = `lesson-${key}-panel`;
  const stage = lesson.byLang[lang].stage;
  const narrative = lesson.byLang[lang].narrative;
  const sectioned = lesson.byLang[lang].sectioned;
  const interactive = lesson.body === "interactive";
  // The lesson has its own reflection questions as added content: the
  // standard ones it would show are replaced by them.
  const ownQuestions =
    lesson.parts?.items.some((item) => item.type === "reflection") ?? false;
  // A lesson of the course's own has no learner stage: its preview's title,
  // when it has one besides its name.
  const subtitle =
    stage?.title ??
    (sectioned && sectioned.title !== lesson.section?.name[lang]?.text
      ? sectioned.title
      : undefined);

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
    // A standard key's own kind, or the one a lesson of the course's own
    // was made as (mainKindOf); the lesson itself by its id.
    const stageKind = lesson.mainKind as StructureStageKey;
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
            stageKey={key}
            locale={lang}
            courseStatus={status}
            regionLabel={tRegion(stageKind)}
            embedded
            // Main content is one of Release 0's three kinds.
            onSaved={(value) => onStructureSaved(value as StoredStructure)}
            onDraftChange={(draft) =>
              onStructureDraftChanged(draft as StoredStructure | null)
            }
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
            promptsNote={ownQuestions ? tBlocks("ownQuestionsNote") : undefined}
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

  // A lesson of the course's list: its content as a list, the main content
  // first among equals. A created course's lesson that isn't in the list yet
  // (an "Add …" lesson, or one with only a draft) gets the same wrappers
  // without the list's controls, so its first "Save stage", which puts it in
  // the list, doesn't remount the editor (and wipe "Saved" and focus).
  const content =
    kind === "cms" && lesson.editable.body ? (
      <PartList
        listed={lesson.section !== null}
        lesson={lesson}
        label={label}
        slug={slug}
        kind={kind}
        status={status}
        lang={lang}
        reasons={reasons}
        main={body}
        onOutline={onOutline}
        announce={announce}
      />
    ) : (
      body
    );

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
            lang={labelLang}
            className="text-base font-semibold sm:text-lg"
          >
            {label}
          </h2>
          {lesson.addable ? (
            <Badge variant="muted" className="mt-1 text-[10px]">
              {t("page.notAddedYet")}
            </Badge>
          ) : subtitle ? (
            <p className="mt-0.5 break-words text-sm text-[var(--muted-foreground)]">
              {subtitle}
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
          {headerExtra}
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
            {content}
          </div>
        ) : (
          <LessonReadView lesson={lesson} stage={stage} sectioned={sectioned} lang={lang} />
        )}
      </div>
    </section>
  );
}
