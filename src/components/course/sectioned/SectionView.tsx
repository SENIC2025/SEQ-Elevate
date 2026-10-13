"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CircleAlert, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  partKey,
  type PartAnswer,
  type PartId,
  type PartKey,
  type ResolvedPart,
  type SectionStage,
} from "@/lib/cms/sections/contract";
import { InteractiveVideoPlayer } from "../InteractiveVideoPlayer";
import { LessonDocuments } from "../LessonDocuments";
import { sectionContinueState } from "./section-continue";
import { TextPart } from "./TextPart";
import { PracticePart } from "./PracticePart";
import { ScenarioPart } from "./ScenarioPart";
import { QuizPart } from "./QuizPart";
import { ReflectionPart } from "./ReflectionPart";
import { RatingPart } from "./RatingPart";

export type PreviewAnswers = Partial<Record<PartKey, PartAnswer>>;

/**
 * One lesson of the editor's sectioned preview (spec 10), top to bottom:
 * its video (in-video answers aren't recorded), its documents, its title,
 * then each piece of content in its own region with an h3, a note for
 * editors when content was left out, and one Continue.
 *
 * Continue is always there and enabled. Pressed before every question that
 * needs an answer has one, it takes focus to the first such question's
 * heading, marks it, and says so in a polite live region — instead of a
 * button that's missing or greyed out without saying why.
 *
 * Answers come from the player and go back to it (`onAnswer`): this view
 * remounts on every step change and keeps nothing of its own but the
 * "answer this first" mark.
 */
export function SectionView({
  stage,
  stageNumber,
  answers,
  onAnswer,
  onContinue,
}: {
  stage: SectionStage;
  /** Position in the preview, for the documents' heading. */
  stageNumber: number;
  answers: PreviewAnswers;
  onAnswer: (key: PartKey, answer: PartAnswer | undefined) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("sectionPreview");
  const tCommon = useTranslations("common");
  const uid = useId();
  const headingId = (p: PartId) => `${uid}-${p}`;
  // The part Continue last sent the editor to, and how often (so the same
  // words are announced again on a second press).
  const [missing, setMissing] = useState<{ id: PartId; n: number } | null>(null);

  const state = sectionContinueState(stage.key, stage.parts, answers);
  const flagged = missing && !state.ready && state.firstMissing === missing.id ? missing.id : null;

  const pressContinue = () => {
    if (state.ready) {
      onContinue();
      return;
    }
    setMissing((m) => ({ id: state.firstMissing, n: (m?.n ?? 0) + 1 }));
    document.getElementById(headingId(state.firstMissing))?.focus();
  };

  return (
    <div className="space-y-4">
      {stage.video ? <InteractiveVideoPlayer video={stage.video} /> : null}
      {stage.documents?.length ? (
        <LessonDocuments documents={stage.documents} stageNumber={stageNumber} />
      ) : null}
      <Card>
        <CardContent className="p-6 sm:p-8">
          {stage.subtitle ? (
            <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
              {stage.subtitle}
            </p>
          ) : null}
          <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>

          <div className="mt-4 space-y-8">
            {stage.parts.map((part) => {
              const key = partKey(stage.key, part.id);
              const hid = headingId(part.id);
              const noteId = `${hid}-note`;
              const isFlagged = flagged === part.id;
              return (
                <section
                  key={part.id}
                  aria-labelledby={hid}
                  aria-describedby={isFlagged ? noteId : undefined}
                  className={cn(
                    isFlagged && "rounded-lg outline-2 outline-offset-4 outline-[var(--warning)] outline-dashed"
                  )}
                >
                  <PartHeading part={part} id={hid} />
                  {isFlagged ? (
                    <p id={noteId} className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                      <CircleAlert aria-hidden className="h-4 w-4 flex-shrink-0 text-[var(--warning)]" />
                      {t("answerFirst")}
                    </p>
                  ) : null}
                  <PartBody
                    part={part}
                    headingId={hid}
                    answer={answers[key]}
                    onAnswer={(a) => onAnswer(key, a)}
                  />
                </section>
              );
            })}
          </div>

          {stage.skipped > 0 ? (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
              <Info aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
              <span>{t("skippedNote", { count: stage.skipped })}</span>
            </p>
          ) : null}

          {/* One polite live region, there from the start, for "answer
              this first"; the trailing space makes a repeat a new text. */}
          <p role="status" aria-live="polite" className="sr-only">
            {flagged && missing ? `${t("answerFirst")}${missing.n % 2 ? "" : " "}` : ""}
          </p>

          <div className="mt-6 flex justify-end">
            <Button size="md" onClick={pressContinue}>
              {tCommon("continue")}
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A part's heading: its own title, else what kind of content it is. A text
 * part's heading is for screen readers only — "Text" above a paragraph
 * says nothing to the eye. A question with a title of its own also shows
 * its kind above it.
 */
function PartHeading({ part, id }: { part: ResolvedPart; id: string }) {
  const t = useTranslations("sectionPreview.partHeading");
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
        className={cn(
          "scroll-mt-24 text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-sm",
          part.type === "text" ? "sr-only" : "mb-3"
        )}
      >
        {title ?? t(part.type)}
      </h3>
    </>
  );
}

function PartBody({
  part,
  answer,
  onAnswer,
  headingId,
}: {
  part: ResolvedPart;
  answer: PartAnswer | undefined;
  onAnswer: (a: PartAnswer | undefined) => void;
  headingId: string;
}) {
  const common = { answer, onAnswer, headingId };
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
