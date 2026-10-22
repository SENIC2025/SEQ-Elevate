import { describe, it, expect } from "vitest";
import { cardToSave, guestClaimOf, guestWorkOf, storeAfterClaim, withText } from "./guest-migration";
import type { CompCardData, CourseProgress, DemoState } from "./demo-state";

const card: CompCardData = {
  wentWell: "Guest: I listened",
  difficult: "Guest: waiting my turn",
  improve: "",
  behaviour: "",
  confidence: 4,
  sharing: "onlyMe",
  sharedAt: null,
  organisationName: null,
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const course: CourseProgress = {
  courseSlug: "workplace-conflict",
  courseTitle: "Workplace conflict",
  stagesCompleted: ["context", "concept"],
  simulation: null,
  scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
  reflection: { p1: "", p2: "", p3: "" },
  assessment: { answers: {}, checked: false },
  sectionsCompleted: [],
  responses: {},
  completedAt: null,
};

const guest: DemoState = {
  projectId: "seq-elevate",
  role: null,
  badges: ["voice-without-edges"],
  course,
  compCard: card,
  refusedKeys: {},
};

describe("cardToSave (UB3)", () => {
  it("sends the texts and the confidence, never who sees the card", () => {
    expect(cardToSave({ ...card, sharing: "facilitators" })).toEqual({
      wentWell: card.wentWell,
      difficult: card.difficult,
      improve: "",
      behaviour: "",
      confidence: 4,
    });
  });

  it("leaves out a text over 2,000 characters (it keeps its stored text); the others still save", () => {
    const long = { ...card, improve: "x".repeat(2001), behaviour: "y".repeat(2000) };
    const sent = cardToSave(long);
    expect(sent).not.toHaveProperty("improve");
    expect(sent.behaviour).toHaveLength(2000);
    expect(sent.wentWell).toBe(card.wentWell);
  });
});

describe("guestWorkOf: what a guest store holds, offered after sign-in (spec 5.5)", () => {
  const empty: DemoState = {
    ...guest,
    badges: [],
    course: { ...course, courseSlug: null, stagesCompleted: [] },
    compCard: { ...card, wentWell: "", difficult: "", updatedAt: null },
  };

  it("is nothing for an empty guest store", () => {
    expect(guestWorkOf(empty)).toBeNull();
  });

  it("names the course with progress, says whether a Comp Card was filled in, and counts the reflections", () => {
    const work = guestWorkOf({
      ...guest,
      course: { ...course, reflection: { p1: "One", p2: " ", p3: "Three" } },
    });
    expect(work).toEqual({
      courses: [{ title: "Workplace conflict", locale: course.courseLocale ?? null }],
      compCard: true,
      cardTooLong: [],
      texts: [
        { ref: { part: "course", key: "reflection/main", prompt: "p1" }, text: "One", max: 5000, n: 1 },
        { ref: { part: "course", key: "reflection/main", prompt: "p3" }, text: "Three", max: 5000, n: 2 },
        { ref: { part: "compCard", field: "wentWell" }, text: card.wentWell, max: 2000 },
        { ref: { part: "compCard", field: "difficult" }, text: card.difficult, max: 2000 },
      ],
      tooLong: [],
      reflections: 2,
      badges: guest.badges.length,
    });
  });

  it("gives each course's title with the language it was recorded in (none for a store from before Release 3)", () => {
    const work = (courseLocale: "en" | "de" | null | undefined) =>
      guestWorkOf({ ...guest, course: { ...course, courseTitle: "Workplace conflict", courseLocale } })?.courses;
    expect(work("en")).toEqual([{ title: "Workplace conflict", locale: "en" }]);
    expect(work("de")).toEqual([{ title: "Workplace conflict", locale: "de" }]);
    expect(work(undefined)).toEqual([{ title: "Workplace conflict", locale: null }]);
  });

  it("is a Comp Card alone, or badges alone, too, and counts the badges so the offer can name them", () => {
    expect(guestWorkOf({ ...empty, compCard: card })).toMatchObject({
      courses: [],
      compCard: true,
      cardTooLong: [],
      tooLong: [],
      reflections: 0,
      badges: 0,
    });
    expect(guestWorkOf({ ...empty, badges: ["voice-without-edges", "listening-first"] })).toEqual({
      courses: [],
      compCard: false,
      cardTooLong: [],
      texts: [],
      tooLong: [],
      reflections: 0,
      badges: 2,
    });
  });

  it("doesn't count a course opened and left empty", () => {
    expect(guestWorkOf({ ...empty, course: { ...course, stagesCompleted: [] } })).toBeNull();
  });
});

/*
 * Release 3 (D79): "Add it to my account" sends the guest store's work once
 * (guestClaimOf), and the browser then removes only the parts the server
 * says are in the account, and only as it read them (storeAfterClaim). A
 * text too long to add is offered to be shortened, in the guest store
 * (withText).
 */
describe("guestClaimOf: what Add sends", () => {
  const blank: DemoState = {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: { ...course, courseSlug: null, courseTitle: null, stagesCompleted: [] },
    compCard: { ...card, wentWell: "", difficult: "", confidence: 3, updatedAt: null },
    refusedKeys: {},
  };

  it("sends each part that holds work, as it is: the course as a patch of all of it, the card's texts and confidence, the badges", () => {
    const store: DemoState = {
      ...guest,
      badges: ["voice-without-edges", "voice-without-edges"],
      course: {
        ...course,
        reflection: { p1: "One", p2: "", p3: "" },
        assessment: { answers: { q1: "b" }, checked: true },
        responses: { "s-abcdefgh/main": { type: "rating", values: { s1: 4 } } },
        completedAt: "2026-10-01T09:00:00.000Z",
      },
    };
    const claim = guestClaimOf(store);
    expect(claim).toEqual({
      claim: 1,
      course: {
        slug: "workplace-conflict",
        patch: {
          v: 2,
          completed: ["context", "concept"],
          answers: {
            "reflection/main": { type: "reflection", text: { p1: "One" } },
            "assessment/main": { type: "quiz", answers: { q1: "b" }, checked: true },
            "s-abcdefgh/main": { type: "rating", values: { s1: 4 } },
          },
          completedAt: "2026-10-01T09:00:00.000Z",
        },
      },
      compCard: { wentWell: card.wentWell, difficult: card.difficult, improve: "", behaviour: "", confidence: 4 },
      badges: ["voice-without-edges"],
    });
    // Known by its first key in the request.
    expect(JSON.stringify(claim).startsWith('{"claim":1')).toBe(true);
    // Never who sees the card.
    expect(JSON.stringify(claim)).not.toMatch(/sharing|privacy|sharedAt/);
  });

  it("leaves out what isn't work, and is nothing for a store with none", () => {
    expect(guestClaimOf({ ...blank, badges: ["b"] })).toEqual({ claim: 1, badges: ["b"] });
    expect(guestClaimOf({ ...blank, compCard: { ...card, confidence: 9 as number } })).toMatchObject({
      compCard: { confidence: 3 },
    });
    expect(guestClaimOf(blank)).toBeNull();
  });

  it("sends a text too long to add as it is: the server refuses the whole of it, and it is never cut", () => {
    const long = "y".repeat(5001);
    const claim = guestClaimOf({ ...blank, course: { ...course, reflection: { p1: long, p2: "", p3: "" } } });
    expect(claim?.course?.patch.answers?.["reflection/main"]).toEqual({ type: "reflection", text: { p1: long } });
  });

  it("guestWorkOf lists the reflection answers and Comp Card answers too long to add, numbered and in order", () => {
    const work = guestWorkOf({
      ...blank,
      course: {
        ...course,
        reflection: { p1: "ok", p2: "y".repeat(5001), p3: "" },
        responses: { "s-abcdefgh/p-abcdefgh": { type: "reflection", text: { q1: "z".repeat(5002), q2: "fine" } } },
      },
      compCard: { ...card, behaviour: "b".repeat(2001) },
    });
    expect(work?.tooLong).toEqual([
      { ref: { part: "course", key: "reflection/main", prompt: "p2" }, text: "y".repeat(5001), max: 5000, n: 2 },
      { ref: { part: "course", key: "s-abcdefgh/p-abcdefgh", prompt: "q1" }, text: "z".repeat(5002), max: 5000, n: 3 },
      { ref: { part: "compCard", field: "behaviour" }, text: "b".repeat(2001), max: 2000 },
    ]);
  });
});

describe("storeAfterClaim: the browser keeps what isn't in the account, as it is now", () => {
  const blank: DemoState = {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: { ...course, courseSlug: null, courseTitle: null, stagesCompleted: [] },
    compCard: { ...card, wentWell: "", difficult: "", confidence: 3, updatedAt: null },
    refusedKeys: {},
  };
  const read = JSON.stringify(guest);
  const all = { course: true, compCard: true, badges: ["voice-without-edges"] };

  it("removes the store once every part is in the account, as read", () => {
    expect(storeAfterClaim(read, read, all, blank)).toEqual({ store: null, more: false });
  });

  it("keeps a part the server kept back, without the parts in the account", () => {
    const after = storeAfterClaim(read, read, { course: false, compCard: true, badges: ["voice-without-edges"] }, blank);
    expect(after.more).toBe(false);
    expect(JSON.parse(after.store!)).toEqual({ ...guest, compCard: blank.compCard, badges: [] });
    const cardKept = storeAfterClaim(read, read, { course: true, compCard: false, badges: [] }, blank);
    expect(JSON.parse(cardKept.store!)).toEqual({ ...guest, course: blank.course, refusedKeys: {} });
  });

  it("keeps a part saved to since it was read (a tab still a guest), and says more was saved", () => {
    const later = JSON.stringify({ ...guest, course: { ...course, stagesCompleted: [...course.stagesCompleted, "behaviour"] } });
    const after = storeAfterClaim(read, later, all, blank);
    expect(after.more).toBe(true);
    expect(JSON.parse(after.store!)).toEqual({
      ...guest,
      course: { ...course, stagesCompleted: [...course.stagesCompleted, "behaviour"] },
      compCard: blank.compCard,
      badges: [],
    });
    // A badge earned meanwhile is more too, and stays.
    const badge = JSON.stringify({ ...guest, badges: ["voice-without-edges", "listening-first"] });
    expect(storeAfterClaim(read, badge, all, blank)).toEqual({
      store: JSON.stringify({ ...guest, course: blank.course, refusedKeys: {}, compCard: blank.compCard, badges: ["listening-first"] }),
      more: true,
    });
  });

  it("leaves the store alone when it is gone, unreadable, or nothing of it is in the account", () => {
    expect(storeAfterClaim(read, null, all, blank)).toEqual({ store: undefined, more: false });
    expect(storeAfterClaim(read, "{nope", all, blank)).toEqual({ store: undefined, more: true });
    expect(storeAfterClaim(read, read, { course: false, compCard: false, badges: [] }, blank)).toEqual({ store: undefined, more: false });
  });

  it("isn't more for a part emptied elsewhere meanwhile", () => {
    const emptied = JSON.stringify({ ...guest, compCard: blank.compCard });
    expect(storeAfterClaim(read, emptied, { course: true, compCard: false, badges: ["voice-without-edges"] }, blank)).toEqual({
      store: null,
      more: false,
    });
  });
});

describe("withText: a text of the guest work shortened in the offer", () => {
  const stored = JSON.stringify({
    ...guest,
    course: {
      ...course,
      reflection: { p1: "long one", p2: "", p3: "" },
      responses: { "s-abcdefgh/p-abcdefgh": { type: "reflection", text: { q1: "long two" } } },
    },
  });

  it("changes that text only: a Comp Card answer (and its time), a reflection answer, the standard one's or the course's own", () => {
    const card1 = JSON.parse(withText(stored, { part: "compCard", field: "difficult" }, "short")!);
    expect(card1.compCard).toMatchObject({ difficult: "short", wentWell: card.wentWell });
    expect(card1.compCard.updatedAt).not.toBe(card.updatedAt);
    expect(card1.course).toEqual(JSON.parse(stored).course);
    const p1 = JSON.parse(withText(stored, { part: "course", key: "reflection/main", prompt: "p1" }, "short")!);
    expect(p1.course.reflection).toEqual({ p1: "short", p2: "", p3: "" });
    const own = JSON.parse(withText(stored, { part: "course", key: "s-abcdefgh/p-abcdefgh", prompt: "q1" }, "short")!);
    expect(own.course.responses["s-abcdefgh/p-abcdefgh"]).toEqual({ type: "reflection", text: { q1: "short" } });
    expect(own.compCard).toEqual(JSON.parse(stored).compCard);
  });

  it("is null for a text the store doesn't hold", () => {
    expect(withText(stored, { part: "course", key: "s-zzzzzzzz/main", prompt: "q1" }, "x")).toBeNull();
    expect(withText(stored, { part: "course", key: "reflection/main", prompt: "p9" }, "x")).toBeNull();
    expect(withText("{nope", { part: "compCard", field: "difficult" }, "x")).toBeNull();
  });
});
