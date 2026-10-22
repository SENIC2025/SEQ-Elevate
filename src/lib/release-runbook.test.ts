import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * The runbooks say what Release 3 needs on deploy day and after it (spec
 * 15, 17.6; D77). They are read by whoever deploys, rolls back or answers a
 * data request, often under pressure, so what they must say is pinned here.
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

const goLive = read("GO-LIVE.md");

describe("GO-LIVE.md: Release 3's settings (§1)", () => {
  it("names every setting Release 3 reads, with what production starts with", () => {
    const settings = section(goLive, "1");
    for (const name of [
      "R3_PARTNER_ACCESS",
      "STATS_FROM",
      "PROFILE_CONSENT",
      "AGE_RULE",
      "R3_PROFILE_GATE",
      "R3_LANGUAGE_READY",
      "R3_BLOB_DELETE",
    ]) {
      expect(settings, name).toMatch(new RegExp(`\\| \`${name}\` \\|`));
    }
    // Partner access stays off until the production security review starts.
    expect(settings).toMatch(/`R3_PARTNER_ACCESS` \| \*\(unset\)\*[^\n]*23 Nov/);
  });
});

describe("GO-LIVE.md: deploying Release 3", () => {
  const deploy = { toString: () => section(goLive, "1a") };
  const text = () => String(deploy);

  it("has the deploy day's steps in order: settings and backup, the deploy, the check, the ADMIN's first steps, the smoke test, the review switch", () => {
    const steps = ["BLOB_PUBLIC_HOST", "r3-check", "country mapping", "Smoke", "R3_PARTNER_ACCESS=on"];
    const at = steps.map((s) => text().indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(steps.filter((_, i) => at[i] < 0))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("says what to do when a migration fails: which ones apply nothing, which may be partly applied, and how to resolve", () => {
    expect(text()).toMatch(/20261120090100_r3_people_privacy_content[^\n]*one transaction/);
    expect(text()).toMatch(/20261120090200_r3_course_project_columns[^\n]*may be partly applied/);
    expect(text()).toMatch(/20261120090300_r3_sharing_and_guardian_triggers/);
    expect(text()).toContain("npx prisma migrate resolve --rolled-back");
    expect(text()).toContain("DIRECT");
  });
});

describe("GO-LIVE.md: rollback (§11, D77)", () => {
  const rollback = () => section(goLive, "11");

  it("puts Release 3's switches first, then Release 2 only up to Wed 25 Nov and only after the pre-rollback step, then fix forward only", () => {
    const switches = rollback().indexOf("R3_PROFILE_GATE=off");
    const release2 = rollback().search(/Release 2 deployment/);
    const fixForward = rollback().search(/fix forward only/i);
    expect(switches).toBeGreaterThan(-1);
    expect(release2).toBeGreaterThan(switches);
    expect(fixForward).toBeGreaterThan(release2);
    expect(rollback()).toMatch(/Wed(nesday)? 25 Nov/);
    expect(rollback()).toMatch(/pre-rollback step/i);
    expect(rollback()).toMatch(/r3-check[^\n]*0 `?PARTNER_ADMIN`? memberships|no `?PARTNER_ADMIN`? membership/);
  });

  it("says what Release 2 does on Release 3's data, and what rolling forward again needs", () => {
    expect(rollback()).toMatch(/every facilitator/);
    expect(rollback()).toMatch(/roll(ing)? forward/i);
    expect(rollback()).toContain("member.cohort_changed");
  });

  it("never offers an older deployment without those limits, nor Release 1 once Release 3 is live", () => {
    expect(rollback()).not.toMatch(/\*\*Promote\*\* a previous good deployment to roll back instantly/);
    expect(rollback()).toMatch(/never promote (a |the )?Release 1/i);
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
 * On the deploy commit only (R3_DEPLOY_COMMIT=1, the release check of spec
 * 18.7 run on the commit that deploys): the data-protection documents no
 * longer describe Release 3 as planned, since it is live.
 */
describe.skipIf(process.env.R3_DEPLOY_COMMIT !== "1")("on the deploy commit", () => {
  it.each(["DATA-PROTECTION.md", "DPA-TEMPLATE.md"])("%s describes Release 3 as live, nothing of it as planned", (file) => {
    expect(read(file)).not.toMatch(/Planned from 20 November/);
  });
});
