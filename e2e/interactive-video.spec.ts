import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Interactive video: the hero course's Concept stage carries a lesson video
 * with one in-video question. Reaching the cue time pauses playback and pops
 * the quiz; answering resumes. Driven by the bundled WebM (public/demo), which
 * Playwright's Chromium can decode.
 */

test.describe("interactive video", () => {
  test("pauses at a cue, quizzes the learner, then resumes", async ({
    page,
  }) => {
    await page.goto("/en/learner/course/workplace-conflict");

    // context → concept (retry the click against the hydration race)
    const concept = page.getByText(/watch: speaking up without blame/i);
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(concept).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    // The lesson video container renders on the teaching stage.
    const video = page.getByTestId("lesson-video");
    await expect(video).toBeVisible();

    // A WebVTT caption track is present (WCAG 2.2 SC 1.2.2).
    await expect(video.locator("track[kind='captions']")).toHaveCount(1);

    // Drive playback past the cue (4s). Retry the seek until the popup shows —
    // guards against video metadata still loading on the first attempt.
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 6;
      });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });

    // The question popped up and the video is paused.
    await expect(dialog.getByText(/an .i-statement. focuses on/i)).toBeVisible();
    expect(
      await video.evaluate((v: HTMLVideoElement) => v.paused),
      "video paused while the question is up"
    ).toBe(true);

    // Wrong answer → "Not quite"; the explanation shows.
    await dialog.getByText("Whose fault it is").click();
    await dialog.getByRole("button", { name: /^submit$/i }).click();
    await expect(dialog.getByText(/not quite/i)).toBeVisible();

    // Resume — the popup closes.
    await dialog.getByRole("button", { name: /continue watching/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the video upload endpoint rejects unauthenticated callers", async ({
    request,
  }) => {
    // A guest must not be able to mint a Blob upload token.
    const res = await request.post("/api/video/upload", {
      data: {
        type: "blob.generate-client-token",
        payload: {
          pathname: "lesson.mp4",
          callbackUrl: "https://example.com/cb",
          clientPayload: null,
          multipart: false,
        },
      },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test("the quiz popup has no serious a11y violations", async ({ page }) => {
    await page.goto("/en/learner/course/workplace-conflict");
    const concept = page.getByText(/watch: speaking up without blame/i);
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(concept).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const video = page.getByTestId("lesson-video");
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 6;
      });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((x) => x.id), null, 2)).toEqual(
      []
    );
  });
});
