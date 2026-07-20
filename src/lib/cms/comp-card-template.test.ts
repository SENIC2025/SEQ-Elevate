import { describe, it, expect } from "vitest";
import {
  applyTemplateOverride,
  pickOverride,
} from "./comp-card-template";
import type { CompCardTemplate } from "./types";

const base: CompCardTemplate = {
  fields: [
    { key: "wentWell", label: "What went well?", placeholder: "…", kind: "longtext" },
    { key: "difficult", label: "What was hard?", placeholder: "…", kind: "longtext" },
    { key: "improve", label: "What next?", placeholder: "…", kind: "longtext" },
    { key: "behaviour", label: "Behaviour", placeholder: "…", kind: "longtext" },
    { key: "confidence", label: "Confidence", kind: "confidence" },
  ],
};

describe("applyTemplateOverride", () => {
  it("returns the base unchanged when there is no override", () => {
    expect(applyTemplateOverride(base, null)).toEqual(base);
  });

  it("rewords a field's label and placeholder", () => {
    const out = applyTemplateOverride(base, {
      fields: { wentWell: { label: "Wins this week", placeholder: "one line" } },
    });
    const f = out.fields.find((x) => x.key === "wentWell");
    expect(f?.label).toBe("Wins this week");
    expect(f?.placeholder).toBe("one line");
  });

  it("keeps the bundled label when the override label is blank", () => {
    // An empty string is not a rename — a field with no visible name is worse
    // than the default wording.
    const out = applyTemplateOverride(base, {
      fields: { wentWell: { label: "   " } },
    });
    expect(out.fields.find((x) => x.key === "wentWell")?.label).toBe(
      "What went well?"
    );
  });

  it("hides a field", () => {
    const out = applyTemplateOverride(base, { hidden: ["improve"] });
    expect(out.fields.map((f) => f.key)).not.toContain("improve");
    expect(out.fields).toHaveLength(4);
  });

  it("reorders fields, keeping unlisted ones after the listed ones", () => {
    const out = applyTemplateOverride(base, {
      order: ["confidence", "difficult"],
    });
    expect(out.fields[0].key).toBe("confidence");
    expect(out.fields[1].key).toBe("difficult");
  });

  it("ignores unknown keys in an override (JSON is untrusted)", () => {
    const out = applyTemplateOverride(base, {
      // @ts-expect-error deliberately invalid key
      fields: { madeUp: { label: "nope" } },
      hidden: ["madeUp"],
      order: ["madeUp"],
    });
    expect(out.fields).toHaveLength(5);
    expect(out.fields.some((f) => f.key === "madeUp")).toBe(false);
  });

  it("falls back to the base rather than yield an empty form", () => {
    const out = applyTemplateOverride(base, {
      hidden: ["wentWell", "difficult", "improve", "behaviour", "confidence"],
    });
    expect(out.fields).toHaveLength(5); // hiding everything is refused here
  });
});

describe("pickOverride", () => {
  it("prefers the requested locale, then en, then nothing", () => {
    const all = {
      en: { hidden: ["improve"] },
      de: { hidden: ["behaviour"] },
    };
    expect(pickOverride(all, "de")?.hidden).toEqual(["behaviour"]);
    expect(pickOverride(all, "el")?.hidden).toEqual(["improve"]); // → en
    expect(pickOverride(null, "en")).toBeNull();
  });
});
