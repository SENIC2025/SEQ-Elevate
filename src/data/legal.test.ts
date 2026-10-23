import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FINAL_TEXTS } from "@/content/legal";
import { DEFAULT_A11Y_PREFS, prefsAfterLoad } from "@/lib/a11y-prefs";
import { legalHref, legalPlaceholders, linkAddresses } from "@/lib/legal-markdown";
import { ALL_LEGAL_DOCS, getLegal, hasLegalTranslation, LEGACY_VERSION, LEGAL_DOCS, type LegalText } from "./legal";

/*
 * Release 3 (D94, spec 12.2, 12.5; UF1): the guards against placeholders on
 * launch day, and the texts made true.
 *
 * Every file under src/content/legal/ is one of counsel's final texts
 * (<en|de|el>/<document>.ts), registered in src/content/legal/index.ts, and
 * holds no placeholder: no "[" that starts no Markdown link, none of a
 * draft's words ("For DIESIS", "SENIC to confirm", "Until 20 November",
 * "From 20 November", "TODO", "TBD"), a version and a date, links only to
 * addresses the page can show, and a German or Greek text only beside its
 * English one. Once every document has its English text, the legacy texts
 * and their placeholder boxes are gone from the code.
 */

const ROOT = path.resolve(__dirname, "../..");
const CONTENT = path.join(ROOT, "src/content/legal");
const LOCALES = ["en", "de", "el"] as const;

/** Every text file under src/content/legal/, as [locale folder, file name]. */
function textFiles(): [string, string][] {
  return readdirSync(CONTENT).flatMap((entry) => {
    const full = path.join(CONTENT, entry);
    if (!statSync(full).isDirectory()) return [];
    return readdirSync(full).map((file): [string, string] => [entry, file]);
  });
}

async function load(locale: string, file: string): Promise<LegalText> {
  return ((await import(path.join(CONTENT, locale, file))) as { default: LegalText }).default;
}

