import { RichTextView } from "@/components/rich-text/RichTextView";
import type { CourseStage } from "@/lib/cms/types";
import { cn } from "@/lib/utils";
import { useContentLang } from "./CourseText";

/**
 * The look of a reflection lesson's introduction. Exported so the course
 * page's read view shows it as learners see it; the reflection editor
 * (RichTextEditor's "reflection-intro" variant) uses the same classes.
 */
export const REFLECTION_INTRO_CLASS = "text-sm text-[var(--muted-foreground)]";

/**
 * A reflection lesson's introduction, as learners see it: with its author's
 * bold, italic, lists and indents when it has them (D36), otherwise the
 * plain text with the line breaks and "•" or "1." lines typed — exactly as
 * before rich text (ReflectionIntro.test.ts). `className` adds the spacing
 * around it. Renders nothing when there is no text. Course text: it carries
 * the course's language when that isn't the page's (ContentLangContext).
 */
export function ReflectionIntro({
  reflection,
  className,
}: {
  reflection: Pick<NonNullable<CourseStage["reflection"]>, "intro" | "introRich">;
  className?: string;
}) {
  const lang = useContentLang();
  return (
    <RichTextView
      rich={reflection.introRich}
      text={reflection.intro}
      className={cn(className, REFLECTION_INTRO_CLASS)}
      lang={lang}
    />
  );
}
