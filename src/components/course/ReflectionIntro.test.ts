import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CourseStage } from "@/lib/cms/types";
import { FormattedText } from "./FormattedText";
import { ReflectionIntro } from "./ReflectionIntro";

type Reflection = NonNullable<CourseStage["reflection"]>;

// As ReflectionStage renders it for learners, and the course page's read
// view (without the spacing).
function render(
  reflection: Pick<Reflection, "intro" | "introRich">,
  className = "mt-2"
): string {
  return renderToStaticMarkup(
    createElement(ReflectionIntro, { reflection, className })
  );
}

const rich = (
  ...content: NonNullable<Reflection["introRich"]>["doc"]["content"]
): Reflection["introRich"] => ({ v: 1, doc: { type: "doc", content } });

describe("ReflectionIntro", () => {
  it("renders a plain intro exactly as learners saw it before rich text", () => {
    // What ReflectionStage rendered until now, for the texts a reflection
    // intro holds: the defaults, and an author's paragraph with lists.
    const before = (text: string) =>
      renderToStaticMarkup(
        createElement(FormattedText, {
          text,
          className: "mt-2 text-sm text-[var(--muted-foreground)]",
        })
      );
    for (const intro of [
      "Take a moment to reflect on what you just practised.",
      "Nimm dir einen Moment Zeit.\nWas hat dich überrascht?",
      "Before you answer:\n• Pause\n• Notice\n\n3. Check\n4. Decide",
      "",
    ]) {
      expect(render({ intro })).toBe(before(intro));
    }
    expect(render({ intro: "One\n• a\n• b" })).toBe(
      '<div class="seq-prose mt-2 text-sm text-[var(--muted-foreground)]"><p>One</p><ul><li>a</li><li>b</li></ul></div>'
    );
  });

  it("renders the author's formatting when the intro has it", () => {
    const html = render({
      intro: "Take a moment.\n\n• What surprised you?",
      introRich: rich(
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Take a " },
            { type: "text", text: "moment", marks: [{ type: "bold" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "What surprised you?" }],
                },
              ],
            },
          ],
        }
      ),
    });
    expect(html).toBe(
      '<div class="seq-prose whitespace-break-spaces mt-2 text-sm text-[var(--muted-foreground)]"><p>Take a <strong>moment</strong>.</p><ul><li>What surprised you?</li></ul></div>'
    );
  });

  it("shows the plain text when the rich text doesn't pass the check", () => {
    const unusable = [
      { v: 2, doc: { type: "doc", content: [] } },
      { v: 1, doc: { type: "doc", content: "<script>" } },
    ] as unknown as Reflection["introRich"][];
    for (const introRich of unusable) {
      expect(render({ intro: "Plain intro.", introRich })).toBe(
        '<div class="seq-prose mt-2 text-sm text-[var(--muted-foreground)]"><p>Plain intro.</p></div>'
      );
    }
  });

  it("uses the learner's classes in the read view too, and renders nothing when empty", () => {
    expect(render({ intro: "Hi" }, "")).toBe(
      '<div class="seq-prose text-sm text-[var(--muted-foreground)]"><p>Hi</p></div>'
    );
    expect(render({ intro: " \n " })).toBe("");
  });
});
