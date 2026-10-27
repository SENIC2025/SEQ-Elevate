import { describe, it, expect, afterEach, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

/*
 * A staff page's notice offers the way to sign in to a visitor who is
 * signed out, in the notice's language, and nothing to anyone signed in.
 */

const getCurrentUser = vi.fn();
const getLocale = vi.fn();
const getTranslations = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("next-intl/server", () => ({ getLocale, getTranslations }));

const { SignInPrompt } = await import("./SignInPrompt");
const { SignInHereLink } = await import("./SignInHereLink");

const LABELS: Record<string, string> = { en: "Sign in", de: "Anmelden", el: "Σύνδεση" };

/** The link SignInPrompt draws, or null. */
async function prompt(props: { lang?: string } = {}) {
  const el = (await SignInPrompt(props)) as ReactElement<{ children: ReactElement<Record<string, unknown>> }> | null;
  return el ? el.props.children : null;
}

describe("SignInPrompt", () => {
  afterEach(() => vi.clearAllMocks());

  it("draws nothing for someone signed in, and asks for no words", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    expect(await prompt()).toBeNull();
    expect(await prompt({ lang: "en" })).toBeNull();
    expect(getTranslations).not.toHaveBeenCalled();
  });

  it("offers a visitor who is signed out the way to sign in, in the page's language", async () => {
    getCurrentUser.mockResolvedValue(null);
    for (const locale of ["en", "de", "el"]) {
      getLocale.mockResolvedValue(locale);
      getTranslations.mockImplementation(async ({ locale: l }: { locale: string }) => (key: string) => (key === "signIn" ? LABELS[l] : key));
      const link = await prompt();
      expect(isValidElement(link) && link.type).toBe(SignInHereLink);
      expect(link!.props).toEqual({ locale, label: LABELS[locale], lang: undefined });
      expect(getTranslations).toHaveBeenLastCalledWith({ locale, namespace: "auth" });
    }
  });

  it("on an English-only notice, in English, marked so on a page in another language", async () => {
    getCurrentUser.mockResolvedValue(null);
    getTranslations.mockImplementation(async ({ locale: l }: { locale: string }) => (key: string) => (key === "signIn" ? LABELS[l] : key));
    getLocale.mockResolvedValue("de");
    expect((await prompt({ lang: "en" }))!.props).toEqual({ locale: "de", label: "Sign in", lang: "en" });
    getLocale.mockResolvedValue("en");
    expect((await prompt({ lang: "en" }))!.props).toEqual({ locale: "en", label: "Sign in", lang: undefined });
  });
});
