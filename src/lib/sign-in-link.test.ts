import { describe, it, expect } from "vitest";
import { isSameSitePath, signInHref } from "./sign-in-link";

/*
 * The way to sign in from a page that needs an account (a staff page's
 * access notice): the sign-in page, in the page's language, with the page's
 * own path as the way back. Only a path of this site is ever a way back,
 * as the sign-in page takes it (Auth.js lands on a path, or on an address
 * of its own origin, and nowhere else).
 */

describe("signInHref", () => {
  it("leads to the sign-in page in the page's language, back to the page", () => {
    expect(signInHref("en", "/en/admin")).toBe("/en/signin?callbackUrl=%2Fen%2Fadmin");
    expect(signInHref("de", "/de/content/courses")).toBe("/de/signin?callbackUrl=%2Fde%2Fcontent%2Fcourses");
    expect(signInHref("el", "/el/content/courses/workplace-conflict")).toBe(
      "/el/signin?callbackUrl=%2Fel%2Fcontent%2Fcourses%2Fworkplace-conflict"
    );
  });

  it("keeps the page's query, encoded as part of the way back", () => {
    expect(signInHref("en", "/en/analytics?live=1")).toBe("/en/signin?callbackUrl=%2Fen%2Fanalytics%3Flive%3D1");
  });

  it("leaves out a way back that isn't a path of this site", () => {
    for (const from of [
      "https://evil.example/en/admin",
      "//evil.example/en/admin",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      "en/admin",
      "",
    ]) {
      expect(signInHref("en", from), JSON.stringify(from)).toBe("/en/signin");
    }
  });

  it("takes only the platform's languages, else English", () => {
    expect(signInHref("fr", "/fr/admin")).toBe("/en/signin?callbackUrl=%2Ffr%2Fadmin");
    expect(signInHref("../x", "/en/admin")).toBe("/en/signin?callbackUrl=%2Fen%2Fadmin");
  });
});

describe("isSameSitePath", () => {
  it("is a path that stays on this site, read as a browser reads it", () => {
    expect(isSameSitePath("/en/admin")).toBe(true);
    expect(isSameSitePath("/")).toBe(true);
    expect(isSameSitePath("/en/content/courses/a-b?x=1#y")).toBe(true);
    expect(isSameSitePath("//evil.example")).toBe(false);
    expect(isSameSitePath("/\\evil.example")).toBe(false);
    expect(isSameSitePath("/a\\b")).toBe(false);
    expect(isSameSitePath("/\u0000x")).toBe(false);
    expect(isSameSitePath("https://seq-elevate.eu/en")).toBe(false);
    expect(isSameSitePath("en")).toBe(false);
  });
});
