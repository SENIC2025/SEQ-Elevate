import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Scope, ScopeShape } from "./scope";

/*
 * Release 3 hardening (SS4): a Scope is made only by the scope module. Its
 * type is branded, so a hand-made literal doesn't type-check anywhere else:
 * not as a Scope, not passed where a builder asks for one. Two checks:
 *
 *   - the lines below: the repository's type check (tsc --noEmit) fails if
 *     any of them compiles, since each @ts-expect-error then expects an
 *     error that isn't there;
 *   - the test: it compiles a file of code the way tsc does (this project's
 *     tsconfig.json), and finds the literal refused and the module's own
 *     builders and test-only factory accepted.
 *
 * Nor does a copy of a real scope with its fields changed (a spread copies
 * no private field, and the brand is one), nor a change of a real scope in
 * place (its fields are read-only; at run time it is frozen). What would
 * get round the type check (the test-only factory, an assertion, an any)
 * in src/ outside tests fails the scope guard (scope-guard.test.ts).
 */

// @ts-expect-error a hand-made project scope isn't a Scope (SS4)
const forgedProject: Scope = { kind: "project", viewerId: "x", viewerOrganisationId: null };
// @ts-expect-error nor is an organisation's
const forgedOrganisation: Scope = { kind: "organisation", viewerId: "x", organisationId: "org-a" };
// @ts-expect-error nor "none"
const forgedNone: Scope = { kind: "none" };
const shape: ScopeShape = { kind: "none" };
// @ts-expect-error nor a value of the scope's shape
const fromShape: Scope = shape;
void forgedProject;
void forgedOrganisation;
void forgedNone;
void fromShape;
/** Never called: what the type check refuses about a real scope. */
function fromAReal(real: Scope) {
  // @ts-expect-error nor a copy of a real scope with its fields changed (a spread doesn't copy the brand)
  const respread: Scope = { ...real, kind: "project", viewerId: "x", viewerOrganisationId: null };
  // @ts-expect-error nor a real scope changed in place (its fields are read-only)
  if (real.kind === "organisation") real.organisationId = "org-b";
  return respread;
}
void fromAReal;

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The checked file, as if it were in src/app/actions (it is never written to disk). */
const CHECKED = `${ROOT}src/app/actions/scope-brand-check.ts`;

/** The errors tsc reports in `source`, as "line: code", compiled with this project's options. */
function typeErrors(source: string): string[] {
  const config = ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const compilerOptions: ts.CompilerOptions = { ...options, incremental: false, noEmit: true, plugins: [] };
  const host = ts.createCompilerHost(compilerOptions, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === CHECKED
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === CHECKED || fileExists(fileName);
  const program = ts.createProgram({ rootNames: [CHECKED], options: compilerOptions, host });
  const file = program.getSourceFile(CHECKED)!;
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map(
    (d) => `${file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: TS${d.code}`
  );
}

describe("a Scope is made only by the scope module (SS4, tsc)", { timeout: 120_000 }, () => {
  it("refuses a hand-made literal, as a value and as an argument; accepts what the module makes", () => {
    const errors = typeErrors(
      [
        `import { getViewerScope, learnerUsersInScope, scopeFor, testOnlyScope, type Scope } from "@/lib/scope";`,
        `export const forged: Scope = { kind: "project", viewerId: "x", viewerOrganisationId: null };`,
        `export const filter = learnerUsersInScope({ kind: "organisation", viewerId: "x", organisationId: "org-a" });`,
        `export const built: Scope = scopeFor({ userId: "u", name: "N", roles: ["ADMIN"], profile: null }, {});`,
        `export const forTests: Scope = testOnlyScope({ kind: "none" });`,
        `export async function mine(): Promise<Scope> { return getViewerScope(); }`,
      ].join("\n")
    );
    // Line 2 (the literal) and line 3 (the literal as an argument), and nothing else.
    expect(errors).toEqual(["2: TS2322", "3: TS2345"]);
  });

  it("refuses a copy of a real scope with its fields changed, and a real scope changed in place", () => {
    const errors = typeErrors(
      [
        `import { getViewerScope, learnerUsersInScope, type Scope } from "@/lib/scope";`,
        `export async function f() {`,
        `  const real = await getViewerScope();`,
        `  const forged: Scope = { ...real, kind: "project", viewerId: "x", viewerOrganisationId: null };`,
        `  if (real.kind === "organisation") real.organisationId = "org-b";`,
        `  const copied = learnerUsersInScope({ ...real });`,
        `  return [forged, copied, learnerUsersInScope(real)];`,
        `}`,
      ].join("\n")
    );
    // The spread copy (4), the change in place (5), the copy as an argument (6); the real scope (7) is fine.
    expect(errors).toEqual(["4: TS2322", "5: TS2540", "6: TS2345"]);
  });
});
