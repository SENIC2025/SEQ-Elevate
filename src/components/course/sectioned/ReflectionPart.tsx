"use client";

import { useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ReflectionIntro } from "../ReflectionIntro";
import type { PartProps } from "./part-props";

/**
 * Reflection questions: the intro when there is one, then one labelled box
 * per question — any number of them, not only the standard three. What
 * the editor types stays in the preview's memory; nothing is saved.
 */
export function ReflectionPart({ part, answer, onAnswer }: PartProps<"reflection">) {
  const uid = useId();
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
            return (
              <div key={prompt.id}>
                <label htmlFor={id} className="block text-sm font-medium mb-1.5">
                  {prompt.label}
                </label>
                <Textarea
                  id={id}
                  value={text[prompt.id] ?? ""}
                  onChange={(e) =>
                    onAnswer({ type: "reflection", text: { ...text, [prompt.id]: e.target.value } })
                  }
                  placeholder={prompt.placeholder || undefined}
                  rows={2}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
