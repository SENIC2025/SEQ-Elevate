import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";

/**
 * The learner dashboard greets a guest whose browser holds nothing of
 * theirs yet with "Welcome", and keeps "Welcome back" for a guest whose
 * work this browser holds (progress in a course, a badge or a Comp Card
 * answer) and for a learner signed in.
 *
 *   DG-E1  a first-time guest: "Welcome", in English, German and Greek
 *   DG-E2  a guest with progress, a badge or a Comp Card answer: "Welcome
 *          back", in the three languages (a guard, as before)
 *   DG-E3  a learner signed in, with nothing saved yet: "Welcome back"
 *          (database; a guard, as before)
 *
 * DG-E1 is red on the build before (b883ac5): every guest was welcomed back.
 * On Release 3 the learner is the people fixture's (FD-U19).
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);

const STORE = "seq-elevate-demo-state-v1";
const FIRST = { en: "Welcome", de: "Willkommen", el: "Καλωσήρθες" } as const;
const BACK = { en: "Welcome back", de: "Willkommen zurück", el: "Καλωσήρθες πίσω" } as const;
const LOCALES = ["en", "de", "el"] as const;

/** The dashboard's greeting: its first heading. */
const greeting = (page: Page) => page.locator("main").getByRole("heading", { level: 1 }).first();

/** A guest store as the page writes it, with `patch` over an empty one. */
function guestStore(patch: Record<string, unknown>) {
  return {
    projectId: "seq-elevate",
    role: null,
    badges: [],
    course: {
      courseSlug: null,
      courseTitle: null,
      stagesCompleted: [],
      simulation: null,
      scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
      reflection: { p1: "", p2: "", p3: "" },
      assessment: { q1: null, q2: null, q3: null },
      completedAt: null,
    },
    compCard: { wentWell: "", difficult: "", improve: "", behaviour: "", confidence: 3, sharing: "onlyMe", updatedAt: null },
    ...patch,
  };
}

test.describe("the learner dashboard's greeting, for a guest", () => {
  test("DG-E1 a guest with nothing saved in this browser is welcomed, not welcomed back", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/learner`);
      // The guest store has been read: the courses are listed.
      await expect(page.locator("main").getByRole("link").first()).toBeVisible();
      await expect(greeting(page), locale).toHaveText(FIRST[locale]);
    }
  });

  test("DG-E2 (guard) a guest whose browser holds their progress, a badge or a Comp Card answer is welcomed back", async ({
    page,
  }) => {
    const stores = {
      progress: guestStore({
        course: {
          ...guestStore({}).course,
          courseSlug: "workplace-conflict",
          courseTitle: "Handling a small workplace conflict",
          stagesCompleted: ["context"],
        },
      }),
      badge: guestStore({ badges: ["conflict-navigator"] }),
      card: guestStore({
        compCard: { ...guestStore({}).compCard, wentWell: "I asked first.", updatedAt: "2026-10-27T08:00:00.000Z" },
      }),
    };
    await page.goto("/en");
    for (const [kind, store] of Object.entries(stores)) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORE, JSON.stringify(store)] as const);
      for (const locale of LOCALES) {
        await page.goto(`/${locale}/learner`);
        await expect(greeting(page), `${kind}, ${locale}`).toHaveText(BACK[locale]);
      }
    }
  });
});

const describeDb = DB ? test.describe : test.describe.skip;

describeDb("the learner dashboard's greeting, signed in", () => {
  const EMAIL = `e2e-dg-learner-${runId()}@example.com`;

  test.afterAll(async () => {
    await removePeople(prisma, [EMAIL]);
    await prisma.$disconnect();
  });

  test("DG-E3 (guard) a learner signed in is welcomed back, with nothing saved yet", async ({ page, context }) => {
    const { sessionToken } = await createPerson(prisma, { email: EMAIL, roles: ["LEARNER"] });
    await signIn(context, sessionToken);
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/learner`);
      await expect(greeting(page), locale).toHaveText(BACK[locale]);
    }
  });
});
