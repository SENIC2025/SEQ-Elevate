import { describe, it, expect } from "vitest";
import type {
  CourseOutline,
  LessonOutline,
  NarrativeInitial,
} from "@/lib/cms/course-admin-types";
import { mainKindOf, type SectionsMeta, type SectionView } from "@/lib/cms/sections/contract";
import type { StageKey } from "@/lib/cms/types";
import type { StoredStructure } from "@/lib/cms/structure";
import { initWorkspace, workspaceReducer, type WorkspaceState } from "./workspace-reducer";

/* -------------------------------- fixtures -------------------------------- */

const text = (version: string | null, hasOverride = version !== null): NarrativeInitial => ({
  title: `T ${version}`,
  subtitle: "",
  blocks: [{ kind: "paragraph", text: `${version}` }],
  hasOverride,
  version,
});

function lesson(key: string, over: Partial<LessonOutline> = {}): LessonOutline {
  const legacy = key as StageKey;
  return {
    key,
    present: true,
    addable: false,
    body: "narrative",
    mainKind: mainKindOf({ id: legacy, template: legacy }),
    editable: { body: true, media: true },
    byLang: {
      en: { stage: null, narrative: text("v1"), sectioned: null },
      de: { stage: null, narrative: text(null, false), sectioned: null },
      el: { stage: null, narrative: text(null, false), sectioned: null },
    },
    structure: null,
    draft: null,
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: "2026-10-01T10:00:00.000Z",
    section: null,
    parts: null,
    contentVersion: null,
    live: true,
    ...over,
  };
}

const meta = (version: string): SectionsMeta => ({
  version,
  resolved: { sections: [], removed: [], materialised: true },
  reasons: [],
  freeKeys: [],
  hasLabels: false,
  max: 15,
  warnAbove: 12,
});

function outline(lessons: LessonOutline[], over: Partial<CourseOutline> = {}): CourseOutline {
  const coverage = { state: "partial" as const, covered: 1, total: lessons.length };
  return {
    slug: "asking-for-help",
    kind: "cms",
    status: "draft",
    publishedAt: null,
    durationMinutes: 20,
    enrolled: 0,
    lastEdited: null,
    copy: {} as CourseOutline["copy"],
    languages: { en: coverage, de: coverage, el: coverage },
    lessons,
    readiness: [],
    sections: meta("base-1"),
    ...over,
  };
}

/** The view of a lesson in a created course's list (course-admin sectionRow). */
function sectionView(id: SectionView["id"], template: SectionView["template"]): SectionView {
  const name = { text: "N", source: "standard" as const };
  return {
    id,
    template,
    custom: id.startsWith("s-"),
    hidden: false,
    recovered: false,
    label: {},
    labelVersion: { en: null, de: null, el: null },
    name: { en: name, de: name, el: name },
    number: 2,
    deleteSummary: { languages: [], textBlocks: 0, questionBlocks: 0, video: false, documents: 0 },
  };
}

const sim: StoredStructure = {
  kind: "simulation",
  prompt: { en: "P" },
  instruction: {},
  options: [],
};

/** The state after a few editor actions on lessons context and concept. */
function busyState(): { first: CourseOutline; state: WorkspaceState } {
  const first = outline([lesson("context"), lesson("concept"), lesson("behaviour")]);
  let state = initWorkspace(first, "concept");
  state = workspaceReducer(state, { type: "opened", key: "context" });
  state = workspaceReducer(state, { type: "reread", key: "context", lang: "en", stale: "v1" });
  state = workspaceReducer(state, { type: "reread", key: "concept", lang: "de", stale: null });
  return { first, state: { ...state, revs: { "context:en": 2, "concept:de": 1 } } };
}

/* ---------------------------------- tests ---------------------------------- */

describe("initWorkspace", () => {
  it("takes the lessons and the course facts from one outline, and opens the deep link", () => {
    const o = outline([lesson("context")], { enrolled: 3 });
    const state = initWorkspace(o, "context");
    expect(state.lessons).toBe(o.lessons);
    expect(state.sections).toBe(o.sections);
    expect(state.readiness).toBe(o.readiness);
    expect(state.languages).toBe(o.languages);
    expect(state.enrolled).toBe(3);
    expect([...state.open]).toEqual(["context"]);
    expect(state.seen).toBe(o);
  });
});

