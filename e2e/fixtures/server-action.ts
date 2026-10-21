import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test, type APIRequestContext } from "@playwright/test";

/**
 * Release 3 (spec 18.3): call a server action directly, as any person, with
 * any arguments, the way a hand-made request would, so a test of who may
 * read or change what never depends on what a screen offers.
 *
 * A server action is a POST to a page with the header `Next-Action: <id>`
 * and the arguments as a JSON array in the body. The id is a hash that each
 * build makes anew, so it is looked up in the build's server-reference
 * manifest (`.next/server/server-reference-manifest.json`), which names, for
 * every id, the file the action is exported from and its exported name. The
 * e2e servers run `pnpm start` on a production build, so the manifest is the
 * one the server answers with.
 *
 * The build is the worktree's own `.next`, or E2E_NEXT_DIR when the specs run
 * against a server built elsewhere (the old build of a red-on-old run).
 */

/** The `.next` folder of the build the e2e server runs. */
export const NEXT_DIR = process.env.E2E_NEXT_DIR ?? path.resolve(__dirname, "../../.next");

interface ManifestWorker {
  moduleId?: unknown;
  exportedName?: string;
  filename?: string;
}
interface ManifestEntry {
  workers: Record<string, ManifestWorker>;
  /** Older builds name the export here instead of per worker. */
  exportedName?: string;
  filename?: string;
}
interface Manifest {
  node: Record<string, ManifestEntry>;
}

let cached: { mtimeMs: number; manifest: Manifest } | null = null;

function manifest(): Manifest {
  const file = path.join(NEXT_DIR, "server", "server-reference-manifest.json");
  const { mtimeMs } = statSync(file);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, manifest: JSON.parse(readFileSync(file, "utf8")) as Manifest };
  }
  return cached.manifest;
}

/** Every (file, exported name) the manifest gives an id for, with that id. */
function namedActions(): { id: string; file: string; name: string; workers: string[] }[] {
  const out: { id: string; file: string; name: string; workers: string[] }[] = [];
  for (const [id, entry] of Object.entries(manifest().node ?? {})) {
    const workers = Object.values(entry.workers ?? {});
    const file = entry.filename ?? workers.find((w) => w.filename)?.filename;
    const name = entry.exportedName ?? workers.find((w) => w.exportedName)?.exportedName;
    if (file && name) out.push({ id, file, name, workers: Object.keys(entry.workers ?? {}) });
  }
  return out;
}

/**
 * The action id of the export `name` of `file` (a path from the repository
 * root, such as "src/app/actions/facilitator.ts"). Throws when the build has
 * none: a misspelt name, an action no page imports (it isn't built), or a
 * stale build.
 */
export function actionId(file: string, name: string): string {
  const hits = namedActions().filter((a) => a.file === file && a.name === name);
  if (hits.length !== 1) {
    throw new Error(
      `server-action: ${hits.length} ids for ${file}#${name} in ${NEXT_DIR} (expected 1). ` +
        `Is the build current, and does a page import the action?`
    );
  }
  return hits[0].id;
}

/** Every (file, exported name) the build has an action id for. */
export function builtActions(): { file: string; name: string }[] {
  const seen = new Map<string, { file: string; name: string }>();
  for (const { file, name } of namedActions()) seen.set(`${file}#${name}`, { file, name });
  return [...seen.values()];
}

/** The exported names of `file` that the build has an action id for. */
export function builtActionsOf(file: string): string[] {
  return [...new Set(namedActions().filter((a) => a.file === file).map((a) => a.name))].sort();
}

/** Someone signed in by a database session (the Auth.js cookie's value). */
export interface ActionCaller {
  sessionToken: string;
}

export interface ActionCall {
  /** Who calls; null for a request with no session. */
  as: ActionCaller | null;
  /** The page posted to, such as "/en/facilitator". */
  page: string;
  /** The file that exports the action, from the repository root. */
  file: string;
  /** Its exported name. */
  name: string;
  /** The arguments, as the action receives them. */
  args: unknown[];
}

export interface ActionAnswer {
  /** The HTTP status of the response. */
  status: number;
  /**
   * What the action returned (undefined for a void action). When the action
   * threw, `error` is set instead: production builds send only a digest.
   */
  result: unknown;
  error?: string;
  /** Where the action redirected to, when it called redirect(). */
  redirect?: string;
  /** The response body, for a failure message. */
  raw: string;
}

