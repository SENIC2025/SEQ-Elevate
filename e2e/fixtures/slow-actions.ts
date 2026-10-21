import type { Page } from "@playwright/test";

/**
 * From now on, every server action `page` calls is answered `ms` late, as
 * on a slow connection: the request waits in the browser, then goes on as
 * it was. Page loads and other requests aren't held. Lets a spec look at
 * what a page says while its writes or its learner's data are on their way.
 */
export async function slowActions(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.fallback();
  });
}
