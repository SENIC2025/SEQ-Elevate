"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  partKey,
  type PartAnswer,
  type PartKey,
  type ResolvedPart,
  type SectionStage,
} from "@/lib/cms/sections/contract";
import type { StoredAnswer } from "@/lib/learner-progress/contract";
import { InteractiveVideoPlayer } from "../InteractiveVideoPlayer";
import { LessonDocuments } from "../LessonDocuments";
import { ContinueNote, FLAGGED_CLASS, useContinue, type ContinueApi } from "../useContinue";
import { useLessonAnswers } from "../useLessonAnswers";
import { RefusedNote } from "../refused-note";
import { TextPart } from "./TextPart";
import { PracticePart } from "./PracticePart";
import { ScenarioPart } from "./ScenarioPart";
import { QuizPart } from "./QuizPart";
import { ReflectionPart } from "./ReflectionPart";
import { RatingPart } from "./RatingPart";
import type { PartTargets } from "./part-props";
import { useContentLang } from "../CourseText";

/**
 * One lesson drawn piece by piece (D63, spec 5.3): a lesson of the course's
 * own, or a standard lesson with extra content. Top to bottom: its video,
 * its documents, its title, then each piece of content in its own section
 * with an h3 (a region named by it, unless another piece has the same
 * heading), the editors' note when content was left out (an editor's
 * preview only), and one Continue for the whole lesson.
 *
 * The answers are the learner's (useLessonAnswers): restored when the
 * lesson opens again, saved as they're given — a practice answer with
 * whether it was the best one, a scenario with its choices' texts for the
 * Comp Card. "Try another" and "Try different choices" ask again on this
 * screen only (`retrying`): the saved answer stays until a new one is
 * given (owner default 8).
 *
 * An answer the server refused (or the store held back) stays on the
 * screen, and a note under its item says it wasn't saved (D62.d).
 *
 * Continue is always there and enabled, with what it waits for above it
 * (useContinue). Pressed early, it marks the first item missing, says what
 * it needs under its heading and in the player's live region, and takes
 * focus to the exact place, which the note describes.
 *
 * When the standard reflection's three questions were replaced by the
 * lesson's own (`replacedPrompts`), a learner who answered them earlier
 * finds those answers, read only, under "Your earlier answers".
 */