/**
 * The origin of the server the running test's project uses (each project
 * has its own: the cut-off and switches servers run on their own ports),
 * else the main e2e server's, as playwright.config.ts builds it.
 */
const origin = () => {
  try {
    const base = test.info().project.use.baseURL;
    if (base) return new URL(base).origin;
  } catch {
    // Not inside a test: the main server.
  }
  return `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
};

/**
 * Calls the action as `as` and answers what it returned. The request carries
 * only that person's session cookie (none for `as: null`), whatever cookies
 * `request` holds, and the server's own Origin, as a browser on the site
 * would send.
 */
export async function callAction(request: APIRequestContext, call: ActionCall): Promise<ActionAnswer> {
  const id = actionId(call.file, call.name);
  const url = new URL(call.page, origin());
  const response = await request.post(url.toString(), {
    headers: {
      "Next-Action": id,
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: url.origin,
      Cookie: call.as ? `authjs.session-token=${call.as.sessionToken}` : "",
    },
    data: JSON.stringify(call.args),
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const raw = await response.text();
  const headers = response.headers();
  const redirect = headers["x-action-redirect"]?.split(";")[0];
  const decoded = decodeActionResponse(raw);
  return { status: response.status(), raw, redirect, ...decoded };
}

/**
 * The action's result in a React Server Components response. The body is a
 * list of rows, `<hex id>:<value>`, one per line (a text row, `T<hex
 * length>,<text>`, carries its length instead of a line end). Row 0 holds
 * `{ a: "$@<id>" }`, a reference to the row holding the result. A row
 * `E{…}` is an error the action threw. Values are JSON, with strings
 * starting "$" as references and markers; only what plain results use is
 * read here: "$@id"/"$id" references, "$undefined", dates ("$D…"), big
 * numbers ("$n…") and "$$" for a literal "$".
 */
export function decodeActionResponse(raw: string): { result: unknown; error?: string } {
  // Read as bytes: a text row's length counts UTF-8 bytes, not characters.
  const bytes = Buffer.from(raw, "utf8");
  const rows = new Map<string, string>();
  let at = 0;
  while (at < bytes.length) {
    const colon = bytes.indexOf(":", at);
    if (colon < 0) break;
    const rowId = bytes.subarray(at, colon).toString();
    if (bytes[colon + 1] === "T".charCodeAt(0)) {
      const comma = bytes.indexOf(",", colon);
      const length = parseInt(bytes.subarray(colon + 2, comma).toString(), 16);
      rows.set(rowId, JSON.stringify(bytes.subarray(comma + 1, comma + 1 + length).toString()));
      at = comma + 1 + length;
      continue;
    }
    const end = bytes.indexOf("\n", colon);
    rows.set(rowId, bytes.subarray(colon + 1, end < 0 ? bytes.length : end).toString());
    at = end < 0 ? bytes.length : end + 1;
  }

  const seen = new Set<string>();
  const resolveRow = (rowId: string): unknown => {
    const text = rows.get(rowId);
    if (text === undefined) throw new Error(`server-action: no row ${rowId} in the response`);
    if (text.startsWith("E")) throw Object.assign(new Error("thrown"), { row: text.slice(1) });
    if (seen.has(rowId)) throw new Error(`server-action: row ${rowId} refers to itself`);
    seen.add(rowId);
    const value = revive(JSON.parse(text));
    seen.delete(rowId);
    return value;
  };
  const revive = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("$")) {
      if (value === "$undefined") return undefined;
      if (value.startsWith("$$")) return value.slice(1);
      if (value.startsWith("$D")) return value.slice(2);
      if (value.startsWith("$n")) return BigInt(value.slice(2));
      if (value.startsWith("$@")) return resolveRow(value.slice(2));
      if (/^\$[0-9a-f]+$/.test(value)) return resolveRow(value.slice(1));
      throw new Error(`server-action: can't read the marker ${value.slice(0, 3)}…`);
    }
    if (Array.isArray(value)) return value.map(revive);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
    }
    return value;
  };

  try {
    const head = JSON.parse(rows.get("0") ?? "null") as { a?: unknown } | null;
    if (!head || !("a" in head)) return { result: undefined, error: "no action result in the response" };
    return { result: revive(head.a) };
  } catch (e) {
    const row = (e as { row?: string }).row;
    if (row !== undefined) {
      const parsed = JSON.parse(row) as { digest?: string; message?: string };
      return { result: undefined, error: parsed.digest ?? parsed.message ?? "error" };
    }
    throw e;
  }
}
