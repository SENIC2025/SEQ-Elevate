import { describe, it, expect } from "vitest";
import { leavesPage, type LinkClick } from "./leave-guard";

const HERE = "https://seq-elevate.eu/en/content/courses/workplace-conflict?lang=de";

const click = (over: Partial<LinkClick>): LinkClick => ({
  button: 0,
  modified: false,
  defaultPrevented: false,
  href: "/en/content/courses",
  target: "",
  download: false,
  ...over,
});

describe("leavesPage", () => {
  it("catches in-app links to another page (All courses, header links)", () => {
    expect(leavesPage(click({}), HERE)).toBe(true);
    expect(leavesPage(click({ href: "/en" }), HERE)).toBe(true);
    expect(leavesPage(click({ target: "_self" }), HERE)).toBe(true);
  });

  it("catches the same page in another menu language (it remounts)", () => {
    expect(
      leavesPage(click({ href: "/de/content/courses/workplace-conflict" }), HERE)
    ).toBe(true);
  });

  it("lets in-page anchors and query changes through", () => {
    expect(
      leavesPage(
        click({ href: "/en/content/courses/workplace-conflict#lesson-concept" }),
        HERE
      )
    ).toBe(false);
    expect(
      leavesPage(
        click({ href: "/en/content/courses/workplace-conflict?lesson=concept" }),
        HERE
      )
    ).toBe(false);
  });

  it("lets new tabs, downloads and other buttons through (nothing is lost)", () => {
    expect(leavesPage(click({ target: "_blank" }), HERE)).toBe(false);
    expect(leavesPage(click({ modified: true }), HERE)).toBe(false);
    expect(leavesPage(click({ button: 1 }), HERE)).toBe(false);
    expect(leavesPage(click({ download: true }), HERE)).toBe(false);
    expect(leavesPage(click({ defaultPrevented: true }), HERE)).toBe(false);
  });

  it("leaves other sites to the browser's own prompt", () => {
    expect(leavesPage(click({ href: "https://example.org/x" }), HERE)).toBe(
      false
    );
  });
});
