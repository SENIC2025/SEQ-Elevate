import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated WCAG 2.2 AA checks (axe-core) on key surfaces. Asserts no
 * serious/critical violations. Complements the manual a11y work; the
 * proposal's acceptance criterion is an internal WCAG 2.2 AA pass.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
  return serious;
}

test("landing has no serious a11y violations", async ({ page }) => {
  await page.goto("/en");
  const v = await scan(page);
  expect(v, JSON.stringify(v.map((x) => x.id), null, 2)).toEqual([]);
});

test("learner dashboard has no serious a11y violations", async ({ page }) => {
  await page.goto("/en/learner");
  const v = await scan(page);
  expect(v, JSON.stringify(v.map((x) => x.id), null, 2)).toEqual([]);
});

test("course player (context stage) has no serious a11y violations", async ({
  page,
}) => {
  await page.goto("/en/learner/course/workplace-conflict");
  const v = await scan(page);
  expect(v, JSON.stringify(v.map((x) => x.id), null, 2)).toEqual([]);
});

test("Comp Card has no serious a11y violations", async ({ page }) => {
  await page.goto("/en/learner/comp-card");
  const v = await scan(page);
  expect(v, JSON.stringify(v.map((x) => x.id), null, 2)).toEqual([]);
});

test("legal pages render and have no serious a11y violations", async ({
  page,
}) => {
  for (const [doc, marker] of [
    ["privacy", /who is responsible for your data/i],
    ["terms", /using the platform/i],
    ["cookies", /essential cookies only/i],
    ["accessibility", /conformance/i],
  ] as const) {
    await page.goto(`/en/legal/${doc}`);
    await expect(page.getByRole("heading", { name: marker }).first()).toBeVisible();
    const v = await scan(page);
    expect(v, `${doc}: ${JSON.stringify(v.map((x) => x.id))}`).toEqual([]);
  }
});

test("the footer links to the legal pages from any page", async ({ page }) => {
  await page.goto("/en");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await footer.getByRole("link", { name: /privacy/i }).first().click();
  await expect(page).toHaveURL(/\/en\/legal\/privacy/);
  await expect(
    page.getByRole("heading", { name: /privacy policy/i }).first()
  ).toBeVisible();
});