describe("counsel's legal texts (src/content/legal)", () => {
  it("are only <en|de|el>/<document>.ts files, beside the registry", () => {
    const top = readdirSync(CONTENT).filter((e) => !statSync(path.join(CONTENT, e)).isDirectory());
    expect(top).toEqual(["index.ts"]);
    for (const [locale, file] of textFiles()) {
      expect(LOCALES as readonly string[], `${locale}/${file}`).toContain(locale);
      expect(ALL_LEGAL_DOCS.map((d) => `${d}.ts`), `${locale}/${file}`).toContain(file);
    }
  });

  it("are each registered in index.ts, and every registered text has its file", async () => {
    for (const [locale, file] of textFiles()) {
      const doc = file.replace(/\.ts$/, "") as keyof (typeof FINAL_TEXTS)["en"];
      expect(FINAL_TEXTS[locale as (typeof LOCALES)[number]][doc], `${locale}/${file} is not in index.ts`).toBe(
        await load(locale, file)
      );
    }
    for (const locale of LOCALES) {
      for (const doc of Object.keys(FINAL_TEXTS[locale])) {
        expect(existsSync(path.join(CONTENT, locale, `${doc}.ts`)), `${locale}/${doc}.ts`).toBe(true);
      }
    }
  });

  it("have a title, a version, a date (YYYY-MM-DD) and a body", () => {
    for (const locale of LOCALES) {
      for (const [doc, text] of Object.entries(FINAL_TEXTS[locale])) {
        for (const field of ["title", "version", "lastUpdated", "body"] as const) {
          expect(typeof text[field] === "string" && text[field].trim() !== "", `${locale}/${doc} ${field}`).toBe(true);
        }
        expect(text.lastUpdated, `${locale}/${doc}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(new Date(`${text.lastUpdated}T00:00:00Z`).getTime()), `${locale}/${doc}`).toBe(false);
        expect(text.version, `${locale}/${doc}: the legacy texts' version`).not.toBe(LEGACY_VERSION);
      }
    }
  });

  it("hold no placeholder", () => {
    for (const locale of LOCALES) {
      for (const [doc, text] of Object.entries(FINAL_TEXTS[locale])) {
        for (const field of ["title", "version", "lastUpdated", "body"] as const) {
          expect(legalPlaceholders(text[field]), `${locale}/${doc} ${field}`).toEqual([]);
        }
      }
    }
    // The raw files too: nothing beside the text (a comment) holds a draft's words.
    for (const [locale, file] of textFiles()) {
      const source = readFileSync(path.join(CONTENT, locale, file), "utf8");
      expect(legalPlaceholders(source).filter((f) => !f.startsWith('a "["')), `${locale}/${file}`).toEqual([]);
    }
  });

  it("link only to addresses the page shows as links, and to documents that have a text", () => {
    for (const locale of LOCALES) {
      for (const [doc, text] of Object.entries(FINAL_TEXTS[locale])) {
        for (const address of linkAddresses(text.body)) {
          const href = legalHref(address);
          expect(href, `${locale}/${doc}: ${address}`).not.toBeNull();
          const linked = href?.kind === "internal" ? /^\/legal\/(.+)$/.exec(href.path)?.[1] : undefined;
          if (linked) expect(LEGAL_DOCS as string[], `${locale}/${doc}: ${address}`).toContain(linked);
        }
      }
    }
  });

  it("come in German or Greek only beside their English text", () => {
    for (const locale of ["de", "el"] as const) {
      for (const doc of Object.keys(FINAL_TEXTS[locale])) {
        expect(FINAL_TEXTS.en[doc as keyof (typeof FINAL_TEXTS)["en"]], `${locale}/${doc}.ts without en/${doc}.ts`).toBeDefined();
      }
    }
  });
});

describe("legalPlaceholders (what the guard refuses)", () => {
  it("finds a bracket that starts no link, and a draft's words", () => {
    for (const draft of [
      "The controller is [DIESIS legal name].",
      "Contact [SENIC to confirm].",
      "[For DIESIS / its adviser: decide.]",
      "SENIC to confirm the region.",
      "Until 20 November there is no sign-up screen.",
      "From 20 November, a switch decides.",
      "TODO: retention",
      "Retention: TBD",
      "To be completed before launch",
      "A list [",
      "Escaped, it is still a draft's mark: \\[DIESIS address\\]",
    ]) {
      expect(legalPlaceholders(draft), draft).not.toEqual([]);
    }
  });

  it("accepts links and plain text", () => {
    for (const clean of [
      "See [our cookies page](/legal/cookies) and [the authority](https://example.org).",
      "Write to [privacy](mailto:privacy@example.org). Art. 6(1)(e) applies.",
      "We do this today, and until the end of the programme.",
      "",
    ]) {
      expect(legalPlaceholders(clean), clean).toEqual([]);
    }
  });
});

describe("getLegal", () => {
  it("lists the documents that have a text: the four legacy ones, and the legal notice only with its English text", () => {
    for (const doc of ["privacy", "terms", "cookies", "accessibility"] as const) expect(LEGAL_DOCS).toContain(doc);
    expect(LEGAL_DOCS.includes("notice")).toBe(Boolean(FINAL_TEXTS.en.notice));
    expect(LEGAL_DOCS).toEqual(ALL_LEGAL_DOCS.filter((d) => LEGAL_DOCS.includes(d)));
  });

  it("gives every text a version and a date, the legacy ones 'pre-counsel', in English", () => {
    for (const locale of LOCALES) {
      for (const doc of LEGAL_DOCS) {
        const text = getLegal(doc, locale)!;
        expect(text.version.trim(), `${locale}/${doc}`).not.toBe("");
        expect(text.lastUpdated, `${locale}/${doc}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (text.kind === "legacy") {
          expect(text.version).toBe(LEGACY_VERSION);
          expect(text.lang).toBe("en");
          expect(FINAL_TEXTS.en[doc], `${doc}: legacy only until its English text exists`).toBeUndefined();
        }
      }
    }
    expect(getLegal("notice", "en")).toBe(FINAL_TEXTS.en.notice ? getLegal("notice", "en") : null);
  });

  it("falls back from a missing translation to the English text, and says so", () => {
    for (const doc of LEGAL_DOCS) {
      for (const locale of ["de", "el"] as const) {
        const own = FINAL_TEXTS[locale][doc];
        expect(hasLegalTranslation(doc, locale), `${locale}/${doc}`).toBe(Boolean(own));
        expect(getLegal(doc, locale)!.lang, `${locale}/${doc}`).toBe(own ? locale : "en");
      }
      expect(hasLegalTranslation(doc, "en")).toBe(true);
    }
  });
});

describe("the legacy texts (spec 12.2: made true to the platform)", () => {
  const legacy = LEGAL_DOCS.map((d) => getLegal(d, "en")!).filter((d) => d.kind === "legacy");
  const words = JSON.stringify(legacy);

  it("say no more than the platform does: cookies, analytics, captions, reflections, email, Comp Card, lawful basis", () => {
    for (const untrue of [
      /single strictly-necessary cookie/i, // there are four
      /cross-site trackers/i, // YouTube, after the press
      /we use Plausible/i, // only if switched on
      /Captions on lesson videos\./, // where the course provides them
      /The reflection you write is private/i, // the Comp Card can be shared
      /used only to sign you in/i, // staff see it too
      /private to you unless you choose to share them with your facilitator/i, // two choices, an organisation's facilitators
      /e\.g\. consent/i, // a legal choice, not ours
      /\bdemo\b/i, // a live platform (no-demo-wording.test.ts); storage keys aside
    ]) {
      expect(words.replace(/seq-elevate-[\w-]+/g, ""), String(untrue)).not.toMatch(untrue);
    }
  });

  it("say who sees a shared Comp Card as the platform shows it: the facilitators at your organisation, not DIESIS and SENIC staff as such (D81)", () => {
    const privacy = JSON.stringify(getLegal("privacy", "en"));
    // D81: SENIC staff never see card text; a DIESIS admin only for DIESIS's own learners.
    expect(privacy).not.toMatch(/DIESIS and SENIC staff who run the platform, see[^"]*They see your Comp Card only if you share it/);
    expect(privacy).toMatch(/Your Comp Card is seen only if you share it, and then only by the facilitators at your organisation/);
    // What staff always see includes your country and a guardian's permission, as Manage people shows them.
    expect(privacy).toMatch(/your name and email, your country, your progress/);
    expect(privacy).toMatch(/whether a parent's or guardian's permission is recorded for you/);
  });

  it("name each cookie and browser store the platform sets", () => {
    const cookies = getLegal("cookies", "en");
    if (cookies?.kind !== "legacy") return; // counsel's text names them
    const text = JSON.stringify(cookies);
    for (const name of [
      "__Secure-authjs.session-token",
      "__Host-authjs.csrf-token",
      "__Secure-authjs.callback-url",
      "NEXT_LOCALE",
      "seq-elevate-demo-state-v1",
      "seq-elevate-a11y-v1",
      "seq-elevate-project-v1",
      "seq-elevate-outbox-v1",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("say which of the browser's copies reach the account: guest work, reading help, answers waiting to be saved", () => {
    // A guest's reading help moves into an account still on the standard settings.
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, { dyslexia: true }, {}).movedIn).toBe(true);
    const cookies = getLegal("cookies", "en");
    const privacy = getLegal("privacy", "en");
    if (cookies?.kind === "legacy") {
      const text = JSON.stringify(cookies);
      expect(text).not.toMatch(/only your guest work/i);
      const store = (name: string) => cookies.sections.flatMap((s) => s.list ?? []).find((item) => item.includes(name)) ?? "";
      expect(store("seq-elevate-a11y-v1")).toMatch(/saved in your account/);
      expect(store("seq-elevate-a11y-v1")).toMatch(/move into your account/);
      expect(store("seq-elevate-outbox-v1")).toMatch(/sent to us/);
    }
    if (privacy?.kind === "legacy") {
      // The easy-read font can say something about the person: the notice names it.
      const collected = privacy.sections.find((s) => s.heading === "What we collect")?.list ?? [];
      expect(collected.find((item) => /reading help/i.test(item))).toMatch(/text size, easy-read font and contrast/);
    }
  });
});

describe("launch day (spec 12.3, 12.5)", () => {
  it("once every English text is in, has no code that could draw a placeholder box", () => {
    const allFinal = ALL_LEGAL_DOCS.every((doc) => FINAL_TEXTS.en[doc]);
    const code = ["src/data/legal.ts", "src/app/[locale]/legal/[doc]/page.tsx"].map((f) =>
      readFileSync(path.join(ROOT, f), "utf8")
    );
    // Today some are missing, and the boxes' code is still needed.
    if (!allFinal) {
      expect(code.join("\n")).toContain("needs");
      return;
    }
    for (const source of code) expect(source).not.toMatch(/\bneeds\b|LEGACY\b|toBeCompleted/);
  });
});
