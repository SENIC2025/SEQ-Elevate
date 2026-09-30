import { describe, it, expect } from "vitest";
import { forgetLearner, sessionChange, sessionOwner } from "./session-owner";
import type { DemoState } from "./demo-state";

const blank: DemoState = {
  projectId: "seq-elevate",
  role: null,
  badges: [],
  course: {
    courseSlug: null,
    courseTitle: null,
    stagesCompleted: [],
    simulation: null,
    scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { q1: null, q2: null, q3: null },
    completedAt: null,
  },
  compCard: {
    wentWell: "",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 3,
    privacy: "facilitator",
    updatedAt: null,
  },
};

describe("sessionOwner", () => {
  it("isn't known while the session loads", () => {
    expect(sessionOwner("loading", undefined)).toBeUndefined();
  });

  it("is null for a guest", () => {
    expect(sessionOwner("unauthenticated", null)).toBeNull();
  });

  it("is the signed-in learner's id, else their email", () => {
    expect(
      sessionOwner("authenticated", { id: "u1", email: "a@example.com" })
    ).toBe("u1");
    expect(sessionOwner("authenticated", { email: "a@example.com" })).toBe(
      "a@example.com"
    );
  });
});

describe("sessionChange", () => {
  it("holds a learner's data when their session finds no one: signed out, or a lookup that failed", () => {
    expect(sessionChange("u1", null)).toBe("hold");
  });

  it("forgets it when another account signs in", () => {
    expect(sessionChange("u1", "u2")).toBe("forget");
  });

  it("keeps it while the session is the same learner's, or still loading", () => {
    expect(sessionChange("u1", "u1")).toBe("keep");
    expect(sessionChange("u1", undefined)).toBe("keep");
  });

  it("keeps a guest's progress when they sign in (it moves to the account)", () => {
    expect(sessionChange(null, "u1")).toBe("keep");
    expect(sessionChange(undefined, "u1")).toBe("keep");
    expect(sessionChange(undefined, null)).toBe("keep");
    expect(sessionChange(null, null)).toBe("keep");
  });
});

describe("forgetLearner", () => {
  const learners: DemoState = {
    projectId: "other-project",
    role: "learner",
    badges: ["voice-without-edges"],
    course: {
      courseSlug: "workplace-conflict",
      courseTitle: "Workplace conflict",
      stagesCompleted: ["context", "concept"],
      simulation: { choice: "iStatement", correct: true },
      scenario: {
        root: "private",
        followup: "privateBoundary",
        rootLabel: "Wait for a quiet moment",
        followupLabel: "Addressed directly",
      },
      reflection: { p1: "Mine", p2: "", p3: "" },
      assessment: { q1: "a", q2: null, q3: null },
      completedAt: "2026-09-29T10:05:00.000Z",
    },
    compCard: {
      wentWell: "Private: only mine",
      difficult: "",
      improve: "",
      behaviour: "",
      confidence: 5,
      privacy: "self",
      updatedAt: "2026-09-29T10:06:00.000Z",
    },
  };

  it("keeps nothing of the learner's: no progress, answers, badges or Comp Card", () => {
    const forgotten = forgetLearner(learners, blank);
    expect(forgotten.badges).toEqual([]);
    expect(forgotten.compCard).toEqual(blank.compCard);
    expect(forgotten.course).toEqual({
      ...blank.course,
      courseSlug: "workplace-conflict",
      courseTitle: "Workplace conflict",
    });
  });

  it("keeps the course being played open, and the project and demo role", () => {
    const forgotten = forgetLearner(learners, blank);
    expect(forgotten.course.courseSlug).toBe("workplace-conflict");
    expect(forgotten.course.courseTitle).toBe("Workplace conflict");
    expect(forgotten.projectId).toBe("other-project");
    expect(forgotten.role).toBe("learner");
  });
});
