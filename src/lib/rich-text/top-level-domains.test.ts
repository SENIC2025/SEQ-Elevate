import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOT_LISTED_DOMAINS, PUBLIC_SUFFIX_RULES, RESERVED_TOP_LEVEL_DOMAINS, TOP_LEVEL_DOMAINS, registrableDomain } from "./top-level-domains";

/*
 * The top-level domains link text reads a name's end and an email address
 * by (link-text.ts, D104): the delegated ones, international ones in their
 * ASCII form, and the reserved names, never a file's or a script's ending;
 * generated from the pinned tldts-icann.
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

  it("is the generator's output from the pinned tldts-icann, as the file writes it, and the reserved names", async () => {
    const { tldtsIcann, installedSuffixTable, wrap } = await import("../../../scripts/public-suffixes");
    expect(tldtsIcann().version).toBe("7.4.2");
    const table = installedSuffixTable();
    expect(TOP_LEVEL_DOMAINS).toEqual(new Set([...table.topLevelDomains, ...RESERVED_TOP_LEVEL_DOMAINS]));
    const source = readFileSync(new URL("./top-level-domains.ts", import.meta.url), "utf8");
    const listed = source.slice(source.indexOf("const LISTED = `\n") + "const LISTED = `\n".length, source.indexOf("`;", source.indexOf("const LISTED")));
    expect(listed).toBe(`${wrap(table.topLevelDomains).join("\n")}\n`);
  });

  it("is pinned: tldts-icann at one exact version, a development dependency only", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines?: { node?: string };
    };
    expect(manifest.devDependencies["tldts-icann"]).toBe("7.4.2");
    expect(manifest.dependencies["tldts-icann"]).toBeUndefined();
    // The server's Node decides how link text is read (its Unicode): one major version.
    expect(manifest.engines?.node).toBe("22.x");
  });
});

/*
 * D104 (owner decision, 22 October 2026): link text and its link are
 * compared by site, the registrable domain of a host by the ICANN section
 * of the Public Suffix List. Its rules of more than one label are listed
 * per top-level domain, all of a domain's or none.
 */
describe("registrableDomain", () => {
  it("is the public suffix a host ends in, and one label more", () => {
    for (const [host, site] of [
      ["example.org", "example.org"],
      ["en.wikipedia.org", "wikipedia.org"],
      ["ec.europa.eu", "europa.eu"],
      ["www.bbc.co.uk", "bbc.co.uk"],
      ["a.b.bbc.co.uk", "bbc.co.uk"],
      ["www.minedu.gov.gr", "minedu.gov.gr"],
      ["shop.example.com.gr", "example.com.gr"],
      ["www.ucy.ac.cy", "ucy.ac.cy"],
      ["portal.example.com.cy", "example.com.cy"],
      ["www.uni-graz.ac.at", "uni-graz.ac.at"],
      ["x.example.ac.be", "example.ac.be"],
      ["www.ukim.edu.mk", "ukim.edu.mk"],
      ["login.bank.example", "bank.example"],
      ["bank.example.evil.example", "evil.example"],
      ["www.example.de", "example.de"],
      // Wildcards and an exception ("*.sch.uk", "*.ck", "!www.ck").
      ["a.school.sch.uk", "a.school.sch.uk"],
      ["shop.example.co.ck", "example.co.ck"],
      ["www.ck", "www.ck"],
      ["a.www.ck", "www.ck"],
      // International names, as the URL parser gives them (punycode).
      ["xn--bcher-kva.example", "xn--bcher-kva.example"],
      ["a.xn--hxakle2ceu.xn--qxam", "xn--hxakle2ceu.xn--qxam"],
    ]) {
      expect(registrableDomain(host), host).toBe(site);
    }
  });

  it("is a public suffix itself when the host is one", () => {
    for (const host of ["co.uk", "gov.gr", "com.cy", "ac.at", "org"]) expect(registrableDomain(host), host).toBe(host);
  });

  it("can't be told for an IP address, or under a top-level domain whose rules aren't all listed", () => {
    for (const host of ["192.168.0.1", "[::1]", "comune.milano.it", "bank.co.jp", "www.nav.no", "gov.pl", "ny.us"]) {
      expect(registrableDomain(host), host).toBeNull();
    }
    expect(NOT_LISTED_DOMAINS).toEqual(["it", "jp", "no", "pl", "us"]);
  });

  it("holds the project's countries' and the common rules of more than one label", () => {
    for (const rule of ["co.uk", "ac.uk", "com.gr", "gov.gr", "ac.cy", "com.cy", "ac.at", "co.at", "ac.be", "com.mk", "com.au", "co.nz", "co.za", "com.br", "co.in", "com.tr", "com.cn", "co.kr", "co.il", "com.mx", "*.sch.uk", "*.ck", "!www.ck"]) {
      expect(PUBLIC_SUFFIX_RULES.has(rule), rule).toBe(true);
    }
    // None for these: a host under them is registered one label below the top.
    for (const domain of ["com", "org", "net", "eu", "de"]) {
      expect([...PUBLIC_SUFFIX_RULES].some((rule) => rule.endsWith(`.${domain}`)), domain).toBe(false);
    }
  });

  it("is generated from tldts-icann 7.4.2, every rule of a listed top-level domain, and agrees with it", async () => {
    const { tldtsIcann, installedSuffixTable } = await import("../../../scripts/public-suffixes");
    const { version, require } = tldtsIcann();
    expect(version).toBe("7.4.2");
    const table = installedSuffixTable();
    expect(table.notListed).toEqual(NOT_LISTED_DOMAINS);
    const fromTable = table.lines.flatMap((line) => {
      const [domain, ...before] = line.split(" ");
      return before.map((b) => `${b}.${domain}`);
    });
    expect(new Set(fromTable)).toEqual(PUBLIC_SUFFIX_RULES);
    // Every listed rule, as tldts-icann reads a host under it.
    const tldts = require("tldts-icann") as { getDomain(host: string): string | null };
    for (const rule of PUBLIC_SUFFIX_RULES) {
      const bare = rule.replace(/^!/, "").replace(/^\*/, "any");
      for (const host of rule.startsWith("!") ? [bare, `a.${bare}`] : [`site.${bare}`, `a.b.site.${bare}`]) {
        expect(registrableDomain(host), host).toBe(tldts.getDomain(host));
      }
    }
  });
});
