import { describe, it, expect } from "vitest";
import { decodeActionResponse } from "../server-action";
import { THROWN, answers, matches } from "./kit";

/**
 * Release 3 (spec 18.3): what counts as a refusal in the action table. A
 * row that expects the action to throw is met only by the action's own
 * thrown error (Next answers it with status 500 and an RSC payload whose
 * result row is an `E` row); a response that holds no action result at all
 * (the page doesn't serve that action: Next's 404 "Server action not
 * found.", an HTML error page, an empty body) is not a refusal: the action
 * never ran.
 */

const RSC = "text/x-component";
/** A response as callAction reads it. */
const response = (status: number, contentType: string, raw: string) => ({
  status,
  contentType,
  raw,
  ...decodeActionResponse(raw),
});

describe("matches", () => {
  it("takes the action's own thrown error as a throw", () => {
    const thrown = response(500, RSC, '0:{"a":"$@1","f":"","b":"x"}\n1:E{"digest":"123"}\n');
    expect(matches(thrown, THROWN).ok).toBe(true);
    expect(matches(thrown, answers(null)).ok).toBe(false);
  });

  it("doesn't take a response without the action's result as a throw", () => {
    for (const r of [
      response(404, "text/plain; charset=utf-8", "Server action not found."),
      response(500, "text/html; charset=utf-8", "<!DOCTYPE html><html><body>Internal Server Error</body></html>"),
      response(200, RSC, ""),
      response(200, RSC, '0:{"f":"","b":"x"}\n'),
    ]) {
      expect(matches(r, THROWN).ok, `${r.status} ${r.raw.slice(0, 30)}`).toBe(false);
      expect(matches(r, THROWN).got, r.raw.slice(0, 30)).toMatch(/no action result/);
    }
  });

  it("takes a returned answer only as that answer", () => {
    const refused = response(200, RSC, '0:{"a":"$@1","f":"","b":"x"}\n1:{"ok":false}\n');
    expect(matches(refused, answers({ ok: false })).ok).toBe(true);
    expect(matches(refused, THROWN).ok).toBe(false);
    expect(matches(response(200, RSC, '0:{"a":"$@1","f":"","b":"x"}\n1:null\n'), answers(null)).ok).toBe(true);
  });
});
