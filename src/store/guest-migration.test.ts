import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cardToSave, guestStoreLeft, guestWorkOf, migrateGuest, type GuestWrites } from "./guest-migration";
import { withRetry } from "./retry";
import type { ProgressPatch } from "@/lib/learner-progress/contract";
import type { CompCardData, CourseProgress, DemoState } from "./demo-state";
import type { CompCardInput } from "@/app/actions/learner";

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

/** What moving `card` into an account with no Comp Card sends: all of it (cardToSave). */
const sentCard: CompCardInput = {
  wentWell: "Guest: I listened",
  difficult: "Guest: waiting my turn",
  improve: "",
  behaviour: "",
  confidence: 4,
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
    card: null as CompCardInput | null,
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
      card: { ...sentCard, fill: true },
      course: moved,
    });
    expect(migrated).toEqual({
      badges: ["voice-without-edges"],
      awarded: ["voice-without-edges"],
      compCard: card,
      cardMoved: true,
      course,
      courseMoved: true,
      wrote: true,
      settled: true,
      accountFirst: false,
      cardHeldBack: false,
      otherAccount: false,
      left: null,
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
    expect(server).toEqual({ badges: ["voice-without-edges"], card: { ...sentCard, fill: true }, course: moved });
    expect(migrated.awarded).toEqual(["voice-without-edges"]);
    expect(migrated.settled, "all of it in the account: the guest store can go").toBe(true);
  });

  it("keeps the rest going when a write never gets through, and leaves in the browser what didn't move", async () => {
    // Not settled: what didn't get through stays in the guest store
    // (guestStoreLeft), offered again; the page doesn't take it as saved.
    const { writes: w, server } = writes({ badge: 100, card: 100 });
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toEqual(moved); // not skipped
    expect(migrated).toEqual({
      badges: ["voice-without-edges"], // shown, and awarded by the store's badge write-through
      awarded: [],
      compCard: null, // the account's, as read: nothing
      cardMoved: false,
      course,
      courseMoved: true,
      wrote: true,
      settled: false,
      accountFirst: false,
      cardHeldBack: false,
      otherAccount: false,
      left: { badges: ["voice-without-edges"], compCard: true, course: false },
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
    expect(migrated.settled, "a refusal leaves nothing to try again").toBe(true);
  });

  it("hands the store the guest's course when its save never gets through", async () => {
    const { writes: w, server } = writes({ course: 100 });
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toBeNull();
    expect(migrated.course).toEqual(course);
    expect(migrated.settled).toBe(false);
  });

  it("fills only what the account lacks: what it has saved stays as it is (the account wins, D37, D69)", async () => {
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

    // The course is sent in fill mode all the same: the server keeps the
    // account's answers and lessons, and adds only what it lacks (D79: what
    // the page says was added is in the account). The card has nothing the
    // account's lacks; the badge is there.
    expect(server).toEqual({ badges: [], card: null, course: moved });
    expect(migrated).toEqual({
      badges: ["voice-without-edges"],
      awarded: ["voice-without-edges"],
      compCard: savedCard,
      cardMoved: false,
      course,
      courseMoved: true,
      wrote: true,
      settled: true,
      // The card's own wentWell stays over the guest's.
      accountFirst: true,
      cardHeldBack: false,
      otherAccount: false,
      left: null,
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

  it("sends the course in fill mode when the account has progress in it too, even without a lesson done", async () => {
    // An account that started the course on another device: the guest's
    // finished course still moves, filling what the account lacks (its
    // lessons, its answers, the completion). The server kept no answer of
    // the account's over one of the guest's, so there's nothing to say.
    const finished: CourseProgress = { ...course, completedAt: "2026-10-22T09:00:00.000Z" };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      { ...guest, course: finished },
      { ...nothingSaved, enrollments: [enrolment(0, true)] },
      w,
      retry
    );
    expect(server.course).toEqual({ ...moved, completedAt: "2026-10-22T09:00:00.000Z" });
    expect(migrated).toMatchObject({ course: finished, courseMoved: true, settled: true, accountFirst: false });
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
  it("counts a Comp Card save the server refused (a text over the limit) as not saved", async () => {
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
    expect(migrated).toMatchObject({ wrote: false, cardMoved: false, compCard: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("fills a saved card's empty fields with the guest's text, never a field the account has written", async () => {
    // Only me, with a text of its own: the guest's other text fills the gap;
    // its confidence doesn't (a card in use has one of its own, even at 3).
    const saved: CompCardData = { ...card, wentWell: "Saved: I stayed calm", difficult: "", confidence: 3 };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest({ ...guest, badges: [] }, { ...nothingSaved, compCard: saved }, w, retry);
    expect(server.card).toEqual({ difficult: "Guest: waiting my turn", fill: true });
    expect(migrated).toMatchObject({
      compCard: { wentWell: "Saved: I stayed calm", difficult: "Guest: waiting my turn", confidence: 3, sharing: "onlyMe" },
      settled: true,
      accountFirst: true,
      cardHeldBack: false,
    });
  });

  it("fills a saved card with nothing in it (made by a sharing choice), the confidence too", async () => {
    const blank: CompCardData = { ...card, wentWell: "", difficult: "", confidence: 3 };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest({ ...guest, badges: [] }, { ...nothingSaved, compCard: blank }, w, retry);
    expect(server.card).toEqual({ wentWell: "Guest: I listened", difficult: "Guest: waiting my turn", confidence: 4, fill: true });
    expect(migrated).toMatchObject({ compCard: { wentWell: card.wentWell, difficult: card.difficult, confidence: 4 }, accountFirst: false });
  });

  it("fills nothing into a card the account shares, and says so: moving never shares (D80)", async () => {
    const shared: CompCardData = {
      ...card,
      wentWell: "Saved: I stayed calm",
      difficult: "",
      sharing: "facilitators",
      sharedAt: "2026-11-21T08:00:00.000Z",
      organisationName: "Pro Arbeit",
    };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(guest, { ...nothingSaved, compCard: shared }, w, retry);
    expect(server).toEqual({ badges: ["voice-without-edges"], card: null, course: moved });
    expect(migrated).toMatchObject({ compCard: shared, settled: true, cardHeldBack: true });
    // A shared card the guest's card has nothing to add to holds nothing back.
    const { writes: w2 } = writes();
    const nothingToAdd = await migrateGuest(
      { ...guest, compCard: { ...card, difficult: "" } },
      { ...nothingSaved, compCard: shared },
      w2,
      retry
    );
    expect(nothingToAdd.cardHeldBack).toBe(false);
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
    expect(work).toEqual({
      courses: [{ title: "Workplace conflict", locale: course.courseLocale ?? null }],
      compCard: true,
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
    expect(guestWorkOf({ ...empty, compCard: card })).toEqual({ courses: [], compCard: true, reflections: 0, badges: 0 });
    expect(guestWorkOf({ ...empty, badges: ["voice-without-edges", "listening-first"] })).toEqual({
      courses: [],
      compCard: false,
      reflections: 0,
      badges: 2,
    });
  });

  it("doesn't count a course opened and left empty", () => {
    expect(guestWorkOf({ ...empty, course: { ...course, stagesCompleted: [] } })).toBeNull();
  });
});

describe("Release 3 polish: what the move may say, and what it leaves in the browser", () => {
  const blankState: DemoState = {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: { ...course, courseSlug: null, courseTitle: null, stagesCompleted: [] },
    compCard: { ...card, wentWell: "", difficult: "", confidence: 3, updatedAt: null },
    refusedKeys: {},
  };

  it("stops at a write refused as another account's (another account signed in on this browser), and isn't settled", async () => {
    // The badge award, the first write, finds another account's session.
    const tried: string[] = [];
    const w: GuestWrites = {
      awardBadge: async () => (tried.push("badge"), { ok: false, reason: "other-account" }),
      saveCompCard: async () => (tried.push("card"), { ok: false, error: "other-account" }),
      saveCourse: async () => (tried.push("course"), { ok: false, error: "other-account" }),
    };
    const migrated = await migrateGuest(guest, nothingSaved, w, retry);
    expect(tried).toEqual(["badge"]);
    expect(migrated).toMatchObject({ wrote: false, settled: false, otherAccount: true, cardMoved: false, courseMoved: false });
  });

  it("says the account kept its own when the guest's confidence wasn't added to a card in use", async () => {
    const guestCard = { ...card, wentWell: "Guest text", difficult: "", confidence: 5 };
    const saved = { ...card, wentWell: "", difficult: "Account text", confidence: 2 };
    const { writes: w, server } = writes();
    const migrated = await migrateGuest(
      { ...guest, badges: [], course: blankState.course, compCard: guestCard },
      { ...nothingSaved, compCard: saved },
      w,
      retry
    );
    expect(server.card).toEqual({ wentWell: "Guest text", fill: true });
    expect(migrated.accountFirst).toBe(true);
  });

  it("doesn't say the account kept its own when every text and the confidence of the guest's card are in it", async () => {
    const saved = { ...card, wentWell: "", difficult: "", improve: "Account text", confidence: 3 };
    const { writes: w } = writes();
    const migrated = await migrateGuest(
      { ...guest, badges: [], course: blankState.course, compCard: { ...card, confidence: 3 } },
      { ...nothingSaved, compCard: saved },
      w,
      retry
    );
    expect(migrated.accountFirst).toBe(false);
  });

  it("says the account kept its own in the course only where the server kept an answer of the account's over another of the guest's", async () => {
    const answered = (kept: string[]): GuestWrites => ({
      ...writes().writes,
      saveCourse: async () => ({ ok: true, refused: [], kept }),
    });
    const theGuest = { ...guest, badges: [], compCard: blankState.compCard };
    const had = { ...nothingSaved, enrollments: [enrolment(3, true)] };
    expect((await migrateGuest(theGuest, had, answered(["reflection/main"]), retry)).accountFirst).toBe(true);
    // Progress of the account's own, but none of it over an answer of the guest's.
    expect((await migrateGuest(theGuest, had, answered([]), retry)).accountFirst).toBe(false);
  });

  it("fills the Comp Card on the server, under its row, and takes the card as the server holds it then", async () => {
    // Another device wrote wentWell after the account's card was read here.
    const saved = { ...card, wentWell: "", difficult: "", confidence: 3, updatedAt: "2026-10-01T09:00:00.000Z" };
    const sent: CompCardInput[] = [];
    const w: GuestWrites = {
      ...writes().writes,
      saveCompCard: async (input) => {
        sent.push(input);
        return {
          ok: true,
          card: { wentWell: "Phone", difficult: card.difficult, improve: "", behaviour: "", confidence: 3, updatedAt: "2026-10-02T09:00:00.000Z" },
        };
      },
    };
    const migrated = await migrateGuest({ ...guest, badges: [], course: blankState.course }, { ...nothingSaved, compCard: saved }, w, retry);
    expect(sent).toEqual([{ wentWell: card.wentWell, difficult: card.difficult, confidence: 4, fill: true }]);
    expect(migrated).toMatchObject({
      cardMoved: true,
      compCard: { wentWell: "Phone", difficult: card.difficult, confidence: 3, sharing: "onlyMe", updatedAt: "2026-10-02T09:00:00.000Z" },
      // The guest's wentWell and confidence aren't in it: the account's stay.
      accountFirst: true,
      settled: true,
    });
  });

  it("holds the Comp Card back when the server finds it shared by the time it is filled (D80)", async () => {
    const w: GuestWrites = { ...writes().writes, saveCompCard: async () => ({ ok: false, error: "shared" }) };
    const migrated = await migrateGuest({ ...guest, badges: [] }, nothingSaved, w, retry);
    expect(migrated).toMatchObject({ cardHeldBack: true, cardMoved: false, settled: true });
  });

  it("moves a course too big for one save in several, each in fill mode", async () => {
    const lessons = Array.from({ length: 70 }, (_, i) => `s-${String(i).padStart(8, "a")}`);
    const big: CourseProgress = { ...course, stagesCompleted: [], sectionsCompleted: lessons };
    const patches: ProgressPatch[] = [];
    const w: GuestWrites = {
      ...writes().writes,
      saveCourse: async (_slug, patch) => (patches.push(patch), { ok: true, refused: [] }),
    };
    const migrated = await migrateGuest({ ...guest, badges: [], course: big }, nothingSaved, w, retry);
    expect(patches.map((p) => [p.completed?.length, p.fill])).toEqual([
      [64, true],
      [6, true],
    ]);
    expect(migrated).toMatchObject({ courseMoved: true, settled: true });
  });

  it("leaves in the browser only what didn't move: a Comp Card held back, a write that never got through", async () => {
    const shared: CompCardData = { ...card, wentWell: "Saved", difficult: "", sharing: "facilitators", sharedAt: "2026-11-21T08:00:00.000Z" };
    const heldBack = await migrateGuest(guest, { ...nothingSaved, compCard: shared }, writes().writes, retry);
    expect(heldBack.left).toEqual({ badges: [], compCard: true, course: false });
    expect(guestStoreLeft(guest, heldBack.left, blankState)).toEqual({ ...blankState, compCard: card });

    const courseFailed = await migrateGuest(guest, nothingSaved, writes({ course: 100 }).writes, retry);
    expect(courseFailed.left).toEqual({ badges: [], compCard: false, course: true });
    expect(guestStoreLeft(guest, courseFailed.left, blankState)).toEqual({ ...blankState, course });

    const badgeFailed = await migrateGuest(guest, nothingSaved, writes({ badge: 100 }).writes, retry);
    expect(guestStoreLeft(guest, badgeFailed.left, blankState)).toEqual({ ...blankState, badges: ["voice-without-edges"] });

    const allMoved = await migrateGuest(guest, nothingSaved, writes().writes, retry);
    expect(allMoved.left).toBeNull();
    expect(guestStoreLeft(guest, allMoved.left, blankState)).toBeNull();
  });
});
