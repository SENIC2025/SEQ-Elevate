import { expect, type Page } from "@playwright/test";

/**
 * Release 3 (spec 5.5): work saved on this browser before signing in moves
 * into the account only when the learner says it is theirs. Presses "Add it
 * to my account" in the offer, once the account has loaded, and waits for
 * the page to say it was added (the writes are then on their way).
 */
export async function addGuestWork(page: Page) {
  const prompt = page.getByRole("region", { name: "Work saved on this browser before you signed in" });
  await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "Added to your account." })).toBeVisible();
}
