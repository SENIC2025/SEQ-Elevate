import type { BrowserContext } from "@playwright/test";
import type { Country, PrismaClient, Role } from "@prisma/client";
import { currentTermsVersion } from "../../src/lib/profile";

/**
 * Release 3 (spec 5.8, 18.2): the ONE place an end-to-end spec makes a
 * person — a user, their roles in the project, their profile and a live
 * session — so every spec makes people the way Release 3 expects them
 * (e2e/fixtures/no-direct-sessions.test.ts keeps it that way).
 *
 * A person's profile is complete by default: a name (their address unless
 * the spec gives one), a country, the current Terms version and the age
 * rule, as the profile step leaves it.
 * Release 3 gives staff whose own profile isn't complete no learner data
 * (scope.ts), so a spec that needs an incomplete profile asks for it
 * (`profile: "none"`).
 *
 * Organisations (D72, D74): a person's organisation is their profile's.
 * Learners (and people with no role) get organisation A by default, as the
 * default country mapping places a learner from Germany (DE → Pro Arbeit);
 * staff get none unless a spec gives one, as an ADMIN sets staff
 * organisations. A facilitator or partner admin sees only the learners of
 * their own organisation, so staff who must see a spec's learners get
 * organisation A (or the ADMIN role, which sees the whole project).
 *
 * The same spec runs on the old build (spec 17): where the database has no
 * ProjectProfile table, no profile is made, and roles the database doesn't
 * know (PARTNER_ADMIN) are left out and reported in `droppedRoles`.
 *
 * Everything a spec makes should be unique to its run and removed
 * afterwards (removePeople, or the spec's own user.deleteMany: memberships,
 * profiles and sessions go with the user).
 */

export const PROJECT = "seq-elevate";

/** The seeded partner organisations, as prisma/seed.ts makes them and the default country mapping uses them. */
export const ORGANISATIONS = {
  A: "seq-elevate-proarbeit",
  B: "seq-elevate-synthesis",
  DIESIS: "seq-elevate-diesis",
} as const;
export type OrganisationKey = keyof typeof ORGANISATIONS;

/** The country whose learners the default mapping gives each organisation. */
const COUNTRY_OF: Record<OrganisationKey, Country> = { A: "DE", B: "CY", DIESIS: "BE" };

/** A suffix unique to this run, for emails, names and slugs. */
export const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface PersonSpec {
  email: string;
  /** Roles in the project; none by default. */
  roles?: readonly Role[];
  /**
   * Default: the email address when the profile is complete (a complete
   * profile needs a name), else none. Every screen shows a person without
   * a name by their address, so a spec written before names were needed
   * sees the same text.
   */
  name?: string | null;
  /**
   * "A", "B", "DIESIS" (the seeded organisations), `{ id }` for any other,
   * or null for none. Default: A for someone holding no staff role, none
   * for staff.
   */
  organisation?: OrganisationKey | { id: string } | null;
  /** "complete" (the default) or "none": no profile answers (only the organisation and marks below, if any). */
  profile?: "complete" | "none";
  /** Default: the organisation's country (DE when it has none). */
  country?: Country;
  /** Marked as a test account (D85). */
  testAccount?: boolean;
  /** An inviter recorded a guardian's permission (spec 5.6); a complete profile then holds the invited age rule. */
  guardianConsent?: boolean;
  /** That permission also covers sharing the Comp Card (D80). */
  guardianSharing?: boolean;
  /** A live session (the default), none, or one with a given token or expiry. */
  session?: boolean | { sessionToken?: string; expires?: Date };
  /** Other columns of the user row. emailVerified defaults to now (a sign-in leaves it set). */
  user?: {
    emailVerified?: Date | null;
    image?: string | null;
    fontSize?: string;
    dyslexic?: boolean;
    contrast?: boolean;
    createdAt?: Date;
  };
}

export interface Person {
  userId: string;
  email: string;
  name: string | null;
  /** The session's token; "" when the spec asked for no session. */
  sessionToken: string;
  /** Their organisation's id, when they have one (and the database has profiles). */
  organisationId: string | null;
  /** The roles they hold. */
  roles: Role[];
  /** Roles asked for that this database doesn't know (the old build: PARTNER_ADMIN). */
  droppedRoles: Role[];
}

const STAFF: ReadonlySet<Role> = new Set<Role>(["ADMIN", "PARTNER_ADMIN", "FACILITATOR", "CONTENT_EDITOR"]);

