import { describe, it, expect } from "vitest";
import { coverage, rowKey, TABLE, useServerExports } from "./index";

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