describe("content actions keep today's behaviour", () => {
  const o = outline([lesson("context"), lesson("simulation", { present: false, addable: true, body: "interactive", editable: { body: true, media: false } })]);

  it("a narrative save replaces that language's start point only", () => {
    const saved = text("v2");
    const next = workspaceReducer(initWorkspace(o), {
      type: "narrativeSaved",
      key: "context",
      lang: "en",
      value: saved,
    });
    expect(next.lessons[0].byLang.en.narrative).toBe(saved);
    expect(next.lessons[0].byLang.de).toBe(o.lessons[0].byLang.de);
    expect(next.lessons[1]).toBe(o.lessons[1]);
  });

  it("a structure save makes the lesson present and gives it media; a clear undoes it", () => {
    const saved = workspaceReducer(initWorkspace(o), {
      type: "structureSaved",
      key: "simulation",
      structure: sim,
    });
    expect(saved.lessons[1]).toMatchObject({
      structure: sim,
      draft: null,
      present: true,
      addable: false,
      editable: { body: true, media: true },
    });
    const cleared = workspaceReducer(saved, { type: "structureCleared", key: "simulation" });
    expect(cleared.lessons[1]).toMatchObject({
      structure: null,
      present: false,
      addable: true,
      editable: { body: true, media: false },
    });
  });

  /*
   * A lesson of a created course's list (it has a `section`) stays a lesson
   * when its exercise is removed or saved: the server lists it whatever its
   * content, with its video and documents (course-admin sectionRow). Only a
   * slot outside the list flips between "Add …" and a lesson, as before.
   */
  it("a lesson of the list stays a lesson, with media, when its exercise is removed", () => {
    const listed = lesson("s-abcdefgh", {
      body: "interactive",
      mainKind: "simulation",
      structure: sim,
      section: sectionView("s-abcdefgh", "practice"),
      contentVersion: "c1",
    });
    let state = initWorkspace(outline([lesson("context"), listed]));
    state = workspaceReducer(state, { type: "structureCleared", key: "s-abcdefgh" });
    expect(state.lessons[1]).toMatchObject({
      structure: null,
      draft: null,
      present: true,
      addable: false,
      editable: { body: true, media: true },
    });
    state = workspaceReducer(state, { type: "structureSaved", key: "s-abcdefgh", structure: sim });
    expect(state.lessons[1]).toMatchObject({
      structure: sim,
      present: true,
      addable: false,
      editable: { body: true, media: true },
    });
  });

  it("opens and closes lessons", () => {
    let state = initWorkspace(o);
    state = workspaceReducer(state, { type: "opened", key: "context" });
    state = workspaceReducer(state, { type: "opened", key: "simulation" });
    state = workspaceReducer(state, { type: "closed", key: "context" });
    expect([...state.open]).toEqual(["simulation"]);
  });
});

