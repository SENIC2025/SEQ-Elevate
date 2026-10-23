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

  it("says only hiding or deleting the last lesson learners see is refused, and what removing its last content does (finding 6)", () => {
    // The guide said a published course always keeps a lesson learners can
    // see; removing a lesson's last content (allowed, spec 7.2) takes that
    // lesson out of what they get, the last one included.
    const publishing = section("Publishing");
    expect(publishing).not.toMatch(/A published course keeps at least one lesson/i);
    expect(publishing).toMatch(/hiding or deleting the last lesson learners can see/i);
    expect(publishing).toMatch(/last content[^.]*(leaves|out of) (their course|what learners get)/i);
    const asks = section("Courses that have learners");
    expect(asks).toMatch(/only content[^|]*\|[^|]*leaves their course/i);
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

/*
 * Release 4, R2 (spec 11): the guide tells partners about links in their
 * text, further reading, a language per document or link, and references,
 * in the words the platform uses; and what further reading doesn't do
 * (make a lesson appear) and what coverage doesn't count. The rule for a
 * link's words is the narrowed one (D104 as built), with the site box
 * learners see (D105 as amended).
 */
describe("the partner guide on links, further reading and references (Release 4)", () => {
  it("sums them up in one minute", () => {
    const summary = section("In one minute");
    expect(summary).toMatch(/\*\*link words\*\*[^\n]*\*\*Link\*\* button \(Ctrl\+K, ⌘K on Mac\)/);
    expect(summary).toMatch(/links in text you paste from Word or Google Docs are kept/);
    expect(summary).toMatch(/\*\*further reading\*\*[^\n]*\*\*References & bibliography\*\*/);
  });

  it("says further reading never makes a lesson appear", () => {
    const line = section("The lesson list")
      .split("\n")
      .find((l) => l.includes("Learners get this lesson as soon as it has content"));
    expect(line).toMatch(/Further-reading links never make a lesson appear: a lesson with nothing but links stays out of what learners get\./);
  });

  it("explains links in text with the site box and the narrowed rule, not the rule it replaced", () => {
    const links = section("Links in your text");
    expect(links).toMatch(/Learners see the site each link opens in a small box after its words/);
    expect(links).toMatch(/"bpb\.de" linked to www\.bpb\.de is fine, but "paypal\.com" linked to another site is refused/);
    expect(links).not.toMatch(/The words you link must not show a different address than the link opens/);
    expect(links).toMatch(/Outlook "safe links"/);
    expect(links).toMatch(/private browser window/);
    expect(links).toMatch(/team or role address/);
  });

  it("explains further reading: drafts until shown, up to 30, after the lesson and before Continue", () => {
    const reading = section("Further reading");
    expect(reading).toMatch(/\*\*Add a link\*\* sits next to \*\*Upload document\*\*/);
    expect(reading).toMatch(/\*\*drafts\*\* until you choose \*\*Show to learners\*\*/);
    expect(reading).toMatch(/Up to 30 per lesson/);
    expect(reading).toMatch(/at the end of the lesson, before \*\*Continue\*\*/);
  });

  it("explains a language per document or link: items never change which lessons there are", () => {
    const languages = section("A language for each document or link");
    expect(languages).toMatch(/all three by default/);
    expect(languages).toMatch(/marked "In German"/);
    expect(languages).toMatch(/never change which lessons learners get/);
  });

  it("explains references & bibliography: per course, APA 7, live on save, English first", () => {
    const references = section("References & bibliography");
    expect(references).toMatch(/APA 7/);
    expect(references).toMatch(/goes live when you save/);
    expect(references).toMatch(/At most 10,000 characters per language/);
  });

  it("says coverage doesn't count documents, further reading or references", () => {
    expect(section("Switching German or Greek on")).toMatch(
      /Coverage doesn't count documents, further reading or references: check them yourself in Preview as learner\./
    );
  });
});
