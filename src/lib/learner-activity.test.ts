import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * D117: the rules the activity records keep (src/lib/learner-activity.ts).
 * - A course is one learners get: published to open it; published, or
 *   published once, to keep playing it (D62.f).
 * - A lesson is one of the course's: a built-in course's seven standard
 *   lessons; a created course's lesson plan, shown or not (and under the
 *   kill switch the standard lessons Release 1 shows), reading only what
 *   decides the lesson asked about.
 * - An in-video answer is to a question of one of the course's videos: an
 *   editor's, or the one a built-in course ships.
 * - Time added to a lesson's record is never more than the time since it
 *   was last added to; a first write (or a record from before) at most an
 *   hour.
 * - A course opened counts once per clock hour.
 * - 120 calls in 10 minutes per learner, keyed by their id; one call at a
 *   time per record.
 */

vi.mock("server-only", () => ({}));
const course = { findUnique: vi.fn() };
const lesson = { findUnique: vi.fn(), findMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { course, lesson } }));
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

const {
  ACTIVITY_LIMIT,
  activityAllowed,
  activityCourse,
  creditedSeconds,
  cueIdsOf,
  hourOf,
  isLessonOf,
  lessonsWithCue,
  oneAtATime,
  opensToLearners,
  takesActivity,
} = await import("./learner-activity");
type Course = Parameters<typeof isLessonOf>[0];

