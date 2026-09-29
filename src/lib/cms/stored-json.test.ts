import { describe, it, expect } from "vitest";
import { canonicalJson, sameStoredJson, fingerprint } from "./stored-json";

describe("sameStoredJson", () => {
  it("ignores key order at every depth (jsonb reorders keys)", () => {
    const a = { kind: "simulation", prompt: { en: "Hi", de: "Hallo" } };
    const b = { prompt: { de: "Hallo", en: "Hi" }, kind: "simulation" };
    expect(sameStoredJson(a, b)).toBe(true);
  });

  it("treats an undefined field as absent (JSON drops it)", () => {
    expect(
      sameStoredJson({ title: "T", subtitle: undefined }, { title: "T" })
    ).toBe(true);
  });

  it("sees a changed, added or removed translation", () => {
    const base = { prompt: { en: "Hi" } };
    expect(sameStoredJson(base, { prompt: { en: "Hello" } })).toBe(false);
    expect(sameStoredJson(base, { prompt: { en: "Hi", el: "Γεια" } })).toBe(
      false
    );
    expect(sameStoredJson({ prompt: { en: "Hi", el: "Γεια" } }, base)).toBe(
      false
    );
  });

  it("keeps array order significant", () => {
    expect(sameStoredJson({ o: ["a", "b"] }, { o: ["b", "a"] })).toBe(false);
  });

  it("tells nothing stored apart from something stored", () => {
    expect(sameStoredJson(null, null)).toBe(true);
    expect(sameStoredJson(null, undefined)).toBe(true);
    expect(sameStoredJson(null, { kind: "assessment" })).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys and keeps values", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      '{"a":[{"c":3,"d":2}],"b":1}'
    );
  });
});

describe("fingerprint", () => {
  it("is null when nothing is stored", () => {
    expect(fingerprint(null)).toBeNull();
    expect(fingerprint(undefined)).toBeNull();
  });

  it("is the same for the same data, whatever the key order", () => {
    expect(fingerprint({ title: "A", blocks: [] })).toBe(
      fingerprint({ blocks: [], title: "A", subtitle: undefined })
    );
  });

  it("changes when any text changes", () => {
    const a = fingerprint({ title: "Lesson", blocks: [{ text: "One" }] });
    const b = fingerprint({ title: "Lesson", blocks: [{ text: "One." }] });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-z]+$/);
  });
});
