import { test, expect } from "@playwright/test";

test.describe("learner journey", () => {
  test("dashboard lists courses; player walks the first stages", async ({
    page,
  }) => {
    await page.goto("/en/learner");

    // Dashboard lists both courses (from the CMS, not hardcoded)
    await expect(
      page
        .getByRole("heading", { name: "Handling a small workplace conflict" })
        .first()
    ).toBeVisible();
    await expect(
      page.getByText("Receiving feedback without flinching").first()
    ).toBeVisible();

    // Open the hero course
    await page.goto("/en/learner/course/workplace-conflict");
    await page.waitForLoadState("networkidle");

    // Context stage renders
    await expect(
      page.getByRole("heading", { name: /three weeks into the new job/i })
    ).toBeVisible();

    // Advance to the next stage via Continue. Retry the click until the
    // next stage appears (guards against the hydration race where the
    // handler isn't attached yet).
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).click();
      await expect(
        page.getByRole("heading", {
          name: /speaking up without making it worse/i,
        })
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
  });

  test("unknown course shows the not-found page", async ({ page }) => {
    await page.goto("/en/learner/course/does-not-exist");
    // The course doesn't exist → branded not-found renders (the meaningful
    // user-facing check; Next 16 streams a 200 status header).
    await expect(
      page.getByRole("heading", { name: /couldn.t find that page/i })
    ).toBeVisible();
  });
});

test.describe("internationalisation", () => {
  test("switching to German renders German content", async ({ page }) => {
    await page.goto("/de/learner/course/workplace-conflict");
    await expect(
      page.getByRole("heading", { name: /drei wochen im neuen job/i })
    ).toBeVisible();
    // Chrome (the step counter / continue button) is German too
    await expect(page.getByRole("button", { name: /weiter/i })).toBeVisible();
  });

  test("Greek course renders Greek content", async ({ page }) => {
    await page.goto("/el/learner/course/receiving-feedback");
    await expect(
      page.getByRole("heading", {
        name: /Το φυλλάδιο που έμεινες αργά να φτιάξεις/,
      })
    ).toBeVisible();
  });
});

test.describe("guest progress", () => {
  test("a course opened with a fresh page load keeps its own progress: the one stored last isn't swapped in", async ({
    page,
  }) => {
    // Earlier, as a guest: two lessons and an answer in workplace conflict,
    // kept in this browser.
    await page.goto("/en");
    await page.evaluate(() =>
      localStorage.setItem(
        "seq-elevate-demo-state-v1",
        JSON.stringify({
          projectId: "seq-elevate",
          role: null,
          badges: [],
          course: {
            courseSlug: "workplace-conflict",
            courseTitle: "Handling a small workplace conflict",
            stagesCompleted: ["context", "concept"],
            simulation: null,
            scenario: {
              root: null,
              followup: null,
              rootLabel: null,
              followupLabel: null,
            },
            reflection: { p1: "Stored for workplace conflict", p2: "", p3: "" },
            assessment: { q1: null, q2: null, q3: null },
            completedAt: null,
          },
          compCard: {
            wentWell: "",
            difficult: "",
            improve: "",
            behaviour: "",
            confidence: 3,
            privacy: "facilitator",
            updatedAt: null,
          },
        })
      )
    );

    // The other course, opened straight from a link: a fresh page load.
    await page.goto("/en/learner/course/receiving-feedback");
    await page.waitForLoadState("networkidle");
    const stored = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("seq-elevate-demo-state-v1");
        const course = raw ? JSON.parse(raw).course : null;
        return course
          ? {
              courseSlug: course.courseSlug,
              stagesCompleted: course.stagesCompleted,
              p1: course.reflection.p1,
            }
          : null;
      });

    // Its first lesson is done (retried until the handler is attached).
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).click();
      await expect
        .poll(stored, { timeout: 2000 })
        .toMatchObject({ stagesCompleted: ["context"] });
    }).toPass({ timeout: 15000 });

    // The lesson is this course's, not workplace conflict's.
    await expect.poll(stored).toEqual({
      courseSlug: "receiving-feedback",
      stagesCompleted: ["context"],
      p1: "",
    });
  });
});
