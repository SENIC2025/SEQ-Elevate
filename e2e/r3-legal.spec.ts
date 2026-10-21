import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { getLegal, hasLegalTranslation, LEGAL_DOCS, type LegalDocId } from "../src/data/legal";
import { FINAL_TEXTS } from "../src/content/legal";
import { legalPlaceholders } from "../src/lib/legal-markdown";

/**
 * Release 3 (D94, spec 12.3, 12.5; 18.2: F-E1): the legal pages.
 *
 *   F-E1a (release gate, green whatever counsel's timing):
 *     - every legal page, in every language, is the skip link's target
 *       (<main id="main-content">), shows its version line in the page's
 *       language, and marks English shown under German or Greek as English
 *       (lang="en", WCAG 3.1.2), under a note in the page's language;
 *     - a document that has a final text shows no placeholder;
 *     - the footer links /help and every document that has a text, and
 *       each link opens its page; the legal notice once its text is in,
 *       and no page before.
 *   F-E1b (@launch: the go/no-go check on 30 November, not the release
 *     check): no legal page in any language shows a placeholder box or a
 *     bracket placeholder. It fails while a text written before counsel's
 *     is left, so it runs only when asked for, with E2E_LAUNCH=1, read-only
 *     (it needs no database): docs/legal-texts.md.
 *
 * Which documents have a text, and in which language, is read from the
 * sources (src/data/legal.ts), as the build was made from them.
 */

const LOCALES = ["en", "de", "el"] as const;
type Locale = (typeof LOCALES)[number];

const messages = (locale: Locale) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../src/messages/${locale}.json`), "utf8")) as {
    legal: Record<"backHome" | "translationPending" | "toBeCompleted" | "version", string>;
    safeguarding: { footerLink: string };
  };

/** The version line's words before the version, in the page's language ("Version", "Έκδοση"). */
const versionWord = (locale: Locale) => messages(locale).legal.version.split("{version}")[0].trim();

/** The visible main landmark (a hidden server copy can linger while the page streams). */
const main = (page: Page) => page.locator("main#main-content").filter({ visible: true });

test.describe("Release 3 — legal pages (F-E1a)", () => {
  for (const locale of LOCALES) {
    test(`F-E1a: every legal page is the main landmark, with its version line, its language marked (${locale})`, async ({
      page,
    }) => {
      for (const doc of LEGAL_DOCS) {
        const text = getLegal(doc, locale)!;
        const response = await page.goto(`/${locale}/legal/${doc}`);
        expect(response?.status(), `${locale}/${doc}`).toBe(200);
        await expect(main(page), `${locale}/${doc}: the skip link's target`).toHaveCount(1);
        await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(text.title);

        // The version line, in the page's language.
        const line = main(page).getByText(`${versionWord(locale)} ${text.version} · `, { exact: false });
        await expect(line, `${locale}/${doc}: version line`).toBeVisible();
        if (text.lang === locale) await expect(line).not.toHaveAttribute("lang", /.+/);
        else await expect(line, `${locale}/${doc}: the version line's language`).toHaveAttribute("lang", locale);

        // English under German or Greek: the text says it is English, the note says why.
        const article = main(page).locator("article");
        if (hasLegalTranslation(doc, locale)) {
          await expect(article, `${locale}/${doc}`).not.toHaveAttribute("lang", /.+/);
        } else {
          await expect(article, `${locale}/${doc}`).toHaveAttribute("lang", "en");
          if (locale !== "en") {
            await expect(main(page).getByText(messages(locale).legal.translationPending)).toBeVisible();
          }
        }
        // The back link in the page's language.
        await expect(main(page).getByRole("link", { name: messages(locale).legal.backHome })).toHaveAttribute(
          "href",
          `/${locale}`
        );
      }
    });
  }

  test("F-E1a: a document with a final text shows no placeholder (guard: none exists on the old build)", async ({ page }) => {
    const final = LEGAL_DOCS.filter((doc) => FINAL_TEXTS.en[doc]);
    test.skip(final.length === 0, "no document has a final text yet (counsel's texts, spec 12.4)");
    for (const locale of LOCALES) {
      for (const doc of final) {
        await page.goto(`/${locale}/legal/${doc}`);
        const shown = await main(page).innerText();
        expect(legalPlaceholders(shown), `${locale}/${doc}`).toEqual([]);
        expect(shown).not.toContain(messages(locale).legal.toBeCompleted);
      }
    }
  });

  for (const locale of ["en", "de"] as const) {
    test(`F-E1a: the footer links /help and every document that has a text, and each opens its page (${locale})`, async ({
      page,
      request,
    }) => {
      await page.goto(`/${locale}`);
      const footer = page.getByRole("contentinfo");
      const help = footer.getByRole("link", { name: messages(locale).safeguarding.footerLink, exact: true });
      await expect(help).toHaveAttribute("href", `/${locale}/help`);
      const hrefs = await footer
        .getByRole("link")
        .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
      const legal = hrefs.filter((h) => h.includes("/legal/"));
      expect(legal).toEqual(LEGAL_DOCS.map((doc) => `/${locale}/legal/${doc}`));
      for (const href of [`/${locale}/help`, ...legal]) {
        const res = await request.get(href);
        expect(res.status(), href).toBe(200);
      }
      // The legal notice has a page and a link exactly when its text is in.
      const notice = await request.get(`/${locale}/legal/notice`);
      expect(notice.status()).toBe(LEGAL_DOCS.includes("notice" as LegalDocId) ? 200 : 404);
    });
  }

  test("F-E1a: the page's own words are in the page's language, inside an English text", async ({ page }) => {
    const de = messages("de").legal;
    const doc = LEGAL_DOCS.find((d) => getLegal(d, "de")!.kind === "legacy" && !hasLegalTranslation(d, "de"));
    test.skip(!doc, "every document has its final text in German");
    await page.goto(`/de/legal/${doc}`);
    await expect(main(page).getByText(/zuletzt aktualisiert am \d{1,2}\. \w+ \d{4}/)).toHaveAttribute("lang", "de");
    // A box (an open point of the text written before counsel's) says its label in German.
    const label = main(page).locator("strong", { hasText: de.toBeCompleted });
    if (await label.count()) await expect(label.first()).toHaveAttribute("lang", "de");
    await expect(main(page).getByText(messages("en").legal.toBeCompleted)).toHaveCount(0);
  });
});

test.describe("Release 3 — legal pages on launch day (F-E1b)", () => {
  test("F-E1b: no legal page, in any language, shows a placeholder @launch", { tag: "@launch" }, async ({ page }) => {
    test.skip(!process.env.E2E_LAUNCH, "the launch check (spec 12.5): run with E2E_LAUNCH=1 --grep @launch");
    const found: string[] = [];
    for (const locale of LOCALES) {
      for (const doc of LEGAL_DOCS) {
        await page.goto(`/${locale}/legal/${doc}`);
        const shown = await main(page).innerText();
        for (const l of LOCALES) {
          if (shown.includes(messages(l).legal.toBeCompleted)) found.push(`${locale}/${doc}: a placeholder box`);
        }
        for (const p of legalPlaceholders(shown)) found.push(`${locale}/${doc}: ${p}`);
      }
    }
    expect(found).toEqual([]);
  });
});
