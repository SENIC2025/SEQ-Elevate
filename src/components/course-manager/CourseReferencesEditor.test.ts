import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

/*
 * Release 4 spec 5.5 (U19, D109): the references editor on a created
 * course's page. It reports unsaved changes to the page's registry, bound
 * to the language (so a language switch, closing or leaving asks first);
 * marks its text box with the language being written; and handles a save's
 * answers: saved (live), refused by name, or "changed-elsewhere" with
 * "Load their version" (D39), never losing what was typed.
 */

const dirtyCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("./dirty-registry", () => ({
  useDirty: (...args: unknown[]) => {
    dirtyCalls.push(args);
    return () => {};
  },
}));
vi.mock("@/app/actions/course-references", () => ({
  loadCourseReferencesForEditor: vi.fn(() => new Promise(() => {})),
  saveCourseReferences: vi.fn(),
}));
vi.mock("@/components/rich-text/LazyRichTextEditor", () => ({ LazyRichTextEditor: () => null }));

const {
  CourseReferencesEditor,
  INITIAL_REFERENCES_STATE,
  isDirty,
  referencesReducer,
  storedFor,
  watchContentLang,
} = await import("./CourseReferencesEditor");
const { VARIANT } = await import("@/components/rich-text/RichTextEditor");
const { renderIn, textOf } = await import("@/components/course/sectioned/render.test-helpers");

type State = Parameters<typeof referencesReducer>[0];
type Event = Parameters<typeof referencesReducer>[1];
const run = (...events: Event[]): State => events.reduce(referencesReducer, INITIAL_REFERENCES_STATE);

