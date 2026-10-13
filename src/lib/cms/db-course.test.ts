import { describe, it, expect, afterEach, vi } from "vitest";

// A created course's badge must be named on the learner's dashboard, and the
// player must award the badge the course is linked to (C9).
const prisma = {
  course: { findMany: vi.fn(), findFirst: vi.fn() },
  lesson: { findMany: vi.fn() },
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));

const { listDbCourses, getDbCourse } = await import("./db-course");

const META = {
  en: { title: "Speaking up", tagline: "Say what you need", clusterLabel: "Communication" },
  de: { title: "Sich äußern", tagline: "Sag, was du brauchst", clusterLabel: "Kommunikation" },
};
const row = (badge: { slug: string } | null) => ({
  id: "course-1",
  projectId: "seq-elevate",
  slug: "speaking-up",
  cluster: "communicationEi",
  durationMinutes: 15,
  status: "published",
  meta: META,
  badgeId: badge ? "badge-1" : null,
  badge,
});

describe("listDbCourses", () => {
  afterEach(() => vi.clearAllMocks());

  it("names each created course's badge, in the learner's language", async () => {
    prisma.course.findMany.mockResolvedValue([row({ slug: "speaking-up-complete-2" })]);
    const [summary] = await listDbCourses("seq-elevate", "de");
    expect(summary).toMatchObject({
      slug: "speaking-up",
      badgeSlug: "speaking-up-complete-2",
      badgeName: "Sich äußern",
      badgeMeaning: "Sag, was du brauchst",
    });
  });
});

describe("getDbCourse", () => {
  afterEach(() => vi.clearAllMocks());

  it("awards the badge the course is linked to", async () => {
    prisma.course.findFirst.mockResolvedValue(row({ slug: "speaking-up-complete-2" }));
    prisma.lesson.findMany.mockResolvedValue([]);
    const course = await getDbCourse("seq-elevate", "speaking-up", "en");
    expect(course?.badge).toEqual({
      slug: "speaking-up-complete-2",
      name: "Speaking up",
      meaning: "Say what you need",
    });
  });

  it("keeps the usual slug for a course not linked to a badge yet", async () => {
    prisma.course.findFirst.mockResolvedValue(row(null));
    prisma.lesson.findMany.mockResolvedValue([]);
    const course = await getDbCourse("seq-elevate", "speaking-up", "en");
    expect(course?.badge.slug).toBe("speaking-up-complete");
  });
});
