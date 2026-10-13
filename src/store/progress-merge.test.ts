import { describe, it, expect } from "vitest";
import {
  courseAfterLoad,
  courseAfterMigration,
  guestStateAfterHydrate,
  hasCourseProgress,
  mergeBadges,
  mergeCompCardOnHydrate,
  mergeCourseProgress,
  storedGuestState,
} from "./progress-merge";
import type { CompCardData, CourseProgress, DemoState } from "./demo-state";

const SLUG = "workplace-conflict";

function progress(patch: Partial<CourseProgress> = {}): CourseProgress {
  return {
    courseSlug: SLUG,
    courseTitle: null,
    stagesCompleted: [],
    simulation: null,
    scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    completedAt: null,
    ...patch,
  };
}

/** A whole course walked before the saved progress arrived. */
const walked = progress({
  courseTitle: "Workplace conflict",
  stagesCompleted: [
    "context",
    "concept",
    "behaviour",
    "simulation",
    "scenario",
    "reflection",
    "assessment",
  ],
  simulation: { choice: "iStatement", correct: true },
  scenario: {
    root: "private",
    followup: "privateBoundary",
    rootLabel: "Wait for a quiet moment",
    followupLabel: "Addressed directly",
  },
  assessment: { answers: { q1: "a", q2: "b", q3: "c" }, checked: true },
  completedAt: "2026-09-29T10:05:00.000Z",
});

describe("hasCourseProgress", () => {
  it("is false for a course only opened", () => {
    expect(hasCourseProgress(progress({ courseTitle: "Opened" }))).toBe(false);
  });

  it("is false for a reflection of only whitespace", () => {
    expect(
      hasCourseProgress(progress({ reflection: { p1: "  \n", p2: "", p3: "" } }))
    ).toBe(false);
  });

  it("is true for any one recorded step", () => {
    const steps: Partial<CourseProgress>[] = [
      { stagesCompleted: ["context"] },
      { simulation: { choice: "x", correct: false } },
      {
        scenario: { root: "r", followup: null, rootLabel: "R", followupLabel: null },
      },
      { reflection: { p1: "", p2: "", p3: "An answer" } },
      { assessment: { answers: { q2: "b" }, checked: false } },
      // A quiz made in the course editor: its questions have their own ids.
      { assessment: { answers: { qk3f: "a1x" }, checked: false } },
      { completedAt: "2026-09-29T10:00:00.000Z" },
    ];
    for (const step of steps) expect(hasCourseProgress(progress(step))).toBe(true);
  });
});

