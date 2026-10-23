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

describe("the course being played records the language its text is in (D90, spec 9.3)", () => {
  it("keeps the course's language with its title, and changes when it changes", () => {
    const opened = reducer(DEFAULT_STATE, { type: "setCourseContext", slug: SLUG, title: "Saying no", locale: "en" });
    expect(opened.course).toMatchObject({ courseSlug: SLUG, courseTitle: "Saying no", courseLocale: "en" });
    // The same course in the same language again: nothing changes.
    expect(reducer(opened, { type: "setCourseContext", slug: SLUG, title: "Saying no", locale: "en" })).toBe(opened);
    // Its language switched on: the title and its language change together.
    const german = reducer(opened, { type: "setCourseContext", slug: SLUG, title: "Nein sagen", locale: "de" });
    expect(german.course).toMatchObject({ courseTitle: "Nein sagen", courseLocale: "de" });
  });
});

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

describe("the learner store's Comp Card sharing (D80, UB3)", () => {
  const loaded = {
    ...DEFAULT_STATE,
    compCard: { ...DEFAULT_STATE.compCard, wentWell: "Mine", updatedAt: "2026-11-21T09:00:00.000Z" },
  };

  it("starts Only me", () => {
    expect(DEFAULT_STATE.compCard).toMatchObject({ sharing: "onlyMe", sharedAt: null, organisationName: null });
    expect(DEFAULT_STATE.compCard).not.toHaveProperty("privacy");
  });

  it("shows a sharing change without marking the card as edited (its texts aren't sent again)", () => {
    const shared = reducer(loaded, {
      type: "sharingShown",
      sharing: "facilitators",
      sharedAt: "2026-11-21T10:00:00.000Z",
      organisationName: "Pro Arbeit",
    });
    expect(shared.compCard).toEqual({
      ...loaded.compCard,
      sharing: "facilitators",
      sharedAt: "2026-11-21T10:00:00.000Z",
      organisationName: "Pro Arbeit",
    });
    expect(shared.compCard.updatedAt).toBe(loaded.compCard.updatedAt);
  });
});

describe("after guest work is added to the account (D79, Release 3 polish)", () => {
  const base = {
    ...DEFAULT_STATE.course,
    stagesCompleted: ["context"],
    reflection: { p1: "Account", p2: "", p3: "" },
  };
  // The course being played, loaded before the move: what the server held then.
  const loaded: DemoState = {
    ...playing,
    course: { ...playing.course, stagesCompleted: ["context"], reflection: { p1: "Account", p2: "", p3: "" } },
  };
  // What the server holds after the move: the guest's lessons and completion,
  // and another device's answer to p2, which the move kept.
  const server = {
    ...DEFAULT_STATE.course,
    courseSlug: SLUG,
    courseTitle: "Saying no",
    stagesCompleted: ["context", "concept", "assessment"],
    reflection: { p1: "Account", p2: "From the phone", p3: "Guest" },
    assessment: { answers: { q1: "a" }, checked: true },
    completedAt: "2026-11-21T09:00:00.000Z",
  };

  it("reads the course being played again: what the server holds now, and nothing of this page's older copy over it", () => {
    const next = reducer(loaded, { type: "courseReread", slug: SLUG, saved: server, base });
    expect(next.course).toMatchObject({
      courseSlug: SLUG,
      courseTitle: "Saying no",
      stagesCompleted: ["context", "concept", "assessment"],
      reflection: { p1: "Account", p2: "From the phone", p3: "Guest" },
      assessment: { answers: { q1: "a" }, checked: true },
      completedAt: "2026-11-21T09:00:00.000Z",
    });
  });

  it("keeps what the learner did on this page that the server didn't have yet", () => {
    const played: DemoState = {
      ...loaded,
      course: {
        ...loaded.course,
        stagesCompleted: ["context", "behaviour"],
        reflection: { p1: "Account", p2: "", p3: "On this page" },
        scenario: { root: "r1", followup: null, rootLabel: "Root one", followupLabel: null },
      },
    };
    const next = reducer(played, { type: "courseReread", slug: SLUG, saved: server, base });
    expect(next.course.stagesCompleted).toEqual(["context", "concept", "assessment", "behaviour"]);
    expect(next.course.reflection).toEqual({ p1: "Account", p2: "From the phone", p3: "On this page" });
    expect(next.course.scenario).toEqual({ root: "r1", followup: null, rootLabel: "Root one", followupLabel: null });
  });

  it("leaves another course alone", () => {
    const elsewhere = { ...loaded, course: { ...loaded.course, courseSlug: "other" } };
    expect(reducer(elsewhere, { type: "courseReread", slug: SLUG, saved: server, base })).toBe(elsewhere);
  });

  const cardBefore = { ...DEFAULT_STATE.compCard, wentWell: "Old, as loaded", updatedAt: "2026-11-20T09:00:00.000Z" };
  const cardNow = {
    ...DEFAULT_STATE.compCard,
    wentWell: "New, from the phone",
    difficult: "Guest",
    updatedAt: "2026-11-21T09:00:00.000Z",
  };

  it("shows the Comp Card as the server holds it after the move, not this page's copy as loaded", () => {
    const s = reducer({ ...playing, compCard: cardBefore }, { type: "cardAfterClaim", card: cardNow, before: cardBefore });
    expect(s.compCard).toEqual(cardNow);
  });

  it("keeps a field of the Comp Card the learner changed on this page while the work was being added", () => {
    const edited = { ...cardBefore, improve: "Typed meanwhile", updatedAt: "2026-11-21T09:00:01.000Z" };
    const s = reducer({ ...playing, compCard: edited }, { type: "cardAfterClaim", card: cardNow, before: cardBefore });
    expect(s.compCard).toEqual({ ...cardNow, improve: "Typed meanwhile", updatedAt: edited.updatedAt });
  });

  it("another tab added the guest's card: this page reads the account's again, keeps what it changed and hasn't saved, and unions badges", () => {
    const saved = { wentWell: "", difficult: "", improve: "", behaviour: "", confidence: 3 };
    const here = { ...DEFAULT_STATE.compCard, improve: "Typed here", updatedAt: "2026-11-21T09:00:02.000Z" };
    const s = reducer(
      { ...playing, compCard: here, badges: ["earned-here"] },
      { type: "accountReread", compCard: cardNow, saved, badges: ["moved-badge"] }
    );
    expect(s.compCard).toEqual({ ...cardNow, improve: "Typed here", updatedAt: here.updatedAt });
    expect(s.badges).toEqual(["moved-badge", "earned-here"]);
  });
});