describe("a refreshed page (the server-rendered outline)", () => {
  it("is taken once: the same outline again changes nothing", () => {
    const { first, state } = busyState();
    expect(workspaceReducer(state, { type: "outline", outline: first })).toBe(state);
  });

  it("with the same lesson list, patches the lessons in place and never adds one (D39)", () => {
    const { state } = busyState();
    const refreshed = outline(
      [
        lesson("context", {
          byLang: {
            en: { stage: null, narrative: text("v9"), sectioned: null },
            de: { stage: null, narrative: text(null, false), sectioned: null },
            el: { stage: null, narrative: text(null, false), sectioned: null },
          },
          updatedAt: "2026-10-02T10:00:00.000Z",
        }),
        lesson("concept"),
        lesson("behaviour"),
        lesson("reflection"),
      ],
      { enrolled: 4, readiness: [{ level: "info", code: "no-interactive" }] }
    );
    const next = workspaceReducer(state, { type: "outline", outline: refreshed });
    expect(next.lessons.map((l) => l.key)).toEqual(["context", "concept", "behaviour"]);
    // The pending re-read of context in English is answered: a newer text.
    expect(next.lessons[0].byLang.en.narrative?.version).toBe("v9");
    expect(next.revs["context:en"]).toBe(3);
    expect(next.pending).toEqual({ "concept:de": null });
    expect(next.lessons[0].updatedAt).toBe("2026-10-02T10:00:00.000Z");
    // The course facts come with it, as the header always read them.
    expect(next.enrolled).toBe(4);
    expect(next.readiness).toBe(refreshed.readiness);
    expect(next.seen).toBe(refreshed);
  });

  it("keeps a text an editor saved when the refresh raced the save", () => {
    const first = outline([lesson("context")]);
    let state = initWorkspace(first);
    const saved = text("v2");
    state = workspaceReducer(state, { type: "narrativeSaved", key: "context", lang: "en", value: saved });
    const raced = outline([lesson("context")]); // still v1
    const next = workspaceReducer(state, { type: "outline", outline: raced });
    expect(next.lessons[0].byLang.en.narrative).toBe(saved);
  });

  it("with the same lesson list, takes the server's view of whether a listed lesson is one", () => {
    // A standard exercise in a stored lesson list: listed whatever its content.
    const section = sectionView("simulation", "simulation");
    const listed = (over: Partial<LessonOutline> = {}) =>
      lesson("simulation", { body: "interactive", mainKind: "simulation", section, ...over });
    const first = outline([lesson("context"), listed({ structure: sim })]);
    // A row the page wrongly holds as an "Add …" slot (as Release 0's clear
    // left it): the refresh with the same list puts it right.
    const state: WorkspaceState = {
      ...initWorkspace(first),
      lessons: [
        first.lessons[0],
        listed({ present: false, addable: true, editable: { body: true, media: false } }),
      ],
    };
    const refreshed = outline([lesson("context"), listed()]);
    const next = workspaceReducer(state, { type: "outline", outline: refreshed });
    expect(next.lessons[1]).toMatchObject({
      present: true,
      addable: false,
      editable: { body: true, media: true },
    });
  });

  it("with the same lesson list, leaves a slot outside the list as the page has it", () => {
    const slot = () => lesson("simulation", { body: "interactive", mainKind: "simulation" });
    const first = outline([lesson("context"), slot()]);
    const state = workspaceReducer(initWorkspace(first), {
      type: "structureCleared",
      key: "simulation",
    });
    // A refresh that raced the removal still says present: the page's view stays.
    const raced = outline([lesson("context"), slot()]);
    const next = workspaceReducer(state, { type: "outline", outline: raced });
    expect(next.lessons[1]).toMatchObject({ present: false, addable: true });
  });

  it("with a colleague's new lesson list, shows the new rows with their new base", () => {
    const { state } = busyState();
    const theirs = outline(
      [lesson("context"), lesson("s-abcdefgh"), lesson("concept")],
      { sections: meta("base-2") }
    );
    const next = workspaceReducer(state, { type: "outline", outline: theirs });
    expect(next.lessons.map((l) => l.key)).toEqual(["context", "s-abcdefgh", "concept"]);
    expect(next.sections?.version).toBe("base-2");
    expect(next.seen).toBe(theirs);
    // behaviour is gone: nothing of it is kept.
    expect([...next.open]).toEqual(["concept", "context"]);
    expect(Object.keys(next.revs).sort()).toEqual(["concept:de", "context:en"]);
  });
});

