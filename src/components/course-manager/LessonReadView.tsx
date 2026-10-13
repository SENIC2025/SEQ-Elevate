"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { NarrativeBlocks } from "@/components/course/NarrativeStage";
import { FormattedText } from "@/components/course/FormattedText";
import { ReflectionIntro } from "@/components/course/ReflectionIntro";
import { DraftBadge } from "@/components/role/StructureAuthor";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { PartView, ResolvedPart, SectionStage } from "@/lib/cms/sections/contract";
import type { CourseStage, Locale, OutcomeQuality } from "@/lib/cms/types";
import { Check, FileText, Star, Video } from "lucide-react";
import { blocksHaveText, fallbackOrder } from "@/lib/cms/text-fallback";
import { partTypeOf } from "./blocks/part-list";

const QUALITY_KEY: Record<OutcomeQuality, string> = {
  best: "qualityBest",
  okay: "qualityOkay",
  poor: "qualityPoor",
};

/**
 * What a closed lesson shows on the course page: everything learners get in
 * it, in the content language, without opening an editor — the video and
 * documents (drafts marked), then the lesson itself. Narrative text and a
 * reflection's introduction go through the learner's own renderers
 * (NarrativeBlocks, ReflectionIntro), so what you read here is what
 * learners read. Practice lessons are summarised with the right answers
 * marked, in words as well as icons.
 *
 * A lesson of the course's own, or one with content added around its main
 * content (Release 1), shows each piece of its content in order, as the
 * editor's preview resolves it (`sectioned`), with a "Draft" mark where a
 * draft waits and a note for content not shown yet.
 */
