import { describe, it, expect } from "vitest";
import { legalHref, linkAddresses, parseInline, parseLegalMarkdown, tableCells, type Inline } from "./legal-markdown";

/*
 * Release 3 (D94, spec 12.2; UF1): the Markdown subset of counsel's legal
 * texts. Headings (## and ###), paragraphs, lists two levels deep, GitHub
 * tables, **bold** and links to https:, mailto:, /legal/<document> and
 * /help only; anything else stays plain text, as written.
 */

const text = (t: string): Inline => ({ type: "text", text: t });

describe("parseLegalMarkdown", () => {
  it("reads headings, paragraphs and lists two levels deep", () => {
    const blocks = parseLegalMarkdown(
      [
        "## Who is responsible",
        "DIESIS decides how your data is used.",
        "It works with partners.",
        "",
        "### Contact",
        "- By email",
        "  - within a month",
        "- By post,",
        "  in Brussels",
      ].join("\n")
    );
    expect(blocks).toEqual([
      { type: "heading", level: 2, children: [text("Who is responsible")] },
      { type: "paragraph", children: [text("DIESIS decides how your data is used. It works with partners.")] },
      { type: "heading", level: 3, children: [text("Contact")] },
      {
        type: "list",
        items: [
          { children: [text("By email")], items: [{ children: [text("within a month")], items: [] }] },
          { children: [text("By post,"), text(" in Brussels")], items: [] },
        ],
      },
    ]);
  });

  it("reads a GitHub table, its header and every row with the header's number of cells", () => {
    const blocks = parseLegalMarkdown(
      [
        "| Name | Purpose | How long |",
        "|---|:---:|---:|",
        "| `NEXT_LOCALE` | Your **language** | Session |",
        "| a\\|b | short |",
        "",
        "After the table.",
      ].join("\n")
    );
    expect(blocks[0]).toEqual({
      type: "table",
      head: [[text("Name")], [text("Purpose")], [text("How long")]],
      rows: [
        [[text("`NEXT_LOCALE`")], [text("Your "), { type: "strong", children: [text("language")] }], [text("Session")]],
        [[text("a|b")], [text("short")], []],
      ],
    });
    expect(blocks[1]).toEqual({ type: "paragraph", children: [text("After the table.")] });
  });

  it("keeps a line starting with | that has no rule under it as text", () => {
    expect(parseLegalMarkdown("| not | a table |")).toEqual([
      { type: "paragraph", children: [text("| not | a table |")] },
    ]);
  });

  it("shows other Markdown as written: # and #### headings, numbered lists, HTML", () => {
    expect(parseLegalMarkdown("# Title")).toEqual([{ type: "paragraph", children: [text("# Title")] }]);
    expect(parseLegalMarkdown("#### Deep")).toEqual([{ type: "paragraph", children: [text("#### Deep")] }]);
    expect(parseLegalMarkdown("1. First")).toEqual([{ type: "paragraph", children: [text("1. First")] }]);
    expect(parseLegalMarkdown("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", children: [text("<script>alert(1)</script>")] },
    ]);
  });

  it("ends a paragraph at a heading, a list or a table", () => {
    const blocks = parseLegalMarkdown(["One.", "## Two", "Three.", "- four", "| a |", "|---|", "| b |"].join("\n"));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph", "list", "table"]);
  });

  it("reads Windows line ends and never throws on anything", () => {
    expect(parseLegalMarkdown("## A\r\nB\r\n")).toEqual([
      { type: "heading", level: 2, children: [text("A")] },
      { type: "paragraph", children: [text("B")] },
    ]);
    for (const odd of ["", "\n\n", "- ", "|", "|---|", "**", "[", "[a](", "  - orphan", "\\", "## "]) {
      expect(() => parseLegalMarkdown(odd), JSON.stringify(odd)).not.toThrow();
    }
  });
});

describe("parseInline", () => {
  it("reads bold, and links inside bold", () => {
    expect(parseInline("A **firm** rule")).toEqual([
      text("A "),
      { type: "strong", children: [text("firm")] },
      text(" rule"),
    ]);
    expect(parseInline("**see [help](/help)**")).toEqual([
      {
        type: "strong",
        children: [text("see "), { type: "link", href: { kind: "internal", path: "/help" }, children: [text("help")] }],
      },
    ]);
  });

  it("links only to https:, mailto:, /legal/<document> and /help", () => {
    expect(parseInline("[DPA](https://www.dataprotectionauthority.be/citizen)")).toEqual([
      {
        type: "link",
        href: { kind: "external", href: "https://www.dataprotectionauthority.be/citizen" },
        children: [text("DPA")],
      },
    ]);
    expect(parseInline("[write](mailto:privacy@example.org)")[0]).toMatchObject({
      type: "link",
      href: { kind: "external", href: "mailto:privacy@example.org" },
    });
    expect(parseInline("[cookies](/legal/cookies)")[0]).toMatchObject({
      href: { kind: "internal", path: "/legal/cookies" },
    });
    for (const address of [
      "http://example.org",
      "javascript:alert(1)",
      "data:text/html,x",
      "/legal/unknown",
      "/en/legal/privacy",
      "/admin",
      "//example.org",
      "mailto:nobody",
      "ftp://example.org",
    ]) {
      const source = `[x](${address})`;
      expect(parseInline(source), address).toEqual([text(source)]);
    }
  });

  it("keeps an unclosed ** or a bracket that starts no link as text, and honours escapes", () => {
    expect(parseInline("2 ** 3")).toEqual([text("2 ** 3")]);
    expect(parseInline("[DIESIS to add]")).toEqual([text("[DIESIS to add]")]);
    expect(parseInline("\\*\\*not bold\\*\\* and \\[x\\](/help)")).toEqual([text("**not bold** and [x](/help)")]);
  });
});

describe("legalHref", () => {
  it("normalises an https address and refuses one without a host", () => {
    expect(legalHref(" https://Example.org/a ")).toEqual({ kind: "external", href: "https://example.org/a" });
    expect(legalHref("https://")).toBeNull();
  });
});

describe("tableCells", () => {
  it("drops the outer pipes, keeps escaped ones, and keeps a last cell without a closing pipe", () => {
    expect(tableCells("| a | b |")).toEqual(["a", "b"]);
    expect(tableCells("a | b")).toEqual(["a", "b"]);
    expect(tableCells("| a\\|b | c |")).toEqual(["a\\|b", "c"]);
  });
});

describe("linkAddresses", () => {
  it("lists every link's address, allowed or not", () => {
    expect(linkAddresses("[a](/help) and [b](http://x.org) and [c]")).toEqual(["/help", "http://x.org"]);
  });
});
