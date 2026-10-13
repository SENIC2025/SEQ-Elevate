import { describe, it, expect } from "vitest";
import {
  applyPartOp,
  emptyPart,
  hasExtraParts,
  MAIN_PART,
  partsOf,
  prefillParts,
  storedPartsValue,
} from "./section-parts";
import {
  itemVersion,
  partsOrderVersion,
  partVersions,
  sectionContentVersion,
  textPartVersion,
} from "./versions";
import { fingerprint } from "../stored-json";
import { validateExercise } from "./part-kinds";
import { SECTION_LIMITS, type ExtraPartId, type PartDefaults, type StoredPart } from "./contract";

/*
 * Lesson.parts: a lesson's extra content around its main content (D56).
 * The main content stays where Release 0 keeps it; the column only holds a
 * placeholder for where it sits. Null — the only value Release 0 knows — is
 * "main content only", and writing back "main content only" must give null
 * again, so removing the last extra content really makes the lesson
 * standard.
 */

const DEFAULTS: PartDefaults = {
  reflectionPrompts: [
    { id: "p1", label: { en: "What went well?", de: "Was ist gut gelaufen?" } },
    { id: "p2", label: { en: "What was hard?" } },
    { id: "p3", label: { en: "What next?" } },
  ],
  ratingLabels: { min: { en: "Not at all" }, max: { en: "Very much" } },
};

const text = (id: ExtraPartId, en = "Hello"): StoredPart => ({
  id,
  type: "text",
  blocks: { en: [{ kind: "paragraph", text: en }] },
});
const quiz = (id: ExtraPartId): StoredPart => ({
  id,
  type: "quiz",
  data: null,
  draft: { kind: "assessment", intro: {}, questions: [] },
});

describe("partsOf", () => {
  it("reads an empty column as the main content alone", () => {
    expect(partsOf(null)).toEqual([MAIN_PART]);
    expect(partsOf(undefined)).toEqual([MAIN_PART]);
  });

  it("reads stored items in their order", () => {
    const items = [text("p-aaaaaaaa"), MAIN_PART, quiz("p-bbbbbbbb")];
    expect(partsOf({ v: 1, items })).toEqual(items);
  });

  it("calls anything it can't trust unreadable instead of guessing", () => {
    for (const raw of [
      "x",
      42,
      [],
      { v: 2, items: [MAIN_PART] },
      { v: 1 },
      { v: 1, items: {} },
      // No main content, or two.
      { v: 1, items: [] },
      { v: 1, items: [text("p-aaaaaaaa")] },
      { v: 1, items: [MAIN_PART, MAIN_PART] },
      // Bad or repeated ids, unknown types, wrong shapes.
      { v: 1, items: [MAIN_PART, { ...text("p-aaaaaaaa"), id: "p-AAAAAAAA" }] },
      { v: 1, items: [MAIN_PART, text("p-aaaaaaaa"), text("p-aaaaaaaa")] },
      { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "video" }] },
      { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "text", blocks: [] }] },
      { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "text", blocks: { en: "x" } }] },
      { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "quiz", data: null }] },
      { v: 1, items: [MAIN_PART, { id: "p-aaaaaaaa", type: "quiz", data: 3, draft: null }] },
      // A quiz holding a practice question.
      {
        v: 1,
        items: [
          MAIN_PART,
          { id: "p-aaaaaaaa", type: "quiz", data: { kind: "simulation" }, draft: null },
        ],
      },
      { v: 1, items: [MAIN_PART, null] },
      { v: 1, items: [{ id: "main", type: "text", blocks: {} }] },
    ]) {
      expect(partsOf(raw), JSON.stringify(raw)).toBe("unreadable");
    }
  });

  it("shows every stored item, even more than can be added", () => {
    const items: StoredPart[] = [MAIN_PART];
    for (let i = 0; i < 20; i++) items.push(text(`p-${String(i).padStart(8, "0")}`));
    expect(partsOf({ v: 1, items })).toHaveLength(21);
  });

  it("knows when a lesson has content besides its main content", () => {
    expect(hasExtraParts(null)).toBe(false);
    expect(hasExtraParts({ v: 1, items: [MAIN_PART] })).toBe(false);
    expect(hasExtraParts({ v: 1, items: [MAIN_PART, text("p-aaaaaaaa")] })).toBe(true);
    expect(hasExtraParts("garbage")).toBe(false);
  });
});

describe("storedPartsValue", () => {
  it("writes the main content alone back as an empty column", () => {
    expect(storedPartsValue([MAIN_PART])).toBeNull();
  });

  it("writes extra content as a version-1 list", () => {
    const items = [MAIN_PART, text("p-aaaaaaaa")];
    expect(storedPartsValue(items)).toEqual({ v: 1, items });
    expect(partsOf(storedPartsValue(items))).toEqual(items);
  });

  it("brings a lesson back to standard once its extra content is removed", () => {
    const added = applyPartOp([MAIN_PART], { op: "add", part: quiz("p-aaaaaaaa"), after: "main" });
    expect(added.ok && storedPartsValue(added.items)).toEqual({
      v: 1,
      items: [MAIN_PART, quiz("p-aaaaaaaa")],
    });
    const removed = added.ok && applyPartOp(added.items, { op: "remove", id: "p-aaaaaaaa" });
    expect(removed && removed.ok && storedPartsValue(removed.items)).toBeNull();
  });
});

