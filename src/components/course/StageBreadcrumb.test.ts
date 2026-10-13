import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
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

/** The step bar with keys of the caller's own (the sectioned preview's lessons). */
function renderOwn<K extends string>(
  props: Parameters<typeof StageBreadcrumb<K>>[0]
): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(StageBreadcrumb<K>, props)
    )
  );
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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

  // Release 1 made the step bar generic for the editor's sectioned preview.
  // The learner player (frozen) uses the defaults: their markup must be
  // byte for byte what it was. Hashes recorded from the Release 0 file.
  it("renders the learner player's step bar exactly as before (default markup pinned)", () => {
    const standard = render({ current: "concept", completed: ["context"] });
    expect(standard).toHaveLength(3958);
    expect(sha256(standard)).toBe(
      "ce467f58548dfa6841c65ce94200d6c6c8ed4d41fc2db21193b4f7705c85baef"
    );
    const own = render({
      current: "reflection",
      completed: ["context"],
      stages: CMS_STAGES,
      allReachable: true,
    });
    expect(own).toHaveLength(2402);
    expect(sha256(own)).toBe(
      "bd8df428777ea72525c12f9098400060f02cff0e5e156d58240736d3970e36be"
    );
  });

  it("takes keys of a course's own and names each step with labelOf", () => {
    const names: Record<string, string> = {
      "s-abcd1234": "Warm-up",
      concept: "The idea",
      scenario: "Try it",
    };
    const got = steps(
      renderOwn({
        current: "concept",
        completed: ["s-abcd1234"],
        stages: ["s-abcd1234", "concept", "scenario"],
        labelOf: (k) => names[k],
        allReachable: true,
      })
    );
    expect(got.map((s) => s.label)).toEqual(["Warm-up", "2The idea", "3Try it"]);
    expect(got.map((s) => s.current)).toEqual([false, true, false]);
    expect(got.every((s) => !s.disabled)).toBe(true);
  });

  it("never looks up a standard name for a key of the course's own", () => {
    // A custom id given to the default namer would print the raw message key.
    const html = renderOwn({
      current: "s-abcd1234",
      completed: [],
      stages: ["s-abcd1234"],
      labelOf: () => "Warm-up",
    });
    expect(html).toContain('<span class="sr-only sm:not-sr-only">Warm-up</span>');
    expect(html).not.toContain("stageLabel");
  });
});
