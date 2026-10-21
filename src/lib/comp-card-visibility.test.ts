import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  COMP_CARD_TEXT_MAX,
  SHARING_TEXT_VERSION,
  compCardForViewer,
  effectiveSharing,
  hiddenInAnyLanguage,
  parseCompCardInput,
  viewerOrganisation,
  type CardRow,
  type CompCardField,
} from "./comp-card-visibility";
import type { Scope } from "./scope";

/*
 * Who reads a Comp Card (D80, D81, spec 4.2), checked over the whole table:
 * privacy × sharedAt × shared with whom × the viewer's scope and roles ×
 * the fields the template hides. FD-U5.
 */

const SHARED_AT = new Date("2026-11-21T10:00:00.000Z");
const card = (over: Partial<CardRow> = {}): CardRow => ({
  privacy: "FACILITATOR",
  sharedAt: SHARED_AT,
  sharedWithOrganisationId: "org-a",
  wentWell: "went well",
  difficult: "was hard",
  improve: "next time",
  behaviour: "",
  confidence: 4,
  ...over,
});
const NO_HIDDEN = new Set<CompCardField>();

const PRIVACY = ["SELF", "FACILITATOR", "FACILITATOR_AND_MENTOR", "SOMETHING_NEW", ""];
const SHARED_AT_VALUES = [null, SHARED_AT];
const SHARED_WITH = ["org-a", "org-b", null];
const SCOPES: Scope[] = [
  { kind: "organisation", viewerId: "v", organisationId: "org-a" },
  { kind: "organisation", viewerId: "v", organisationId: "org-b" },
  { kind: "project", viewerId: "v", viewerOrganisationId: "org-a" },
  { kind: "project", viewerId: "v", viewerOrganisationId: "org-b" },
  { kind: "project", viewerId: "v", viewerOrganisationId: null },
  { kind: "none" },
];
const ROLES: Role[][] = [["FACILITATOR"], ["PARTNER_ADMIN"], ["ADMIN"], ["CONTENT_EDITOR"], ["LEARNER"], []];

describe("effectiveSharing", () => {
  it("is 'facilitators' only for FACILITATOR, with sharedAt, shared with the learner's organisation", () => {
    for (const privacy of PRIVACY) {
      for (const sharedAt of SHARED_AT_VALUES) {
        for (const sharedWithOrganisationId of SHARED_WITH) {
          for (const learnerOrganisation of ["org-a", "org-b", null]) {
            const expected =
              privacy === "FACILITATOR" &&
              sharedAt !== null &&
              sharedWithOrganisationId !== null &&
              sharedWithOrganisationId === learnerOrganisation
                ? "facilitators"
                : "onlyMe";
            expect(
              effectiveSharing({ privacy, sharedAt, sharedWithOrganisationId }, learnerOrganisation),
              JSON.stringify([privacy, sharedAt, sharedWithOrganisationId, learnerOrganisation])
            ).toBe(expected);
          }
        }
      }
    }
  });

  it("reads a card a Release 2 page set to FACILITATOR without sharing it as 'onlyMe'", () => {
    expect(effectiveSharing({ privacy: "FACILITATOR", sharedAt: null, sharedWithOrganisationId: null }, "org-a")).toBe(
      "onlyMe"
    );
  });

  it("puts a card shared with an organisation the learner left to sleep", () => {
    expect(effectiveSharing(card(), "org-b")).toBe("onlyMe");
    expect(effectiveSharing(card(), null)).toBe("onlyMe");
  });
});

