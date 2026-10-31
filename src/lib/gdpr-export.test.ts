import { describe, it, expect, vi } from "vitest";

/*
 * U11 (Release 2, spec 6): "Download my data" holds everything the learner's
 * enrolments keep — Release 2's lessons of the course's own and answers per
 * item too — by name, as stored.
 *
 * UD2 (Release 3, spec 13.3, D87): it also holds the profile (country,
 * organisation, Terms, age statement, consent, the guardian's permission by
 * date only, the test-account mark, whether and since when the person held
 * a staff role), the Comp Card's sharing as the learner sees it, the
 * activity records, the log entries about the person (action and date, not
 * who), sessions and pending sign-in links (count and expiry, never a
 * token), and, for staff, how many notes they wrote (not the text). Notes
 * about the person are signed "a facilitator at ‹organisation›", never by
 * name.
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

const card = (over: Record<string, unknown> = {}) => ({
  id: "card-1",
  project: { name: "SEQ Elevate" },
  projectId: "seq-elevate",
  wentWell: "my own words",
  difficult: "",
  improve: "",
  behaviour: "",
  confidence: 4,
  privacy: "FACILITATOR",
  sharedAt: day(10),
  sharedWithOrganisationId: "org-a",
  sharedWithOrganisation: { name: "Pro Arbeit" },
  sharingVersion: "2026-11-20",
  updatedAt: day(11),
  entries: [],
  ...over,
});

const PROFILE = {
  id: "profile-1",
  projectId: "seq-elevate",
  country: "DE",
  organisationId: "org-a",
  organisation: { name: "Pro Arbeit" },
  organisationSource: "country",
  profileCompletedAt: day(3),
  termsVersion: "2026-11-20",
  termsAcceptedAt: day(3),
  ageRule: "INVITED_WITH_GUARDIAN_CONSENT",
  ageConfirmedAt: day(3),
  consentVersion: null,
  consentAt: null,
  guardianConsentRecordedAt: new Date(Date.UTC(2026, 10, 2, 14, 35)),
  guardianSharingConsentAt: null,
  testAccountAt: day(4),
};

let user: Record<string, unknown>;
function reset(over: Record<string, unknown> = {}) {
  user = {
    id: "u1",
    email: "ana@example.test",
    name: "Ana",
    emailVerified: day(1),
    createdAt: day(1),
    updatedAt: day(5),
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
    profiles: [PROFILE],
    staffHistory: [],
    sessions: [{ expires: day(30), sessionToken: "secret-session-token" }],
    _count: { observations: 0, validations: 0 },
    ...over,
  };
}
reset();

const ACTIVITY = [
  { action: "course.opened", entityId: "saying-no", metadata: { courseSlug: "saying-no" }, createdAt: day(6) },
  {
    action: "stage.time",
    entityId: "saying-no:s-abcdefgh",
    metadata: { courseSlug: "saying-no", stage: "s-abcdefgh", seconds: 95 },
    createdAt: day(6),
  },
  {
    action: "video.cue_answered",
    entityId: "cue-7",
    metadata: { courseSlug: "saying-no", correct: true, lessonId: "s-abcdefgh" },
    createdAt: day(7),
  },
];
const ABOUT = [
  { action: "member.added", createdAt: day(1) },
  { action: "account.test_marked", createdAt: day(4) },
];

/** Organisation changes of note authors' profiles (person.organisation_changed), by profile id. */
let MOVES: { entityId: string; createdAt: Date }[] = [];
const auditLog = {
  findMany: vi.fn(async (args: { where: { actorId?: string; entityId?: unknown; action?: unknown } }) =>
    args.where.actorId ? ACTIVITY : args.where.action === "person.organisation_changed" ? MOVES : ABOUT
  ),
};
const verificationToken = {
  findMany: vi.fn(async () => [{ expires: day(21), token: "secret-link-token" }]),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => user },
    auditLog,
    verificationToken,
  },
}));

const { collectUserData } = await import("./gdpr-export");

describe("collectUserData", () => {
  it("exports each course's lessons of its own and answers per item, by name", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.courses[0]).toMatchObject({
      course: "saying-no",
      stagesCompleted: ["CONTEXT"],
      sectionsCompleted: ["s-abcdefgh"],
      responses: RESPONSES,
    });
  });

  it("exports none as an empty list and null", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.courses[1]).toMatchObject({
      course: "workplace-conflict",
      sectionsCompleted: [],
      responses: null,
    });
  });
});

