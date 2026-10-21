import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, createSession, hasProfiles, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3, Stream D (spec 18.2): the two data tools that act on the whole
 * database, so this spec runs after every other one, in a project of its
 * own (playwright.config.ts, project "last"):
 *
 *   D-E4  resetting a marked test account deletes its enrolments and badges,
 *         and they stay gone after a deploy's badge backfill
 *         (prisma/backfill-course-badges.mjs, which runs across the
 *         database); its sessions go first, so a tab still open saves
 *         nothing that would bring an enrolment back (D85)
 *   D-E6  the clean-up: the dry run's counts equal the run's; the run erases
 *         the marked test accounts, ends every demo session (unexpired too)
 *         and purges expired sessions and sign-in links; a queued course file
 *         due for deletion is listed (and kept: the e2e server is not
 *         production), one a record uses again leaves the queue; the run is
 *         logged; a second run does nothing (D88, D92)
 *
 * The clean-up run erases every marked test account and ends every demo
 * session in the database, whoever made them: another spec running at the
 * same time would lose its people.
 *
 * On the old build both fail because the tools don't exist.
 *
 * Requires a real database — gated on E2E_DB=1.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "default" });

const PROJECT = "seq-elevate";
const RUN = runId();
const DATA = "/en/admin/data";
const ADMIN_DATA = "src/app/actions/admin-data.ts";
const LEARNER = "src/app/actions/learner.ts";
const ROOT = path.resolve(__dirname, "..");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A course made in the editor (meta set), published, with one lesson of its own and a badge. */
async function createdCourse(slug: string) {
  const id = `e2e-course-${slug}`;
  const lessonId = `s-d${slug.slice(-7).padStart(7, "0")}`;
  const outline = JSON.stringify({ v: 1, sections: [{ id: lessonId, template: "text" }] });
  const meta = JSON.stringify({ en: { title: `E2E data ${slug}`, tagline: "E2E", clusterLabel: "Communication" } });
  const badge = await prisma.badge.create({
    data: { projectId: PROJECT, slug: `${slug}-complete`, name: `E2E ${slug}`, meaning: "E2E" },
    select: { id: true },
  });
  await prisma.$executeRaw`
    INSERT INTO "Course" ("id","projectId","strapiId","slug","cluster","durationMinutes","status","publishedAt","outline","meta","badgeId","updatedAt")
    VALUES (${id}, ${PROJECT}, ${`cms-${slug}`}, ${slug}, 'communication', 15, 'published', now(),
            ${outline}::jsonb, ${meta}::jsonb, ${badge.id}, now())`;
  return { id, slug, lessonId, badgeId: badge.id };
}

async function removeCourse(slug: string) {
  await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: slug } });
  await prisma.course.deleteMany({ where: { projectId: PROJECT, slug } });
  await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: slug } } });
}

