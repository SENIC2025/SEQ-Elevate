import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { AccountProfile } from "./AccountView";

/*
 * Release 3 (spec 5.7): the Account page says what the profile step
 * recorded (country, organisation, the Terms accepted, the age rule), that
 * name and country are changed by asking, what staff always see, and that
 * staff notes are in the data download — without a count.
 */

let messages: Record<string, unknown> = en;
let locale = "en";
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) => createTranslator({ locale, messages, namespace: namespace as never }),
  useLocale: () => locale,
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/${locale}${href}`, ...rest }) };
});
vi.mock("@/app/actions/gdpr", () => ({ deleteMyAccount: vi.fn() }));

const { AccountView } = await import("./AccountView");

const PROFILE: AccountProfile = {
  country: "DE",
  organisationName: "Pro Arbeit",
  termsVersion: "2026-11-20",
  termsAcceptedAt: "2026-11-21T09:00:00.000Z",
  ageConfirmedAt: "2026-11-21T09:00:00.000Z",
};

const render = (profile: AccountProfile, lang: "en" | "de" | "el" = "en") => {
  messages = { en, de, el }[lang];
  locale = lang;
  const html = renderToStaticMarkup(
    createElement(AccountView, {
      email: "ana@example.org",
      name: "Ana",
      memberSince: "2026-11-21T09:00:00.000Z",
      roles: ["LEARNER"],
      projectName: "SEQ Elevate",
      stats: { courses: 1, badges: 0, compCardStarted: true },
      profile,
    })
  );
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'") };
};

describe("the Account page's profile (spec 5.7)", () => {
  it("shows the country, the organisation, the Terms accepted and the age rule confirmed", () => {
    const { text } = render(PROFILE);
    expect(text).toContain("Country Germany");
    expect(text).toContain("Organisation Pro Arbeit");
    expect(text).toContain("Terms of use accepted on November 21, 2026 (version 2026-11-20).");
    expect(text).toContain("Age rule confirmed on November 21, 2026.");
  });

  it("says name and country are changed by asking, linking the privacy notice", () => {
    const { html, text } = render(PROFILE);
    expect(text).toContain("You can't change your name or country here.");
    expect(html).toContain('href="/en/legal/privacy"');
  });

  it("says what facilitators at the learner's organisation and the platform's staff always see", () => {
    expect(render(PROFILE).text).toContain(
      "Whatever you choose, the facilitators at Pro Arbeit and the DIESIS and SENIC staff who run the platform always see"
    );
    const none = render({ ...PROFILE, organisationName: null }).text;
    expect(none).toContain("Not linked to a partner organisation yet.");
    expect(none).toContain("Once your account is linked to a partner organisation, its facilitators will see them too.");
  });

  it("says staff notes are in the data download, with no count", () => {
    const { text } = render(PROFILE);
    expect(text).toContain("Notes that staff write about you are in your data download.");
    expect(text).not.toMatch(/\d+ notes?/i);
  });

  it("is in German and Greek too", () => {
    expect(render(PROFILE, "de").text).toContain("Deutschland");
    expect(render(PROFILE, "el").text).toContain("Γερμανία");
  });
});
