import { describe, it, expect } from "vitest";
import { MAX_HREF_CHARS, checkLinkHref } from "./link-url";
import { CASES_PER_SEED, SEEDS, caseName, generatedAddress, mulberry32 } from "./link-gen";
import { findLinks } from "./linkify";

/*
 * Release 4 spec 10.1 (U21): the address check and the quick-link finder on
 * seeded generated addresses. Whatever is generated:
 * - an accepted address starts with https://, http:// or mailto:, holds no
 *   whitespace or invisible character, is at most 2,048 characters, and a
 *   web one has no user name or password and is what the URL parser writes;
 * - checking is idempotent;
 * - the finder and the check agree: every quick link found is an address
 *   the check accepts, with the same href; and an address the check accepts
 *   on its own (nothing a sentence would end with, no quote or angle
 *   bracket) is found whole as a quick link, with the same href.
 */

const FORBIDDEN = /[\s\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/u;

for (const seed of SEEDS) {
  describe(`checkLinkHref on generated addresses (seed ${seed})`, () => {
    const random = mulberry32(seed);
    const inputs = Array.from({ length: CASES_PER_SEED }, () => generatedAddress(random));

    it("accepts only clean https, http and mailto addresses, and accepts them again unchanged", () => {
      inputs.forEach((input, i) => {
        const check = checkLinkHref(input);
        if (!check.ok) return;
        const name = caseName(seed, i, input);
        expect(check.href, name).toMatch(/^(?:https:\/\/|http:\/\/|mailto:)/);
        expect(FORBIDDEN.test(check.href), name).toBe(false);
        expect(check.href.length, name).toBeLessThanOrEqual(MAX_HREF_CHARS);
        if (check.kind === "web") {
          const url = new URL(check.href);
          expect(url.href, name).toBe(check.href);
          expect(url.username + url.password, name).toBe("");
        }
        expect(checkLinkHref(check.href), name).toEqual(check);
      });
    });

    it("agrees with the quick-link finder", () => {
      inputs.forEach((input, i) => {
        const name = caseName(seed, i, input);
        for (const found of findLinks(input)) {
          const typed = input.slice(found.start, found.end);
          const asAddress = found.kind === "email" && !/^mailto:/i.test(typed) ? `mailto:${typed}` : typed;
          expect(checkLinkHref(asAddress), name).toMatchObject({ ok: true, href: found.href, kind: found.kind });
        }
        const check = checkLinkHref(input);
        if (check.ok && /^[^\s<>"`]+$/u.test(input) && /[\p{L}\p{N}/]$/u.test(input)) {
          expect(findLinks(input), name).toEqual([{ start: 0, end: input.length, href: check.href, kind: check.kind }]);
        }
      });
    });
  });
}
