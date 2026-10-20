import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A "use server" module may export only async functions. Next's action
// transform reads an export list (`export { X }`, `export type { X }`) as
// values, so re-exporting even a type breaks every action of the module at
// runtime with "X is not defined" — which the unit tests, whose transform
// strips types first, never see. Types are imported from their own module.

const dir = fileURLToPath(new URL(".", import.meta.url));
const modules = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe('"use server" modules', () => {
  it.each(modules)("%s has no export list", (file) => {
    const source = readFileSync(`${dir}${file}`, "utf8");
    if (!/^["']use server["'];/m.test(source)) return;
    expect(source).not.toMatch(/^export (type )?\{/m);
  });
});
