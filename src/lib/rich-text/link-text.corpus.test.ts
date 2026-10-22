import { describe, it, expect } from "vitest";
import { linkTextProblem } from "./link-text";
import { sanitizeRichText } from "./sanitize";
import corpus from "./link-text.corpus.json";

/*
 * D104 as narrowed on 22 October 2026, against the writing and phishing
 * corpora of the link-rules checks (link-text.corpus.json):
 *
 * - honest: 909 link texts written to find false refusals (titles,
 *   abbreviations, file names, international names, references, email
 *   addresses in English, German and Greek), each with its link and the
 *   rule's answer. A refusal is allowed only where the text shows another
 *   site than the link opens (`shows`); at most 20 of them.
 * - refusedHostile: the phishing probes the rule refuses, each with its
 *   link: every refused text, as written, in a sentence, with "www.", with
 *   a path and in capitals. Probes the rule accepts are drawn with the box
 *   naming the link's true site (link-site.ts); they are checked outside
 *   this repository, which keeps no list of them.
 *
 * A change to the rule that changes any answer here shows up as a diff of
 * this file's rows, never silently.
 */

type Honest = { text: string; href: string; answer: "misleading" | null; shows?: string };
const honest = corpus.honest as Honest[];
const refusedHostile = corpus.refusedHostile as [string, string][];

describe("the honest writing corpus", () => {
  it("holds 909 texts with their links, at most 20 refused, each showing another site", () => {
    expect(honest).toHaveLength(909);
    const refused = honest.filter((row) => row.answer === "misleading");
    expect(refused.length).toBeLessThanOrEqual(20);
    for (const row of refused) {
      // The site shown is not the link's host, nor a host above it.
      const link = row.href.startsWith("mailto:") ? new URL(`https://${row.href.split("@")[1]}`).hostname : new URL(row.href).hostname;
      expect(row.shows, row.text).toBeTruthy();
      expect(link === row.shows || link.endsWith(`.${row.shows}`), `${row.text} over ${row.href}`).toBe(false);
    }
    for (const row of honest) expect(row.answer === "misleading", row.text).toBe("shows" in row);
  });

  it("gets the rule's answer for each text", () => {
    const differ = honest.filter((row) => linkTextProblem(row.text, row.href) !== row.answer);
    expect(differ.map((row) => `${JSON.stringify(row.text)} over ${row.href}: ${row.answer ?? "accepted"}`)).toEqual([]);
  });

  it("keeps each accepted text's link on save, and drops each refused one", () => {
    for (const row of honest) {
      const rich = { v: 2, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: row.text, marks: [{ type: "link", attrs: { href: row.href } }] }] }] } };
      const dropped = sanitizeRichText(rich).issues.includes("dropped-link");
      expect(dropped, `${row.text} over ${row.href}`).toBe(row.answer === "misleading");
    }
  });
});

describe("the refused phishing probes", () => {
  it("are refused, each over its link", () => {
    expect(refusedHostile.length).toBe(563);
    const accepted = refusedHostile.filter(([text, href]) => linkTextProblem(text, href) !== "misleading");
    expect(accepted.map(([text, href]) => `${JSON.stringify(text)} over ${href}`)).toEqual([]);
  });

  it("lose their link on save", () => {
    for (const [text, href] of refusedHostile) {
      const rich = { v: 2, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }] }] } };
      expect(sanitizeRichText(rich).issues, `${text} over ${href}`).toContain("dropped-link");
    }
  });
});