describe("compCardForViewer", () => {
  it("over the whole table: visible only when shared, to supporting staff of that organisation", () => {
    let visible = 0;
    for (const privacy of PRIVACY) {
      for (const sharedAt of SHARED_AT_VALUES) {
        for (const sharedWithOrganisationId of SHARED_WITH) {
          for (const learnerOrganisation of ["org-a", "org-b", null]) {
            for (const scope of SCOPES) {
              for (const roles of ROLES) {
                const row = card({ privacy, sharedAt, sharedWithOrganisationId });
                const seen = compCardForViewer(row, learnerOrganisation, { scope, roles }, NO_HIDDEN);
                const viewerOrg = viewerOrganisation(scope);
                const supports = roles.some((r) => r === "FACILITATOR" || r === "PARTNER_ADMIN" || r === "ADMIN");
                const expected =
                  effectiveSharing(row, learnerOrganisation) === "facilitators" &&
                  supports &&
                  viewerOrg !== null &&
                  viewerOrg === sharedWithOrganisationId;
                const label = JSON.stringify([privacy, sharedAt, sharedWithOrganisationId, learnerOrganisation, scope, roles]);
                expect(seen !== null, label).toBe(expected);
                if (seen) visible++;
              }
            }
          }
        }
      }
    }
    // The table holds visible cases too, so it tests both answers.
    expect(visible).toBeGreaterThan(0);
  });

  it("shows the organisation's facilitators and partner admins the shared fields and confidence", () => {
    const viewer = { scope: SCOPES[0], roles: ["FACILITATOR"] as Role[] };
    expect(compCardForViewer(card(), "org-a", viewer, NO_HIDDEN)).toEqual({
      fields: { wentWell: "went well", difficult: "was hard", improve: "next time" },
      confidence: 4,
      sharedAt: "2026-11-21T10:00:00.000Z",
    });
    expect(compCardForViewer(card(), "org-a", { ...viewer, roles: ["PARTNER_ADMIN"] }, NO_HIDDEN)).not.toBeNull();
  });

  it("shows an ADMIN only cards shared with the ADMIN's own organisation; a SENIC admin none (D81)", () => {
    const diesisAdmin = { scope: SCOPES[2], roles: ["ADMIN"] as Role[] };
    const senicAdmin = { scope: SCOPES[4], roles: ["ADMIN"] as Role[] };
    expect(compCardForViewer(card(), "org-a", diesisAdmin, NO_HIDDEN)).not.toBeNull();
    expect(compCardForViewer(card({ sharedWithOrganisationId: "org-b" }), "org-b", diesisAdmin, NO_HIDDEN)).toBeNull();
    expect(compCardForViewer(card(), "org-a", senicAdmin, NO_HIDDEN)).toBeNull();
  });

  it("answers null alike for no card, an unshared card and a card shared elsewhere", () => {
    const viewer = { scope: SCOPES[1], roles: ["FACILITATOR"] as Role[] };
    expect(compCardForViewer(null, "org-b", viewer, NO_HIDDEN)).toBeNull();
    expect(compCardForViewer(card({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null }), "org-b", viewer, NO_HIDDEN)).toBeNull();
    expect(compCardForViewer(card(), "org-a", viewer, NO_HIDDEN)).toBeNull();
  });

  it("leaves out fields the template hides, and empty ones", () => {
    const viewer = { scope: SCOPES[0], roles: ["FACILITATOR"] as Role[] };
    const seen = compCardForViewer(card({ behaviour: "   " }), "org-a", viewer, new Set<CompCardField>(["difficult"]));
    expect(seen?.fields).toEqual({ wentWell: "went well", improve: "next time" });
  });

  it("gives a confidence stored outside 1..5 as null", () => {
    const viewer = { scope: SCOPES[0], roles: ["FACILITATOR"] as Role[] };
    for (const confidence of [0, 6, 2.5, -1, Number.NaN]) {
      expect(compCardForViewer(card({ confidence }), "org-a", viewer, NO_HIDDEN)?.confidence, String(confidence)).toBeNull();
    }
    for (const confidence of [1, 5]) {
      expect(compCardForViewer(card({ confidence }), "org-a", viewer, NO_HIDDEN)?.confidence).toBe(confidence);
    }
  });
});

/*
 * A field the Comp Card template hides in any language stays out of a
 * shared card (spec 4.2): the learner may never have seen it.
 */
