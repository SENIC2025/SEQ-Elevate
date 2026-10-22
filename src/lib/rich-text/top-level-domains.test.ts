import { describe, it, expect } from "vitest";
import { TOP_LEVEL_DOMAINS } from "./top-level-domains";

/*
 * The top-level domains a bare host in link text is read by (link-text.ts,
 * D104): the delegated ones, international ones in their ASCII form, and
 * the reserved names, never a file's or a script's ending.
 */

describe("TOP_LEVEL_DOMAINS", () => {
  it("holds the delegated top-level domains, in lower case, international ones as punycode", () => {
    expect(TOP_LEVEL_DOMAINS.size).toBeGreaterThan(1_400);
    for (const name of ["com", "org", "net", "de", "gr", "eu", "uk", "io", "app", "bank", "zip", "xn--qxam", "xn--p1ai"]) {
      expect(TOP_LEVEL_DOMAINS.has(name), name).toBe(true);
    }
    for (const name of TOP_LEVEL_DOMAINS) expect(name, name).toMatch(/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/);
  });

  it("holds the names reserved for examples, tests and local networks", () => {
    for (const name of ["example", "test", "invalid", "localhost", "local", "onion", "internal", "alt"]) {
      expect(TOP_LEVEL_DOMAINS.has(name), name).toBe(true);
    }
  });

  it("holds no ending of a file or a script name", () => {
    for (const name of ["pdf", "docx", "pptx", "xlsx", "html", "png", "jpg", "js", "ts", "json", "csv", "txt"]) {
      expect(TOP_LEVEL_DOMAINS.has(name), name).toBe(false);
    }
  });
});
