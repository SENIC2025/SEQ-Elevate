import { expect, type Page } from "@playwright/test";

/**
 * Release 3 (spec 5.4): the profile step's form, filled in and sent as a
 * person would, in English. Used by the specs whose people meet the step
 * (a new account, an invitee, a learner a partner admin added).
 *
 * A click before the page has hydrated reaches the DOM but not React's
 * state, so each try sets every box afresh (off, then on; another country,
 * then the one wanted) and the whole form is sent again until the page
 * leaves /welcome.
 */

export type CountryName = "Germany" | "Cyprus" | "Belgium" | "Greece" | "Other";

export interface ProfileAnswers {
  /** Typed when the name is asked for (default "E2E learner"). */
  name?: string;
  /** Default Germany. */
  country?: CountryName;
  /** The invited statement instead of the age (an inviter recorded a guardian's permission). */
  invited?: boolean;
}

const COUNTRIES: CountryName[] = ["Germany", "Cyprus", "Belgium", "Greece", "Other"];

/** Fills in what the form asks for, without sending it. */
export async function fillProfileStep(page: Page, answers: ProfileAnswers = {}) {
  const form = page.getByRole("main");
  const name = form.getByLabel("Full name", { exact: true });
  if (await name.count()) {
    await name.fill("");
    await name.fill(answers.name ?? "E2E learner");
  }
  const wanted = answers.country ?? "Germany";
  const country = form.getByRole("radio", { name: wanted, exact: true });
  if (await country.count()) {
    await form.getByRole("radio", { name: COUNTRIES.find((c) => c !== wanted)!, exact: true }).check();
    await country.check();
  }
  const age = answers.invited
    ? form.getByRole("checkbox", { name: /invited me and has my parent's or guardian's permission/ })
    : form.getByRole("checkbox", { name: /^I am \d+ or older\.$/ });
  for (const box of [age, form.getByRole("checkbox", { name: /I accept the Terms of use/ })]) {
    if (await box.count()) {
      await box.uncheck();
      await box.check();
    }
  }
}

/** Completes the profile step the page is on, and waits until it has left it. */
export async function completeProfileStep(page: Page, answers: ProfileAnswers = {}) {
  await expect(page).toHaveURL(/\/en\/welcome$/);
  await expect(page.getByRole("heading", { level: 1, name: "Before you start" })).toBeVisible();
  await expect(async () => {
    await fillProfileStep(page, answers);
    await page.getByRole("main").getByRole("button", { name: "Continue" }).click();
    await expect(page).not.toHaveURL(/\/welcome$/, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}
