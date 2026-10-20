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
 *
 * The Release 2 baseline (walk phase 3) is added here once it is recorded.
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
};

describe("the learner recordings are pinned", () => {
  it.each(Object.entries(PINNED))("%s is unchanged", (file, hash) => {
    expect(sha256(file)).toBe(hash);
  });
});
