import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import { StageBreadcrumb } from "./StageBreadcrumb";
import type { Stage } from "@/data/course";

// Typed so the child can be passed as createElement's third argument.
const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  children?: ReactNode;
}>;

function render(
  props: Parameters<typeof StageBreadcrumb>[0],
  locale: "en" | "de" = "en"
): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: locale === "en" ? en : de },
      createElement(StageBreadcrumb, props)
    )
  );
}

/** Each step button: its label, and whether it can be pressed. */
function steps(html: string) {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    label: m[2].replace(/<[^>]+>/g, ""),
    disabled: / disabled=""/.test(m[1]),
    current: /aria-current="step"/.test(m[1]),
  }));
}

const CMS_STAGES: Stage[] = ["context", "concept", "behaviour", "reflection"];

describe("StageBreadcrumb", () => {
  it("shows all seven steps by default, later ones locked", () => {
    const got = steps(render({ current: "concept", completed: ["context"] }));
    expect(got.map((s) => s.label)).toEqual([
      "Context",
      "2Skill concept",
      "3Behaviour model",
      "4Guided practice",
      "5Applied scenario",
      "6Reflection",
      "7Quick check",
    ]);
    expect(got.map((s) => s.disabled)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(got[1].current).toBe(true);
  });

  it("lists only the course's own steps, numbered 1..n", () => {
    const got = steps(
      render({ current: "reflection", completed: [], stages: CMS_STAGES })
    );
    expect(got.map((s) => s.label)).toEqual([
      "1Context",
      "2Skill concept",
      "3Behaviour model",
      "4Reflection",
    ]);
    expect(got[3].current).toBe(true);
  });

  it("lets a preview jump to any step, ahead included", () => {
    const got = steps(
      render({
        current: "context",
        completed: [],
        stages: CMS_STAGES,
        allReachable: true,
      })
    );
    expect(got.every((s) => !s.disabled)).toBe(true);
  });

  // On a phone the step names don't show; they must still name the
  // buttons, or a finished step (a tick) is announced as just "button".
  it("keeps each step's name for screen readers when it doesn't show", () => {
    const html = render({ current: "concept", completed: ["context"] });
    expect(html).not.toMatch(/class="hidden sm:inline"/);
    expect(html).toContain('<span class="sr-only sm:not-sr-only">Context</span>');
  });

  it("names the steps in the page's language", () => {
    expect(render({ current: "context", completed: [] }, "de")).toContain(
      'aria-label="Kursschritte"'
    );
  });

  // White on the lime was 1.5:1; the step's own text colour reads on it.
  it("shows the current step's number in the step's own text colour", () => {
    const html = render({ current: "concept", completed: ["context"] });
    const current = html.match(/<button[^>]*aria-current="step"[^>]*>(.*?)<\/button>/)?.[1];
    expect(current).toBeTruthy();
    expect(current).not.toContain("text-white");
    expect(current).toContain("text-[var(--primary-foreground)]");
  });
});
