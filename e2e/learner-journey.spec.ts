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
