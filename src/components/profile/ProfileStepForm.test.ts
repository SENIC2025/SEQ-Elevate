import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { ProfileStepView } from "./ProfileStepForm";

/*
 * Release 3 (spec 18.1 UB5): what the profile step's form asks, and what it
 * says about who sees the person's data. Rendered with the real messages,
 * so a renamed key shows as its path.
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
vi.mock("@/app/actions/profile", () => ({ completeProfile: vi.fn() }));

const { ProfileStepForm, ageStatementOf } = await import("./ProfileStepForm");

const MAPPING: ProfileStepView["mapping"] = {
  DE: { id: "org-a", name: "Pro Arbeit" },
  CY: { id: "org-b", name: "Synthesis" },
  BE: { id: "org-d", name: "Diesis Network" },
  OTHER: { id: "org-d", name: "Diesis Network" },
};

const first = (over: Partial<ProfileStepView> = {}): ProfileStepView => ({
  completed: false,
  termsChanged: false,
  nameRequired: true,
  country: null,
  staff: false,
  organisation: null,
  invited: false,
  mapping: MAPPING,
  minAge: { DE: 16, CY: 16, BE: 16, GR: 16, OTHER: 16 },
  consent: "off",
  consentGiven: false,
  consentMissing: false,
  ...over,
});

const render = (view: ProfileStepView, lang: "en" | "de" | "el" = "en") => {
  messages = { en, de, el }[lang];
  locale = lang;
  return renderToStaticMarkup(createElement(ProfileStepForm, { view }));
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'");

describe("the profile step's form (UB5)", () => {
  it("asks, in order: name, country, age, Terms, the privacy notice (a link, not a box), and Continue; no consent box", () => {
    const html = render(first());
    const t = text(html);
    const at = (s: string) => t.indexOf(s);
    for (const s of ["First name or nickname", "Where are you taking part?", "I am 16 or older.", "I accept the Terms of use", "How we use your data", "Continue"]) {
      expect(at(s), s).toBeGreaterThan(-1);
    }
    expect(at("First name or nickname")).toBeLessThan(at("Where are you taking part?"));
    expect(at("Where are you taking part?")).toBeLessThan(at("I am 16 or older."));
    expect(at("I am 16 or older.")).toBeLessThan(at("I accept the Terms of use"));
    expect(at("I accept the Terms of use")).toBeLessThan(at("How we use your data"));
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('href="/en/legal/terms"');
    expect(html).toContain('href="/en/legal/privacy"');
    expect(t).not.toContain("I agree that SEQ Elevate may use my data");
    // Nothing is ticked for them.
    expect(html).not.toMatch(/checked=""/);
  });

  it("asks for a name whenever none is stored, also after a completion (no loop); never when one is", () => {
    const named = render(first({ nameRequired: false }));
    expect(text(named)).not.toContain("First name or nickname");
    const blankAfter = render(first({ completed: true, nameRequired: true }));
    const t = text(blankAfter);
    expect(t).toContain("First name or nickname");
    expect(t).not.toContain("Where are you taking part?");
    expect(t).not.toContain("I accept the Terms of use");
  });

  it("after a new Terms version shows only the Terms box, and says why", () => {
    const t = text(render(first({ completed: true, termsChanged: true, nameRequired: false })));
    expect(t).toContain("Our Terms of use have changed.");
    expect(t).toContain("I accept the Terms of use");
    for (const gone of ["First name or nickname", "Where are you taking part?", "or older", "We need a few details, once."]) {
      expect(t).not.toContain(gone);
    }
  });

  it("names the organisation the picked country maps to, or says no partner sees them yet when it maps to none", () => {
    expect(text(render(first({ country: "CY" })))).toContain("Facilitators at Synthesis and the DIESIS and SENIC staff");
    expect(text(render(first({ country: "GR" })))).toContain(
      "Once your account is linked to a partner organisation, its facilitators will too."
    );
    // Nothing picked yet: nothing said.
    expect(text(render(first()))).not.toMatch(/Facilitators at|DIESIS and SENIC staff/);
  });

  it("an invited learner: names the organisation that set the account up, whatever country is picked", () => {
    const view = first({ organisation: { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: false }, country: "CY" });
    const t = text(render(view));
    expect(t).toContain("Your account was set up by Pro Arbeit.");
    expect(t).toContain("Facilitators at Pro Arbeit and the DIESIS and SENIC staff");
    expect(t).not.toContain("Synthesis");
  });

  it("says DIESIS will check when a partner admin's organisation doesn't support the picked country", () => {
    const partner = { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true };
    const t = text(render(first({ organisation: partner, country: "CY" })));
    expect(t).toContain("Your account was set up by Pro Arbeit.");
    expect(t).toContain(
      "Pro Arbeit supports learners in another country. If you continue with Cyprus, DIESIS will check which organisation supports you"
    );
    expect(t).not.toContain("Facilitators at Pro Arbeit");
    // The country it supports: no question.
    expect(text(render(first({ organisation: partner, country: "DE" })))).not.toContain("supports learners in another country");
  });

  it("after saying DIESIS will check, says in full who sees what until then (no partner organisation)", () => {
    const partner = { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true };
    const t = text(render(first({ organisation: partner, country: "CY" })));
    const check = t.indexOf("DIESIS will check which organisation supports you");
    const full = t.indexOf(
      "The DIESIS and SENIC staff who run the platform will see your name and email, your progress, your last activity, the time you spend on each lesson"
    );
    expect(check).toBeGreaterThan(-1);
    expect(full).toBeGreaterThan(check);
    expect(t).toContain("Your Comp Card stays private unless you share it.");
  });

  it("names the country in each language, as the sentence needs it", () => {
    const partner = { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true };
    expect(text(render(first({ organisation: partner, country: "GR" }), "de"))).toContain("Wenn du mit Griechenland weitermachst");
    expect(text(render(first({ organisation: partner, country: "GR" }), "el"))).toContain("Αν συνεχίσεις με την Ελλάδα");
    expect(text(render(first({ organisation: partner, country: "OTHER" })))).toContain("If you continue with another country");
  });

  it("says nothing about who sees the data to staff", () => {
    const t = text(render(first({ staff: true, country: "CY", organisation: { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true } })));
    expect(t).not.toMatch(/Facilitators at|DIESIS and SENIC staff|set up by|supports learners/);
  });

  it("offers the invited statement where an inviter recorded a guardian's permission, instead of the age", () => {
    const t = text(render(first({ invited: true, organisation: { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true } })));
    expect(t).toContain("Pro Arbeit invited me and has my parent's or guardian's permission.");
    expect(t).not.toContain("or older");
  });

  it("asks for the age the country needs", () => {
    const minAge = { DE: 16, CY: 14, BE: 13, GR: 15, OTHER: 16 };
    expect(text(render(first({ minAge, country: "BE" })))).toContain("I am 13 or older.");
  });

  it("ties the age tick to the statement it was given for: another country's minimum age asks again (AGE_RULE=digital-consent)", () => {
    const digital = first({ minAge: { DE: 16, CY: 14, BE: 13, GR: 15, OTHER: 16 } });
    expect(ageStatementOf(digital, "BE")).not.toBe(ageStatementOf(digital, "DE"));
    expect(ageStatementOf(digital, "DE")).toBe(ageStatementOf(digital, "OTHER"));
    // The same age everywhere (the default): a tick stays when the country changes.
    expect(ageStatementOf(first(), "BE")).toBe(ageStatementOf(first(), "DE"));
    expect(ageStatementOf(first(), null)).toBe(ageStatementOf(first(), "GR"));
    // The invited statement names no age: the country never changes it.
    const invited = { ...digital, invited: true };
    expect(ageStatementOf(invited, "BE")).toBe(ageStatementOf(invited, "DE"));
  });

  it("shows the separate, unticked consent box only with PROFILE_CONSENT", () => {
    for (const consent of ["optional", "required"] as const) {
      const html = render(first({ consent }));
      expect(text(html)).toContain("I agree that SEQ Elevate may use my data");
      expect(html.match(/type="checkbox"/g)).toHaveLength(3);
      expect(html).not.toMatch(/checked=""/);
    }
  });

  it("is in German and Greek too", () => {
    expect(text(render(first(), "de"))).toContain("Bevor es losgeht");
    expect(text(render(first(), "el"))).toContain("Πριν ξεκινήσεις");
  });
});
