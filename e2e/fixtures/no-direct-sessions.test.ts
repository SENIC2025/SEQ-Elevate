import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Release 3 (spec 5.8, FD-U19): end-to-end specs make people only through
 * e2e/fixtures/people.ts (createPerson, createSession), which gives them the
 * profile Release 3 expects. A spec that wrote a Session row itself would
 * sign in someone the fixture never made. Fails for any call of
 * `<client>.session.create` (or createMany, upsert) and any raw INSERT
 * into "Session" under e2e/ outside people.ts — specs merged in later
 * included.
 */

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = path.join(E2E, "fixtures", "people.ts");
const WRITES = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

/** Where `source` writes a Session row: "line: text" for each. */
function directSessionWrites(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const at = (node: ts.Node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    return `${line + 1}: ${node.getText(file).split("\n")[0].slice(0, 80)}`;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITES.has(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "session"
    ) {
      hits.push(at(node));
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) &&
      /insert\s+into\s+"?session"?\b/i.test(node.text)
    ) {
      hits.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(full);
    return /\.(c|m)?tsx?$/.test(entry.name) || /\.(c|m)?js$/.test(entry.name) ? [full] : [];
  });
}

describe("e2e specs make people only through the people fixture", () => {
  it("no file under e2e/ but fixtures/people.ts writes a Session row", () => {
    const sites = filesUnder(E2E)
      .filter((f) => f !== ALLOWED && f !== fileURLToPath(import.meta.url))
      .flatMap((f) => directSessionWrites(f, readFileSync(f, "utf8")).map((hit) => `${path.relative(E2E, f)}:${hit}`));
    expect(sites).toEqual([]);
  });

  it("finds the writes it is meant to find (meta-test)", () => {
    const flagged = directSessionWrites(
      "fixture.ts",
      [
        "await prisma.session.create({ data });",
        "await tx.session.createMany({ data: [] });",
        "await db.session.upsert({ where, create, update });",
        "await prisma.$executeRawUnsafe(`INSERT INTO \"Session\" (id) VALUES ($1)`, id);",
        "await prisma.$executeRaw`insert into session values (1)`;",
      ].join("\n")
    );
    expect(flagged.map((h) => h.split(":")[0])).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      directSessionWrites(
        "fixture.ts",
        [
          "await prisma.session.deleteMany({ where });",
          "await prisma.session.findFirst({ where });",
          "await prisma.user.create({ data });",
          "// prisma.session.create in a comment",
          'const label = "a session";',
        ].join("\n")
      )
    ).toEqual([]);
  });
});
