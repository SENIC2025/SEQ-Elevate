"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDemoState } from "@/store/demo-state";
import type { CourseStage } from "@/lib/cms/types";
import { ArrowRight, NotebookPen } from "lucide-react";

/**
 * Reflection stage. Renders authored prompts; answers are private to the
 * learner. Maps the first three prompts to the persisted reflection slots.
 */
export function ReflectionStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const t = useTranslations("coursePlayer");
  const tCommon = useTranslations("common");
  const { state, dispatch } = useDemoState();
  const r = state.course.reflection;

  const ref = stage.reflection;
  if (!ref) return null;

  const slots = ["p1", "p2", "p3"] as const;
  const set = (key: "p1" | "p2" | "p3", value: string) =>
    dispatch({ type: "updateReflection", patch: { [key]: value } });

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <NotebookPen className="h-3.5 w-3.5" />
          {t("justForYou")}
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{ref.intro}</p>

        <div className="mt-6 space-y-5">
          {ref.prompts.slice(0, 3).map((prompt, i) => {
            const key = slots[i];
            return (
              <div key={i}>
                <label className="block text-sm font-medium mb-1.5">
                  {prompt.label}
                </label>
                <Textarea
                  value={r[key]}
                  onChange={(e) => set(key, e.target.value)}
                  placeholder={prompt.placeholder}
                  rows={2}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <Button size="md" onClick={onContinue}>
            {tCommon("continue")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