describe("collectUserData: what Release 3 adds (UD2)", () => {
  it("says what the file holds", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.notice).toMatch(/activity records/);
    expect(data?.notice).toMatch(/notes staff wrote about you/);
    expect(data?.notice).toMatch(/Art\. 15/);
  });

  it("holds the account's sign-in date and last change", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.account).toMatchObject({
      emailVerified: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
    });
  });

  it("holds the profile: country, organisation, Terms, age statement, guardian's permission by date only, test mark", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.profile).toEqual({
      project: "seq-elevate",
      country: "DE",
      organisation: "Pro Arbeit",
      completedAt: "2026-11-03T00:00:00.000Z",
      termsVersion: "2026-11-20",
      termsAcceptedAt: "2026-11-03T00:00:00.000Z",
      ageStatement: "invited with a parent's or guardian's permission",
      ageConfirmedAt: "2026-11-03T00:00:00.000Z",
      consent: null,
      guardianPermissionRecordedOn: "2026-11-02",
      guardianPermissionCoversSharingOn: null,
      markedAsTestAccountAt: "2026-11-04T00:00:00.000Z",
    });
  });

  it("says whether and since when the person held a staff role", async () => {
    reset();
    expect((await collectUserData("u1"))?.staffRole).toBeNull();
    reset({ staffHistory: [{ projectId: "seq-elevate", firstAt: day(2), firstRole: "FACILITATOR" }] });
    expect((await collectUserData("u1"))?.staffRole).toEqual({ since: "2026-11-02T00:00:00.000Z", firstRole: "FACILITATOR" });
  });

  it("gives the Comp Card's sharing as the learner sees it, not the stored value", async () => {
    reset({ compCards: [card()] });
    let c = (await collectUserData("u1"))?.compCards[0];
    expect(c).toMatchObject({ sharing: "facilitators", sharedAt: "2026-11-10T00:00:00.000Z", sharedWith: "Pro Arbeit" });
    expect(c).not.toHaveProperty("sharingChoice");
    expect(c).not.toHaveProperty("privacy");
    // Stored as shared, but never through the sharing step (no sharedAt): "Only me".
    reset({ compCards: [card({ sharedAt: null })] });
    c = (await collectUserData("u1"))?.compCards[0];
    expect(c).toMatchObject({ sharing: "onlyMe", sharedAt: null, sharedWith: null });
    // Shared with an organisation the learner has left: "Only me".
    reset({ compCards: [card({ sharedWithOrganisationId: "org-b", sharedWithOrganisation: { name: "Synthesis" } })] });
    c = (await collectUserData("u1"))?.compCards[0];
    expect(c).toMatchObject({ sharing: "onlyMe", sharedWith: null });
  });

  it("holds the activity records: courses opened, time on lessons, video answers", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { actorId: "u1", action: { in: ["course.opened", "stage.time", "video.cue_answered"] } },
      })
    );
    expect(data?.activity).toEqual({
      coursesOpened: [{ course: "saying-no", at: "2026-11-06T00:00:00.000Z" }],
      timeOnLessons: [{ course: "saying-no", lesson: "s-abcdefgh", seconds: 95, since: "2026-11-06T00:00:00.000Z" }],
      videoAnswers: [{ course: "saying-no", lesson: "s-abcdefgh", cue: "cue-7", correct: true, at: "2026-11-07T00:00:00.000Z" }],
    });
  });

  it("holds the log entries about the person: action and date, not who", async () => {
    reset({ compCards: [card()] });
    const data = await collectUserData("u1");
    const about = auditLog.findMany.mock.calls.filter(([a]) => !a.where.actorId && !a.where.action).at(-1)?.[0] as {
      where: { entityId: { in: string[] } };
      select: Record<string, boolean>;
    };
    expect(about.where.entityId.in.sort()).toEqual(["card-1", "profile-1", "u1"]);
    expect(Object.keys(about.select).sort()).toEqual(["action", "createdAt"]);
    expect(data?.logEntriesAboutYou).toEqual([
      { action: "member.added", at: "2026-11-01T00:00:00.000Z" },
      { action: "account.test_marked", at: "2026-11-04T00:00:00.000Z" },
    ]);
  });

  it("counts sessions and pending sign-in links with their expiry, and never holds a token", async () => {
    reset();
    const data = await collectUserData("u1");
    expect(data?.sessions).toEqual({ count: 1, expires: ["2026-11-30T00:00:00.000Z"] });
    expect(data?.pendingSignInLinks).toEqual({ count: 1, expires: ["2026-11-21T00:00:00.000Z"] });
    const text = JSON.stringify(data);
    expect(text).not.toContain("secret-session-token");
    expect(text).not.toContain("secret-link-token");
    expect(verificationToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { identifier: { equals: "ana@example.test", mode: "insensitive" } } })
    );
  });

  it("signs notes and validations about the person by organisation, never by name", async () => {
    reset({
      observedNotes: [
        { note: "Kept going", createdAt: day(8), observer: { name: "Fritz", email: "fritz@x.de", profiles: [{ organisation: { name: "Pro Arbeit" } }] } },
        { note: "Asked for help", createdAt: day(9), observer: null },
      ],
      validatedNotes: [
        { cluster: "communication", evidence: "Spoke up", createdAt: day(9), validator: { name: "Eva", email: "eva@x.de", profiles: [] } },
      ],
    });
    const data = await collectUserData("u1");
    expect(data?.facilitatorObservationsAboutYou).toEqual([
      { note: "Kept going", createdAt: "2026-11-08T00:00:00.000Z", by: "a facilitator at Pro Arbeit" },
      { note: "Asked for help", createdAt: "2026-11-09T00:00:00.000Z", by: "a member of staff" },
    ]);
    expect(data?.skillValidationsAboutYou).toEqual([
      { cluster: "communication", evidence: "Spoke up", createdAt: "2026-11-09T00:00:00.000Z", by: "a member of staff" },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/Fritz|Eva|fritz@|eva@/);
  });

  it("counts the notes and validations a staff member wrote, without their text", async () => {
    reset();
    expect((await collectUserData("u1"))?.notesYouWrote).toBeNull();
    reset({ _count: { observations: 3, validations: 1 } });
    expect((await collectUserData("u1"))?.notesYouWrote).toEqual({ notes: 3, validations: 1 });
  });
});

