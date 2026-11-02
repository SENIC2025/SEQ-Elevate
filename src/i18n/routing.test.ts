import { describe, expect, it } from "vitest";
import { siteLocale } from "./routing";

describe("siteLocale", () => {
  it("keeps one of the site's locales", () => {
    expect(siteLocale("en")).toBe("en");
    expect(siteLocale("de")).toBe("de");
    expect(siteLocale("el")).toBe("el");
  });

  it("gives the default for anything else, so a redirect stays on the site's own paths", () => {
    expect(siteLocale("\\evil.com")).toBe("en");
    expect(siteLocale("/evil.com")).toBe("en");
    expect(siteLocale("EN")).toBe("en");
    expect(siteLocale("")).toBe("en");
  });
});
