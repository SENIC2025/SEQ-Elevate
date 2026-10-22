import { describe, it, expect } from "vitest";
import { checkLinkHref } from "@/lib/rich-text/link-url";
import { linkTextProblem } from "@/lib/rich-text/link-text";
import { RT_LIMITS } from "@/lib/rich-text/types";
import {
  ACCEPTED_LABELS,
  HOSTILE_ADDRESSES,
  HOSTILE_MARKS,
  MISLEADING_TITLES,
  MISLEADING_TITLE_URL,
  STORED_LINK_URLS,
  overLimitDoc,
} from "./r4-hostile-links";

/**
 * Release 4 (spec 10.3): the hostile table is what it says. Each address is
 * refused by the address check for the reason the table gives, as the e2e
 * servers check it (BLOB_PUBLIC_HOST unset), so an end-to-end refusal can't
 * pass because the row itself was harmless.
 */

describe("the hostile link table", () => {
  it.each(HOSTILE_ADDRESSES.map((row) => [row.name, row] as const))("%s: refused for its reason", (_, row) => {
    const check = checkLinkHref(row.href, { ownFileHost: null });
    // Compared without the address, so a failure on a huge row stays quick to show.
    const seen = check.ok ? { ok: true, ownFile: check.ownFile } : check;
    expect(seen).toEqual(row.reason === "own-file" ? { ok: true, ownFile: true } : { ok: false, reason: row.reason });
  });

  it("stores only addresses the check refuses, never our own file store's", () => {
    expect(STORED_LINK_URLS.length).toBeGreaterThan(10);
    for (const row of STORED_LINK_URLS) expect(checkLinkHref(row.url).ok, row.name).toBe(false);
  });

  it("shows another address in each misleading label and title", () => {
    const labels = HOSTILE_MARKS.filter((m) => m.name.startsWith("a label"));
    expect(labels.length).toBe(17);
    for (const label of labels) {
      const node = label.rich.doc.content[0].content[1] as unknown as { text: string; marks: { attrs: { href: string } }[] };
      expect(linkTextProblem(node.text, node.marks[0].attrs.href), label.name).toBe("misleading");
    }
    const touching = HOSTILE_MARKS.find((m) => m.name.startsWith("two touching"))!;
    const joined = touching.rich.doc.content[0].content
      .slice(1, 3)
      .map((n) => ("text" in n ? n.text : ""))
      .join("");
    expect(linkTextProblem(joined, "https://evil.example/a")).toBe("misleading");
    for (const title of MISLEADING_TITLES) expect(linkTextProblem(title, MISLEADING_TITLE_URL), title).toBe("misleading");
  });

  it("shows no other site in each accepted label, whose address the check accepts", () => {
    expect(ACCEPTED_LABELS.length).toBeGreaterThan(10);
    for (const { label, href } of ACCEPTED_LABELS) {
      expect(checkLinkHref(href, { ownFileHost: null }).ok, href).toBe(true);
      expect(linkTextProblem(label, href), label).toBeNull();
    }
  });

  it("makes an over-limit block with hostile links", () => {
    const { rich } = overLimitDoc();
    const nodes = rich.doc.content[0].content;
    expect(nodes.length).toBeGreaterThan(RT_LIMITS.maxNodes);
    expect(JSON.stringify(nodes.slice(0, 2))).toContain("javascript:");
    expect(JSON.stringify(nodes.slice(0, 2))).toContain("data:text/html");
  });
});
