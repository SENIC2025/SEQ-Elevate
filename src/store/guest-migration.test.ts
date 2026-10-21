import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cardToSave, guestWorkOf, migrateGuest, type GuestWrites } from "./guest-migration";
import { withRetry } from "./retry";
import type { ProgressPatch } from "@/lib/learner-progress/contract";
import type { CompCardData, CourseProgress, DemoState } from "./demo-state";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Tried again at once, twice: three tries in all. */
const retry = <T,>(call: () => Promise<T>) =>
  withRetry(call, { delays: [0, 0] });

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

/** What moving `course` sends: all of it, in fill mode (the account wins). */
const moved: ProgressPatch = { v: 2, completed: ["context", "concept"], fill: true };

const guest: DemoState = {
  projectId: "seq-elevate",
  role: null,
  badges: ["voice-without-edges"],
  course,
  compCard: card,
  refusedKeys: {},
};

/** A new account: nothing saved. */
const nothingSaved = { compCard: null, badges: [], enrollments: [] };

/** The account's enrolment in workplace conflict, as loadLearnerGlobal sums it up. */
const enrolment = (stagesCompleted: number, hasProgress: boolean) => ({
  slug: "workplace-conflict",
  stagesCompleted,
  completed: false,
  hasProgress,
});

/** Writes that each fail their first `fails` tries, then get through. */
function writes(fails: { badge?: number; card?: number; course?: number } = {}) {
  const tries = { badge: 0, card: 0, course: 0 };
  const server = {
    badges: [] as string[],
    card: null as CompCardData | null,
    course: null as ProgressPatch | null,
  };
  const noSession = () => new Error("No signed-in learner");
  const w: GuestWrites = {
    awardBadge: async (slug) => {
      if (++tries.badge <= (fails.badge ?? 0)) throw noSession();
      server.badges.push(slug);
    },
    saveCompCard: async (c) => {
      if (++tries.card <= (fails.card ?? 0)) throw noSession();
      server.card = c;
    },
    saveCourse: async (_slug, patch) => {
      if (++tries.course <= (fails.course ?? 0)) throw noSession();
      server.course = patch;
      return { ok: true, refused: [] };
    },
  };
  return { writes: w, server, tries };
}

