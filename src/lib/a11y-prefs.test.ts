import { describe, it, expect } from "vitest";
import {
  DEFAULT_A11Y_PREFS,
  isDefaultPrefs,
  isPrefsOwner,
  ownerChanged,
  parseLocalPrefs,
  prefsAfterLoad,
  samePrefs,
  serializeLocalPrefs,
  toA11yPrefs,
  type A11yPrefs,
} from "./a11y-prefs";

const ALL_ON: A11yPrefs = { fontSize: "xl", dyslexia: true, contrast: true };

describe("toA11yPrefs", () => {
  it("keeps valid settings", () => {
    expect(toA11yPrefs(ALL_ON)).toEqual(ALL_ON);
    expect(toA11yPrefs({ fontSize: "lg", dyslexia: false, contrast: true })).toEqual({
      fontSize: "lg",
      dyslexia: false,
      contrast: true,
    });
  });

  it("takes an unknown font size for normal, and anything but true for off", () => {
    expect(toA11yPrefs({ fontSize: "huge", dyslexia: "yes", contrast: 1 })).toEqual(
      DEFAULT_A11Y_PREFS
    );
    expect(toA11yPrefs({})).toEqual(DEFAULT_A11Y_PREFS);
  });
});

describe("isDefaultPrefs / samePrefs", () => {
  it("compares every setting", () => {
    expect(isDefaultPrefs(DEFAULT_A11Y_PREFS)).toBe(true);
    expect(isDefaultPrefs({ ...DEFAULT_A11Y_PREFS, contrast: true })).toBe(false);
    expect(samePrefs(ALL_ON, { ...ALL_ON })).toBe(true);
    expect(samePrefs(ALL_ON, { ...ALL_ON, fontSize: "lg" })).toBe(false);
    expect(samePrefs(ALL_ON, { ...ALL_ON, dyslexia: false })).toBe(false);
  });
});

describe("parseLocalPrefs / serializeLocalPrefs", () => {
  it("reads back what it stored, with whose settings they are", () => {
    for (const fromAccount of [true, false]) {
      const local = { prefs: ALL_ON, fromAccount };
      expect(parseLocalPrefs(serializeLocalPrefs(local))).toEqual(local);
    }
  });

  it("reads a copy stored before `fromAccount` was kept as a guest's", () => {
    expect(
      parseLocalPrefs(JSON.stringify({ fontSize: "lg", dyslexia: true, contrast: false }))
    ).toEqual({
      prefs: { fontSize: "lg", dyslexia: true, contrast: false },
      fromAccount: false,
    });
  });

  it("is null for no copy or one it can't read", () => {
    expect(parseLocalPrefs(null)).toBeNull();
    expect(parseLocalPrefs("")).toBeNull();
    expect(parseLocalPrefs("{not json")).toBeNull();
    expect(parseLocalPrefs("null")).toBeNull();
    expect(parseLocalPrefs("42")).toBeNull();
  });

  it("repairs settings it can't use", () => {
    expect(parseLocalPrefs(JSON.stringify({ fontSize: "huge", fromAccount: "yes" }))).toEqual({
      prefs: DEFAULT_A11Y_PREFS,
      fromAccount: false,
    });
  });
});

describe("prefsAfterLoad", () => {
  it("shows the saved settings over this browser's copy", () => {
    const saved: A11yPrefs = { fontSize: "lg", dyslexia: false, contrast: true };
    expect(prefsAfterLoad(saved, ALL_ON, {})).toEqual(saved);
    expect(prefsAfterLoad(saved, null, {})).toEqual(saved);
  });

  it("shows the defaults when those are what's saved and there's no guest's choice", () => {
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, null, {})).toEqual(DEFAULT_A11Y_PREFS);
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, DEFAULT_A11Y_PREFS, {})).toEqual(
      DEFAULT_A11Y_PREFS
    );
  });

  it("moves a guest's settings into an account still on the defaults", () => {
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, ALL_ON, {})).toEqual(ALL_ON);
  });

  it("keeps what was chosen while they loaded, and the saved settings not chosen", () => {
    expect(prefsAfterLoad(ALL_ON, null, { fontSize: "lg" })).toEqual({
      fontSize: "lg",
      dyslexia: true,
      contrast: true,
    });
    expect(
      prefsAfterLoad(ALL_ON, null, { dyslexia: false, contrast: false })
    ).toEqual({ fontSize: "xl", dyslexia: false, contrast: false });
  });

  it("keeps a choice made while loading on top of a guest's migrated settings", () => {
    expect(
      prefsAfterLoad(DEFAULT_A11Y_PREFS, ALL_ON, { contrast: false })
    ).toEqual({ fontSize: "xl", dyslexia: true, contrast: false });
  });
});

describe("isPrefsOwner", () => {
  const user = { id: "user-a", email: "a@example.com" };

  it("is the account the save was made for, by id or email", () => {
    expect(isPrefsOwner(user, "user-a")).toBe(true);
    expect(isPrefsOwner(user, "a@example.com")).toBe(true);
  });

  it("isn't another account", () => {
    expect(isPrefsOwner(user, "user-b")).toBe(false);
    expect(isPrefsOwner(user, "b@example.com")).toBe(false);
    expect(isPrefsOwner(user, "")).toBe(false);
    expect(isPrefsOwner({ id: "user-a", email: null }, "a@example.com")).toBe(false);
  });

  it("accepts a save sent without it, from a page loaded before it was sent", () => {
    expect(isPrefsOwner(user, undefined)).toBe(true);
  });
});

describe("ownerChanged", () => {
  it("is a sign-in, a sign-out, or another account signing in", () => {
    expect(ownerChanged(null, "user-a")).toBe(true);
    expect(ownerChanged("user-a", null)).toBe(true);
    expect(ownerChanged("user-a", "user-b")).toBe(true);
  });

  it("isn't the same owner, the session loading, or the first owner found", () => {
    expect(ownerChanged("user-a", "user-a")).toBe(false);
    expect(ownerChanged(null, null)).toBe(false);
    expect(ownerChanged("user-a", undefined)).toBe(false);
    expect(ownerChanged(undefined, "user-a")).toBe(false);
    expect(ownerChanged(undefined, null)).toBe(false);
  });
});
