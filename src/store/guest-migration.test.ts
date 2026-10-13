import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { migrateGuest, type GuestWrites } from "./guest-migration";
import { withRetry } from "./retry";
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
  privacy: "self",
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
  completedAt: null,
};

const guest: DemoState = {
  projectId: "seq-elevate",
  role: null,
  badges: ["voice-without-edges"],
  course,
  compCard: card,
};

/** A new account: nothing saved. */
const nothingSaved = { compCard: null, badges: [], enrollments: [] };

/** Writes that each fail their first `fails` tries, then get through. */
function writes(fails: { badge?: number; card?: number; course?: number } = {}) {
  const tries = { badge: 0, card: 0, course: 0 };
  const server = {
    badges: [] as string[],
    card: null as CompCardData | null,
    course: null as CourseProgress | null,
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
    saveCourse: async (_slug, c) => {
      if (++tries.course <= (fails.course ?? 0)) throw noSession();
      server.course = c;
    },
  };
  return { writes: w, server, tries };
}

describe("migrateGuest", () => {
  it("moves the guest's badges, Comp Card and course to a new account", async () => {
    const { writes: w, server } = writes();
    const moved = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server).toEqual({
      badges: ["voice-without-edges"],
      card,
      course,
    });
    expect(moved).toEqual({
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
    const moved = await migrateGuest(
      { ...guest, course: answered },
      nothingSaved,
      w,
      retry
    );
    expect(server.course?.assessment).toEqual(answered.assessment);
    expect(moved.course?.assessment).toEqual(answered.assessment);
  });

  it("tries a write that finds no session again, and gets it through", async () => {
    const { writes: w, server, tries } = writes({ badge: 1, card: 2, course: 1 });
    const moved = await migrateGuest(guest, nothingSaved, w, retry);

    expect(tries).toEqual({ badge: 2, card: 3, course: 2 });
    expect(server).toEqual({ badges: ["voice-without-edges"], card, course });
    expect(moved.awarded).toEqual(["voice-without-edges"]);
  });

  it("keeps the rest going, and hands the store all of it, when a write never gets through", async () => {
    // The guest store is already emptied: the learner store in memory is
    // the only other place left for it, and its write-throughs save it.
    const { writes: w, server } = writes({ badge: 100, card: 100 });
    const moved = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toEqual(course); // not skipped
    expect(moved).toEqual({
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
    const moved = await migrateGuest(guest, nothingSaved, w, retry);

    expect(tries.badge).toBe(1);
    expect(moved.badges).toEqual(["voice-without-edges"]); // still shown
    expect(moved.awarded).toEqual([]); // not counted as saved
  });

  it("hands the store the guest's course when its save never gets through", async () => {
    const { writes: w, server } = writes({ course: 100 });
    const moved = await migrateGuest(guest, nothingSaved, w, retry);

    expect(server.course).toBeNull();
    expect(moved.course).toEqual(course);
  });

  it("leaves what the account has saved as it is: the saved data wins", async () => {
    const savedCard = { ...card, wentWell: "Saved: I stayed calm" };
    const { writes: w, server } = writes();
    const moved = await migrateGuest(
      guest,
      {
        compCard: savedCard,
        badges: ["voice-without-edges"],
        enrollments: [{ slug: "workplace-conflict", stagesCompleted: 3 }],
      },
      w,
      retry
    );

    expect(server).toEqual({ badges: [], card: null, course: null });
    expect(moved).toEqual({
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
        enrollments: [{ slug: "workplace-conflict", stagesCompleted: 0 }],
      },
      w,
      retry
    );
    expect(server.course).toEqual(course);
  });

  it("moves no Comp Card the guest never filled in, and no course without a lesson done", async () => {
    const { writes: w, server } = writes();
    const moved = await migrateGuest(
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
    expect(moved).toMatchObject({ compCard: null, course: null, wrote: false });
  });
});
