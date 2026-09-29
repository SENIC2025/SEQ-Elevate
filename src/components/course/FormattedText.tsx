import { Fragment } from "react";
import { parseLegacyText } from "@/lib/rich-text/legacy";
import { cn } from "@/lib/utils";

/**
 * Authored plain text, shown with the structure the author typed: paragraphs
 * keep their line breaks, and "•", "-" or "1." lines become real lists (see
 * parseLegacyText). Spacing and list markers come from the shared .seq-prose
 * styles; size, colour and line height from `className`. `compact` tightens
 * the spacing for small containers such as callouts.
 *
 * Text is only ever rendered as React text nodes — never as HTML. Pure, so
 * server and client render the same markup. Renders nothing for empty text.
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
  const nodes = parseLegacyText(text ?? "");
  if (nodes.length === 0) return null;

  return (
    <div className={cn("seq-prose", compact && "seq-prose-compact", className)}>
      {nodes.map((node, i) => {
        if (node.type === "bullets") {
          return (
            <ul key={i}>
              {node.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        if (node.type === "numbers") {
          return (
            <ol key={i} start={node.start}>
              {node.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {node.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
