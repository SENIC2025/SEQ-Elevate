import { readFileSync } from "node:fs";
import path from "node:path";
import type { Captured } from "./r2-deltas";

/**
 * Release 3 (spec 18.4): the closed list of differences Release 3 makes to
 * what a learner sees on the walked courses. The recorded walk
 * (e2e/r2-learner-walk.spec.ts) compares phases 1–2 with
 * applyR3Deltas(applyR2Deltas(Release 0's recording)) and phase 3 with
 * applyR3Deltas(Release 2's recording); any other difference fails.
 *
 *   R3-D1  A reflection gains one line after its intro: the
 *          `safeguarding.hintReflection` paragraph, with its link to the
 *          help page. On a standard reflection step it follows the intro
 *          paragraph under the step's heading; in a reflection of the
 *          lesson's extra content ("Reflection questions"), the part's
 *          heading, or its intro when it has one.
 *
 * Everything else Release 3 adds is outside the page's main area (the
 * safeguarding box, the footer link), absent from the walked courses (the
 * language note and `lang` marks: the fixtures switch German and Greek on;
 * the YouTube gate: the walked videos are files), or needs a state the walk
 * never has (spec 18.4).
 *
 * A difference applies once the change that makes it is in. The hint is
 * placed (Stream E: ReflectionStage, sectioned/ReflectionPart), so R3-D1 is
 * in LIVE: the walk expects Release 2's recording with the hint, and
 * nothing else.
 */

export type R3Delta = "R3-D1";

/** The differences the code in this tree makes. */
export const LIVE: ReadonlySet<R3Delta> = new Set<R3Delta>(["R3-D1"]);

type Locale = "en" | "de";

/** The hint's text before, inside and after its link, in `locale`. */
function hint(locale: Locale): { before: string; link: string; after: string } {
  const file = path.resolve(__dirname, `../../src/messages/${locale}.json`);
  const text = (JSON.parse(readFileSync(file, "utf8")) as { safeguarding: { hintReflection: string } }).safeguarding
    .hintReflection;
  const match = /^(.*?)<help>(.*?)<\/help>(.*)$/.exec(text);
  if (!match) throw new Error(`r3-deltas: safeguarding.hintReflection in ${locale} has no <help> link`);
  return { before: match[1].trim(), link: match[2], after: match[3].trim() };
}

/** The hint as ariaSnapshot prints it, indented as the line it follows. */
function hintLines(indent: string, locale: Locale): string[] {
  const { before, link, after } = hint(locale);
  return [
    `${indent}- paragraph:`,
    ...(before ? [`${indent}  - text: ${before}`] : []),
    `${indent}  - link "${link.replace(/"/g, '\\"')}":`,
    `${indent}    - /url: /${locale}/help`,
    ...(after ? [`${indent}  - text: ${after}`] : []),
  ];
}

const indentOf = (line: string) => line.slice(0, line.search(/\S/));
const REFLECTION_STEP = /-reflection(-|$)/;
const JUST_FOR_YOU = /^\s*- text: (Just for you|Nur für dich)$/;
const REFLECTION_PART = /^\s*- region "(Reflection questions|Reflexionsfragen)":$/;

/** R3-D1 on one snapshot. */
function reflectionHint(key: string, aria: string): string {
  const locale = key.split(":")[1] as Locale;
  const lines = aria.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    // A standard reflection step: "Just for you", its heading, its intro.
    if (
      REFLECTION_STEP.test(key.split(":")[2] ?? "") &&
      JUST_FOR_YOU.test(lines[i]) &&
      /- heading .*\[level=2\]$/.test(lines[i + 1] ?? "") &&
      /- paragraph: /.test(lines[i + 2] ?? "")
    ) {
      out.push(lines[i + 1], lines[i + 2], ...hintLines(indentOf(lines[i]), locale));
      i += 2;
      continue;
    }
    // A reflection part: its heading, and its intro when it has one.
    if (REFLECTION_PART.test(lines[i]) && /- heading .*\[level=3\]$/.test(lines[i + 1] ?? "")) {
      const inner = indentOf(lines[i + 1]);
      const intro = (lines[i + 2] ?? "").startsWith(`${inner}- paragraph: `);
      out.push(...lines.slice(i + 1, i + (intro ? 3 : 2)), ...hintLines(inner, locale));
      i += intro ? 2 : 1;
    }
  }
  return out.join("\n");
}

/** What a learner sees at `key` in Release 3, from what Release 2 showed there. */
export function applyR3Deltas(key: string, captured: Captured, live: ReadonlySet<R3Delta> = LIVE): Captured {
  let aria = captured.aria;
  if (live.has("R3-D1")) aria = reflectionHint(key, aria);
  return { aria, counter: captured.counter };
}
