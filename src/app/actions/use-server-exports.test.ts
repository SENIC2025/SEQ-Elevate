import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// A "use server" module, anywhere in src/, exports only its actions, each
// declared exported where it is defined (`export async function`, `export
// const … = async`, `export default async function`): no export list
// (`export { X }`, `export { X as Y }`, `export type { X }`), no `export *`,
// and no `export default <value>` or `export =`.
//
// Two reasons. Next's action transform reads an export list as values, so
// re-exporting even a type breaks every action of the module at runtime
// with "X is not defined" — which the unit tests, whose transform strips
// types first, never see; types are imported from their own module. And
// the scope guard (scope-guard.test.ts, SS4) finds a server action by its
// export where it is declared: an action exported by a list or under
// another name would be one it can't see (polish2-verify V2). Whatever
// still reached an action as a Scope is refused at run time by the scope
// module (scope-runtime.test.ts).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(`${ROOT}${dir}`).flatMap((name) => {
    const path = `${dir}${name}`;
    if (statSync(`${ROOT}${path}`).isDirectory()) return sourceFiles(`${path}/`);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Does the file start with the "use server" directive (its prologue)? */
function usesServer(sf: ts.SourceFile): boolean {
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
    if (s.expression.text === "use server") return true;
  }
  return false;
}

/**
 * The exports of `source` (a file of src/ at `file`) a "use server" module
 * may not have, as "file:line: what"; none for any other module.
 */
function exportsRefused(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!usesServer(sf)) return [];
  const refused: string[] = [];
  const at = (node: ts.Node, what: string) =>
    refused.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${what}`);
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) at(s, s.exportClause ? "an export list" : "an export *");
    else if (ts.isExportAssignment(s)) at(s, s.isExportEquals ? "an export =" : "an export default of a value");
  }
  return refused;
}

const MODULES = sourceFiles("src/")
  .map((file) => [file, readFileSync(`${ROOT}${file}`, "utf8")] as const)
  .filter(([, source]) => source.includes("use server"));

describe('"use server" modules', () => {
  it("finds them, in src/app/actions and wherever else they are", () => {
    const found = MODULES.filter(([file, source]) =>
      usesServer(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
    ).map(([file]) => file);
    expect(found).toContain("src/app/actions/learner.ts");
    expect(found.length).toBeGreaterThanOrEqual(18);
  });

  it.each(MODULES.map(([file]) => file))("%s has no export list, export * or export default of a value", (file) => {
    const source = MODULES.find(([f]) => f === file)![1];
    expect(exportsRefused(file, source)).toEqual([]);
  });
});

describe('"use server" modules (meta-test): what is refused', () => {
  it("an action exported by a list, or under another name, in a module outside src/app/actions (polish2-verify V2)", () => {
    expect(
      exportsRefused(
        "src/lib/new-actions.ts",
        `"use server";
         import { learnerUsersInScope, type Scope } from "@/lib/scope";
         async function listLearners(cohortId: string, scope: Scope) { return [cohortId, learnerUsersInScope(scope)]; }
         export { listLearners };
         export { listLearners as listAll };`
      )
    ).toEqual(["src/lib/new-actions.ts:4: an export list", "src/lib/new-actions.ts:5: an export list"]);
  });

  it("a type re-exported, export *, export default of a value, export =", () => {
    expect(
      exportsRefused(
        "src/app/actions/new.ts",
        `'use server';
         export type { Scope } from "@/lib/scope";
         export * from "@/lib/other";
         async function act() { return null; }
         export default act;`
      )
    ).toEqual([
      "src/app/actions/new.ts:2: an export list",
      "src/app/actions/new.ts:3: an export *",
      "src/app/actions/new.ts:5: an export default of a value",
    ]);
    expect(exportsRefused("src/lib/x.ts", `"use server";\nconst a = async () => 1;\nexport = a;`)).toEqual([
      "src/lib/x.ts:3: an export =",
    ]);
  });

  it("and passes actions declared exported, and any module that isn't one", () => {
    expect(
      exportsRefused(
        "src/lib/fine.ts",
        `"use server";
         export async function a() { return 1; }
         export const b = async () => 2;
         export default async function c() { return 3; }
         export type Answer = { ok: boolean };`
      )
    ).toEqual([]);
    expect(exportsRefused("src/lib/plain.ts", `const x = 1;\nexport { x };\n// "use server" in a comment`)).toEqual([]);
    expect(exportsRefused("src/lib/later.ts", `const x = 1;\n"use server";\nexport { x };`)).toEqual([]);
  });
});