describe("hiddenInAnyLanguage", () => {
  it("collects the fields hidden in any language, the confidence included", () => {
    expect(hiddenInAnyLanguage({ en: { hidden: [] }, de: { hidden: ["difficult"] }, el: { hidden: ["confidence", "difficult"] } }))
      .toEqual(new Set(["difficult", "confidence"]));
  });

  it("ignores anything that isn't a field, and a template that isn't one", () => {
    expect(hiddenInAnyLanguage({ de: { hidden: ["wentWell", "scenario", 5, null] }, el: null, en: "x" })).toEqual(
      new Set(["wentWell"])
    );
    for (const nothing of [null, undefined, "x", 3, [], { de: { hidden: "difficult" } }]) {
      expect(hiddenInAnyLanguage(nothing)).toEqual(new Set());
    }
  });

  it("makes a hidden confidence read as null on a shared card", () => {
    const viewer = { scope: SCOPES[0], roles: ["FACILITATOR"] as Role[] };
    expect(compCardForViewer(card(), "org-a", viewer, new Set(["confidence"] as const))?.confidence).toBeNull();
    expect(compCardForViewer(card(), "org-a", viewer, NO_HIDDEN)?.confidence).toBe(4);
  });
});

describe("parseCompCardInput", () => {
  it("takes only the fields sent, and ignores privacy and anything else", () => {
    expect(parseCompCardInput({ wentWell: "a", privacy: "facilitator", userId: "x" }, null)).toEqual({
      ok: true,
      value: { wentWell: "a" },
    });
    expect(parseCompCardInput({}, null)).toEqual({ ok: true, value: {} });
    expect(
      parseCompCardInput({ wentWell: "a", difficult: "", improve: "c", behaviour: "d", confidence: 5 }, null)
    ).toEqual({ ok: true, value: { wentWell: "a", difficult: "", improve: "c", behaviour: "d", confidence: 5 } });
    expect(parseCompCardInput({ wentWell: undefined, confidence: undefined }, null)).toEqual({ ok: true, value: {} });
  });

  it("refuses input that isn't an object of texts", () => {
    for (const input of [null, undefined, "text", 3, ["a"]]) {
      expect(parseCompCardInput(input, null), String(input)).toEqual({ ok: false, error: "bad-input" });
    }
    expect(parseCompCardInput({ improve: 5 }, null)).toEqual({ ok: false, error: "bad-input", field: "improve" });
    expect(parseCompCardInput({ wentWell: null }, null)).toEqual({ ok: false, error: "bad-input", field: "wentWell" });
  });

  it("takes a confidence of 1 to 5 only", () => {
    for (const confidence of [1, 2, 3, 4, 5]) {
      expect(parseCompCardInput({ confidence }, null)).toEqual({ ok: true, value: { confidence } });
    }
    for (const confidence of [0, 6, 2.5, "3", null, Number.NaN]) {
      expect(parseCompCardInput({ confidence }, null), String(confidence)).toEqual({ ok: false, error: "bad-input" });
    }
  });

  it("refuses a field past 2,000 characters, naming it, rather than cutting it", () => {
    expect(COMP_CARD_TEXT_MAX).toBe(2000);
    expect(parseCompCardInput({ wentWell: "x".repeat(2000) }, null).ok).toBe(true);
    expect(parseCompCardInput({ wentWell: "ok", behaviour: "x".repeat(2001) }, null)).toEqual({
      ok: false,
      error: "too-long",
      field: "behaviour",
    });
  });

  it("refuses only growth: a longer stored text may be saved unchanged or shorter", () => {
    const stored = { difficult: "y".repeat(2500) };
    expect(parseCompCardInput({ difficult: "y".repeat(2500) }, stored).ok).toBe(true);
    expect(parseCompCardInput({ difficult: "y".repeat(2400) }, stored).ok).toBe(true);
    expect(parseCompCardInput({ difficult: "y".repeat(2501) }, stored)).toEqual({
      ok: false,
      error: "too-long",
      field: "difficult",
    });
    // Another field's stored length doesn't count.
    expect(parseCompCardInput({ wentWell: "y".repeat(2001) }, stored)).toEqual({
      ok: false,
      error: "too-long",
      field: "wentWell",
    });
  });

  it("has a version for the sharing wording", () => {
    expect(SHARING_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
