import { describe, it, expect } from "vitest";
import type { NewOnlyReason, PartView } from "@/lib/cms/sections/contract";
import type { LiveFacts } from "@/lib/cms/sections/live-rules";
import { emptyExercise } from "@/lib/cms/sections/part-kinds";
import {
  extraCount,
  focusAfterPartMove,
  focusAfterRemove,
  partControl,
  partStatus,
  partTypeOf,
  settleRereads,
  settleSaves,
  textInitial,
  textStart,
  type TextPartView,
} from "./part-list";

const para = (text: string) => ({ kind: "paragraph" as const, text });

const text: TextPartView = {
  id: "p-text0001",
  type: "text",
  blocks: { en: [para("Hello")], de: [para("Hallo")] },
  versions: { en: "ven", de: "vde", el: null },
  itemVersion: "item-text",
};
const quiz: PartView = {
  id: "p-quiz0001",
  type: "quiz",
  data: null,
  draft: emptyExercise("assessment"),
  versions: { data: null, draft: "d1" },
  itemVersion: "item-quiz",
  issues: [{ code: "assessmentQuestionText", params: { question: 1 } }, { code: "assessmentCorrect", params: { question: 1 } }],
};
const main: PartView = { id: "main", type: "main" };

describe("partTypeOf", () => {
  it("names the main content by the lesson's kind, and extra content by its own type", () => {
    expect(partTypeOf(main, "narrative")).toBe("text");
    expect(partTypeOf(main, "reflection")).toBe("reflection");
    expect(partTypeOf(main, "simulation")).toBe("practice");
    expect(partTypeOf(main, "assessment")).toBe("quiz");
    expect(partTypeOf(quiz, "narrative")).toBe("quiz");
    expect(partTypeOf(text, "scenario")).toBe("text");
  });
});

describe("extraCount", () => {
  it("counts everything but the main content", () => {
    expect(extraCount([main])).toBe(0);
    expect(extraCount([text, main, quiz])).toBe(2);
  });
});

describe("partStatus", () => {
  it("says nothing for the main content (its editor does)", () => {
    expect(partStatus(main, "en")).toBeNull();
  });

  it("says whether a text is written in the language on screen", () => {
    expect(partStatus(text, "de")).toEqual({ kind: "text", written: true });
    expect(partStatus(text, "el")).toEqual({ kind: "text", written: false });
    const blank: TextPartView = { ...text, blocks: { en: [para("  ")] } };
    expect(partStatus(blank, "en")).toEqual({ kind: "text", written: false });
  });

  it("marks a question's draft and how much keeps it from learners", () => {
    expect(partStatus(quiz, "en")).toEqual({ kind: "question", draft: true, notReady: 2, saved: false });
  });
});

describe("textInitial", () => {
  it("starts from the language's own text, with its own base", () => {
    expect(textInitial(text, "de")).toEqual({
      title: "",
      subtitle: "",
      blocks: [para("Hallo")],
      hasOverride: true,
      version: "vde",
    });
  });

  it("starts an unwritten language from the text learners would get, saying so", () => {
    const greek = textInitial(text, "el");
    expect(greek.blocks).toEqual([para("Hello")]);
    expect(greek.hasOverride).toBe(false);
    expect(greek.fallbackFrom).toBe("en");
    // The base is Greek's own: nothing stored there yet.
    expect(greek.version).toBeNull();
  });

  it("starts empty when nothing is written anywhere", () => {
    const empty: TextPartView = { ...text, blocks: {}, versions: { en: null, de: null, el: null } };
    expect(textInitial(empty, "en")).toEqual({
      title: "",
      subtitle: "",
      blocks: [],
      hasOverride: false,
      version: null,
    });
  });
});

describe("partControl (spec 7.2)", () => {
  const question = (live: boolean): PartView => ({
    id: "p-q0000001",
    type: "quiz",
    data: live ? ({ kind: "assessment", questions: [] } as never) : null,
    draft: live ? null : ({ kind: "assessment", questions: [] } as never),
    versions: { data: null, draft: null },
    itemVersion: "i",
    issues: [],
  });
  const facts = (over: Partial<LiveFacts> = {}): LiveFacts => ({ status: "published", learners: 0, closed: false, ...over });

  it("allows everything on a course nobody is taking, published or not (Release 1 refused it, D57)", () => {
    for (const op of ["add", "move", "remove"] as const) {
      expect(partControl({ reasons: [], op, item: question(true), facts: facts() }), op).toEqual({ kind: "enabled" });
      expect(partControl({ reasons: [], op, item: question(true), facts: facts({ closed: true }) }), op).toEqual({
        kind: "enabled",
      });
    }
  });

  it("asks first with learners, and refuses removing a question they may have answered", () => {
    const f = facts({ learners: 2 });
    expect(partControl({ reasons: [], op: "add", facts: f })).toEqual({ kind: "enabled", confirm: true });
    expect(partControl({ reasons: [], op: "move", item: question(true), facts: f })).toEqual({ kind: "enabled", confirm: true });
    expect(partControl({ reasons: [], op: "remove", item: text, facts: f })).toEqual({ kind: "enabled", confirm: true });
    // Only a draft: nobody could answer it.
    expect(partControl({ reasons: [], op: "remove", item: question(false), facts: f })).toEqual({
      kind: "enabled",
      confirm: true,
    });
    expect(partControl({ reasons: [], op: "remove", item: question(true), facts: f })).toEqual({
      kind: "locked",
      why: "learners",
    });
    // On a draft too.
    expect(partControl({ reasons: [], op: "remove", item: question(true), facts: { ...f, status: "draft" } })).toEqual({
      kind: "locked",
      why: "learners",
    });
  });

  it("from 1 December, a published course with learners takes no content change (D67)", () => {
    const f = facts({ learners: 2, closed: true });
    for (const op of ["add", "move", "remove"] as const) {
      expect(partControl({ reasons: [], op, item: text, facts: f }), op).toEqual({ kind: "locked", why: "closed" });
    }
    expect(partControl({ reasons: [], op: "add", facts: { ...f, status: "draft" } })).toEqual({
      kind: "enabled",
      confirm: true,
    });
  });

  it("allows nothing while anything can't be read", () => {
    const unreadable: NewOnlyReason[] = [{ code: "unreadable" }];
    expect(partControl({ reasons: unreadable, op: "add", facts: facts() })).toEqual({ kind: "locked", why: "unreadable" });
  });
});

