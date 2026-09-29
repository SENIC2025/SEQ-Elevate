"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CourseStage, NarrativeBlock } from "@/lib/cms/types";
import { ArrowRight, Quote } from "lucide-react";
import { RichTextView } from "@/components/rich-text/RichTextView";
import { FormattedText } from "./FormattedText";

/**
 * Renders a narrative stage (context / concept / behaviour) from authored
 * content blocks. Block kinds: paragraph, list, callout, compare. Any
 * course's narrative renders here — no per-course code. Paragraphs and key
 * messages show the author's bold, italic, lists and indents (RichTextView,
 * D36); older plain text keeps the line breaks and bullet or numbered lines
 * the author typed, as does the text of compare sides (FormattedText).
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

        <NarrativeBlocks blocks={blocks} />

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

/**
 * A lesson's content blocks, exactly as learners see them. Shared with the
 * course page's read view, so editors preview with the learner's renderer.
 */
export function NarrativeBlocks({ blocks }: { blocks: NarrativeBlock[] }) {
  return (
    <div className="mt-4 space-y-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: NarrativeBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <RichTextView
          rich={block.rich}
          text={block.text}
          className="text-base leading-relaxed"
        />
      );

    case "list": {
      const items = (block.items ?? []).map((item, i) => (
        <li key={i} className="text-base">
          {item}
        </li>
      ));
      // Numbered unless the author chose bullets: lists saved before
      // authors could choose have no listStyle, and were always numbered.
      return block.listStyle === "bullet" ? (
        <ul className="space-y-2 list-disc pl-5 marker:text-[var(--accent)]">
          {items}
        </ul>
      ) : (
        <ol className="space-y-2 list-decimal pl-5 marker:text-[var(--accent)] marker:font-semibold">
          {items}
        </ol>
      );
    }

    case "callout":
      return (
        <RichTextView
          rich={block.rich}
          text={block.text}
          compact
          className="inline-block rounded-lg bg-[var(--primary)]/10 border border-[var(--accent)]/20 px-4 py-3 font-medium text-[var(--accent)]"
        />
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
                <FormattedText
                  text={side.text}
                  className="text-sm leading-relaxed"
                />
              </div>
            );
          })}
        </div>
      );

    default:
      return null;
  }
}
