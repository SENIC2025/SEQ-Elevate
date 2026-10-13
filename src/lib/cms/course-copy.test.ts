import { describe, it, expect } from "vitest";
import {
  readCopyOverride,
  applyCopy,
  mergeCopyOverride,
  cleanCopyText,
} from "./course-copy";

const base = { title: "Handling conflict", tagline: "Say it without blame", extra: 1 };

describe("readCopyOverride", () => {
  it("keeps known locales and string fields", () => {
    expect(
      readCopyOverride({ de: { title: "Konflikte", tagline: "Ohne Vorwurf" } })
    ).toEqual({ de: { title: "Konflikte", tagline: "Ohne Vorwurf" } });
  });

  it("drops unknown locales, unknown fields, non-strings and blanks", () => {
    expect(
      readCopyOverride({
        fr: { title: "Conflit" },
        de: { title: 42, tagline: "  ", colour: "red" },
        el: { title: "Σύγκρουση", tagline: null },
      })
    ).toEqual({ el: { title: "Σύγκρουση" } });
  });

  it("treats anything that isn't an object as no override", () => {
    for (const junk of [null, undefined, "de", 3, ["de"]]) {
      expect(readCopyOverride(junk)).toEqual({});
    }
  });
});

describe("applyCopy", () => {
  it("replaces each overridden field on its own", () => {
    const out = applyCopy(base, { de: { title: "Konflikte" } }, "de");
    expect(out).toEqual({ ...base, title: "Konflikte" });
  });

  it("never falls back to another language's override", () => {
    const override = { de: { title: "Konflikte", tagline: "Ohne Vorwurf" } };
    expect(applyCopy(base, override, "en")).toBe(base);
    expect(applyCopy(base, override, "el")).toBe(base);
  });

  it("keeps the built-in wording for a field cleared in the editor", () => {
    // As stored: the German title typed and cleared again, the subtitle
    // left as spaces. Learners read the built-in German, never a blank.
    const stored = { de: { title: "", tagline: "   " }, el: { title: "Σύγκρουση", tagline: " " } };
    expect(applyCopy(base, readCopyOverride(stored), "de")).toEqual(base);
    expect(applyCopy(base, readCopyOverride(stored), "el")).toEqual({
      ...base,
      title: "Σύγκρουση",
    });
  });

  it("leaves the copy alone without an override", () => {
    expect(applyCopy(base, null, "de")).toBe(base);
    expect(applyCopy(base, {}, "de")).toBe(base);
  });
});

describe("mergeCopyOverride", () => {
  it("sets a locale without touching the others", () => {
    expect(
      mergeCopyOverride({ el: { title: "Σύγκρουση" } }, "de", {
        title: "Konflikte",
        tagline: "",
      })
    ).toEqual({ el: { title: "Σύγκρουση" }, de: { title: "Konflikte" } });
  });

  it("clears a field with an empty string", () => {
    expect(
      mergeCopyOverride({ de: { title: "Konflikte", tagline: "Ohne" } }, "de", {
        title: "",
        tagline: "Ohne",
      })
    ).toEqual({ de: { tagline: "Ohne" } });
  });

  it("drops a locale with nothing left, and returns null when all are gone", () => {
    expect(
      mergeCopyOverride(
        { de: { title: "Konflikte" }, el: { title: "Σύγκρουση" } },
        "de",
        { title: "", tagline: "" }
      )
    ).toEqual({ el: { title: "Σύγκρουση" } });
    expect(
      mergeCopyOverride({ de: { title: "Konflikte" } }, "de", {
        title: "",
        tagline: "",
      })
    ).toBeNull();
    expect(mergeCopyOverride(null, "de", { title: "", tagline: "" })).toBeNull();
  });

  it("does not mutate the stored override", () => {
    const stored = { de: { title: "Konflikte" } };
    mergeCopyOverride(stored, "de", { title: "", tagline: "" });
    expect(stored).toEqual({ de: { title: "Konflikte" } });
  });
});

describe("cleanCopyText", () => {
  it("trims and caps the length", () => {
    expect(cleanCopyText("  Hello  ", 120)).toBe("Hello");
    expect(cleanCopyText("abcdef", 3)).toBe("abc");
    expect(cleanCopyText("ab   cd", 3)).toBe("ab");
  });

  it("strips control and bidi-override characters but keeps newlines", () => {
    expect(cleanCopyText("A\u0000B\u0007C\tD", 50)).toBe("ABCD");
    expect(cleanCopyText("safe‮txt.exe", 50)).toBe("safetxt.exe");
    expect(cleanCopyText("line one\nline two", 50)).toBe("line one\nline two");
  });

  it("keeps Greek and German letters", () => {
    expect(cleanCopyText("Σύγκρουση · Größe", 50)).toBe("Σύγκρουση · Größe");
  });
});
