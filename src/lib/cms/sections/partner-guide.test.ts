import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * docs/partner-guide-lessons.md tells partners what live-rules.ts does
 * (spec 7.5), in their words. These checks hold the guide to the rule's
 * table (spec 7.2) and the lesson plan (learner-path.ts) where a draft of
 * it once said more than the platform does.
 */

const guide = readFileSync(join(process.cwd(), "docs/partner-guide-lessons.md"), "utf8");

/** One "## …" section of the guide. */
function section(title: string): string {
  const start = guide.indexOf(`## ${title}`);
  expect(start, title).toBeGreaterThanOrEqual(0);
  const end = guide.indexOf("\n## ", start + 1);
  return guide.slice(start, end === -1 ? undefined : end);
}

describe("the partner guide", () => {
  it("sums up deleting on a course with learners as the rules have it (spec 7.2)", () => {
    const bullet = section("In one minute")
      .split("\n")
      .find((line) => line.includes("Once people are taking a course"));
    expect(bullet).toBeDefined();
    // Published with learners: no lesson can be deleted (Hide instead) ...
    expect(bullet).toMatch(/published course with learners, no lesson can be deleted/i);
    // ... unpublished: only a lesson nobody has anything in.
    expect(bullet).toMatch(/isn't published, only a lesson no learner has anything in can be deleted/i);
    // A question is kept and edited, never hidden.
    expect(bullet).toMatch(/question learners may have answered can't be removed/i);
    expect(bullet).not.toMatch(/question[^.]*hide it instead/i);
  });

  it("says the 1 December rule holds for any course with learners, published or not (D67)", () => {
    // Settled at integration: unpublishing a course to rework it, then
    // publishing it again, doesn't get round the cut-off.
    const summary = section("In one minute")
      .split("\n")
      .find((line) => line.includes("From 1 December"));
    expect(summary).toBeDefined();
    expect(summary).toMatch(/a course with learners/i);
    expect(summary).toMatch(/published or not/i);
    const rule = guide.slice(guide.indexOf("### From 1 December"), guide.indexOf("## Questions partners have asked"));
    expect(rule).toMatch(/published or not/i);
    expect(rule).not.toMatch(/a \*\*published\*\* course with learners keeps its shape/i);
    expect(rule).not.toMatch(/isn't published[^.]*can be restructured/i);
  });

  it("says a lesson of your own appears with content learners can get, a question once saved with Save stage", () => {
    const line = section("The lesson list")
      .split("\n")
      .find((l) => l.includes("Learners get this lesson as soon as it has content"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\*\*Save stage\*\*/);
    expect(line).toMatch(/draft/i);
    expect(line).not.toMatch(/with your first save/);
  });
});