/*
 * The file says what each value is (Art. 15): an organisation recorded on
 * a membership before profiles were introduced is labelled as such, not given as
 * the person's organisation; a note is signed with its author's
 * organisation only while the author hasn't moved since writing it; a
 * shared card carries the version of the wording the learner shared under.
 */
describe("collectUserData: what each value is", () => {
  it("labels an organisation recorded on a membership before Release 3: no longer used, the profile's is the person's", async () => {
    reset({
      memberships: [
        {
          project: { name: "SEQ Elevate" },
          role: "LEARNER",
          organisation: { name: "Synthesis" },
          cohort: null,
          createdAt: day(1),
        },
        { project: { name: "SEQ Elevate" }, role: "FACILITATOR", organisation: null, cohort: null, createdAt: day(2) },
      ],
    });
    const data = await collectUserData("u1");
    expect(data?.profile?.organisation).toBe("Pro Arbeit");
    expect(data?.memberships[0]).not.toHaveProperty("organisation");
    expect(data?.memberships[0]).toMatchObject({
      role: "LEARNER",
      earlierOrganisation: {
        name: "Synthesis",
        note: expect.stringMatching(/before profiles were introduced.*no longer used.*profile/),
      },
    });
    expect(data?.memberships[1]).toMatchObject({ role: "FACILITATOR", earlierOrganisation: null });
  });

  it("signs a note with its author's organisation only while the author hasn't moved since writing it", async () => {
    const author = (profileId: string) => ({
      name: "Fritz",
      email: "fritz@x.de",
      profiles: [{ id: profileId, organisation: { name: "Synthesis" } }],
    });
    MOVES = [{ entityId: "pp-moved", createdAt: day(12) }, { entityId: "pp-stayed", createdAt: day(5) }];
    reset({
      observedNotes: [
        { note: "Before the move", createdAt: day(8), observer: author("pp-moved") },
        { note: "After an earlier move", createdAt: day(8), observer: author("pp-stayed") },
      ],
      validatedNotes: [{ cluster: "communication", evidence: "Spoke up", createdAt: day(13), validator: author("pp-moved") }],
    });
    const data = await collectUserData("u1");
    expect(data?.facilitatorObservationsAboutYou.map((n) => n.by)).toEqual(["a member of staff", "a facilitator at Synthesis"]);
    expect(data?.skillValidationsAboutYou.map((n) => n.by)).toEqual(["a facilitator at Synthesis"]);
    const moves = auditLog.findMany.mock.calls.find(([a]) => a.where.action === "person.organisation_changed")?.[0] as {
      where: { entityId: { in: string[] } };
    };
    expect([...moves.where.entityId.in].sort()).toEqual(["pp-moved", "pp-stayed"]);
    MOVES = [];
  });

  it("gives a shared card's wording version: what the learner shared under", async () => {
    reset({ compCards: [card()] });
    expect((await collectUserData("u1"))?.compCards[0]).toMatchObject({ sharing: "facilitators", sharingVersion: "2026-11-20" });
    reset({ compCards: [card({ sharedAt: null })] });
    expect((await collectUserData("u1"))?.compCards[0]).toMatchObject({ sharing: "onlyMe", sharingVersion: null });
  });
});
