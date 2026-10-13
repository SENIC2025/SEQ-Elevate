import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Release 1 freezes the learner path (D56–D60): learners of every course get
 * exactly the Release 0 reader and player, whatever editors build with the
 * flexible editor. The safest way to keep that promise is not to touch the
 * code at all, so this test pins each file to the bytes it had when Release 1
 * started (recorded at the Foundation's first commit, on Release 0's code).
 *
 * A failure here means a learner-facing file changed. Undo the change; the
 * editor's new layout belongs in the sectioned preview (src/components/course/
 * sectioned/) until Release 2.
 *
 * Remove this test in Release 2, when learners move to the new layout.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const FROZEN: Record<string, string> = {
  // The player and every step it shows.
  "src/components/course/CoursePlayer.tsx":
    "395438ceaccf0ce0d11e6069c82783540258c154c0917623f739b05a259bae63",
  "src/components/course/NarrativeStage.tsx":
    "ace9a1ea09326e0d0a27cf8b5a60d724b1ba9644502b89f2673d948974a0be10",
  "src/components/course/SimulationStage.tsx":
    "ab22669d0ceacb14341d6995c5912d73bc6cd6da0863625feb2a9e17579b95d1",
  "src/components/course/ScenarioStage.tsx":
    "2d9d45e2cabfaa5d3db7a25f5be7caee1be6621c81b14927cfd74586c242f231",
  "src/components/course/AssessmentStage.tsx":
    "936b33d3dc740622d4aabb5b11a16b807e9b4813f978257d680b77c58c45b770",
  "src/components/course/ReflectionStage.tsx":
    "ff858e465828a5036457054a4079275463dde4107a7efbd7e05bf314fc5ab3f3",
  "src/components/course/CompletionStage.tsx":
    "183bbc638aaccc890ed13bb183c921a14f875b3fae592817ce56b81cc2b83f66",
  // What the player reads (getCourse) and how progress is counted.
  "src/lib/cms/index.ts":
    "3975ef607e732967d74bece4c35c7911adc27bbd1be6d43538e3d061cc9a0483",
  "src/lib/course-progress.ts":
    "01514d92e60b7f5cda1744a742db077b5c432231e0d925eb12b30f9e17331019",
  "src/lib/cms/local-provider.ts":
    "63d0d1ce62764fa48613e1f4c192f345a50fd8a2ba8fc8f7831cbbd7e812a488",
  // Where a learner's answers and progress are kept and saved.
  "src/store/demo-state.tsx":
    "a84870cd85b74320a5e421f24a4299a0f5f301e46937c326d735e7c63870c860",
  "src/app/actions/learner.ts":
    "a774e3544f034eec2915984ad65c7ec3331c9fb2a8a7a0266cd5df102800f34d",
  // The learner baseline the end-to-end walk compares with. It was recorded
  // on the Release 0 build, so it can't be re-recorded on Release 1.
  "e2e/fixtures/r1-learner-baseline.json":
    "de2330466e49e0939e75512202b5f8350b0781a7959bec8868150fd25321176e",
};

/**
 * getDbCourse (db-course.ts) is the reader of every course created here. Its
 * only allowed change is one appended export, so the platform's default
 * reflection prompts can be shared without copying them (spec §9.3): the
 * Release 0 bytes must stay as they are, followed by nothing but comments and
 * that line.
 */
const DB_COURSE = {
  file: "src/lib/cms/db-course.ts",
  bytes: 11272,
  sha256: "84f7bd8f60a8146c9cd3748a4d7c5acaafcace3f201a955ab82e6c07bb623e61",
  allowedTail:
    /^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*(export \{ DEFAULTS as CMS_STAGE_DEFAULTS \};\s*)?$/,
};

describe("the learner path is frozen in Release 1", () => {
  it.each(Object.entries(FROZEN))("%s is unchanged", (file, hash) => {
    expect(sha256(read(file))).toBe(hash);
  });

  it("db-course.ts keeps its Release 0 code, plus at most the defaults export", () => {
    const bytes = read(DB_COURSE.file);
    expect(bytes.length).toBeGreaterThanOrEqual(DB_COURSE.bytes);
    expect(sha256(bytes.subarray(0, DB_COURSE.bytes))).toBe(DB_COURSE.sha256);
    const tail = bytes.subarray(DB_COURSE.bytes).toString("utf8");
    expect(tail).toMatch(DB_COURSE.allowedTail);
  });

  it("allows only the defaults export after db-course.ts's Release 0 code", () => {
    const ok = (tail: string) => DB_COURSE.allowedTail.test(tail);
    expect(ok("")).toBe(true);
    expect(ok("\nexport { DEFAULTS as CMS_STAGE_DEFAULTS };\n")).toBe(true);
    expect(
      ok("\n// Shared with the editor's defaults.\nexport { DEFAULTS as CMS_STAGE_DEFAULTS };\n")
    ).toBe(true);
    expect(ok("\nexport function other() {}\n")).toBe(false);
    expect(ok("\nexport { DEFAULTS as CMS_STAGE_DEFAULTS };\nconst x = 1;\n")).toBe(false);
  });
});
