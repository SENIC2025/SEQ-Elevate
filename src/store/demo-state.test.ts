import { describe, it, expect, vi } from "vitest";
import type { DemoState } from "./demo-state";

/*
 * The learner store's Release 2 actions (spec 5.4), through its reducer.
 * The server actions are stood in for: nothing here saves.
 */

vi.mock("@/app/actions/learner", () => ({ saveCourseProgress: vi.fn() }));
vi.mock("next-auth/react", () => ({ getSession: vi.fn(), useSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  unstable_isUnrecognizedActionError: () => false,
}));
vi.mock("next-intl", () => ({ useLocale: vi.fn() }));

const { DEFAULT_STATE, reducer } = await import("./demo-state");

const SLUG = "saying-no";
const OWN = "s-abcdefgh";
const KEY = `${OWN}/p-12345678` as const;
const playing: DemoState = {
  ...DEFAULT_STATE,
  course: { ...DEFAULT_STATE.course, courseSlug: SLUG, courseTitle: "Saying no" },
};

describe("the learner store's Release 2 actions", () => {
  it("keeps the course's own lessons out of stagesCompleted, whichever action finishes them", () => {
    let s = reducer(playing, { type: "completeLesson", id: OWN });
    s = reducer(s, { type: "completeLesson", id: "context" });
    s = reducer(s, { type: "completeStage", stage: "s-ijklmnop" });
    expect(s.course.stagesCompleted).toEqual(["context"]);
    expect(s.course.sectionsCompleted).toEqual([OWN, "s-ijklmnop"]);
    // Done already: the same state, so nothing is saved again.
    expect(reducer(s, { type: "completeLesson", id: OWN })).toBe(s);
  });

  it("puts each answer where it lives: a standard one in its field, any other in responses", () => {
    let s = reducer(playing, {
      type: "answerPart",
      key: "simulation/main",
      answer: { type: "practice", optionId: "o1", correct: true },
    });
    s = reducer(s, { type: "answerPart", key: KEY, answer: { type: "rating", values: { s1: 4 } } });
    expect(s.course.simulation).toEqual({ choice: "o1", correct: true });
    expect(s.course.responses).toEqual({ [KEY]: { type: "rating", values: { s1: 4 } } });
  });

  it("marks what the server refused once, and returns the same state when told again", () => {
    const refused = reducer(playing, {
      type: "progressRefused",
      slug: SLUG,
      keys: [{ key: KEY, reason: "too-long" }],
    });
    expect(refused.refusedKeys).toEqual({ [KEY]: "too-long" });
    // The store tells it on every save that holds the key back: no new
    // state, so no render and no save comes of it.
    expect(
      reducer(refused, { type: "progressRefused", slug: SLUG, keys: [{ key: KEY, reason: "too-long" }] })
    ).toBe(refused);
    // Another course's refusal isn't this one's.
    expect(
      reducer(playing, { type: "progressRefused", slug: "other", keys: [{ key: KEY, reason: "invalid" }] })
    ).toBe(playing);
    // Changing the answer clears the mark; the next save tells again if need be.
    const changed = reducer(refused, {
      type: "answerPart",
      key: KEY,
      answer: { type: "reflection", text: { q1: "Shorter" } },
    });
    expect(changed.refusedKeys).toEqual({});
    // A course opened after it starts with none.
    expect(reducer(refused, { type: "setCourseContext", slug: "other", title: "Other" }).refusedKeys).toEqual({});
  });

  it("applies what the outbox kept to the course it was kept for only", () => {
    const patch = {
      v: 2 as const,
      completed: ["context", OWN],
      answers: { [KEY]: { type: "rating" as const, values: { s1: 2 as const } } },
    };
    const restored = reducer(playing, { type: "outboxRestored", slug: SLUG, patch });
    expect(restored.course).toMatchObject({
      stagesCompleted: ["context"],
      sectionsCompleted: [OWN],
      responses: { [KEY]: { type: "rating", values: { s1: 2 } } },
    });
    expect(reducer(playing, { type: "outboxRestored", slug: "other", patch })).toBe(playing);
  });

  it("loads a guest's course moved into the account with the account's answers first", () => {
    // Moved on sign-in in fill mode (practice "a"); another device saved
    // practice "b" before the course loaded.
    const guest = { ...playing.course, simulation: { choice: "a", correct: false }, stagesCompleted: ["context"] };
    const migrated = reducer(playing, { type: "guestCourseMigrated", course: guest });
    const saved = { ...DEFAULT_STATE.course, courseSlug: SLUG, simulation: { choice: "b", correct: true } };
    const loaded = reducer(migrated, { type: "courseProgressLoaded", slug: SLUG, saved, migrated: guest });
    expect(loaded.course).toMatchObject({ simulation: { choice: "b", correct: true }, stagesCompleted: ["context"] });
    // Without it, as for any saved progress, what the page holds wins.
    expect(reducer(migrated, { type: "courseProgressLoaded", slug: SLUG, saved }).course.simulation).toEqual(guest.simulation);
  });
});
