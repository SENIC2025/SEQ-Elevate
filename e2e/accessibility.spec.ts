import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getLegal, LEGAL_DOCS } from "../src/data/legal";

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

/*
 * Release 3 (D94, spec 12.3; F-E4): every legal page that has a text, in
 * English, German and Greek (English shown under German or Greek until the
 * translation is in), and the German footer at 320 px with its six links.
 */
test("legal pages render and have no serious a11y violations, in en, de and el", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const locale of ["en", "de", "el"] as const) {
    for (const doc of LEGAL_DOCS) {
      await page.goto(`/${locale}/legal/${doc}`);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1, name: getLegal(doc, locale)!.title })
      ).toBeVisible();
      const v = await scan(page);
      expect(v, `${locale}/${doc}: ${JSON.stringify(v.map((x) => x.id))}`).toEqual([]);
    }
  }
});

test("the German footer reflows at 320 px: no sideways scroll, each link at least 24 px tall", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/de", "/de/legal/privacy"]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await footer.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${path}: no sideways scrolling`).toBeLessThanOrEqual(0);
    const links = footer.getByRole("link");
    // The help link, every legal document's, and SENIC's.
    await expect(links).toHaveCount(LEGAL_DOCS.length + 2);
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      const name = await link.textContent();
      if (name?.trim() === "SENIC") continue; // a link inside a sentence (WCAG 2.5.8's inline exception)
      expect(box.height, `${path}: "${name}"`).toBeGreaterThanOrEqual(24);
      expect(box.x + box.width, `${path}: "${name}" stays on the screen`).toBeLessThanOrEqual(320);
    }
    const results = await new AxeBuilder({ page }).include("footer").withTags(TAGS).analyze();
    expect(results.violations.map((x) => x.id), path).toEqual([]);
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