describe("D-E4: resetting a marked test account", () => {
  const slug = `e2e-reset-${RUN}`;
  const emails = { tester: `e2e-reset-tester-${RUN}@example.com`, admin: `e2e-reset-admin-${RUN}@example.com` };
  let tester: Person;
  let admin: Person;
  let course: Awaited<ReturnType<typeof createdCourse>>;

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    await removeCourse(slug);
    admin = await createPerson(prisma, { email: emails.admin, roles: ["ADMIN"] });
    tester = await createPerson(prisma, { email: emails.tester, roles: ["LEARNER"], testAccount: true });
    course = await createdCourse(slug);
    // Finished the course and holds its badge, as a completion saves them.
    await prisma.courseEnrollment.create({
      data: { userId: tester.userId, courseId: course.id, stagesCompleted: [], completedAt: new Date(), sectionsCompleted: [course.lessonId] },
      select: { id: true },
    });
    await prisma.userBadge.create({ data: { userId: tester.userId, badgeId: course.badgeId }, select: { id: true } });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [admin?.userId, tester?.userId] } }] } });
    await removePeople(prisma, Object.values(emails));
    await removeCourse(slug);
  });

  test("enrolments and badges go and stay gone; an open tab's next save brings nothing back", async ({ request }) => {
    const save = () =>
      callAction(request, {
        as: tester,
        page: "/en/learner",
        file: LEARNER,
        name: "saveCourseProgressPatch",
        args: [slug, { v: 2, completed: [course.lessonId] }, tester.userId],
      });
    // Control: before the reset, the tester's tab saves.
    expect((await save()).result, "the tab saves before the reset").toMatchObject({ ok: true });

    const reset = await callAction(request, {
      as: admin,
      page: DATA,
      file: ADMIN_DATA,
      name: "resetTestAccount",
      args: [tester.userId],
    });
    expect(reset.result).toMatchObject({ ok: true, counts: { enrolments: 1, badges: 1, sessions: 1 } });
    const left = async () => ({
      enrolments: await prisma.courseEnrollment.count({ where: { userId: tester.userId } }),
      badges: await prisma.userBadge.count({ where: { userId: tester.userId } }),
      sessions: await prisma.session.count({ where: { userId: tester.userId } }),
    });
    expect(await left()).toEqual({ enrolments: 0, badges: 0, sessions: 0 });

    // A deploy's badge backfill gives badges back for completed enrolments: there are none.
    execFileSync("node", ["prisma/backfill-course-badges.mjs"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: "pipe",
    });
    expect(await left(), "still gone after the backfill").toEqual({ enrolments: 0, badges: 0, sessions: 0 });

    // The tab still open sends its next save with the session that ended.
    const late = await save();
    expect(late.thrown, "the save is refused: no signed-in learner").toBe(true);
    expect(await left(), "nothing came back").toEqual({ enrolments: 0, badges: 0, sessions: 0 });

    // The account, its role and its profile stay.
    expect(await prisma.user.count({ where: { id: tester.userId } })).toBe(1);
    expect(await prisma.membership.count({ where: { userId: tester.userId, role: "LEARNER" } })).toBe(1);
    if (await hasProfiles(prisma)) {
      expect(await prisma.projectProfile.count({ where: { userId: tester.userId, testAccountAt: { not: null } } })).toBe(1);
    }
    const audit = await prisma.auditLog.findFirst({
      where: { action: "account.reset", actorId: admin.userId },
      select: { metadata: true },
    });
    expect(audit?.metadata).toMatchObject({ enrolments: 1, badges: 1 });
  });
});

