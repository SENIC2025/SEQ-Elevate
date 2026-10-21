import { RichTextView } from "@/components/rich-text/RichTextView";
import { useContentLang } from "./CourseText";

/**
 * Authored plain text, shown with the structure the author typed: paragraphs
 * keep their line breaks, and "•", "-" or "1." lines become real lists (see
 * parseLegacyText). Spacing and list markers come from the shared .seq-prose
 * styles; size, colour and line height from `className`. `compact` tightens
 * the spacing for small containers such as callouts.
 *
 * Rendered by the same renderer as rich lesson text (RichTextView, D36), so
 * plain and formatted text look alike — and exactly as they did before rich
 * text existed (legacy-parity.test.ts). Text is only ever rendered as React
 * text nodes — never as HTML. Renders nothing for empty text.
 *
 * It is course text, so it carries the course's language when that isn't
 * the page's (ContentLangContext, Release 3).
 */
export function FormattedText({
  text,
  className,
  compact = false,
}: {
  text: string | undefined;
  className?: string;
  compact?: boolean;
}) {
  const lang = useContentLang();
  return <RichTextView text={text} className={className} compact={compact} lang={lang} />;
}