describe("mergeCourseProgress", () => {
  it("keeps everything walked locally when nothing overlaps", () => {
    const saved = progress({ courseTitle: "Workplace conflict" });
    expect(mergeCourseProgress(walked, saved)).toEqual(walked);
  });

  it("takes the saved copy where the learner did nothing locally", () => {
    const saved = walked;
    const local = progress({ courseTitle: "Workplace conflict" });
    expect(mergeCourseProgress(local, saved)).toEqual(saved);
  });

  it("lists saved stages in their order, then the new local ones", () => {
    const saved = progress({ stagesCompleted: ["context", "concept"] });
    const local = progress({ stagesCompleted: ["context", "behaviour"] });
    expect(mergeCourseProgress(local, saved).stagesCompleted).toEqual([
      "context",
      "concept",
      "behaviour",
    ]);
  });

  it("prefers the local simulation and assessment answers, per question", () => {
    const saved = progress({
      simulation: { choice: "old", correct: false },
      assessment: { answers: { q1: "saved1", q2: "saved2" }, checked: false },
    });
    const local = progress({
      simulation: { choice: "new", correct: true },
      assessment: { answers: { q2: "local2", q3: "local3" }, checked: false },
    });
    const merged = mergeCourseProgress(local, saved);
    expect(merged.simulation).toEqual({ choice: "new", correct: true });
    expect(merged.assessment).toEqual({
      answers: { q1: "saved1", q2: "local2", q3: "local3" },
      checked: false,
    });
  });

  it("keeps a created quiz's answers under their own ids, and any number of them", () => {
    const ids = ["qk3f", "q9zz", "qa01", "qb02", "qc03"];
    const saved = progress({
      assessment: {
        answers: Object.fromEntries(ids.map((id) => [id, `saved-${id}`])),
        checked: false,
      },
    });
    const local = progress({
      assessment: { answers: { qb02: "local", qnew: "local" }, checked: false },
    });
    expect(mergeCourseProgress(local, saved).assessment.answers).toEqual({
      qk3f: "saved-qk3f",
      q9zz: "saved-q9zz",
      qa01: "saved-qa01",
      qb02: "local",
      qc03: "saved-qc03",
      qnew: "local",
    });
  });

  it("keeps a quick check checked when either side checked it", () => {
    const checked = progress({
      assessment: { answers: { q1: "a", q2: "b", q3: "c" }, checked: true },
    });
    const open = progress({
      assessment: { answers: { q1: "a" }, checked: false },
    });
    expect(mergeCourseProgress(open, checked).assessment.checked).toBe(true);
    expect(mergeCourseProgress(checked, open).assessment.checked).toBe(true);
    expect(mergeCourseProgress(open, open).assessment.checked).toBe(false);
  });

  it("doesn't lock a saved checked quiz over an answer the learner changed while it loaded", () => {
    // Checked on one device; on another, the learner picked a different
    // answer for q1 before the saved progress arrived and hasn't checked it.
    const saved = progress({
      assessment: { answers: { q1: "a", q2: "a", q3: "a" }, checked: true },
    });
    const local = progress({
      assessment: { answers: { q1: "b" }, checked: false },
    });
    expect(mergeCourseProgress(local, saved).assessment).toEqual({
      answers: { q1: "b", q2: "a", q3: "a" },
      checked: false,
    });
  });

  it("keeps the saved simulation when none was made locally", () => {
    const saved = progress({ simulation: { choice: "old", correct: false } });
    expect(mergeCourseProgress(progress(), saved).simulation).toEqual({
      choice: "old",
      correct: false,
    });
  });

  it("takes a scenario path whole — never a local root with a saved follow-up", () => {
    const saved = progress({
      scenario: {
        root: "public",
        followup: "publicEscalate",
        rootLabel: "Say it now",
        followupLabel: "Escalate",
      },
    });
    const started = progress({
      scenario: { root: "private", followup: null, rootLabel: "Wait", followupLabel: null },
    });
    expect(mergeCourseProgress(started, saved).scenario).toEqual(started.scenario);
    expect(mergeCourseProgress(progress(), saved).scenario).toEqual(saved.scenario);
  });

  it("merges reflection answers per field; an empty local answer keeps the saved one", () => {
    const saved = progress({
      reflection: { p1: "Saved one", p2: "Saved two", p3: "" },
    });
    const local = progress({
      reflection: { p1: "", p2: "Typed now", p3: "  " },
    });
    expect(mergeCourseProgress(local, saved).reflection).toEqual({
      p1: "Saved one",
      p2: "Typed now",
      p3: "",
    });
  });

  it("keeps the first completion date", () => {
    const saved = progress({ completedAt: "2026-09-01T09:00:00.000Z" });
    const local = progress({ completedAt: "2026-09-29T10:00:00.000Z" });
    expect(mergeCourseProgress(local, saved).completedAt).toBe(
      "2026-09-01T09:00:00.000Z"
    );
    expect(mergeCourseProgress(local, progress()).completedAt).toBe(
      "2026-09-29T10:00:00.000Z"
    );
  });

  it("shows the local title, else the saved one", () => {
    expect(
      mergeCourseProgress(
        progress({ courseTitle: "Local" }),
        progress({ courseTitle: "Saved" })
      ).courseTitle
    ).toBe("Local");
    expect(
      mergeCourseProgress(progress(), progress({ courseTitle: "Saved" }))
        .courseTitle
    ).toBe("Saved");
  });

  it("doesn't merge two different courses", () => {
    const other = progress({ courseSlug: "other", stagesCompleted: ["context"] });
    expect(mergeCourseProgress(walked, other)).toBe(walked);
  });

  it("leaves both inputs untouched", () => {
    const local = progress({ stagesCompleted: ["concept"] });
    const saved = progress({ stagesCompleted: ["context"] });
    mergeCourseProgress(local, saved);
    expect(local.stagesCompleted).toEqual(["concept"]);
    expect(saved.stagesCompleted).toEqual(["context"]);
  });
});

describe("courseAfterLoad", () => {
  it("changes nothing when the learner has moved to another course", () => {
    const current = progress({ courseSlug: "other", stagesCompleted: ["context"] });
    expect(courseAfterLoad(current, SLUG, walked)).toBeNull();
    expect(courseAfterLoad(current, SLUG, null)).toBeNull();
  });

  it("changes nothing when nothing is saved and nothing was done", () => {
    expect(courseAfterLoad(progress({ courseTitle: "Opened" }), SLUG, null)).toBeNull();
  });

  it("returns a new copy of the local progress when nothing was saved", () => {
    // The bug: a first visit walked while loading was never saved, because
    // the store didn't change once the (empty) saved progress arrived.
    const next = courseAfterLoad(walked, SLUG, null);
    expect(next).toEqual(walked);
    expect(next).not.toBe(walked);
  });

  it("merges instead of replacing when progress was saved", () => {
    // The bug: the saved copy replaced everything done while it loaded.
    const saved = progress({
      stagesCompleted: ["context", "concept"],
      reflection: { p1: "Saved earlier", p2: "", p3: "" },
    });
    const next = courseAfterLoad(walked, SLUG, saved);
    expect(next).toEqual({
      ...walked,
      reflection: { p1: "Saved earlier", p2: "", p3: "" },
    });
  });

  it("shows the saved progress when the learner hasn't done anything yet", () => {
    const next = courseAfterLoad(progress({ courseTitle: "Opened" }), SLUG, walked);
    expect(next).toEqual({ ...walked, courseTitle: "Opened" });
  });

  it("ignores saved progress for a different course", () => {
    const other = progress({ courseSlug: "other", stagesCompleted: ["context"] });
    expect(courseAfterLoad(progress(), SLUG, other)).toBeNull();
    expect(courseAfterLoad(walked, SLUG, other)).toEqual(walked);
  });
});

