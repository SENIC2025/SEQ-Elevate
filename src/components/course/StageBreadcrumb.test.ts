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

/**
 * UA4 (Q4, spec 5.6): the bar reaches up to the first lesson not done, no
 * further — Release 1 let any done step be opened, so a lesson done before
 * an editor moved it past the frontier let the learner skip ahead — and a
 * done step says so in words.
 */
describe("StageBreadcrumb in order (Release 2)", () => {
  const ids = ["s-abcd1234", "concept", "scenario", "s-efgh5678"];
  const names: Record<string, string> = {
    "s-abcd1234": "Warm-up",
    concept: "The idea",
    scenario: "Try it",
    "s-efgh5678": "Wrap-up",
  };
  const bar = (o: Partial<Parameters<typeof StageBreadcrumb<string>>[0]>) =>
    steps(
      renderOwn<string>({
        current: "concept",
        completed: [],
        stages: ids,
        labelOf: (k) => names[k],
        ...o,
      })
    );

  it("reaches up to the frontier and the current step, never a done step beyond it", () => {
    // "Wrap-up" was done, then an editor moved it after a lesson not done.
    const got = bar({ current: "concept", completed: ["s-abcd1234", "s-efgh5678"], frontier: 1 });
    expect(got.map((s) => s.disabled)).toEqual([false, false, true, true]);
    expect(got[3].label).toBe("Wrap-up");
  });

  it("reaches the frontier from a lesson before it (Back keeps the way forward open)", () => {
    const got = bar({ current: "s-abcd1234", completed: ["s-abcd1234", "concept"], frontier: 2 });
    expect(got.map((s) => s.disabled)).toEqual([false, false, false, true]);
  });

  it("keeps the current step reachable even past the frontier", () => {
    const got = bar({ current: "s-efgh5678", completed: [], frontier: 0 });
    expect(got.map((s) => s.disabled)).toEqual([false, true, true, false]);
  });

  it("lets a preview reach every step whatever the frontier", () => {
    expect(bar({ frontier: 0, allReachable: true }).every((s) => !s.disabled)).toBe(true);
  });

  it("says a done step is done, in its name (the eye sees a tick, and the name on wider screens)", () => {
    const html = renderOwn<string>({
      current: "concept",
      completed: ["s-abcd1234"],
      stages: ids,
      labelOf: (k) => names[k],
      frontier: 1,
      doneLabel: ", done",
    });
    expect(html).toContain(
      '<span aria-hidden="true" class="hidden sm:inline">Warm-up</span><span class="sr-only">Warm-up, done</span></button>'
    );
    // Steps not done keep their markup.
    expect(html).toContain('<span class="sr-only sm:not-sr-only">The idea</span>');
  });

  // Review finding 6 on Stream A (WCAG 3.1.2): on a Greek page, a step
  // named only in English was read with Greek speech.
  it("marks a step name written in another language than the page's with its lang", () => {
    const html = renderOwn<string>({
      current: "concept",
      completed: ["s-abcd1234"],
      stages: ids,
      labelOf: (k) => names[k],
      langOf: (k) => (k === "concept" || k === "s-abcd1234" ? "en" : undefined),
      frontier: 1,
      doneLabel: ", ολοκληρώθηκε",
    });
    // Done: the shown name and the read one, the suffix in the page's language.
    expect(html).toContain(
      '<span aria-hidden="true" class="hidden sm:inline" lang="en">Warm-up</span><span class="sr-only"><span lang="en">Warm-up</span>, ολοκληρώθηκε</span></button>'
    );
    expect(html).toContain('<span class="sr-only sm:not-sr-only" lang="en">The idea</span>');
    // In the page's language: no lang, the markup as before.
    expect(html).toContain('<span class="sr-only sm:not-sr-only">Try it</span>');
  });

  it("without the new props, a done step stays reachable as before", () => {
    const got = bar({ current: "concept", completed: ["s-abcd1234", "s-efgh5678"] });
    expect(got.map((s) => s.disabled)).toEqual([false, false, true, false]);
  });
});
