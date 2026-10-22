import { expect, type Page } from "@playwright/test";

/** This browser's guest store (src/store/demo-state.tsx). */
const GUEST_STORE = "seq-elevate-demo-state-v1";

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

/**
 * Waits until this browser's guest store holds course `slug` finished: its
 * completion and its badge. The completion screen records the completion,
 * and the store writes it to the guest store, just after the screen is
 * drawn; what an account gets when the guest adds their work is what the
 * guest store holds. So a test that signs in, or loads another page, after
 * a guest's walk waits for the store first, never for a fixed time.
 */
export async function guestCourseCompleted(page: Page, slug: string, badge: string) {
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          const stored = raw ? (JSON.parse(raw) as { badges?: string[]; course?: { courseSlug?: string; completedAt?: string | null } }) : null;
          return {
            course: stored?.course?.courseSlug ?? null,
            completed: !!stored?.course?.completedAt,
            badges: stored?.badges ?? [],
          };
        }, GUEST_STORE),
      { message: `the guest store holds ${slug} finished`, timeout: 15_000 }
    )
    .toEqual({ course: slug, completed: true, badges: expect.arrayContaining([badge]) });
}