interface Schema {
  profiles: boolean;
  roles: Set<string>;
}
const schemas = new WeakMap<PrismaClient, Promise<Schema>>();

/** What this database has of Release 3: the ProjectProfile table, and which roles. Read once per client. */
export function schemaOf(prisma: PrismaClient): Promise<Schema> {
  let known = schemas.get(prisma);
  if (!known) {
    known = (async () => {
      const [table] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"ProjectProfile"')::text AS t`;
      const roles = await prisma.$queryRaw<{ r: string }[]>`SELECT unnest(enum_range(NULL::"Role"))::text AS r`;
      return { profiles: table.t !== null, roles: new Set(roles.map((r) => r.r)) };
    })();
    schemas.set(prisma, known);
  }
  return known;
}

/** Does this database have Release 3's profiles? */
export async function hasProfiles(prisma: PrismaClient): Promise<boolean> {
  return (await schemaOf(prisma)).profiles;
}

const organisationId = (o: OrganisationKey | { id: string }) => (typeof o === "string" ? ORGANISATIONS[o] : o.id);

/** A session token no other run can make. */
const freshToken = () => `e2e-${runId()}-${Math.random().toString(36).slice(2)}`;

/**
 * A live database session for an existing user (as a sign-in makes one).
 * Answers its token. Pass `sessionToken` to put back a session a spec
 * removed on purpose.
 */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  opts: { sessionToken?: string; expires?: Date } = {}
): Promise<string> {
  const sessionToken = opts.sessionToken ?? freshToken();
  await prisma.session.create({
    data: { sessionToken, userId, expires: opts.expires ?? new Date(Date.now() + 86_400_000) },
    select: { id: true },
  });
  return sessionToken;
}

/** Makes a person (see the top of this file). */
export async function createPerson(prisma: PrismaClient, spec: PersonSpec): Promise<Person> {
  const schema = await schemaOf(prisma);
  const asked = [...new Set(spec.roles ?? [])];
  const roles = asked.filter((r) => schema.roles.has(r));
  const droppedRoles = asked.filter((r) => !schema.roles.has(r));
  const complete = (spec.profile ?? "complete") === "complete";
  const isStaff = asked.some((r) => STAFF.has(r));
  const organisation = spec.organisation === undefined ? (isStaff ? null : "A") : spec.organisation;
  const name = spec.name !== undefined ? spec.name : complete ? spec.email : null;

  const user = await prisma.user.create({
    data: {
      email: spec.email,
      name,
      emailVerified: spec.user?.emailVerified === undefined ? new Date() : spec.user.emailVerified,
      ...(spec.user?.image !== undefined ? { image: spec.user.image } : {}),
      ...(spec.user?.fontSize !== undefined ? { fontSize: spec.user.fontSize } : {}),
      ...(spec.user?.dyslexic !== undefined ? { dyslexic: spec.user.dyslexic } : {}),
      ...(spec.user?.contrast !== undefined ? { contrast: spec.user.contrast } : {}),
      ...(spec.user?.createdAt !== undefined ? { createdAt: spec.user.createdAt } : {}),
    },
    select: { id: true },
  });
  for (const role of roles) {
    await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role }, select: { id: true } });
  }

  let organisationIdMade: string | null = null;
  if (schema.profiles) {
    const now = new Date();
    const orgId = organisation ? organisationId(organisation) : null;
    const marks = {
      ...(orgId ? { organisationId: orgId, organisationSource: "admin" } : {}),
      ...(spec.testAccount ? { testAccountAt: now } : {}),
      ...(spec.guardianConsent ? { guardianConsentRecordedAt: now } : {}),
      ...(spec.guardianSharing ? { guardianSharingConsentAt: now } : {}),
    };
    const answers = complete
      ? {
          country:
            spec.country ?? (organisation && typeof organisation === "string" ? COUNTRY_OF[organisation] : "DE"),
          termsVersion: currentTermsVersion(),
          termsAcceptedAt: now,
          ageRule: spec.guardianConsent ? ("INVITED_WITH_GUARDIAN_CONSENT" as const) : ("SELF_MIN_AGE" as const),
          ageConfirmedAt: now,
          profileCompletedAt: now,
        }
      : spec.country
        ? { country: spec.country }
        : {};
    if (complete || Object.keys(marks).length > 0 || spec.country) {
      await prisma.projectProfile.create({
        data: { userId: user.id, projectId: PROJECT, ...marks, ...answers },
        select: { id: true },
      });
    }
    organisationIdMade = orgId;
  }

  const sessionToken =
    spec.session === false
      ? ""
      : await createSession(prisma, user.id, typeof spec.session === "object" ? spec.session : {});
  return { userId: user.id, email: spec.email, name, sessionToken, organisationId: organisationIdMade, roles, droppedRoles };
}

