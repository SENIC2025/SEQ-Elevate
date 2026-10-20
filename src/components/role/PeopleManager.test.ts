import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { AdminMember } from "@/lib/admin-queries";

/*
 * Your own row on the People screen: your Admin role stays on and the bin
 * can't remove you (the server refuses both, setMemberRoles and
 * removeMember). Both controls stay focusable and point to the line that
 * says why; another admin's row is unchanged.
 */

// The actions run on the server; these tests only render.
vi.mock("@/app/actions/admin", () => ({
  addMember: vi.fn(),
  setMemberRoles: vi.fn(),
  assignCohort: vi.fn(),
  removeMember: vi.fn(),
  resendInvitation: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { PeopleManager } = await import("./PeopleManager");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

const member = (id: string, roles: AdminMember["roles"]): AdminMember => ({
  id,
  email: `${id}@example.org`,
  name: null,
  roles,
  cohortId: null,
  cohortName: null,
  orgName: null,
  joinedAt: "2026-10-20",
  status: "joined",
  invitedAt: null,
});

/** The table row of `email`, as markup, with "me" signed in. */
function row(email: string) {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(PeopleManager, {
        members: [member("me", ["ADMIN"]), member("colleague", ["ADMIN", "FACILITATOR"])],
        cohorts: [],
        selfId: "me",
      })
    )
  ).replaceAll("<!-- -->", "");
  return html.split("<tr").find((r) => r.includes(email)) ?? "";
}

/** The button in `markup` whose text or label matches `name`. */
const button = (markup: string, name: RegExp) =>
  markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((b) => name.test(b)) ?? "";

describe("PeopleManager on your own row", () => {
  it("keeps your own Admin role on, and says why", () => {
    const own = row("me@example.org");
    const chip = button(own, />Admin<\/button>/);
    expect(chip).toContain('aria-pressed="true"');
    expect(chip).toContain('aria-disabled="true"');
    const hint = /aria-describedby="([^"]+)"/.exec(chip)?.[1];
    expect(own).toContain(`id="${hint}"`);
    expect(own).toMatch(/can&#x27;t switch off your own Admin\s+role/);
  });

  it("can't remove yourself, and says why", () => {
    const own = row("me@example.org");
    const bin = button(own, /Remove me@example.org from the project/);
    expect(bin).toContain('aria-disabled="true"');
    const hint = /aria-describedby="([^"]+)"/.exec(bin)?.[1];
    expect(own).toContain(`id="${hint}"`);
  });

  it("leaves another admin's row as it was", () => {
    const other = row("colleague@example.org");
    expect(button(other, />Admin<\/button>/)).not.toContain("aria-disabled");
    expect(button(other, /Remove colleague@example.org/)).not.toContain("aria-disabled");
    expect(other).not.toMatch(/This is you/);
  });
});