describe("migrateGuest", () => {
  it("moves the guest's badges, Comp Card and course to a new account", async () => {
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server).toEqual({
      badges: ["voice-without-edges"],
      card,
      course: moved,
    });
    expect(migrated).toEqual({
      badges: ["voice-without-edges"],
      awarded: ["voice-without-edges"],
      compCard: card,
      course,
      wrote: true,
    });
  });

  it("moves the guest's quick-check answers, and whether they were checked, with the course", async () => {
    const answered: CourseProgress = {
      ...course,
      stagesCompleted: [...course.stagesCompleted, "assessment"],
      assessment: { answers: { qk3f: "a1x", q9zz: "a4x" }, checked: true },
    };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      { ...guest, course: answered },
      nothingSaved,
      w,
      retry
    );
    expect(server.course?.answers?.["assessment/main"]).toEqual({
      type: "quiz",
      ...answered.assessment,
    });
    expect(migrated.course?.assessment).toEqual(answered.assessment);
  });

  it("tries a write that finds no session again, and gets it through", async () => {
    const { writes: w, server, tries } = writes({ badge: 1, card: 2, course: 1 });
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(tries).toEqual({ badge: 2, card: 3, course: 2 });
    expect(server).toEqual({ badges: ["voice-without-edges"], card, course: moved });
    expect(migrated.awarded).toEqual(["voice-without-edges"]);
  });

  it("keeps the rest going, and hands the store all of it, when a write never gets through", async () => {
    // The guest store is already emptied: the learner store in memory is
    // the only other place left for it, and its write-throughs save it.
    const { writes: w, server } = writes({ badge: 100, card: 100 });
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toEqual(moved); // not skipped
    expect(migrated).toEqual({
      badges: ["voice-without-edges"], // shown…
      awarded: [], // …and awarded by the store's badge write-through
      compCard: card, // saved by its Comp Card write-through
      course, // saved once it has loaded
      wrote: true,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("doesn't try again an award the server refused, and doesn't count it as awarded", async () => {
    // A badge with no Badge row on the server: no try can succeed, so it
    // isn't tried again for 15 s while the learner waits for their data.
    const tries = { badge: 0 };
    const { writes: base } = writes();
    const w: GuestWrites = {
      ...base,
      awardBadge: async () => {
        tries.badge++;
        return { ok: false, reason: "no-badge" };
      },
    };
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(tries.badge).toBe(1);
    expect(migrated.badges).toEqual(["voice-without-edges"]); // still shown
    expect(migrated.awarded).toEqual([]); // not counted as saved
  });

  it("hands the store the guest's course when its save never gets through", async () => {
    const { writes: w, server } = writes({ course: 100 });
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toBeNull();
    expect(migrated.course).toEqual(course);
  });

  it("leaves what the account has saved as it is: the saved data wins", async () => {
    const savedCard = { ...card, wentWell: "Saved: I stayed calm" };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      guest,
      {
        compCard: savedCard,
        badges: ["voice-without-edges"],
        enrollments: [enrolment(3, true)],
      },
      w,
      retry
    );

    expect(server).toEqual({ badges: [], card: null, course: null });
    expect(migrated).toEqual({
      badges: ["voice-without-edges"],
      awarded: ["voice-without-edges"],
      compCard: savedCard,
      course: null,
      wrote: false,
    });
  });

  it("moves a course the account has opened but done nothing in", async () => {
    const { writes: w, server } = writes();
    await migrateGuest(
      guest,
      {
        ...nothingSaved,
        enrollments: [enrolment(0, false)],
      },
      w,
      retry
    );
    expect(server.course).toEqual(moved);
  });

  it("moves no Comp Card the guest never filled in, and no course with nothing done", async () => {
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      {
        ...guest,
        badges: [],
        compCard: { ...card, updatedAt: null },
        course: { ...course, stagesCompleted: [] },
      },
      nothingSaved,
      w,
      retry
    );

    expect(server).toEqual({ badges: [], card: null, course: null });
    expect(migrated).toMatchObject({ compCard: null, course: null, wrote: false });
  });

  // U9 (spec 5.4, D37 "the account wins", per course; D69).
  it("moves a guest's progress in the course's own lessons, and answers per item, into an empty account", async () => {
    const own: CourseProgress = {
      ...course,
      stagesCompleted: [],
      sectionsCompleted: ["s-abcdefgh"],
      responses: { "s-abcdefgh/p-12345678": { type: "rating", values: { s1: 4 } } },
    };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest({ ...guest, course: own }, nothingSaved, w, retry);
    expect(server.course).toEqual({
      v: 2,
      completed: ["s-abcdefgh"],
      answers: { "s-abcdefgh/p-12345678": { type: "rating", values: { s1: 4 } } },
      fill: true,
    });
    expect(migrated.course).toEqual(own);
  });

  it("moves a guest's answer when no lesson is done yet", async () => {
    const answered: CourseProgress = {
      ...course,
      stagesCompleted: [],
      simulation: { choice: "iStatement", correct: true },
    };
    const { writes: w, server } = writes();
    await migrateGuest({ ...guest, course: answered }, nothingSaved, w, retry);
    expect(server.course).toEqual({
      v: 2,
      answers: { "simulation/main": { type: "practice", optionId: "iStatement", correct: true } },
      fill: true,
    });
  });

  it("leaves the course alone when the account has any progress in it, even without a lesson done", async () => {
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      guest,
      { ...nothingSaved, enrollments: [enrolment(0, true)] },
      w,
      retry
    );
    expect(server.course).toBeNull();
    expect(migrated.course).toBeNull();
  });

  it("doesn't count a move the server refused as saved, and still hands the store the course", async () => {
    const { writes: base, server } = writes();
    const w: GuestWrites = {
      ...base,
      saveCourse: async () => ({ ok: false, error: "unknown-course" }),
    };
    const migrated = await migrateGuest(
      { ...guest, badges: [], compCard: { ...card, updatedAt: null } },
      nothingSaved,
      w,
      retry
    );
    expect(server.course).toBeNull();
    expect(migrated).toMatchObject({ course, wrote: false });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("Release 3: a guest's Comp Card moves as Only me, within the limit (D80, UB3)", () => {
  it("counts a Comp Card save the server refused (a text over the limit) as not saved, and still hands the store the card", async () => {
    const { writes: base } = writes();
    const w: GuestWrites = {
      ...base,
      saveCompCard: async () => ({ ok: false, error: "too-long", field: "difficult" }),
    };
    const migrated = await migrateGuest(
      { ...guest, badges: [], course: { ...course, courseSlug: null } },
      nothingSaved,
      w,
      retry
    );
    expect(migrated.wrote).toBe(false);
    expect(migrated.compCard).toMatchObject({ wentWell: card.wentWell, difficult: card.difficult, sharing: "onlyMe" });
    expect(console.error).toHaveBeenCalled();
  });

  it("hands the store the guest's card as Only me, whatever the guest's copy said", async () => {
    const { writes: w } = writes();
    const shared = { ...card, sharing: "facilitators" as const, sharedAt: "2026-11-21T08:00:00.000Z", organisationName: "X" };
    const migrated = await migrateGuest({ ...guest, compCard: shared }, nothingSaved, w, retry);
    expect(migrated.compCard).toMatchObject({ sharing: "onlyMe", sharedAt: null, organisationName: null });
  });
});

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
    expect(work).toEqual({ courses: ["Workplace conflict"], compCard: true, reflections: 2 });
  });

  it("is a Comp Card alone, or badges alone, too", () => {
    expect(guestWorkOf({ ...empty, compCard: card })).toEqual({ courses: [], compCard: true, reflections: 0 });
    expect(guestWorkOf({ ...empty, badges: ["voice-without-edges"] })).toEqual({
      courses: [],
      compCard: false,
      reflections: 0,
    });
  });

  it("doesn't count a course opened and left empty", () => {
    expect(guestWorkOf({ ...empty, course: { ...course, stagesCompleted: [] } })).toBeNull();
  });
});