/** A course created in the CMS, published, with the stored lesson list `sections`. */
const created = (sections: unknown[] | null, over: Partial<Course> = {}): Course => ({
  slug: "speaking-up",
  meta: { en: { title: "Speaking up" } },
  outline: sections === null ? null : { v: 1, sections },
  status: "published",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  ...over,
});
const builtIn = (over: Partial<Course> = {}): Course => ({
  slug: "workplace-conflict",
  meta: null,
  outline: null,
  status: "published",
  publishedAt: new Date("2026-06-13T10:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  lesson.findUnique.mockResolvedValue(null);
  lesson.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("the course", () => {
  it("is read by its slug in the project, without its content", async () => {
    course.findUnique.mockResolvedValue(null);
    await expect(activityCourse("speaking-up")).resolves.toBeNull();
    expect(course.findUnique).toHaveBeenCalledWith({
      where: { projectId_slug: { projectId: "seq-elevate", slug: "speaking-up" } },
      select: { slug: true, meta: true, outline: true, status: true, publishedAt: true },
    });
  });

  it.each([
    ["published", null, true, true],
    ["published", new Date(), true, true],
    ["archived, published once", new Date(), false, true],
    ["draft, published once", new Date(), false, true],
    ["draft, never published", null, false, false],
    ["archived, never published", null, false, false],
  ])("%s: opens to learners %s, takes their activity %s", (label, publishedAt, opens, takes) => {
    const status = label.split(",")[0];
    expect(opensToLearners({ status })).toBe(opens);
    expect(takesActivity({ status, publishedAt: publishedAt as Date | null })).toBe(takes);
  });
});

describe("isLessonOf", () => {
  it("takes a built-in course's seven standard lessons, and nothing else, reading no lesson", async () => {
    for (const stage of ["context", "concept", "behaviour", "simulation", "scenario", "reflection", "assessment"]) {
      await expect(isLessonOf(builtIn(), stage)).resolves.toBe(true);
    }
    await expect(isLessonOf(builtIn(), "s-abcdefgh")).resolves.toBe(false);
    await expect(isLessonOf(builtIn(), "complete")).resolves.toBe(false);
    expect(lesson.findUnique).not.toHaveBeenCalled();
  });

  it("takes a created course's own lesson only when its lesson list has it, hidden or not", async () => {
    const c = created([{ id: "context" }, { id: "s-abcdefgh", template: "text" }, { id: "s-hidden00", template: "text", hidden: true }]);
    await expect(isLessonOf(c, "s-abcdefgh")).resolves.toBe(true);
    await expect(isLessonOf(c, "s-hidden00")).resolves.toBe(true);
    await expect(isLessonOf(c, "s-zzzzzzzz")).resolves.toBe(false);
    await expect(isLessonOf(c, "intro")).resolves.toBe(false);
    expect(lesson.findUnique).not.toHaveBeenCalled();
  });

  it("takes a standard text lesson unless the list deleted it", async () => {
    const c = created([{ id: "context" }, { id: "concept" }, { id: "reflection" }]);
    (c.outline as { removed: string[] }).removed = ["behaviour"];
    await expect(isLessonOf(c, "concept")).resolves.toBe(true);
    // Not listed and not deleted: put back where it belongs (resolveOutline).
    await expect(isLessonOf(created([{ id: "context" }]), "behaviour")).resolves.toBe(true);
    await expect(isLessonOf(c, "behaviour")).resolves.toBe(false);
  });

  it("under R2_LEARNER_PLAYER=off also takes the text lessons Release 1 shows", async () => {
    vi.stubEnv("R2_LEARNER_PLAYER", "off");
    const c = created([{ id: "context" }]);
    (c.outline as { removed: string[] }).removed = ["behaviour"];
    await expect(isLessonOf(c, "behaviour")).resolves.toBe(true);
  });

  it("takes a standard exercise not in the list when its own row has one saved, reading that row only", async () => {
    const c = created(null);
    await expect(isLessonOf(c, "simulation")).resolves.toBe(false);
    expect(lesson.findUnique).toHaveBeenCalledWith({
      where: { projectId_courseSlug_stageKey: { projectId: "seq-elevate", courseSlug: "speaking-up", stageKey: "simulation" } },
      select: { stageKey: true, structure: true, parts: true },
    });
    lesson.findUnique.mockResolvedValue({ stageKey: "simulation", structure: { kind: "simulation" }, parts: null });
    await expect(isLessonOf(c, "simulation")).resolves.toBe(true);
    // A text lesson of the derived list needs no row.
    lesson.findUnique.mockClear();
    await expect(isLessonOf(c, "context")).resolves.toBe(true);
    expect(lesson.findUnique).not.toHaveBeenCalled();
  });

  it("takes a standard exercise the list names, row or not", async () => {
    await expect(isLessonOf(created([{ id: "context" }, { id: "assessment" }]), "assessment")).resolves.toBe(true);
  });
});

describe("lessonsWithCue", () => {
  const video = (...ids: string[]) => ({ provider: "file", src: "/v.mp4", cues: ids.map((id) => ({ id, atSeconds: 1 })) });

  it("finds a question of a video an editor attached, by the lessons whose video asks it", async () => {
    lesson.findMany.mockResolvedValue([
      { stageKey: "context", video: null },
      { stageKey: "s-abcdefgh", video: video("cue-1", "cue-2") },
      { stageKey: "concept", video: video("cue-3") },
    ]);
    await expect(lessonsWithCue(created([]), "cue-2")).resolves.toEqual(["s-abcdefgh"]);
    await expect(lessonsWithCue(created([]), "cue-9")).resolves.toEqual([]);
    expect(lesson.findMany).toHaveBeenCalledWith({
      where: { projectId: "seq-elevate", courseSlug: "speaking-up" },
      select: { stageKey: true, video: true },
    });
  });

  it("finds the question a built-in course ships (the hero course's demo video), and not for a created course", async () => {
    await expect(lessonsWithCue(builtIn(), "concept-check")).resolves.toEqual(["concept"]);
    await expect(lessonsWithCue(builtIn({ slug: "receiving-feedback" }), "concept-check")).resolves.toEqual([]);
    await expect(lessonsWithCue(created([]), "concept-check")).resolves.toEqual([]);
  });

  it("reads only a stored video's question ids", () => {
    expect(cueIdsOf(video("a", "b"))).toEqual(["a", "b"]);
    expect(cueIdsOf({ cues: [{ id: 7 }, null, "x", { id: "ok" }] })).toEqual(["ok"]);
    expect(cueIdsOf({ cues: "cue-1" })).toEqual([]);
    expect(cueIdsOf(null)).toEqual([]);
    expect(cueIdsOf([video("a")])).toEqual([]);
  });
});

describe("creditedSeconds", () => {
  const NOW = new Date("2026-12-01T10:15:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it.each([
    ["a first write: what was sent", 42, undefined, 42],
    ["a first write, or a record from before D117 (no time kept): at most an hour", 99_999, undefined, 3600],
    ["a time that can't be read: as a first write", 99_999, "yesterday", 3600],
    ["within the time since it was last added to", 120, ago(300_000), 120],
    ["no more than the time since then", 600, ago(20_000), 20],
    ["the player's rounding up is taken (2.5 s sent as 3)", 3, ago(2_400), 3],
    ["never more than an hour, however long since", 99_999, ago(86_400_000), 3600],
    ["nothing when no time has passed", 30, ago(0), 0],
    ["nothing when the time kept is later", 30, ago(-5_000), 0],
    ["half a second or less sent: nothing", 0.4, undefined, 0],
  ])("%s", (_name, seconds, lastAddedAt, credited) => {
    expect(creditedSeconds(seconds, lastAddedAt, NOW)).toBe(credited);
  });
});

describe("hourOf", () => {
  it("is the start of the clock hour", () => {
    expect(hourOf(new Date("2026-12-01T10:59:59.999Z")).toISOString()).toBe("2026-12-01T10:00:00.000Z");
    expect(hourOf(new Date("2026-12-01T11:00:00.000Z")).toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });
});

describe("activityAllowed", () => {
  it("counts the learner's calls under their id: 120 in 10 minutes", async () => {
    checkRateLimit.mockResolvedValue({ ok: true, count: 1, limit: 120 });
    await expect(activityAllowed("u1")).resolves.toBe(true);
    expect(checkRateLimit).toHaveBeenCalledWith("activity:u1", { limit: 120, windowMs: 600_000 });
    expect(ACTIVITY_LIMIT).toEqual({ limit: 120, windowMs: 600_000 });
    checkRateLimit.mockResolvedValue({ ok: false, count: 121, limit: 120 });
    await expect(activityAllowed("u1")).resolves.toBe(false);
  });
});

describe("oneAtATime", () => {
  it("takes a transaction-level advisory lock on the record's key, reading no table", async () => {
    const $executeRaw = vi.fn().mockResolvedValue(1);
    await oneAtATime({ $executeRaw } as never, "stage.time:u1:speaking-up:context");
    const [sql, ...values] = $executeRaw.mock.calls[0];
    expect((sql as string[]).join("?")).toBe("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))");
    expect(values).toEqual(["stage.time:u1:speaking-up:context"]);
  });
});