describe("courseAfterMigration", () => {
  const guest = progress({
    courseTitle: "Workplace conflict",
    stagesCompleted: ["context", "concept"],
    reflection: { p1: "Written as a guest", p2: "", p3: "" },
  });

  it("leaves another course being played alone", () => {
    // The bug: the migrated course replaced it, and that player's steps were
    // then saved under the migrated course.
    const other = progress({
      courseSlug: "receiving-feedback",
      stagesCompleted: ["context"],
    });
    expect(courseAfterMigration(other, guest)).toBeNull();
    expect(
      courseAfterMigration(progress({ courseSlug: "receiving-feedback" }), guest)
    ).toBeNull();
  });

  it("merges into the same course, keeping steps taken while the account loaded", () => {
    // The bug: the migrated copy replaced them.
    const current = progress({
      courseTitle: "Workplace conflict",
      stagesCompleted: ["context", "concept", "behaviour", "simulation"],
      simulation: { choice: "iStatement", correct: true },
    });
    expect(courseAfterMigration(current, guest)).toEqual({
      ...current,
      reflection: { p1: "Written as a guest", p2: "", p3: "" },
    });
  });

  it("shows the migrated course when no course is being played", () => {
    const next = courseAfterMigration(progress({ courseSlug: null }), guest);
    expect(next).toEqual(guest);
    expect(next).not.toBe(guest);
  });

  it("ignores a migrated course without a slug", () => {
    expect(
      courseAfterMigration(progress(), progress({ courseSlug: null }))
    ).toBeNull();
  });
});

describe("mergeCompCardOnHydrate", () => {
  const blank: CompCardData = {
    wentWell: "",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 3,
    privacy: "facilitator",
    updatedAt: null,
  };
  const saved: CompCardData = {
    wentWell: "Saved: stayed calm",
    difficult: "Saved: speaking up",
    improve: "Saved: ask sooner",
    behaviour: "",
    confidence: 4,
    privacy: "facilitatorAndMentor",
    updatedAt: "2026-09-01T09:00:00.000Z",
  };
  const typedAt = "2026-09-29T10:00:00.000Z";

  it("takes the saved card when nothing was entered", () => {
    expect(mergeCompCardOnHydrate(blank, saved, blank)).toBe(saved);
  });

  it("keeps the local card when none is saved", () => {
    const local = { ...blank, improve: "Typed", updatedAt: typedAt };
    expect(mergeCompCardOnHydrate(local, null, blank)).toBe(local);
    expect(mergeCompCardOnHydrate(blank, null, blank)).toBe(blank);
  });

  it("keeps text typed before the saved card arrived, and the saved rest", () => {
    // The bug: the saved card replaced the typed text, and was written back.
    const local = {
      ...blank,
      improve: "Typed before it loaded",
      behaviour: "Asked what they meant",
      updatedAt: typedAt,
    };
    expect(mergeCompCardOnHydrate(local, saved, blank)).toEqual({
      ...saved,
      improve: "Typed before it loaded",
      behaviour: "Asked what they meant",
      updatedAt: typedAt,
    });
  });

  it("keeps the saved text where only whitespace was typed", () => {
    const local = { ...blank, wentWell: "  \n", updatedAt: typedAt };
    expect(mergeCompCardOnHydrate(local, saved, blank).wentWell).toBe(
      "Saved: stayed calm"
    );
  });

  it("keeps a confidence or privacy changed from the blank card's, else the saved one", () => {
    const changed = {
      ...blank,
      confidence: 2,
      privacy: "self" as const,
      updatedAt: typedAt,
    };
    expect(mergeCompCardOnHydrate(changed, saved, blank)).toMatchObject({
      confidence: 2,
      privacy: "self",
    });
    const untouched = { ...blank, improve: "Typed", updatedAt: typedAt };
    expect(mergeCompCardOnHydrate(untouched, saved, blank)).toMatchObject({
      confidence: 4,
      privacy: "facilitatorAndMentor",
    });
  });
});