export function SectionView({
  stage,
  stageNumber,
  onContinue,
  onCueAnswered,
  replacedPrompts,
}: {
  stage: SectionStage;
  /** Position in the course, for the documents' heading. */
  stageNumber: number;
  onContinue: () => void;
  /** An in-video question answered, with this lesson's id (spec 5.9). */
  onCueAnswered?: (cue: { cueId: string; correct: boolean; lessonId: SectionStage["key"] }) => void;
  /** The standard reflection questions this lesson's own replaced. */
  replacedPrompts?: { id: "p1" | "p2" | "p3"; label: string }[];
}) {
  const t = useTranslations("sectionPreview");
  const tHeading = useTranslations("sectionPreview.partHeading");
  const tPlayer = useTranslations("coursePlayer");
  const tCommon = useTranslations("common");
  const { answers, answer, refused } = useLessonAnswers();
  // Pieces of content tried again on this visit: shown fresh, saved as they were.
  const [retrying, setRetrying] = useState<ReadonlySet<PartKey>>(() => new Set());
  const cont = useContinue({ lessonId: stage.key, parts: stage.parts, answers, retrying, onContinue });
  // Course text carries the course's language when it isn't the page's.
  const lang = useContentLang();

  const setRetry = (key: PartKey, on: boolean) =>
    setRetrying((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const give = (part: ResolvedPart, key: PartKey, a: PartAnswer | undefined) => {
    if (a === undefined) {
      setRetry(key, true);
      return;
    }
    setRetry(key, false);
    const [stored, labels] = answerToStore(part, a);
    answer(key, stored, labels);
  };

  // Each piece is a region named by its heading only while no other piece
  // of the lesson has the same heading: every text piece is "Text", and two
  // untitled quick checks are both "Quick check" — two landmarks named
  // alike (axe landmark-unique). The headings themselves all stay.
  const headings = stage.parts.map((part) => headingText(part, tHeading));
  const unique = (i: number) => headings.indexOf(headings[i]) === headings.lastIndexOf(headings[i]);

  const earlier =
    replacedPrompts?.filter((p) => {
      const saved = answers["reflection/main"];
      return saved?.type === "reflection" && (saved.text[p.id] ?? "").trim() !== "";
    }) ?? [];

  return (
    <div className="space-y-4">
      {stage.video ? (
        <InteractiveVideoPlayer
          video={stage.video}
          onCueAnswered={
            onCueAnswered ? (cueId, correct) => onCueAnswered({ cueId, correct, lessonId: stage.key }) : undefined
          }
        />
      ) : null}
      {stage.documents?.length ? (
        <LessonDocuments documents={stage.documents} stageNumber={stageNumber} />
      ) : null}
      <Card>
        <CardContent className="p-6 sm:p-8">
          {stage.subtitle ? (
            <p lang={lang} className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
              {stage.subtitle}
            </p>
          ) : null}
          <h2 lang={lang} className="text-2xl font-bold tracking-tight">
            {stage.title}
          </h2>

          <div className="mt-4 space-y-8">
            {stage.parts.map((part, i) => {
              const key = partKey(stage.key, part.id);
              const hid = cont.ids.heading(part.id);
              const isFlagged = cont.flagged?.partId === part.id;
              return (
                <section
                  key={part.id}
                  aria-labelledby={unique(i) ? hid : undefined}
                  className={cn(isFlagged && FLAGGED_CLASS)}
                >
                  <PartHeading part={part} text={headings[i]} id={hid} describedBy={cont.describedBy(hid)} />
                  <ContinueNote api={cont} partId={part.id} />
                  <PartBody
                    part={part}
                    headingId={hid}
                    targets={targetsOf(cont, part)}
                    answer={retrying.has(key) ? undefined : answers[key]}
                    onAnswer={(a) => give(part, key, a)}
                  />
                  <RefusedNote reason={refused[key]} reflection={part.type === "reflection"} />
                </section>
              );
            })}
          </div>

          {earlier.length ? (
            <details className="mt-6 rounded-lg border border-[var(--border)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">{tPlayer("earlierAnswers")}</summary>
              <dl className="mt-2 space-y-3 text-sm">
                {earlier.map((p) => {
                  const saved = answers["reflection/main"];
                  return (
                    <div key={p.id}>
                      <dt className="font-medium">{p.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-[var(--muted-foreground)]">
                        {saved?.type === "reflection" ? saved.text[p.id] : ""}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          ) : null}

          {stage.skipped > 0 ? (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
              <Info aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
              <span>{t("skippedNote", { count: stage.skipped })}</span>
            </p>
          ) : null}

          {/* What Continue waits for, above it: plain text, read in page
              order, not a live region. */}
          <div className="mt-6 space-y-3">
            {cont.hint ? (
              <p id={cont.hintId} className="text-sm text-[var(--muted-foreground)] sm:text-right">
                {cont.hint}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button size="md" aria-describedby={cont.hint ? cont.hintId : undefined} onClick={cont.press}>
                {tCommon("continue")}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** What a part's answer is saved with: a practice answer's rightness, a scenario's choice texts. */
export function answerToStore(
  part: ResolvedPart,
  a: PartAnswer
): [StoredAnswer, { root?: string | null; followup?: string | null } | undefined] {
  if (a.type === "practice") {
    const option = part.type === "practice" ? part.simulation.options.find((o) => o.id === a.optionId) : undefined;
    return [{ type: "practice", optionId: a.optionId, correct: !!option?.isBest }, undefined];
  }
  if (a.type === "scenario" && part.type === "scenario") {
    const root = part.scenario.choices.find((c) => c.id === a.rootId);
    const followup = root?.followups?.find((c) => c.id === a.followupId);
    return [a, { root: root?.text ?? null, followup: followup?.text ?? null }];
  }
  return [a, undefined];
}

/** The places inside `part` Continue may take focus to, and the lesson's hint while there is one. */
function targetsOf(cont: ContinueApi, part: ResolvedPart): PartTargets {
  return {
    followup: cont.ids.followup(part.id),
    question: (q) => cont.ids.question(part.id, q),
    check: cont.ids.check(part.id),
    describedBy: cont.describedBy,
    ...(cont.hint ? { hint: cont.hintId } : {}),
  };
}

/** A part's heading: its own title, else what kind of content it is ("Text" for a text piece). */
function headingText(part: ResolvedPart, t: (kind: ResolvedPart["type"]) => string): string {
  return (part.type === "text" ? undefined : part.title) ?? t(part.type);
}

/**
 * A part's heading: its own title, else what kind of content it is. A text
 * part's heading is for screen readers only — "Text" above a paragraph
 * says nothing to the eye. A question with a title of its own also shows
 * its kind above it. Continue pressed early may take focus here.
 */
function PartHeading({
  part,
  text,
  id,
  describedBy,
}: {
  part: ResolvedPart;
  /** headingText(part). */
  text: string;
  id: string;
  describedBy?: string;
}) {
  const t = useTranslations("sectionPreview.partHeading");
  // An author's title is course text; the kind's own name is the page's.
  const lang = useContentLang();
  const title = part.type === "text" ? undefined : part.title;
  return (
    <>
      {title ? (
        <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
          {t(part.type)}
        </p>
      ) : null}
      <h3
        id={id}
        tabIndex={-1}
        aria-describedby={describedBy}
        lang={title ? lang : undefined}
        className={cn(
          "text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-sm",
          part.type === "text" ? "sr-only" : "mb-3"
        )}
      >
        {text}
      </h3>
    </>
  );
}

function PartBody({
  part,
  answer,
  onAnswer,
  headingId,
  targets,
}: {
  part: ResolvedPart;
  answer: PartAnswer | undefined;
  onAnswer: (a: PartAnswer | undefined) => void;
  headingId: string;
  targets: PartTargets;
}) {
  const common = { answer, onAnswer, headingId, targets };
  switch (part.type) {
    case "text":
      return <TextPart part={part} />;
    case "practice":
      return <PracticePart part={part} {...common} />;
    case "scenario":
      return <ScenarioPart part={part} {...common} />;
    case "quiz":
      return <QuizPart part={part} {...common} />;
    case "reflection":
      return <ReflectionPart part={part} {...common} />;
    case "rating":
      return <RatingPart part={part} {...common} />;
  }
}
