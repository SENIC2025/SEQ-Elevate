import { describe, it, expect } from "vitest";
import { MAX_SIGN_IN_ADDRESS, normalizeIdentifier, signInAddress } from "./signin-address";

/*
 * The sign-in address rule (D116): an address is normalised first (trimmed,
 * Unicode compatibility forms folded with NFKC, lower-cased), then checked:
 * plain printable ASCII in the grammar of the browser's email field (WHATWG
 * HTML), exactly one "@" (the plain one) with a local part before it and a
 * host name with a dot after it, at most 254 characters. What passes is the
 * address every later step uses; anything else is refused before it is
 * looked up, stored, counted or mailed.
 */

describe("addresses that pass, normalised", () => {
  it.each([
    ["ana@example.org", "ana@example.org"],
    ["  Ana.Smith+Pilot@Example.ORG \n", "ana.smith+pilot@example.org"],
    ["O'Brien_x-y@mail.example.co.uk", "o'brien_x-y@mail.example.co.uk"],
    ["first.last@sub-domain.example.de", "first.last@sub-domain.example.de"],
    // An international domain as the browser's email field sends it (punycode).
    ["Lena@xn--mnchen-3ya.de", "lena@xn--mnchen-3ya.de"],
    // Full-width letters and full stop around a plain "@" fold to their plain forms.
    ["ａｎａ@ｅｘａｍｐｌｅ．ｏｒｇ", "ana@example.org"],
  ])("%j → %j", (input, expected) => {
    expect(signInAddress(input)).toBe(expected);
    expect(normalizeIdentifier(input)).toBe(expected);
  });

  it("an address of exactly 254 characters", () => {
    const address = `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(6)}`;
    expect(address).toHaveLength(MAX_SIGN_IN_ADDRESS);
    expect(signInAddress(address)).toBe(address);
  });

  it("gives the same address however it was typed, so it is looked up, counted and mailed as one", () => {
    const forms = ["ana@example.org", " ANA@EXAMPLE.ORG", "Ana@Example.Org\t", "ａｎａ@example.org"];
    expect(new Set(forms.map(signInAddress))).toEqual(new Set(["ana@example.org"]));
  });
});

describe("addresses that are refused", () => {
  it.each([
    // A look-alike "@" (full-width U+FF20, small U+FE6B) beside the plain one, or instead of it.
    ["full-width @ after a plain address", "victim@example.org＠evil.example"],
    ["small @ after a plain address", "victim@example.org﹫evil.example"],
    ["full-width @ alone", "victim＠example.org"],
    ["small @ alone", "victim﹫example.org"],
    // A circled letter (U+24D0 ⓐ) that looks like "@" but is a letter: no "@" at all.
    ["circled a for @", "victimⓐexample.org"],
    // Structure.
    ["two @", "victim@example.org@evil.example"],
    ["no @", "victim.example.org"],
    ["empty local part", "@example.org"],
    ["empty domain", "victim@"],
    ["a domain without a dot", "victim@localhost"],
    ["an empty domain label", "victim@example..org"],
    ["a domain ending in a dot", "victim@example.org."],
    ["a label starting with a hyphen", "victim@-example.org"],
    ["an address literal", "victim@[192.0.2.1]"],
    ["a comma in the domain", "victim@example.org,evil.example"],
    ["a semicolon in the domain", "victim@example.org;evil.example"],
    ["quotes", '"victim@example.org"@evil.example'],
    ["a quoted local part", '"victim"@example.org'],
    ["a display name", "Victim <victim@example.org>"],
    // Non-ASCII.
    ["a non-ASCII local part", "jörg@example.org"],
    ["a non-ASCII domain", "victim@exämple.org"],
    ["Cyrillic look-alike letters", "аna@example.org"],
    ["a Cyrillic domain", "ana@еxample.org"],
    ["a zero-width space", "ana​@example.org"],
    ["a right-to-left mark", "ana@example.org‏.evil"],
    // Whitespace and control characters inside the address.
    ["a space", "an a@example.org"],
    ["a tab", "ana\t@example.org"],
    ["a line break", "ana@example.org\nbcc@evil.example"],
    ["a NUL", "ana\u0000@example.org"],
    ["a bell", "ana\u0007@example.org"],
    ["a DEL", "ana@exa\u007Fmple.org"],
    ["a no-break space", "ana b@example.org"],
  ])("%s", (_name, input) => {
    expect(signInAddress(input)).toBeNull();
    expect(() => normalizeIdentifier(input)).toThrow();
  });

  it("an address over 254 characters", () => {
    const address = `${"a".repeat(65)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(6)}`;
    expect(address).toHaveLength(MAX_SIGN_IN_ADDRESS + 1);
    expect(signInAddress(address)).toBeNull();
    expect(signInAddress(`${"a".repeat(300)}@example.org`)).toBeNull();
  });

  it("nothing, or something that isn't text", () => {
    for (const input of ["", "   ", undefined, null, 42, {}, ["ana@example.org"]]) {
      expect(signInAddress(input)).toBeNull();
    }
    expect(() => normalizeIdentifier("")).toThrow();
  });

  it("Auth.js is told why without the address", () => {
    let message = "";
    try {
      normalizeIdentifier("victim@example.org＠evil.example");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/address/i);
    expect(message).not.toContain("victim");
  });
});
