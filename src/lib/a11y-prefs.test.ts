import { describe, it, expect } from "vitest";
import {
  DEFAULT_A11Y_PREFS,
  isDefaultPrefs,
  isPrefsOwner,
  parseLocalPrefs,
  prefsAfterLoad,
  samePrefs,
  serializeLocalPrefs,
  toA11yPrefs,
  toPartialPrefs,
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

describe("toPartialPrefs", () => {
  it("keeps the settings held validly, and only those", () => {
    expect(toPartialPrefs(ALL_ON)).toEqual(ALL_ON);
    expect(toPartialPrefs({ fontSize: "lg" })).toEqual({ fontSize: "lg" });
    expect(toPartialPrefs({ dyslexia: false, contrast: true })).toEqual({
      dyslexia: false,
      contrast: true,
    });
  });

  it("leaves out a setting whose value isn't one", () => {
    expect(toPartialPrefs({ fontSize: "huge", dyslexia: "yes", contrast: 1 })).toEqual({});
    expect(toPartialPrefs({ fontSize: "xl", contrast: null })).toEqual({ fontSize: "xl" });
  });

  it("is empty for anything but an object", () => {
    expect(toPartialPrefs(null)).toEqual({});
    expect(toPartialPrefs(undefined)).toEqual({});
    expect(toPartialPrefs("xl")).toEqual({});
    expect(toPartialPrefs([])).toEqual({});
  });
});

describe("parseLocalPrefs / serializeLocalPrefs", () => {
  it("reads back what it stored, with the settings no account holds", () => {
    for (const unclaimed of [{}, { fontSize: "lg" as const }, ALL_ON]) {
      const local = { prefs: ALL_ON, unclaimed };
      expect(parseLocalPrefs(serializeLocalPrefs(local))).toEqual(local);
    }
  });

  it("reads a copy stored before `unclaimed` was kept as all a guest's", () => {
    const prefs: A11yPrefs = { fontSize: "lg", dyslexia: true, contrast: false };
    expect(parseLocalPrefs(JSON.stringify(prefs))).toEqual({ prefs, unclaimed: prefs });
  });

  it("is null for no copy or one it can't read", () => {
    expect(parseLocalPrefs(null)).toBeNull();
    expect(parseLocalPrefs("")).toBeNull();
    expect(parseLocalPrefs("{not json")).toBeNull();
    expect(parseLocalPrefs("null")).toBeNull();
    expect(parseLocalPrefs("42")).toBeNull();
  });

  it("repairs settings it can't use", () => {
    expect(
      parseLocalPrefs(
        JSON.stringify({ fontSize: "huge", unclaimed: { fontSize: "huge", contrast: true } })
      )
    ).toEqual({ prefs: DEFAULT_A11Y_PREFS, unclaimed: { contrast: true } });
    expect(parseLocalPrefs(JSON.stringify({ ...ALL_ON, unclaimed: "all" }))).toEqual({
      prefs: ALL_ON,
      unclaimed: {},
    });
  });
});

describe("prefsAfterLoad", () => {
  it("shows the saved settings over what no account holds", () => {
    const saved: A11yPrefs = { fontSize: "lg", dyslexia: false, contrast: true };
    expect(prefsAfterLoad(saved, ALL_ON, {})).toEqual({ prefs: saved, movedIn: false });
    expect(prefsAfterLoad(saved, {}, {})).toEqual({ prefs: saved, movedIn: false });
  });

  it("shows the defaults when those are what's saved and nothing was chosen here", () => {
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, {}, {})).toEqual({
      prefs: DEFAULT_A11Y_PREFS,
      movedIn: false,
    });
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, DEFAULT_A11Y_PREFS, {})).toEqual({
      prefs: DEFAULT_A11Y_PREFS,
      movedIn: false,
    });
    // Chosen here, but only back to a default: nothing to move in.
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, { fontSize: "normal" }, {})).toEqual({
      prefs: DEFAULT_A11Y_PREFS,
      movedIn: false,
    });
  });

  it("moves the settings chosen here into an account still on the defaults", () => {
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, ALL_ON, {})).toEqual({
      prefs: ALL_ON,
      movedIn: true,
    });
  });

  it("moves in only the settings chosen here, not the rest of what was shown", () => {
    // A guest chose Large on top of another account's settings still on
    // screen: only Large moves in.
    expect(prefsAfterLoad(DEFAULT_A11Y_PREFS, { fontSize: "lg" }, {})).toEqual({
      prefs: { fontSize: "lg", dyslexia: false, contrast: false },
      movedIn: true,
    });
  });

  it("keeps what was chosen while they loaded, and the saved settings not chosen", () => {
    expect(prefsAfterLoad(ALL_ON, { fontSize: "lg" }, { fontSize: "lg" })).toEqual({
      prefs: { fontSize: "lg", dyslexia: true, contrast: true },
      movedIn: false,
    });
    expect(
      prefsAfterLoad(ALL_ON, {}, { dyslexia: false, contrast: false })
    ).toEqual({
      prefs: { fontSize: "xl", dyslexia: false, contrast: false },
      movedIn: false,
    });
  });

  it("keeps a choice made while loading on top of the settings moved in", () => {
    expect(
      prefsAfterLoad(
        DEFAULT_A11Y_PREFS,
        { fontSize: "xl", dyslexia: true, contrast: true },
        { contrast: true }
      )
    ).toEqual({ prefs: ALL_ON, movedIn: true });
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
