import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineConfirm } from "./inline-confirm";

const render = (props: Partial<Parameters<typeof InlineConfirm>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      InlineConfirm,
      {
        title: "Delete the cohort “Autumn”?",
        confirmLabel: "Delete cohort",
        keepLabel: "Keep it",
        busy: false,
        error: null,
        onConfirm: () => {},
        onKeep: () => {},
        ...props,
      },
      createElement("p", null, "Its 2 members will have no cohort.")
    )
  ).replaceAll("<!-- -->", "");

describe("InlineConfirm", () => {
  it("is a group named by its question, which can take focus", () => {
    const html = render({ heading: "h2" });
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toMatch(/^<div role="group"/);
    expect(html).toContain(`<h2 id="${id}" tabindex="-1"`);
    expect(html).toContain("Delete the cohort “Autumn”?</h2>");
  });

  it("says what happens, then offers the action and, after it, Keep", () => {
    const html = render();
    const what = html.indexOf("Its 2 members will have no cohort.");
    const action = html.indexOf("Delete cohort</button>");
    const keep = html.indexOf("Keep it</button>");
    expect(what).toBeGreaterThan(0);
    expect(action).toBeGreaterThan(what);
    expect(keep).toBeGreaterThan(action);
  });

  it("keeps the action focusable while it runs, and shows why it failed", () => {
    const html = render({ busy: true, error: "Something went wrong." });
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(html).toMatch(/role="alert"[^>]*>.*Something went wrong\./);
  });
});
