import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogRow, ReviewKey, ReviewPerson } from "@/lib/account-data";

/*
 * /admin/data as first rendered (spec 14): what each control says and how it
 * is named, before anyone acts.
 * - Find stays a working button (busy only through aria-disabled, so focus
 *   never falls off it) and the field says it needs at least 3 characters.
 * - The review lists' mark buttons are named starting with their visible
 *   words (WCAG 2.5.3), the person's address after them.
 * - The staff list says that statistics already leave staff out, so only
 *   tests are marked: the run erases every marked account with its roles.
 * - The log reads in words and in Brussels time: the action's label, its
 *   code as secondary text, and the row's local time.
 */

// The actions run on the server; these tests only render.
vi.mock("@/app/actions/admin-data", () => ({
  eraseAccountByAdmin: vi.fn(),
  findPeople: vi.fn(),
  markTestAccount: vi.fn(),
  previewCleanup: vi.fn(),
  readDataTools: vi.fn(),
  resetTestAccount: vi.fn(),
  runCleanup: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { DataTools } = await import("./DataTools");

const none: Record<ReviewKey, ReviewPerson[]> = {
  "no-profile": [],
  showcase: [],
  "before-stats": [],
  "staff-with-data": [],
  "member-targets": [],
  "partner-never-signed-in": [],
  "country-mismatch": [],
};

function render(review: Partial<Record<ReviewKey, ReviewPerson[]>> = {}, log: LogRow[] = []) {
  return renderToStaticMarkup(createElement(DataTools, { review: { ...none, ...review }, log, statsFrom: "2026-12-01" }));
}

/** The opening tag of every element whose text is `text`. */
const tagsOf = (html: string, text: string) =>
  [...html.matchAll(new RegExp(`<(button|th|td)([^>]*)>(?:(?!</\\1>).)*?${text}`, "g"))].map((m) => m[2]);

describe("Find", () => {
  it("is never natively disabled, so focus stays on it", () => {
    const [find] = tagsOf(render(), "Find</button>");
    expect(find).toBeDefined();
    expect(find).not.toMatch(/\sdisabled=/);
  });

  it("says that it needs at least 3 characters, as the field's description", () => {
    const html = render();
    const input = html.match(/<input type="search"[^>]*>/)?.[0] ?? "";
    const hint = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(hint).toBeDefined();
    expect(html).toMatch(new RegExp(`id="${hint}"[^>]*>At least 3 characters\\.<`));
  });
});

describe("the review lists", () => {
  const fac = { id: "u1", email: "fac@example.org", testAccount: false };

  it("name each mark button by its visible words first", () => {
    const html = render({ "staff-with-data": [fac] });
    const button = html.match(/<button[^>]*aria-label="([^"]*)"[^>]*>Mark as test account<\/button>/);
    expect(button?.[1]).toBe("Mark as test account: fac@example.org");
  });

  it("say on the staff list that statistics already leave staff out and the run erases marked accounts", () => {
    const html = render({ "staff-with-data": [fac] });
    expect(html).toContain("Statistics already leave staff out");
    expect(html).toMatch(/clean-up run erases every marked account, with its roles/);
  });
});

describe("the log", () => {
  const row: LogRow = {
    id: "l1",
    at: "2026-11-30T08:15:00.000Z",
    when: "2026-11-30 09:15",
    action: "account.test_marked",
    who: "admin@example.org",
    details: "",
  };

  it("shows the time in Brussels, and says so", () => {
    const html = render({}, [row]);
    expect(html).toMatch(/<th[^>]*>When \(Brussels time\)<\/th>/);
    expect(html).toContain(">2026-11-30 09:15<");
    expect(html).not.toContain("08:15");
  });

  it("names the action in words, with its code as secondary text", () => {
    const html = render({}, [row, { ...row, id: "l2", action: "something.new" }]);
    expect(html).toMatch(/<td[^>]*>Marked as a test account<span[^>]*>account\.test_marked<\/span><\/td>/);
    // An action without a label shows its code.
    expect(html).toMatch(/<td[^>]*>something\.new<\/td>/);
  });

  it("names in words every action Manage people writes that the log shows", () => {
    // What the log shows (account-data.ts, LOGGED): every data., account.
    // and person. action, and two of Manage people's member. actions.
    const shown = (action: string) =>
      /^(data|account|person)\./.test(action) ||
      ["profile.organisation_released", "member.add_refused", "member.guardian_consent_recorded"].includes(action);
    const source = readFileSync(join(process.cwd(), "src/app/actions/admin.ts"), "utf8");
    const written = [...new Set([...source.matchAll(/audit\(\s*\w+,\s*[\w.]+,\s*"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]))];
    const logged = written.filter(shown);
    // The extraction finds what it should (one known action of each kind).
    expect(logged).toEqual(expect.arrayContaining(["person.country_changed", "member.add_refused"]));
    const html = render(
      {},
      logged.map((action, i) => ({ ...row, id: `m${i}`, action }))
    );
    for (const action of logged) {
      expect(html, action).toMatch(new RegExp(`<td[^>]*>[^<]+<span[^>]*>${action.replace(".", "\\.")}</span></td>`));
    }
  });
});