describe("outlineReplaced (a structural action's result)", () => {
  it("replaces the lessons and course facts, and prunes revs, pending and open", () => {
    const { first, state } = busyState();
    const after = outline([lesson("concept"), lesson("behaviour"), lesson("s-abcdefgh")], {
      sections: meta("base-2"),
      readiness: [{ level: "blocker", code: "needs-release-2", reason: { code: "custom-section", sectionId: "s-abcdefgh" } }],
    });
    const next = workspaceReducer(state, { type: "outlineReplaced", outline: after });
    expect(next.lessons.map((l) => l.key)).toEqual(["concept", "behaviour", "s-abcdefgh"]);
    expect(next.lessons[2]).toBe(after.lessons[2]);
    expect(next.sections).toBe(after.sections);
    expect(next.readiness).toBe(after.readiness);
    expect(next.revs).toEqual({ "concept:de": 1 });
    expect(next.pending).toEqual({ "concept:de": null });
    expect([...next.open]).toEqual(["concept"]);
    // `seen` follows only the server-rendered outline.
    expect(next.seen).toBe(first);
  });

  it("ignores the stale server-rendered outline afterwards", () => {
    const { first, state } = busyState();
    const after = outline([lesson("concept"), lesson("s-abcdefgh")], { sections: meta("base-2") });
    const replaced = workspaceReducer(state, { type: "outlineReplaced", outline: after });
    // CourseWorkspace re-dispatches its (unchanged) prop on every render.
    expect(workspaceReducer(replaced, { type: "outline", outline: first })).toBe(replaced);
  });

  it("answers a waiting re-read, like a refresh does", () => {
    const { state } = busyState();
    const after = outline([
      lesson("context", {
        byLang: {
          en: { stage: null, narrative: text("v7"), sectioned: null },
          de: { stage: null, narrative: text(null, false), sectioned: null },
          el: { stage: null, narrative: text(null, false), sectioned: null },
        },
      }),
    ], { sections: meta("base-2") });
    const next = workspaceReducer(state, { type: "outlineReplaced", outline: after });
    expect(next.lessons[0].byLang.en.narrative?.version).toBe("v7");
    expect(next.revs).toEqual({ "context:en": 3 });
    expect(next.pending).toEqual({});
  });

  it("takes the server's structure, draft and media for a lesson it keeps", () => {
    const first = outline([lesson("context"), lesson("scenario", { body: "interactive" })]);
    const state = initWorkspace(first);
    const after = outline(
      [lesson("context"), lesson("scenario", { body: "interactive", draft: sim })],
      { sections: meta("base-2") }
    );
    const next = workspaceReducer(state, { type: "outlineReplaced", outline: after });
    expect(next.lessons[1].draft).toEqual(after.lessons[1].draft);
  });
});

describe("the course's status", () => {
  it("starts from the outline and follows the page's own change", () => {
    const state = initWorkspace(outline([lesson("context")]));
    expect(state.status).toBe("draft");
    expect(workspaceReducer(state, { type: "statusChanged", status: "published" }).status).toBe(
      "published"
    );
  });

  it("follows a refreshed page, so a course a colleague published is predicted as live", () => {
    // The stale-page case: opened as a draft, published elsewhere since.
    const first = outline([lesson("context")]);
    const state = initWorkspace(first);
    const published = outline([lesson("context")], { status: "published" });
    expect(workspaceReducer(state, { type: "outline", outline: published }).status).toBe(
      "published"
    );
    const replaced = workspaceReducer(state, { type: "outlineReplaced", outline: published });
    expect(replaced.status).toBe("published");
  });
});

describe("renamed (a step name saved in one language)", () => {
  const listed = () =>
    lesson("concept", { section: sectionView("concept", "concept") });

  it("takes the new name, its base and the name it goes by, in that language only", () => {
    const state = initWorkspace(outline([listed()]));
    const next = workspaceReducer(state, {
      type: "renamed",
      key: "concept",
      lang: "de",
      label: "Die Idee",
      version: "lv-2",
      name: { text: "Die Idee", source: "own" },
    });
    const section = next.lessons[0].section!;
    expect(section.label).toEqual({ de: "Die Idee" });
    expect(section.labelVersion).toEqual({ en: null, de: "lv-2", el: null });
    expect(section.name.de).toEqual({ text: "Die Idee", source: "own" });
    expect(section.name.en).toEqual(state.lessons[0].section!.name.en);
  });

  it("removes the language's name when it was cleared", () => {
    const named = lesson("concept", {
      section: { ...sectionView("concept", "concept"), label: { en: "Mine", de: "Meins" } },
    });
    const state = initWorkspace(outline([named]));
    const next = workspaceReducer(state, {
      type: "renamed",
      key: "concept",
      lang: "en",
      label: "",
      version: null,
      name: { text: "Skill concept", source: "standard" },
    });
    expect(next.lessons[0].section!.label).toEqual({ de: "Meins" });
    expect(next.lessons[0].section!.name.en.text).toBe("Skill concept");
  });

  it("leaves a lesson outside the list alone", () => {
    const state = initWorkspace(outline([lesson("context")]));
    const next = workspaceReducer(state, {
      type: "renamed",
      key: "context",
      lang: "en",
      label: "X",
      version: "v",
      name: { text: "X", source: "own" },
    });
    expect(next.lessons[0]).toBe(state.lessons[0]);
  });
});
