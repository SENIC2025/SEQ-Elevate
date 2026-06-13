"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDemoState } from "@/store/demo-state";
import { ArrowRight, NotebookPen } from "lucide-react";

export function ReflectionStage({ onContinue }: { onContinue: () => void }) {
  const t = useTranslations("course.workplaceConflict.reflection");
  const { state, dispatch } = useDemoState();
  const r = state.course.reflection;

  const set = (key: "p1" | "p2" | "p3", value: string) =>
    dispatch({ type: "updateReflection", patch: { [key]: value } });

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-2">
          <NotebookPen className="h-3.5 w-3.5" />
          Just for you
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("intro")}
        </p>

        <div className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("prompt1")}
            </label>
            <Textarea
              value={r.p1}
              onChange={(e) => set("p1", e.target.value)}
              placeholder={t("placeholder1")}
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("prompt2")}
            </label>
            <Textarea
              value={r.p2}
              onChange={(e) => set("p2", e.target.value)}
              placeholder={t("placeholder2")}
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("prompt3")}
            </label>
            <Textarea
              value={r.p3}
              onChange={(e) => set("p3", e.target.value)}
              placeholder={t("placeholder3")}
              rows={2}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button size="md" onClick={onContinue}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
