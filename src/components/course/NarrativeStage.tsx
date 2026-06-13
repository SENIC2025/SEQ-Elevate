"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CourseStage, NarrativeBlock } from "@/lib/cms/types";
import { ArrowRight, Quote } from "lucide-react";

/**
 * Renders a narrative stage (context / concept / behaviour) from authored
 * content blocks. Block kinds: paragraph, list, callout, compare. Any
 * course's narrative renders here — no per-course code.
 */
export function NarrativeStage({
  stage,
  onContinue,
}: {
  stage: CourseStage;
  onContinue: () => void;
}) {
  const tCommon = useTranslations("common");
  const blocks = stage.blocks ?? [];

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        {stage.subtitle ? (
          <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">
            {stage.subtitle}
          </p>
        ) : null}
        <h2 className="text-2xl font-bold tracking-tight">{stage.title}</h2>

        <div className="mt-4 space-y-3">
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
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

function Block({ block }: { block: NarrativeBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p className="text-base leading-relaxed">{block.text}</p>;

    case "list":
      return (
        <ol className="space-y-2 list-decimal pl-5 marker:text-[var(--accent)] marker:font-semibold">
          {(block.items ?? []).map((item, i) => (
            <li key={i} className="text-base">
              {item}
            </li>
          ))}
        </ol>
      );

    case "callout":
      return (
        <p className="inline-block rounded-lg bg-[var(--primary)]/10 border border-[var(--accent)]/20 px-4 py-3 font-medium text-[var(--accent)]">
          {block.text}
        </p>
      );

    case "compare":
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          {(block.compare ?? []).map((side, i) => {
            const positive = side.tone === "positive";
            const color = positive ? "var(--success)" : "var(--warning)";
            return (
              <div
                key={i}
                className="rounded-lg border p-4"
                style={{
                  borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
                  background: `color-mix(in srgb, ${color} 5%, transparent)`,
                }}
              >
                <p
                  className="text-xs uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1"
                  style={{ color }}
                >
                  <Quote className="h-3 w-3" />
                  {side.label}
                </p>
                <p className="text-sm leading-relaxed">{side.text}</p>
              </div>
            );
          })}
        </div>
      );

    default:
      return null;
  }
}
