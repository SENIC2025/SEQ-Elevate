import { describe, it, expect } from "vitest";
import {
  hasText,
  firstText,
  fallbackOrder,
  blockHasText,
  narrativeHasText,
  resolveNarrative,
  overlayNarrative,
  pickMeta,
  metaHasText,
  metaFallbackFrom,
} from "./text-fallback";
import type { NarrativeBlock } from "./types";

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });

describe("hasText / firstText", () => {
  it("counts only strings with something besides spaces", () => {
    expect(hasText("a")).toBe(true);
    for (const v of ["", "  ", "\n\t", undefined, null, 3]) {
      expect(hasText(v)).toBe(false);
    }
  });

  it("skips blanks", () => {
    expect(firstText("", " ", undefined, "B", "C")).toBe("B");
    expect(firstText("", " ")).toBeUndefined();
  });
});

describe("fallbackOrder", () => {
  it("tries the learner's language, English, then the rest as written", () => {
    expect(fallbackOrder({ el: 1, de: 2, en: 3 }, "de")).toEqual(["de", "en", "el"]);
    expect(fallbackOrder({ el: 1, de: 2 }, "en")).toEqual(["el", "de"]);
  });
});

describe("blockHasText", () => {
  it("reads every kind of block", () => {
    expect(blockHasText(para("Hi"))).toBe(true);
    expect(blockHasText(para(" "))).toBe(false);
    expect(blockHasText({ kind: "callout", text: "" })).toBe(false);
    expect(blockHasText({ kind: "list", items: ["", "x"] })).toBe(true);
    expect(blockHasText({ kind: "list", items: [" "] })).toBe(false);
    expect(
      blockHasText({
        kind: "compare",
        compare: [{ label: "", text: " ", tone: "negative" }],
      })
    ).toBe(false);
    expect(
      blockHasText({
        kind: "compare",
        compare: [{ label: "", text: "Yes", tone: "positive" }],
      })
    ).toBe(true);
  });

  it("reads a rich paragraph stored without its plain text", () => {
    const rich = {
      v: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      },
    };
    expect(blockHasText({ kind: "paragraph", rich })).toBe(true);
  });

  it("has none for anything that isn't a block", () => {
    for (const junk of [null, "text", 3, { kind: "video" }]) {
      expect(blockHasText(junk)).toBe(false);
    }
  });
});

describe("narrativeHasText", () => {
  it("is false for a version cleared down to blanks", () => {
    expect(narrativeHasText({ title: " ", subtitle: "", blocks: [para("")] })).toBe(false);
    expect(narrativeHasText(undefined)).toBe(false);
  });

  it("is true once any field is written", () => {
    expect(narrativeHasText({ title: "T", blocks: [] })).toBe(true);
    expect(narrativeHasText({ title: "", blocks: [para("x")] })).toBe(true);
  });
});

describe("resolveNarrative", () => {
  it("falls back field by field", () => {
    const out = resolveNarrative(
      {
        en: { title: "Title", subtitle: "Sub", blocks: [para("Text")] },
        de: { title: "Titel", subtitle: " ", blocks: [para("")] },
      },
      "de"
    );
    expect(out).toEqual({ title: "Titel", subtitle: "Sub", blocks: [para("Text")] });
  });

  it("falls back to the first language written when there's no English", () => {
    const out = resolveNarrative(
      { de: { title: "Titel", blocks: [para("Text")] }, el: { title: "", blocks: [] } },
      "el"
    );
    expect(out).toEqual({ title: "Titel", subtitle: undefined, blocks: [para("Text")] });
  });

  it("leaves fields with no text anywhere undefined", () => {
    expect(resolveNarrative({ en: { title: " ", blocks: [para("")] } }, "en")).toEqual({
      title: undefined,
      subtitle: undefined,
      blocks: undefined,
    });
    expect(resolveNarrative(null, "en")).toEqual({});
  });
});

describe("overlayNarrative", () => {
  const base = { title: "Built-in", subtitle: "Sub", blocks: [para("Base")] };

  it("keeps the built-in text for blank fields", () => {
    expect(overlayNarrative(base, { title: "", subtitle: " ", blocks: [para("")] })).toEqual(base);
  });

  it("uses each filled field", () => {
    expect(overlayNarrative(base, { title: "New", blocks: [para("Mine")] })).toEqual({
      title: "New",
      subtitle: "Sub",
      blocks: [para("Mine")],
    });
  });

  it("leaves the stage alone without a rewording", () => {
    expect(overlayNarrative(base, undefined)).toBe(base);
  });
});

describe("pickMeta", () => {
  const en = { title: "Asking", tagline: "Short", clusterLabel: "Communication" };

  it("falls back field by field, blanks skipped", () => {
    expect(
      pickMeta({ en, de: { title: "Fragen", tagline: " ", clusterLabel: "" } }, "de")
    ).toEqual({ title: "Fragen", tagline: "Short", clusterLabel: "Communication" });
  });

  it("uses the first language written when there's no English", () => {
    const de = { title: "Fragen", tagline: "Kurz", clusterLabel: "Kommunikation" };
    expect(pickMeta({ de }, "el")).toEqual(de);
  });

  it("is null only without any copy", () => {
    expect(pickMeta(null, "en")).toBeNull();
    expect(pickMeta({}, "en")).toBeNull();
  });
});

describe("metaHasText / metaFallbackFrom", () => {
  it("counts a title or subtitle", () => {
    expect(metaHasText({ title: "", tagline: " ", clusterLabel: "X" })).toBe(false);
    expect(metaHasText({ title: "", tagline: "Kurz" })).toBe(true);
  });

  it("names the language learners get instead", () => {
    const blank = { title: "", tagline: "", clusterLabel: "" };
    const de = { title: "Fragen", tagline: "", clusterLabel: "" };
    expect(metaFallbackFrom({ en: blank, de, el: blank }, "el")).toBe("de");
    expect(metaFallbackFrom({ de, en: { ...de, title: "Ask" } }, "el")).toBe("en");
    expect(metaFallbackFrom({ el: blank }, "el")).toBeUndefined();
  });
});
