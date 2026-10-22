import { describe, it, expect } from "vitest";
import { checkLinkHref } from "./link-url";
import { linkSite, textIsSite } from "./link-site";
import { linkTextProblem } from "./link-text";

/*
 * The length guards' verifier (D103, D104): a host of at most 63 letters per
 * label as typed, whose label is longer than 63 in punycode, written with
 * ideographic (or halfwidth ideographic) full stops. The address check
 * refuses such an address, so no link opens it. Link text that shows one
 * over another site is refused, or, where the rule reads no host in it
 * (ideographs are no letters a name is read in), drawn with the box naming
 * the site the link opens (link-site.ts; the owner's decision of 22 October
 * 2026).
 */

const EVIL = "https://evil.example/login";
/** 30 CJK ideographs far apart: 94 characters in punycode. */
const spread = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i * 331)).join("");
const umlauts = "ü".repeat(60);

describe("link text over another site, written with ideographic full stops", () => {
  it("the labels are longer than DNS allows in punycode only", () => {
    expect(checkLinkHref(`https://${spread(30)}.com/`)).toEqual({ ok: false, reason: "host" });
    expect(checkLinkHref(`https://${umlauts}.de/`)).toEqual({ ok: false, reason: "host" });
  });

  it.each([
    [`https://${spread(30)}。com`, null],
    [`https://paypal。com。${spread(30)}。evil。example`, "misleading"],
    [`Login: https://${umlauts}｡de`, "misleading"],
    [`https://paypal｡com｡${umlauts}｡evil｡example`, "misleading"],
  ] as const)("%s: refused, or drawn with the link's true site", (text, problem) => {
    expect(linkTextProblem(text, EVIL)).toBe(problem);
    if (problem === null) {
      expect(linkSite(EVIL)).toBe("evil.example");
      expect(textIsSite(text, EVIL)).toBe(false);
    }
  });
});