describe("D-E6: the go-live clean-up", () => {
  const slug = `e2e-clean-${RUN}`;
  const emails = {
    admin: `e2e-clean-admin-${RUN}@example.com`,
    m1: `e2e-clean-tester1-${RUN}@example.com`,
    m2: `e2e-clean-tester2-${RUN}@example.com`,
    other: `e2e-clean-other-${RUN}@example.com`,
  };
  const HOST = "e2e.public.blob.vercel-storage.com";
  const files = {
    due: `https://${HOST}/${RUN}/due.pdf`,
    pastedBack: `https://${HOST}/${RUN}/pasted-back.pdf`,
    recent: `https://${HOST}/${RUN}/recent.pdf`,
  };
  const tokens = { demo: `demo-e2e-${RUN}`, expired: `e2e-expired-${RUN}`, live: "" };
  const expiredLink = `e2e-clean-link-${RUN}@example.com`;
  let admin: Person;
  let m1: Person;
  let m2: Person;
  let other: Person;
  let course: Awaited<ReturnType<typeof createdCourse>>;

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    await removeCourse(slug);
    admin = await createPerson(prisma, { email: emails.admin, roles: ["ADMIN"] });
    m1 = await createPerson(prisma, { email: emails.m1, roles: ["LEARNER"], testAccount: true });
    m2 = await createPerson(prisma, { email: emails.m2, roles: ["LEARNER"], testAccount: true });
    other = await createPerson(prisma, { email: emails.other, roles: ["LEARNER"] });
    tokens.live = other.sessionToken;
    course = await createdCourse(slug);
    // The marked accounts' learner data: progress, a card, an activity record, a pending link.
    for (const m of [m1, m2]) {
      await prisma.courseEnrollment.create({ data: { userId: m.userId, courseId: course.id, stagesCompleted: [] }, select: { id: true } });
      await prisma.compCard.create({ data: { userId: m.userId, projectId: PROJECT, wentWell: "test" }, select: { id: true } });
      await prisma.auditLog.create({
        data: { projectId: PROJECT, actorId: m.userId, action: "course.opened", entity: "Course", entityId: slug, metadata: { courseSlug: slug } },
        select: { id: true },
      });
      await prisma.verificationToken.create({
        data: { identifier: m.email, token: `e2e-clean-${m.userId}`, expires: new Date(Date.now() + DAY) },
      });
    }
    // Someone else's showcase session (unexpired), and an expired session and link.
    await createSession(prisma, other.userId, { sessionToken: tokens.demo, expires: new Date(Date.now() + 7 * DAY) });
    await createSession(prisma, other.userId, { sessionToken: tokens.expired, expires: new Date(Date.now() - HOUR) });
    await prisma.verificationToken.create({
      data: { identifier: expiredLink, token: `e2e-clean-link-${RUN}`, expires: new Date(Date.now() - HOUR) },
    });
    // Queued course files: one due that nothing uses, one due that a lesson
    // document uses again, one queued just now.
    const [table] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"PendingFileDeletion"')::text AS t`;
    if (table.t) {
      await prisma.pendingFileDeletion.createMany({
        data: [
          { url: files.due, reason: "document.removed", queuedAt: new Date(Date.now() - 8 * DAY) },
          { url: files.pastedBack, reason: "document.removed", queuedAt: new Date(Date.now() - 8 * DAY) },
          { url: files.recent, reason: "video.cleared" },
        ],
      });
      const lesson = await prisma.lesson.create({
        data: { projectId: PROJECT, courseSlug: slug, stageKey: course.lessonId },
        select: { id: true },
      });
      await prisma.lessonDocument.create({
        data: { lessonId: lesson.id, name: "Pasted back", url: files.pastedBack, mimeType: "application/pdf", sizeBytes: 10 },
      });
    }
  });

  test.afterAll(async () => {
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: [expiredLink, emails.m1, emails.m2] } } });
    const [table] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"PendingFileDeletion"')::text AS t`;
    if (table.t) await prisma.pendingFileDeletion.deleteMany({ where: { url: { in: Object.values(files) } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: admin?.userId }, { entityId: { in: [m1?.userId, m2?.userId].filter(Boolean) as string[] } }, { entityId: slug }] },
    });
    await removePeople(prisma, Object.values(emails));
    await removeCourse(slug);
  });

  const call = (request: Parameters<typeof callAction>[0], name: string, args: unknown[] = []) =>
    callAction(request, { as: admin, page: DATA, file: ADMIN_DATA, name, args });

  type Counts = Record<string, number>;
  interface Plan {
    accounts: { id: string; email: string }[];
    kept: unknown[];
    rows: Counts;
    demoSessions: number;
    expiredSessions: number;
    expiredSignInLinks: number;
    files: Counts & { mode: string };
    trialCourses: { slug: string }[];
  }
  interface Result {
    runId: string;
    erased: number;
    rows: Counts;
    failed: unknown[];
    demoSessions: number;
    expiredSessions: number;
    expiredSignInLinks: number;
    files: Counts & { mode: string };
  }

  test("the dry run says what the run does, the run does it and is logged, and a second run does nothing", async ({
    request,
  }) => {
    const preview = await call(request, "previewCleanup");
    expect(preview.error, preview.raw.slice(0, 200)).toBeUndefined();
    const plan = (preview.result as { ok: true; plan: Plan }).plan;
    expect(plan.accounts.map((a) => a.id)).toEqual(expect.arrayContaining([m1.userId, m2.userId]));
    expect(plan.accounts.map((a) => a.id)).not.toContain(other.userId);
    expect(plan.rows.enrolments).toBeGreaterThanOrEqual(2);
    expect(plan.demoSessions).toBeGreaterThanOrEqual(1);
    expect(plan.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(plan.expiredSignInLinks).toBeGreaterThanOrEqual(1);
    expect(plan.files).toMatchObject({ mode: "keep" });
    expect(plan.files.kept, "a due file is listed, kept off production").toBeGreaterThanOrEqual(1);
    expect(plan.files.dropped, "a file in use again").toBeGreaterThanOrEqual(1);
    expect(plan.files.waiting).toBeGreaterThanOrEqual(1);
    expect(plan.trialCourses.map((c) => c.slug), "a created course only test accounts took").toContain(slug);
    // Nothing changed.
    expect(await prisma.user.count({ where: { id: { in: [m1.userId, m2.userId] } } })).toBe(2);

    // A wrong confirmation runs nothing.
    const wrong = await call(request, "runCleanup", [{ confirm: "ERASE ALL" }]);
    expect(wrong.result).toEqual({ ok: false, error: "confirm-mismatch", expected: `ERASE ${plan.accounts.length} TEST ACCOUNTS` });
    expect(await prisma.user.count({ where: { id: { in: [m1.userId, m2.userId] } } })).toBe(2);

    const run = await call(request, "runCleanup", [{ confirm: `ERASE ${plan.accounts.length} TEST ACCOUNTS` }]);
    expect(run.error, run.raw.slice(0, 200)).toBeUndefined();
    const result = (run.result as { ok: true; result: Result }).result;
    // The dry run's counts are the run's.
    expect({
      erased: result.erased,
      rows: result.rows,
      demoSessions: result.demoSessions,
      expiredSessions: result.expiredSessions,
      expiredSignInLinks: result.expiredSignInLinks,
      files: result.files,
    }).toEqual({
      erased: plan.accounts.length,
      rows: plan.rows,
      demoSessions: plan.demoSessions,
      expiredSessions: plan.expiredSessions,
      expiredSignInLinks: plan.expiredSignInLinks,
      files: { ...plan.files, failed: 0 },
    });
    expect(result.failed).toEqual([]);

    // What it did, in the database.
    expect(await prisma.user.count({ where: { id: { in: [m1.userId, m2.userId] } } }), "marked accounts erased").toBe(0);
    const records = await prisma.auditLog.findMany({
      where: { action: "account.deleted", entityId: { in: [m1.userId, m2.userId] } },
      select: { actorId: true, metadata: true },
    });
    expect(records).toEqual([
      { actorId: admin.userId, metadata: { byAdmin: true, requestRef: `CLEANUP-${result.runId}` } },
      { actorId: admin.userId, metadata: { byAdmin: true, requestRef: `CLEANUP-${result.runId}` } },
    ]);
    expect(await prisma.session.count({ where: { sessionToken: tokens.demo } }), "the showcase session ended, unexpired").toBe(0);
    expect(await prisma.session.count({ where: { sessionToken: tokens.expired } }), "the expired session purged").toBe(0);
    expect(await prisma.session.count({ where: { sessionToken: tokens.live } }), "a live session stays").toBe(1);
    expect(await prisma.verificationToken.count({ where: { identifier: expiredLink } }), "the expired link purged").toBe(0);
    expect(await prisma.verificationToken.count({ where: { identifier: { in: [emails.m1, emails.m2] } } })).toBe(0);
    const queued = (await prisma.pendingFileDeletion.findMany({ where: { url: { in: Object.values(files) } } })).map((f) => f.url);
    expect(queued.sort(), "the due file stays queued (not production); the one in use again left the queue").toEqual(
      [files.due, files.recent].sort()
    );
    const logged = await prisma.auditLog.findFirst({
      where: { action: "data.cleanup_run", actorId: admin.userId },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    expect(logged?.metadata).toMatchObject({
      runId: result.runId,
      counts: { accountsErased: plan.accounts.length, demoSessions: plan.demoSessions, filesDropped: plan.files.dropped },
    });
    expect(JSON.stringify(logged?.metadata)).not.toContain("@");

    // A second run does nothing.
    const again = (await call(request, "previewCleanup")).result as { plan: Plan };
    expect(again.plan).toMatchObject({ accounts: [], demoSessions: 0, expiredSessions: 0, expiredSignInLinks: 0 });
    const second = (await call(request, "runCleanup", [{ confirm: "ERASE 0 TEST ACCOUNTS" }])).result as { result: Result };
    expect(second.result).toMatchObject({ erased: 0, demoSessions: 0, expiredSessions: 0, expiredSignInLinks: 0, failed: [] });
    expect(Object.values(second.result.rows).every((n) => n === 0)).toBe(true);
    expect(second.result.files).toMatchObject({ deleted: 0, failed: 0, dropped: 0 });
    expect(await prisma.user.count({ where: { id: { in: [admin.userId, other.userId] } } })).toBe(2);
  });

  test("the page shows the dry run and the log", async ({ page, context }) => {
    await signIn(context, admin.sessionToken);
    await page.goto(DATA);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Data", level: 1 })).toBeVisible();
    await main.getByRole("button", { name: "Dry run" }).click();
    await expect(main.getByRole("heading", { name: "What a run would delete now" })).toBeFocused();
    await expect(main.getByText("To run it, type:")).toContainText("ERASE 0 TEST ACCOUNTS");
    const log = main.getByRole("table");
    await expect(log.getByRole("row").filter({ hasText: "data.cleanup_run" }).first()).toContainText(emails.admin);
  });
});
