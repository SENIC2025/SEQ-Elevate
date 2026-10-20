import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Release 1's save of a course's whole progress (saveCourseProgress) stays
// for pages loaded before the Release 2 deploy (D62.e, D68). This build
// never calls it, but Next builds only the server actions client code
// refers to: one nothing refers to answers "not found", and every save of
// those pages would fail. The learner store refers to it, and must go on
// doing so until it is removed after the pilot, by its own decision.

const source = readFileSync(fileURLToPath(new URL("./demo-state.tsx", import.meta.url)), "utf8");

describe("Release 1's save action", () => {
  it("is still referred to by the learner store", () => {
    expect(source).toMatch(/import \{[^}]*\bsaveCourseProgress,[^}]*\} from "@\/app\/actions\/learner"/);
    expect(source).toMatch(/^void saveCourseProgress;$/m);
  });
});