describe("applyPartOp", () => {
  const items = [MAIN_PART, text("p-aaaaaaaa"), quiz("p-bbbbbbbb")];

  it("adds at the top, or after a given part", () => {
    const top = applyPartOp(items, { op: "add", part: text("p-cccccccc"), after: null });
    expect(top.ok && top.items.map((p) => p.id)).toEqual([
      "p-cccccccc",
      "main",
      "p-aaaaaaaa",
      "p-bbbbbbbb",
    ]);
    const after = applyPartOp(items, { op: "add", part: text("p-cccccccc"), after: "p-aaaaaaaa" });
    expect(after.ok && after.items.map((p) => p.id)).toEqual([
      "main",
      "p-aaaaaaaa",
      "p-cccccccc",
      "p-bbbbbbbb",
    ]);
  });

  it("refuses to add after a part that isn't there", () => {
    expect(
      applyPartOp(items, { op: "add", part: text("p-cccccccc"), after: "p-zzzzzzzz" })
    ).toEqual({ ok: false, error: "unknown-part" });
  });

  it("refuses a second main content or an id already used", () => {
    expect(applyPartOp(items, { op: "add", part: MAIN_PART, after: null })).toEqual({
      ok: false,
      error: "unknown-part",
    });
    expect(
      applyPartOp(items, { op: "add", part: text("p-aaaaaaaa"), after: null })
    ).toEqual({ ok: false, error: "unknown-part" });
  });

  it("caps a lesson at 12 items, main content included", () => {
    let list: StoredPart[] = [MAIN_PART];
    for (let i = 1; i < SECTION_LIMITS.maxPartsPerSection; i++) {
      const r = applyPartOp(list, {
        op: "add",
        part: text(`p-${String(i).padStart(8, "0")}`),
        after: null,
      });
      expect(r.ok).toBe(true);
      if (r.ok) list = r.items;
    }
    expect(list).toHaveLength(12);
    expect(
      applyPartOp(list, { op: "add", part: text("p-zzzzzzzz"), after: null })
    ).toEqual({ ok: false, error: "too-many-parts" });
  });

  it("moves any part one place, the main content too", () => {
    const down = applyPartOp(items, { op: "move", id: "main", dir: 1 });
    expect(down.ok && down.items.map((p) => p.id)).toEqual(["p-aaaaaaaa", "main", "p-bbbbbbbb"]);
    const up = applyPartOp(items, { op: "move", id: "p-bbbbbbbb", dir: -1 });
    expect(up.ok && up.items.map((p) => p.id)).toEqual(["main", "p-bbbbbbbb", "p-aaaaaaaa"]);
  });

  it("refuses to move past either end", () => {
    expect(applyPartOp(items, { op: "move", id: "main", dir: -1 })).toEqual({
      ok: false,
      error: "at-edge",
    });
    expect(applyPartOp(items, { op: "move", id: "p-bbbbbbbb", dir: 1 })).toEqual({
      ok: false,
      error: "at-edge",
    });
    expect(applyPartOp(items, { op: "move", id: "p-zzzzzzzz", dir: 1 })).toEqual({
      ok: false,
      error: "unknown-part",
    });
  });

  it("never removes the main content", () => {
    expect(applyPartOp(items, { op: "remove", id: "main" })).toEqual({
      ok: false,
      error: "main-required",
    });
    expect(applyPartOp(items, { op: "remove", id: "p-zzzzzzzz" })).toEqual({
      ok: false,
      error: "unknown-part",
    });
  });

  it("leaves the list it was given as it was", () => {
    const before = JSON.stringify(items);
    applyPartOp(items, { op: "move", id: "main", dir: 1 });
    applyPartOp(items, { op: "remove", id: "p-aaaaaaaa" });
    applyPartOp(items, { op: "add", part: text("p-cccccccc"), after: null });
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("emptyPart", () => {
  it("starts text with no language written", () => {
    expect(emptyPart("text", "p-aaaaaaaa", DEFAULTS)).toEqual({
      id: "p-aaaaaaaa",
      type: "text",
      blocks: {},
    });
  });

  it("starts a question as a draft, so learners get nothing until it is saved", () => {
    for (const type of ["practice", "scenario", "quiz", "reflection", "rating"] as const) {
      const part = emptyPart(type, "p-aaaaaaaa", DEFAULTS);
      expect(part).toMatchObject({ id: "p-aaaaaaaa", type, data: null });
      expect(part.type !== "main" && part.type !== "text" && part.draft).toBeTruthy();
    }
  });

  it("starts reflection questions from the platform's standard questions", () => {
    const part = emptyPart("reflection", "p-aaaaaaaa", DEFAULTS);
    expect(part.type === "reflection" && part.draft).toEqual({
      kind: "reflection",
      prompts: DEFAULTS.reflectionPrompts,
    });
  });

  it("starts a self-assessment with the standard end labels", () => {
    const part = emptyPart("rating", "p-aaaaaaaa", DEFAULTS);
    expect(part.type === "rating" && part.draft).toEqual({
      kind: "rating",
      minLabel: DEFAULTS.ratingLabels.min,
      maxLabel: DEFAULTS.ratingLabels.max,
      statements: [],
    });
  });
});

describe("prefillParts", () => {
  let n = 0;
  const nextId = (): ExtraPartId => `p-0000000${++n}` as ExtraPartId;

  it("gives every lesson but reflection & self-assessment its main content alone", () => {
    for (const choice of [
      "blank",
      "text",
      "practice",
      "scenario",
      "quiz",
      "restore:context",
    ] as const) {
      expect(prefillParts(choice, nextId, DEFAULTS)).toEqual([MAIN_PART]);
    }
  });

  it("gives reflection & self-assessment the standard questions and a rating to finish", () => {
    n = 0;
    const items = prefillParts("reflectionRating", nextId, DEFAULTS);
    expect(items).toEqual([
      MAIN_PART,
      {
        id: "p-00000001",
        type: "reflection",
        data: { kind: "reflection", prompts: DEFAULTS.reflectionPrompts },
        draft: null,
      },
      {
        id: "p-00000002",
        type: "rating",
        data: null,
        draft: {
          kind: "rating",
          minLabel: DEFAULTS.ratingLabels.min,
          maxLabel: DEFAULTS.ratingLabels.max,
          statements: [],
        },
      },
    ]);
    // The standard questions are complete as they are: learners (from
    // Release 2) and the preview get them straight away.
    const reflection = items[1];
    expect(reflection.type === "reflection" && reflection.data && validateExercise(reflection.data)).toEqual([]);
    expect(partsOf(storedPartsValue(items))).toEqual(items);
  });
});

describe("versions of a lesson's content", () => {
  const items = [MAIN_PART, text("p-aaaaaaaa"), quiz("p-bbbbbbbb")];

  it("gives the order a fingerprint that ignores what the parts hold", () => {
    expect(partsOrderVersion(items)).toBe(
      partsOrderVersion([MAIN_PART, text("p-aaaaaaaa", "Changed"), quiz("p-bbbbbbbb")])
    );
    expect(partsOrderVersion(items)).not.toBe(
      partsOrderVersion([text("p-aaaaaaaa"), MAIN_PART, quiz("p-bbbbbbbb")])
    );
    expect(partsOrderVersion([MAIN_PART])).toEqual(expect.any(String));
  });

  it("is stable across key order, as jsonb stores it", () => {
    const reordered = JSON.parse(
      JSON.stringify({ items: items.map((i) => Object.fromEntries(Object.entries(i).reverse())) })
    ).items as StoredPart[];
    expect(partsOrderVersion(reordered)).toBe(partsOrderVersion(items));
    expect(itemVersion(reordered[2])).toBe(itemVersion(items[2]));
  });

  it("fingerprints a question's live version and draft separately", () => {
    const q = quiz("p-bbbbbbbb");
    expect(partVersions(q)).toEqual({
      data: null,
      draft: fingerprint({ kind: "assessment", intro: {}, questions: [] }),
    });
    expect(partVersions(text("p-aaaaaaaa"))).toEqual({ data: null, draft: null });
    expect(partVersions(MAIN_PART)).toEqual({ data: null, draft: null });
  });

  it("fingerprints one language of a text part", () => {
    const t = text("p-aaaaaaaa");
    expect(textPartVersion(t, "en")).toBe(fingerprint([{ kind: "paragraph", text: "Hello" }]));
    expect(textPartVersion(t, "de")).toBeNull();
    expect(textPartVersion(quiz("p-bbbbbbbb"), "en")).toBeNull();
  });

  it("fingerprints the whole item for its removal", () => {
    expect(itemVersion(text("p-aaaaaaaa"))).not.toBe(itemVersion(text("p-aaaaaaaa", "Other")));
  });

  it("fingerprints everything a lesson delete would remove", () => {
    const row = {
      narrative: { en: { title: "T" } },
      structure: null,
      structureDraft: null,
      parts: null,
      video: null,
      documentIds: ["d2", "d1"],
    };
    expect(sectionContentVersion(null)).toBeNull();
    const v = sectionContentVersion(row);
    expect(v).toEqual(expect.any(String));
    // The documents' order doesn't matter, only which there are.
    expect(sectionContentVersion({ ...row, documentIds: ["d1", "d2"] })).toBe(v);
    expect(sectionContentVersion({ ...row, documentIds: ["d1"] })).not.toBe(v);
    expect(sectionContentVersion({ ...row, video: { provider: "file", src: "x" } })).not.toBe(v);
    expect(sectionContentVersion({ ...row, structureDraft: { kind: "scenario" } })).not.toBe(v);
    expect(
      sectionContentVersion({ ...row, parts: { v: 1, items: [MAIN_PART, text("p-aaaaaaaa")] } })
    ).not.toBe(v);
  });
});
