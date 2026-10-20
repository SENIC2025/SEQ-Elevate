import { describe, it, expect } from "vitest";
import { restructureClosedFrom } from "./cutoff";
import { liveRule, outlineLiveOp, partLiveOp, type LiveFacts, type LiveOp, type LiveVerdict } from "./live-rules";

/*
 * Spec 7.2, the whole table (D66, D67): what each change does on a course
 * with no learners, with learners but not published, published with
 * learners before the 1 December cut-off, and from it. The two published
 * columns get their "closed" from restructureClosedFrom with the clock set
 * either side of the default date.
 */

const before = restructureClosedFrom({}, new Date("2026-11-30T23:59:59+01:00"), () => {});
const after = restructureClosedFrom({}, new Date("2026-12-01T00:00:00+01:00"), () => {});

const COLUMNS: Record<string, LiveFacts> = {
  "no learners": { status: "published", learners: 0, closed: after.closed },
  "learners, not published": { status: "draft", learners: 3, closed: after.closed },
  "published with learners, before the cut-off": { status: "published", learners: 3, closed: before.closed },
  "published with learners, from the cut-off": { status: "published", learners: 3, closed: after.closed },
};

/** Each row of the table, one verdict per column in the order above. */
const TABLE: [LiveOp, Partial<LiveFacts>, LiveVerdict[]][] = [
  ["add-lesson", {}, ["allowed", "needs-confirmation", "needs-confirmation", "restructure-closed"]],
  ["move-lesson", {}, ["allowed", "needs-confirmation", "needs-confirmation", "restructure-closed"]],
  ["hide", {}, ["allowed", "needs-confirmation", "needs-confirmation", "needs-confirmation"]],
  ["show", {}, ["allowed", "needs-confirmation", "needs-confirmation", "needs-confirmation"]],
  // A lesson some learner has data in.
  ["delete-lesson", { withData: 1 }, ["allowed", "has-learners", "has-learners", "has-learners"]],
  // A lesson nobody has anything in: only an unpublished course lets it go.
  ["delete-lesson", { withData: 0 }, ["allowed", "allowed", "has-learners", "has-learners"]],
  ["add-part", {}, ["allowed", "needs-confirmation", "needs-confirmation", "restructure-closed"]],
  ["move-part", {}, ["allowed", "needs-confirmation", "needs-confirmation", "restructure-closed"]],
  ["remove-part", {}, ["allowed", "needs-confirmation", "needs-confirmation", "restructure-closed"]],
  ["remove-question", {}, ["allowed", "has-learners", "has-learners", "has-learners"]],
  ["remove-stage", {}, ["allowed", "has-learners", "has-learners", "has-learners"]],
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

  it("only closes restructuring on a published course with learners", () => {
    // No learners, or not published: the date changes nothing.
    for (const op of ["add-lesson", "move-lesson", "add-part", "move-part", "remove-part"] as const) {
      expect(liveRule(op, { status: "published", learners: 0, closed: true })).toBe("allowed");
      expect(liveRule(op, { status: "archived", learners: 2, closed: true })).toBe("needs-confirmation");
    }
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
