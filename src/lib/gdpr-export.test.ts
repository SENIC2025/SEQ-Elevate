import { describe, it, expect, vi } from "vitest";

/*
 * U11 (spec 6): "Download my data" holds everything the learner's
 * enrolments keep — Release 2's lessons of the course's own and answers per
 * item too — by name, as stored.
 */

vi.mock("server-only", () => ({}));

const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const enrolment = (sectionsCompleted: unknown, responses: unknown) => ({
  course: { slug: "saying-no" },
  stagesCompleted: ["CONTEXT"],
  sectionsCompleted,
  responses,
  completedAt: null,
  simulationChoice: null,
  simulationCorrect: null,
  scenarioRoot: null,
  scenarioFollowup: null,
  reflection: {},
  assessment: {},
  enrolledAt: day(1),
});

const RESPONSES = {
  v: 1,
  items: {
    "s-abcdefgh/p-12345678": {
      type: "rating",
      values: { s1: 4 },
      at: "2026-11-02T10:00:00.000Z",
    },
  },
};
const enrolments = vi.fn(() => [
  enrolment(["s-abcdefgh"], RESPONSES),
  { ...enrolment(null, null), course: { slug: "workplace-conflict" } },
]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: "u1",
        email: "ana@example.test",
        name: "Ana",
        createdAt: day(1),
        fontSize: "normal",
        dyslexic: false,
        contrast: false,
        memberships: [],
        enrollments: enrolments(),
        compCards: [],
        badges: [],
        missionProgress: [],
        observedNotes: [],
        validatedNotes: [],
      }),
    },
  },
}));

const { collectUserData } = await import("./gdpr-export");

describe("collectUserData", () => {
  it("exports each course's lessons of its own and answers per item, by name", async () => {
    const data = await collectUserData("u1");
    expect(data?.courses[0]).toMatchObject({
      course: "saying-no",
      stagesCompleted: ["CONTEXT"],
      sectionsCompleted: ["s-abcdefgh"],
      responses: RESPONSES,
    });
  });

  it("exports none as an empty list and null", async () => {
    const data = await collectUserData("u1");
    expect(data?.courses[1]).toMatchObject({
      course: "workplace-conflict",
      sectionsCompleted: [],
      responses: null,
    });
  });
});
