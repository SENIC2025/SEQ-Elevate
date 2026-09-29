"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { NarrativeBlocks } from "@/components/course/NarrativeStage";
import { FormattedText } from "@/components/course/FormattedText";
import { ReflectionIntro } from "@/components/course/ReflectionIntro";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { CourseStage, OutcomeQuality } from "@/lib/cms/types";
import { Check, FileText, Star, Video } from "lucide-react";

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
 */
export function LessonReadView({
  lesson,
  stage,
  bodyOnly = false,
}: {
  lesson: LessonOutline;
  /** The lesson as learners see it in the content language. */
  stage: CourseStage | null;
  /** Just the lesson itself — the video and documents have editors above. */
  bodyOnly?: boolean;
}) {
  const t = useTranslations("courseManager.page.read");

  if (bodyOnly) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <StageBody stage={stage} />
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
        <StageBody stage={stage} />
      </div>
    </div>
  );
}

function StageBody({ stage }: { stage: CourseStage | null }) {
  const t = useTranslations("courseManager.page.read");
  const tPlayer = useTranslations("coursePlayer");
  const empty = (
    <p className="text-sm text-[var(--muted-foreground)]">{t("emptyLesson")}</p>
  );
  if (!stage) return empty;

  if (stage.simulation) {
    const s = stage.simulation;
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

  if (stage.scenario) {
    const s = stage.scenario;
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

  if (stage.assessment) {
    const a = stage.assessment;
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
