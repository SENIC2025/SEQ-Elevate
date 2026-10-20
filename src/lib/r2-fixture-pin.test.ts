import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The learner recordings the end-to-end walks compare with (spec 10.3).
 * Release 1 froze the whole learner path by its file hashes (D60); Release 2
 * changes that path on purpose (D63), so only the recordings stay pinned: a
 * walk that passes against an edited recording proves nothing.
 *
 *   r1-learner-baseline.json  recorded on the Release 0 build; it can't be
 *                             recorded again on a later one. Walk phase 1
 *                             compares with it, plus the closed list of
 *                             differences (e2e/fixtures/r2-deltas.ts).
 *   r2-learner-baseline.json  Release 2's own: what a learner sees of the
 *                             A-E1 course (e2e/fixtures/r2-ae1-course.ts),
 *                             step by step in English and German, recorded
 *                             once at integration (walk phase 3,
 *                             R2_WALK_RECORD=1). The editor's preview of the
 *                             same course is held to it too.
 *
 * A failure means a recording changed. Put it back; a recording is never
 * edited by hand.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = (file: string) =>
  createHash("sha256").update(readFileSync(`${root}${file}`)).digest("hex");

const PINNED: Record<string, string> = {
  "e2e/fixtures/r1-learner-baseline.json":
    "de2330466e49e0939e75512202b5f8350b0781a7959bec8868150fd25321176e",
  "e2e/fixtures/r2-learner-baseline.json":
    "0620f06912b59c36b6b5be989977dda6e2a4efd367468517c09aeba74c7a8e31",
};

describe("the learner recordings are pinned", () => {
  it.each(Object.entries(PINNED))("%s is unchanged", (file, hash) => {
    expect(sha256(file)).toBe(hash);
  });
});