/** Removes the people with these emails (their memberships, profiles, sessions and learner data go with them). */
export async function removePeople(prisma: PrismaClient, emails: readonly string[]) {
  await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
}

/**
 * Signs the browser in as the session's holder. Open pages are left first:
 * a session read still on its way would otherwise put the previous cookie
 * back.
 */
export async function signIn(context: BrowserContext, sessionToken: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/* ------------------------------------------------------------ the world --- */

/**
 * Release 3's fixture world (spec 18.2), the same for every Release 3 spec:
 * organisations A, B and DIESIS; learners LA1, LA2 (A), LB1 (B), LD1
 * (DIESIS), LN (no organisation); facilitators FA (A), FB (B), FN (no
 * organisation), FI (A, profile not complete); partner admins PAA and PAA2
 * (A); an editor EA (A); an ADMIN AD (DIESIS) and an ADMIN AS (SENIC, no
 * organisation). Each person's name and email carry a marker unique to
 * the person and the run; a learner's Comp Card text carries another.
 * LA1's card is shared with A, LA2's is "Only me", LD1's is shared with
 * DIESIS. Every learner has started the world's course (a course created
 * here, one lesson of its own with a document and extra content), so the
 * statistics count them.
 *
 * By default the world makes organisations of its own, so what a partner
 * admin counts is exactly the world's; `organisations: "seeded"` uses the
 * seeded ones instead (A = Pro Arbeit, B = Synthesis, DIESIS = Diesis),
 * whose default country mapping is DE → A and CY → B.
 */

export const WORLD_PEOPLE = {
  LA1: { roles: ["LEARNER"], organisation: "A" },
  LA2: { roles: ["LEARNER"], organisation: "A" },
  LB1: { roles: ["LEARNER"], organisation: "B" },
  LD1: { roles: ["LEARNER"], organisation: "DIESIS" },
  LN: { roles: ["LEARNER"], organisation: null },
  FA: { roles: ["FACILITATOR"], organisation: "A" },
  FB: { roles: ["FACILITATOR"], organisation: "B" },
  FN: { roles: ["FACILITATOR"], organisation: null },
  FI: { roles: ["FACILITATOR"], organisation: "A", profile: "none" },
  PAA: { roles: ["PARTNER_ADMIN"], organisation: "A" },
  PAA2: { roles: ["PARTNER_ADMIN"], organisation: "A" },
  EA: { roles: ["CONTENT_EDITOR"], organisation: "A" },
  AD: { roles: ["ADMIN"], organisation: "DIESIS" },
  AS: { roles: ["ADMIN"], organisation: null },
} as const satisfies Record<
  string,
  { roles: readonly Role[]; organisation: OrganisationKey | null; profile?: "none" }
>;
export type WorldKey = keyof typeof WORLD_PEOPLE;
export const WORLD_KEYS = Object.keys(WORLD_PEOPLE) as WorldKey[];

/** The learners whose Comp Card the world fills, and with whom each is shared. */
const WORLD_CARDS: Partial<Record<WorldKey, OrganisationKey | "onlyMe">> = { LA1: "A", LA2: "onlyMe", LD1: "DIESIS" };

export interface WorldOrganisation {
  id: string;
  name: string;
  /** A cohort of the organisation. */
  cohortId: string;
}

export interface WorldCourse {
  id: string;
  slug: string;
  /** The course's lesson of its own ("s-…"). */
  lessonId: string;
  /** A published document of that lesson. */
  documentId: string;
  /** Extra content of that lesson ("p-…"). */
  partId: string;
  /**
   * A further-reading link of that lesson (Release 4, D107), a draft
   * learners never get; null where the database has no LessonLink table
   * (Release 3's build).
   */
  linkId: string | null;
}

/**
 * A draft course of the world, for what only editors read: a quiz lesson of
 * its own (an exercise, which the editor reads with getStructure) whose
 * extra content is a quiz part (read with getPart). Learners never see it.
 */
export interface WorldDraftCourse {
  id: string;
  slug: string;
  /** The quiz lesson ("s-…"). */
  quizLessonId: string;
  /** Its quiz part ("p-…"). */
  quizPartId: string;
}

export interface World {
  run: string;
  organisations: Record<OrganisationKey, WorldOrganisation>;
  /** Whether the world made the organisations (and removes them). */
  ownOrganisations: boolean;
  people: Record<WorldKey, Person>;
  course: WorldCourse;
  draftCourse: WorldDraftCourse;
  /** The marker in the person's name and email. */
  marker: (key: WorldKey) => string;
  /** The marker in the learner's Comp Card text. */
  cardMarker: (key: WorldKey) => string;
}

const markerOf = (run: string) => (key: WorldKey) => `mk-${key.toLowerCase()}-${run}`;
const cardMarkerOf = (run: string) => (key: WorldKey) => `card-${key.toLowerCase()}-${run}`;

/** Is this database's Course without Release 3's readyLocales (the old build)? Prisma's create would name it. */
async function courseHasReadyLocales(prisma: PrismaClient): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'Course' AND column_name = 'readyLocales'`;
  return row.n > 0;
}

/** Makes the world (see above). */
export async function createWorld(
  prisma: PrismaClient,
  opts: { run?: string; organisations?: "own" | "seeded" } = {}
): Promise<World> {
  const run = opts.run ?? runId();
  const marker = markerOf(run);
  const cardMarker = cardMarkerOf(run);
  const own = (opts.organisations ?? "own") === "own";
  const schema = await schemaOf(prisma);

  const organisations = {} as Record<OrganisationKey, WorldOrganisation>;
  for (const key of Object.keys(ORGANISATIONS) as OrganisationKey[]) {
    const id = own ? `e2e-${run}-${key.toLowerCase()}` : ORGANISATIONS[key];
    const name = own ? `E2E ${key} ${run}` : "";
    if (own) {
      await prisma.organisation.create({
        data: { id, projectId: PROJECT, name, shortName: `${key} ${run}` },
        select: { id: true },
      });
    }
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const cohort = await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: id, name: `E2E cohort ${key} ${run}` },
      select: { id: true },
    });
    organisations[key] = { id, name: org.name, cohortId: cohort.id };
  }

  const people = {} as Record<WorldKey, Person>;
  for (const key of WORLD_KEYS) {
    const p: { roles: readonly Role[]; organisation: OrganisationKey | null; profile?: "none" } = WORLD_PEOPLE[key];
    people[key] = await createPerson(prisma, {
      email: `e2e-${marker(key)}@example.com`,
      name: `${key} ${marker(key)}`,
      roles: p.roles,
      organisation: p.organisation ? { id: organisations[p.organisation].id } : null,
      country: p.organisation ? COUNTRY_OF[p.organisation] : "OTHER",
      profile: p.profile ?? "complete",
    });
  }

  for (const [key, sharing] of Object.entries(WORLD_CARDS) as [WorldKey, OrganisationKey | "onlyMe"][]) {
    const text = (field: string) => `${cardMarker(key)} ${field}`;
    const shared = sharing !== "onlyMe";
    await prisma.compCard.create({
      data: {
        userId: people[key].userId,
        projectId: PROJECT,
        wentWell: text("went well"),
        difficult: text("was difficult"),
        improve: text("to improve"),
        behaviour: text("behaviour"),
        confidence: 4,
        privacy: shared ? "FACILITATOR" : "SELF",
        ...(schema.profiles && shared
          ? { sharedAt: new Date(), sharedWithOrganisationId: organisations[sharing].id, sharingVersion: "e2e" }
          : {}),
      },
      select: { id: true },
    });
  }

  // The world's course: created here, published, one lesson of its own with
  // a published document and extra content. Raw SQL for the course row, so
  // the old build's database (no readyLocales) takes it too.
  const slug = `e2e-world-${run}`;
  const lessonId = `s-w${run.slice(-7).padStart(7, "0")}`;
  const partId = `p-w${run.slice(-7).padStart(7, "0")}`;
  const courseId = `e2e-world-course-${run}`;
  const outline = JSON.stringify({ v: 1, sections: [{ id: lessonId, template: "text" }] });
  const meta = JSON.stringify({ en: { title: `E2E world ${run}`, tagline: "E2E course", clusterLabel: "Communication" } });
  await prisma.$executeRaw`
    INSERT INTO "Course" ("id","projectId","strapiId","slug","cluster","durationMinutes","status","publishedAt","outline","meta","updatedAt")
    VALUES (${courseId}, ${PROJECT}, ${`cms-${slug}`}, ${slug}, 'communication', 15, 'published', now(),
            ${outline}::jsonb, ${meta}::jsonb, now())`;
  if (await courseHasReadyLocales(prisma)) {
    await prisma.$executeRaw`UPDATE "Course" SET "readyLocales" = ARRAY['de','el']::text[] WHERE "id" = ${courseId}`;
  }
  const lesson = await prisma.lesson.create({
    data: {
      projectId: PROJECT,
      courseSlug: slug,
      stageKey: lessonId,
      narrative: { en: { title: `World lesson ${run}`, blocks: [{ kind: "paragraph", text: "A lesson." }] } },
      parts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: partId, type: "text", blocks: { en: [{ kind: "paragraph", text: "Extra content." }] } },
        ],
      },
    },
    select: { id: true },
  });
  // The lesson's document, published. Raw SQL naming Release 3's columns
  // only, so the old build's database (no LessonDocument.languages, D108)
  // takes it too; on Release 4's it is for every language ([]).
  const document = { id: `e2e-world-document-${run}` };
  await prisma.$executeRaw`
    INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes", "published")
    VALUES (${document.id}, ${lesson.id}, ${`World document ${run}`}, '/demo/sample.pdf', 'application/pdf', 1024, true)`;
  // Release 4 (D107): a further-reading link of the lesson, a draft (hidden
  // from learners), where the database has the table. Raw SQL, so a client
  // generated from Release 3's schema takes it too.
  const [links] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"LessonLink"')::text AS t`;
  const linkId = links.t ? `e2e-world-link-${run}` : null;
  if (linkId) {
    await prisma.$executeRaw`
      INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "description", "published", "updatedAt")
      VALUES (${linkId}, ${lesson.id}, ${`World reading ${run}`}, 'https://example.org/world-reading', '', false, now())`;
  }
  // The draft course: a quiz lesson whose extra content is a quiz part,
  // both still empty (null), as an editor's newly added ones are.
  const draftSlug = `e2e-draft-${run}`;
  const draftCourseId = `e2e-draft-course-${run}`;
  const quizLessonId = `s-q${run.slice(-7).padStart(7, "0")}`;
  const quizPartId = `p-q${run.slice(-7).padStart(7, "0")}`;
  const draftOutline = JSON.stringify({ v: 1, sections: [{ id: quizLessonId, template: "quiz" }] });
  const draftMeta = JSON.stringify({ en: { title: `E2E draft ${run}`, tagline: "E2E draft", clusterLabel: "Communication" } });
  await prisma.$executeRaw`
    INSERT INTO "Course" ("id","projectId","strapiId","slug","cluster","durationMinutes","status","outline","meta","updatedAt")
    VALUES (${draftCourseId}, ${PROJECT}, ${`cms-${draftSlug}`}, ${draftSlug}, 'communication', 15, 'draft',
            ${draftOutline}::jsonb, ${draftMeta}::jsonb, now())`;
  await prisma.lesson.create({
    data: {
      projectId: PROJECT,
      courseSlug: draftSlug,
      stageKey: quizLessonId,
      parts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: quizPartId, type: "quiz", data: null, draft: null },
        ],
      },
    },
    select: { id: true },
  });

  for (const key of ["LA1", "LA2", "LB1", "LD1", "LN"] as const) {
    await prisma.courseEnrollment.create({
      data: { userId: people[key].userId, courseId, stagesCompleted: [] },
      select: { id: true },
    });
  }

  return {
    run,
    organisations,
    ownOrganisations: own,
    people,
    course: { id: courseId, slug, lessonId, documentId: document.id, partId, linkId },
    draftCourse: { id: draftCourseId, slug: draftSlug, quizLessonId, quizPartId },
    marker,
    cardMarker,
  };
}

/** Removes everything the world made, the log rows about it included. */
export async function removeWorld(prisma: PrismaClient, world: World) {
  const userIds = WORLD_KEYS.map((k) => world.people[k].userId);
  const orgIds = Object.values(world.organisations).map((o) => o.id);
  const cohortIds = Object.values(world.organisations).map((o) => o.cohortId);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { entityId: { in: [...userIds, ...orgIds, ...cohortIds, world.course.slug, world.course.id] } },
        { entityId: { startsWith: `${world.course.slug}:` } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.lesson.deleteMany({
    where: { projectId: PROJECT, courseSlug: { in: [world.course.slug, world.draftCourse.slug] } },
  });
  await prisma.course.deleteMany({ where: { id: { in: [world.course.id, world.draftCourse.id] } } });
  await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: world.course.slug } } });
  await prisma.cohort.deleteMany({ where: { id: { in: cohortIds } } });
  if (world.ownOrganisations) {
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
  }
}