describe("mergeBadges", () => {
  it("keeps a badge earned before the saved ones arrived", () => {
    expect(mergeBadges(["team-player"], ["voice-without-edges"])).toEqual([
      "team-player",
      "voice-without-edges",
    ]);
    expect(mergeBadges([], ["voice-without-edges"])).toEqual([
      "voice-without-edges",
    ]);
  });

  it("lists each badge once, the server's first", () => {
    expect(mergeBadges(["a", "b"], ["b", "c", "a"])).toEqual(["a", "b", "c"]);
    expect(mergeBadges(["a"], [])).toEqual(["a"]);
  });
});

describe("guestStateAfterHydrate", () => {
  const blankCard: CompCardData = {
    wentWell: "",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 3,
    privacy: "facilitator",
    updatedAt: null,
  };
  const blank: DemoState = {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: { ...progress(), courseSlug: null },
    compCard: blankCard,
  };
  /** Earlier, as a guest: two lessons and an answer, and a badge. */
  const stored: DemoState = {
    ...blank,
    badges: ["voice-without-edges"],
    course: progress({
      courseTitle: "Workplace conflict",
      stagesCompleted: ["context", "concept"],
      reflection: { p1: "Stored", p2: "", p3: "" },
    }),
    compCard: { ...blankCard, wentWell: "Stored card", updatedAt: "2026-09-28T09:00:00.000Z" },
  };

  it("is the stored progress when nothing was done before it was read", () => {
    expect(guestStateAfterHydrate(blank, stored, blank)).toEqual(stored);
  });

  it("keeps another course being played: its steps are never recorded against the stored one", () => {
    const other: DemoState = {
      ...blank,
      course: progress({
        courseSlug: "receiving-feedback",
        courseTitle: "Receiving feedback",
      }),
    };
    const after = guestStateAfterHydrate(other, stored, blank);
    expect(after.course).toEqual(other.course);
    expect(after.badges).toEqual(["voice-without-edges"]);
    expect(after.compCard).toEqual(stored.compCard);
  });

  it("merges the same course with the steps taken before it was read", () => {
    const early: DemoState = {
      ...blank,
      course: progress({
        courseTitle: "Workplace conflict",
        stagesCompleted: ["context", "concept", "behaviour"],
      }),
    };
    expect(guestStateAfterHydrate(early, stored, blank).course).toMatchObject({
      courseSlug: SLUG,
      stagesCompleted: ["context", "concept", "behaviour"],
      reflection: { p1: "Stored" },
    });
  });

  it("keeps a completion and a badge earned before it was read", () => {
    const finished: DemoState = {
      ...blank,
      badges: ["feedback-as-fuel"],
      course: walked,
    };
    const after = guestStateAfterHydrate(finished, stored, blank);
    expect(after.badges).toEqual(["voice-without-edges", "feedback-as-fuel"]);
    expect(after.course.completedAt).toBe(walked.completedAt);
  });

  it("keeps Comp Card text entered before it was read", () => {
    const typing: DemoState = {
      ...blank,
      compCard: { ...blankCard, improve: "Typed early", updatedAt: "2026-09-29T10:00:00.000Z" },
    };
    expect(guestStateAfterHydrate(typing, stored, blank).compCard).toMatchObject({
      wentWell: "Stored card",
      improve: "Typed early",
    });
  });
});

describe("storedGuestState", () => {
  const blank: DemoState = {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: { ...progress(), courseSlug: null },
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

  it("keeps a guest's quick-check answers and whether they were checked", () => {
    const course = progress({
      stagesCompleted: ["context"],
      assessment: { answers: { qk3f: "a1x", q9zz: "a4x" }, checked: true },
    });
    expect(storedGuestState({ ...blank, course }, blank).course).toEqual(course);
  });

  it("reads a guest store written before answers were kept as a quick check not yet answered", () => {
    const before = {
      ...blank,
      course: {
        ...progress({ stagesCompleted: ["context", "concept"] }),
        assessment: { q1: null, q2: null, q3: null },
      },
    };
    const after = storedGuestState(before, blank);
    expect(after.course.assessment).toEqual({ answers: {}, checked: false });
    expect(after.course.stagesCompleted).toEqual(["context", "concept"]);
  });

  it("fills in what a stored copy lacks from the empty store", () => {
    const after = storedGuestState({ badges: ["b"], course: { courseSlug: SLUG } }, blank);
    expect(after.badges).toEqual(["b"]);
    expect(after.course).toEqual({ ...blank.course, courseSlug: SLUG });
    expect(after.compCard).toEqual(blank.compCard);
  });

  it("is the empty store for something that isn't a stored copy", () => {
    expect(storedGuestState("nonsense", blank)).toEqual(blank);
    expect(storedGuestState(null, blank)).toEqual(blank);
  });
});
