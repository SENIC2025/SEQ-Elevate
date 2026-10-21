import { describe, it, expect } from "vitest";
import {
  coverage,
  guardLabel,
  rowKey,
  TABLE,
  useServerExports,
  type CallRow,
  type PartnerAdminRefusal,
} from "./index";

/**
 * Release 3 (spec 18.3): the action table covers every export of every
 * "use server" file, once — checked here without a build or a database, so
 * a new action without a row fails the unit suite before any end-to-end
 * run (e2e/r3-actions.spec.ts checks the build's actions too).
 */

describe("the action table", () => {
  const exports = useServerExports();

  it("finds the exports of the \"use server\" files", () => {
    const keys = exports.map((x) => `${x.file}#${x.name}`);
    expect(keys).toContain("src/app/actions/facilitator.ts#saveObservation");
    expect(keys).toContain("src/app/actions/admin.ts#addMember");
    // Not a "use server" file: its exports are not endpoints.
    expect(keys.some((k) => k.startsWith("src/lib/invitations.ts#"))).toBe(false);
  });

  it("has a row for every export, none for anything else, and none twice", () => {
    expect(coverage(exports)).toEqual({ missing: [], stale: [], twice: [] });
  });

  it("says why each row refuses the partner admin, and only where it does", () => {
    for (const row of TABLE) {
      if (row.kind !== "call" && row.kind !== "route") continue;
      if (row.refuse.includes("PAA")) {
        expect(["scope", "role", "anyone"], rowKey(row)).toContain(row.partnerAdmin);
      } else {
        expect(row.partnerAdmin, rowKey(row)).toBeUndefined();
      }
    }
  });

  it("titles a partner admin's refusal by the negative control that can show it failing", () => {
    const row = (partnerAdmin?: PartnerAdminRefusal) =>
      ({ ...TABLE.find((r) => r.kind === "call")!, partnerAdmin }) as CallRow;
    expect(guardLabel(row("scope"), "PAA")).toBe(" (guard)");
    expect(guardLabel(row("role"), "PAA")).toBe(" (role guard)");
    expect(guardLabel(row("anyone"), "PAA")).toBe("");
    // A row that doesn't say is taken for a scope guard: the scope control then shows whether it fails.
    expect(guardLabel(row(undefined), "PAA")).toBe(" (guard)");
    for (const as of ["FA", "FB", "FN", "FI", "EA", "LA1", "anonymous"] as const) {
      expect(guardLabel(row("scope"), as)).toBe("");
    }
  });

  it("names the personas each callable row must refuse", () => {
    for (const row of TABLE) {
      if (row.kind === "call" || row.kind === "route") {
        expect(row.refuse.length, rowKey(row)).toBeGreaterThan(0);
        expect(row.tables.length, rowKey(row)).toBeGreaterThan(0);
      }
      expect(row.why.trim(), rowKey(row)).not.toBe("");
    }
  });
});
