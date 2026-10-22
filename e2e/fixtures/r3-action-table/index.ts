import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { rows as foundation } from "./foundation";
import { rows as a } from "./a";
import { rows as b } from "./b";
import { rows as d } from "./d";
import { rows as e } from "./e";
import { rows as f } from "./f";
import { rows as r4r } from "./r4r";
import { rowKey, type Row } from "./kit";

/**
 * Release 3 (spec 18.3): the action table, every stream's rows together,
 * and what it must cover: every export of every "use server" file under
 * src/ (read from the sources with the TypeScript compiler, so an action
 * no page imports yet is listed too).
 */

export * from "./kit";

export type Stream = "foundation" | "a" | "b" | "d" | "e" | "f" | "r4r";

/** Every row, with the stream whose file holds it. */
export const TABLE: readonly (Row & { stream: Stream })[] = (
  [
    ["foundation", foundation],
    ["a", a],
    ["b", b],
    ["d", d],
    ["e", e],
    ["f", f],
    // Release 4's references (spec 10.5): their actions are in the sources,
    // so the table covers them now.
    ["r4r", r4r],
  ] as const
).flatMap(([stream, rows]) => rows.map((row) => ({ ...row, stream })));

/** The repository root. */
export const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Does the file start with the "use server" directive? */
function isUseServer(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Every export of every "use server" file under src/, as (file from the root, name). */
export function useServerExports(root = ROOT): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const full of sourceFiles(path.join(root, "src"))) {
    const text = readFileSync(full, "utf8");
    if (!text.includes("use server")) continue;
    const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    if (!isUseServer(source)) continue;
    const file = path.relative(root, full).split(path.sep).join("/");
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name) {
        out.push({ file, name: statement.name.text });
      } else if (ts.isVariableStatement(statement) && exported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) out.push({ file, name: declaration.name.text });
        }
      } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) out.push({ file, name: element.name.text });
      } else if (ts.isExportAssignment(statement)) {
        out.push({ file, name: "default" });
      }
    }
  }
  return out.sort((x, y) => `${x.file}#${x.name}`.localeCompare(`${y.file}#${y.name}`));
}

/** What the table lacks or holds twice, measured against the sources (and, given, the build). */
export function coverage(
  exports: readonly { file: string; name: string }[],
  built: readonly { file: string; name: string }[] = []
) {
  const keys = TABLE.map(rowKey);
  const known = new Set(keys);
  const wanted = new Set([...exports, ...built].map((x) => `${x.file}#${x.name}`));
  const sourced = new Set(exports.map((x) => `${x.file}#${x.name}`));
  return {
    /** Exports (or built actions) with no row. */
    missing: [...wanted].filter((k) => !known.has(k)).sort(),
    /** Action rows naming no export of the sources. */
    stale: TABLE.filter((r) => r.kind !== "route" && !sourced.has(rowKey(r))).map(rowKey),
    /** Rows listed more than once. */
    twice: keys.filter((k, i) => keys.indexOf(k) !== i),
  };
}
