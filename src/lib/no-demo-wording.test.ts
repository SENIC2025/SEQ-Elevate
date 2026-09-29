import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guard: SEQ Elevate is a live platform, so no copy may call it a demo,
 * mention Strapi, or say "in production this…". Scans every translated
 * string, and every string literal / JSX text in the app's .tsx files
 * (comments are ignored). "demonstrated" and identifiers such as
 * useDemoState don't match — only the standalone word "demo".
 */

const FORBIDDEN = /\bdemo\b|strapi|in production this/i;

const SRC = path.join(process.cwd(), "src");

// Paths (relative to src/, prefix match) whose matching copy never renders on
// seq-elevate.eu. Keep this list tiny: reword copy instead of adding to it.
const ALLOWED: Record<string, string> = {
  "app/[locale]/dev/": "developer pages; the layout 404s them on the live site",
  "components/dev/": "component gallery used only by the developer pages",
};

function isAllowed(rel: string) {
  return Object.keys(ALLOWED).some((prefix) => rel.startsWith(prefix));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every string in a messages file, as [dotted key, value] pairs. */
function messageStrings(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) =>
      messageStrings(v, prefix ? `${prefix}.${k}` : k)
    );
  }
  return [];
}

// A string literal, or a comment. Strings are matched first so a "//" inside
// a URL is never mistaken for a comment.
const STRING_OR_COMMENT =
  /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

// Module specifiers, routes and storage keys ("@/store/demo-state", "/demo",
// "seq-elevate-demo-state-v1") are identifiers, not copy.
const IDENTIFIER_LIKE = /^(["'`])[\w@./:-]*[/.@-][\w@./:-]*\1$/;

/** The source with comments removed and identifier-like strings blanked. */
function visibleSource(source: string): string {
  return source.replace(STRING_OR_COMMENT, (match, str: string | undefined) =>
    str === undefined ? " " : IDENTIFIER_LIKE.test(str) ? '""' : str
  );
}

describe("visibleSource", () => {
  it("drops comments but keeps copy", () => {
    const src = `// demo\n/* strapi */\n{/* demo */}\n<p>Welcome</p>`;
    expect(FORBIDDEN.test(visibleSource(src))).toBe(false);
    expect(visibleSource(`<p>A working demo</p>`)).toMatch(FORBIDDEN);
    expect(visibleSource(`label="Strapi CMS"`)).toMatch(FORBIDDEN);
  });

  it("ignores module paths, routes and identifiers", () => {
    const src = [
      `import { useDemoState } from "@/store/demo-state";`,
      `<Link href="/demo">x</Link>`,
      `localStorage.removeItem("seq-elevate-demo-state-v1");`,
      `if (process.env.DEMO_LOGIN_DISABLED === "true") demoSignIn();`,
    ].join("\n");
    expect(FORBIDDEN.test(visibleSource(src))).toBe(false);
  });

  it("does not treat a URL inside a string as a comment", () => {
    expect(visibleSource(`const a = "see https://x.eu — a demo";`)).toMatch(
      FORBIDDEN
    );
  });
});

describe("no demo wording", () => {
  it("in any translated string", () => {
    const dir = path.join(SRC, "messages");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) =>
        messageStrings(JSON.parse(readFileSync(path.join(dir, f), "utf8")))
          .filter(([, value]) => FORBIDDEN.test(value))
          .map(([key, value]) => `${f} ${key}: ${value}`)
      );
    expect(offenders).toEqual([]);
  });

  it("in any page or component", () => {
    const offenders = [
      ...walk(path.join(SRC, "app")),
      ...walk(path.join(SRC, "components")),
    ]
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => !isAllowed(rel))
      .flatMap((rel) =>
        visibleSource(readFileSync(path.join(SRC, rel), "utf8"))
          .split("\n")
          .filter((line) => FORBIDDEN.test(line))
          .map((line) => `${rel}: ${line.trim()}`)
      );
    expect(offenders).toEqual([]);
  });

  it("allow-list entries still exist (no stale exemptions)", () => {
    const files = walk(SRC).map((f) =>
      path.relative(SRC, f).split(path.sep).join("/")
    );
    for (const prefix of Object.keys(ALLOWED)) {
      expect(
        files.some((f) => f.startsWith(prefix)),
        `${prefix} is allow-listed but no longer exists`
      ).toBe(true);
    }
  });
});