describe("focus after a change", () => {
  const items = [{ id: "main" as const }, { id: "p-text0001" as const }, { id: "p-quiz0001" as const }];

  it("keeps focus on the move button pressed, or the other one at an end", () => {
    expect(focusAfterPartMove(items, "p-quiz0001", -1)).toBe("up");
    expect(focusAfterPartMove(items, "p-text0001", -1)).toBe("down");
    expect(focusAfterPartMove(items, "p-text0001", 1)).toBe("up");
    expect(focusAfterPartMove(items, "main", 1)).toBe("down");
  });

  it("goes to the next content after a removal, else the one before", () => {
    expect(focusAfterRemove([...items, { id: "p-rate0001" }], "p-text0001")).toEqual({
      id: "p-quiz0001",
      target: "label",
    });
    expect(focusAfterRemove([...items, { id: "p-rate0001" }], "p-rate0001")).toEqual({
      id: "p-quiz0001",
      target: "label",
    });
  });

  it("goes to the main content's Add content when nothing else is left", () => {
    expect(focusAfterRemove([{ id: "main" }, { id: "p-text0001" }], "p-text0001")).toEqual({
      id: "main",
      target: "add",
    });
    expect(focusAfterRemove([{ id: "p-text0001" }, { id: "main" }], "p-text0001")).toEqual({
      id: "main",
      target: "add",
    });
  });
});

describe("settleRereads", () => {
  it("bumps a text's revision once the page holds another version than the stale one", () => {
    const pending = { "p-text0001:en": "old" };
    expect(settleRereads(pending, {}, [main, text])).toEqual({
      pending: {},
      revs: { "p-text0001:en": 1 },
    });
  });

  it("keeps waiting while the page still holds the stale version", () => {
    const pending = { "p-text0001:en": "ven" };
    expect(settleRereads(pending, { "p-text0001:en": 2 }, [main, text])).toEqual({
      pending,
      revs: { "p-text0001:en": 2 },
    });
  });

  it("drops the wait for a text that is gone", () => {
    expect(settleRereads({ "p-gone0001:en": "x" }, {}, [main])).toEqual({ pending: {}, revs: {} });
  });

  it("treats a language removed by a colleague as a new version", () => {
    expect(settleRereads({ "p-text0001:el": "was" }, {}, [text])).toEqual({
      pending: {},
      revs: { "p-text0001:el": 1 },
    });
  });
});

describe("a text saved here before the page caught up", () => {
  const savedValue = {
    title: "",
    subtitle: "",
    blocks: [para("Hello again")],
    hasOverride: true,
    version: "ven2",
  };
  const saved = { from: "ven", value: savedValue };

  it("starts a remounted editor from what was saved, not the page's older text", () => {
    // The author saved, switched language and back before the refresh landed.
    expect(textStart(text, "en", saved)).toEqual(savedValue);
  });

  it("starts from the page once it holds a newer version", () => {
    const fresh = { ...text, blocks: { ...text.blocks, en: [para("Hello again")] }, versions: { ...text.versions, en: "ven2" } };
    expect(textStart(fresh, "en", saved)).toEqual(textInitial(fresh, "en"));
    expect(textStart(text, "en", undefined)).toEqual(textInitial(text, "en"));
  });

  it("forgets the save once the page shows it, or a later one, or the text is gone", () => {
    const fresh = { ...text, versions: { ...text.versions, en: "ven2" } };
    expect(settleSaves({ "p-text0001:en": saved }, [main, text])).toEqual({ "p-text0001:en": saved });
    expect(settleSaves({ "p-text0001:en": saved }, [main, fresh])).toEqual({});
    expect(settleSaves({ "p-text0001:en": saved }, [main])).toEqual({});
  });
});
