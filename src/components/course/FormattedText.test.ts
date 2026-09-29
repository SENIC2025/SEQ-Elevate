import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "./FormattedText";

// Static markup is what the server sends and what the client must hydrate
// to, so it's also the check that both render the same thing.
function render(props: Parameters<typeof FormattedText>[0]): string {
  return renderToStaticMarkup(createElement(FormattedText, props));
}

describe("FormattedText", () => {
  it("renders nothing for missing or blank text", () => {
    expect(render({ text: undefined })).toBe("");
    expect(render({ text: " \n\n " })).toBe("");
  });

  it("renders a paragraph with its line breaks", () => {
    expect(render({ text: "First line\nSecond line" })).toBe(
      '<div class="seq-prose"><p>First line<br/>Second line</p></div>'
    );
  });

  it("renders bullets as a list beside the paragraph, never inside it", () => {
    expect(render({ text: "Remember:\n• Pause\n• Decide" })).toBe(
      '<div class="seq-prose"><p>Remember:</p><ul><li>Pause</li><li>Decide</li></ul></div>'
    );
  });

  it("renders a numbered list from the author's start number", () => {
    expect(render({ text: "3. Check\n4. Decide" })).toBe(
      '<div class="seq-prose"><ol start="3"><li>Check</li><li>Decide</li></ol></div>'
    );
  });

  it("adds the compact spacing and the caller's classes", () => {
    expect(render({ text: "Hi", compact: true, className: "text-sm" })).toBe(
      '<div class="seq-prose seq-prose-compact text-sm"><p>Hi</p></div>'
    );
  });

  it("escapes markup in the author's text instead of rendering it", () => {
    expect(render({ text: "<b>x</b> & <script>alert(1)</script>" })).toBe(
      '<div class="seq-prose"><p>&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p></div>'
    );
  });
});