export function LessonReadView({
  lesson,
  stage,
  sectioned,
  lang,
  bodyOnly = false,
}: {
  lesson: LessonOutline;
  /** The lesson as learners see it in the content language. */
  stage: CourseStage | null;
  /** The editor's preview of the lesson in the content language (Release 1). */
  sectioned?: SectionStage | null;
  /** The content language (for the text of the lesson's own content). */
  lang?: Locale;
  /** Just the lesson itself — the video and documents have editors above. */
  bodyOnly?: boolean;
}) {
  const t = useTranslations("courseManager.page.read");
  const ownView =
    sectioned !== undefined &&
    (lesson.section?.custom === true || (lesson.parts?.items.length ?? 0) > 1);
  const body = ownView ? (
    <SectionedBody lesson={lesson} stage={sectioned ?? null} lang={lang} />
  ) : (
    <StageBody stage={stage} />
  );

  if (bodyOnly) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        {body}
      </div>
    );
  }
  if (!lesson.present) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">{t("notAdded")}</p>
    );
  }

  const video = lesson.video;
  const videoKind =
    video?.provider === "youtube" ? t("youtubeVideo") : t("fileVideo");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("video")}
          </h3>
          {video ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm">
              <Video
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <span className="min-w-0 break-words">
                {video.title ? (
                  <>
                    <span className="font-medium">{video.title}</span> ·{" "}
                  </>
                ) : null}
                {videoKind}
                {video.cues?.length
                  ? ` · ${t("videoQuestions", { count: video.cues.length })}`
                  : null}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {lesson.builtInVideo ? t("builtInVideo") : t("noVideo")}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("documents")}
          </h3>
          {lesson.documents.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {lesson.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-1.5">
                  <FileText
                    className="h-4 w-4 flex-shrink-0 text-[var(--accent)]"
                    aria-hidden
                  />
                  <span className="min-w-0 break-all">{d.name}</span>
                  {!d.published ? (
                    <Badge variant="muted" className="text-[10px]">
                      {t("draftDocument")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("noDocuments")}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        {body}
      </div>
    </div>
  );
}

/**
 * Each piece of a lesson's content in the lesson's order: what the preview
 * shows of it (only what is saved for learners, never a draft), marked
 * "Draft" when a draft waits beside it; content with nothing to show yet
 * says so instead of disappearing.
 */
function SectionedBody({
  lesson,
  stage,
  lang,
}: {
  lesson: LessonOutline;
  stage: SectionStage | null;
  lang?: Locale;
}) {
  const t = useTranslations("courseManager.page.read");
  const tBlocks = useTranslations("lessonBlocks");
  const tLanguage = useTranslations("courseManager.languageName");
  const resolved = new Map((stage?.parts ?? []).map((p) => [p.id as string, p]));
  // Content that can't be read has no list: show what the preview resolved.
  const items: readonly { id: string; view: PartView | null }[] =
    lesson.parts?.items.map((view) => ({ id: view.id, view })) ??
    (stage?.parts ?? []).map((p) => ({ id: p.id, view: null }));
  if (!items.length) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("emptyLesson")}</p>;
  }
  return (
    <ol className="space-y-5">
      {items.map(({ id, view }) => {
        const part = resolved.get(id);
        const main = view?.type === "main";
        const draft = main
          ? lesson.draft !== null
          : view !== null && "draft" in view && view.draft !== null;
        const type = view ? partTypeOf(view, lesson.mainKind) : part?.type ?? "text";
        // A text not written in the content language shows the language
        // learners get instead: say so, and mark it with that language.
        const shownIn =
          view?.type === "text" && lang && !blocksHaveText(view.blocks[lang])
            ? (fallbackOrder(view.blocks as Record<string, unknown>, lang).find((l) =>
                blocksHaveText(view.blocks[l as Locale])
              ) as Locale | undefined)
            : lang;
        return (
          <li key={id} className="space-y-2">
            <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {tBlocks(`types.${type}`)}
              {draft ? <DraftBadge label={tBlocks("draft")} /> : null}
              {lang && shownIn !== lang && part ? (
                <Badge variant="muted" className="text-[10px] normal-case tracking-normal">
                  {tBlocks("langState.missing", { language: tLanguage(lang) })}
                </Badge>
              ) : null}
            </h3>
            {part ? (
              // The content is in its own language; its heading isn't.
              <div lang={shownIn}>
                <PartBody part={part} />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                {view?.type === "text"
                  ? tBlocks("noText")
                  : main && !draft
                    ? t("emptyLesson")
                    : tBlocks("notShown")}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One piece of content as the preview resolves it, summarised like a lesson. */
function PartBody({ part }: { part: ResolvedPart }) {
  const t = useTranslations("courseManager.page.read");
  const tBlocks = useTranslations("lessonBlocks");
  const title =
    part.type !== "text" && part.title ? <p className="text-sm font-semibold">{part.title}</p> : null;
  switch (part.type) {
    case "text":
      return (
        <div className="[&>div]:mt-0">
          <NarrativeBlocks blocks={part.blocks} />
        </div>
      );
    case "practice":
      return (
        <div className="space-y-2">
          {title}
          <SimulationSummary simulation={part.simulation} />
        </div>
      );
    case "scenario":
      return (
        <div className="space-y-2">
          {title}
          <ScenarioSummary scenario={part.scenario} />
        </div>
      );
    case "quiz":
      return (
        <div className="space-y-2">
          {title}
          <AssessmentSummary assessment={part.assessment} />
        </div>
      );
    case "reflection":
      return (
        <div className="space-y-2 text-sm">
          {title}
          <ReflectionIntro reflection={{ intro: part.intro ?? "", introRich: part.introRich }} />
          <p className="font-medium">{t("prompts")}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {part.prompts.map((p) => (
              <li key={p.id}>{p.label}</li>
            ))}
          </ol>
        </div>
      );
    case "rating":
      return (
        <div className="space-y-2 text-sm">
          {title}
          {part.intro ? <FormattedText text={part.intro} /> : null}
          <p className="text-[var(--muted-foreground)]">
            {tBlocks("scale", { min: part.minLabel, max: part.maxLabel })}
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {part.statements.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ol>
        </div>
      );
  }
}

function StageBody({ stage }: { stage: CourseStage | null }) {
  const t = useTranslations("courseManager.page.read");
  const empty = (
    <p className="text-sm text-[var(--muted-foreground)]">{t("emptyLesson")}</p>
  );
  if (!stage) return empty;

  if (stage.simulation) return <SimulationSummary simulation={stage.simulation} />;
  if (stage.scenario) return <ScenarioSummary scenario={stage.scenario} />;
  if (stage.assessment) return <AssessmentSummary assessment={stage.assessment} />;

  if (stage.reflection) {
    const r = stage.reflection;
    return (
      <div className="space-y-2 text-sm">
        <ReflectionIntro reflection={r} />
        <p className="font-medium">{t("prompts")}</p>
        <ol className="list-decimal space-y-1 pl-5">
          {r.prompts.map((p, i) => (
            <li key={i}>{p.label}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (!stage.blocks?.length) return empty;
  // NarrativeBlocks keeps the player's gap under the lesson heading; here
  // there's no heading above it, only the subtitle (if any).
  return (
    <div className={stage.subtitle ? "[&>div]:mt-2" : "[&>div]:mt-0"}>
      {stage.subtitle ? (
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
          {stage.subtitle}
        </p>
      ) : null}
      <NarrativeBlocks blocks={stage.blocks} />
    </div>
  );
}

/** A practice question, with the best response marked in words and an icon. */
function SimulationSummary({
  simulation: s,
}: {
  simulation: Pick<NonNullable<CourseStage["simulation"]>, "prompt" | "instruction" | "options">;
}) {
  const t = useTranslations("courseManager.page.read");
  return (
    <div className="space-y-2 text-sm">
      <FormattedText text={s.prompt} className="font-medium" />
      <FormattedText
        text={s.instruction}
        className="text-[var(--muted-foreground)]"
      />
      <ul className="space-y-1.5">
        {s.options.map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <span className="min-w-0 flex-1">{o.text}</span>
            {o.isBest ? (
              <Badge variant="success" className="text-[10px]">
                <Star className="h-3 w-3" aria-hidden />
                {t("bestResponse")}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A branching scenario, each choice's quality in words. */
function ScenarioSummary({
  scenario: s,
}: {
  scenario: NonNullable<CourseStage["scenario"]>;
}) {
  const tPlayer = useTranslations("coursePlayer");
  return (
    <div className="space-y-2 text-sm">
      <FormattedText text={s.setup} />
      <p className="font-medium">{s.question}</p>
      <ul className="space-y-1.5">
        {s.choices.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-0 flex-1">{c.text}</span>
              <Badge
                variant={c.quality === "best" ? "success" : "muted"}
                className="text-[10px]"
              >
                {tPlayer(QUALITY_KEY[c.quality])}
              </Badge>
            </div>
            {c.followups?.length ? (
              <div className="mt-2 border-l-2 border-[var(--border)] pl-3">
                <p className="text-xs text-[var(--muted-foreground)]">
                  {s.followupQuestion}
                </p>
                <ul className="mt-1 space-y-1">
                  {c.followups.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-start gap-2"
                    >
                      <span className="min-w-0 flex-1">{f.text}</span>
                      <Badge
                        variant={f.quality === "best" ? "success" : "muted"}
                        className="text-[10px]"
                      >
                        {tPlayer(QUALITY_KEY[f.quality])}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A quick check, the correct answer of each question marked in words and an icon. */
function AssessmentSummary({
  assessment: a,
}: {
  assessment: NonNullable<CourseStage["assessment"]>;
}) {
  const t = useTranslations("courseManager.page.read");
  return (
    <div className="space-y-2 text-sm">
      <FormattedText text={a.intro} />
      <ol className="list-decimal space-y-2 pl-5">
        {a.questions.map((q) => (
          <li key={q.id}>
            <p className="font-medium">{q.question}</p>
            <ul className="mt-1 space-y-1">
              {q.options.map((o) => {
                const correct = o.id === q.correctOptionId;
                return (
                  <li key={o.id} className="flex flex-wrap items-start gap-2">
                    <span className="min-w-0 flex-1">{o.text}</span>
                    {correct ? (
                      <Badge variant="success" className="text-[10px]">
                        <Check className="h-3 w-3" aria-hidden />
                        {t("correctAnswer")}
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
