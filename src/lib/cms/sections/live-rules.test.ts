import { describe, it, expect } from "vitest";
import { restructureClosedFrom } from "./cutoff";
import { liveRule, outlineLiveOp, partLiveOp, type LiveFacts, type LiveOp, type LiveVerdict } from "./live-rules";

/*
 * Spec 7.2, the whole table (D66, D67): what each change does on a course
 * with no learners, with learners but not published, and published with
 * learners — each with learners before the 1 December cut-off and from it.
 * Settled at integration (owner's standing instruction): from the cut-off,
 * adding, moving and removing lessons and content is refused on ANY course
 * with learners, whatever its status, so unpublishing a course to rework
 * it and publishing it again doesn't get around the rule. The columns get
 * their "closed" from restructureClosedFrom with the clock set either side
 * of the default date.
 */

const before = restructureClosedFrom({}, new Date("2026-11-30T23:59:59+01:00"), () => {});
const after = restructureClosedFrom({}, new Date("2026-12-01T00:00:00+01:00"), () => {});

const COLUMNS: Record<string, LiveFacts> = {
  "no learners": { status: "published", learners: 0, closed: after.closed },
  "learners, not published, before the cut-off": { status: "draft", learners: 3, closed: before.closed },
  "learners, not published, from the cut-off": { status: "draft", learners: 3, closed: after.closed },
  "published with learners, before the cut-off": { status: "published", learners: 3, closed: before.closed },
  "published with learners, from the cut-off": { status: "published", learners: 3, closed: after.closed },
};

const C = "needs-confirmation";
const X = "restructure-closed";
const H = "has-learners";

/** Each row of the table, one verdict per column in the order above. */
const TABLE: [LiveOp, Partial<LiveFacts>, LiveVerdict[]][] = [
  ["add-lesson", {}, ["allowed", C, X, C, X]],
  ["move-lesson", {}, ["allowed", C, X, C, X]],
  ["hide", {}, ["allowed", C, C, C, C]],
  ["show", {}, ["allowed", C, C, C, C]],
  // A lesson some learner has data in: refused for them first (Hide is offered).
  ["delete-lesson", { withData: 1 }, ["allowed", H, H, H, H]],
  // A lesson nobody has anything in: only an unpublished course lets it
  // go, and only before the cut-off.
  ["delete-lesson", { withData: 0 }, ["allowed", "allowed", X, H, H]],
  ["add-part", {}, ["allowed", C, X, C, X]],
  ["move-part", {}, ["allowed", C, X, C, X]],
  ["remove-part", {}, ["allowed", C, X, C, X]],
  ["remove-question", {}, ["allowed", H, H, H, H]],
  ["remove-stage", {}, ["allowed", H, H, H, H]],
];

describe("liveRule: the table of spec 7.2", () => {
  it("knows which side of 1 December the clock is on", () => {
    expect(before.closed).toBe(false);
    expect(after.closed).toBe(true);
  });

  for (const [op, extra, verdicts] of TABLE) {
    it(`${op}${extra.withData !== undefined ? ` (learners with data: ${extra.withData})` : ""}`, () => {
      const got = Object.values(COLUMNS).map((facts) => liveRule(op, { ...facts, ...extra }));
      expect(got).toEqual(verdicts);
    });
  }

  it("closes restructuring on any course with learners, whatever its status; never on one without", () => {
    for (const op of ["add-lesson", "move-lesson", "add-part", "move-part", "remove-part"] as const) {
      for (const status of ["published", "draft", "archived"] as const) {
        expect(liveRule(op, { status, learners: 2, closed: true }), `${op} ${status}`).toBe("restructure-closed");
        expect(liveRule(op, { status, learners: 0, closed: true }), `${op} ${status}`).toBe("allowed");
      }
    }
    // Hide and Show stay open ("use Hide"), whatever the status.
    for (const status of ["published", "draft", "archived"] as const) {
      expect(liveRule("hide", { status, learners: 2, closed: true })).toBe("needs-confirmation");
      expect(liveRule("show", { status, learners: 2, closed: true })).toBe("needs-confirmation");
    }
  });

  it("doesn't let unpublishing get around the cut-off (D67): unpublish, restructure, publish again", () => {
    const live: LiveFacts = { status: "published", learners: 3, closed: true };
    const unpublished: LiveFacts = { ...live, status: "draft" };
    for (const op of ["add-lesson", "move-lesson", "add-part", "move-part", "remove-part"] as const) {
      expect(liveRule(op, live)).toBe("restructure-closed");
      expect(liveRule(op, unpublished)).toBe("restructure-closed");
    }
    // Deleting a lesson nobody has anything in, once unpublished, is removing one too.
    expect(liveRule("delete-lesson", { ...unpublished, withData: 0 })).toBe("restructure-closed");
  });

  it("keeps a published course from losing its last lesson learners see (last-lesson)", () => {
    const last = { lastVisible: true };
    expect(liveRule("hide", { status: "published", learners: 0, closed: false, ...last })).toBe("last-lesson");
    expect(liveRule("hide", { status: "published", learners: 4, closed: true, ...last })).toBe("last-lesson");
    expect(liveRule("delete-lesson", { status: "published", learners: 0, closed: false, ...last })).toBe(
      "last-lesson"
    );
    // With learners a delete is refused for them first (Hide is offered).
    expect(liveRule("delete-lesson", { status: "published", learners: 2, closed: false, withData: 0, ...last })).toBe(
      "has-learners"
    );
    // A draft may be emptied; showing a lesson never empties anything.
    expect(liveRule("hide", { status: "draft", learners: 0, closed: false, ...last })).toBe("allowed");
    expect(liveRule("delete-lesson", { status: "draft", learners: 0, closed: false, ...last })).toBe("allowed");
    expect(liveRule("show", { status: "published", learners: 0, closed: false, ...last })).toBe("allowed");
  });

  it("refuses a delete on an unpublished course while it can't tell who has data in the lesson", () => {
    expect(liveRule("delete-lesson", { status: "draft", learners: 2, closed: false })).toBe("has-learners");
  });
});

describe("which rule a change follows", () => {
  it("names each lesson-list change; a rename is never guarded (D58)", () => {
    expect(outlineLiveOp({ op: "add", choice: "text", at: null, newId: "s-aaaaaaaa" })).toBe("add-lesson");
    expect(outlineLiveOp({ op: "move", id: "concept", dir: 1 })).toBe("move-lesson");
    expect(outlineLiveOp({ op: "hide", id: "concept", hidden: true })).toBe("hide");
    expect(outlineLiveOp({ op: "hide", id: "concept", hidden: false })).toBe("show");
    expect(outlineLiveOp({ op: "delete", id: "concept" })).toBe("delete-lesson");
    expect(outlineLiveOp({ op: "rename", id: "concept", locale: "en", label: "x" })).toBeNull();
  });

  it("names each content change: a question learners can get is removed under its own rule", () => {
    expect(partLiveOp("add")).toBe("add-part");
    expect(partLiveOp("move")).toBe("move-part");
    expect(partLiveOp("remove", { type: "text" })).toBe("remove-part");
    expect(partLiveOp("remove", { type: "quiz", live: false })).toBe("remove-part");
    expect(partLiveOp("remove", { type: "quiz", live: true })).toBe("remove-question");
    expect(partLiveOp("remove", { type: "rating", live: true })).toBe("remove-question");
  });
});
