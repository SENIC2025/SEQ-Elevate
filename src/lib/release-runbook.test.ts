import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * The runbooks say what the live release needs (Releases 2, 3 and 4, live
 * together since 31 October 2026: D115; spec 15, 17.6; D77). They are read
 * by whoever deploys, rolls back or answers a data request, often under
 * pressure, so what they must say is pinned here.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

/** The text of the section of `doc` whose heading starts `## <number>.` (to the next `## `). */
function section(doc: string, number: string): string {
  const start = doc.search(new RegExp(`^## ${number.replace(".", "\\.")}[. ]`, "m"));
  if (start < 0) throw new Error(`no section ${number}`);
  const next = doc.slice(start + 3).search(/^## /m);
  return next < 0 ? doc.slice(start) : doc.slice(start, start + 3 + next);
}

/** Each of `steps` is in `text`, in this order. */
function inOrder(text: string, steps: string[]) {
  const at = steps.map((s) => text.indexOf(s));
  expect(at.every((i) => i >= 0), JSON.stringify(steps.filter((_, i) => at[i] < 0))).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
}

const goLive = read("GO-LIVE.md");

describe("GO-LIVE.md: the settings (§1)", () => {
  it("names every setting the live code reads, with what production starts with", () => {
    const settings = section(goLive, "1");
    for (const name of [
      "R3_PARTNER_ACCESS",
      "STATS_FROM",
      "PROFILE_CONSENT",
      "AGE_RULE",
      "R3_PROFILE_GATE",
      "R3_LANGUAGE_READY",
      "R3_BLOB_DELETE",
      "R2_LEARNER_PLAYER",
      "R4_FURTHER_READING",
      "R4_ITEM_LANGUAGE",
    ]) {
      expect(settings, name).toMatch(new RegExp(`\\| \`${name}\` \\|`));
    }
    // Partner access stays off until Release 3's security review passes (D115).
    expect(settings).toMatch(/`R3_PARTNER_ACCESS` \| \*\(unset\)\* until Release 3's security review passes/);
    // The Release 1 deployment, the one rollback target, reads it.
    expect(settings).toMatch(/`DEMO_LOGIN_DISABLED` \| `true` \|[^\n]*Release 1 deployment/);
  });
});

describe("GO-LIVE.md: the go-live of Releases 2, 3 and 4 (§1a, D115)", () => {
  const text = () => section(goLive, "1a");

  it("records what was done on 31 October, then what is still to come before the pilot, in order", () => {
    inOrder(text(), [
      "Sat 31 Oct 2026",
      "BLOB_PUBLIC_HOST",
      "fast-forwarded",
      "country mapping",
      "Still to come",
      "Release 3's production security review",
      "R3_PARTNER_ACCESS=on",
      "Mon 30 Nov",
      "the pilot starts",
    ]);
  });

  it("keeps partner access off, and invites no partner admin, until Release 3's review passes; names the reviews and who runs them", () => {
    expect(text()).toMatch(/`R3_PARTNER_ACCESS` stays unset and no partner admin is invited/);
    expect(text()).toContain("Release 4's independent security review");
    expect(text()).toContain("Daniele Tappa (DIESIS)");
    expect(text()).toMatch(/switches German or Greek on for a course at the partner's written request/);
  });

  it("names the six migrations it applied", () => {
    for (const migration of [
      "20261021120000_enrollment_sections_responses",
      "20261120090000_r3_role_partner_admin",
      "20261120090100_r3_people_privacy_content",
      "20261120090200_r3_course_project_columns",
      "20261120090300_r3_sharing_and_guardian_triggers",
      "20261126090000_r4_further_reading",
    ]) {
      expect(text(), migration).toContain(migration);
    }
  });

  it("says what to do when a migration fails: whether it applied nothing or may be partly applied, and how to resolve", () => {
    expect(text()).toMatch(/applied nothing or may be partly applied/);
    expect(text()).toContain("npx prisma migrate resolve --rolled-back");
    expect(text()).toContain("DIRECT");
  });
});

describe("GO-LIVE.md: rollback (§11, D115)", () => {
  const rollback = () => section(goLive, "11");

  it("puts the switches first, then the Release 1 deployment only while no partner admin exists and no real learner has signed in, then fix forward only", () => {
    const switches = ["R3_PROFILE_GATE=off", "R4_FURTHER_READING=off", "R2_LEARNER_PLAYER=off"].map((s) => rollback().indexOf(s));
    const release1 = rollback().search(/The Release 1 deployment/);
    const fixForward = rollback().search(/fix forward only/i);
    for (const at of switches) {
      expect(at).toBeGreaterThan(-1);
      expect(release1).toBeGreaterThan(at);
    }
    expect(fixForward).toBeGreaterThan(release1);
    expect(rollback()).toMatch(/no `PARTNER_ADMIN` membership exists/);
    expect(rollback()).toMatch(/no real learner has signed in/);
    expect(rollback()).toMatch(/not rehearsed/);
    expect(rollback()).toMatch(/`DEMO_LOGIN_DISABLED` stays `true`/);
  });

  it("never offers a Release 2 deployment (none served production), nor an older deployment without those limits", () => {
    expect(rollback()).not.toMatch(/Release 2 deployment/);
    expect(rollback()).not.toMatch(/\*\*Promote\*\* a previous good deployment to roll back instantly/);
  });
});

describe("docs/data-management.md: a request to restrict", () => {
  it("doesn't offer Remove as a restriction: the next page makes the person a learner again", () => {
    const guide = read("docs/data-management.md");
    const restriction = guide.slice(guide.indexOf("**Restriction or objection.**"), guide.indexOf("## 4."));
    expect(restriction).not.toMatch(/Usual answers:[^.]*removes the person/);
    expect(restriction).toMatch(/Remove[^.]*no restriction|not a restriction/i);
    expect(restriction).toMatch(/next (visit|page)/);
  });
});

describe("DATA-PROTECTION.md: what it says of Release 3 as it ships", () => {
  const dp = read("DATA-PROTECTION.md");

  it("says the log records document changes (added, removed, published, withdrawn), wherever it lists what the log records", () => {
    expect(dp).not.toMatch(/does \*\*not\*\* record[^\n]*document changes/);
    expect(dp).not.toMatch(/not record[^\n.]*,? or document changes/);
    const row14 = dp.split("\n").find((l) => l.startsWith("| 14 |")) ?? "";
    expect(row14).toMatch(/lesson documents added, removed, published and withdrawn/);
  });
});

/*
 * The data-protection documents describe Release 3 as it deploys: `r3`
 * reaches GitHub only in the deploy merge (D100), so what these files say
 * on `r3` is what they say once Release 3 is live.
 */
describe("the data-protection documents describe Release 3 as built", () => {
  it.each(["DATA-PROTECTION.md", "DPA-TEMPLATE.md"])("%s describes nothing of Release 3 as planned", (file) => {
    expect(read(file)).not.toMatch(/Planned from 20 November|planned from 20 November/);
    expect(read(file)).not.toMatch(/Measures planned before the pilot/);
  });

  it.each(["DATA-PROTECTION.md", "DPA-TEMPLATE.md", "docs/staff-guide.md"])("%s names the full name the profile step asks for (D114)", (file) => {
    expect(read(file)).not.toMatch(/nickname/i);
    expect(read(file)).toMatch(/full name/);
  });

  it.each(["DATA-PROTECTION.md", "DPA-TEMPLATE.md"])("%s describes the platform as live since 31 October 2026, not by the dated plan (D115)", (file) => {
    expect(read(file)).toMatch(/since 31 Oct(ober)? 2026/);
    expect(read(file)).not.toMatch(/\b(10|20|26) Nov(ember)?\b/);
  });

  it("DPA-TEMPLATE.md says the log records lesson document changes", () => {
    const dpa = read("DPA-TEMPLATE.md");
    expect(dpa).not.toMatch(/does not record[^\n.]*document changes/);
    expect(dpa).toMatch(/audit log\*\* of staff actions, lesson document changes included/);
  });
});
