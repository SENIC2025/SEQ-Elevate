"use client";

import { useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ReflectionIntro } from "../ReflectionIntro";
import { AnswerLengthNote, answerLengthState } from "../answer-length";
import type { PartProps } from "./part-props";
import { useContentLang } from "../CourseText";

/**
 * Reflection questions: the intro when there is one, then one labelled box
 * per question — any number of them, not only the standard three. The
 * answers are the learner's, saved question by question; in a preview
 * nothing is saved. Up to 5,000 characters each, as in the reflection
 * stage (answer-length.tsx): a note near and past the limit, never a cut.
 */
export function ReflectionPart({ part, answer, onAnswer }: PartProps<"reflection">) {
  const uid = useId();
  // Course text carries the course's language when it isn't the page's.
  const lang = useContentLang();
  const text = answer?.type === "reflection" ? answer.text : {};
  const hasIntro = !!(part.intro || part.introRich);

  return (
    <div>
      {hasIntro ? (
        <ReflectionIntro reflection={{ intro: part.intro ?? "", introRich: part.introRich }} />
      ) : null}
      {part.prompts.length > 0 ? (
        <div className={hasIntro ? "mt-4 space-y-5" : "space-y-5"}>
          {part.prompts.map((prompt, i) => {
            const id = `${uid}-${i}`;
            const length = answerLengthState(text[prompt.id]);
            return (
              <div key={prompt.id}>
                <label htmlFor={id} lang={lang} className="block text-sm font-medium mb-1.5">
                  {prompt.label}
                </label>
                <Textarea
                  id={id}
                  value={text[prompt.id] ?? ""}
                  onChange={(e) =>
                    onAnswer({ type: "reflection", text: { ...text, [prompt.id]: e.target.value } })
                  }
                  placeholder={prompt.placeholder || undefined}
                  aria-describedby={length ? `${id}-length` : undefined}
                  aria-invalid={length?.kind === "tooLong" ? true : undefined}
                  rows={2}
                />
                <AnswerLengthNote id={`${id}-length`} state={length} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
