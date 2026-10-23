import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Release 4 (D104; verdict §7: 10 ms a text, 0.5 s a 1 MB save): what a
 * text shows is compared with the links it is read over (touching links are
 * read as one text, sanitize.ts) at a cost that follows the number of
 * addresses it shows and of links, never their product. Counted as work,
 * not time: the sites looked up in the Public Suffix List
 * (registrableDomain and publicSuffixLength), at most two for each address
 * shown and each link.
 */

const looked = vi.hoisted(() => ({ count: 0 }));

vi.mock("./top-level-domains", async (importOriginal) => {
  const original = await importOriginal<typeof import("./top-level-domains")>();
  return {
    ...original,
    registrableDomain: (hostname: string) => {
      looked.count++;
      return original.registrableDomain(hostname);
    },
    publicSuffixLength: (labels: readonly string[], end?: number) => {
      looked.count++;
      return original.publicSuffixLength(labels, end);
    },
  };
});

const { addressesShown, showsAnotherAddress, showsAnotherAddressOverAny } = await import("./link-text");

beforeEach(() => {
  looked.count = 0;
});

/** 1,320 names of 440 hosts of one site, three each, touching ("b0.a.de,b0.a.de,…"). */
const names = Array.from({ length: 440 }, (_, i) => `b${i}.a.de,`.repeat(3)).join("");
/** 440 links, each to its own host of that site. */
const links = Array.from({ length: 440 }, (_, i) => `https://c${i}.a.de/`);

describe("a text's addresses compared with its links", () => {
  it("looks up each site once over one link, however many names the text shows", () => {
    const shown = addressesShown(names);
    expect(shown?.web).toHaveLength(1_320);
    looked.count = 0;
    expect(showsAnotherAddress(shown, links[0])).toBe(false);
    expect(looked.count, "sites looked up").toBeLessThanOrEqual(2 * (1_320 + 1));
  });

  it("looks up each site once over 440 links, never once for each name and link", () => {
    const shown = addressesShown(names);
    looked.count = 0;
    expect(showsAnotherAddressOverAny(shown, links)).toBe(false);
    expect(looked.count, "sites looked up").toBeLessThanOrEqual(2 * (1_320 + 440));
    looked.count = 0;
    expect(showsAnotherAddressOverAny(shown, [...links, ...links, "mailto:help@a.de", "mailto:help@b0.a.de"])).toBe(false);
    expect(looked.count, "sites looked up").toBeLessThanOrEqual(2 * (1_320 + 442));
    // One link of another site among them.
    expect(showsAnotherAddressOverAny(shown, [...links, "mailto:help@a.com"])).toBe(true);
  });

  it("looks up each site once for the email addresses a text shows over 440 links", () => {
    const shown = addressesShown(names.replaceAll(",b", ",help@b"));
    expect(shown?.email.length).toBeGreaterThan(800);
    looked.count = 0;
    expect(showsAnotherAddressOverAny(shown, links)).toBe(false);
    expect(looked.count, "sites looked up").toBeLessThanOrEqual(2 * (1_320 + 440));
  });
});
