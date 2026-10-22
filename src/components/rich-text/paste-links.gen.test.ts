import { describe, it, expect } from "vitest";
import { checkLinkHref, isSafeLinkHost } from "@/lib/rich-text/link-url";
import { linkTextProblem } from "@/lib/rich-text/link-text";
import {
  CASES_PER_SEED,
  SEEDS,
  caseName,
  generatedAddress,
  generatedText,
  mulberry32,
  pick,
} from "@/lib/rich-text/link-gen";
import { ownFileHost } from "@/lib/rich-text/own-file-host";
import { classifyPastedLink } from "./paste-links";

/*
 * Release 4 spec 10.1 (U21): pasted links on seeded generated anchors —
 * addresses from a hostile alphabet, as they are or wrapped in an Outlook
 * safe link or a Google redirect, with generated text. Whatever is
 * generated, a link kept is an address the check accepts as it is kept, not
 * our own file, not a safe link, and not one its text misrepresents.
 */

/** Percent-encoded as a wrapper carries it (half an emoji can't be, so it goes). */
function encoded(href: string): string {
  try {
    return encodeURIComponent(href);
  } catch {
    return encodeURIComponent(href.replace(/[\uD800-\uDFFF]/g, ""));
  }
}

const wrap = (href: string, how: number) =>
  how < 0.2
    ? `https://eur01.safelinks.protection.outlook.com/?url=${encoded(href)}&data=05%7Csomeone%40example.org`
    : how < 0.35
      ? `https://www.google.com/url?q=${encoded(href)}&sa=D`
      : href;

for (const seed of SEEDS) {
  describe(`classifyPastedLink on generated anchors (seed ${seed})`, () => {
    const random = mulberry32(seed);
    const anchors = Array.from({ length: CASES_PER_SEED }, () => ({
      href: random() < 0.05 ? null : wrap(generatedAddress(random), random()),
      name: random() < 0.1 ? pick(random, ["_Toc1", "_Hlk2", "_ftnref1"]) : null,
      text: generatedText(random),
    }));

    it("never keeps a refused, own-file, safe-link or misrepresented address", () => {
      anchors.forEach((anchor, i) => {
        const result = classifyPastedLink(anchor);
        if (!result.keep) return;
        const name = caseName(seed, i, anchor);
        const check = checkLinkHref(result.href, { ownFileHost: ownFileHost() });
        expect(check, name).toMatchObject({ ok: true, href: result.href, ownFile: false, insecure: result.http });
        if (check.ok && check.kind === "web") expect(isSafeLinkHost(new URL(result.href).hostname), name).toBe(false);
        expect(linkTextProblem(anchor.text, result.href), name).toBeNull();
      });
    });
  });
}
