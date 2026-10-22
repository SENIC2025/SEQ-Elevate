import { describe, it, expect } from "vitest";
import { hostReadAlike, punycodeDecode, punycodeEncode, typedHost } from "./link-host";

/*
 * Release 4 spec 3.2 (U1, D103): the host rule of the address check. Its
 * answers through checkLinkHref are in link-url.test.ts; these are its parts.
 */

describe("punycode (RFC 3492)", () => {
  // RFC 3492's samples (lower case), and names the platform's languages use.
  const SAMPLES: [string, string][] = [
    ["bücher", "bcher-kva"],
    ["ελληνικά", "hxargifdar"],
    ["пример", "e1afmkfd"],
    ["straße", "strae-oqa"],
    ["ü", "tda"],
    ["他们为什么不说中文", "ihqwcrb4cv8a8dqg056pqjye"],
    ["почемужеонинеговорятпорусски", "b1abfaaepdrnnbgefbadotcwatmq2g4l"],
    ["3年b組金八先生", "3b-ww4c5e180e575a65lsy2b"],
  ];

  it("encodes and decodes the samples", () => {
    for (const [chars, encoded] of SAMPLES) {
      expect(punycodeEncode(chars), chars).toBe(encoded);
      expect(punycodeDecode(encoded), encoded).toBe(chars);
    }
  });

  it("refuses what isn't punycode", () => {
    for (const encoded of ["zz", "99999999999", "bcher-kvaé", "-", "a-é"]) {
      expect(punycodeDecode(encoded), encoded).toBeNull();
    }
  });
});

describe("typedHost", () => {
  it("is the host as typed: no slashes, path, query, fragment or port", () => {
    expect(typedHost("https://Example.ORG:8443/x?y#z")).toBe("Example.ORG");
    expect(typedHost("http://bücher.example")).toBe("bücher.example");
    expect(typedHost("https:///\\bank.example/x")).toBe("bank.example");
    expect(typedHost("https://bank\u3002example")).toBe("bank\u3002example");
  });

  it("is null when the address holds a user name", () => {
    expect(typedHost("https://user@example.org/")).toBeNull();
    expect(typedHost("https://@example.org/")).toBeNull();
  });
});

describe("hostReadAlike", () => {
  const alike = (address: string) => hostReadAlike(address, new URL(address).hostname.replace(/\.$/, ""));

  it("accepts ASCII, international and right-to-left hosts every engine reads alike", () => {
    for (const address of [
      "https://example.org/",
      "https://a_b.example/",
      "https://192.0.2.1/",
      "https://bücher.example/",
      "https://xn--bcher-kva.example/",
      "https://straße.example/",
      "https://ελληνικά.example/",
      "https://пример.рф/",
      "https://\u05D1\u05D3\u05D9\u05E7\u05D4.example/",
      "https://\u0645\u062B\u0627\u0644.\u0625\u062E\u062A\u0628\u0627\u0631/",
      "https://\u05D01.example/",
    ]) {
      expect(alike(address), address).toBe(true);
    }
  });

  it("refuses what the engines read differently", () => {
    for (const address of [
      // Punycode that doesn't decode, or decodes to what no host may hold.
      "https://xn--a.example/",
      "https://xn--zz.example/",
      "https://xn--.example/",
      "https://xn--a-ecp.ru/",
      "https://xn--kua.example/",
      // Characters the engines map, or don't, as they please.
      "https://a\u1806b.example/",
      "https://a\u3164.example/",
      "https://a\u00ADb.example/",
      "https://\u1E9Ek.example/",
      // Upper case outside ASCII: the engines lower it by tables of their own.
      "https://B\u00DCCHER.example/",
      "https://\u10A5l.example/",
      "https://\u13A0.example/",
      "https://\uFF21.example/",
      "https://a\u0640b.example/",
      // The Bidi Rule.
      "https://a.\u0661\u0662/",
      "https://a\u05D0.example/",
      "https://1\u05D0.example/",
      "https://\u0660.example/",
      "https://a_\u05D0.example/",
      // Letters of Unicode's newest versions, and beyond the Basic Multilingual Plane.
      "https://a\uA7DB.example/",
      "https://a\u{20000}.example/",
    ]) {
      let parsed: string | null = null;
      try {
        parsed = new URL(address).hostname.replace(/\.$/, "");
      } catch {
        continue; // This engine refuses it already.
      }
      expect(hostReadAlike(address, parsed), address).toBe(false);
    }
  });
});