const RICH = { v: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Author (2020)." }] }] } };
const STORED = { text: "Author (2020).", rich: RICH, base: "b1" };
const EDIT: Event = { type: "edited", rich: { v: 1, doc: { type: "doc", content: [] } }, text: "Author (2021)." };

beforeEach(() => {
  dirtyCalls.length = 0;
});

describe("CourseReferencesEditor", () => {
  it("registers with the page's unsaved-changes registry, by its heading, bound to the language", () => {
    renderIn(createElement(CourseReferencesEditor, { slug: "my-course", lang: "de" }));
    expect(dirtyCalls).toEqual([["references", en.courseReading.references.heading, true]]);
    renderIn(createElement(CourseReferencesEditor, { slug: "my-course", lang: "en" }), "de");
    expect(dirtyCalls[1]).toEqual(["references", de.courseReading.references.heading, true]);
  });

  it("is a region named by its heading, with the hint and the language note, loading its list", () => {
    const html = renderIn(createElement(CourseReferencesEditor, { slug: "my-course", lang: "de" }));
    const heading = html.match(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/);
    expect(heading?.[2]).toBe(en.courseReading.references.heading.replace("&", "&amp;"));
    expect(html).toContain(`<section aria-labelledby="${heading?.[1]}"`);
    // The language it is written in, named in the menu language.
    expect(textOf(html)).toContain(en.courseManager.languageName.de);
    expect(textOf(html)).toContain(en.courseReading.references.hint);
    expect(textOf(html)).toContain(en.courseReading.references.languageNote);
    expect(html).toContain(`aria-busy="true"`);
    expect(textOf(html)).toContain(en.system.loading);
    // Nothing to save until something is typed.
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>.*?${en.courseReading.references.save}</button>`));
  });

  it("speaks the page's language", () => {
    const html = renderIn(createElement(CourseReferencesEditor, { slug: "my-course", lang: "en" }), "de");
    expect(textOf(html)).toContain(de.courseReading.references.hint);
    expect(textOf(html)).toContain(de.courseManager.languageName.en);
  });

  it("styles its text box as learners see the list (the editor's references variant)", () => {
    expect(VARIANT.references.prose).toBe("seq-references");
  });
});

describe("watchContentLang", () => {
  /** A container whose boxes are found as markContentLang finds them. */
  function fakeRoot() {
    const boxes: { lang: string | null; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void }[] = [];
    const add = () => {
      const box = {
        lang: null as string | null,
        getAttribute: (n: string) => (n === "lang" ? box.lang : null),
        setAttribute: (n: string, v: string) => {
          if (n === "lang") box.lang = v;
        },
      };
      boxes.push(box);
    };
    const root = { querySelectorAll: () => boxes } as unknown as HTMLElement;
    return { root, boxes, add };
  }

  it("marks the text box with the language being written, now and whenever the editor draws it anew", () => {
    const observers: { cb: () => void; observing: unknown[]; disconnected: boolean }[] = [];
    vi.stubGlobal(
      "MutationObserver",
      class {
        o: (typeof observers)[number];
        constructor(cb: () => void) {
          this.o = { cb, observing: [], disconnected: false };
          observers.push(this.o);
        }
        observe(target: unknown, opts: unknown) {
          this.o.observing.push([target, opts]);
        }
        disconnect() {
          this.o.disconnected = true;
        }
      }
    );
    const { root, boxes, add } = fakeRoot();
    add();
    const stop = watchContentLang(root, "de");
    expect(boxes.map((b) => b.lang)).toEqual(["de"]);
    expect(observers[0].observing).toEqual([[root, { childList: true, subtree: true }]]);
    // The editor loads lazily, and opens afresh after Discard or a reload.
    add();
    observers[0].cb();
    expect(boxes.map((b) => b.lang)).toEqual(["de", "de"]);
    stop();
    expect(observers[0].disconnected).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("the references editor's steps", () => {
  it("opens on the language's stored list, or on nothing", () => {
    const loaded = { locales: { en: { text: "Author (2020).", rich: RICH, base: "b1" } } };
    expect(storedFor(loaded, "en")).toEqual(STORED);
    expect(storedFor(loaded, "de")).toEqual({ text: "", base: null });
    const s = run({ type: "loaded", stored: STORED, reload: false });
    expect(s).toMatchObject({ stored: STORED, rev: 1, draft: null, status: "idle" });
    expect(isDirty(s)).toBe(false);
  });

  it("counts what is typed as unsaved until a save carries it", () => {
    const typed = run({ type: "loaded", stored: STORED, reload: false }, EDIT);
    expect(isDirty(typed)).toBe(true);
    const saving = referencesReducer(typed, { type: "saving" });
    // Typed while saving: still unsaved once the save is in.
    const more = referencesReducer(saving, EDIT);
    expect(more.status).toBe("saving");
    const saved = referencesReducer(more, {
      type: "answered",
      at: typed.edits,
      result: { ok: true, base: "b2", saved: { text: "Author (2021).", rich: RICH as never } },
    });
    expect(saved.status).toBe("saved");
    expect(saved.stored).toEqual({ text: "Author (2021).", rich: RICH, base: "b2" });
    expect(isDirty(saved)).toBe(true);
    const all = referencesReducer(saved, { type: "answered", at: saved.edits, result: { ok: true, base: null, saved: null } });
    expect(isDirty(all)).toBe(false);
    expect(all.stored).toEqual({ text: "", base: null });
  });

  it("keeps the edits when a colleague saved first, until their version is loaded", () => {
    const typed = run({ type: "loaded", stored: STORED, reload: false }, EDIT, { type: "saving" });
    const refused = referencesReducer(typed, { type: "answered", at: typed.edits, result: { ok: false, error: "changed-elsewhere" } });
    expect(refused).toMatchObject({ conflict: true, status: "idle", stored: STORED });
    expect(refused.draft).toEqual({ rich: (EDIT as { rich: unknown }).rich, text: "Author (2021)." });
    expect(isDirty(refused)).toBe(true);
    const theirs = { text: "Theirs (2020).", base: "b9" };
    const reloaded = run(
      { type: "loaded", stored: STORED, reload: false },
      EDIT,
      { type: "answered", at: 1, result: { ok: false, error: "changed-elsewhere" } },
      { type: "reloading" },
      { type: "loaded", stored: theirs, reload: true }
    );
    expect(reloaded).toMatchObject({ conflict: false, status: "reloaded", stored: theirs, draft: null, rev: 2 });
    expect(isDirty(reloaded)).toBe(false);
  });

  it("lists the server's refusals, and says why anything else failed", () => {
    const typed = run({ type: "loaded", stored: STORED, reload: false }, EDIT, { type: "saving" });
    const issues = ["The references list is too long — at most 10,000 characters. Split it into two blocks."];
    expect(referencesReducer(typed, { type: "answered", at: 1, result: { ok: false, error: "invalid", issues } })).toMatchObject({
      issues,
      status: "error",
      problem: "invalid",
    });
    for (const [error, problem] of [
      ["forbidden", "forbidden"],
      ["not-found", "not-found"],
      ["built-in", "generic"],
      ["bad-input", "generic"],
    ] as const) {
      const s = referencesReducer(typed, { type: "answered", at: 1, result: { ok: false, error } });
      expect(s, error).toMatchObject({ status: "error", problem, issues: [] });
      expect(isDirty(s)).toBe(true);
    }
    expect(referencesReducer(typed, { type: "failed" })).toMatchObject({ status: "error", problem: "generic" });
    // A new save clears the last refusal.
    const again = referencesReducer(
      referencesReducer(typed, { type: "answered", at: 1, result: { ok: false, error: "invalid", issues } }),
      { type: "saving" }
    );
    expect(again).toMatchObject({ issues: [], problem: null });
  });

  it("discards what was typed by opening the stored list afresh", () => {
    const s = run({ type: "loaded", stored: STORED, reload: false }, EDIT, { type: "discarded" });
    expect(s).toMatchObject({ draft: null, rev: 2, status: "discarded", stored: STORED });
    expect(isDirty(s)).toBe(false);
  });

  it("offers to try again when the list can't be read, and keeps the screen when a reload can't", () => {
    expect(run({ type: "loadFailed" })).toMatchObject({ loadFailed: true, stored: null });
    expect(run({ type: "loadFailed" }, { type: "loading" })).toMatchObject({ loadFailed: false });
    const kept = run({ type: "loaded", stored: STORED, reload: false }, EDIT, { type: "reloading" }, { type: "loadFailed" });
    expect(kept).toMatchObject({ stored: STORED, status: "error", problem: "load", loadFailed: false });
    expect(isDirty(kept)).toBe(true);
  });
});
